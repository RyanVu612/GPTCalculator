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
  { label: "0", span: 2, variant: "num" }, { label: ".", variant: "num" }, { label: "+", k: "+", variant: "op" },
  // Row 6 (full-width equals)
  { label: "=", k: "=", variant: "eq", span: 4 },
];

const FN_KEYS: KeyDef[] = [
  { k: "sin(",  label: "sin",  variant: "fn" },
  { k: "cos(",  label: "cos",  variant: "fn" },
  { k: "tan(",  label: "tan",  variant: "fn" },
  { k: "log(",  label: "log",  variant: "fn" }, // <- now defaults to base 10
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
  const [showHelp, setShowHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---------- helpers ----------
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
    
    // Transform log() to log10() and ln() to natural log (which is log() in mathjs)
    // First handle ln() -> log() for natural log
    q = q.replace(/\bln\(/g, "log(");
    
    // Then parse and transform single-argument log() to log10()
    const ast = math.parse(q);
    const transformed = ast.transform((node: any) => {
      // If it's a function call named "log" with exactly ONE argument, rewrite to log10(arg)
      if (node.isFunctionNode &&
          node.fn?.isSymbolNode &&
          node.fn.name === "log" &&
          node.args.length === 1) {
        return new math.FunctionNode(new math.SymbolNode("log10"), node.args);
      }
      return node;
    });
    
    const v = transformed.evaluate();

    if (typeof v === "function") {
      // User entered a bare function name like "log10" or "ln"
      throw new Error("Finish the function call, e.g., log10(100) or ln(2.5)");
    }

    return typeof v === "number" ? v : math.format(v as any);
  };

  // ---------- actions ----------
  const handleEquals = async (): Promise<void> => {
    setError(null);
    setResult(null);
    const trimmed = expr.trim();
    const looksIncomplete = /\b(sin|cos|tan|log10|ln|exp|sqrt)\s*$/i.test(trimmed) || /\(\s*$/.test(trimmed);

    if (looksIncomplete) {
      setError("Finish the function call, e.g., log10(100)");
      return;
    }

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

  const keyStyle = (variant?: KeyDef["variant"]): React.CSSProperties => {
    const baseStyle = {
      padding: "14px 8px",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      borderRadius: 16,
      fontSize: 18,
      fontWeight: 600,
      cursor: "pointer" as const,
      transition: "all 0.2s ease",
      backdropFilter: "blur(10px)",
      boxShadow: "0 4px 15px rgba(0,0,0,.2), 0 2px 8px rgba(255,255,255,.1) inset",
      userSelect: "none" as const,
    };

    // All colored buttons now use the same blue gradient
    const blueGradientStyle = {
      background: "linear-gradient(135deg, #74b9ff 0%, #00cec9 100%)",
      color: "white",
      textShadow: "0 1px 2px rgba(0,0,0,0.2)"
    };

    switch (variant) {
      case "op":   
        return { 
          ...baseStyle, 
          ...blueGradientStyle
        };
      case "fn":   
        return { 
          ...baseStyle, 
          ...blueGradientStyle,
          fontSize: 16,
          padding: "12px 6px",
        };
      case "util": 
        return { 
          ...baseStyle, 
          ...blueGradientStyle
        };
      case "eq":   
        return { 
          ...baseStyle, 
          ...blueGradientStyle,
          fontSize: 20,
          fontWeight: 700,
          textShadow: "0 2px 4px rgba(0,0,0,0.3)",
          boxShadow: "0 6px 20px rgba(116, 185, 255, 0.4), 0 2px 8px rgba(255,255,255,.2) inset"
        };
      default:     
        return {
          ...baseStyle,
          background: "linear-gradient(135deg, rgba(70, 70, 110, 0.9) 0%, rgba(55, 55, 95, 0.95) 100%)",
          color: "#ffffff",
        };
    }
  };

  // ---------- render ----------
  return (
    <div style={{
      padding: 20,
      minHeight: "100vh",
      background: "linear-gradient(135deg, #ffeaa7 0%, #fab1a0 25%, #fd79a8 50%, #e84393 75%, #6c5ce7 100%)",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      display: "flex",
      gap: 20
    }}>
      {/* Help Menu Sidebar */}
      {showHelp && (
        <div style={{
          width: 350,
          background: "rgba(25, 25, 45, 0.95)",
          backdropFilter: "blur(30px)",
          borderRadius: 20,
          padding: 24,
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: "0 20px 60px rgba(0,0,0,.3), 0 4px 15px rgba(255,255,255,.05) inset",
          color: "white",
          maxHeight: "90vh",
          overflowY: "auto"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#74b9ff" }}>
              🧮 Input Guide
            </h2>
            <button
              onClick={() => setShowHelp(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255, 255, 255, 0.7)",
                cursor: "pointer",
                padding: 4,
                fontSize: 18
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            <section style={{ marginBottom: 20 }}>
              <h3 style={{ color: "#00cec9", fontSize: 16, marginBottom: 10 }}>📊 Basic Operations</h3>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>2 + 3</code> → Addition
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>5 - 2</code> → Subtraction
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>4 * 6</code> → Multiplication
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>8 / 2</code> → Division
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)" }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>3 ^ 2</code> → Power (3²)
              </div>
            </section>

            <section style={{ marginBottom: 20 }}>
              <h3 style={{ color: "#00cec9", fontSize: 16, marginBottom: 10 }}>🔢 Functions</h3>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>sin(30)</code> → Sine function
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>cos(45)</code> → Cosine function
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>tan(60)</code> → Tangent function
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>sqrt(16)</code> → Square root
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>ln(2.5)</code> → Natural log
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>log(100)</code> → Base-10 log (=2)
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>log10(100)</code> → Base-10 log (explicit)
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)" }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>exp(1)</code> → Exponential (e^x)
              </div>
            </section>

            <section style={{ marginBottom: 20 }}>
              <h3 style={{ color: "#00cec9", fontSize: 16, marginBottom: 10 }}>📐 Constants & Units</h3>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>pi</code> → π (3.14159...)
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>e</code> → Euler's number (2.718...)
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>30 deg</code> → 30 degrees
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)" }}>
                <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "2px 6px", borderRadius: 4 }}>1.5 rad</code> → 1.5 radians
              </div>
            </section>

            <section style={{ marginBottom: 20 }}>
              <h3 style={{ color: "#00cec9", fontSize: 16, marginBottom: 10 }}>🤖 AI Mode Examples</h3>
              <p style={{ color: "rgba(255, 255, 255, 0.8)", marginBottom: 12 }}>
                When AI is enabled, you can use natural language:
              </p>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                "What is the sine of thirty degrees?"
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                "Calculate square root of twenty five"
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                "Two plus three times four"
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)" }}>
                "Log base ten of one hundred"
              </div>
            </section>

            <section style={{ marginBottom: 20 }}>
              <h3 style={{ color: "#00cec9", fontSize: 16, marginBottom: 10 }}>⚠️ Important Notes</h3>
              <ul style={{ color: "rgba(255, 255, 255, 0.8)", paddingLeft: 20 }}>
                <li style={{ marginBottom: 8 }}>Always complete function calls: <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "1px 4px", borderRadius: 3 }}>sin(30)</code>, not just <code style={{ background: "rgba(255, 107, 107, 0.2)", padding: "1px 4px", borderRadius: 3 }}>sin</code></li>
                <li style={{ marginBottom: 8 }}>Use parentheses to group operations: <code style={{ background: "rgba(116, 185, 255, 0.2)", padding: "1px 4px", borderRadius: 3 }}>(2 + 3) * 4</code></li>
                <li style={{ marginBottom: 8 }}>Switch angle mode (RAD/DEG) in top controls</li>
                <li>Enable AI for natural language input parsing</li>
              </ul>
            </section>

            <section>
              <h3 style={{ color: "#00cec9", fontSize: 16, marginBottom: 10 }}>⌨️ Shortcuts</h3>
              <div style={{ color: "rgba(255, 255, 255, 0.9)", marginBottom: 8 }}>
                <kbd style={{ background: "rgba(70, 70, 110, 0.8)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>Enter</kbd> → Calculate
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.9)" }}>
                <kbd style={{ background: "rgba(70, 70, 110, 0.8)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>Escape</kbd> → Clear all
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Main Calculator */}
      <div style={{ flex: 1 }}>
        {/* Top bar */}
        <div style={{
          maxWidth: 400, 
          margin: "0 auto 20px",
          background: "rgba(25, 25, 45, 0.9)",
          backdropFilter: "blur(30px)",
          borderRadius: 20,
          padding: 16,
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: "0 20px 60px rgba(0,0,0,.3), 0 4px 15px rgba(255,255,255,.05) inset",
        }}>
          <div style={{
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center" 
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1 style={{
                fontSize: 26, 
                margin: 0, 
                fontWeight: 700,
                color: "white",
                textShadow: "0 2px 10px rgba(0, 0, 0, 0.3)"
              }}>
                AI Calculator
              </h1>
              <button
                onClick={() => setShowHelp(!showHelp)}
                style={{
                  background: showHelp 
                    ? "linear-gradient(135deg, #74b9ff 0%, #00cec9 100%)" 
                    : "rgba(70, 70, 110, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  borderRadius: 8,
                  padding: "6px 8px",
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  transition: "all 0.2s ease",
                  fontSize: 14
                }}
                title="Show/Hide Help"
              >
                ❓
              </button>
            </div>
            <div style={{
              display: "flex", 
              alignItems: "center", 
              gap: 12,
              color: "white"
            }}>
              <label style={{ fontSize: 14, fontWeight: 600 }}>Angle</label>
              <select
                value={angleMode}
                onChange={e => setAngleMode(e.target.value as "RAD" | "DEG")}
                aria-label="Angle mode"
                style={{
                  background: "rgba(70, 70, 110, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  borderRadius: 8,
                  padding: "4px 8px",
                  color: "white",
                  fontSize: 12
                }}
              >
                <option value="RAD" style={{ color: "white", background: "rgba(70, 70, 110, 0.9)" }}>RAD</option>
                <option value="DEG" style={{ color: "white", background: "rgba(70, 70, 110, 0.9)" }}>DEG</option>
              </select>
              <label style={{ fontSize: 14, fontWeight: 600 }}>AI</label>
              <input
                type="checkbox"
                checked={useAI}
                onChange={e => setUseAI(e.target.checked)}
                aria-label="Use AI for evaluation"
                style={{
                  transform: "scale(1.2)",
                  accentColor: "#74b9ff"
                }}
              />
            </div>
          </div>
        </div>

        {/* Calculator card */}
        <div style={{
          maxWidth: 400,
          margin: "0 auto",
          background: "rgba(25, 25, 45, 0.9)",
          backdropFilter: "blur(30px)",
          borderRadius: 28,
          boxShadow: "0 20px 60px rgba(0,0,0,.3), 0 4px 15px rgba(255,255,255,.05) inset",
          padding: 24,
          border: "1px solid rgba(255, 255, 255, 0.1)",
        }}>
          {/* Display */}
          <div style={{
            background: "linear-gradient(135deg, rgba(35, 35, 65, 0.95) 0%, rgba(45, 45, 75, 0.9) 100%)",
            backdropFilter: "blur(20px)",
            color: "#ffffff",
            borderRadius: 20,
            padding: 16,
            marginBottom: 16,
            border: "1px solid rgba(255, 255, 255, 0.15)",
            boxShadow: "0 8px 32px rgba(0,0,0,.3)"
          }}>
            <div style={{
              fontSize: 14,
              color: "rgba(255, 255, 255, 0.7)",
              minHeight: 18,
              textAlign: "right",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 500
            }}>
              {expr || "\u00A0"}
            </div>
            <div style={{
              fontSize: 32,
              fontWeight: 700,
              textAlign: "right",
              minHeight: 45,
              color: "#ffffff"
            }}>
              {error ? "Error" : (result ?? "\u00A0")}
            </div>
          </div>

          {/* Input row */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input
              ref={inputRef}
              value={expr}
              onChange={e => setExpr(e.target.value)}
              placeholder="Enter expression or natural language"
              style={{
                flex: 1, 
                padding: "14px 16px", 
                borderRadius: 16, 
                border: "1px solid rgba(255, 255, 255, 0.15)",
                background: "rgba(35, 35, 65, 0.8)",
                backdropFilter: "blur(10px)",
                color: "#ffffff",
                fontSize: 16,
                fontWeight: 500,
              }}
            />
          </div>

          {/* Function keys */}
          <div style={{
            display: "grid", 
            gridTemplateColumns: "repeat(4, 1fr)", 
            gap: 10, 
            marginBottom: 16 
          }}>
            {FN_KEYS.map(def => (
              <button
                key={def.label}
                style={keyStyle(def.variant)}
                onClick={() => handleKey(def)}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 6px 20px rgba(116, 185, 255, 0.5), 0 2px 8px rgba(255,255,255,.15) inset";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 4px 15px rgba(0,0,0,.2), 0 2px 8px rgba(255,255,255,.1) inset";
                }}
              >
                {def.label}
              </button>
            ))}
          </div>

          {/* Main keypad */}
          <div style={{
            display: "grid", 
            gridTemplateColumns: "repeat(4, 1fr)", 
            gap: 10 
          }}>
            {MAIN_KEYS.map((def, idx) => (
              <button
                key={`${def.label}-${idx}`}
                style={{
                  ...keyStyle(def.variant),
                  ...(def.span ? { gridColumn: `span ${def.span}` } : null)
                }}
                onClick={() => handleKey(def)}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  if (def.variant === "eq") {
                    e.currentTarget.style.boxShadow = "0 8px 25px rgba(116, 185, 255, 0.6), 0 2px 8px rgba(255,255,255,.3) inset";
                  } else if (def.variant === "num") {
                    e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,.3), 0 2px 8px rgba(255,255,255,.15) inset";
                  } else {
                    e.currentTarget.style.boxShadow = "0 6px 20px rgba(116, 185, 255, 0.5), 0 2px 8px rgba(255,255,255,.15) inset";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "translateY(0)";
                  if (def.variant === "eq") {
                    e.currentTarget.style.boxShadow = "0 6px 20px rgba(116, 185, 255, 0.4), 0 2px 8px rgba(255,255,255,.2) inset";
                  } else if (def.variant === "num") {
                    e.currentTarget.style.boxShadow = "0 4px 15px rgba(0,0,0,.2), 0 2px 8px rgba(255,255,255,.1) inset";
                  } else {
                    e.currentTarget.style.boxShadow = "0 4px 15px rgba(0,0,0,.2), 0 2px 8px rgba(255,255,255,.1) inset";
                  }
                }}
              >
                {def.label}
              </button>
            ))}
          </div>

          {/* History */}
          <div style={{ marginTop: 20 }}>
            <h2 style={{
              fontSize: 16, 
              fontWeight: 700, 
              marginBottom: 12,
              color: "white",
              textShadow: "0 1px 3px rgba(0,0,0,0.2)"
            }}>
              🌅 History
            </h2>
            <ul style={{
              maxHeight: 180, 
              overflow: "auto", 
              paddingRight: 8, 
              margin: 0
            }}>
              {history.length === 0 && (
                <li style={{ 
                  fontSize: 14, 
                  color: "rgba(255, 255, 255, 0.7)", 
                  listStyle: "none",
                  textAlign: "center",
                  padding: 16,
                  fontStyle: "italic"
                }}>
                  No calculations yet... start creating magic! ✨
                </li>
              )}
              {history.map((h, i) => (
                <li key={i} style={{
                  background: "rgba(55, 55, 95, 0.6)",
                  backdropFilter: "blur(10px)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 8,
                  listStyle: "none"
                }}>
                  <div style={{
                    fontSize: 13, 
                    color: "rgba(255, 255, 255, 0.8)",
                    fontWeight: 500
                  }}>
                    {h.in}
                  </div>
                  <div style={{
                    textAlign: "right", 
                    fontWeight: 700,
                    color: "white",
                    textShadow: "0 1px 2px rgba(0,0,0,0.2)"
                  }}>
                    = {h.out}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div style={{
          textAlign: "center", 
          fontSize: 13, 
          color: "rgba(255, 255, 255, 0.8)", 
          marginTop: 20,
          textShadow: "0 1px 2px rgba(0,0,0,0.2)"
        }}>
          Built with love 💕 • Powered by React & dreams • Math magic via mathjs
        </div>
      </div>
    </div>
  );
}