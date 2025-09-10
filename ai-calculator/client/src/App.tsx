// src/App.tsx
import { useEffect, useRef, useState } from "react";
import { create, all } from "mathjs";

const math = create(all, { number: "number" });

type KeyDef = {
  label: string;
  k?: string;                 // value to insert (defaults to label)
  span?: 2 | 3 | 4;
  variant?: "num" | "op" | "fn" | "util" | "eq";
};

const MAIN_KEYS: KeyDef[] = [
  // Row 1
  { label: "AC", k: "[CLEAR]", variant: "util" },
  { label: "DEL", k: "[DEL]",  variant: "util" },
  { label: "(", variant: "op" },
  { label: ")", variant: "op" },
  // Row 2
  { label: "7", variant: "num" }, { label: "8", variant: "num" }, { label: "9", variant: "num" }, { label: "÷", k: "/", variant: "op" },
  // Row 3
  { label: "4", variant: "num" }, { label: "5", variant: "num" }, { label: "6", variant: "num" }, { label: "×", k: "*", variant: "op" },
  // Row 4
  { label: "1", variant: "num" }, { label: "2", variant: "num" }, { label: "3", variant: "num" }, { label: "−", k: "-", variant: "op" },
  // Row 5
  { label: "0", span: 2, variant: "num" }, { label: ".", variant: "num" }, { label: "=", k: "=", variant: "eq" },
];

const FN_KEYS: KeyDef[] = [
  { k: "sin(",  label: "sin",  variant: "fn" },
  { k: "cos(",  label: "cos",  variant: "fn" },
  { k: "tan(",  label: "tan",  variant: "fn" },
  { k: "log(",  label: "log",  variant: "fn" },
  { k: "ln(",   label: "ln",   variant: "fn" },
  { k: "exp(",  label: "exp",  variant: "fn" },
  { k: "sqrt(", label: "√",    variant: "fn" },
  { k: "^",     label: "x^y",  variant: "fn" },
];

export default function App() {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ in: string; out: string }>>([]);
  const [angleMode, setAngleMode] = useState<"RAD" | "DEG">("RAD");
  const [useAI, setUseAI] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- helpers ---------------------------------------------------------------

  // Add "deg" automatically in DEG mode for sin/cos/tan arguments
  const transformForDegrees = (s: string): string =>
    s.replace(
      /(sin|cos|tan)\(([^()]+)\)/g,
      (m: string, fn: string, arg: string): string => {
        if (/deg\b/i.test(arg)) return m;
        return `${fn}(${arg} deg)`;
      }
    );

  const safeEvalLocal = (s: string): number | string => {
    let q: string = s;
    if (angleMode === "DEG") q = transformForDegrees(q);

    // normalize ln(x) to log(x)
    q = q.replace(/\bln\(/g, "log(");

    const v = math.evaluate(q);
    return typeof v === "number" ? v : math.format(v as any);
  };

  // --- actions ---------------------------------------------------------------

  const handleEquals = async (): Promise<void> => {
    setError(null);
    setResult(null);
    const trimmed = expr.trim();
    if (!trimmed) return;

    try {
      if (useAI) {
        const r = await fetch("/api/eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expression: trimmed, angleMode }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || "AI evaluation failed");
        const out = String(data.result);
        setResult(out);
        setHistory(h => [{ in: trimmed, out }, ...h].slice(0, 20));
      } else {
        const v = safeEvalLocal(trimmed);
        const out = String(v);
        setResult(out);
        setHistory(h => [{ in: trimmed, out }, ...h].slice(0, 20));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void handleEquals(); }
    if (e.key === "Escape") { setExpr(""); setResult(null); setError(null); }
  };

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expr, useAI, angleMode]);

  const press = (k: string) => {
    if (k === "=") { void handleEquals(); return; }
    setExpr(prev => prev + k);
    inputRef.current?.focus();
  };

  const clearAll = () => { setExpr(""); setResult(null); setError(null); };
  const backspace = () => { setExpr(p => p.slice(0, -1)); };

  const handleKey = (def: KeyDef) => {
    const val = def.k ?? def.label;
    if (val === "[CLEAR]") return clearAll();
    if (val === "[DEL]")   return backspace();
    if (val === "=")       return void handleEquals();
    press(val);
  };

  // --- render ----------------------------------------------------------------

  return (
    <div style={{ padding: 16 }}>
      {/* Top bar (title + angle + AI) */}
      <div style={{ maxWidth: 380, margin: "0 auto 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ fontSize: 22, margin: 0, fontWeight: 700 }}>AI-Enhanced Calculator</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12 }}>Angle</label>
            <select
              value={angleMode}
              onChange={e => setAngleMode(e.target.value as "RAD" | "DEG")}
              aria-label="Angle mode"
            >
              <option value="RAD">RAD</option>
              <option value="DEG">DEG</option>
            </select>
            <label style={{ fontSize: 12 }}>AI</label>
            <input
              type="checkbox"
              checked={useAI}
              onChange={e => setUseAI(e.target.checked)}
              aria-label="Use AI for evaluation"
            />
          </div>
        </div>
      </div>

      {/* Calculator card */}
      <div className="calc-wrap">
        {/* Display */}
        <div className="calc-display">
          <div className="expr">{expr || "\u00A0"}</div>
          <div className="res">{error ? "Error" : (result ?? "\u00A0")}</div>
        </div>

        {/* Input row (optional manual typing) */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            ref={inputRef}
            value={expr}
            onChange={e => setExpr(e.target.value)}
            placeholder="Type an expression…"
            style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
        </div>

        {/* Function keys */}
        <div className="fn-grid">
          {FN_KEYS.map(def => (
            <button
              key={def.label}
              className="key fn"
              onClick={() => handleKey(def)}
            >
              {def.label}
            </button>
          ))}
        </div>

        {/* Main keypad */}
        <div className="main-grid">
          {MAIN_KEYS.map((def, idx) => (
            <button
              key={`${def.label}-${idx}`}
              className={`key ${def.variant || "num"} ${def.span === 2 ? "span-2" : ""}`}
              onClick={() => handleKey(def)}
            >
              {def.label}
            </button>
          ))}
        </div>

        {/* History */}
        <div style={{ marginTop: 12 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>History</h2>
          <ul style={{ maxHeight: 150, overflow: "auto", paddingRight: 4, margin: 0 }}>
            {history.length === 0 && (
              <li style={{ fontSize: 12, color: "#64748b", listStyle: "none" }}>No calculations yet.</li>
            )}
            {history.map((h, i) => (
              <li key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, marginBottom: 6, listStyle: "none" }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>{h.in}</div>
                <div style={{ textAlign: "right", fontWeight: 600 }}>= {h.out}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: 12, color: "#64748b", marginTop: 10 }}>
        Built with React • Local math via mathjs • Optional AI evaluation via OpenAI API
      </div>
    </div>
  );
}
