"""FastAPI app — upload, run the crew, chat through a masked payload, remap back.

The privacy chain runs in two phases the browser can act on separately:

    scan  (auto, on upload)   Detect -> Classify.  Read-only — a sensitivity score,
                              nothing changed. Lets the user see how sensitive a
                              document is BEFORE anything about it is touched.
    mask  (user-triggered)    Pseudonymize. This is the step that
                              actually rewrites the document.

Route map:
    GET  /                          the single-page UI
    GET  /api/health                which engines are actually available
    GET  /api/samples               bundled demo documents
    POST /api/documents             upload files -> Markdown, auto-starts a scan
    POST /api/documents/sample      load a bundled demo document, auto-starts a scan
    POST /api/documents/{uid}/scan  (re-)run Detect -> Classify
    POST /api/documents/{uid}/mask  pseudonymize the scanned entities
    GET  /api/documents             list everything in this session
    GET  /api/documents/{uid}/download
    DELETE /api/documents/{uid}
    POST /api/chat                  ask a model about masked documents
    POST /api/remap                 restore real values in pasted text
"""

from __future__ import annotations

import shutil
import tempfile
import threading
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

# Must run before importing llm/crew — both read their config at import time.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import convert  # noqa: E402
import crew  # noqa: E402
import llm  # noqa: E402
import privacy  # noqa: E402
from privacy import STORE, Document  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
FRONTEND = ROOT / "frontend"

app = FastAPI(title="Privacy-Aware Contract Review Agent")


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

def _ingest(name: str, path: Path, origin: str) -> Document:
    try:
        markdown, converter = convert.to_markdown(path)
    except Exception as exc:
        raise HTTPException(400, f"Could not convert '{name}': {exc}") from exc
    if not markdown.strip():
        raise HTTPException(400, f"'{name}' converted to an empty document.")

    doc = Document(uid=str(uuid.uuid4()), name=name, markdown=markdown,
                   source=f"{origin} · {converter}")
    doc.log("ingested", converter=converter, characters=len(markdown))
    STORE.put(doc)
    _kickoff_scan(doc)  # how sensitive is this? — read-only, starts immediately
    return doc


@app.post("/api/documents")
async def upload(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    """Accept one or more files and convert each to Markdown."""
    created = []
    for upload_file in files:
        suffix = Path(upload_file.filename or "").suffix.lower()
        if suffix not in convert.SUPPORTED:
            raise HTTPException(400, f"Unsupported file type '{suffix}'. "
                                     f"Supported: {', '.join(sorted(convert.SUPPORTED))}")
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(upload_file.file, tmp)
            tmp_path = Path(tmp.name)
        try:
            created.append(_ingest(upload_file.filename or tmp_path.name, tmp_path, "upload").public())
        finally:
            # Best-effort cleanup only: a converter that raised while still
            # holding the file open (Windows file locking) must not have its
            # real error replaced by a cleanup PermissionError here.
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
    return {"documents": created}


class SampleRequest(BaseModel):
    filename: str


@app.get("/api/samples")
def list_samples() -> dict[str, Any]:
    files = sorted(p for p in SAMPLES.glob("*") if p.suffix.lower() in convert.SUPPORTED)
    return {"samples": [{"filename": p.name, "size": p.stat().st_size} for p in files]}


@app.post("/api/documents/sample")
def add_sample(request: SampleRequest) -> dict[str, Any]:
    path = SAMPLES / Path(request.filename).name
    if not path.exists():
        raise HTTPException(404, f"No sample named '{request.filename}'.")
    doc = Document(uid=str(uuid.uuid4()), name=path.name, source="sample", status="ocr_processing")
    STORE.put(doc)
    response = doc.public()
    threading.Thread(target=_convert_sample_in_background, args=(doc, path), daemon=True).start()
    return response


def _convert_sample_in_background(doc: Document, path: Path) -> None:
    try:
        markdown, converter = convert.to_markdown(path)
        if not markdown.strip():
            raise ValueError(f"'{doc.name}' converted to an empty document.")
        doc.markdown = markdown
        doc.source = f"sample · {converter}"
        doc.log("ingested", converter=converter, characters=len(markdown))
        _kickoff_scan(doc)
    except Exception as exc:  # noqa: BLE001 — background failures must become visible state
        doc.status = "error"
        doc.log("conversion_error", error=type(exc).__name__)


def _publisher(doc: Document):
    """A step-callback that appends to doc.trace, replacing a same-stage retry
    instead of duplicating it. Shared by both phases so the scan phase's two
    steps stay put while the mask phase's two steps get appended after them."""
    def publish(step: dict[str, Any]) -> None:
        doc.trace = [item for item in doc.trace if item.get("stage") != step.get("stage")]
        doc.trace.append(step)
    return publish


def _scan_in_background(doc: Document) -> None:
    """Detect -> classify. Read-only: a sensitivity score, nothing about the
    document itself changes yet."""
    try:
        result = crew.scan(doc.markdown, name=doc.name, on_step=_publisher(doc))
        doc.entities = result["entities"]
        doc.sensitivity = result["sensitivity"]
        doc.status = "scanned"
        doc.log("privacy_scan", engine=result.get("engine", "deterministic"),
                entities=len(doc.entities), sensitivity_percent=doc.sensitivity.get("percent"),
                removed=doc.sensitivity.get("removed"))
    except Exception as exc:  # noqa: BLE001 — expose a safe status, not a stuck job
        doc.status = "error"
        doc.log("privacy_scan_error", error=type(exc).__name__)


def _kickoff_scan(doc: Document) -> None:
    doc.status = "scanning"
    doc.trace = []
    doc.entities = []
    doc.sensitivity = {}
    doc.verification = []
    doc.masked_markdown = ""
    threading.Thread(target=_scan_in_background, args=(doc,), daemon=True).start()


@app.post("/api/documents/{uid}/scan", status_code=202)
def scan_document(uid: str) -> dict[str, Any]:
    """Restart the full workflow from the stored original document."""
    doc = STORE.get(uid)
    if not doc:
        raise HTTPException(404, "Unknown document.")
    if doc.status in ("ocr_processing", "scanning", "masking"):
        return doc.public()
    doc.log("reprocess_started", previous_status=doc.status)
    _kickoff_scan(doc)
    return doc.public()


def _mask_in_background(doc: Document) -> None:
    """Pseudonymize the entities scan() already found and classified.
    This is the step that actually rewrites the document."""
    try:
        result = crew.mask(doc.markdown, doc.entities, seed=doc.uid, name=doc.name,
                           on_step=_publisher(doc))
        doc.entities = result["entities"]
        doc.masked_markdown = result["masked"]
        doc.verification = result["verification"]
        for step in result["trace"]:
            _publisher(doc)(step)
        doc.status = "done"
        doc.log("privacy_mask", engine=result.get("engine", "deterministic"),
                entities=len(doc.entities),
                removed=sum(1 for e in doc.entities if e.action == "MASK"),
                unchanged=len(doc.verification),
                risky_unchanged=sum(1 for item in doc.verification if item["risky"]),
                status="done")
    except Exception as exc:  # noqa: BLE001 — expose a safe status, not a stuck job
        doc.status = "error"
        doc.log("privacy_mask_error", error=type(exc).__name__)


@app.post("/api/documents/{uid}/mask", status_code=202)
def mask_document(uid: str) -> dict[str, Any]:
    """Pseudonymize. Requires a completed scan — there's nothing
    classified to mask until Detect -> Classify has run at least once."""
    doc = STORE.get(uid)
    if not doc:
        raise HTTPException(404, "Unknown document.")
    if doc.status in ("scanning", "masking"):
        return doc.public()
    if doc.status not in ("scanned", "done", "complete"):
        # Note: an empty doc.entities list is NOT grounds to block — a document
        # that genuinely contains nothing sensitive is a valid scan outcome, not
        # an unscanned one. What matters is whether a scan actually completed.
        raise HTTPException(400, "Scan the document first — nothing has been classified yet.")

    doc.status = "masking"
    doc.masked_markdown = ""
    threading.Thread(target=_mask_in_background, args=(doc,), daemon=True).start()
    return doc.public()


@app.get("/api/documents")
def list_documents() -> dict[str, Any]:
    return {"documents": [d.public() for d in STORE.all()]}


@app.delete("/api/documents/{uid}")
def delete_document(uid: str) -> dict[str, bool]:
    STORE.drop(uid)
    return {"ok": True}


@app.get("/api/documents/{uid}/download")
def download(uid: str, variant: Literal["masked", "raw", "audit"] = "masked") -> PlainTextResponse:
    doc = STORE.get(uid)
    if not doc:
        raise HTTPException(404, "Unknown document.")
    if variant == "raw":
        body = doc.markdown
    elif variant == "audit":
        body = _audit_report(doc)
    else:
        body = doc.masked_markdown or doc.markdown
    filename = f"{Path(doc.name).stem}.{variant}.md"
    # HTTP headers are Latin-1 encoded by Starlette. Putting a Korean (or any
    # other Unicode) filename directly in `filename="..."` raises an encoding
    # error and turns the download into a 500 response. RFC 5987's filename*
    # carries the real UTF-8 name; the plain filename remains a safe fallback.
    encoded_filename = quote(filename, safe="")
    disposition = (
        f'attachment; filename="contract-{variant}.md"; '
        f"filename*=UTF-8''{encoded_filename}"
    )
    return PlainTextResponse(
        body,
        media_type="text/markdown",
        headers={"Content-Disposition": disposition},
    )


def _audit_report(doc: Document) -> str:
    lines = [f"# Audit log — {doc.name}", "", f"Source: {doc.source}", ""]
    lines += ["| time | event | detail |", "| --- | --- | --- |"]
    for row in doc.audit:
        detail = ", ".join(f"{k}={v}" for k, v in row.items() if k not in ("at", "event"))
        lines.append(f"| {row['at']} | {row['event']} | {detail} |")
    lines += ["", "## Values handled", "", "| type | status | original | placeholder |",
              "| --- | --- | --- | --- |"]
    for e in doc.entities:
        lines.append(f"| {e.type} | {privacy.status_for(e.action)} | {e.real} | {e.fake} |")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

CHAT_STATE: dict[str, Any] = {
    "sessions": [], "activeId": "", "provider": "ollama", "model": "gemma4:12b", "input": "",
}
CHAT_STATE_LOCK = threading.Lock()

SYSTEM_PROMPT = (
    "You are a contract review assistant. The documents below have been "
    "pseudonymized: names, companies, account numbers, and other sensitive identifiers were "
    "replaced with consistent stand-ins. Analyze them exactly as written and never "
    "point out that values look fake. Answer in the language of the user's question. "
    "Be concrete: quote clause numbers, figures and dates from the documents. "
    "Use Markdown where useful, but do not wrap the whole answer in a code fence."
)


class ChatRequest(BaseModel):
    doc_uids: list[str]
    question: str
    provider: Literal["openai", "anthropic", "mistral", "ollama"] = "ollama"
    model: str | None = None
    api_key: str | None = None
    history: list[dict[str, str]] = []


class SavedChatSession(BaseModel):
    id: str
    title: str = "New chat"
    docUids: list[str] = []
    messages: list[dict[str, Any]] = []


class ChatStateRequest(BaseModel):
    sessions: list[SavedChatSession]
    activeId: str = ""
    provider: Literal["openai", "anthropic", "mistral", "ollama"] = "ollama"
    model: str = "gemma4:12b"
    input: str = ""


@app.get("/api/chat-state")
def get_chat_state() -> dict[str, Any]:
    with CHAT_STATE_LOCK:
        return deepcopy(CHAT_STATE)


@app.put("/api/chat-state")
def save_chat_state(request: ChatStateRequest) -> dict[str, Any]:
    state = request.model_dump()
    with CHAT_STATE_LOCK:
        CHAT_STATE.clear()
        CHAT_STATE.update(state)
        return deepcopy(CHAT_STATE)


@app.post("/api/chat")
def chat(request: ChatRequest) -> dict[str, Any]:
    docs = STORE.many(request.doc_uids)
    if not docs:
        raise HTTPException(400, "Select at least one processed document.")
    unready = [d.name for d in docs if not d.masked_markdown]
    if unready:
        raise HTTPException(400, f"Mask these documents first: {', '.join(unready)}")

    context = "\n\n".join(f"# {d.name}\n\n{d.masked_markdown}" for d in docs)
    entities = [e for d in docs for e in d.entities]

    outgoing = f"{SYSTEM_PROMPT}\n\n{context}\n\n{request.question}"

    messages = [{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Documents:\n\n{context}"}]
    messages += [m for m in request.history if m.get("role") in ("user", "assistant")]
    messages.append({"role": "user", "content": request.question})

    try:
        masked_answer = llm.chat(request.provider, request.model, request.api_key,
                                 messages, payload_is_masked=True)
    except llm.LLMError as exc:
        raise HTTPException(502, str(exc)) from exc

    answer, restored = privacy.remap(masked_answer, entities)
    for doc in docs:
        doc.log("external_query" if llm.is_external(request.provider) else "local_query",
                provider=request.provider, model=request.model or "default", restored=restored)

    return {
        "masked_answer": masked_answer,
        "answer": answer,
        "restored": restored,
        "provider": request.provider,
        "model": request.model or llm.PROVIDERS[request.provider]["default"],
        "sent_characters": len(outgoing),
        "doc_uids": [d.uid for d in docs],
    }


class RemapRequest(BaseModel):
    doc_uids: list[str]
    text: str


@app.post("/api/remap")
def remap(request: RemapRequest) -> dict[str, Any]:
    docs = STORE.many(request.doc_uids)
    if not docs:
        raise HTTPException(400, "Select at least one processed document.")
    entities = [e for d in docs for e in d.entities]
    text, restored = privacy.remap(request.text, entities)
    return {"text": text, "restored": restored}


class NerTagRequest(BaseModel):
    name: str
    description: str = ""
    status: Literal["PSEUDONYMIZED", "KEEP", "REMOVED"] = "PSEUDONYMIZED"


@app.get("/api/ner-tags")
def list_ner_tags() -> dict[str, Any]:
    return {"tags": privacy.list_types()}


@app.post("/api/ner-tags")
def create_ner_tag(request: NerTagRequest) -> dict[str, Any]:
    try:
        return privacy.add_custom_type(request.name, request.description, request.status)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.put("/api/ner-tags/{name}")
def update_ner_tag(name: str, request: NerTagRequest) -> dict[str, Any]:
    if request.name.strip().upper() != name.strip().upper():
        raise HTTPException(400, "A tag cannot be renamed while editing.")
    try:
        return privacy.update_type(name, request.description, request.status)
    except ValueError as exc:
        raise HTTPException(404 if "Unknown" in str(exc) else 400, str(exc)) from exc


@app.post("/api/ner-tags/{name}/reset")
def reset_ner_tag(name: str) -> dict[str, Any]:
    try:
        return privacy.reset_builtin_type(name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/ner-tags/{name}")
def delete_ner_tag(name: str) -> dict[str, bool]:
    if not privacy.remove_custom_type(name):
        raise HTTPException(404, "Unknown custom NER tag.")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Health + static UI
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    ocr = convert.ocr_backend() or "none — digital PDFs use the pypdf text layer, images unsupported"
    models = llm.ollama_models()
    return {
        "ok": True,
        "ocr": ocr,
        "ollama_models": models,
        "crew": "crewai + local llm" if models and crew.CREW_ENABLED else "deterministic chain",
        "documents": len(STORE.all()),
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/app.jsx")
def app_source() -> FileResponse:
    return FileResponse(FRONTEND / "app.jsx", media_type="text/babel",
                        headers={"Cache-Control": "no-store"})
