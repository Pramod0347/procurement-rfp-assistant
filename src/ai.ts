import "dotenv/config";

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

const SYSTEM_INSTRUCTIONS = `
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

function buildUserPrompt(naturalLanguageInput: string): string {
  return `
Free-text procurement request:
""" 
${naturalLanguageInput}
"""

Extract as JSON with the exact shape described. Use null when information is missing.
`;
}

function cleanModelJson(raw: string): string {
  return raw
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
}

/**
 * Primary: Gemini 1.5 Flash
 */
async function callGemini(
  naturalLanguageInput: string
): Promise<RfpStructuredSpec> {
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
          { text: SYSTEM_INSTRUCTIONS },
          { text: buildUserPrompt(naturalLanguageInput) },
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

  // Gemini v1 returns candidates[0].content.parts[].text
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      .join("\n") ?? "";

  if (!text) {
    throw new Error("Gemini returned empty content");
  }

  const cleaned = cleanModelJson(text);
  return JSON.parse(cleaned) as RfpStructuredSpec;
}


/**
 * Fallback: Groq (Llama 3)
 */
async function callGroq(
  naturalLanguageInput: string
): Promise<RfpStructuredSpec> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const url = "https://api.groq.com/openai/v1/chat/completions";

  const body = {
    model: "llama-3.1-8b-instant", // or another Groq model you prefer
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTIONS },
      { role: "user", content: buildUserPrompt(naturalLanguageInput) },
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

  const cleaned = cleanModelJson(content);
  return JSON.parse(cleaned) as RfpStructuredSpec;
}

/**
 * Public API: what your server uses
 * Tries Gemini first, falls back to Groq on error.
 */
export async function generateRfpSpecFromText(
  naturalLanguageInput: string
): Promise<RfpStructuredSpec> {
  try {
    return await callGemini(naturalLanguageInput);
  } catch (err) {
    console.error("Gemini failed, falling back to Groq:", err);
  }

  // Fallback
  return await callGroq(naturalLanguageInput);
}
