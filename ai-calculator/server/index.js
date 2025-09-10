// server/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/api/eval", async (req, res) => {
  try {
    const { expression, angleMode } = req.body ?? {};
    if (typeof expression !== "string" || !expression.trim()) {
      return res.status(400).json({ error: "Missing expression" });
    }

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const system = `You are a strict math engine. Return ONLY JSON:
{"result": <number>}
Rules:
- Use ${angleMode || "RAD"} for trig unless explicit "deg" units appear.
- Support +, -, *, /, ^, parentheses, sin, cos, tan, log10 (base 10), ln (natural), exp, sqrt.
- If invalid, return {"error":"Invalid expression"}.
- No prose, no code fences, no explanations—JSON only.`;

    const messages = [
      { role: "system", content: system },
      { role: "user", content: expression }
    ];

    let content;
    try {
      // Preferred: ask for JSON
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages
      });
      content = completion.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      // Fallback if response_format isn't supported on your model/org
      console.warn("[AI fallback] response_format not accepted or other error:", e?.message);
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0,
        messages
      });
      content = completion.choices?.[0]?.message?.content ?? "";
    }

    let obj;
    try {
      obj = JSON.parse(content);
    } catch {
      return res.status(502).json({ error: "Bad JSON from AI", raw: content });
    }

    if (typeof obj.result === "number" || typeof obj.result === "string") {
      return res.json({ result: obj.result });
    }
    return res.status(400).json({ error: obj.error || "Invalid result", raw: content });
  } catch (err) {
    console.error("[/api/eval] Server error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = parseInt(process.env.PORT ?? "3001", 10);
app.listen(PORT, () => console.log(`AI eval server on http://localhost:${PORT}`));
