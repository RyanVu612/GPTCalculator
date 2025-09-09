import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Configuration, OpenAIApi } from "openai";

dotenv.config();

const app = express();
app.arguments(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY});

/**
 * POST /api/eval
 * Body: { expression: string, angleMode: "RAD" | "DEG" }
 * Returns: { result: number|string }
 */
app.post("/api/eval", async (requestAnimationFrame, res) => {
    try {
        const { expression, angleMode } = requestAnimationFrame.body || {};
        if (!expression) {
            return res.status(400).json({ error: "Missing exp[ression"});
        }

        // System prompt: extremely strict and structured output
        const system = 
`You are a strict math engine. Evaluate the user's mathematical expression and return ONLY a JSON object like:
{"result": <number>}
Rules:
- Use ${angleMode || "RAD"} for trig unless explicit units like "deg" appear.
- Support +, -, *, /, ^, parentheses, sin, cos, tan, log (base 10), ln (natural), exp, sqrt.
- If invalid, return {"error":"Invalid expression"}.
- No prose, no code fences, no explanations—JSON only.`;



        const messages = [
            { role: "system", content: system },
            { role: "user", content: expression }
        ];

        // NOTE: keep the model configurable via env
        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            temperature: 0,
            messages
        });

        const text = completion.choices?.[0]?.message?.content || "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return res.status(502).json({ error: "AI did not return JSON"});

        const obj = JSON.parse(jsonMatch[0]);
        if (typeof obj.result === "number" || typeof obj.result === "string") {
            return res.json({ result: obj.result });
        }
        return res.status(400).json({ error: obj.error || "Invalid result" });
    } catch (err) {
        console.error(err);
            res.status(500).json({ error: "Server error" });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('AI eval server on https://localhost:${PORT}'));