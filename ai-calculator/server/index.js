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

/** ---- helpers ---- **/

// Add "deg" automatically for sin/cos/tan when angleMode === "DEG"
function transformForDegrees(s) {
  return s.replace(
    /(sin|cos|tan)\(([^()]+)\)/gi,
    (m, fn, arg) => (/deg\b/i.test(arg) ? m : `${fn}(${arg} deg)`)
  );
}

// Evaluate a strict expression with mathjs (no AI)
function evalStrict(expr, angleMode) {
  let q = String(expr);
  if ((angleMode || "RAD") === "DEG") q = transformForDegrees(q);
  // ln(x) -> natural log in mathjs
  q = q.replace(/\bln\(/gi, "log(");
  const v = math.evaluate(q);
  return typeof v === "number" ? v : math.format(v);
}

// After removing allowed words, do we only have mathy chars?
function isLikelyMath(s) {
  const allowedWords = /(sin|cos|tan|log10|ln|exp|sqrt|pi|deg|rad|e)/gi;
  const stripped = s.replace(allowedWords, "");
  return /^[\s0-9+\-*/^().,eE]+$/.test(stripped);
}

// Try to strip leading English phrases while keeping operators & known funcs
function tryStripEnglish(s) {
  let t = s.replace(/[^0-9a-z+\-*/^().,\s]/gi, " "); // remove odd chars
  // Remove common lead-ins like "what is", "calculate", "compute", etc.
  t = t.replace(/\b(what\s+is|calculate|compute|please|solve|evaluate)\b/gi, " ");
  // Drop unknown words (keep digits and known function/units/consts)
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

    // 1) Fast path: the text is already math
    if (isLikelyMath(text)) {
      try {
        const result = evalStrict(text, angleMode || "RAD");
        return res.json({ result });
      } catch (e) {
        return res.status(400).json({ error: (e && e.message) || "Invalid expression" });
      }
    }

    // 2) Try stripping English and re-check
    const stripped = tryStripEnglish(text);
    if (stripped && isLikelyMath(stripped)) {
      try {
        const result = evalStrict(stripped, angleMode || "RAD");
        return res.json({ result, normalized: stripped });
      } catch (e) {
        // fall through to AI
      }
    }

    // 3) Natural language → normalize with AI, then evaluate locally
    const normalized = await normalizeWithAI(text);
    if (!normalized || typeof normalized !== "string") {
      return res.status(400).json({ error: "Normalization failed" });
    }

    try {
      const result = evalStrict(normalized, angleMode || "RAD");
      return res.json({ result, normalized });
    } catch (e) {
      return res.status(400).json({ error: (e && e.message) || "Invalid normalized expression", normalized });
    }
  } catch (err) {
    console.error("[/api/eval] Server error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = parseInt(process.env.PORT ?? "3001", 10);
app.listen(PORT, () => console.log(`AI eval server on http://localhost:${PORT}`));
