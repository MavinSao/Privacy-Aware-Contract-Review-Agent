"""Model Router — the only place in the codebase that talks to an LLM.

Four providers: OpenAI, Claude, Mistral, and local Ollama. API keys arrive per request
from the browser and are never written to disk or logged.

Callers must pass MASKED text only. `chat()` refuses to run if the caller has not
declared the payload safe, which keeps the leak surface down to one function.
"""

from __future__ import annotations

import os

import httpx

TIMEOUT = httpx.Timeout(120.0, connect=10.0)
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

PROVIDERS = {
    "openai":  {"url": "https://api.openai.com/v1/chat/completions", "needs_key": True,  "default": "gpt-4o-mini"},
    "anthropic": {"url": "https://api.anthropic.com/v1/messages",       "needs_key": True,  "default": "claude-sonnet-4-20250514"},
    "mistral": {"url": "https://api.mistral.ai/v1/chat/completions", "needs_key": True,  "default": "mistral-large-latest"},
    "ollama":  {"url": f"{OLLAMA_HOST}/api/chat",                    "needs_key": False, "default": "gemma4:12b"},
}


class LLMError(RuntimeError):
    pass


def is_external(provider: str) -> bool:
    return provider != "ollama"


def _redact(message: str, key: str) -> str:
    """Provider errors quote the request back, key included. Never surface it —
    the message ends up in a browser toast and in the server log."""
    return message.replace(key, "***") if key else message


def chat(provider: str, model: str | None, api_key: str | None,
         messages: list[dict[str, str]], *, payload_is_masked: bool) -> str:
    """Send a conversation to the chosen provider and return the reply text."""
    if is_external(provider) and not payload_is_masked:
        raise LLMError("Refusing to send unmasked content to an external provider.")

    config = PROVIDERS.get(provider)
    if not config:
        raise LLMError(f"Unknown provider '{provider}'. Choose one of: {', '.join(PROVIDERS)}")

    # Strip before use. A key pasted from a web page or a text file almost always
    # carries a trailing space or newline, and an HTTP header cannot hold either —
    # httpx rejects the request locally with a confusing "illegal header value".
    model = (model or config["default"]).strip()
    key = (api_key or os.getenv(f"{provider.upper()}_API_KEY", "")).strip()
    if config["needs_key"] and not key:
        raise LLMError(f"An API key is required for {provider}. Paste it in the chat settings.")

    if provider == "ollama":
        body = {"model": model, "messages": messages, "stream": False}
        headers = {}
    elif provider == "anthropic":
        body = {
            "model": model,
            "max_tokens": 4096,
            "system": "\n\n".join(m["content"] for m in messages if m["role"] == "system"),
            "messages": [m for m in messages if m["role"] in ("user", "assistant")],
        }
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
    else:
        body = {"model": model, "messages": messages, "temperature": 0.2}
        headers = {"Authorization": f"Bearer {key}"}

    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(config["url"], json=body, headers=headers)
    except httpx.HTTPError as exc:
        hint = " Is `ollama serve` running?" if provider == "ollama" else ""
        raise LLMError(f"Could not reach {provider}: {_redact(str(exc), key)}.{hint}") from exc

    if response.status_code == 401:
        raise LLMError(f"{provider} rejected the API key. Check that it is current and has credit.")
    if response.status_code >= 400:
        raise LLMError(f"{provider} returned {response.status_code}: "
                       f"{_redact(response.text[:300], key)}")

    data = response.json()
    if provider == "ollama":
        return (data.get("message") or {}).get("content", "").strip()
    if provider == "anthropic":
        return "\n".join(block["text"] for block in data.get("content", [])
                          if block.get("type") == "text").strip()
    return data["choices"][0]["message"]["content"].strip()


def ollama_models() -> list[str]:
    """List locally installed Ollama models, or an empty list if it is not running."""
    try:
        with httpx.Client(timeout=httpx.Timeout(4.0)) as client:
            tags = client.get(f"{OLLAMA_HOST}/api/tags").json()
        return [m["name"] for m in tags.get("models", [])]
    except Exception:
        return []
