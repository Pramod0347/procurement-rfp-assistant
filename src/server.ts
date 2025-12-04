import express from "express";
import cors from "cors";
import prisma from "./prisma";

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

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})