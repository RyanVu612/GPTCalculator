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

// Strict evaluator with mathjs + angle mode
// Fixed evaluator with mathjs + angle mode
function evalStrict(expr, angleMode = "RAD") {
  // Allow only the tokens you said were allowed
  const ALLOWED = /^(?:[0-9]+(?:\.[0-9]+)?|pi|e|sin|cos|tan|log10|log|ln|exp|sqrt|\+|\-|\*|\/|\^|\(|\)|,|\s|deg|rad)+$/i;
  if (!ALLOWED.test(expr)) {
    throw new Error("Expression contains disallowed tokens");
  }

  // Normalize constants / units casing
  let s = expr
    .replace(/\bPI\b/gi, "pi")
    .replace(/\bE\b/g, "e")
    .replace(/\bRAD\b/gi, "rad")
    .replace(/\bDEG\b/gi, "deg");

  // Handle explicit "30 deg" or "1.2 rad"
  s = s.replace(/(\d+(?:\.\d+)?)\s*deg\b/gi, "($1 * pi / 180)");
  s = s.replace(/(\d+(?:\.\d+)?)\s*rad\b/gi, "($1)");

  // If angleMode is DEG, wrap sin/cos/tan arguments with deg->rad conversion
  if (/^DEG$/i.test(angleMode)) {
    s = s
      .replace(/\bsin\s*\(([^)]+)\)/gi, "sin(($1) * pi / 180)")
      .replace(/\bcos\s*\(([^)]+)\)/gi, "cos(($1) * pi / 180)")
      .replace(/\btan\s*\(([^)]+)\)/gi, "tan(($1) * pi / 180)");
  }

  // ln(x) -> natural log for mathjs (which is log(x))
  s = s.replace(/\bln\s*\(/gi, "log(");

  // ---- Parse and transform log() -> log10() ----
  try {
    const ast = math.parse(s);
    const transformed = ast.transform((node) => {
      // If it's a function call named "log" with exactly ONE argument, rewrite to log10(arg)
      if (node.isFunctionNode &&
          node.fn?.isSymbolNode &&
          node.fn.name === "log" &&
          node.args.length === 1) {
        // Create new log10 function node
        return new math.FunctionNode(new math.SymbolNode("log10"), node.args);
      }
      return node;
    });

    const v = transformed.evaluate();

    // Guard: user typed a bare function like "log10" or "ln"
    if (typeof v === "function") {
      throw new Error("Function name without argument. Try: log10(100) or ln(2.5)");
    }

    // Only allow real, finite numbers as results
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("Non-finite result");
      return v;
    }

    throw new Error("Unsupported (non-real) result");
    
  } catch (parseError) {
    // If parsing fails, try direct evaluation as fallback
    console.error("Parse/transform failed, trying direct eval:", parseError);
    const v = math.evaluate(s);
    
    if (typeof v === "function") {
      throw new Error("Function name without argument. Try: log10(100) or ln(2.5)");
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("Non-finite result");
      return v;
    }
    throw new Error("Unsupported result type");
  }
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
// Normalize NL → strict expression via AI
// Normalize NL → strict expression via AI
async function normalizeWithAI(nl) {
  const system = `You are a mathematical expression parser that converts text to exact mathematical notation.

CRITICAL: You must NEVER evaluate, solve, or simplify expressions. Only convert format.

Rules:
- Preserve ALL mathematical functions exactly as function calls
- Use only: numbers, +, -, *, /, ^, (), sin, cos, tan, log, log10, ln, exp, sqrt, pi, e, deg, rad
- Convert word numbers to digits ("three" → "3")
- "log" means base-10 logarithm

EXAMPLES - DO NOT EVALUATE:
Input: "log(100)" → Output: "log(100)" (NOT "2" or "(100)")
Input: "log of 100" → Output: "log(100)" (NOT "2" or "(100)")  
Input: "sine of 30" → Output: "sin(30)" (NOT "0.5")
Input: "square root of 16" → Output: "sqrt(16)" (NOT "4")
Input: "two plus three" → Output: "2 + 3" (NOT "5")

If the input is already valid math notation, return it unchanged.

Return ONLY JSON: {"expression": "exact_math_notation"}`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: nl }
  ];

  try {
    const r = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: "json_object",
      messages
    });
    const content = r.choices?.[0]?.message?.content ?? "";
    const result = JSON.parse(content)?.expression;
    
    // Validation: If input contained "log" and output doesn't, something went wrong
    if (nl.toLowerCase().includes('log') && !result?.toLowerCase().includes('log')) {
      console.warn(`AI normalization error: "${nl}" → "${result}"`);
      // Try to fix common mistakes
      if (nl.match(/log\s*\(\s*(\d+)\s*\)/i)) {
        const num = nl.match(/log\s*\(\s*(\d+)\s*\)/i)[1];
        return `log(${num})`;
      }
      if (nl.match(/log\s+(?:of\s+)?(\d+)/i)) {
        const num = nl.match(/log\s+(?:of\s+)?(\d+)/i)[1];
        return `log(${num})`;
      }
    }
    
    return result;
  } catch (error) {
    console.error("AI normalization failed:", error);
    // Fallback: if input looks like it's already math, return as-is
    if (isLikelyMath(nl)) {
      return nl;
    }
    return null;
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

    // Special case: if input is exactly "log(number)", handle it directly
    if (/^log\s*\(\s*\d+(?:\.\d+)?\s*\)$/i.test(text)) {
      console.log("Handling log() directly");
      try {
        const result = evalStrict(text, angleMode || "RAD");
        return res.json({ result, normalized: text });
      } catch (e) {
        return res.status(400).json({ error: e?.message || "Invalid expression" });
      }
    }

    // 1) Already math? Only if it actually has an operator/function AND a digit/constant
    if (isLikelyMath(text) && hasOpOrFunc(text) && hasDigitOrConst(text)) {
      console.log("Taking 'already math' path");
      try {
        const result = evalStrict(text, angleMode || "RAD");
        console.log("Direct evaluation result:", result);
        return res.json({ result, normalized: text });
      } catch (e) {
        console.log("Direct evaluation failed:", e.message);
        console.log("Falling through to AI normalization");
      }
    } else {
      console.log("Not taking 'already math' path");
    }

    // 2) Try stripping boilerplate; still require operator/function
    const stripped = tryStripEnglish(text);
    console.log("Stripped version:", stripped);
    if (
      stripped &&
      stripped !== text &&
      isLikelyMath(stripped) &&
      hasOpOrFunc(stripped) &&
      hasDigitOrConst(stripped)
    ) {
      console.log("Taking 'stripped English' path");
      try {
        const result = evalStrict(stripped, angleMode || "RAD");
        console.log("Stripped evaluation result:", result);
        return res.json({ result, normalized: stripped });
      } catch (e) {
        console.log("Stripped evaluation failed:", e.message);
      }
    }

    // 3) AI normalization
    console.log("Taking AI normalization path");
    const normalized = await normalizeWithAI(text);
    console.log("AI normalized to:", normalized);
    
    if (!normalized || typeof normalized !== "string") {
      console.log("AI normalization failed");
      return res.status(400).json({ error: "Normalization failed" });
    }
    
    try {
      const result = evalStrict(normalized, angleMode || "RAD");
      console.log("Final evaluation result:", result);
      return res.json({ result, normalized });
    } catch (e) {
      console.log("Final evaluation failed:", e.message);
      return res.status(400).json({ 
        error: e?.message || "Invalid normalized expression", 
        normalized 
      });
    }
  } catch (err) {
    console.error("[/api/eval] Server error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = parseInt(process.env.PORT ?? "3001", 10);
app.listen(PORT, () => console.log(`AI eval server on http://localhost:${PORT}`));
