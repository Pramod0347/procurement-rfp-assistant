import { Router } from "express";
import prisma from "../lib/prisma";

const router = Router();

router.get("/vendors", async (req, res) => {
  try {
    const vendors = await prisma.vendor.findMany();
    res.json(vendors);
  } catch (err) {
    console.error("Error fetching vendors:", err);
    res.status(500).json({ error: "Failed to fetch vendors" });
  }
});

router.post("/vendors", async (req, res) => {
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

export default router;
