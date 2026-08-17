import React, { useState, useRef, useEffect, createContext, useContext } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import ReactMarkdown from "https://esm.sh/react-markdown@9?deps=react@18.3.1";
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
  text: "#E7EDF2", muted: "#8592A0", accent: "#DF7B34", accent2: "#E8A33D", onAccent: "#231207",
  danger: "#FF5D6C", mono: "'IBM Plex Mono', ui-monospace, monospace",
  sans: "'Manrope', ui-sans-serif, system-ui",
};
const LIGHT = {
  bg: "#FFFCF8", panel: "#FFFFFF", panel2: "#F7E5D3", border: "#E8D4BF",
  text: "#14181D", muted: "#5B6470", accent: "#DF7B34", accent2: "#B96E11", onAccent: "#231207",
  danger: "#D3374A", mono: "'IBM Plex Mono', ui-monospace, monospace",
  sans: "'Manrope', ui-sans-serif, system-ui",
};
const ThemeCtx = createContext(DARK);
const useT = () => useContext(ThemeCtx);

const STAGES = ["Detect", "Classify", "Pseudonymize", "Verify"];
const PROVIDERS = [
  { id: "ollama", label: "Local — Ollama", defaultModel: "gemma4:12b", needsKey: false },
  { id: "openai", label: "ChatGPT — OpenAI", defaultModel: "gpt-4o-mini", needsKey: true },
  { id: "anthropic", label: "Claude — Anthropic", defaultModel: "claude-sonnet-4-20250514", needsKey: true },
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
const KO = {
  "Privacy-Aware Contract Review Agent": "프라이버시 보호형 계약 검토 AI 에이전트",
  "Business teams already lean on generative AI to summarize contracts, review terms, and draft emails — but those documents carry personal data, company names, account numbers, contract values, and confidential clauses that shouldn't leave the building. This agent converts any document to Markdown, detects that sensitive information automatically, masks it with consistent and realistic placeholders before anything is sent to an external model, restores the real values locally once a response comes back, and keeps an audit log of exactly what was checked — so teams keep the speed of generative AI without the exposure risk.": "기업 실무팀은 이미 생성형 AI를 활용해 계약서를 요약하고, 조항을 검토하며, 이메일 초안을 작성하고 있습니다. 하지만 이러한 문서에는 개인정보, 회사명, 계좌번호, 계약 금액, 외부로 유출되어서는 안 되는 기밀 조항이 포함될 수 있습니다. 이 에이전트는 문서를 Markdown으로 변환하고 민감 정보를 자동으로 탐지한 뒤, 외부 모델로 전송하기 전에 일관되고 현실적인 대체 값으로 가명처리합니다. 모델 응답이 돌아오면 실제 값을 로컬에서 복원하고, 어떤 항목을 검사했는지 감사 기록으로 남깁니다. 이를 통해 실무팀은 정보 노출 위험을 줄이면서 생성형 AI의 속도와 편의성을 활용할 수 있습니다.",
  "ARCHITECTURE": "아키텍처",
  "Local Gemma detects context. Deterministic Python validates and protects.": "로컬 Gemma가 문맥을 탐지하고, 결정론적 Python이 검증하고 보호합니다.",
  "Local Gemma detects context. Deterministic Python validates, masks, and verifies.": "로컬 Gemma가 문맥을 탐지하고, 결정론적 Python이 검증, 마스킹, 사후 확인을 수행합니다.",
  "Everything inside the dashed boundary runs on this machine. Only masked Markdown ever leaves it.": "점선 경계 안의 모든 작업은 이 기기에서 실행되며, 마스킹된 Markdown만 외부로 전송됩니다.",
  "Everything inside the dashed boundary runs on this machine. Verification reports unchanged originals before the masked Markdown can be used for Chat.": "점선 경계 안의 모든 작업은 이 기기에서 실행됩니다. 검증 단계는 마스킹된 Markdown을 채팅에 사용하기 전에 변경되지 않은 원본 값을 알려줍니다.",
  "0 · INGESTION — convert.py · any file → Markdown": "0 · 문서 입력 — convert.py · 모든 파일 → Markdown",
  "OCR server (fast, separate process)": "OCR 서버(빠른 별도 프로세스)",
  "PaddleOCR PP-StructureV3 (in-process)": "PaddleOCR PP-StructureV3(프로세스 내부)",
  "pypdf text layer": "pypdf 텍스트 레이어",
  "passthrough / markdownify": "직접 변환 / markdownify",
  "LOCAL BOUNDARY — CrewAI + Gemma detect · privacy.py validates and masks": "로컬 경계 — CrewAI + Gemma 탐지 · privacy.py 검증 및 마스킹",
  "LOCAL BOUNDARY — CrewAI + Gemma detect · privacy.py validates, masks, and verifies": "로컬 경계 — CrewAI + Gemma 탐지 · privacy.py 검증, 마스킹 및 사후 확인",
  "CREWAI SEQUENTIAL CHAIN — local Ollama only": "CREWAI 순차 체인 — 로컬 Ollama 전용",
  "THREE LOCAL AGENTS + DETERMINISTIC VERIFIER": "3개의 로컬 에이전트 + 결정론적 검증기",
  "Post-Mask Verification Checker": "마스킹 후 검증기",
  "The first three stages detect, decide, and replace. The fourth stage is deterministic Python: it reports intentional KEEP values and risky unchanged replacements, but never blocks completion.": "처음 세 단계는 탐지, 처리 결정, 치환을 수행합니다. 네 번째 단계는 결정론적 Python으로 동작하며, 의도적으로 유지된 값과 위험하게 변경되지 않은 값을 알리지만 완료를 차단하지 않습니다.",
  "Sensitive Information Detector": "민감 정보 탐지기",
  "Risk Assessment & Decision Engine": "위험 평가 및 처리 결정 엔진",
  "Pseudonymization Engine": "가명처리 엔진",
  "Gemma proposes contextual entities that fixed patterns may miss. Python accepts only exact substrings with approved entity types, merges them with deterministic findings, and performs every replacement and completion result.": "Gemma는 고정 패턴이 놓칠 수 있는 문맥 기반 엔티티를 제안합니다. Python은 승인된 엔티티 유형과 원문에 정확히 존재하는 값만 허용하고, 결정론적 탐지 결과와 병합한 뒤 모든 치환과 완료 처리를 수행합니다.",
  "DECISION ENGINE — privacy.py · TAXONOMY": "처리 결정 엔진 — privacy.py · TAXONOMY",
  "PSEUDONYMIZED — replace with a consistent alias": "가명처리 — 일관된 대체 값으로 교체",
  "KEEP — preserve the original value": "유지 — 원본 값 보존",
  "REMOVED — replace with a redacted marker": "제거 — 비식별 표식으로 교체",
  "3 · SEMANTIC-PRESERVING MASKING": "3 · 의미 보존형 마스킹",
  "format-aware aliases": "형식 인식 대체 값",
  "recognized types receive realistic stand-ins": "인식된 유형에 현실적인 대체 값 적용",
  "consistent mapping": "일관된 매핑",
  "the same source value always gets the same alias": "같은 원본 값에는 항상 같은 대체 값 적용",
  "KEEP values": "유지 값",
  "amounts and dates remain accurate for analysis": "금액과 날짜를 그대로 유지해 분석 정확성 보존",
  "REMOVED values": "제거 값",
  "replaced with [REDACTED-TYPE] and never restored": "[REDACTED-TYPE]으로 교체되며 복원되지 않음",
  "mapping store": "매핑 저장소",
  "in-process memory · never written to disk": "프로세스 메모리 · 디스크에 기록하지 않음",
  "llm.py — the only outbound network code · masked Markdown only": "llm.py — 유일한 외부 네트워크 코드 · 마스킹된 Markdown만 전송",
  "chat model": "채팅 모델",
  "OpenAI · Mistral · Ollama — your choice, key stays in the tab": "OpenAI · Mistral · Ollama — 사용자 선택, 키는 탭에만 유지",
  "agent model": "에이전트 모델",
  "local Ollama only (CREW_MODEL, default gemma4:12b)": "로컬 Ollama 전용(CREW_MODEL, 기본값 gemma4:12b)",
  "security layer": "보안 계층",
  "hybrid: local Gemma detection + deterministic validation and masking": "하이브리드: 로컬 Gemma 탐지 + 결정론적 검증 및 마스킹",
  "hybrid: local Gemma detection + deterministic validation, masking, and verification": "하이브리드: 로컬 Gemma 탐지 + 결정론적 검증, 마스킹 및 사후 확인",
  "retrieval": "검색 방식",
  "none. whole masked document in the prompt — no RAG, no embeddings": "없음. 마스킹된 전체 문서를 프롬프트에 포함 — RAG 및 임베딩 미사용",
  "history": "대화 기록",
  "replayed as MASKED answers, never the remapped ones": "복원된 답변이 아닌 마스킹된 답변으로 재전송",
  "REMAP — locally, no network": "복원 — 네트워크 없이 로컬 처리",
  "fake → real, longest match first": "대체 값 → 실제 값, 긴 항목부터 일치",
  "MASK-ed values stay redacted": "제거된 값은 비식별 상태로 유지",
  "real values live in server memory only": "실제 값은 서버 메모리에만 유지",
  "AUDIT LOG — per document": "감사 로그 — 문서별 기록",
  "ingested — converter, size": "문서 입력 — 변환기, 크기",
  "privacy_chain — engine, risk counts": "프라이버시 체인 — 엔진, 탐지 수",
  "each query — provider, restored": "각 요청 — 제공자, 복원 수",
  "export as Markdown": "Markdown으로 내보내기",
  "privacy.py imports no network library at all — raw values physically cannot leave through it. Full write-up in docs/ARCHITECTURE.md and docs/CONTEXT-AND-CHAT.md": "privacy.py는 네트워크 라이브러리를 전혀 사용하지 않으므로 원본 값이 이 경로를 통해 외부로 나갈 수 없습니다. 자세한 내용은 docs/ARCHITECTURE.md와 docs/CONTEXT-AND-CHAT.md를 참고하세요.",
  "Home": "홈", "Team": "팀", "Architecture": "아키텍처", "Demo": "데모",
  "Upload & Mask": "업로드 및 마스킹", "NER Tags": "NER 태그", "Chat": "채팅", "Reconstruct": "복원",
  "Privacy Agent": "프라이버시 에이전트", "local-first · pseudonymized": "로컬 우선 · 가명처리",
  "Bring any document. Nothing sensitive leaves this machine.": "문서를 추가하세요. 민감한 정보는 이 기기를 벗어나지 않습니다.",
  "Every file is converted to Markdown first — PDFs and images through a fast OCR server (or PaddleOCR PP-StructureV3 in-process), Word through mammoth, Hangul (.hwp) through pyhwp. Then a CrewAI chain of three agents detects, classifies, and pseudonymizes it. Only the masked Markdown is ever allowed out.": "모든 파일은 먼저 Markdown으로 변환됩니다. PDF와 이미지는 OCR, Word는 mammoth, 한글(.hwp)은 pyhwp를 사용합니다. 이후 3단계 CrewAI 체인이 탐지, 분류, 가명처리를 수행하며 마스킹된 Markdown만 외부 모델에 전달됩니다.",
  "Upload document": "문서 업로드", "Converting…": "변환 중…", "or try a bundled sample:": "또는 샘플 문서 사용:",
  "DOCUMENT": "문서", "STATUS": "상태", "FINDINGS": "탐지 결과", "ACTIONS": "작업",
  "No documents yet — upload a file or add a sample above.": "문서가 없습니다. 파일을 업로드하거나 샘플을 추가하세요.",
  "OCR processing…": "OCR 처리 중…", "detecting…": "탐지 중…", "masking…": "마스킹 중…", "Done": "완료",
  "Verify": "검증", "POST-MASK VERIFICATION — non-blocking": "마스킹 후 검증 — 차단하지 않음",
  "checks which detected originals remain": "탐지된 원본 값이 남아 있는지 확인",
  "KEEP values become reminders": "유지 값은 알림으로 표시",
  "failed replacements become risk warnings": "실패한 치환은 위험 경고로 표시",
  "processing always continues to Done": "처리는 항상 완료 상태로 계속 진행",
  "Reminder:": "알림:", "still contain original values.": "태그에 원본 값이 남아 있습니다.",
  "unchanged": "미변경", "RISKY": "위험", "KEPT": "유지",
  "chain failed": "처리 실패", "Retry": "다시 시도", "Retrying…": "다시 시도 중…",
  "Redo": "다시 처리", "Redoing…": "다시 처리 중…", "Redo four-stage review": "4단계 검토 다시 실행",
  "Gemma is detecting…": "Gemma가 탐지 중입니다…", "working…": "처리 중…",
  "VALIDATED MODEL OUTPUT": "검증된 모델 출력", "MAPPING STORE — ephemeral, session-scoped, never written to disk": "매핑 저장소 — 세션 내 임시 저장, 디스크에 기록되지 않음",
  "Customize sensitive-information tags.": "민감 정보 태그를 사용자 정의하세요.",
  "Add security or privacy categories that are not covered by the default NER list. Each tag and its detection guidance is added to the local detector prompt for future scans.": "기본 NER 목록에 없는 보안 또는 개인정보 범주를 추가하세요. 각 태그와 탐지 가이드는 이후 스캔의 로컬 탐지 프롬프트에 추가됩니다.",
  "CUSTOM NER TAGS": "사용자 정의 NER 태그", "ROOT TAG": "루트 태그", "WHAT BELONGS IN THIS TAG?": "이 태그에 포함되는 정보", "HANDLING": "처리 방식",
  "NER TAG POLICY": "NER 태그 정책",
  "Review every default and custom category. Select a row to edit its guidance or handling; select it again to cancel. Changes apply to future scans.": "기본 및 사용자 정의 카테고리를 모두 확인하세요. 행을 선택하면 탐지 지침이나 처리 방식을 수정할 수 있고, 다시 선택하면 편집이 취소됩니다. 변경 사항은 이후 스캔부터 적용됩니다.",
  "SOURCE": "출처", "DEFAULT": "기본", "CUSTOM": "사용자 정의", "DEFAULT · EDITED": "기본 · 수정됨", "CUSTOM · EDITED": "사용자 정의 · 수정됨",
  "Update": "업데이트", "Reset default": "기본값 복원",
  "Add": "추가", "TAG": "태그", "MODEL GUIDANCE": "모델 가이드", "ACTION": "작업", "No custom tags yet.": "사용자 정의 태그가 없습니다.",
  "Teach Gemma project-specific secrets.": "프로젝트별 민감 정보 태그를 설정하세요.",
  "Got a report back? Remap it to its real values.": "보고서를 받았나요? 실제 값으로 복원하세요.",
  "Paste anything an external model produced from masked documents. The mapping store swaps the placeholders back to the originals — locally, in this process, never over the network.": "마스킹된 문서로 외부 모델이 생성한 내용을 붙여넣으세요. 매핑 저장소가 플레이스홀더를 원본으로 교체하며, 모든 복원은 네트워크 없이 로컬에서 수행됩니다.",
  "No masked documents yet — process one in \"Upload & Mask\" first.": "마스킹된 문서가 없습니다. 먼저 '업로드 및 마스킹'에서 문서를 처리하세요.",
  "MAP AGAINST": "매핑 대상", "PASTE THE REPORT / LLM RESPONSE": "보고서 / LLM 응답 붙여넣기", "Remap to original": "원본으로 복원", "Download": "다운로드",
  "New chat": "새 채팅", "Send": "보내기", "Select documents": "문서 선택", "SELECT DOCUMENTS": "문서 선택",
  "Summarize the key obligations": "주요 의무 사항을 요약해 주세요", "What are the payment terms?": "대금 지급 조건은 무엇인가요?", "Flag any risky clauses": "위험한 조항을 표시해 주세요", "List the main contract risks": "주요 계약 위험을 나열해 주세요",
  "Try the demo": "데모 시작", "RUNTIME": "실행 환경", "OCR engine": "OCR 엔진", "Agent chain": "에이전트 체인", "Local models": "로컬 모델",
  "TEAM": "팀", "Building a privacy-first contract review agent.": "프라이버시 우선 계약 검토 에이전트를 만듭니다.",
  "Remove": "삭제", "Delete tag": "태그 삭제", "Toggle light/dark mode": "라이트/다크 모드 전환", "Switch language": "언어 전환"
};
const originalText = new WeakMap();
const translatedText = (value, language) => {
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const key = match[2].replace(/\s+/g, " ");
  return language === "ko" && KO[key] ? `${match[1]}${KO[key]}${match[3]}` : value;
};

function translateTree(root, language) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("pre, code")) continue;
    let original = originalText.get(node) ?? node.nodeValue;
    const expected = translatedText(original, "ko");
    if (originalText.has(node) && node.nodeValue !== original && node.nodeValue !== expected) original = node.nodeValue;
    originalText.set(node, original);
    const value = translatedText(original, language);
    if (node.nodeValue !== value) node.nodeValue = value;
  }
  root.querySelectorAll("[placeholder], [title], [aria-label]").forEach((element) => {
    ["placeholder", "title", "aria-label"].forEach((attr) => {
      const originalAttr = `data-i18n-${attr}`;
      if (element.hasAttribute(attr) && !element.hasAttribute(originalAttr)) element.setAttribute(originalAttr, element.getAttribute(attr));
      const original = element.getAttribute(originalAttr);
      if (original) element.setAttribute(attr, language === "ko" && KO[original] ? KO[original] : original);
    });
  });
}

function downloadText(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function highlightEntities(entities, revealed) {
  const mapped = entities.filter((entity) => entity.fake)
    .sort((a, b) => b.fake.length - a.fake.length);
  if (!mapped.length) return () => {};
  const pattern = new RegExp(`(${mapped.map((entity) => escapeRe(entity.fake)).join("|")})`, "g");
  const lookup = new Map(mapped.map((entity) => [entity.fake, entity]));

  return () => (tree) => {
    const visit = (node) => {
      if (!node.children || node.tagName === "code" || node.tagName === "pre") return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text") { visit(child); return [child]; }
        return child.value.split(pattern).filter(Boolean).map((part) => {
          const entity = lookup.get(part);
          return entity
            ? { type: "element", tagName: "mark", properties: {}, children: [{ type: "text", value: revealed ? entity.real : entity.fake }] }
            : { type: "text", value: part };
        });
      });
    };
    visit(tree);
  };
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
    <div className="mobile-toast fixed bottom-6 right-6 z-50 flex items-start gap-2 rounded-xl px-4 py-3 max-w-md"
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
            {step.stage === "verify" && step.detail?.length > 0 && (
              <div className="flex flex-col gap-1 mt-0.5">
                {step.detail.map((item, j) => (
                  <div key={j} className="rounded-lg px-2.5 py-1.5 flex items-center gap-2"
                    style={{ background: item.risky ? `${T.danger}12` : `${T.accent2}12`, color: item.risky ? T.danger : T.accent2 }}>
                    <AlertTriangle size={11} className="shrink-0" />
                    <span>{item.type} · {item.value} · {item.risky ? "RISKY" : "KEPT"}</span>
                  </div>
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
  // Pseudonymize + Verify itself — so the whole four-stage chain runs
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
          style={{ background: T.accent, color: T.onAccent, fontFamily: T.sans, opacity: busy === "upload" ? .6 : 1 }}>
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

      <div className="mobile-scroll rounded-2xl" style={{ border: `1px solid ${T.border}` }}>
        <div className="document-grid grid text-xs px-4 py-2.5" style={{ background: T.panel2, color: T.muted, fontFamily: T.mono, borderBottom: `1px solid ${T.border}` }}>
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
              className="document-grid grid items-center px-4 py-3" style={{
                background: focused ? T.panel2 : T.panel,
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
                {!inProgress && ["done", "complete"].includes(doc.status) && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge tone="accent" icon={CheckCircle2}>Done</Badge>
                    {doc.verification?.length > 0 && (
                      <span title={doc.verification.map((item) => `${item.type}: ${item.value}`).join("\n")}>
                        <Badge tone={doc.verification.some((item) => item.risky) ? "danger" : "accent2"} icon={AlertTriangle}>
                          {doc.verification.length} <span>unchanged</span>
                        </Badge>
                      </span>
                    )}
                  </div>
                )}
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
                    style={{ background: T.accent, color: T.onAccent, fontFamily: T.sans, opacity: running ? .6 : 1 }}>
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
                        <button onClick={() => retry(doc.uid)} disabled={running} title="Redo four-stage review"
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
                          style={{ background: T.panel2, color: T.accent2, border: `1px solid ${T.accent2}40`, fontFamily: T.sans, opacity: running ? .6 : 1 }}>
                          {running ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                          {running ? "Redoing…" : "Redo"}
                        </button>
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
  const fenced = message.masked_answer.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  const markdown = fenced ? fenced[1] : message.masked_answer;

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

      <div className="chat-markdown px-4 py-3.5" style={{ fontFamily: T.sans, fontSize: 13.5, lineHeight: 1.7 }}>
        <ReactMarkdown
          rehypePlugins={[highlightEntities(entities, revealed)]}
          components={{ mark: ({ children }) => <span className="rounded px-1 py-0.5" style={{
            background: revealed ? `${T.accent}22` : `${T.accent2}22`,
            color: revealed ? T.accent : T.accent2, fontFamily: T.mono, fontWeight: 600,
          }}>{children}</span> }}
        >{markdown}</ReactMarkdown>
      </div>

    </div>
  );
}

function DocPicker({ allDocs, selected, onToggle, onClose }) {
  const T = useT();
  return (
    <div className="absolute z-10 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl p-2 flex flex-col gap-1"
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
  const messagesRef = useRef(null);

  const session = sessions.find((s) => s.id === activeId) || sessions[0];
  const selected = ready.filter((d) => session.docUids.includes(d.uid));
  const entities = selected.flatMap((d) => d.entities || []);
  const unchanged = selected.flatMap((d) => d.verification || []);
  const unchangedTags = [...new Set(unchanged.map((item) => item.type))];
  const providerInfo = PROVIDERS.find((p) => p.id === provider);

  useEffect(() => {
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [session?.messages, sending]);
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
    <div className="chat-grid grid gap-5">
      <div className="flex flex-col gap-2">
        <button onClick={newChat} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold"
          style={{ background: T.accent, color: T.onAccent, fontFamily: T.sans }}>
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

        {unchangedTags.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: `${unchanged.some((item) => item.risky) ? T.danger : T.accent2}10`, border: `1px solid ${unchanged.some((item) => item.risky) ? T.danger : T.accent2}35` }}>
            <AlertTriangle size={13} color={unchanged.some((item) => item.risky) ? T.danger : T.accent2} className="shrink-0" />
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>
              <span>Reminder:</span> {unchangedTags.join(", ")} <span>still contain original values.</span>
            </span>
          </div>
        )}

        <div ref={messagesRef} className="chat-messages flex flex-col gap-3 rounded-2xl p-4"
          role="log" tabIndex="0" style={{ background: T.bg, border: `1px solid ${T.border}` }}>
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
              style={{ background: T.accent, color: T.onAccent, fontFamily: T.sans, fontSize: 13 }}>{m.text}</div>
          ) : (
            <ChatMessage key={i} message={m} entities={entities} />
          ))}
          {sending && (
            <div className="flex items-center gap-2" style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>
              <Loader2 size={13} className="animate-spin" /> sending masked documents → waiting on {provider}…
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={selected.length ? "Ask about these documents…" : "Select a document first…"}
            disabled={!selected.length || sending} className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.sans, opacity: selected.length ? 1 : .6 }} />
          <button onClick={() => send()} disabled={!selected.length || sending}
            className="rounded-xl px-4 flex items-center justify-center"
            style={{ background: T.accent, color: T.onAccent, opacity: selected.length && !sending ? 1 : .6 }}>
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
        <div className="reconstruct-grid grid gap-5">
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
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", status: "PSEUDONYMIZED" });
  const load = () => api("/ner-tags").then((data) => setTags(data.tags)).catch((err) => notify(err.message));
  useEffect(() => { load(); }, []);

  const cancel = () => {
    setSelected(null);
    setForm({ name: "", description: "", status: "PSEUDONYMIZED" });
  };
  const select = (tag) => {
    if (selected === tag.name) { cancel(); return; }
    setSelected(tag.name);
    setForm({ name: tag.name, description: tag.description, status: tag.status });
  };

  const save = async () => {
    const tag = tags.find((item) => item.name === selected);
    const strength = { KEEP: 0, PSEUDONYMIZED: 1, REMOVED: 2 };
    if (tag?.source === "DEFAULT" && strength[form.status] < strength[tag.status]
      && !window.confirm(`Change ${tag.name} from ${tag.status} to ${form.status}? This weakens its default protection.`)) return;
    try {
      await api(selected ? `/ner-tags/${encodeURIComponent(selected)}` : "/ner-tags",
        { method: selected ? "PUT" : "POST", body: JSON.stringify(form) });
      cancel();
      load();
    } catch (err) { notify(err.message); }
  };

  const remove = async (name) => {
    try {
      await api(`/ner-tags/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (selected === name) cancel();
      load();
    } catch (err) { notify(err.message); }
  };
  const reset = async (name) => {
    try {
      await api(`/ner-tags/${encodeURIComponent(name)}/reset`, { method: "POST" });
      if (selected === name) cancel();
      load();
    } catch (err) { notify(err.message); }
  };

  const field = { background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.mono };
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 mb-1.5"><KeyRound size={16} color={T.accent} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent }}>NER TAG POLICY</span>
        </div>
        <h2 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 22 }}>Customize sensitive-information tags.</h2>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 4 }}>
          Review every default and custom category. Select a row to edit its guidance or handling; select it again to cancel. Changes apply to future scans.
        </p>
      </div>

      <div className="ner-form grid gap-2">
        <label className="flex flex-col gap-1"><span style={{ color: T.muted, fontFamily: T.mono, fontSize: 10 }}>ROOT TAG</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })}
            disabled={Boolean(selected)} placeholder="NER_TAG" className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ ...field, opacity: selected ? .65 : 1 }} />
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
        <button onClick={save} disabled={!form.name.trim()} className="mobile-full rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ background: T.accent, color: T.onAccent, opacity: form.name.trim() ? 1 : .5, alignSelf: "end" }}>
          {selected ? <Check size={15} className="inline mr-1" /> : <Plus size={15} className="inline mr-1" />}
          {selected ? "Update" : "Add"}
        </button>
      </div>

      <div className="mobile-scroll rounded-2xl" style={{ border: `1px solid ${T.border}` }}>
        <div className="ner-grid grid px-4 py-2.5 text-xs" style={{ background: T.panel2, color: T.muted, fontFamily: T.mono }}>
          <div>TAG</div><div>SOURCE</div><div>MODEL GUIDANCE</div><div>STATUS</div><div>ACTION</div>
        </div>
        {tags.map((tag) => (
          <div key={tag.name} onClick={() => select(tag)} className="ner-grid grid items-center px-4 py-3 cursor-pointer"
            style={{ background: selected === tag.name ? T.panel2 : T.panel, borderTop: `1px solid ${T.border}`, fontFamily: T.mono, fontSize: 12 }}>
            <span style={{ color: T.accent }}>{tag.name}</span>
            <span style={{ color: tag.source === "DEFAULT" ? T.muted : T.accent2, fontSize: 10 }}>{tag.source}{tag.modified ? " · EDITED" : ""}</span>
            <span style={{ color: T.text }}>{tag.description}</span>
            <Badge tone={statusTone(tag.status)}>{tag.status}</Badge>
            {tag.source === "CUSTOM" ? (
              <button onClick={(e) => { e.stopPropagation(); remove(tag.name); }} className="rounded-lg p-2" title="Delete tag" style={{ background: T.panel2 }}><Trash2 size={13} color={T.danger} /></button>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); reset(tag.name); }} disabled={!tag.modified}
                className="rounded-lg p-2" title="Reset default" style={{ background: T.panel2, opacity: tag.modified ? 1 : .35 }}><RotateCcw size={13} color={T.muted} /></button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ home / team / arch --- */
const PROJECT = {
  subtitle: "Privacy-Aware Contract Review Agent",
  titleEn: "MuffinGuard",
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
    <div className="flex flex-col gap-8 max-w-5xl">
      <div className="grid gap-6 items-center md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Shield size={16} color={T.accent} />
            <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.accent, letterSpacing: .5 }}>{PROJECT.subtitle}</span>
          </div>
          <h1 style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 28, lineHeight: 1.25 }}>{PROJECT.titleEn}</h1>
          <p style={{ fontFamily: T.sans, fontSize: 14, color: T.muted, marginTop: 14, lineHeight: 1.75 }}>{PROJECT.summary}</p>
        </div>
        <img src="/image/Team.png" alt="Muffin team illustration"
          className="w-full rounded-2xl object-cover"
          style={{ aspectRatio: "4 / 3", border: `1px solid ${T.border}`, background: T.panel }} />
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
        style={{ background: T.accent, color: T.onAccent, fontFamily: T.sans }}>
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
          Local Gemma detects context. Deterministic Python validates, masks, and verifies.
        </h2>
        <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.muted, marginTop: 4, maxWidth: 660 }}>
          Everything inside the dashed boundary runs on this machine. Verification reports unchanged originals before the masked Markdown can be used for Chat.
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
            LOCAL BOUNDARY — CrewAI + Gemma detect · privacy.py validates, masks, and verifies
          </span>
        </div>

        <div className="rounded-2xl p-4 flex flex-col gap-2" style={card}>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: .5, marginBottom: 2 }}>
            THREE LOCAL AGENTS + DETERMINISTIC VERIFIER
          </div>
          {[
            ["1", "Sensitive Information Detector", "detect_sensitive_values", Search],
            ["2", "Risk Assessment & Decision Engine", "assess_risk", Activity],
            ["3", "Pseudonymization Engine", "pseudonymize_document", Repeat],
            ["4", "Post-Mask Verification Checker", "mask_pipeline", Shield],
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
            The first three stages detect, decide, and replace. The fourth stage is deterministic Python:
            it reports intentional KEEP values and risky unchanged replacements, but never blocks completion.
          </p>
        </div>

        <FlowArrow />

        <ArchStage number="2" title="DECISION ENGINE — privacy.py · TAXONOMY" items={[
          { icon: KeyRound, label: "PSEUDONYMIZED — replace with a consistent alias" },
          { icon: Check, label: "KEEP — preserve the original value" },
          { icon: Ban, label: "REMOVED — replace with a redacted marker" },
        ]} />

        <FlowArrow />

        <div className="rounded-2xl p-4 flex flex-col gap-2" style={card}>
          <div className="flex items-center gap-2 mb-1">
            <Database size={14} color={T.accent} />
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: .5 }}>
              3 · SEMANTIC-PRESERVING MASKING
            </span>
          </div>
          <Row label="format-aware aliases" value="recognized types receive realistic stand-ins" />
          <Row label="consistent mapping" value="the same source value always gets the same alias" />
          <Row label="KEEP values" value="amounts and dates remain accurate for analysis" />
          <Row label="REMOVED values" value="replaced with [REDACTED-TYPE] and never restored" />
          <Row label="mapping store" value="in-process memory · never written to disk" tone={T.accent} />
        </div>

        <FlowArrow />

        <ArchStage number="4" title="POST-MASK VERIFICATION — non-blocking" items={[
          { icon: Search, label: "checks which detected originals remain" },
          { icon: AlertTriangle, label: "KEEP values become reminders" },
          { icon: Shield, label: "failed replacements become risk warnings" },
          { icon: CheckCircle2, label: "processing always continues to Done" },
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
        <Row label="chat model" value="OpenAI · Claude · Mistral · Ollama — your choice, key stays in the tab" />
        <Row label="agent model" value="local Ollama only (CREW_MODEL, default gemma4:12b)" />
        <Row label="security layer" value="hybrid: local Gemma detection + deterministic validation, masking, and verification" tone={T.accent} />
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
  const [theme, setTheme] = useState("light");
  const [language, setLanguage] = useState("en");
  const T = theme === "dark" ? DARK : LIGHT;
  const [docs, setDocs] = useState([]);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [topTab, setTopTab] = useState("home");
  const [demoTab, setDemoTab] = useState("upload");
  // Chat lives here so tab switches keep it mounted; the backend mirrors the
  // non-secret fields so browser refreshes behave like the document store.
  const [chat, setChat] = useState({
    sessions: [{ id: "c1", title: "New chat", docUids: [], messages: [] }],
    activeId: "c1",
    provider: "ollama",
    model: PROVIDERS[0].defaultModel,
    apiKey: "",
    input: "",
  });
  const [chatLoaded, setChatLoaded] = useState(false);

  const refresh = async (documents = null) =>
    setDocs(documents || (await api("/documents")).documents);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    api("/health").then(setHealth).catch(() => {});
    api("/chat-state")
      .then((saved) => setChat((current) => saved.sessions?.length ? { ...current, ...saved, apiKey: "" } : current))
      .catch((e) => setError(e.message))
      .finally(() => setChatLoaded(true));
  }, []);
  useEffect(() => {
    if (!chatLoaded) return;
    const timer = setTimeout(() => {
      const { sessions, activeId, provider, model, input } = chat;
      api("/chat-state", { method: "PUT", body: JSON.stringify({ sessions, activeId, provider, model, input }) })
        .catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [chatLoaded, chat.sessions, chat.activeId, chat.provider, chat.model, chat.input]);
  useEffect(() => {
    if (topTab === "demo") refresh().catch((e) => setError(e.message));
  }, [topTab, demoTab]);
  useEffect(() => {
    const root = document.getElementById("root");
    let frame = 0;
    const apply = () => { frame = 0; translateTree(root, language); };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(apply);
    });
    document.documentElement.lang = language === "ko" ? "ko" : "en";
    apply();
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [language]);

  const TOP_TABS = [["home", "Home", HomeIcon], ["team", "Team", Users], ["architecture", "Architecture", Cpu], ["demo", "Demo", Sparkles]];
  const DEMO_TABS = [["upload", "Upload & Mask"], ["ner", "NER Tags"], ["chat", "Chat"], ["reconstruct", "Reconstruct"]];

  return (
    <ThemeCtx.Provider value={T}>
      <div className="app-shell p-6 md:p-10" style={{ background: T.bg, color: T.text, minHeight: "100vh", fontFamily: T.sans, transition: "background .2s, color .2s" }}>
        <div className="max-w-5xl mx-auto flex flex-col gap-8">
          <div className="app-header flex items-center justify-between flex-wrap gap-3">
            <button onClick={() => setTopTab("home")} className="brand-button flex items-center gap-2.5 min-w-0">
              <div className="rounded-xl p-2" style={{ background: T.panel, border: `1px solid ${topTab === "home" ? T.accent : T.border}` }}>
                <Shield size={18} color={T.accent} />
              </div>
              <div className="text-left">
                <div style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 15 }}>MuffinGuard</div>
                <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.muted }}>local-first · pseudonymized</div>
              </div>
            </button>

            <div className="header-controls flex items-center gap-2">
              <div className="primary-nav flex gap-1 rounded-xl p-1" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
                {TOP_TABS.map(([id, label, Icon]) => (
                  <button key={id} onClick={() => setTopTab(id)} className="rounded-lg px-3.5 py-2 text-sm flex items-center gap-1.5"
                    style={{ background: topTab === id ? T.accent : "transparent", color: topTab === id ? T.bg : T.muted, fontFamily: T.sans, fontWeight: 600 }}>
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
              <div className="header-actions flex items-center gap-2">
                <button onClick={() => setLanguage((value) => value === "en" ? "ko" : "en")}
                  aria-label="Switch language" title="Switch language"
                  className="rounded-full px-3 py-2 flex items-center justify-center text-xs font-bold"
                  style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.muted, fontFamily: T.mono }}>
                  {language === "en" ? "EN" : "KR"}
                </button>
                <button onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} aria-label="Toggle light/dark mode"
                  className="rounded-full p-2.5 flex items-center justify-center"
                  style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.muted }}>
                  {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                </button>
              </div>
            </div>
          </div>

          {topTab === "home" && <HomeTab onTryDemo={() => setTopTab("demo")} health={health} />}
          {topTab === "team" && <TeamTab />}
          {topTab === "architecture" && <ArchitectureTab />}
          {topTab === "demo" && (
            <div className="flex flex-col gap-6">
              <div className="demo-nav flex gap-1 rounded-xl p-1 w-fit" style={{ background: T.panel2, border: `1px solid ${T.border}` }}>
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
