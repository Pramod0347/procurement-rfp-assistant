import { Router } from "express";
import prisma from "../lib/prisma";
import { generateRfpSpecFromText } from "../ai";

const router = Router();

router.get("/rfps", async (req, res) => {
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

router.post("/rfps", async (req, res) => {
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
        deliveryDeadline: deliveryDeadline ? new Date(deliveryDeadline) : null,
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

router.post("/rfps/from-text", async (req, res) => {
  try {
    const { naturalLanguageInput, title: explicitTitle } = req.body;

    if (!naturalLanguageInput) {
      return res.status(400).json({ error: "naturalLanguageInput is required" });
    }

    const structuredSpec = await generateRfpSpecFromText(naturalLanguageInput);

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
        ? new Date(Date.now() + deliveryDeadlineDaysFromNow * 24 * 60 * 60 * 1000)
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

export default router;
