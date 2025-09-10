// server/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { create, all } from "mathjs";

dotenv.config();
if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in server/.env");
  process.exit(1);
}

const math = create(all, { number: "number" });
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

// --- helpers ---

function isLikelyMath(s) {
  const allowedWords = /(sin|cos|tan|log10|ln|exp|sqrt|pi|deg|rad|e)/gi;
  const stripped = s.replace(allowedWords, "");
  return /^[\s0-9+\-*/^().,eE]+$/.test(stripped);
}

function hasOpOrFunc(s) {
  const hasOp = /[+\-*/^()]/.test(s);
  const hasFunc = /\b(sin|cos|tan|log10|ln|exp|sqrt)\b/i.test(s);
  return hasOp || hasFunc;
}

function hasDigitOrConst(s) {
  const hasDigit = /\d/.test(s);
  const hasConst = /\b(pi|e)\b/i.test(s);
  return hasDigit || hasConst;
}

// Try to strip English boilerplate WITHOUT making a bare number
function tryStripEnglish(s) {
  let t = s.replace(/[^0-9a-z+\-*/^().,\s]/gi, " ");
  t = t.replace(/\b(what\s+is|calculate|compute|please|solve|evaluate)\b/gi, " ");
  const keep = new Set(["sin","cos","tan","log10","ln","exp","sqrt","pi","deg","rad","e"]);
  t = t.replace(/\b([a-z]+)\b/gi, (m, w) => (keep.has(w.toLowerCase()) ? m : " "));
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// Normalize NL → strict expression via AI
async function normalizeWithAI(nl) {
  const system = `You convert natural-language math into a strict expression using ONLY:
+ - * / ^ parentheses sin cos tan log10 ln exp sqrt pi e and units "deg" or "rad".
Rules:
- Convert number words to numerals (e.g., "three hundred and five" -> 305).
- Keep all operators and structure; do not omit terms.
- Do not evaluate; just produce the expression.
- Return ONLY JSON: {"expression":"<strict expression>"} .`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: nl }
  ];

  // Prefer precise JSON schema, then fall back to json_object, then plain
  const schema = {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
    additionalProperties: false,
  };

  // Try with json_schema
  try {
    const r = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "expr", schema } },
      messages
    });
    const content = r.choices?.[0]?.message?.content ?? "";
    return JSON.parse(content)?.expression;
  } catch {
    // Try with json_object
    try {
      const r = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages
      });
      const content = r.choices?.[0]?.message?.content ?? "";
      return JSON.parse(content)?.expression;
    } catch {
      // Last resort: plain text, try to extract backticked or quoted expr
      const r = await openai.chat.completions.create({ model: MODEL, temperature: 0, messages });
      const raw = r.choices?.[0]?.message?.content ?? "";
      const m = raw.match(/"expression"\s*:\s*"([^"]+)"/) || raw.match(/`([^`]+)`/);
      return m ? m[1] : null;
    }
  }
}

/** ---- route ---- **/

app.post("/api/eval", async (req, res) => {
  try {
    const { expression, angleMode } = req.body ?? {};
    if (typeof expression !== "string" || !expression.trim()) {
      return res.status(400).json({ error: "Missing expression" });
    }
    const text = expression.trim();

    // 1) Already math? Only if it actually has an operator/function AND a digit/constant
    if (isLikelyMath(text) && hasOpOrFunc(text) && hasDigitOrConst(text)) {
      try {
        const result = evalStrict(text, angleMode || "RAD");
        return res.json({ result });
      } catch (e) {
        return res.status(400).json({ error: e?.message || "Invalid expression" });
      }
    }

    // 2) Try stripping boilerplate; still require operator/function
    const stripped = tryStripEnglish(text);
    if (
      stripped &&
      stripped !== text &&
      isLikelyMath(stripped) &&
      hasOpOrFunc(stripped) &&
      hasDigitOrConst(stripped)
    ) {
      try {
        const result = evalStrict(stripped, angleMode || "RAD");
        return res.json({ result, normalized: stripped });
      } catch {
        // fall through to AI
      }
    }

    // 3) Otherwise, normalize with AI then evaluate locally
    const normalized = await normalizeWithAI(text);
    if (!normalized || typeof normalized !== "string") {
      return res.status(400).json({ error: "Normalization failed" });
    }
    try {
      const result = evalStrict(normalized, angleMode || "RAD");
      return res.json({ result, normalized });
    } catch (e) {
      return res.status(400).json({ error: e?.message || "Invalid normalized expression", normalized });
    }
  } catch (err) {
    console.error("[/api/eval] Server error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = parseInt(process.env.PORT ?? "3001", 10);
app.listen(PORT, () => console.log(`AI eval server on http://localhost:${PORT}`));
