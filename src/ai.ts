import "dotenv/config";
import { Rfp, Vendor } from ".prisma/client";

export interface ParsedProposalSpec {
  totalPrice: number | null;
  currency: string | null;
  deliveryDays: number | null;
  warrantyMonths: number | null;
  terms: string | null;
  notes: string | null;
}

export interface RfpStructuredSpec {
  title: string;
  items: {
    name: string;
    quantity: number;
    keySpecs: string[];
  }[];
  budget: number | null;
  currency: string | null;
  deliveryDeadlineDaysFromNow: number | null;
  paymentTerms: string | null;
  minimumWarrantyMonths: number | null;
}

/* ---------------------------------------------------
 * Shared helpers
 * --------------------------------------------------*/

function cleanModelJson(raw: string): string {
  return raw
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
}

// Low-level: talk to Gemini, return raw JSON string
async function callGeminiJson(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const url =
    "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";

  const body = {
    contents: [
      {
        parts: [
          { text: systemPrompt },
          { text: userPrompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  };

  const resp = await fetch(`${url}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Gemini error: ${resp.status} ${resp.statusText} - ${text}`
    );
  }

  const data: any = await resp.json();

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      .join("\n") ?? "";

  if (!text) {
    throw new Error("Gemini returned empty content");
  }

  return cleanModelJson(text);
}

// Low-level: talk to Groq, return raw JSON string
async function callGroqJson(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const url = "https://api.groq.com/openai/v1/chat/completions";

  const body = {
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Groq error: ${resp.status} ${resp.statusText} - ${text}`);
  }

  const data: any = await resp.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Groq returned empty content");
  }

  return cleanModelJson(content);
}

// Generic helper: try Gemini first, then Groq
async function callGeminiOrGroqForJson(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  try {
    return await callGeminiJson(systemPrompt, userPrompt);
  } catch (err) {
    console.error("Gemini failed, falling back to Groq:", err);
  }

  return await callGroqJson(systemPrompt, userPrompt);
}

/* ---------------------------------------------------
 * RFP: from free-text → structured spec
 * --------------------------------------------------*/

const RFP_SYSTEM_INSTRUCTIONS = `
You are an assistant that converts free-text procurement requests into a structured JSON RFP spec.

You MUST respond with ONLY valid JSON. No extra text, no explanations.

JSON shape:
{
  "title": string,
  "items": [
    {
      "name": string,
      "quantity": number,
      "keySpecs": string[]
    }
  ],
  "budget": number | null,
  "currency": string | null,
  "deliveryDeadlineDaysFromNow": number | null,
  "paymentTerms": string | null,
  "minimumWarrantyMonths": number | null
}
`;

function buildRfpUserPrompt(naturalLanguageInput: string): string {
  return `
Free-text procurement request:
""" 
${naturalLanguageInput}
"""

Extract as JSON with the exact shape described. Use null when information is missing.
`.trim();
}

export async function generateRfpSpecFromText(
  naturalLanguageInput: string
): Promise<RfpStructuredSpec> {
  const jsonString = await callGeminiOrGroqForJson(
    RFP_SYSTEM_INSTRUCTIONS,
    buildRfpUserPrompt(naturalLanguageInput)
  );

  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    console.error("Failed to parse RFP JSON:", jsonString);
    throw new Error("Failed to parse AI response as JSON for RFP");
  }

  // Light validation / coercion
  const spec: RfpStructuredSpec = {
    title: typeof parsed.title === "string" ? parsed.title : "Untitled RFP",
    items: Array.isArray(parsed.items)
      ? parsed.items.map((item: any) => ({
          name: typeof item.name === "string" ? item.name : "Item",
          quantity:
            typeof item.quantity === "number" && !Number.isNaN(item.quantity)
              ? item.quantity
              : 1,
          keySpecs: Array.isArray(item.keySpecs)
            ? item.keySpecs.filter((s: any) => typeof s === "string")
            : [],
        }))
      : [],
    budget:
      typeof parsed.budget === "number" && !Number.isNaN(parsed.budget)
        ? parsed.budget
        : null,
    currency: typeof parsed.currency === "string" ? parsed.currency : null,
    deliveryDeadlineDaysFromNow:
      typeof parsed.deliveryDeadlineDaysFromNow === "number" &&
      !Number.isNaN(parsed.deliveryDeadlineDaysFromNow)
        ? parsed.deliveryDeadlineDaysFromNow
        : null,
    paymentTerms:
      typeof parsed.paymentTerms === "string" ? parsed.paymentTerms : null,
    minimumWarrantyMonths:
      typeof parsed.minimumWarrantyMonths === "number" &&
      !Number.isNaN(parsed.minimumWarrantyMonths)
        ? parsed.minimumWarrantyMonths
        : null,
  };

  return spec;
}

/* ---------------------------------------------------
 * Proposal: from vendor text → structured proposal spec
 * --------------------------------------------------*/

const PROPOSAL_SYSTEM_PROMPT = `
You are an assistant that extracts structured commercial proposal details from unstructured vendor emails or text.

You MUST respond with ONLY valid JSON. No extra text, no explanations.

JSON shape:
{
  "totalPrice": number | null,
  "currency": string | null,
  "deliveryDays": number | null,
  "warrantyMonths": number | null,
  "terms": string | null,
  "notes": string | null
}

Rules:
- totalPrice should be a number (no commas, no currency symbol).
- currency should be like "INR", "USD", "EUR", or null if unclear.
- deliveryDays is the number of calendar days until full delivery.
- warrantyMonths is the number of months of warranty.
- terms is short text like "Net-30", "Advance 50%".
- notes can include extra comments like support, services, etc.
`;

export async function generateProposalFromText(
  rawText: string,
  opts?: {
    rfp?: Rfp;
    vendor?: Vendor;
  }
): Promise<ParsedProposalSpec> {
  const userContextPieces: string[] = [];
  if (opts?.rfp) {
    userContextPieces.push(
      `RFP title: ${opts.rfp.title}`,
      `RFP budget: ${opts.rfp.budget ?? "unknown"} ${opts.rfp.currency ?? ""}`
    );
  }
  if (opts?.vendor) {
    userContextPieces.push(`Vendor: ${opts.vendor.name}`);
  }

  const userPrompt = `
${userContextPieces.join("\n")}

Vendor text:
"""
${rawText}
"""
`.trim();

  const jsonString = await callGeminiOrGroqForJson(
    PROPOSAL_SYSTEM_PROMPT,
    userPrompt
  );

  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    console.error("Failed to parse Proposal JSON:", jsonString);
    throw new Error("Failed to parse proposal JSON from model");
  }

  const spec: ParsedProposalSpec = {
    totalPrice:
      typeof parsed.totalPrice === "number" && !Number.isNaN(parsed.totalPrice)
        ? parsed.totalPrice
        : null,
    currency: typeof parsed.currency === "string" ? parsed.currency : null,
    deliveryDays:
      typeof parsed.deliveryDays === "number" &&
      !Number.isNaN(parsed.deliveryDays)
        ? parsed.deliveryDays
        : null,
    warrantyMonths:
      typeof parsed.warrantyMonths === "number" &&
      !Number.isNaN(parsed.warrantyMonths)
        ? parsed.warrantyMonths
        : null,
    terms: typeof parsed.terms === "string" ? parsed.terms : null,
    notes: typeof parsed.notes === "string" ? parsed.notes : null,
  };

  return spec;
}
