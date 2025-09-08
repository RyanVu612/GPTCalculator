import { useState, useMemo, useRef, useState } from 'react'
import { create, all } from 'mathjs'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'

const math = create(all, { number: "number"});

const KEYS = [
  "7", "8", "9", "/",
  "4", "5", "6", "*",
  "1", "2", "3", "-",
  "0", ".", "=", "+"
];

const FN_KEYS = [
  { k: "sin(", label: "sin" },
  { k: "cos(", label: "cos" },
  { k: "tan(", label: "tan" },
  { k: "^", label: "x^y" },
  { k: "log(", label: "log10" },
  { k: "ln(", label: "ln" },
  { k: "exp(", label: "exp" },
  { k: "sqrt(", label: "√" },
  { k: "(", label: "(" },
  { k: ")", label: ")" },
];

export default function App() {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ in: string; out: string }[]>([]);
  const [angleMode, setAngleMode] = useState<"RAD" | "DEG">("RAD");
  const [useAI, setUseAI] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Install degree support for mathjs: allow expressions like sin(30 deg)
  // In DEG mode, we automatically transform plain trig calls into unit form.
  const transformForDegrees = (s: string) => {
    // Wrap arguments to sin|cos|tan when not already using a unit.
    return s.replace(/(sin|cos|tan)\(([^()]+)\)/g, (m, fn, arg) => {
    // If "deg" is already present, leave as is
      if (/deg\b/i.test(arg)) return m;
      return `${fn}(${arg} deg)`;
    });
  };

  const safeEvalLocal = (s: string) => {
    // map caret to power for mathjs (it already supports ^)
    let q = s;
    if (angleMode === "DEG") q = transformForDegrees(q);

    // map ln(x) -> log(x, e) for clarity; mathjs supports log(x)
    q = q.replace(/\bln\(/g, "log(");

    // Evaluate
    const v = math.evaluate(q);
    if (typeof v === "number") return v;
    // For vectors/matrices or units, stringify
    return math.format(v);
  };

  const handleEquals = async () => {
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
    } catch (e:any) {
      setError(e?.message || String(e));
    }
  }
};

const onKey = (e: KeyboardEvent) => {
  if (e.key === "Enter") { e.preventDefault(); handleEquals();}
  if (e.key === "Escape") { setExpr(""); setResult(null); setError(null); }
};

useEffect(() => {
  window.addEventListener("keydown", onKey as any);
  return () => window.removeEventListener("keydown", onKey as any);
}, [expr, useAI, angleMode]);

const press = (k: string) => {
  if (k === "=") return handleEquals();
  setExpr(prev => prev + k);
  inputRef.current?.focus();
};

const clearAll = () => { setExpr(""); setResult(null); setError(null); };
const backspace = () => { setExpr(p => p.slice(0, -1)); };

return (
  <div className="min-h-screen bg-slate-50 text-slate-900 p-6">
    <div className="max-w-4xl mx-auto grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3 space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">AI-Enhanced Calculator</h1>
          <div className="flex items-center gap-2">
            <label className="text-sm">Angle</label>
            <select
              className="border rounded-md px-2 py-1 text-sm"
              value={angleMode}
              onChange={e => setAngleMode(e.target.value as any)}
              aria-label="Angle mode"
            >
              <option value="RAD">RAD</option>
              <option value="DEG">DEG</option>
            </select>
            <label className="text-sm ml-3">AI Eval</label>
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={useAI}
              onChange={e => setUseAI(e.target.checked)}
              aria-label="Use AI for evaluation"
            />
          </div>
        </header>

        <div className="bg-white rounded-2xl shadow p-4 space-y-3">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={expr}
              onChange={e => setExpr(e.target.value)}
              placeholder="Type an expression, e.g., sin(30) + 2^3 / 4"
              className="flex-1 border rounded-lg px-3 py-2 text-lg focus:outline-none focus:ring"
            />
            <button onClick={clearAll} className="px-3 py-2 rounded-lg border">C</button>
            <button onClick={backspace} className="px-3 py-2 rounded-lg border">DEL</button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {KEYS.map(k => (
              <button key={k} onClick={() => press(k)}
                className={`py-3 rounded-xl border shadow-sm hover:shadow ${k === "=" ? "col-span-1 bg-slate-900 text-white" : "bg-white"}`}>
                {k}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-2">
            {FN_KEYS.map(({ k, label }) => (
              <button key={label} onClick={() => press(k)} className="py-2 text-sm rounded-xl border shadow-sm bg-white hover:shadow">
                {label}
              </button>
            ))}
          </div>

          <div>
            {error && (
              <div className="text-red-600 text-sm">{error}</div>
            )}
            {result && (
              <div className="text-green-700 text-lg font-medium">= {result}</div>
            )}
          </div>
        </div>
      </div>

      <aside className="md:col-span-2">
        <div className="bg-white rounded-2xl shadow p-4 h-full">
          <h2 className="font-semibold mb-3">History</h2>
          <ul className="space-y-2 max-h-[520px] overflow-auto pr-1">
            {history.length === 0 && (
              <li className="text-sm text-slate-500">No calculations yet.</li>
            )}
            {history.map((h, i) => (
              <li key={i} className="border rounded-lg p-2">
                <div className="text-xs text-slate-500">{h.in}</div>
                <div className="text-right font-medium">= {h.out}</div>
              </li>
            ))}
          </ul>
          <div className="text-xs text-slate-500 mt-4 space-y-1">
            <p><strong>Tips</strong></p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Use ^ for powers: <code>2^8</code></li>
              <li>Trig defaults to radians. Switch to DEG or type <code>sin(30 deg)</code></li>
              <li>Common functions: <code>sin</code>, <code>cos</code>, <code>tan</code>, <code>log</code> (base 10), <code>ln</code> (natural), <code>exp</code>, <code>sqrt</code></li>
              <li>Press Enter to evaluate</li>
            </ul>
          </div>
        </div>
      </aside>
    </div>

    <footer className="text-center text-xs text-slate-500 mt-6">
      Built with React • Local math via mathjs • Optional AI evaluation via OpenAI API
    </footer>
  </div>
)
