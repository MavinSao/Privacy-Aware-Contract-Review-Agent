"""Standalone OCR server — the OCR_SERVER_URL side of convert.py.

Run this as its own process, on its own port — same venv as the main app is fine,
a separate one (or a separate machine) also works if you want it fully isolated:

    pip install -r requirements-ocr-server.txt
    python backend/ocr_server.py --port 10000

Then point the app at it:

    OCR_SERVER_URL=http://127.0.0.1:10000

Speaks the same OpenAI-compatible `/v1/chat/completions` shape that convert.py's
`_ocr_via_server()` posts to: one image per request, as a data-URI `image_url` part,
with a `text` prompt part. Whatever comes back in `choices[0].message.content`
becomes that page's Markdown.

Engine: RapidOCR (onnxruntime, CPU, no GPU/CUDA required, ~50 MB of weights,
downloaded on first use) — line-level text recognition, fast enough to run
one page at a time interactively. It does not do table/layout reconstruction
the way PaddleOCR PP-StructureV3 does; that trade (speed over structure) is the
point of running it as a separate, swappable server. Drop in a stronger engine
(PP-StructureV3, a hosted vision model, Unlimited-OCR, ...) behind the same two
routes and nothing on the client side has to change.
"""

from __future__ import annotations

import argparse
import base64
import io
import logging
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ocr_server")

app = FastAPI(title="Contract Review OCR Server")

_engine = None  # lazy — see _get_engine()


def _get_engine():
    """Load RapidOCR once. Raises with an actionable message if it isn't installed."""
    global _engine
    if _engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError(
                "rapidocr-onnxruntime is not installed. "
                "pip install -r requirements-ocr-server.txt"
            ) from exc
        logger.info("Loading RapidOCR (weights download on first run)...")
        _engine = RapidOCR()
    return _engine


class ChatCompletionRequest(BaseModel):
    model: str = "Unlimited-OCR"
    messages: list[dict[str, Any]]
    temperature: float = 0.0
    stream: bool = False
    skip_special_tokens: bool = False
    images_config: dict[str, Any] | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "contract-review-ocr-server"}


def _extract_images(messages: list[dict[str, Any]]) -> list[bytes]:
    images: list[bytes] = []
    for msg in messages:
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if part.get("type") != "image_url":
                continue
            url = part.get("image_url", {}).get("url", "")
            if not url.startswith("data:"):
                continue
            try:
                _, b64data = url.split(",", 1)
                images.append(base64.b64decode(b64data))
            except Exception as exc:  # noqa: BLE001
                logger.warning("Skipping an image_url part that failed to decode: %s", exc)
    return images


def _run_ocr(image_bytes: bytes) -> str:
    from PIL import Image  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    image = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    result, _ = _get_engine()(image)
    if not result:
        return ""
    return "\n".join(line[1] for line in result).strip()


@app.post("/v1/chat/completions")
def chat_completions(req: ChatCompletionRequest) -> dict[str, Any]:
    images = _extract_images(req.messages)
    if not images:
        raise HTTPException(400, "No image_url content found in the request.")

    try:
        pages = [_run_ocr(data) for data in images]
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("OCR failed")
        raise HTTPException(500, f"OCR failed: {exc}") from exc

    content = "\n\n".join(p for p in pages if p) or "[No text detected on this page]"

    return {
        "id": "ocr-chatcmpl-1",
        "object": "chat.completion",
        "model": req.model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": content},
            "finish_reason": "stop",
        }],
    }


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: loopback only)")
    parser.add_argument("--port", type=int, default=10000, help="Bind port (default: 10000)")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port)