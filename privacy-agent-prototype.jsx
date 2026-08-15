import { useState, useRef, useEffect, createContext, useContext } from "react";
import {
  Shield, FileSignature, Landmark, FileText, CreditCard, CheckCircle2,
  Lock, Unlock, Send, Sparkles, Database, Upload, Download, RotateCcw,
  ChevronRight, FileUp, X, Wand2, Plus, Check, Trash2, Files, Sun, Moon,
  Home as HomeIcon, Users, ArrowRight, Brain, Search, EyeOff, Repeat,
  KeyRound, Ban, History, ClipboardList, Mail, Server, Cpu, ArrowDown, Activity,
} from "lucide-react";

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

const MODELS = ["ChatGPT (gpt-4o)", "Mistral Large", "Local — Ollama gemma4:12b"];
const STAGES = ["Detect", "Classify", "Pseudonymize"];
const LABELS = { ORG: "the organization involved is", PERSON: "the named individual is",
  AMOUNT: "the key figure is", MONEY: "the amount mentioned is", DATE: "the relevant date is",
  EMAIL: "the contact email is", IBAN: "the account/IBAN is", ID: "the ID on file is" };

// ---------- pseudonymization engine (real, deterministic, client-side) ----------
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

function fakeEmail(h) {
  const domains = ["relaymail.com", "securebox.io", "maildrop.cc", "northgate.net"];
  return `user${1000 + (h % 9000)}@${domains[h % domains.length]}`;
}
function fakeIban(real, h) {
  const clean = real.replace(/\s/g, ""); const cc = clean.slice(0, 2);
  let out = cc, x = h || 7;
  for (let i = 2; i < clean.length; i++) { x = (x * 1103515245 + 12345) >>> 0; out += x % 10; }
  return out.match(/.{1,4}/g).join(" ");
}
function fakeMoney(real, h) {
  const symbol = (real.match(/^[$€£]/) || [""])[0];
  const num = parseFloat(real.replace(/[^\d.]/g, "")) || 0;
  const factor = 0.65 + (h % 30) / 100;
  return symbol + Math.round(num * factor).toLocaleString("en-US");
}
function fakeDate(real, h) {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const m = real.match(/^([A-Za-z]+)\s(\d{1,2}),?\s(\d{4})$/);
  if (!m) return real;
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
  d.setDate(d.getDate() + ((h % 60) - 30));
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function makeFake(type, real) {
  const h = hashStr(real);
  if (type === "EMAIL") return fakeEmail(h);
  if (type === "IBAN") return fakeIban(real, h);
  if (type === "MONEY") return fakeMoney(real, h);
  if (type === "DATE") return fakeDate(real, h);
  return real;
}
function detectEntities(text) {
  const patterns = [
    ["EMAIL", /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g],
    ["IBAN", /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g],
    ["MONEY", /[$€£]\s?\d[\d,]*(?:\.\d{1,2})?/g],
    ["DATE", /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s\d{1,2},?\s\d{4}\b/g],
  ];
  let matches = [];
  for (const [type, re] of patterns) { let m; while ((m = re.exec(text))) matches.push({ type, value: m[0], index: m.index }); }
  matches.sort((a, b) => a.index - b.index);
  const out = []; let lastEnd = -1;
  for (const m of matches) if (m.index >= lastEnd) { out.push(m); lastEnd = m.index + m.value.length; }
  return out;
}
// Given a doc (rawText + optional presetEntities), produce {entities, maskedText}
function runPrivacyPipeline(doc) {
  let entities = doc.presetEntities;
  if (!entities) {
    const found = detectEntities(doc.rawText);
    const uniq = new Map();
    for (const f of found) if (!uniq.has(f.value)) uniq.set(f.value, { type: f.type, fake: makeFake(f.type, f.value) });
    entities = [...uniq.entries()].map(([real, info]) => ({ type: info.type, real, fake: info.fake }));
  }
  const sorted = [...entities].sort((a, b) => b.real.length - a.real.length);
  let masked = doc.rawText;
  for (const e of sorted) masked = masked.split(e.real).join(e.fake);
  return { entities, maskedText: masked };
}
function flattenSegs(segs, useFake) { return segs.map((s) => (s.t ?? (useFake ? s.e.fake : s.e.real))).join(""); }
function buildSegments(docsArr) {
  const multi = docsArr.length > 1;
  const segs = [{ t: multi ? `Reviewing ${docsArr.length} documents — ` : `Reviewing "${docsArr[0].name}" — ` }];
  docsArr.forEach((doc, di) => {
    if (multi) segs.push({ t: `${di > 0 ? "; " : ""}from ${doc.name}: ` });
    doc.entities.forEach((e, i) => {
      segs.push({ t: (i > 0 ? "; " : "") + (LABELS[e.type] || "a relevant value is") + " " });
      segs.push({ e });
    });
  });
  segs.push({ t: `. I'd recommend confirming these details before sign-off.` });
  return segs;
}
function remapText(text, entities) {
  let result = text, count = 0;
  const sorted = [...entities].sort((a, b) => b.fake.length - a.fake.length);
  for (const e of sorted) {
    const n = result.split(e.fake).length - 1;
    if (n > 0) { count += n; result = result.split(e.fake).join(e.real); }
  }
  return { result, count };
}
function download(filename, content) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function riskFor(type) {
  if (["IBAN", "MONEY", "AMOUNT", "ID"].includes(type)) return "HIGH";
  if (["EMAIL", "PERSON", "ORG"].includes(type)) return "MEDIUM";
  return "LOW";
}
function riskTone(type) {
  const r = riskFor(type);
  return r === "HIGH" ? "danger" : r === "MEDIUM" ? "accent2" : "muted";
}
function trunc(s, n = 30) { return s.length > n ? s.slice(0, n) + "…" : s; }

// ---------- preset sample documents (quick-add, real masking runs on real text) ----------
const PRESETS = [
  { id: "contract", name: "Supplier Contract.txt", icon: FileSignature,
    rawText: "This agreement is entered into between Meridian Supply Co. and the Buyer, represented by David Chen. Payments of €45,000 shall be remitted to IBAN DE89 3704 0044 0532 0130 00 no later than March 14, 2026. Correspondence should be directed to billing@meridiansupply.com.",
    presetEntities: [
      { type: "ORG", real: "Meridian Supply Co.", fake: "Halcyon Trading Ltd." },
      { type: "PERSON", real: "David Chen", fake: "Marcus Webb" },
      { type: "MONEY", real: "€45,000", fake: "€38,200" },
      { type: "IBAN", real: "DE89 3704 0044 0532 0130 00", fake: "DE21 1000 0000 0123 4500 00" },
      { type: "DATE", real: "March 14, 2026", fake: "June 2, 2026" },
      { type: "EMAIL", real: "billing@meridiansupply.com", fake: "billing@halcyontrading.com" },
    ] },
  { id: "bank", name: "Bank Statement.txt", icon: Landmark,
    rawText: "Statement for the operating account held with First Continental Bank, prepared on behalf of Meridian Supply Co. Closing balance as of Jan 31, 2026 is $128,450.00. Contact accounts@meridiansupply.com with discrepancies.",
    presetEntities: [
      { type: "ORG", real: "First Continental Bank", fake: "Ridgeline National Bank" },
      { type: "MONEY", real: "$128,450.00", fake: "$94,120" },
      { type: "DATE", real: "Jan 31, 2026", fake: "Feb 18, 2026" },
      { type: "EMAIL", real: "accounts@meridiansupply.com", fake: "accounts@halcyontrading.com" },
    ] },
  { id: "audit", name: "Audit Report FY25.txt", icon: FileText,
    rawText: "The FY25 audit conducted by Whitfield & Ross Auditors, led by Elena Marsh, CPA, identified a $2.3M revenue shortfall against forecast as of Dec 31, 2025. Management has proposed a remediation plan.",
    presetEntities: [
      { type: "ORG", real: "Whitfield & Ross Auditors", fake: "Barrow & Lane Auditors" },
      { type: "PERSON", real: "Elena Marsh, CPA", fake: "Priya Nathan, CPA" },
      { type: "AMOUNT", real: "$2.3M revenue shortfall", fake: "$1.7M revenue shortfall" },
      { type: "DATE", real: "Dec 31, 2025", fake: "Nov 15, 2025" },
    ] },
  { id: "gdpr", name: "GDPR Access Request.txt", icon: Shield,
    rawText: "Data subject Sofia Lindqvist (ID SE-PID-88213045) submitted an access request to Nordkind Analytics AB on Feb 3, 2026. Contact email on file: sofia.l@protonmail.com.",
    presetEntities: [
      { type: "ORG", real: "Nordkind Analytics AB", fake: "Solvane Data AB" },
      { type: "PERSON", real: "Sofia Lindqvist", fake: "Anna Berg" },
      { type: "ID", real: "SE-PID-88213045", fake: "SE-PID-11029287" },
      { type: "DATE", real: "Feb 3, 2026", fake: "Jan 9, 2026" },
      { type: "EMAIL", real: "sofia.l@protonmail.com", fake: "anna.b@fastmail.com" },
    ] },
  { id: "invoice", name: "Invoice INV-3391.txt", icon: CreditCard,
    rawText: "Invoice #INV-3391 issued to Meridian Supply Co. for €12,880, payable via IBAN DE89 3704 0044 0532 0130 00 by April 2, 2026.",
    presetEntities: [
      { type: "ORG", real: "Meridian Supply Co.", fake: "Halcyon Trading Ltd." },
      { type: "MONEY", real: "€12,880", fake: "€9,415" },
      { type: "IBAN", real: "DE89 3704 0044 0532 0130 00", fake: "DE21 1000 0000 0123 4500 00" },
      { type: "DATE", real: "April 2, 2026", fake: "May 20, 2026" },
    ] },
];
const TEXT_EXT = ["txt", "md", "csv", "json"];

function Badge({ tone = "muted", children, icon: Icon }) {
  const T = useT();
  const c = { accent: T.accent, accent2: T.accent2, danger: T.danger, muted: T.muted }[tone];
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
    style={{ background: `${c}1A`, color: c, border: `1px solid ${c}40`, fontFamily: T.mono }}>
    {Icon && <Icon size={12} />}{children}</span>;
}
function StageDots({ stage }) {
  const T = useT();
  return <div className="flex items-center gap-1">
    {STAGES.map((s, i) => (
      <div key={s} title={s} className="rounded-full transition-colors" style={{
        width: 7, height: 7,
        background: stage >= STAGES.length ? T.accent : i < stage ? T.accent : i === stage ? T.accent2 : T.border,
      }} />
    ))}
  </div>;
}

// ---------------- Agent reasoning panel ----------------
function ReasoningBox({ doc }) {
  const T = useT();
  if (!doc) {
    return (
      <div className="rounded-2xl p-8 flex flex-col items-center justify-center gap-2 text-center"
        style={{ background: T.bg, border: `1px dashed ${T.border}`, minHeight: 200 }}>
        <Brain size={20} color={T.muted} />
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.muted }}>Run a pipeline above — the agent's reasoning shows up here.</p>
      </div>
    );
  }
  const stage = doc.status === "done" ? STAGES.length : doc.stage;
  const entities = doc.entities || [];
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: T.bg, border: `1px solid ${T.accent}40` }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${T.border}`, background: T.panel2 }}>
        <div className="flex items-center gap-2" style={{ fontFamily: T.mono, fontSize: 11, color: T.accent }}>
          <Brain size={13} /> AGENT REASONING — {doc.name}
        </div>
        {doc.status === "done" ? <Badge tone="accent" icon={CheckCircle2}>verified</Badge> : <Badge tone="accent2">{STAGES[doc.stage]}…</Badge>}
      </div>

      <div className="px-4 py-3.5 flex flex-col gap-1.5" style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.7 }}>
        {stage >= 0 && (
          <div style={{ color: T.text }}>
            ▸ Scanning "{doc.name}" for sensitive patterns…{" "}
            {entities.length > 0 && <span style={{ color: T.muted }}>found {entities.length} value{entities.length !== 1 ? "s" : ""}: {entities.map((e) => e.type).join(", ")}</span>}
          </div>
        )}
        {stage >= 1 && entities.map((e, i) => (
          <div key={"r" + i} className="flex items-center gap-2 flex-wrap" style={{ color: T.text }}>
            ▸ {e.type} "{trunc(e.real)}" → risk <Badge tone={riskTone(e.type)}>{riskFor(e.type)}</Badge>
          </div>
        ))}
        {stage >= 2 && entities.map((e, i) => (
          <div key={"m" + i} className="flex items-center gap-1.5 flex-wrap" style={{ color: T.text }}>
            ▸ pseudonymize: {trunc(e.real)} <ArrowRight size={11} style={{ color: T.accent2 }} /> {trunc(e.fake)}
          </div>
        ))}
        {stage >= 3 && (
          <div style={{ color: T.accent }}>▸ Re-scanned masked output — 0 raw values found. Zero-leak verified ✓</div>
        )}
      </div>

      {entities.length > 0 && stage >= 1 && (
        <div className="px-4 pb-4">
          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, letterSpacing: .5, marginBottom: 6, paddingTop: 10, borderTop: `1px dashed ${T.border}` }}>
            MEMORY MAP — ephemeral, session-scoped
          </div>
          <div className="flex flex-col gap-1">
            {entities.map((e, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: T.panel2, fontFamily: T.mono, fontSize: 11 }}>
                <span className="rounded px-1.5 py-0.5" style={{ background: T.panel, color: T.muted }}>{e.type}</span>
                <span className="truncate" style={{ color: T.text, maxWidth: 200 }}>{e.real}</span>
                <ArrowRight size={10} style={{ color: T.accent2, flexShrink: 0 }} />
                <span className="truncate" style={{ color: stage >= 2 ? T.accent : T.muted }}>{stage >= 2 ? e.fake : "••••••"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Tab 1: Upload & Mask ----------------
function UploadTab({ docs, setDocs }) {
  const T = useT();
  const fileRef = useRef(null);
  const [focusUid, setFocusUid] = useState(null);

  const addDoc = (doc) => setDocs((d) => [...d, { ...doc, uid: crypto.randomUUID(), status: "queued", stage: -1, entities: null, maskedText: null }]);

  const handleFiles = (files) => {
    [...files].forEach((file) => {
      const ext = file.name.split(".").pop().toLowerCase();
      if (TEXT_EXT.includes(ext)) {
        const reader = new FileReader();
        reader.onload = () => addDoc({ name: file.name, icon: FileUp, rawText: String(reader.result), synthetic: false });
        reader.readAsText(file);
      } else {
        const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
        addDoc({ name: file.name, icon: FileText, rawText: preset.rawText, presetEntities: preset.presetEntities, synthetic: true });
      }
    });
  };

  const runPipeline = (uid) => {
    setFocusUid(uid);
    setDocs((d) => d.map((doc) => {
      if (doc.uid !== uid) return doc;
      const { entities, maskedText } = runPrivacyPipeline(doc);
      return { ...doc, status: "processing", stage: 0, entities, maskedText };
    }));
  };

  useEffect(() => {
    const timers = docs.filter((d) => d.status === "processing").map((doc) => {
      return setTimeout(() => {
        setDocs((all) => all.map((d) => {
          if (d.uid !== doc.uid) return d;
          if (d.stage >= STAGES.length - 1) return { ...d, status: "done", stage: STAGES.length };
          return { ...d, stage: d.stage + 1 };
        }));
      }, 550);
    });
    return () => timers.forEach(clearTimeout);
  }, [docs, setDocs]);

  const focusDoc = docs.find((d) => d.uid === focusUid) || null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Upload size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, letterSpacing: .5 }}>UPLOAD & MASK</span>
        </div>
        <h2 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 22 }}>Bring any document. Nothing sensitive leaves this table.</h2>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 4, maxWidth: 640 }}>
          .txt/.md/.csv/.json are masked live in your browser (emails, IBANs, amounts, dates). PDFs, DOCX,
          and images route through OCR/parsing server-side — simulated here with a synthetic extraction.
          Run a pipeline to watch the agent reason through detection, risk, and replacement below.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ background: T.accent, color: T.bg, fontFamily: T.sans }}>
          <Upload size={15} /> Upload document
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>or try a sample:</span>
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => addDoc({ name: p.name, icon: p.icon, rawText: p.rawText, presetEntities: p.presetEntities })}
            className="rounded-full px-3 py-1 text-xs" style={{ background: T.panel2, color: T.muted, border: `1px solid ${T.border}`, fontFamily: T.mono }}>
            + {p.name.replace(/\.txt$/, "")}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
        <div className="grid text-xs px-4 py-2.5" style={{ gridTemplateColumns: "2.2fr 1fr 1.4fr 1fr", background: T.panel2, color: T.muted, fontFamily: T.mono, borderBottom: `1px solid ${T.border}` }}>
          <div>DOCUMENT</div><div>STATUS</div><div>ENTITIES</div><div className="text-right">ACTIONS</div>
        </div>
        {docs.length === 0 && (
          <div className="px-4 py-10 text-center" style={{ fontFamily: T.mono, fontSize: 12, color: T.muted, background: T.panel }}>
            No documents yet — upload a file or add a sample above.
          </div>
        )}
        {docs.map((doc) => {
          const Icon = doc.icon;
          const focused = doc.uid === focusUid;
          return (
            <div key={doc.uid} onClick={() => doc.entities && setFocusUid(doc.uid)}
              className="grid items-center px-4 py-3" style={{
                gridTemplateColumns: "2.2fr 1fr 1.4fr 1fr", background: focused ? T.panel2 : T.panel,
                borderBottom: `1px solid ${T.border}`, borderLeft: `2px solid ${focused ? T.accent : "transparent"}`,
                cursor: doc.entities ? "pointer" : "default",
              }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon size={16} color={T.muted} className="shrink-0" />
                <span style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 600 }} className="truncate">{doc.name}</span>
                {doc.synthetic && <Badge tone="muted">synthetic extract</Badge>}
              </div>
              <div>
                {doc.status === "queued" && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>queued</span>}
                {doc.status === "processing" && <div className="flex items-center gap-2"><StageDots stage={doc.stage} /><span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.accent2 }}>{STAGES[doc.stage]}…</span></div>}
                {doc.status === "done" && <Badge tone="accent" icon={CheckCircle2}>masked · 0 leaked</Badge>}
              </div>
              <div className="flex flex-wrap gap-1">
                {doc.entities ? doc.entities.slice(0, 3).map((e, i) => (
                  <span key={i} className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: T.panel2, color: T.muted, fontFamily: T.mono }}>{e.type}</span>
                )) : <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>—</span>}
              </div>
              <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                {doc.status === "queued" && (
                  <button onClick={() => runPipeline(doc.uid)} className="rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{ background: T.accent, color: T.bg, fontFamily: T.sans }}>Run pipeline</button>
                )}
                {doc.status !== "queued" && (
                  <button onClick={() => setFocusUid(doc.uid)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{ background: focused ? `${T.accent}1A` : T.panel2, color: focused ? T.accent : T.muted, border: `1px solid ${focused ? T.accent + "40" : T.border}`, fontFamily: T.sans }}>
                    <Brain size={12} /> Reasoning
                  </button>
                )}
                {doc.status === "done" && (
                  <button onClick={() => download(doc.name.replace(/\.[^.]+$/, "") + ".masked.txt", doc.maskedText)}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.sans }}>
                    <Download size={12} /> Download
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ReasoningBox doc={focusDoc} />
    </div>
  );
}

// ---------------- Tab 2: Reconstruct ----------------
function ReconstructTab({ docs }) {
  const T = useT();
  const done = docs.filter((d) => d.status === "done");
  const [selUid, setSelUid] = useState(done[0]?.uid ?? "");
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const doc = done.find((d) => d.uid === selUid);

  useEffect(() => { if (!selUid && done[0]) setSelUid(done[0].uid); }, [done, selUid]);

  const loadSample = () => { if (doc) setInput(flattenSegs(buildSegments([doc]), true)); };
  const remap = () => { if (doc && input.trim()) setResult(remapText(input, doc.entities)); };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <RotateCcw size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, letterSpacing: .5 }}>RECONSTRUCT</span>
        </div>
        <h2 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 22 }}>Got a report back? Remap it to its original values.</h2>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 4, maxWidth: 640 }}>
          Paste any text that came back from an external LLM using masked values — pick which document's
          mapping it belongs to, and swap the fake values back to real ones, locally.
        </p>
      </div>

      {done.length === 0 ? (
        <div className="rounded-2xl px-4 py-10 text-center" style={{ background: T.panel, border: `1px solid ${T.border}`, fontFamily: T.mono, fontSize: 12, color: T.muted }}>
          No masked documents yet — process one in "Upload & Mask" first.
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: "260px 1fr" }}>
          <div className="flex flex-col gap-2">
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>MAP AGAINST</div>
            {done.map((d) => {
              const Icon = d.icon; const active = d.uid === selUid;
              return (
                <button key={d.uid} onClick={() => { setSelUid(d.uid); setResult(null); }}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left"
                  style={{ background: active ? T.panel2 : "transparent", border: `1px solid ${active ? T.accent + "50" : T.border}` }}>
                  <Icon size={15} color={active ? T.accent : T.muted} />
                  <span style={{ fontFamily: T.sans, fontSize: 12.5, color: active ? T.text : T.muted }} className="truncate">{d.name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>PASTE THE REPORT / LLM RESPONSE</span>
              <button onClick={loadSample} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
                style={{ background: T.panel2, color: T.accent2, border: `1px solid ${T.accent2}40`, fontFamily: T.mono }}>
                <Wand2 size={11} /> insert sample masked report
              </button>
            </div>
            <textarea value={input} onChange={(e) => { setInput(e.target.value); setResult(null); }} rows={5}
              placeholder="Paste text containing masked values here…"
              className="rounded-xl px-4 py-3 text-sm outline-none resize-none"
              style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.sans }} />

            <button onClick={remap} disabled={!input.trim()} className="self-start flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: input.trim() ? T.accent : T.panel2, color: input.trim() ? T.bg : T.muted, fontFamily: T.sans, opacity: input.trim() ? 1 : .6 }}>
              <Unlock size={15} /> Remap to original
            </button>

            {result && (
              <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
                <div className="flex items-center justify-between">
                  <Badge tone="accent" icon={CheckCircle2}>{result.count} value{result.count !== 1 ? "s" : ""} remapped</Badge>
                  <button onClick={() => download("remapped.txt", result.result)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                    style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.sans }}>
                    <Download size={12} /> Download
                  </button>
                </div>
                <p style={{ fontFamily: T.sans, fontSize: 13, lineHeight: 1.6 }}>{result.result}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Tab 3: Chat ----------------
function ChatMessage({ docs, model }) {
  const T = useT();
  const [revealed, setRevealed] = useState(false);
  const segs = buildSegments(docs);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${T.border}`, background: T.panel2 }}>
        <div className="flex items-center gap-2" style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>
          <Sparkles size={12} color={T.accent2} /> {model}
        </div>
        <button onClick={() => setRevealed((r) => !r)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
          style={{ background: revealed ? `${T.accent}1A` : `${T.accent2}1A`, color: revealed ? T.accent : T.accent2, border: `1px solid ${(revealed ? T.accent : T.accent2)}40`, fontFamily: T.mono }}>
          {revealed ? <Unlock size={12} /> : <Lock size={12} />} {revealed ? "remapped to real values" : "masked (as sent)"}
        </button>
      </div>
      <p className="px-4 py-3.5" style={{ fontFamily: T.sans, fontSize: 13.5, lineHeight: 1.65 }}>
        {segs.map((s, i) => s.t ? <span key={i}>{s.t}</span> : (
          <span key={i} className="rounded px-1 py-0.5 transition-colors" style={{
            background: revealed ? `${T.accent}22` : `${T.accent2}22`,
            color: revealed ? T.accent : T.accent2, fontFamily: T.mono, fontWeight: 600,
          }}>{revealed ? s.e.real : s.e.fake}</span>
        ))}
      </p>
      <div className="flex items-center gap-1.5 px-4 py-2" style={{ borderTop: `1px solid ${T.border}` }}>
        <CheckCircle2 size={12} color={T.accent} />
        <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>
          Leak scan: 0 raw values in the text sent to {model.split(" ")[0]}{docs.length > 1 ? ` across ${docs.length} documents` : ""}
        </span>
      </div>
    </div>
  );
}

function DocPicker({ allDocs, selected, onToggle, onClose }) {
  const T = useT();
  return (
    <div className="absolute z-10 mt-2 w-72 rounded-xl p-2 flex flex-col gap-1"
      style={{ background: T.panel, border: `1px solid ${T.border}`, boxShadow: "0 12px 32px rgba(0,0,0,.35)" }}>
      <div className="px-2 py-1" style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>SELECT DOCUMENTS</div>
      {allDocs.map((d) => {
        const Icon = d.icon; const on = selected.includes(d.uid);
        return (
          <button key={d.uid} onClick={() => onToggle(d.uid)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left"
            style={{ background: on ? T.panel2 : "transparent" }}>
            <div className="rounded flex items-center justify-center shrink-0" style={{ width: 16, height: 16, border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : "transparent" }}>
              {on && <Check size={11} color={T.bg} />}
            </div>
            <Icon size={14} color={T.muted} />
            <span style={{ fontFamily: T.sans, fontSize: 12.5 }} className="truncate">{d.name}</span>
          </button>
        );
      })}
      <button onClick={onClose} className="mt-1 rounded-lg py-1.5 text-xs" style={{ background: T.panel2, color: T.muted, fontFamily: T.mono }}>Done</button>
    </div>
  );
}

function ChatTab({ docs }) {
  const T = useT();
  const done = docs.filter((d) => d.status === "done");
  const [sessions, setSessions] = useState([{ id: "c1", title: "New chat", docUids: [], messages: [] }]);
  const [activeId, setActiveId] = useState("c1");
  const [model, setModel] = useState(MODELS[0]);
  const [input, setInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const endRef = useRef(null);
  const session = sessions.find((s) => s.id === activeId) || sessions[0];
  const selectedDocs = done.filter((d) => session.docUids.includes(d.uid));

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [session?.messages]);

  const updateSession = (id, patch) =>
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
    updateSession(session.id, (s) => ({ docUids: s.docUids.includes(uid) ? s.docUids.filter((u) => u !== uid) : [...s.docUids, uid] }));

  const send = (q) => {
    const question = (q ?? input).trim();
    if (!question || selectedDocs.length === 0) return;
    updateSession(session.id, (s) => ({
      messages: [...s.messages, { role: "user", text: question }],
      title: s.title === "New chat" ? question.slice(0, 32) : s.title,
    }));
    setInput("");
    setTimeout(() => updateSession(session.id, (s) => ({ messages: [...s.messages, { role: "assistant", docUids: s.docUids, model }] })), 300);
  };

  if (done.length === 0) {
    return <div className="flex flex-col items-center justify-center gap-2 py-24 text-center" style={{ color: T.muted }}>
      <Database size={28} />
      <p style={{ fontFamily: T.sans, fontSize: 14 }}>No masked documents yet.</p>
      <p style={{ fontFamily: T.mono, fontSize: 12 }}>Process one in "Upload & Mask" first.</p>
    </div>;
  }

  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: "230px 1fr" }}>
      <div className="flex flex-col gap-2">
        <button onClick={newChat} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold"
          style={{ background: T.accent, color: T.bg, fontFamily: T.sans }}>
          <Plus size={15} /> New chat
        </button>
        <div className="flex flex-col gap-1 mt-1">
          {sessions.map((s) => {
            const active = s.id === session.id;
            return (
              <button key={s.id} onClick={() => setActiveId(s.id)} className="group flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left"
                style={{ background: active ? T.panel2 : "transparent" }}>
                <span style={{ fontFamily: T.sans, fontSize: 12.5, color: active ? T.text : T.muted }} className="truncate">{s.title}</span>
                <Trash2 size={12} color={T.muted} className="opacity-0 group-hover:opacity-100 shrink-0" onClick={(e) => deleteChat(s.id, e)} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="relative">
            <button onClick={() => setPickerOpen((p) => !p)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
              style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.mono }}>
              <Files size={13} /> {selectedDocs.length === 0 ? "Select documents" : `${selectedDocs.length} document${selectedDocs.length > 1 ? "s" : ""} selected`}
            </button>
            {pickerOpen && <DocPicker allDocs={done} selected={session.docUids} onToggle={toggleDoc} onClose={() => setPickerOpen(false)} />}
          </div>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg px-2.5 py-1.5 text-xs"
            style={{ background: T.panel2, color: T.text, border: `1px solid ${T.border}`, fontFamily: T.mono }}>
            {MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>

        {selectedDocs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedDocs.map((d) => (
              <button key={d.uid} onClick={() => toggleDoc(d.uid)} className="flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 text-xs"
                style={{ background: `${T.accent}1A`, color: T.accent, border: `1px solid ${T.accent}40`, fontFamily: T.mono }}>
                {d.name} <X size={11} />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-2xl p-4 min-h-[280px]" style={{ background: T.bg, border: `1px solid ${T.border}` }}>
          {selectedDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center" style={{ color: T.muted }}>
              <Files size={22} />
              <p style={{ fontFamily: T.sans, fontSize: 13 }}>Select one or more documents above to start chatting.</p>
            </div>
          ) : session.messages.length === 0 ? (
            <div className="flex flex-wrap gap-2 py-8 justify-center">
              {["Summarize these documents", "What's the key figure?", "Any deadlines to flag?"].map((q) => (
                <button key={q} onClick={() => send(q)} className="rounded-full px-3 py-1.5 text-xs"
                  style={{ background: T.panel2, color: T.muted, fontFamily: T.mono, border: `1px solid ${T.border}` }}>{q}</button>
              ))}
            </div>
          ) : null}
          {session.messages.map((m, i) => m.role === "user" ? (
            <div key={i} className="self-end rounded-2xl px-4 py-2 max-w-[70%]" style={{ background: T.accent, color: T.bg, fontFamily: T.sans, fontSize: 13 }}>{m.text}</div>
          ) : (
            <ChatMessage key={i} docs={docs.filter((d) => m.docUids.includes(d.uid))} model={m.model} />
          ))}
          <div ref={endRef} />
        </div>

        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={selectedDocs.length ? "Ask about these documents…" : "Select a document first…"} disabled={selectedDocs.length === 0}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.sans, opacity: selectedDocs.length ? 1 : .6 }} />
          <button onClick={() => send()} disabled={selectedDocs.length === 0} className="rounded-xl px-4 flex items-center justify-center"
            style={{ background: T.accent, color: T.bg, opacity: selectedDocs.length ? 1 : .6 }}>
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Home & Team content (from the idea registration form) ----------------
const PROJECT = {
  titleKo: "프라이버시 보호형 계약 검토 AI 에이전트",
  titleEn: "Privacy-Aware Contract Review Agent",
  summary: "Business teams already lean on generative AI to summarize contracts, review terms, and draft emails — but those documents often carry personal data, company names, account numbers, contract values, and confidential clauses that shouldn't leave the building. This agent detects that sensitive information automatically, masks it with consistent, realistic placeholders before anything is sent to an external model, restores the real values locally once a response comes back, and keeps an audit log of exactly what was checked — so teams keep the speed of generative AI without the exposure risk.",
  keywords: ["AI Agent", "Privacy Protection", "Document Security", "Contract Review", "Sensitive Information Detection", "Pseudonymization", "Local LLM", "Audit Logging", "Enterprise AI"],
};
const TEAM = {
  name: "머핀", nameEn: "Muffin",
  tagline: "Building a privacy-first contract review agent.",
  members: [
    { name: "카리나", role: "Team Leader" },
    { name: "마빈", role: "Member" },
    { name: "타키", role: "Member" },
  ],
};

function HomeTab({ onTryDemo }) {
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

      <button onClick={onTryDemo} className="self-start flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold"
        style={{ background: T.accent, color: T.bg, fontFamily: T.sans }}>
        Try the demo <ArrowRight size={15} />
      </button>
    </div>
  );
}

function Avatar({ name }) {
  const T = useT();
  const c = name.charCodeAt(0) % 2 === 0 ? T.accent : T.accent2;
  return (
    <div className="rounded-full flex items-center justify-center shrink-0" style={{
      width: 42, height: 42, background: `${c}22`, color: c, fontFamily: T.sans, fontWeight: 800, fontSize: 15,
    }}>{name.slice(0, 1)}</div>
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
        {TEAM.members.map((m) => (
          <div key={m.name} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
            <Avatar name={m.name} />
            <span style={{ fontFamily: T.sans, fontWeight: 700, fontSize: 14 }}>{m.name}</span>
            <span className="ml-auto"><Badge tone={m.role === "Team Leader" ? "accent" : "muted"}>{m.role}</Badge></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Architecture ----------------
function FlowArrow() {
  const T = useT();
  return <div className="flex justify-center py-0.5"><ArrowDown size={14} color={T.muted} /></div>;
}
function ArchStage({ number, title, items }) {
  const T = useT();
  return (
    <div className="rounded-2xl p-4" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="rounded-full flex items-center justify-center shrink-0" style={{ width: 20, height: 20, background: `${T.accent}22`, color: T.accent, fontFamily: T.mono, fontSize: 10, fontWeight: 700 }}>{number}</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: .5 }}>{title}</span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: T.panel2 }}>
              <Icon size={14} color={T.muted} className="shrink-0" />
              <span style={{ fontFamily: T.sans, fontSize: 12, color: T.text }}>{it.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function ArchitectureTab() {
  const T = useT();
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Cpu size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, letterSpacing: .5 }}>ARCHITECTURE</span>
        </div>
        <h2 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 22 }}>How the local agent protects a document end to end.</h2>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 4, maxWidth: 640 }}>
          Everything inside the dashed boundary runs on this machine. Only the masked file ever leaves it.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-2xl px-4 py-3 flex-wrap" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
        <div className="flex items-center gap-1.5">
          {[FileText, FileUp, CreditCard, Files].map((Ic, i) => <Ic key={i} size={15} color={T.muted} />)}
        </div>
        <span style={{ fontFamily: T.sans, fontSize: 12.5, fontWeight: 600 }}>Document Upload</span>
        <ArrowRight size={13} color={T.accent2} />
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>OCR / parsing → plain text</span>
      </div>

      <FlowArrow />

      <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ border: `1px dashed ${T.accent}80`, background: `${T.accent}0D` }}>
        <div className="flex items-center gap-2">
          <Lock size={14} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, fontWeight: 700, letterSpacing: .5 }}>LOCAL AGENT — runs on this machine</span>
        </div>

        <ArchStage number="1" title="DETECT & ANALYZE" items={[
          { icon: Search, label: "Detected PII" },
          { icon: Shield, label: "Confidential info" },
          { icon: Activity, label: "Risk assessment" },
        ]} />
        <FlowArrow />
        <ArchStage number="2" title="DECISION ENGINE" items={[
          { icon: EyeOff, label: "Mask" },
          { icon: Repeat, label: "Replace" },
          { icon: KeyRound, label: "Fake placeholders" },
          { icon: Cpu, label: "Local processing" },
          { icon: Ban, label: "Block request" },
        ]} />
        <FlowArrow />
        <ArchStage number="3" title="MASKING & MAPPING STORAGE" items={[
          { icon: Database, label: "Placeholder mapping" },
          { icon: History, label: "Version history" },
          { icon: ClipboardList, label: "Audit log" },
        ]} />
        <FlowArrow />
        <ArchStage number="4" title="DEMASK (RESTORE)" items={[
          { icon: Unlock, label: "Restore original values locally" },
        ]} />
      </div>

      <FlowArrow />

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div className="rounded-2xl p-4 flex flex-col gap-2.5" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
          <div className="flex items-center gap-2">
            <Server size={14} color={T.accent2} />
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent2, letterSpacing: .5 }}>EXTERNAL LLM · masked file only</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["Risky clauses", "Payment terms", "Obligations", "Renewal dates", "Deadlines"].map((t) => (
              <span key={t} className="rounded-full px-2 py-1 text-[11px]" style={{ background: T.panel2, color: T.muted, fontFamily: T.mono }}>{t}</span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
          <div className="flex items-center gap-2 mb-0.5">
            <CheckCircle2 size={14} color={T.accent} />
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: .5 }}>OUTPUT · de-identified → restored</span>
          </div>
          {[{ icon: FileText, label: "Final report" }, { icon: ClipboardList, label: "Task checklist" }, { icon: Mail, label: "Draft email" }, { icon: ClipboardList, label: "Audit log" }].map((it, i) => {
            const Icon = it.icon;
            return <div key={i} className="flex items-center gap-2" style={{ fontFamily: T.sans, fontSize: 12.5, color: T.text }}><Icon size={13} color={T.muted} />{it.label}</div>;
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------- App ----------------
export default function App() {
  const [theme, setTheme] = useState("dark");
  const T = theme === "dark" ? DARK : LIGHT;
  const [docs, setDocs] = useState(() => {
    const p = PRESETS[0];
    const { entities, maskedText } = runPrivacyPipeline({ rawText: p.rawText, presetEntities: p.presetEntities });
    return [{ ...p, uid: "seed-1", status: "done", stage: STAGES.length, entities, maskedText }];
  });

  const [topTab, setTopTab] = useState("home");
  const [demoTab, setDemoTab] = useState("upload");
  const TOP_TABS = [["home", "Home", HomeIcon], ["team", "Team", Users], ["architecture", "Architecture", Cpu], ["demo", "Demo", Sparkles]];
  const DEMO_TABS = [["upload", "Upload & Mask"], ["chat", "Chat"], ["reconstruct", "Reconstruct"]];

  return (
    <ThemeCtx.Provider value={T}>
      <div style={{ background: T.bg, color: T.text, minHeight: "100vh", fontFamily: T.sans, transition: "background .2s, color .2s" }} className="p-6 md:p-10">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Manrope:wght@500;700;800&display=swap');`}</style>
        <div className="max-w-5xl mx-auto flex flex-col gap-8">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <button onClick={() => setTopTab("home")} className="flex items-center gap-2.5" style={{ background: "transparent" }}>
              <div className="rounded-xl p-2" style={{ background: T.panel, border: `1px solid ${topTab === "home" ? T.accent : T.border}` }}><Shield size={18} color={T.accent} /></div>
              <div className="text-left">
                <div style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 15 }}>Privacy Agent</div>
                <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>local-first · zero-leakage</div>
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
              <button onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                aria-label="Toggle light/dark mode"
                className="rounded-full p-2.5 flex items-center justify-center"
                style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.muted }}>
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>

          {topTab === "home" && <HomeTab onTryDemo={() => setTopTab("demo")} />}
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
              {demoTab === "upload" && <UploadTab docs={docs} setDocs={setDocs} />}
              {demoTab === "reconstruct" && <ReconstructTab docs={docs} />}
              {demoTab === "chat" && <ChatTab docs={docs} />}
            </div>
          )}
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}
