# Privacy-Aware Contract Review Agent
### 프라이버시 보호형 계약 검토 AI 에이전트 · Team 머핀 (Muffin)

Business teams want generative AI to review contracts. Those contracts contain names, account
numbers, business registration numbers, contract values and confidential project codenames that
must not leave the building.

This agent sits in between. Every document — PDF, scanned image, Word, Excel, or Korean **HWP** —
is converted to Markdown, a **CrewAI chain of four local agents** detects and risk-rates every
sensitive value, replaces it with a consistent and realistic stand-in, and re-scans the result.
Only the masked Markdown is ever sent to a model. When the answer comes back, the real values are
restored locally.

```
Upload  →  Markdown  →  [ CrewAI local chain: Detect → Classify → Pseudonymize ]
                                          │
                        masked Markdown ──┴──→  OpenAI / Mistral / Ollama
                                          │
                        answer ───────────┴──→  remap fake → real, locally
```

**Deeper reading:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — full system design, which model
does what, preprocessing libraries, why there is no RAG. ·
[docs/CONTEXT-AND-CHAT.md](docs/CONTEXT-AND-CHAT.md) — the three memory layers, chat prompt shape,
what persists and what deliberately does not.

---

## Features

- **Any-format ingestion → Markdown** — `.pdf` (digital text layer or OCR), `.png` `.jpg` `.jpeg`
  `.webp` `.bmp` `.tiff`, `.docx`, **`.hwp` (Korean Hangul, via pyhwp)**, `.xlsx` `.xls`, `.html`,
  `.md` `.txt` `.csv`. See [§5](#5-ingestion--every-format-becomes-markdown).
- **Two swappable OCR backends** for scanned PDFs and images — run a fast, separate **OCR server**
  (`backend/ocr_server.py`, RapidOCR, OpenAI-compatible endpoint) or an in-process **PaddleOCR
  PP-StructureV3**, with a PyMuPDF text-layer fallback for digital PDFs when neither is installed.
  See [§4](#4-ocr-backend-for-pdfs-and-images).
- **CrewAI three-agent privacy chain** — Detect → Classify → Pseudonymize, running on a
  **local** Ollama model, backed by deterministic Python as the authority on what actually leaves
  the process. See [§8](#8-the-crewai-chain).
- **Hybrid Korean + English detection** — 주민등록번호, 사업자등록번호, 계좌번호, IBAN, card
  numbers, phone numbers, emails, ₩/$/€/£ amounts including Korean written numerals
  (`금 팔천오백만원정`), Korean and English dates, company names, bank names, addresses, person
  names (context-gated so ordinary words are never swapped), and internal project codenames.
- **Semantic-preserving pseudonymization** — one scale factor for every amount and one offset for
  every date per document, so `"liability capped at 20% of the total"` and `"notice 60 days before
  expiry"` still check out after masking. See [§7](#7-how-the-privacy-layer-actually-works).
- **Multi-provider chat** — OpenAI, Mistral, or local Ollama. Only masked Markdown ever reaches an
  external provider; the real values are remapped back for display, locally, with no network call.
- **Audit log** — every ingestion, privacy-chain run, and chat query is logged and exportable as
  Markdown (`?variant=audit`).
- **Zero build step** — React + Tailwind + Babel load from CDN; the backend serves the two frontend
  files directly. No Node, no npm, no bundler.
- **Nothing persisted to disk** — the document store is in-memory only; a server restart clears
  everything.
- **One-command temporary public demo** via a Cloudflare Quick Tunnel — no account, no DNS setup.
  See [§10](#10-temporary-public-hosting-cloudflare-tunnel).

---

## 1. Prerequisites

- **Python 3.10+** (developed against 3.13). Node is *not* required.
- **[Ollama](https://ollama.com)** — optional but recommended: it's what runs the CrewAI privacy
  chain locally, and it's the only chat provider that keeps every request on this machine. Without
  it the app still runs, using a deterministic fallback for the privacy chain and OpenAI/Mistral
  for chat.
- **OCR backend** — optional, only needed for scanned PDFs and images. See [§4](#4-ocr-backend-for-pdfs-and-images).

---

## 2. Setup

```bash
# 1. from the project root
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

# 2. install the main app's dependencies
pip install -r requirements.txt

# 3. copy the env template and adjust if needed (all values are optional)
copy .env.example .env          # Windows
# cp .env.example .env          # macOS / Linux
```

### Install Ollama and pull the model

Skip this if you only plan to use OpenAI/Mistral for chat and don't need the local CrewAI chain —
the app falls back to a deterministic privacy chain without it.

```bash
# Windows — winget, or download the installer from https://ollama.com/download/windows
winget install Ollama.Ollama

# macOS — download from https://ollama.com/download/mac, or:
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

The installer on Windows/macOS starts Ollama as a background service automatically. On Linux, or
if it isn't already running, start it yourself:

```bash
ollama serve
```

Then pull the model the privacy chain uses by default (`CREW_MODEL` in `.env.example`):

```bash
ollama pull gemma4:12b
```

Don't have that exact model, or want a smaller/faster one? Pull whatever you have and set
`CREW_MODEL` in `.env` to match — or leave it unset: if `gemma4:12b` isn't installed, the app
automatically falls back to the first model `ollama list` shows.

---

## 3. Run

**If you want OCR** for scanned PDFs or images, start the OCR server **first**, then the main
app — the main app reads `OCR_SERVER_URL` from `.env` once at startup and shows it as live on the
Home tab immediately if the server answering at that address is already up. (Nothing breaks if
you start them in the other order — the app checks the OCR server fresh on every conversion, not
just at startup — but "OCR server, then app" is the order to default to.) See
[§4](#4-ocr-backend-for-pdfs-and-images) to install one first if you haven't yet.

```bash
# terminal 1 — OCR server (only if you installed one; skip otherwise)
python backend/ocr_server.py --port 10000

# terminal 2 — the main app (always)
cd backend
uvicorn main:app --reload --port 8000
```

Open **http://127.0.0.1:8000** and click **Demo**.

`.docx`, `.hwp`, `.xlsx`, `.md`/`.txt`/`.csv`/`.html` and digital PDFs all work with just the main
app running — no OCR server needed for any of those. Scanned PDFs and images are the only formats
that need one.

### 2-minute demo path

1. **Demo → Upload & Mask** → click `+ sample-supply-contract-ko.docx`
2. Click **Run privacy chain** → watch the three agents reason through the document
3. Scroll down → the **mapping store** and the exact **masked Markdown** that would be sent out
4. **Chat** tab → select the document → ask *"Who are the two parties and the total amount?"*
5. Click the **masked (exactly as sent)** badge → it flips to the real values, restored locally

---

## 4. OCR backend for PDFs and images

Scanned PDFs and images need OCR. Two backends, tried in that order — set up one, or set up
neither and rely on the PyMuPDF text-layer fallback for digital PDFs. This section is about
**installing and choosing** an engine; see [§3](#3-run) for the run order once one is installed.

**Option A — a separate OCR server (recommended).** Runs as its own process — its own port,
started and restarted independently of the main app, and it can move to another machine later —
so the whole team can point at one shared engine. It can live in the same `.venv` as the main app:

```bash
pip install -r requirements-ocr-server.txt
```

(One extra dependency on top of `requirements.txt`: `rapidocr-onnxruntime`, ~50 MB of weights
downloaded on first use. If you'd rather keep it fully isolated, install into a separate venv
instead — nothing about `ocr_server.py` requires sharing one.)

Then set `OCR_SERVER_URL=http://127.0.0.1:10000` in `.env` — **before** you start the main app,
since it's only read once at startup (`load_dotenv`) — and start the two processes in the order
shown in [§3](#3-run). `ocr_server.py` speaks a small OpenAI-compatible `/v1/chat/completions`
contract, so its bundled RapidOCR engine is a drop-in that can be swapped for PaddleOCR
PP-StructureV3, Unlimited-OCR, or any other vision endpoint without changing `convert.py`. Because
OCR runs *before* masking, a non-loopback `OCR_SERVER_URL` is refused unless you set
`OCR_ALLOW_REMOTE=true` deliberately — raw pages should not leave this machine.

**Option B — PaddleOCR PP-StructureV3, in-process.** Does OCR, layout analysis and table
detection in one pass, no separate server to run — the main app uses it directly, nothing extra to
start. It is a ~1 GB install, so it is kept separate from `requirements.txt`:

```bash
pip install -r requirements-ocr.txt
```

Model weights (~200 MB) download on the first PDF or image you process.

**Without either, the app still runs.** PDFs fall back to PyMuPDF text extraction, which handles
digital PDFs fine but not scanned ones. Images are unsupported until you install one of the two.
The Home tab shows which engine is live under **RUNTIME**.

---

## 5. Ingestion — every format becomes Markdown

| Input | Library | Notes |
| --- | --- | --- |
| `.pdf` | OCR server → PaddleOCR PP-StructureV3 → PyMuPDF fallback | **digital PDFs work with no extra install**; scanned PDFs need one of the two OCR backends (§4) |
| `.png` `.jpg` `.jpeg` `.webp` `.bmp` `.tiff` | OCR server → PaddleOCR PP-StructureV3 | needs one of the two OCR backends (§4) |
| `.docx` | mammoth + markdownify | keeps headings, lists, tables |
| `.hwp` | pyhwp (`hwp5`) | native Hangul (HWP5) parser, no Office/Hangul install needed |
| `.xlsx` `.xls` | pandas + tabulate | one Markdown table per sheet |
| `.html` | markdownify | |
| `.md` `.txt` `.csv` | passthrough | |

---

## 6. Choosing a chat model

| Provider | Setup | Where the data goes |
| --- | --- | --- |
| **Local — Ollama** | `ollama serve`, then `ollama pull gemma4:12b` | never leaves your machine |
| **ChatGPT — OpenAI** | paste an API key in the chat toolbar | masked Markdown only |
| **Mistral** | paste an API key in the chat toolbar | masked Markdown only |

API keys are typed into the browser, sent with the single request that needs them, and never
written to disk or logged. You can also set `OPENAI_API_KEY` / `MISTRAL_API_KEY` in your
environment to skip the paste step.

Before anything is sent to an external provider the outgoing payload is re-scanned against the
mapping store. If a single raw value is found, **the request is blocked and nothing is sent.**

---

## 7. How the privacy layer actually works

This is the part that matters, so it is worth being precise about.

**Detection** is rule-based and runs on Korean and English contract patterns: 주민등록번호,
사업자등록번호, 계좌번호, IBAN, card numbers, phone numbers, emails, ₩/$/€ amounts, Korean written
amounts (`금 팔천오백만원정`), Korean and English dates, company names (`…주식회사`, `… Co., Ltd.`),
bank names, addresses, person names, and internal project codenames.

Person names only match in an explicit person context (`대표이사: 이도현`, `이도현 (서명)`), so
ordinary words never get swapped by accident.

**Classification** assigns a risk level and one of three actions:

| Action | Applies to | Behaviour |
| --- | --- | --- |
| `MASK` | 주민등록번호, card numbers | redacted entirely — no fake is safe enough |
| `PSEUDONYMIZE` | everything else sensitive | consistent, realistic stand-in |
| `ALLOW` | percentages, durations, clause numbers | kept, the analysis needs them |

**Pseudonymization is semantic-preserving**, which is the whole point. Two document-level
constants do the work:

- every amount is scaled by **one** factor → *"20% of the total"* still checks out
- every date is shifted by **one** offset → *"60 days before expiry"* still checks out

So `₩85,000,000` → `₩62,900,000` and `금 팔천오백만원정` → `금 62,900,000원정` — the same scale, from
two completely different notations. Formats are preserved too: phone numbers keep their `010-`
prefix, business registration numbers keep their `000-00-00000` shape, Korean dates stay Korean.

Two different companies never receive the same alias — that would silently merge them.

**Restoration** happens in this process, over the mapping store, with no network involved.

---

## 8. The CrewAI chain

Three agents, sequential, each with one tool:

| # | Agent | Tool |
| --- | --- | --- |
| 1 | Sensitive Information Detector | `detect_sensitive_values` |
| 2 | Risk Assessment & Decision Engine | `assess_risk` |
| 3 | Pseudonymization Engine | `pseudonymize_document` |

The detector combines deterministic patterns with semantic extraction by the fixed local Gemma
model. Gemma's findings are proposals: Python accepts only exact substrings from the source with
approved entity types, then performs classification and masking.
The Brain panel shows each prompt, validated model output, and agent response—not hidden
chain-of-thought.

The crew runs on a **local** model only. If Ollama is unavailable, the UI clearly identifies the
deterministic fallback; contextual model-only findings are then unavailable.

---

## 9. Environment variables

All optional.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://localhost:11434` | where Ollama is listening |
| `CREW_MODEL` | `gemma4:12b` | model the CrewAI agents run on (falls back to your first installed model) |
| `CREW_ENABLED` | `true` | set to `false` to skip CrewAI and run the tools directly |
| `OPENAI_API_KEY` | — | avoids pasting the key in the UI |
| `MISTRAL_API_KEY` | — | avoids pasting the key in the UI |
| `OCR_SERVER_URL` | — (unset) | e.g. `http://127.0.0.1:10000` — enables the separate OCR server route (§4, Option A) |
| `OCR_MODEL` | `Unlimited-OCR` | model name sent in the OCR server's chat-completions payload |
| `OCR_PROMPT` | `document parsing.` | instruction sent alongside each page image |
| `OCR_DPI` | `300` | resolution used when rasterizing PDF pages for OCR |
| `OCR_TIMEOUT` | `120` | seconds to wait for one page's OCR response |
| `OCR_ALLOW_REMOTE` | `false` | required to point `OCR_SERVER_URL` at a non-loopback host — OCR runs before masking |

Example (PowerShell): `$env:CREW_MODEL = "gemma4:12b"`

---

## 10. Temporary public hosting (Cloudflare Tunnel)

Want to demo the running app to someone off your network, or test from a phone, without deploying
anywhere? A **Cloudflare Quick Tunnel** gives the app a throwaway `https://*.trycloudflare.com`
URL that proxies to your machine for as long as the tunnel runs — no Cloudflare account, no DNS
setup, no signup.

**1. Install `cloudflared`** (skip if already installed — check with `cloudflared --version`):

```bash
# Windows
winget install --id Cloudflare.cloudflared

# macOS
brew install cloudflared

# Linux — see https://github.com/cloudflare/cloudflared/releases
```

**2. Start the main app** in one terminal (§3), then **run the tunnel script** in another:

```powershell
# Windows (PowerShell)
.\scripts\tunnel.ps1
```
```bash
# macOS / Linux
./scripts/tunnel.sh
```

Both accept an optional port argument if you're not using the default 8000
(`.\scripts\tunnel.ps1 -Port 8080` / `./scripts/tunnel.sh 8080`). Cloudflare prints the public URL
to the terminal once the tunnel is up; `Ctrl+C` tears it down.

**This is for quick demos, not production hosting.** The URL is random and changes every run,
there's no authentication in front of it, and anyone with the link can reach your running instance
— including whatever external chat providers you've configured. Only start the tunnel while you
intend the link to be reachable, and stop it when the demo is over.

---

## 11. Project layout

```
backend/
  privacy.py     the core — detect, classify, pseudonymize, verify, remap, mapping store
  convert.py     any file → Markdown
  ocr_server.py  standalone OCR server (OCR_SERVER_URL side of convert.py)
  crew.py        the four-agent CrewAI chain (+ deterministic fallback)
  llm.py         model router — OpenAI / Mistral / Ollama, the only outbound network code
  main.py        FastAPI routes + serves the UI
frontend/
  index.html     zero-build page (React + Tailwind via CDN, Babel in the browser)
  app.jsx        the whole interface
scripts/
  tunnel.ps1     Cloudflare Quick Tunnel launcher (Windows)
  tunnel.sh      Cloudflare Quick Tunnel launcher (macOS/Linux)
samples/         demo contracts (Korean .docx, English .md)
docs/            ARCHITECTURE.md · CONTEXT-AND-CHAT.md
```

`privacy.py` makes no network calls at all, so raw values cannot leave from there.

---

## 12. API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | which OCR / agent / local models are live |
| `GET` | `/api/samples` | bundled demo documents |
| `POST` | `/api/documents` | upload files → Markdown |
| `POST` | `/api/documents/sample` | load a bundled sample |
| `POST` | `/api/documents/{uid}/run` | run the privacy chain |
| `GET` | `/api/documents/{uid}/download?variant=masked\|raw\|audit` | export |
| `POST` | `/api/chat` | ask a model about masked documents |
| `POST` | `/api/remap` | restore real values in pasted text |

Interactive docs at `/docs`.

---

## 13. Troubleshooting

**`Could not reach ollama`** — run `ollama serve`, and `ollama pull gemma4:12b`.

**Reasoning panel shows no agent notes** — the crew fell back to the direct chain. Check the
server log for `[crew] falling back`. Usually Ollama is down or the model does not support tool
calling. Results are still correct.

**`unavailable (PDF falls back to PyMuPDF…)`** on the Home tab — expected until you install an OCR
backend (§4).

**`<provider> rejected the API key`** — the key is wrong, expired, or out of credit. Note that keys
are trimmed on both sides now: a trailing space or newline from a copy-paste used to fail with a
confusing "illegal header value" before the request ever left the machine.

**The page shows `compiling the interface…` forever** — the CDN scripts could not load. The UI
needs internet on first load for React, Tailwind and Babel.

**A value was missed, or something was masked that shouldn't be** — the patterns live in
`_PATTERNS` at the top of `backend/privacy.py`, and the risk/action table is `TAXONOMY` right
above it. Both are meant to be edited.

---

## 14. Known limits

- The mapping store is in memory. Restarting the server clears every document — deliberate, but
  it means no persistence across sessions.
- Detection is rule-based. It is precise and fast on contract-shaped documents; free-form prose
  with unusual name formats will need pattern tuning.
- OCR quality on low-resolution scans bounds everything downstream — the privacy layer can only
  protect text it can see.

---

## Copyright

© 2026 [mavinsao@jnu.ac.kr](mailto:mavinsao@jnu.ac.kr)
