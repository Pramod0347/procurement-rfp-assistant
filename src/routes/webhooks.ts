import { Router } from "express";
import prisma from "../lib/prisma";
import { generateProposalFromText } from "../ai";
import {
  extractEmailAddress,
  extractRfpSelectorFromSubject,
} from "../utils/email";

const router = Router();

router.post("/webhooks/email", async (req, res) => {
  try {
    const body = (req.body || {}) as any;
    console.log("CloudMailin webhook payload:", body);

    const headers = body.headers || {};
    const envelope = body.envelope || {};

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

    const vendor = await prisma.vendor.findUnique({
      where: { email: fromEmail },
    });

    if (!vendor) {
      return res.status(400).json({
        error: "No vendor found with this 'from' email",
        from: fromEmail,
      });
    }

    const { rfpId, keyword } = extractRfpSelectorFromSubject(subject);

    let rfp = null;

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

    const parsed = await generateProposalFromText(text, { rfp, vendor });

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

export default router;
