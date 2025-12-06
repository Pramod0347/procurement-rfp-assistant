import { Router } from "express";
import prisma from "../lib/prisma";

const router = Router();

router.get("/emails", async (req, res) => {
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

export default router;
