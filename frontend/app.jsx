import React, { useState, useRef, useEffect, createContext, useContext } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import {
  Shield, FileText, CheckCircle2, Lock, Unlock, Send, Sparkles, Database, Upload,
  Download, RotateCcw, ChevronRight, FileUp, X, Wand2, Plus, Check, Trash2, Files,
  Sun, Moon, Home as HomeIcon, Users, ArrowRight, Brain, Search, EyeOff, Repeat,
  KeyRound, Ban, History, ClipboardList, Mail, Server, Cpu, ArrowDown, Activity,
  AlertTriangle, Loader2, FileCode,
} from "https://esm.sh/lucide-react@0.454.0?deps=react@18.3.1";

/* ---------------------------------------------------------------- theme --- */
const DARK = {
  bg: "#0A0D10", panel: "#12171C", panel2: "#171D24", border: "#232B33",
  text: "#E7EDF2", muted: "#8592A0", accent: "#34D5C4", accent2: "#E8A33D",
  danger: "#FF5D6C", mono: "'IBM Plex Mono', ui-monospace, monospace",
  sans: "'Manrope', ui-sans-serif, system-ui",
};
const LIGHT = {
  bg: "#F5F6F8", panel: "#FFFFFF", panel2: "#EEF0F3", border: "#DEE2E7",
  text: "#14181D", muted: "#5B6470", accent: "#0E9C8C", accent2: "#B96E11",
  danger: "#D3374A", mono: "'IBM Plex Mono', ui-monospace, monospace",
  sans: "'Manrope', ui-sans-serif, system-ui",
};
const ThemeCtx = createContext(DARK);
const useT = () => useContext(ThemeCtx);

const STAGES = ["Detect", "Classify", "Pseudonymize"];
const PROVIDERS = [
  { id: "ollama", label: "Local — Ollama", defaultModel: "gemma4:12b", needsKey: false },
  { id: "openai", label: "ChatGPT — OpenAI", defaultModel: "gpt-4o-mini", needsKey: true },
  { id: "mistral", label: "Mistral", defaultModel: "mistral-large-latest", needsKey: true },
];

/* ------------------------------------------------------------------ api --- */
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

/* -------------------------------------------------------------- helpers --- */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const trunc = (s, n = 34) => (s && s.length > n ? s.slice(0, n) + "…" : s);
const statusTone = (status) => (status === "REMOVED" ? "danger" : status === "PSEUDONYMIZED" ? "accent" : "muted");

/** Split the masked answer on every placeholder so each one can be highlighted
 *  and toggled between its fake and real value. */
function highlight(text, entities) {
  const values = entities.map((e) => e.fake).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!values.length) return [{ t: text }];

  const re = new RegExp(`(${values.map(escapeRe).join("|")})`, "g");
  const lookup = new Map(entities.map((e) => [e.fake, e]));
  return text.split(re).map((part) => (lookup.has(part) ? { e: lookup.get(part) } : { t: part }));
}

function downloadText(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------ primitives --- */
function Badge({ tone = "muted", children, icon: Icon }) {
  const T = useT();
  const c = { accent: T.accent, accent2: T.accent2, danger: T.danger, muted: T.muted }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
      style={{ background: `${c}1A`, color: c, border: `1px solid ${c}40`, fontFamily: T.mono }}>
      {Icon && <Icon size={12} />}{children}
    </span>
  );
}

function StageDots({ stage }) {
  const T = useT();
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((s, i) => (
        <div key={s} title={s} className="rounded-full transition-colors" style={{
          width: 7, height: 7,
          background: i < stage ? T.accent : i === stage ? T.accent2 : T.border,
        }} />
      ))}
    </div>
  );
}

function Toast({ message, onClose }) {
  const T = useT();
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [message, onClose]);
  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-start gap-2 rounded-xl px-4 py-3 max-w-md"
      style={{ background: T.panel, border: `1px solid ${T.danger}60`, boxShadow: "0 12px 32px rgba(0,0,0,.4)" }}>
      <AlertTriangle size={15} color={T.danger} className="mt-0.5 shrink-0" />
      <span style={{ fontFamily: T.mono, fontSize: 12, color: T.text }}>{message}</span>
      <button onClick={onClose}><X size={13} color={T.muted} /></button>
    </div>
  );
}

/* ------------------------------------------------------- reasoning panel --- */
function ReasoningBox({ doc }) {
  const T = useT();
  const trace = doc?.trace || [];

  if (!doc || !trace.length) {
    return (
      <div className="rounded-2xl p-8 flex flex-col items-center justify-center gap-2 text-center"
        style={{ background: T.bg, border: `1px dashed ${T.border}`, minHeight: 200 }}>
        <Brain size={20} color={T.muted} />
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.muted }}>
          {["scanning", "scanned", "masking"].includes(doc?.status)
            ? "Gemma is working on the first stage…"
            : "Upload a document above — the crew's reasoning shows up here as soon as it starts."}
        </p>
      </div>
    );
  }

  const entities = doc.entities || [];
  const shown = trace.length;
  const done = ["done", "complete", "error"].includes(doc.status);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: T.bg, border: `1px solid ${T.accent}40` }}>
      <div className="flex items-center justify-between px-4 py-2.5 flex-wrap gap-2"
        style={{ borderBottom: `1px solid ${T.border}`, background: T.panel2 }}>
        <div className="flex items-center gap-2" style={{ fontFamily: T.mono, fontSize: 11, color: T.accent }}>
          <Brain size={13} /> CREW REASONING — {doc.name}
        </div>
        {done
          ? <Badge tone={["done", "complete"].includes(doc.status) ? "accent" : "danger"} icon={CheckCircle2}>
              {["done", "complete"].includes(doc.status) ? "Done" : "chain failed"}
            </Badge>
          : <Badge tone="accent2">{STAGES[Math.min(shown, STAGES.length - 1)]}…</Badge>}
      </div>

      <div className="px-4 py-3.5 flex flex-col gap-3" style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.7 }}>
        {trace.map((step, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div style={{ color: T.accent, fontSize: 10.5, letterSpacing: .5 }}>
              {String(i + 1).padStart(2, "0")} · {step.agent.toUpperCase()}
            </div>
            <div style={{ color: T.text }}>▸ {step.text}</div>
            {step.prompt && (
              <details defaultOpen={step.loading} className="rounded-lg px-2.5 py-1.5" style={{ background: T.panel2, color: T.muted, fontSize: 10.5 }}>
                <summary style={{ color: T.accent2, cursor: "pointer", letterSpacing: .5 }}>
                  PROMPT SENT TO {String(step.model || "LOCAL MODEL").toUpperCase()}
                </summary>
                <div className="mt-1.5" style={{ whiteSpace: "pre-wrap", color: T.text }}>{step.prompt}</div>
              </details>
            )}
            {step.loading && (
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: T.panel2, color: T.accent2, fontSize: 11.5 }}>
                <Loader2 size={13} className="animate-spin" /> Gemma is detecting…
              </div>
            )}
            {step.model_output && (
              <details defaultOpen className="rounded-lg px-2.5 py-1.5" style={{ background: T.panel2, color: T.muted, fontSize: 10.5 }}>
                <summary style={{ color: T.accent, cursor: "pointer", letterSpacing: .5 }}>
                  VALIDATED MODEL OUTPUT
                </summary>
                <pre className="mt-1.5 overflow-auto" style={{ whiteSpace: "pre-wrap", color: T.text, maxHeight: 180 }}>
                  {step.model_output}
                </pre>
              </details>
            )}
            {step.agent_note && (
              <div className="rounded-lg px-2.5 py-1.5" style={{ background: T.panel2, color: T.muted, fontSize: 11.5 }}>
                <div className="mb-1" style={{ color: T.accent2, fontSize: 9.5, letterSpacing: .6 }}>
                  <Sparkles size={10} className="inline mr-1.5" />
                  {`${(step.model || "LOCAL MODEL").toUpperCase()} RESPONSE`}
                </div>
                <div>{step.agent_note}</div>
              </div>
            )}
            {!step.agent_note && step.engine === "deterministic" && (
              <div style={{ color: T.muted, fontSize: 10.5 }}>
                Deterministic fallback — no local-model response was generated for this step.
              </div>
            )}
            {step.stage === "classify" && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {(step.detail || []).map((d, j) => (
                  <span key={j} className="rounded px-1.5 py-0.5 text-[10px]"
                    style={{ background: T.panel2, color: T.muted, fontFamily: T.mono }}>
                    {d.type} · {d.status}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {!done && <div style={{ color: T.muted }}><Loader2 size={12} className="inline animate-spin mr-1.5" />working…</div>}
      </div>

      {entities.length > 0 && shown >= 3 && (
        <div className="px-4 pb-4">
          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, letterSpacing: .5, marginBottom: 6, paddingTop: 10, borderTop: `1px dashed ${T.border}` }}>
            MAPPING STORE — ephemeral, session-scoped, never written to disk
          </div>
          <div className="flex flex-col gap-1">
            {entities.map((e, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                style={{ background: T.panel2, fontFamily: T.mono, fontSize: 11 }}>
                <span className="rounded px-1.5 py-0.5 shrink-0" style={{ background: T.panel, color: T.muted }}>{e.type}</span>
                <span className="truncate" style={{ color: T.text, minWidth: 0, flex: 1 }} title={e.real}>{e.real}</span>
                <ArrowRight size={10} style={{ color: T.accent2, flexShrink: 0 }} />
                <span className="truncate" style={{ color: T.accent, minWidth: 0, flex: 1 }} title={e.fake}>{e.fake}</span>
                <Badge tone={statusTone(e.status)}>{e.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------ tab: upload/mask --- */
function UploadTab({ docs, refresh, notify }) {
  const T = useT();
  const fileRef = useRef(null);
  const [samples, setSamples] = useState([]);
  const [focusUid, setFocusUid] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => { api("/samples").then((d) => setSamples(d.samples)).catch(() => {}); }, []);

  const guard = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (err) { notify(err.message); } finally { setBusy(null); }
  };

  // Upload auto-starts Detect -> Classify server-side (see main.py's
  // _kickoff_scan). This polls that through to "scanned", then triggers
  // Pseudonymize itself — so the whole three-stage chain runs
  // end-to-end from a single upload, no extra click needed.
  const pollUntil = async (uid, doneStatuses) => {
    for (;;) {
      const data = await api("/documents");
      await refresh(data.documents);
      const current = data.documents.find((d) => d.uid === uid);
      if (!current || doneStatuses.includes(current.status)) return current;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  };

  const continueChain = async (uid) => {
    let current = await pollUntil(uid, ["scanned", "done", "complete", "error"]);
    if (current?.status === "error") throw new Error("Detection failed. Check the backend terminal.");
    if (current?.status === "scanned") {
      await api(`/documents/${uid}/mask`, { method: "POST" });
      current = await pollUntil(uid, ["done", "complete", "error"]);
      if (current?.status === "error") throw new Error("Masking failed. Check the backend terminal.");
    }
  };

  const processDocument = (uid) => guard(uid, async () => {
    setFocusUid(uid);
    await continueChain(uid);
  });

  const retry = (uid) => guard(uid, async () => {
    setFocusUid(uid);
    await api(`/documents/${uid}/scan`, { method: "POST" });
    await continueChain(uid);
  });

  const handleFiles = (files) => guard("upload", async () => {
    const form = new FormData();
    [...files].forEach((f) => form.append("files", f));
    const { documents } = await api("/documents", { method: "POST", body: form });
    await refresh();
    documents.forEach((d) => processDocument(d.uid));
  });

  const addSample = (filename) => guard(filename, async () => {
    const doc = await api("/documents/sample", { method: "POST", body: JSON.stringify({ filename }) });
    await refresh([...docs.filter((item) => item.uid !== doc.uid), doc]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    processDocument(doc.uid);
  });

  // If the page was reloaded mid-chain (no local poll loop still running for
  // that document), pick it back up once on mount instead of leaving it stuck.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !docs.length) return;
    resumedRef.current = true;
    docs.forEach((d) => {
      if (["ocr_processing", "scanning", "scanned", "masking"].includes(d.status)) processDocument(d.uid);
    });
  }, [docs]);

  const remove = (uid) => guard(uid, async () => {
    await api(`/documents/${uid}`, { method: "DELETE" });
    if (focusUid === uid) setFocusUid(null);
    await refresh();
  });

  const focusDoc = docs.find((d) => d.uid === focusUid) || null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Upload size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, letterSpacing: .5 }}>UPLOAD & MASK</span>
        </div>
        <h2 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 22 }}>
          Bring any document. Nothing sensitive leaves this machine.
        </h2>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 4, maxWidth: 660 }}>
          Every file is converted to Markdown first — PDFs and images through a fast OCR server
          (or PaddleOCR PP-StructureV3 in-process), Word through mammoth, Hangul (.hwp) through
          pyhwp. Then a CrewAI chain of three agents detects, classifies, and pseudonymizes it.
          Only the masked Markdown is ever allowed out.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => fileRef.current?.click()} disabled={busy === "upload"}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ background: T.accent, color: T.bg, fontFamily: T.sans, opacity: busy === "upload" ? .6 : 1 }}>
          {busy === "upload" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {busy === "upload" ? "Converting…" : "Upload document"}
        </button>
        <input ref={fileRef} type="file" multiple hidden
          accept=".pdf,.docx,.hwp,.xlsx,.xls,.png,.jpg,.jpeg,.html,.md,.txt,.csv"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>or try a bundled sample:</span>
        {samples.map((s) => (
          <button key={s.filename} onClick={() => addSample(s.filename)} disabled={busy === s.filename}
            className="rounded-full px-3 py-1 text-xs"
            style={{ background: T.panel2, color: T.muted, border: `1px solid ${T.border}`, fontFamily: T.mono }}>
            {busy === s.filename ? "loading…" : `+ ${s.filename}`}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
        <div className="grid text-xs px-4 py-2.5" style={{ gridTemplateColumns: "2.2fr 1.1fr 1.3fr 1.4fr", background: T.panel2, color: T.muted, fontFamily: T.mono, borderBottom: `1px solid ${T.border}` }}>
          <div>DOCUMENT</div><div>STATUS</div><div>FINDINGS</div><div className="text-right">ACTIONS</div>
        </div>
        {docs.length === 0 && (
          <div className="px-4 py-10 text-center" style={{ fontFamily: T.mono, fontSize: 12, color: T.muted, background: T.panel }}>
            No documents yet — upload a file or add a sample above.
          </div>
        )}
        {docs.map((doc) => {
          const focused = doc.uid === focusUid;
          const inProgress = ["ocr_processing", "scanning", "scanned", "masking"].includes(doc.status);
          const running = busy === doc.uid || inProgress;
          return (
            <div key={doc.uid} onClick={() => doc.trace?.length && setFocusUid(doc.uid)}
              className="grid items-center px-4 py-3" style={{
                gridTemplateColumns: "2.2fr 1.1fr 1.3fr 1.4fr", background: focused ? T.panel2 : T.panel,
                borderBottom: `1px solid ${T.border}`, borderLeft: `2px solid ${focused ? T.accent : "transparent"}`,
                cursor: doc.trace?.length ? "pointer" : "default",
              }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText size={16} color={T.muted} className="shrink-0" />
                <div className="min-w-0">
                  <div style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 600 }} className="truncate">{doc.name}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }} className="truncate">{doc.source}</div>
                </div>
              </div>
              <div>
                {inProgress && (
                  <div className="flex items-center gap-2">
                    <StageDots stage={doc.trace?.length || 0} />
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.accent2 }}>
                      {doc.status === "ocr_processing" ? "OCR processing…" : doc.status === "scanning" ? "detecting…" : "masking…"}
                    </span>
                  </div>
                )}
                {!inProgress && ["done", "complete"].includes(doc.status) && <Badge tone="accent" icon={CheckCircle2}>Done</Badge>}
                {!inProgress && doc.status === "error" && <Badge tone="danger" icon={AlertTriangle}>chain failed</Badge>}
              </div>
              <div className="flex flex-wrap gap-1">
                {doc.entities?.length ? (
                  <>
                    {[...new Set(doc.entities.map((e) => e.type))].slice(0, 4).map((t) => (
                      <span key={t} className="rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: T.panel2, color: T.muted, fontFamily: T.mono }}>{t}</span>
                    ))}
                    <span className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{ color: T.muted, fontFamily: T.mono }}>{doc.entities.length} values</span>
                  </>
                ) : <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>—</span>}
              </div>
              <div className="flex justify-end gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                {doc.status === "error" ? (
                  <button onClick={() => retry(doc.uid)} disabled={running}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{ background: T.accent, color: T.bg, fontFamily: T.sans, opacity: running ? .6 : 1 }}>
                    {running ? "Retrying…" : "Retry"}
                  </button>
                ) : (
                  <>
                    <button onClick={() => setFocusUid(doc.uid)} title="Reasoning" disabled={!doc.trace?.length}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
                      style={{ background: focused ? `${T.accent}1A` : T.panel2, color: focused ? T.accent : T.muted, border: `1px solid ${focused ? T.accent + "40" : T.border}`, fontFamily: T.sans, opacity: doc.trace?.length ? 1 : .5 }}>
                      <Brain size={12} />
                    </button>
                    {["done", "complete"].includes(doc.status) && (
                      <>
                        <a href={`/api/documents/${doc.uid}/download?variant=masked`} download title="Masked Markdown"
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
                          style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.sans }}>
                          <Download size={12} />
                        </a>
                        <a href={`/api/documents/${doc.uid}/download?variant=audit`} download title="Audit log"
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
                          style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.sans }}>
                          <ClipboardList size={12} />
                        </a>
                      </>
                    )}
                  </>
                )}
                <button onClick={() => remove(doc.uid)} title="Remove" disabled={doc.status === "ocr_processing"}
                  className="rounded-lg px-2.5 py-1.5" style={{ background: T.panel2, border: `1px solid ${T.border}` }}>
                  <Trash2 size={12} color={T.muted} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <ReasoningBox doc={focusDoc} />

      {focusDoc?.masked_markdown && (
        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
          <div className="flex items-center gap-2 px-4 py-2.5"
            style={{ background: T.panel2, borderBottom: `1px solid ${T.border}`, fontFamily: T.mono, fontSize: 11, color: T.muted }}>
            <FileCode size={13} /> MASKED MARKDOWN — this is the exact text an external model would receive
          </div>
          <pre className="px-4 py-3 overflow-auto" style={{
            background: T.panel, color: T.text, fontFamily: T.mono, fontSize: 11.5,
            lineHeight: 1.6, maxHeight: 320, whiteSpace: "pre-wrap",
          }}>{focusDoc.masked_markdown}</pre>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- tab: chat --- */
function ChatMessage({ message, entities }) {
  const T = useT();
  const [revealed, setRevealed] = useState(false);
  // Always split the masked answer — the toggle only changes which side of each
  // mapping is rendered, so the two views stay perfectly aligned.
  const shown = highlight(message.masked_answer, entities);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
      <div className="flex items-center justify-between px-4 py-2.5 flex-wrap gap-2"
        style={{ borderBottom: `1px solid ${T.border}`, background: T.panel2 }}>
        <div className="flex items-center gap-2" style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>
          <Sparkles size={12} color={T.accent2} /> {message.provider} · {message.model}
        </div>
        <button onClick={() => setRevealed((r) => !r)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
          style={{
            background: revealed ? `${T.accent}1A` : `${T.accent2}1A`, color: revealed ? T.accent : T.accent2,
            border: `1px solid ${(revealed ? T.accent : T.accent2)}40`, fontFamily: T.mono,
          }}>
          {revealed ? <Unlock size={12} /> : <Lock size={12} />}
          {revealed ? `remapped — ${message.restored} value(s) restored` : "masked (exactly as sent)"}
        </button>
      </div>

      <div className="px-4 py-3.5" style={{ fontFamily: T.sans, fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
        {shown.map((p, i) => p.t !== undefined ? <span key={i}>{p.t}</span> : (
          <span key={i} className="rounded px-1 py-0.5" style={{
            background: revealed ? `${T.accent}22` : `${T.accent2}22`,
            color: revealed ? T.accent : T.accent2, fontFamily: T.mono, fontWeight: 600,
          }}>{revealed ? p.e.real : p.e.fake}</span>
        ))}
      </div>

    </div>
  );
}

function DocPicker({ allDocs, selected, onToggle, onClose }) {
  const T = useT();
  return (
    <div className="absolute z-10 mt-2 w-80 rounded-xl p-2 flex flex-col gap-1"
      style={{ background: T.panel, border: `1px solid ${T.border}`, boxShadow: "0 12px 32px rgba(0,0,0,.35)" }}>
      <div className="px-2 py-1" style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>SELECT DOCUMENTS</div>
      {allDocs.map((d) => {
        const on = selected.includes(d.uid);
        return (
          <button key={d.uid} onClick={() => onToggle(d.uid)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left"
            style={{ background: on ? T.panel2 : "transparent" }}>
            <div className="rounded flex items-center justify-center shrink-0"
              style={{ width: 16, height: 16, border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : "transparent" }}>
              {on && <Check size={11} color={T.bg} />}
            </div>
            <FileText size={14} color={T.muted} />
            <span style={{ fontFamily: T.sans, fontSize: 12.5 }} className="truncate">{d.name}</span>
          </button>
        );
      })}
      <button onClick={onClose} className="mt-1 rounded-lg py-1.5 text-xs"
        style={{ background: T.panel2, color: T.muted, fontFamily: T.mono }}>Done</button>
    </div>
  );
}

function ChatTab({ docs, notify, ollamaModels, chat, setChat }) {
  const T = useT();
  const ready = docs.filter((d) => d.masked_markdown);
  // Conversation state lives in <App> so switching tabs does not unmount it away.
  // See docs/CONTEXT-AND-CHAT.md for why it is never written to browser storage.
  const { sessions, activeId, provider, model, apiKey, input } = chat;
  const patch = (p) => setChat((c) => ({ ...c, ...(typeof p === "function" ? p(c) : p) }));
  const setSessions = (next) =>
    patch((c) => ({ sessions: typeof next === "function" ? next(c.sessions) : next }));
  const setActiveId = (id) => patch({ activeId: id });
  const setInput = (value) => patch({ input: value });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const session = sessions.find((s) => s.id === activeId) || sessions[0];
  const selected = ready.filter((d) => session.docUids.includes(d.uid));
  const entities = selected.flatMap((d) => d.entities || []);
  const providerInfo = PROVIDERS.find((p) => p.id === provider);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [session?.messages]);
  // The installed-model list arrives after mount, so fill in a valid default once —
  // without clobbering a model the user picked (which would happen on every remount).
  useEffect(() => {
    if (provider === "ollama" && ollamaModels.length && !ollamaModels.includes(model)) {
      patch({ model: ollamaModels[0] });
    }
  }, [provider, ollamaModels, model]);

  const switchProvider = (id) => {
    const info = PROVIDERS.find((p) => p.id === id);
    patch({ provider: id, model: id === "ollama" && ollamaModels.length ? ollamaModels[0] : info.defaultModel });
  };

  const update = (id, patch) =>
    setSessions((all) => all.map((s) => (s.id === id ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) } : s)));

  const newChat = () => {
    const id = crypto.randomUUID();
    setSessions((all) => [{ id, title: "New chat", docUids: [], messages: [] }, ...all]);
    setActiveId(id);
    setPickerOpen(false);
  };
  const deleteChat = (id, e) => {
    e.stopPropagation();
    const rest = sessions.filter((s) => s.id !== id);
    const next = rest.length ? rest : [{ id: crypto.randomUUID(), title: "New chat", docUids: [], messages: [] }];
    setSessions(next);
    if (id === activeId) setActiveId(next[0].id);
  };
  const toggleDoc = (uid) =>
    update(session.id, (s) => ({ docUids: s.docUids.includes(uid) ? s.docUids.filter((u) => u !== uid) : [...s.docUids, uid] }));

  const send = async (q) => {
    const question = (q ?? input).trim();
    if (!question || !selected.length || sending) return;
    if (providerInfo.needsKey && !apiKey.trim()) { notify(`Paste your ${providerInfo.label} API key first.`); return; }

    const history = session.messages.flatMap((m) => m.role === "user"
      ? [{ role: "user", content: m.text }]
      : [{ role: "assistant", content: m.masked_answer }]);

    update(session.id, (s) => ({
      messages: [...s.messages, { role: "user", text: question }],
      title: s.title === "New chat" ? question.slice(0, 32) : s.title,
    }));
    setInput("");
    setSending(true);
    try {
      const reply = await api("/chat", {
        method: "POST",
        body: JSON.stringify({
          doc_uids: selected.map((d) => d.uid), question, provider,
          model: model.trim(), api_key: apiKey.trim() || null, history,
        }),
      });
      update(session.id, (s) => ({ messages: [...s.messages, { role: "assistant", ...reply }] }));
    } catch (err) {
      notify(err.message);
      update(session.id, (s) => ({ messages: s.messages.slice(0, -1) }));
      setInput(question);
    } finally {
      setSending(false);
    }
  };

  if (!ready.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center" style={{ color: T.muted }}>
        <Database size={28} />
        <p style={{ fontFamily: T.sans, fontSize: 14 }}>No masked documents yet.</p>
        <p style={{ fontFamily: T.mono, fontSize: 12 }}>Run the privacy chain in "Upload & Mask" first.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: "230px 1fr" }}>
      <div className="flex flex-col gap-2">
        <button onClick={newChat} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold"
          style={{ background: T.accent, color: T.bg, fontFamily: T.sans }}>
          <Plus size={15} /> New chat
        </button>
        <div className="flex flex-col gap-1 mt-1">
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setActiveId(s.id)}
              className="group flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left"
              style={{ background: s.id === session.id ? T.panel2 : "transparent" }}>
              <span className="truncate" style={{ fontFamily: T.sans, fontSize: 12.5, color: s.id === session.id ? T.text : T.muted }}>{s.title}</span>
              <Trash2 size={12} color={T.muted} className="opacity-0 group-hover:opacity-100 shrink-0" onClick={(e) => deleteChat(s.id, e)} />
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="relative">
            <button onClick={() => setPickerOpen((p) => !p)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
              style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.mono }}>
              <Files size={13} /> {selected.length === 0 ? "Select documents" : `${selected.length} document${selected.length > 1 ? "s" : ""} selected`}
            </button>
            {pickerOpen && <DocPicker allDocs={ready} selected={session.docUids} onToggle={toggleDoc} onClose={() => setPickerOpen(false)} />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={provider} onChange={(e) => switchProvider(e.target.value)} className="rounded-lg px-2.5 py-1.5 text-xs"
              style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.mono }}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {provider === "ollama" && ollamaModels.length ? (
              <select value={model} onChange={(e) => patch({ model: e.target.value })} className="rounded-lg px-2.5 py-1.5 text-xs"
                style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.mono }}>
                {ollamaModels.map((m) => <option key={m}>{m}</option>)}
              </select>
            ) : (
              <input value={model} onChange={(e) => patch({ model: e.target.value })} placeholder="model"
                className="rounded-lg px-2.5 py-1.5 text-xs outline-none" style={{ width: 160, background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.mono }} />
            )}
            {providerInfo.needsKey && (
              <input value={apiKey} onChange={(e) => patch({ apiKey: e.target.value.trim() })} type="password" placeholder="paste API key"
                className="rounded-lg px-2.5 py-1.5 text-xs outline-none"
                style={{ width: 170, background: T.panel2, color: T.text, border: `1px solid ${apiKey ? T.accent + "60" : T.accent2 + "60"}`, fontFamily: T.mono }} />
            )}
          </div>
        </div>

        {providerInfo.needsKey && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: `${T.accent2}10`, border: `1px solid ${T.accent2}30` }}>
            <Server size={12} color={T.accent2} />
            <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>
              External model — only the masked Markdown is sent. Your key stays in this browser tab and is never stored.
            </span>
          </div>
        )}

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((d) => (
              <button key={d.uid} onClick={() => toggleDoc(d.uid)} className="flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 text-xs"
                style={{ background: `${T.accent}1A`, color: T.accent, border: `1px solid ${T.accent}40`, fontFamily: T.mono }}>
                {d.name} <X size={11} />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-2xl p-4 min-h-[300px]" style={{ background: T.bg, border: `1px solid ${T.border}` }}>
          {selected.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center" style={{ color: T.muted }}>
              <Files size={22} />
              <p style={{ fontFamily: T.sans, fontSize: 13 }}>Select one or more documents above to start chatting.</p>
            </div>
          ) : session.messages.length === 0 ? (
            <div className="flex flex-wrap gap-2 py-8 justify-center">
              {["Summarize the key obligations", "What are the payment terms?", "Flag any risky clauses", "List the main contract risks"].map((q) => (
                <button key={q} onClick={() => send(q)} className="rounded-full px-3 py-1.5 text-xs"
                  style={{ background: T.panel2, color: T.muted, fontFamily: T.mono, border: `1px solid ${T.border}` }}>{q}</button>
              ))}
            </div>
          ) : null}
          {session.messages.map((m, i) => m.role === "user" ? (
            <div key={i} className="self-end rounded-2xl px-4 py-2 max-w-[70%]"
              style={{ background: T.accent, color: T.bg, fontFamily: T.sans, fontSize: 13 }}>{m.text}</div>
          ) : (
            <ChatMessage key={i} message={m} entities={entities} />
          ))}
          {sending && (
            <div className="flex items-center gap-2" style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>
              <Loader2 size={13} className="animate-spin" /> masking → sending → waiting on {provider}…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={selected.length ? "Ask about these documents…" : "Select a document first…"}
            disabled={!selected.length || sending} className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.sans, opacity: selected.length ? 1 : .6 }} />
          <button onClick={() => send()} disabled={!selected.length || sending}
            className="rounded-xl px-4 flex items-center justify-center"
            style={{ background: T.accent, color: T.bg, opacity: selected.length && !sending ? 1 : .6 }}>
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- tab: reconstruct --- */
function ReconstructTab({ docs, notify }) {
  const T = useT();
  const ready = docs.filter((d) => d.masked_markdown);
  const [selected, setSelected] = useState([]);
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => { if (!selected.length && ready[0]) setSelected([ready[0].uid]); }, [ready.length]);

  const toggle = (uid) =>
    setSelected((s) => (s.includes(uid) ? s.filter((u) => u !== uid) : [...s, uid]));

  const loadSample = () => {
    const doc = ready.find((d) => selected.includes(d.uid));
    if (!doc?.entities?.length) return;
    const lines = doc.entities.slice(0, 6).map((e) => `- ${e.type}: ${e.fake}`);
    setInput(`Review summary for ${doc.name}\n\n${lines.join("\n")}\n\nPlease confirm these before sign-off.`);
    setResult(null);
  };

  const run = async () => {
    try {
      setResult(await api("/remap", { method: "POST", body: JSON.stringify({ doc_uids: selected, text: input }) }));
    } catch (err) { notify(err.message); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <RotateCcw size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, letterSpacing: .5 }}>RECONSTRUCT</span>
        </div>
        <h2 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 22 }}>Got a report back? Remap it to its real values.</h2>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 4, maxWidth: 660 }}>
          Paste anything an external model produced from masked documents. The mapping store swaps the
          placeholders back to the originals — locally, in this process, never over the network.
        </p>
      </div>

      {!ready.length ? (
        <div className="rounded-2xl px-4 py-10 text-center"
          style={{ background: T.panel, border: `1px solid ${T.border}`, fontFamily: T.mono, fontSize: 12, color: T.muted }}>
          No masked documents yet — process one in "Upload & Mask" first.
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: "260px 1fr" }}>
          <div className="flex flex-col gap-2">
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>MAP AGAINST</div>
            {ready.map((d) => {
              const active = selected.includes(d.uid);
              return (
                <button key={d.uid} onClick={() => { toggle(d.uid); setResult(null); }}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left"
                  style={{ background: active ? T.panel2 : "transparent", border: `1px solid ${active ? T.accent + "50" : T.border}` }}>
                  <FileText size={15} color={active ? T.accent : T.muted} />
                  <span className="truncate" style={{ fontFamily: T.sans, fontSize: 12.5, color: active ? T.text : T.muted }}>{d.name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>PASTE THE REPORT / LLM RESPONSE</span>
              <button onClick={loadSample} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
                style={{ background: T.panel2, color: T.accent2, border: `1px solid ${T.accent2}40`, fontFamily: T.mono }}>
                <Wand2 size={11} /> insert a sample masked report
              </button>
            </div>
            <textarea value={input} onChange={(e) => { setInput(e.target.value); setResult(null); }} rows={7}
              placeholder="Paste text containing masked values here…"
              className="rounded-xl px-4 py-3 text-sm outline-none resize-none"
              style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.mono, fontSize: 12.5 }} />

            <button onClick={run} disabled={!input.trim() || !selected.length}
              className="self-start flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: input.trim() ? T.accent : T.panel2, color: input.trim() ? T.bg : T.muted, fontFamily: T.sans, opacity: input.trim() ? 1 : .6 }}>
              <Unlock size={15} /> Remap to original
            </button>

            {result && (
              <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Badge tone={result.restored ? "accent" : "accent2"} icon={CheckCircle2}>
                    {result.restored} value{result.restored !== 1 ? "s" : ""} restored
                  </Badge>
                  <button onClick={() => downloadText("remapped.md", result.text)}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                    style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.sans }}>
                    <Download size={12} /> Download
                  </button>
                </div>
                <pre style={{ fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap", color: T.text }}>{result.text}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- tab: NER tags --- */
function NerTagsTab({ notify }) {
  const T = useT();
  const [tags, setTags] = useState([]);
  const [form, setForm] = useState({ name: "", description: "", status: "PSEUDONYMIZED" });
  const load = () => api("/ner-tags").then((data) => setTags(data.tags)).catch((err) => notify(err.message));
  useEffect(load, []);

  const create = async () => {
    try {
      await api("/ner-tags", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", description: "", status: "PSEUDONYMIZED" });
      load();
    } catch (err) { notify(err.message); }
  };

  const remove = async (name) => {
    try {
      await api(`/ner-tags/${encodeURIComponent(name)}`, { method: "DELETE" });
      load();
    } catch (err) { notify(err.message); }
  };

  const field = { background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.mono };
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5"><KeyRound size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent }}>CUSTOM NER TAGS</span>
        </div>
        <h2 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 22 }}>Customize sensitive-information tags.</h2>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 4 }}>
          Add security or privacy categories that are not covered by the default NER list. Each tag and its detection guidance is added to the local detector prompt for future scans.
        </p>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 2fr 1fr auto" }}>
        <label className="flex flex-col gap-1"><span style={{ color: T.muted, fontFamily: T.mono, fontSize: 10 }}>ROOT TAG</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })}
            placeholder="NER_TAG" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />
        </label>
        <label className="flex flex-col gap-1"><span style={{ color: T.muted, fontFamily: T.mono, fontSize: 10 }}>WHAT BELONGS IN THIS TAG?</span>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Keywords, patterns, or examples to detect" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />
        </label>
        <label className="flex flex-col gap-1"><span style={{ color: T.muted, fontFamily: T.mono, fontSize: 10 }}>HANDLING</span>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="rounded-xl px-3 py-2.5 text-sm outline-none" style={field}>
            <option>PSEUDONYMIZED</option><option>KEEP</option><option>REMOVED</option>
          </select>
        </label>
        <button onClick={create} disabled={!form.name.trim()} className="rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ background: T.accent, color: T.bg, opacity: form.name.trim() ? 1 : .5, alignSelf: "end" }}>
          <Plus size={15} className="inline mr-1" /> Add
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
        <div className="grid px-4 py-2.5 text-xs" style={{ gridTemplateColumns: "1fr 2fr 1fr auto", background: T.panel2, color: T.muted, fontFamily: T.mono }}>
          <div>TAG</div><div>MODEL GUIDANCE</div><div>STATUS</div><div>ACTION</div>
        </div>
        {!tags.length && <div className="px-4 py-8 text-center" style={{ background: T.panel, color: T.muted, fontFamily: T.mono, fontSize: 12 }}>No custom tags yet.</div>}
        {tags.map((tag) => (
          <div key={tag.name} className="grid items-center px-4 py-3" style={{ gridTemplateColumns: "1fr 2fr 1fr auto", background: T.panel, borderTop: `1px solid ${T.border}`, fontFamily: T.mono, fontSize: 12 }}>
            <span style={{ color: T.accent }}>{tag.name}</span><span style={{ color: T.text }}>{tag.description}</span>
            <Badge tone={statusTone(tag.status)}>{tag.status}</Badge>
            <button onClick={() => remove(tag.name)} className="rounded-lg p-2" title="Delete tag" style={{ background: T.panel2 }}><Trash2 size={13} color={T.danger} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ home / team / arch --- */
const PROJECT = {
  titleKo: "프라이버시 보호형 계약 검토 AI 에이전트",
  titleEn: "Privacy-Aware Contract Review Agent",
  summary: "Business teams already lean on generative AI to summarize contracts, review terms, and draft emails — but those documents carry personal data, company names, account numbers, contract values, and confidential clauses that shouldn't leave the building. This agent converts any document to Markdown, detects that sensitive information automatically, masks it with consistent and realistic placeholders before anything is sent to an external model, restores the real values locally once a response comes back, and keeps an audit log of exactly what was checked — so teams keep the speed of generative AI without the exposure risk.",
  keywords: ["AI Agent", "Privacy Protection", "Document Security", "Contract Review", "Sensitive Information Detection", "Pseudonymization", "Local LLM", "Audit Logging", "Enterprise AI"],
};
const TEAM = {
  name: "머핀", nameEn: "Muffin",
  tagline: "Building a privacy-first contract review agent.",
  members: [{ name: "카리나", role: "Team Leader" }, { name: "마빈", role: "Member" }, { name: "타키", role: "Member" }],
};

function HomeTab({ onTryDemo, health }) {
  const T = useT();
  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, letterSpacing: .5 }}>{PROJECT.titleKo}</span>
        </div>
        <h1 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 28, lineHeight: 1.25 }}>{PROJECT.titleEn}</h1>
        <p style={{ fontFamily: T.sans, fontSize: 14, color: T.muted, marginTop: 14, lineHeight: 1.75 }}>{PROJECT.summary}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PROJECT.keywords.map((k) => (
          <span key={k} className="rounded-full px-3 py-1 text-xs"
            style={{ background: T.panel2, color: T.muted, border: `1px solid ${T.border}`, fontFamily: T.mono }}>{k}</span>
        ))}
      </div>

      {health && (
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
          <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted, letterSpacing: .5 }}>RUNTIME</div>
          {[["OCR engine", health.ocr], ["Agent chain", health.crew],
            ["Local models", health.ollama_models.length ? health.ollama_models.join(", ") : "none (start `ollama serve`)"]].map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 flex-wrap" style={{ fontFamily: T.mono, fontSize: 11.5 }}>
              <span style={{ color: T.muted, width: 110 }}>{k}</span>
              <span style={{ color: T.text }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      <button onClick={onTryDemo} className="self-start flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold"
        style={{ background: T.accent, color: T.bg, fontFamily: T.sans }}>
        Try the demo <ArrowRight size={15} />
      </button>
    </div>
  );
}

function TeamTab() {
  const T = useT();
  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Users size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, letterSpacing: .5 }}>TEAM</span>
        </div>
        <h1 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 26 }}>
          {TEAM.name} <span style={{ color: T.muted, fontWeight: 600, fontSize: 18 }}>({TEAM.nameEn})</span>
        </h1>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 6 }}>{TEAM.tagline}</p>
      </div>
      <div className="flex flex-col gap-2">
        {TEAM.members.map((m) => {
          const c = m.name.charCodeAt(0) % 2 === 0 ? T.accent : T.accent2;
          return (
            <div key={m.name} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
              <div className="rounded-full flex items-center justify-center shrink-0"
                style={{ width: 42, height: 42, background: `${c}22`, color: c, fontFamily: T.sans, fontWeight: 800, fontSize: 15 }}>
                {m.name.slice(0, 1)}
              </div>
              <span style={{ fontFamily: T.sans, fontWeight: 700, fontSize: 14 }}>{m.name}</span>
              <span className="ml-auto"><Badge tone={m.role === "Team Leader" ? "accent" : "muted"}>{m.role}</Badge></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FlowArrow() {
  const T = useT();
  return <div className="flex justify-center py-0.5"><ArrowDown size={14} color={T.muted} /></div>;
}

function ArchStage({ number, title, items }) {
  const T = useT();
  return (
    <div className="rounded-2xl p-4" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="rounded-full flex items-center justify-center shrink-0"
          style={{ width: 20, height: 20, background: `${T.accent}22`, color: T.accent, fontFamily: T.mono, fontSize: 10, fontWeight: 700 }}>{number}</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: .5 }}>{title}</span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: T.panel2 }}>
            <it.icon size={14} color={T.muted} className="shrink-0" />
            <span style={{ fontFamily: T.sans, fontSize: 12, color: T.text }}>{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, tone }) {
  const T = useT();
  return (
    <div className="flex items-baseline gap-3 flex-wrap" style={{ fontFamily: T.mono, fontSize: 11.5 }}>
      <span style={{ color: T.muted, width: 120, flexShrink: 0 }}>{label}</span>
      <span style={{ color: tone || T.text }}>{value}</span>
    </div>
  );
}

function ArchitectureTab() {
  const T = useT();
  const card = { background: T.panel, border: `1px solid ${T.border}` };

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Cpu size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, letterSpacing: .5 }}>ARCHITECTURE</span>
        </div>
        <h2 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 22 }}>
          Local Gemma detects context. Deterministic Python validates and protects.
        </h2>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 4, maxWidth: 660 }}>
          Everything inside the dashed boundary runs on this machine. Only masked Markdown ever leaves it.
        </p>
      </div>

      {/* 0 — ingestion */}
      <div className="rounded-2xl p-4 flex flex-col gap-2.5" style={card}>
        <div className="flex items-center gap-2">
          <FileUp size={14} color={T.accent2} />
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent2, letterSpacing: .5 }}>
            0 · INGESTION — convert.py · any file → Markdown
          </span>
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          {[
            [".pdf .png .jpg", "OCR server (fast, separate process)"],
            [".pdf .png .jpg", "PaddleOCR PP-StructureV3 (in-process)"],
            [".pdf fallback", "pypdf text layer"],
            [".docx", "mammoth + markdownify"],
            [".hwp", "pyhwp"],
            [".xlsx .xls", "pandas + tabulate"],
            [".md .txt .csv .html", "passthrough / markdownify"],
          ].map(([ext, lib]) => (
            <div key={`${ext} · ${lib}`} className="rounded-xl px-3 py-2" style={{ background: T.panel2 }}>
              <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.accent }}>{ext}</div>
              <div style={{ fontFamily: T.sans, fontSize: 12, color: T.text }}>{lib}</div>
            </div>
          ))}
        </div>
      </div>

      <FlowArrow />

      {/* 1 — local boundary */}
      <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ border: `1px dashed ${T.accent}80`, background: `${T.accent}0D` }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Lock size={14} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, fontWeight: 700, letterSpacing: .5 }}>
            LOCAL BOUNDARY — CrewAI + Gemma detect · privacy.py validates and masks
          </span>
        </div>

        <div className="rounded-2xl p-4 flex flex-col gap-2" style={card}>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: .5, marginBottom: 2 }}>
            CREWAI SEQUENTIAL CHAIN — local Ollama only
          </div>
          {[
            ["1", "Sensitive Information Detector", "detect_sensitive_values", Search],
            ["2", "Risk Assessment & Decision Engine", "assess_risk", Activity],
            ["3", "Pseudonymization Engine", "pseudonymize_document", Repeat],
          ].map(([n, role, toolName, Icon]) => (
            <div key={n} className="flex items-center gap-2.5 rounded-xl px-3 py-2 flex-wrap" style={{ background: T.panel2 }}>
              <span className="rounded-full flex items-center justify-center shrink-0"
                style={{ width: 18, height: 18, background: `${T.accent}22`, color: T.accent, fontFamily: T.mono, fontSize: 10, fontWeight: 700 }}>{n}</span>
              <Icon size={13} color={T.muted} className="shrink-0" />
              <span style={{ fontFamily: T.sans, fontSize: 12.5, color: T.text }}>{role}</span>
              <span className="ml-auto rounded px-1.5 py-0.5" style={{ background: T.panel, color: T.accent2, fontFamily: T.mono, fontSize: 10 }}>
                {toolName}()
              </span>
            </div>
          ))}
          <p style={{ fontFamily: T.sans, fontSize: 11.5, color: T.muted, marginTop: 2, lineHeight: 1.6 }}>
            Gemma proposes contextual entities that fixed patterns may miss. Python accepts only exact
            substrings with approved entity types, merges them with deterministic findings, and performs
            every replacement and completion result.
          </p>
        </div>

        <FlowArrow />

        <ArchStage number="2" title="DECISION ENGINE — privacy.py · TAXONOMY" items={[
          { icon: Ban, label: "MASK — 주민번호, cards" },
          { icon: KeyRound, label: "PSEUDONYMIZE — the rest" },
          { icon: Check, label: "ALLOW — %, durations" },
        ]} />

        <FlowArrow />

        <div className="rounded-2xl p-4 flex flex-col gap-2" style={card}>
          <div className="flex items-center gap-2 mb-1">
            <Database size={14} color={T.accent} />
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: .5 }}>
              3 · SEMANTIC-PRESERVING MASKING
            </span>
          </div>
          <Row label="one scale factor" value="every amount → “20% of total” still checks out" />
          <Row label="one date offset" value="every date → “60 days before expiry” still holds" />
          <Row label="shape preserved" value="010-… stays 010-… · 000-00-00000 · Co., Ltd." />
          <Row label="unique aliases" value="two companies never collapse into one name" />
          <Row label="mapping store" value="in-process memory · never written to disk" tone={T.accent} />
        </div>

        <FlowArrow />

        <ArchStage number="4" title="OUTPUT PRIVACY SCANNER — runs twice" items={[
          { icon: Search, label: "after masking" },
          { icon: Shield, label: "on the outgoing payload" },
          { icon: CheckCircle2, label: "pseudonymization → complete" },
        ]} />
      </div>

      <FlowArrow />

      {/* 2 — external */}
      <div className="rounded-2xl p-4 flex flex-col gap-2.5" style={card}>
        <div className="flex items-center gap-2 flex-wrap">
          <Server size={14} color={T.accent2} />
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent2, letterSpacing: .5 }}>
            llm.py — the only outbound network code · masked Markdown only
          </span>
        </div>
        <Row label="chat model" value="OpenAI · Mistral · Ollama — your choice, key stays in the tab" />
        <Row label="agent model" value="local Ollama only (CREW_MODEL, default gemma4:12b)" />
        <Row label="security layer" value="hybrid: local Gemma detection + deterministic validation and masking" tone={T.accent} />
        <Row label="retrieval" value="none. whole masked document in the prompt — no RAG, no embeddings" />
        <Row label="history" value="replayed as MASKED answers, never the remapped ones" tone={T.accent} />
      </div>

      <FlowArrow />

      {/* 3 — return */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={card}>
          <div className="flex items-center gap-2 mb-0.5">
            <Unlock size={14} color={T.accent} />
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: .5 }}>REMAP — locally, no network</span>
          </div>
          {[[Repeat, "fake → real, longest match first"], [Ban, "MASK-ed values stay redacted"],
            [Lock, "real values live in server memory only"]].map(([Icon, label], i) => (
            <div key={i} className="flex items-center gap-2" style={{ fontFamily: T.sans, fontSize: 12.5, color: T.text }}>
              <Icon size={13} color={T.muted} />{label}
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={card}>
          <div className="flex items-center gap-2 mb-0.5">
            <ClipboardList size={14} color={T.accent} />
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: .5 }}>AUDIT LOG — per document</span>
          </div>
          {[[FileUp, "ingested — converter, size"], [Brain, "privacy_chain — engine, risk counts"],
            [Mail, "each query — provider, restored"], [Download, "export as Markdown"]].map(([Icon, label], i) => (
            <div key={i} className="flex items-center gap-2" style={{ fontFamily: T.sans, fontSize: 12.5, color: T.text }}>
              <Icon size={13} color={T.muted} />{label}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl px-4 py-3" style={{ background: T.panel2, border: `1px solid ${T.border}` }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, lineHeight: 1.7 }}>
          privacy.py imports no network library at all — raw values physically cannot leave through it.
          Full write-up in docs/ARCHITECTURE.md and docs/CONTEXT-AND-CHAT.md
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- app --- */
function App() {
  const [theme, setTheme] = useState("dark");
  const T = theme === "dark" ? DARK : LIGHT;
  const [docs, setDocs] = useState([]);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [topTab, setTopTab] = useState("home");
  const [demoTab, setDemoTab] = useState("upload");
  // Chat lives here, not in <ChatTab>, so leaving the tab does not throw the
  // conversation away. It stays in memory only — never in browser storage.
  const [chat, setChat] = useState({
    sessions: [{ id: "c1", title: "New chat", docUids: [], messages: [] }],
    activeId: "c1",
    provider: "ollama",
    model: PROVIDERS[0].defaultModel,
    apiKey: "",
    input: "",
  });

  const refresh = async (documents = null) =>
    setDocs(documents || (await api("/documents")).documents);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    api("/health").then(setHealth).catch(() => {});
  }, []);

  const TOP_TABS = [["home", "Home", HomeIcon], ["team", "Team", Users], ["architecture", "Architecture", Cpu], ["demo", "Demo", Sparkles]];
  const DEMO_TABS = [["upload", "Upload & Mask"], ["ner", "NER Tags"], ["chat", "Chat"], ["reconstruct", "Reconstruct"]];

  return (
    <ThemeCtx.Provider value={T}>
      <div className="p-6 md:p-10" style={{ background: T.bg, color: T.text, minHeight: "100vh", fontFamily: T.sans, transition: "background .2s, color .2s" }}>
        <div className="max-w-5xl mx-auto flex flex-col gap-8">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <button onClick={() => setTopTab("home")} className="flex items-center gap-2.5">
              <div className="rounded-xl p-2" style={{ background: T.panel, border: `1px solid ${topTab === "home" ? T.accent : T.border}` }}>
                <Shield size={18} color={T.accent} />
              </div>
              <div className="text-left">
                <div style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 15 }}>Privacy Agent</div>
                <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>local-first · pseudonymized</div>
              </div>
            </button>

            <div className="flex items-center gap-2">
              <div className="flex gap-1 rounded-xl p-1" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
                {TOP_TABS.map(([id, label, Icon]) => (
                  <button key={id} onClick={() => setTopTab(id)} className="rounded-lg px-3.5 py-2 text-sm flex items-center gap-1.5"
                    style={{ background: topTab === id ? T.accent : "transparent", color: topTab === id ? T.bg : T.muted, fontFamily: T.sans, fontWeight: 600 }}>
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
              <button onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} aria-label="Toggle light/dark mode"
                className="rounded-full p-2.5 flex items-center justify-center"
                style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.muted }}>
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>

          {topTab === "home" && <HomeTab onTryDemo={() => setTopTab("demo")} health={health} />}
          {topTab === "team" && <TeamTab />}
          {topTab === "architecture" && <ArchitectureTab />}
          {topTab === "demo" && (
            <div className="flex flex-col gap-6">
              <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: T.panel2, border: `1px solid ${T.border}` }}>
                {DEMO_TABS.map(([id, label]) => (
                  <button key={id} onClick={() => setDemoTab(id)} className="rounded-lg px-3.5 py-1.5 text-xs flex items-center gap-1.5"
                    style={{ background: demoTab === id ? T.accent : "transparent", color: demoTab === id ? T.bg : T.muted, fontFamily: T.mono, fontWeight: 600 }}>
                    {label} {demoTab === id && <ChevronRight size={12} />}
                  </button>
                ))}
              </div>
              {demoTab === "upload" && <UploadTab docs={docs} refresh={refresh} notify={setError} />}
              {demoTab === "ner" && <NerTagsTab notify={setError} />}
              {demoTab === "chat" && <ChatTab docs={docs} notify={setError} chat={chat} setChat={setChat}
                ollamaModels={health?.ollama_models || []} />}
              {demoTab === "reconstruct" && <ReconstructTab docs={docs} notify={setError} />}
            </div>
          )}
        </div>
        <Toast message={error} onClose={() => setError("")} />
      </div>
    </ThemeCtx.Provider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
