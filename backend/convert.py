"""Ingestion — any supported file becomes Markdown before the privacy layer sees it.

  .pdf / images       ->  OCR (see below), falls back to the pypdf text layer
  .docx               ->  mammoth + markdownify
  .hwp                ->  pyhwp
  .xlsx / .xls        ->  pandas + tabulate
  .html               ->  markdownify
  .md / .txt / .csv   ->  passthrough

Two OCR backends, tried in order:

  1. OCR SERVER — any OpenAI-compatible vision endpoint (Unlimited-OCR, RapidOCR,
     SGLang, vLLM, Baidu Vision). Pages are rendered to PNG and posted as data URIs.
     Set OCR_SERVER_URL to enable. Keeps heavy models out of this virtualenv and
     lets the whole team point at one shared engine.
  2. PADDLEOCR PP-StructureV3 — in-process, no server, ~1 GB of wheels.

If NEITHER is reachable (OCR server down/unset and PaddleOCR not installed), PDFs
fall back to pypdf's embedded text layer — a light, pure-Python dependency that
needs no server and no native/compiled OCR stack. That covers digital PDFs; a
scanned PDF with no text layer still needs one of the two OCR backends above.

SECURITY: OCR is the one step that sees the document BEFORE the privacy layer does,
so a remote OCR endpoint would receive raw, unmasked contracts. Non-loopback OCR
URLs are refused unless OCR_ALLOW_REMOTE=true is set deliberately.

Heavy dependencies are imported lazily so the server still starts — and every other
format still works — when no OCR backend is installed.
"""

from __future__ import annotations

import base64
import io
import os
import re
from pathlib import Path
from urllib.parse import urlparse

SUPPORTED = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif",
             ".docx", ".hwp", ".xlsx", ".xls", ".html", ".htm", ".md", ".txt", ".csv"}
IMAGES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}
_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp", ".bmp": "image/bmp", ".tiff": "image/tiff", ".tif": "image/tiff"}

OCR_SERVER_URL = os.getenv("OCR_SERVER_URL", "").rstrip("/")
OCR_MODEL = os.getenv("OCR_MODEL", "Unlimited-OCR")
OCR_PROMPT = os.getenv("OCR_PROMPT", "document parsing.")
OCR_IMAGE_MODE = os.getenv("OCR_IMAGE_MODE", "base")
OCR_DPI = int(os.getenv("OCR_DPI", "300"))
OCR_TIMEOUT = float(os.getenv("OCR_TIMEOUT", "120"))
OCR_ALLOW_REMOTE = os.getenv("OCR_ALLOW_REMOTE", "false").lower() == "true"
_LOOPBACK = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}

_ocr_engine = None


def _tidy(md: str) -> str:
    """Normalize whitespace so chunking and detection behave predictably."""
    md = md.replace("\r\n", "\n").replace("\xa0", " ")
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()


# --- OCR backend 1: an OpenAI-compatible vision server --------------------------

def _check_ocr_url(url: str) -> None:
    """Refuse to ship raw pages off-machine unless someone opted in explicitly."""
    host = urlparse(url).hostname or ""
    if host not in _LOOPBACK and not OCR_ALLOW_REMOTE:
        raise RuntimeError(
            f"OCR_SERVER_URL points at '{host}', which is not local. OCR runs BEFORE "
            "masking, so raw contract pages would leave this machine. Set "
            "OCR_ALLOW_REMOTE=true only if that endpoint is genuinely trusted."
        )


def ocr_server_ready() -> bool:
    """True when an OCR server is configured, permitted, and answering."""
    if not OCR_SERVER_URL:
        return False
    try:
        import httpx  # noqa: PLC0415
        _check_ocr_url(OCR_SERVER_URL)
        return httpx.get(f"{OCR_SERVER_URL}/health", timeout=3.0).status_code == 200
    except Exception:
        return False


def _ocr_via_server(data: bytes, mime: str = "image/png") -> str:
    """One page/image -> Markdown, through the vision chat endpoint."""
    import httpx  # noqa: PLC0415

    _check_ocr_url(OCR_SERVER_URL)
    data_uri = f"data:{mime};base64,{base64.b64encode(data).decode()}"
    payload = {
        "model": OCR_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": OCR_PROMPT},
            {"type": "image_url", "image_url": {"url": data_uri}},
        ]}],
        "temperature": 0,
        "stream": False,
        "skip_special_tokens": False,
        "images_config": {"image_mode": OCR_IMAGE_MODE},
    }
    response = httpx.post(f"{OCR_SERVER_URL}/v1/chat/completions", json=payload,
                          timeout=OCR_TIMEOUT)
    response.raise_for_status()
    choices = response.json().get("choices") or []
    return (choices[0]["message"].get("content", "") if choices else "").strip()


# --- OCR backend 2: PaddleOCR PP-StructureV3, in-process ------------------------

def _get_ocr():
    """Load PP-StructureV3 once. Weights download on first use (~200 MB)."""
    global _ocr_engine
    if _ocr_engine is None:
        from paddleocr import PPStructureV3  # noqa: PLC0415  (lazy on purpose)
        _ocr_engine = PPStructureV3(use_doc_orientation_classify=False,
                                    use_doc_unwarping=False)
    return _ocr_engine


def _ocr_via_paddle(data: bytes) -> str:
    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    image = np.array(Image.open(io.BytesIO(data)).convert("RGB"))
    parts: list[str] = []
    for result in _get_ocr().predict(input=image):
        markdown = getattr(result, "markdown", None)
        if isinstance(markdown, dict):
            markdown = markdown.get("markdown_texts", "")
        if markdown:
            parts.append(str(markdown))
    return "\n\n".join(parts).strip()


def ocr_backend() -> str:
    """Which OCR engine would actually be used right now."""
    if ocr_server_ready():
        return f"ocr-server ({OCR_SERVER_URL}, model {OCR_MODEL})"
    try:
        _get_ocr()
        return "paddleocr-ppstructure-v3"
    except Exception:
        return ""


def _ocr_image_bytes(data: bytes, mime: str = "image/png") -> tuple[str, str]:
    """Run whichever OCR backend is available. Returns (markdown, backend name)."""
    if ocr_server_ready():
        return _ocr_via_server(data, mime), "ocr-server"
    return _ocr_via_paddle(data), "paddleocr-ppstructure-v3"


# --- PDF ------------------------------------------------------------------------

def _pdf_text_layer(path: Path) -> str:
    """The no-OCR fallback: pull the embedded text layer out with pypdf. Fine for
    digital PDFs, empty for scans — the caller rejects an empty result with a
    clear message rather than silently returning nothing."""
    from pypdf import PdfReader  # noqa: PLC0415

    reader = PdfReader(str(path))
    pages = [f"## Page {i + 1}\n\n{page.extract_text() or ''}" for i, page in enumerate(reader.pages)]
    return _tidy("\n\n".join(pages))


def _pdf_to_md(path: Path) -> tuple[str, str]:
    if not ocr_backend():
        # OCR server unreachable/unset and no local OCR engine installed — use
        # the local pypdf fallback instead of failing the upload.
        try:
            return _pdf_text_layer(path), "pypdf-text (no OCR backend)"
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("pypdf is required for PDF input when no OCR backend is "
                               "available: pip install pypdf") from exc

    try:
        import fitz  # PyMuPDF — only needed to rasterize pages for OCR  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("PyMuPDF is required to rasterize PDF pages for OCR: "
                           "pip install pymupdf") from exc

    doc = fitz.open(path)
    pages, backend = [], ""
    for i, page in enumerate(doc):
        png = page.get_pixmap(dpi=OCR_DPI).tobytes("png")
        try:
            markdown, backend = _ocr_image_bytes(png)
        except Exception:
            # The server answered its /health check but then stopped responding
            # (crashed, restarted, network blip) partway through the document —
            # don't fail the whole upload, drop to the local pypdf fallback.
            return _pdf_text_layer(path), "pypdf-text (OCR backend failed mid-document)"
        pages.append(f"## Page {i + 1}\n\n{markdown}")
    return _tidy("\n\n".join(pages)), backend


# --- Office & web formats -------------------------------------------------------

def _html_to_md(html: str) -> str:
    from markdownify import markdownify  # noqa: PLC0415
    return markdownify(html, heading_style="ATX", strip=["script", "style"])


def _docx_to_md(path: Path) -> tuple[str, str]:
    import mammoth  # noqa: PLC0415
    with path.open("rb") as fh:
        html = mammoth.convert_to_html(fh).value
    return _tidy(_html_to_md(html)), "mammoth+markdownify"


def _hwp_to_md(path: Path) -> tuple[str, str]:
    from hwp5.dataio import ParseError  # noqa: PLC0415
    from hwp5.xmlmodel import Hwp5File  # noqa: PLC0415

    try:
        hwp = Hwp5File(str(path))
    except ParseError as exc:
        raise RuntimeError(f"Could not parse HWP file: {exc}") from exc

    # Iterating hwp.bodytext yields section NAMES ("Section0", "Section1", ...),
    # not section objects — hwp.bodytext[name] resolves the actual object that
    # has .models(). Mirrors pyhwp's own hwp5.proc.find module.
    lines: list[str] = []
    try:
        for section_name in hwp.bodytext:
            for record in hwp.bodytext[section_name].models():
                content = record.get("content") or {}
                chunks = content.get("chunks") or []
                text = "".join(c for c in chunks if isinstance(c, str))
                if text.strip():
                    lines.append(text.strip())
    finally:
        # Always close, even on error — otherwise the OLE handle stays open and
        # Windows can't delete the caller's temp file, turning a clean 400 into
        # a confusing PermissionError that masks the real conversion failure.
        hwp.close()
    return _tidy("\n\n".join(lines)), "pyhwp"


def _excel_to_md(path: Path) -> tuple[str, str]:
    import pandas as pd  # noqa: PLC0415
    sheets = pd.read_excel(path, sheet_name=None, dtype=str)
    parts = [
        f"## {name}\n\n{frame.fillna('').to_markdown(index=False)}"
        for name, frame in sheets.items()
    ]
    return _tidy("\n\n".join(parts)), "pandas+tabulate"


# --- Entry point ----------------------------------------------------------------

def to_markdown(path: str | Path) -> tuple[str, str]:
    """Convert a file to Markdown. Returns (markdown, converter_name)."""
    path = Path(path)
    ext = path.suffix.lower()

    if ext == ".pdf":
        return _pdf_to_md(path)
    if ext in IMAGES:
        if not ocr_backend():
            raise RuntimeError(
                "Images need an OCR backend. Either set OCR_SERVER_URL to a running "
                "vision server, or install one locally: pip install -r requirements-ocr.txt"
            )
        markdown, backend = _ocr_image_bytes(path.read_bytes(), _MIME.get(ext, "image/png"))
        return _tidy(markdown), backend
    if ext == ".docx":
        return _docx_to_md(path)
    if ext == ".hwp":
        return _hwp_to_md(path)
    if ext in (".xlsx", ".xls"):
        return _excel_to_md(path)
    if ext in (".html", ".htm"):
        return _tidy(_html_to_md(path.read_text(encoding="utf-8", errors="replace"))), "markdownify"
    if ext in (".md", ".txt", ".csv"):
        return _tidy(path.read_text(encoding="utf-8", errors="replace")), "passthrough"

    raise ValueError(f"Unsupported file type: {ext}. Supported: {', '.join(sorted(SUPPORTED))}")
