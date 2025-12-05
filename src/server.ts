import express from "express";
import cors from "cors";
import prisma from "./prisma";
import { generateRfpSpecFromText, generateProposalFromText } from "./ai";
import { compareProposalsForRfp } from "./proposalScoring";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// -------------------------------------------------
// Helpers
// -------------------------------------------------
function extractEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Handles "Name <email@domain>" and plain "email@domain"
  const match = raw.match(/<([^>]+)>/);
  const email = match ? match[1] : raw;
  return email.trim().toLowerCase();
}

function extractRfpSelectorFromSubject(
  subject: string | null | undefined
): { rfpId?: string; keyword?: string } {
  if (!subject) return {};

  // Pattern 1: RFPID:cmisghrjt0003peit8md1a9fq
  const idMatch = subject.match(/\bRFPID\s*[:\-]\s*([a-zA-Z0-9]+)/i);
  if (idMatch && idMatch[1]) {
    return { rfpId: idMatch[1] };
  }

  // Pattern 2: RFP: Laptops Procurement
  const keywordMatch = subject.match(/\bRFP\s*[:\-]\s*(.+)$/i);
  if (keywordMatch && keywordMatch[1]) {
    return { keyword: keywordMatch[1].trim() };
  }

  return {};
}

// -------------------------------------------------
// Health Check
// -------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server Running" });
});

// -------------------------------------------------
// Vendors
// -------------------------------------------------
app.get("/vendors", async (req, res) => {
  try {
    const vendors = await prisma.vendor.findMany();
    res.json(vendors);
  } catch (err) {
    console.error("Error fetching vendors:", err);
    res.status(500).json({ error: "Failed to fetch vendors" });
  }
});

app.post("/vendors", async (req, res) => {
  try {
    const { name, email, contactPerson, notes } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    const newVendor = await prisma.vendor.create({
      data: {
        name,
        email,
        contactPerson: contactPerson ?? null,
        notes: notes ?? null,
      },
    });

    res.status(201).json(newVendor);
  } catch (err: any) {
    console.error("Error creating vendor:", err);

    if (err.code === "P2002") {
      return res
        .status(400)
        .json({ error: "Vendor with this email already exists" });
    }

    res.status(500).json({ error: "Failed to create vendor" });
  }
});

// -------------------------------------------------
// RFPs
// -------------------------------------------------
app.get("/rfps", async (req, res) => {
  try {
    const rfps = await prisma.rfp.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(rfps);
  } catch (err) {
    console.error("Error fetching RFPs:", err);
    res.status(500).json({ error: "Failed to fetch RFPs" });
  }
});

app.post("/rfps", async (req, res) => {
  try {
    const {
      title,
      naturalLanguageInput,
      budget,
      currency,
      deliveryDeadline,
      paymentTerms,
      minimumWarrantyMonths,
      structuredSpec,
    } = req.body;

    if (!title || !naturalLanguageInput) {
      return res.status(400).json({
        error: "Title and naturalLanguageInput are required",
      });
    }

    const rfp = await prisma.rfp.create({
      data: {
        title,
        naturalLanguageInput,
        structuredSpec: structuredSpec ?? {},
        budget: budget ?? null,
        currency: currency ?? null,
        deliveryDeadline: deliveryDeadline
          ? new Date(deliveryDeadline)
          : null,
        paymentTerms: paymentTerms ?? null,
        minimumWarrantyMonths: minimumWarrantyMonths ?? null,
      },
    });

    res.status(201).json(rfp);
  } catch (err) {
    console.error("Error creating RFP:", err);
    res.status(500).json({ error: "Failed to create RFP" });
  }
});

// AI-powered RFP creation
app.post("/rfps/from-text", async (req, res) => {
  try {
    const { naturalLanguageInput, title: explicitTitle } = req.body;

    if (!naturalLanguageInput) {
      return res
        .status(400)
        .json({ error: "naturalLanguageInput is required" });
    }

    const structuredSpec = await generateRfpSpecFromText(
      naturalLanguageInput
    );

    const title = explicitTitle || structuredSpec.title || "Untitled RFP";

    const {
      budget,
      currency,
      deliveryDeadlineDaysFromNow,
      paymentTerms,
      minimumWarrantyMonths,
    } = structuredSpec;

    const deliveryDeadline =
      deliveryDeadlineDaysFromNow != null
        ? new Date(
            Date.now() +
              deliveryDeadlineDaysFromNow * 24 * 60 * 60 * 1000
          )
        : null;

    const rfp = await prisma.rfp.create({
      data: {
        title,
        naturalLanguageInput,
        structuredSpec: structuredSpec as any,
        budget: budget ?? null,
        currency: currency ?? null,
        deliveryDeadline,
        paymentTerms: paymentTerms ?? null,
        minimumWarrantyMonths: minimumWarrantyMonths ?? null,
      },
    });

    res.status(201).json(rfp);
  } catch (err) {
    console.error("Error creating RFP from text:", err);
    res.status(500).json({ error: "Failed to create RFP from text" });
  }
});

// -------------------------------------------------
// Proposals
// -------------------------------------------------
app.get("/rfps/:rfpId/proposals", async (req, res) => {
  try {
    const { rfpId } = req.params;

    const proposals = await prisma.proposal.findMany({
      where: { rfpId },
      include: { vendor: true, email: true },
      orderBy: { createdAt: "desc" },
    });

    res.json(proposals);
  } catch (err) {
    console.error("Error fetching proposals:", err);
    res.status(500).json({ error: "Failed to fetch proposals" });
  }
});

// Manual proposal creation
app.post("/rfps/:rfpId/proposals", async (req, res) => {
  try {
    const { rfpId } = req.params;
    const {
      vendorId,
      totalPrice,
      currency,
      deliveryDays,
      warrantyMonths,
      terms,
      notes,
    } = req.body;

    if (!vendorId) {
      return res.status(400).json({ error: "vendorId is required" });
    }

    const proposal = await prisma.proposal.create({
      data: {
        rfpId,
        vendorId,
        totalPrice: totalPrice ?? null,
        currency: currency ?? null,
        deliveryDays: deliveryDays ?? null,
        warrantyMonths: warrantyMonths ?? null,
        terms: terms ?? null,
        notes: notes ?? null,
      },
    });

    res.status(201).json(proposal);
  } catch (err) {
    console.error("Error creating proposal:", err);
    res.status(500).json({ error: "Failed to create proposal" });
  }
});

// -------------------------------------------------
// Proposal comparison
// -------------------------------------------------
app.get("/rfps/:rfpId/compare", async (req, res) => {
  try {
    const { rfpId } = req.params;

    const rfp = await prisma.rfp.findUnique({
      where: { id: rfpId },
    });

    if (!rfp) {
      return res.status(404).json({ error: "RFP not found" });
    }

    const proposals = await prisma.proposal.findMany({
      where: { rfpId },
      include: { vendor: true },
    });

    const result = compareProposalsForRfp(rfp, proposals as any);

    res.json(result);
  } catch (err) {
    console.error("Error comparing proposals:", err);
    res.status(500).json({ error: "Failed to compare proposals" });
  }
});

// -------------------------------------------------
// AI Proposal Parsing (manual from-text)
// -------------------------------------------------
app.post("/rfps/:rfpId/proposals/from-text", async (req, res) => {
  try {
    const { rfpId } = req.params;
    const { vendorId, text, emailMeta } = req.body;

    if (!vendorId || !text) {
      return res.status(400).json({
        error: "vendorId and text are required",
      });
    }

    const [rfp, vendor] = await Promise.all([
      prisma.rfp.findUnique({ where: { id: rfpId } }),
      prisma.vendor.findUnique({ where: { id: vendorId } }),
    ]);

    if (!rfp) {
      return res.status(404).json({ error: "RFP not found" });
    }
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const email = await prisma.emailMessage.create({
      data: {
        from: emailMeta?.from ?? vendor.email,
        to: emailMeta?.to ?? null,
        subject: emailMeta?.subject ?? null,
        bodyText: text,
        bodyHtml: emailMeta?.bodyHtml ?? null,
        messageId: emailMeta?.messageId ?? null,
        receivedAt: emailMeta?.receivedAt
          ? new Date(emailMeta.receivedAt)
          : new Date(),
        status: "PENDING",
      },
    });

    const parsed = await generateProposalFromText(text, { rfp, vendor });

    const proposal = await prisma.proposal.create({
      data: {
        rfpId,
        vendorId,
        totalPrice: parsed.totalPrice,
        currency: parsed.currency ?? rfp.currency ?? null,
        deliveryDays: parsed.deliveryDays,
        warrantyMonths: parsed.warrantyMonths,
        terms: parsed.terms,
        notes: parsed.notes,
        source: "EMAIL",
        emailId: email.id,
      },
      include: { vendor: true, email: true },
    });

    await prisma.emailMessage.update({
      where: { id: email.id },
      data: { status: "PARSED" },
    });

    res.status(201).json({ proposal, parsed });
  } catch (err) {
    console.error("Error creating AI proposal:", err);
    res.status(500).json({ error: "Failed to create proposal from text" });
  }
});

// -------------------------------------------------
// Email Webhook - for real providers (CloudMailin)
// -------------------------------------------------
app.post("/webhooks/email", async (req, res) => {
  try {
    const body = (req.body || {}) as any;
    console.log("CloudMailin webhook payload:", body);

    const headers = body.headers || {};
    const envelope = body.envelope || {};

    // ---- normalize fields from CloudMailin payload ----
    const fromRaw = envelope.from || headers.from || null;
    const toRaw = envelope.to || headers.to || null;

    const fromEmail = extractEmailAddress(fromRaw);
    const toEmail = extractEmailAddress(toRaw);

    const subject: string | null = headers.subject || null;
    const text: string | null = body.plain || null;
    const html: string | null = body.html || null;
    const messageId: string | null =
      headers.message_id || headers["message-id"] || null;

    if (!fromEmail || !text) {
      return res.status(400).json({
        error: "Missing required 'from' or 'text' fields (CloudMailin format).",
      });
    }

    // ---- 1) Vendor lookup by email ----
    const vendor = await prisma.vendor.findUnique({
      where: { email: fromEmail },
    });

    if (!vendor) {
      return res.status(400).json({
        error: "No vendor found with this 'from' email",
        from: fromEmail,
      });
    }

    // ---- 2) RFP selection based on email subject ----
    const { rfpId, keyword } = extractRfpSelectorFromSubject(subject);

    let rfp = null;

    // 2a) If subject contains RFPID:xyz -> match by ID
    if (rfpId) {
      rfp = await prisma.rfp.findUnique({
        where: { id: rfpId },
      });

      if (!rfp) {
        return res.status(404).json({
          error: "RFP not found for provided RFPID in subject",
          subject,
          rfpIdFromSubject: rfpId,
        });
      }
    }

    // 2b) Otherwise, if subject contains RFP: keyword -> match by title
    if (!rfp && keyword) {
      rfp = await prisma.rfp.findFirst({
        where: {
          title: {
            contains: keyword,
            mode: "insensitive",
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (!rfp) {
        return res.status(404).json({
          error: "No RFP found matching keyword from subject",
          subject,
          keywordFromSubject: keyword,
        });
      }
    }

    // 2c) If still no RFP, hard fail (sender must specify)
    if (!rfp) {
      return res.status(400).json({
        error:
          "No RFP reference found in email subject. " +
          "Please include either 'RFPID:<rfpId>' or 'RFP: <title keyword>' in the subject.",
        exampleSubjects: [
          "Laptop Proposal RFPID:cmisghrjt0003peit8md1a9fq",
          "Laptop Proposal RFP: Laptops Procurement",
        ],
        subject,
      });
    }

    // ---- 3) Store raw email ----
    const email = await prisma.emailMessage.create({
      data: {
        from: fromEmail,
        to: toEmail,
        subject,
        bodyText: text,
        bodyHtml: html,
        messageId,
        receivedAt: new Date(),
        status: "PENDING",
      },
    });

    // ---- 4) Parse proposal with AI ----
    const parsed = await generateProposalFromText(text, { rfp, vendor });

    // ---- 5) Create Proposal linked to RFP, Vendor and Email ----
    const proposal = await prisma.proposal.create({
      data: {
        rfpId: rfp.id,
        vendorId: vendor.id,
        totalPrice: parsed.totalPrice,
        currency: parsed.currency ?? rfp.currency ?? null,
        deliveryDays: parsed.deliveryDays,
        warrantyMonths: parsed.warrantyMonths,
        terms: parsed.terms,
        notes: parsed.notes,
        source: "EMAIL",
        emailId: email.id,
      },
      include: {
        vendor: true,
        email: true,
      },
    });

    // ---- 6) Mark email as parsed ----
    await prisma.emailMessage.update({
      where: { id: email.id },
      data: { status: "PARSED" },
    });

    return res.status(200).json({
      message: "Email parsed successfully",
      proposal,
      parsed,
      email,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: "Failed to process email webhook" });
  }
});

// -------------------------------------------------
// Email listing
// -------------------------------------------------
app.get("/emails", async (req, res) => {
  try {
    const emails = await prisma.emailMessage.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(emails);
  } catch (err) {
    console.error("Error fetching emails:", err);
    res.status(500).json({ error: "Failed to fetch emails" });
  }
});

app.get("/rfps/:rfpId/emails", async (req, res) => {
  try {
    const { rfpId } = req.params;

    const proposals = await prisma.proposal.findMany({
      where: {
        rfpId,
        source: "EMAIL",
        emailId: {
          not: null,
        },
      },
      include: {
        vendor: true,
        email: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(proposals);
  } catch (err) {
    console.error("Error fetching RFP emails:", err);
    res.status(500).json({ error: "Failed to fetch emails for RFP" });
  }
});

// -------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
