"use client";

import { useCallback, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppState = "idle" | "uploading" | "running" | "done" | "error";

interface AgentStep {
  id: string;
  step: string;
  message: string;
  ts: number;
}

interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  ts: number;
}

interface ReproResult {
  paper_result?: string;
  reproduced_result?: string;
  paper_value?: number;
  reproduced_value?: number;
  direction_match?: boolean;
  significance_match?: boolean;
  effect_size_within_tolerance?: boolean;
  reproducibility_score?: number;
  verdict?: string;
  explanation?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<string, string> = {
  reading_paper: "Reading paper",
  inspecting_data: "Inspecting dataset",
  extracting_method: "Extracting methods",
  building_model: "Building model",
  running_analysis: "Running analysis",
  checking_discrepancy: "Checking discrepancy",
  revising_analysis: "Revising analysis",
  final_analysis: "Re-running model",
};

function scoreColor(score: number): string {
  if (score >= 85) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

function verdictBadge(verdict: string): { bg: string; text: string } {
  if (verdict === "Reproduced") return { bg: "#dcfce7", text: "#166534" };
  if (verdict === "Partially Reproduced") return { bg: "#fef9c3", text: "#854d0e" };
  return { bg: "#fee2e2", text: "#991b1b" };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function UploadCard({
  label,
  accept,
  file,
  onFile,
  icon,
}: {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File) => void;
  icon: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile]
  );

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 cursor-pointer transition-all duration-200 ${
        drag
          ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30"
          : file
          ? "border-indigo-300 bg-indigo-50/60 dark:bg-indigo-950/20"
          : "border-zinc-200 bg-zinc-50 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-indigo-500"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => ref.current?.click()}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <div className="text-3xl">{icon}</div>
      {file ? (
        <>
          <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 text-center">{file.name}</p>
          <p className="text-xs text-zinc-400">{(file.size / 1024).toFixed(1)} KB · click to change</p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{label}</p>
          <p className="text-xs text-zinc-400">Drag & drop or click</p>
        </>
      )}
    </div>
  );
}

function StepRow({ step, isLast }: { step: AgentStep; isLast: boolean }) {
  const label = STEP_LABELS[step.step] ?? step.step.replace(/_/g, " ");
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-3 h-3 rounded-full bg-indigo-500 mt-1 flex-shrink-0 ring-4 ring-indigo-100 dark:ring-indigo-950" />
        {!isLast && <div className="w-px flex-1 bg-zinc-200 dark:bg-zinc-700 mt-1" />}
      </div>
      <div className="pb-4 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-500 mb-0.5">{label}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{step.message}</p>
      </div>
    </div>
  );
}

function ToolCallRow({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden text-xs font-mono">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-violet-500">⚙</span>
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">{tc.tool}</span>
        <span className="ml-auto text-zinc-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 bg-white dark:bg-zinc-900 space-y-2">
          <div>
            <p className="text-zinc-400 mb-1">Args</p>
            <pre className="text-[11px] bg-zinc-50 dark:bg-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(
                Object.fromEntries(Object.entries(tc.args).filter(([k]) => k !== "csv_bytes")),
                null,
                2
              )}
            </pre>
          </div>
          {tc.result && (
            <div>
              <p className="text-zinc-400 mb-1">Result</p>
              <pre className="text-[11px] bg-zinc-50 dark:bg-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(tc.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
        <text x="60" y="65" textAnchor="middle" fontSize="22" fontWeight="bold" fill={color}>
          {score}
        </text>
      </svg>
      <p className="text-xs text-zinc-500">/ 100</p>
    </div>
  );
}

function CheckRow({ label, value }: { label: string; value: boolean | undefined }) {
  if (value === undefined) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={value ? "text-green-500" : "text-red-400"}>{value ? "✓" : "✗"}</span>
      <span className={value ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400"}>{label}</span>
    </div>
  );
}

function ResultPanel({ result }: { result: ReproResult }) {
  const score = result.reproducibility_score ?? 0;
  const verdict = result.verdict ?? "Unknown";
  const badge = verdictBadge(verdict);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-3">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">Reproducibility Report</h2>
        <span
          className="ml-auto px-3 py-1 rounded-full text-xs font-bold"
          style={{ background: badge.bg, color: badge.text }}
        >
          {verdict}
        </span>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Score */}
        <div className="flex flex-col items-center justify-center gap-2">
          <ScoreGauge score={score} />
          <p className="text-xs text-zinc-500 text-center font-medium">Reproducibility Score</p>
        </div>

        {/* Comparison */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Result Comparison</h3>
          <div className="space-y-2">
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
              <p className="text-[10px] text-zinc-400 uppercase font-semibold mb-1">Paper reports</p>
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{result.paper_result ?? "—"}</p>
            </div>
            <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/30 p-3">
              <p className="text-[10px] text-indigo-400 uppercase font-semibold mb-1">Reproduced</p>
              <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">{result.reproduced_result ?? "—"}</p>
            </div>
          </div>
        </div>

        {/* Checks */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Criteria</h3>
          <div className="space-y-2">
            <CheckRow label="Direction matches" value={result.direction_match} />
            <CheckRow label="Significance matches" value={result.significance_match} />
            <CheckRow label="Effect size within 10%" value={result.effect_size_within_tolerance} />
          </div>
        </div>
      </div>

      {result.explanation && (
        <div className="px-6 pb-6">
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Agent Explanation</p>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{result.explanation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Home() {
  const [paper, setPaper] = useState<File | null>(null);
  const [dataset, setDataset] = useState<File | null>(null);
  const [appState, setAppState] = useState<AppState>("idle");
  const [mode, setMode] = useState<"mock" | "live" | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [result, setResult] = useState<ReproResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const canRun = paper && dataset && (appState === "idle" || appState === "done" || appState === "error");
  const canDemo = appState === "idle" || appState === "done" || appState === "error";

  // Shared SSE consumer — called by both handleRun and handleDemo
  const processStream = async (resp: Response) => {
    setAppState("running");

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data: ")) continue;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        const type = evt.type as string;
        if (type === "mode") {
          setMode(evt.value as "mock" | "live");
        } else if (type === "step" || type === "status") {
          const step: AgentStep = {
            id: `${Date.now()}-${Math.random()}`,
            step: (evt.step as string) ?? "status",
            message: (evt.message as string) ?? "",
            ts: Date.now(),
          };
          setSteps((s) => [...s, step]);
          setTimeout(() => timelineRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 50);
        } else if (type === "tool_call") {
          const tc: ToolCall = {
            id: `tc-${Date.now()}-${Math.random()}`,
            tool: evt.tool as string,
            args: (evt.args as Record<string, unknown>) ?? {},
            ts: Date.now(),
          };
          setToolCalls((prev) => [...prev, tc]);
        } else if (type === "tool_result") {
          const tool = evt.tool as string;
          setToolCalls((prev) => {
            const idx = [...prev].reverse().findIndex((t) => t.tool === tool && !t.result);
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            const next = [...prev];
            next[realIdx] = { ...next[realIdx], result: evt.result as Record<string, unknown> };
            return next;
          });
        } else if (type === "result") {
          setResult(evt as ReproResult);
        } else if (type === "done") {
          setAppState("done");
        }
      }
    }
  };

  const handleDemo = async () => {
    setAppState("uploading");
    setSteps([]);
    setToolCalls([]);
    setResult(null);
    setError(null);
    setMode(null);

    // Minimal synthetic PDF + CSV for demo
    const pdfContent = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF`;
    const csvContent = "age,sex,exposure,event\n" + Array.from({length: 200}, (_, i) => {
      const age = 15 + (i % 65);
      const exp = i % 3 === 0 ? 0 : 1;
      const ev = (exp === 1 && age >= 18) ? (i % 5 !== 0 ? 1 : 0) : (i % 8 === 0 ? 1 : 0);
      return `${age},${i%2},${exp},${ev}`;
    }).join("\n");

    const form = new FormData();
    form.append("paper", new File([pdfContent], "demo_paper.pdf", { type: "application/pdf" }));
    form.append("dataset", new File([csvContent], "demo_dataset.csv", { type: "text/csv" }));

    let resp: Response;
    try {
      resp = await fetch("http://127.0.0.1:8000/analyze", { method: "POST", body: form });
    } catch {
      setError("Cannot reach backend. Is it running on :8000?");
      setAppState("error");
      return;
    }
    if (!resp.ok) {
      setError(`Backend error: ${resp.status}`);
      setAppState("error");
      return;
    }
    await processStream(resp);
  };

  const handleRun = async () => {
    if (!paper || !dataset) return;

    setAppState("uploading");
    setSteps([]);
    setToolCalls([]);
    setResult(null);
    setError(null);
    setMode(null);

    const form = new FormData();
    form.append("paper", paper);
    form.append("dataset", dataset);

    let resp: Response;
    try {
      resp = await fetch("http://127.0.0.1:8000/analyze", { method: "POST", body: form });
    } catch {
      setError("Cannot reach backend. Is it running on :8000?");
      setAppState("error");
      return;
    }

    if (!resp.ok) {
      setError(`Backend error: ${resp.status} ${resp.statusText}`);
      setAppState("error");
      return;
    }

    await processStream(resp);
  };

  const handleReset = () => {
    setAppState("idle");
    setSteps([]);
    setToolCalls([]);
    setResult(null);
    setError(null);
    setMode(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-indigo-50/30 dark:from-zinc-950 dark:to-indigo-950/10">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">R</div>
          <span className="font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">K2Hackathon</span>
          <span className="text-zinc-300 dark:text-zinc-600 text-sm">|</span>
          <span className="text-sm text-zinc-500">Scientific Reproducibility Agent</span>
          {mode && (
            <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
              mode === "mock"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
            }`}>
              {mode === "mock" ? "Mock Mode" : "K2 Horizon Live"}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {/* Upload section */}
        <section>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
            Reproduce a Statistical Result
          </h1>
          <p className="text-sm text-zinc-500 mb-6">
            Upload a paper PDF and the associated dataset. The agent will identify the main claim,
            run the analysis, and score reproducibility.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <UploadCard
              label="Scientific Paper (PDF)"
              accept=".pdf"
              file={paper}
              onFile={setPaper}
              icon="📄"
            />
            <UploadCard
              label="Dataset (CSV)"
              accept=".csv"
              file={dataset}
              onFile={setDataset}
              icon="📊"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              disabled={!canRun}
              onClick={handleRun}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                canRun
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/40"
                  : "bg-zinc-200 dark:bg-zinc-700 text-zinc-400 cursor-not-allowed"
              }`}
            >
              {appState === "uploading" || appState === "running" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {appState === "uploading" ? "Uploading…" : "Running agent…"}
                </>
              ) : (
                <>▶ Run Agent</>
              )}
            </button>
            <button
              disabled={!canDemo}
              onClick={handleDemo}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 border ${
                canDemo
                  ? "border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                  : "border-zinc-200 dark:border-zinc-700 text-zinc-400 cursor-not-allowed"
              }`}
            >
              ✦ Run Demo
            </button>
            {(appState === "done" || appState === "error") && (
              <button
                onClick={handleReset}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                Reset
              </button>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </section>

        {/* Agent workflow */}
        {(steps.length > 0 || toolCalls.length > 0) && (
          <section>
            <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${appState === "running" ? "bg-indigo-500 animate-pulse" : "bg-green-500"}`} />
              Agent Workflow
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Timeline */}
              <div
                ref={timelineRef}
                className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-0 max-h-96 overflow-y-auto"
              >
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">Steps</h3>
                {steps.map((s, i) => (
                  <StepRow key={s.id} step={s} isLast={i === steps.length - 1} />
                ))}
                {appState === "running" && steps.length > 0 && (
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full bg-indigo-400 animate-pulse mt-1 flex-shrink-0" />
                    </div>
                    <p className="text-sm text-zinc-400 italic pb-2">Thinking…</p>
                  </div>
                )}
              </div>

              {/* Tool calls */}
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 max-h-96 overflow-y-auto">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">Tool Calls</h3>
                {toolCalls.length === 0 ? (
                  <p className="text-sm text-zinc-400 italic">No tool calls yet…</p>
                ) : (
                  <div className="space-y-2">
                    {toolCalls.map((tc) => (
                      <ToolCallRow key={tc.id} tc={tc} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Result */}
        {result && <ResultPanel result={result} />}

        {/* Idle placeholder */}
        {appState === "idle" && (
          <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-700 p-12 flex flex-col items-center gap-3 text-center">
            <div className="text-5xl opacity-30">🔬</div>
            <p className="text-zinc-400 text-sm max-w-xs">
              Upload a paper and dataset above, then click <strong>Run Agent</strong> to start the reproducibility analysis.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
