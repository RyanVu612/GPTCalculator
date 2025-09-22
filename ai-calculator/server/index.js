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

// Check if input looks like natural language that needs AI processing
function isNaturalLanguage(s) {
  // Words that suggest natural language math expressions
  const mathWords = /\b(plus|minus|times|divided|multiply|subtract|add|square|root|sine|cosine|tangent|log|logarithm|exponential|power|raised|to the|of|what|is|calculate|compute|solve|evaluate)\b/i;
  const numberWords = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/i;
  
  return mathWords.test(s) || numberWords.test(s);
}

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

  // ---- Parse and transform functions ----
  try {
    const ast = math.parse(s);
    const transformed = ast.transform((node) => {
      if (node.isFunctionNode && node.fn?.isSymbolNode) {
        // Transform single-argument log() to log10()
        if (node.fn.name === "log" && node.args.length === 1) {
          return new math.FunctionNode(new math.SymbolNode("log10"), node.args);
        }
        // Transform ln() to log() (natural log in mathjs)
        if (node.fn.name === "ln") {
          return new math.FunctionNode(new math.SymbolNode("log"), node.args);
        }
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
      // Round to 14 decimal places to eliminate floating point errors
      const rounded = Math.round(v * 1e14) / 1e14;
      return rounded;
    }

    throw new Error("Unsupported (non-real) result");
    
  } catch (parseError) {
    console.error("Parse/transform failed:", parseError);
    throw new Error("Invalid mathematical expression");
  }
}

// Improved: Try to strip English boilerplate but be more conservative
function tryStripEnglish(s) {
  // Only strip if we're confident this helps
  let t = s.replace(/\b(what\s+is|calculate|compute|please|solve|evaluate|the\s+answer\s+to)\b/gi, " ");
  
  // Don't strip number words or math operation words - let AI handle those
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// Enhanced AI normalization with better prompting
async function normalizeWithAI(nl) {
  const system = `You are a mathematical expression parser that converts natural language to exact mathematical notation.

CRITICAL: You must NEVER evaluate, solve, or simplify expressions. Only convert format.

Rules:
- Convert word numbers to digits: "five" → "5", "twenty" → "20", "one hundred" → "100"
- Convert operation words: "plus"/"add" → "+", "minus"/"subtract" → "-", "times"/"multiply" → "*", "divided by" → "/"
- Convert function words: "sine" → "sin", "cosine" → "cos", "tangent" → "tan", "square root" → "sqrt"
- Use only: numbers, +, -, *, /, ^, (), sin, cos, tan, log, log10, ln, exp, sqrt, pi, e, deg, rad, commas in functions
- "log" means base-10 logarithm, "ln" means natural logarithm
- For "log of X base Y" use "log(X, Y)"
- Preserve mathematical structure and parentheses

EXAMPLES - DO NOT EVALUATE:
Input: "five plus seven" → Output: "5 + 7" (NOT "12")
Input: "two times three minus four" → Output: "2 * 3 - 4" (NOT "2")
Input: "sine of thirty degrees" → Output: "sin(30)" (NOT "0.5")
Input: "square root of sixteen" → Output: "sqrt(16)" (NOT "4")
Input: "log of one hundred" → Output: "log(100)" (NOT "2")
Input: "natural log of e" → Output: "ln(e)" (NOT "1")
Input: "two raised to the power of three" → Output: "2 ^ 3" (NOT "8")

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
      response_format: { type: "json_object" },
      messages
    });
    const content = r.choices?.[0]?.message?.content ?? "";
    console.log("AI response:", content);
    
    const parsed = JSON.parse(content);
    const result = parsed?.expression;
    
    if (!result || typeof result !== "string") {
      throw new Error("Invalid AI response format");
    }
    
    return result;
  } catch (error) {
    console.error("AI normalization failed:", error);
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
    console.log("Processing expression:", text);

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

    // Special case: if input is "log(number, base)", handle it directly
    if (/^log\s*\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*\)$/i.test(text)) {
      console.log("Handling log(x,base) directly");
      try {
        const result = evalStrict(text, angleMode || "RAD");
        return res.json({ result, normalized: text });
      } catch (e) {
        return res.status(400).json({ error: e?.message || "Invalid expression" });
      }
    }

    // 1) If it looks like natural language, go straight to AI
    if (isNaturalLanguage(text)) {
      console.log("Detected natural language, using AI normalization");
      const normalized = await normalizeWithAI(text);
      console.log("AI normalized to:", normalized);
      
      if (!normalized || typeof normalized !== "string") {
        console.log("AI normalization failed");
        return res.status(400).json({ error: "Could not parse natural language expression" });
      }
      
      try {
        const result = evalStrict(normalized, angleMode || "RAD");
        console.log("AI evaluation result:", result);
        return res.json({ result, normalized });
      } catch (e) {
        console.log("AI evaluation failed:", e.message);
        return res.status(400).json({ 
          error: e?.message || "Invalid normalized expression", 
          normalized 
        });
      }
    }

    // 2) Already math? Only if it actually has an operator/function AND a digit/constant
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
    }

    // 3) Try minimal stripping and re-evaluate
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

    // 4) Final fallback: AI normalization
    console.log("Taking final AI normalization path");
    const normalized = await normalizeWithAI(text);
    console.log("AI normalized to:", normalized);
    
    if (!normalized || typeof normalized !== "string") {
      console.log("AI normalization failed");
      return res.status(400).json({ error: "Could not understand expression" });
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