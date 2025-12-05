import express from "express";
import cors from "cors";
import prisma from "./prisma";
import { generateRfpSpecFromText } from "./ai";

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Sample route
app.get("/health", (req, res) => {
    res.json({ status: "ok", message: "Server Running" });
});

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
                name: String(name),
                email: String(email),
                contactPerson: contactPerson ? String(contactPerson) : null,
                notes: notes ? String(notes) : null,
            },
        });

        res.status(201).json(newVendor);
    } catch (err) {
        console.error("Error creating vendor:", err);

        // Handle unique email errors nicely
        if (typeof err === "object" && err !== null && "code" in err && (err as any).code === "P2002") {
            return res.status(400).json({ error: "Vendor with this email already exists" });
        }

        res.status(500).json({ error: "Failed to create vendor" });
    }
})

app.get("/rfps", async (req, res) => {
    try {
        const rfps = await prisma.rfp.findMany({
            orderBy: { createdAt: "desc" }
        });
        res.json(rfps);
    } catch (err) {
        console.error("Error fetching RFPs:", err);
        res.status(500).json({ error: "Failed to fetch RFPs" });
    }
})

app.post("/rfps", async (req, res) => {
    try {
        const {
            title,
            naturalLanguageInput,
            budget,
            currency,
            deliveryDeadline,        // ISO string from client
            paymentTerms,
            minimumWarrantyMonths,
            structuredSpec,          // optional now
        } = req.body;

        if(!title || !naturalLanguageInput) {
            return res
                .status(400)
                .json({ error: "Title and naturalLanguageInput are required" 
            });
        }

        const rfp = await prisma.rfp.create({
            data: {
                title,
                naturalLanguageInput,
                structuredSpec: structuredSpec ?? {}, // for now, allow empty object
                budget: budget ?? null,
                currency: currency ?? null,
                deliveryDeadline: deliveryDeadline ? new Date(deliveryDeadline) : null,
                paymentTerms: paymentTerms ?? null,
                minimumWarrantyMonths: minimumWarrantyMonths ?? null,
            },
        })

        res.status(201).json(rfp);

    } catch (err) {
        console.error("Error creating RFP:", err);
        res.status(500).json({ error: "Failed to create RFP" });
    }
})

app.post("/rfps/from-text", async (req, res) => {
  try {
    const { naturalLanguageInput, title: explicitTitle } = req.body;

    if (!naturalLanguageInput) {
      return res
        .status(400)
        .json({ error: "naturalLanguageInput is required" });
    }

    // 1) Call AI to get structured spec
    const structuredSpec = await generateRfpSpecFromText(naturalLanguageInput);

    // 2) Decide final title:
    const title = explicitTitle || structuredSpec.title || "Untitled RFP";

    // 3) Map structuredSpec into Rfp fields
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
            Date.now() + deliveryDeadlineDaysFromNow * 24 * 60 * 60 * 1000
          )
        : null;

    // 4) Save in DB
    const rfp = await prisma.rfp.create({
      data: {
        title,
        naturalLanguageInput,
        structuredSpec,
        budget: budget ?? null,
        currency: currency ?? null,
        deliveryDeadline,
        paymentTerms: paymentTerms ?? null,
        minimumWarrantyMonths: minimumWarrantyMonths ?? null,
      },
    });

    res.status(201).json(rfp);
  } catch (err: any) {
    console.error("Error creating RFP from text:", err);

    // If JSON.parse failed or model returned garbage
    if (err instanceof SyntaxError) {
      return res
        .status(500)
        .json({ error: "Failed to parse AI response as JSON" });
    }

    res.status(500).json({ error: "Failed to create RFP from text" });
  }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})