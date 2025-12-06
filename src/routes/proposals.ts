import { Router } from "express";
import prisma from "../lib/prisma";
import { generateProposalFromText } from "../ai";
import { compareProposalsForRfp } from "../proposalScoring";

const router = Router();

router.get("/rfps/:rfpId/proposals", async (req, res) => {
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

router.post("/rfps/:rfpId/proposals", async (req, res) => {
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

router.get("/rfps/:rfpId/compare", async (req, res) => {
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

router.post("/rfps/:rfpId/proposals/from-text", async (req, res) => {
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
        receivedAt: emailMeta?.receivedAt ? new Date(emailMeta.receivedAt) : new Date(),
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
    console.error("Error creating proposal from text:", err);
    res.status(500).json({ error: "Failed to create proposal from text" });
  }
});

router.get("/rfps/:rfpId/emails", async (req, res) => {
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

export default router;
