# Architecture

How the Privacy-Aware Contract Review Agent is actually built. Every claim here matches the code
in `backend/` and `frontend/` — if you change one, change the other.

---

## 1. The one-sentence version

A file becomes Markdown, local Gemma and deterministic patterns find sensitive values, Python
validates and masks them, a non-blocking verifier reports unchanged originals, only the masked
Markdown may reach a chat model, and real values are put back locally when the answer returns.

---

## 2. End-to-end flow

```
┌─ browser ──────────────────────────────────────────────────────────────────┐
│  frontend/app.jsx   upload · run chain · chat · reconstruct                 │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │  HTTP (same origin)
┌─ this machine ─────────────────────▼───────────────────────────────────────┐
│                                                                            │
│  main.py          FastAPI routes                                           │
│      │                                                                     │
│      ├─ convert.py    any file  ──────────────────────────────► Markdown   │
│      │                OCR server / PaddleOCR / mammoth / pyhwp / pandas    │
│      │                                                                     │
│      ├─ crew.py       CrewAI sequential chain, LOCAL model only            │
│      │                  1 Detector          → detect_sensitive_values      │
│      │                  2 Risk & Decision   → assess_risk                  │
│      │                  3 Pseudonymizer     → pseudonymize_document        │
│      │                        │                                            │
│      │                        └── every tool calls ──┐                     │
│      │                                               ▼                     │
│      ├─ privacy.py    DETERMINISTIC VALIDATION / MASKING — no network      │
│      │                detect → classify → pseudonymize → verify → remap    │
│      │                + mapping store + audit log                          │
│      │                                                                     │
│      └─ llm.py        the ONLY outbound network code                       │
│                          masked Markdown ──┐                               │
└────────────────────────────────────────────┼───────────────────────────────┘
                                             ▼
                            OpenAI  ·  Mistral  ·  Ollama (local)
                                             │
                     answer (contains fakes) ─┘
                                             ▼
                            privacy.remap()  fake → real, locally
```

The boundary that matters: **`privacy.py` imports no network library at all.** Raw values
physically cannot leave the process through it. `llm.py` is the only file that opens a socket, and
the application uses for provider requests. Verification reports unchanged detected originals but
does not block completion or outbound chat.

---

## 3. Which model does what

This is the question people get wrong about privacy tools, so it is worth stating plainly.

| Layer | Model | Why |
| --- | --- | --- |
| **Security detection** | **hybrid: patterns + local Gemma** | Patterns catch structured identifiers; Gemma proposes contextual names, organizations, addresses, and codenames. Python accepts only exact source substrings and approved types. |
| **Agent chain** (CrewAI) | **local Ollama only** (`CREW_MODEL`, default `gemma4:12b`) | The raw document stays local. Each stage records its prompt, validated output, and concise returned summary. |
| **Contract review** (chat) | **user's choice** — OpenAI, Mistral, or Ollama | This is where real capability matters, and it is exactly the step that only ever sees masked text. |

Gemma expands contextual coverage; deterministic Python remains authoritative for validation,
replacement, and post-mask verification. If Ollama is unavailable, the trace explicitly
marks the reduced-coverage deterministic fallback.

---

## 4. Preprocessing: any file → Markdown

Markdown is the pivot format for everything. It keeps table structure (contracts are full of
tables), it is what LLMs read best, and it makes masking a plain string operation.

| Input | Library | Output |
| --- | --- | --- |
| `.pdf` | **OCR server** → **PaddleOCR PP-StructureV3** → PyMuPDF text fallback | Markdown, `## Page N` headings |
| `.png` `.jpg` `.webp` `.bmp` `.tiff` | **OCR server** → **PaddleOCR PP-StructureV3** | Markdown / recognized text |
| `.docx` | **mammoth** → HTML → **markdownify** | Markdown, headings/lists/tables preserved |
| `.hwp` | **pyhwp** (`hwp5`) | Markdown text, no Office/Hangul install needed |
| `.xlsx` `.xls` | **pandas** + **tabulate** | one Markdown table per sheet |
| `.html` | **markdownify** | Markdown |
| `.md` `.txt` `.csv` | passthrough | as-is |

**Two OCR backends, tried in order** (`convert.py`, `OCR_SERVER_URL`):

1. **OCR server** — any OpenAI-compatible vision endpoint. PDF pages are rasterized to PNG
   (`OCR_DPI`, default 300) and POSTed to `{OCR_SERVER_URL}/v1/chat/completions`, one page per
   request, as a `data:` URI. `backend/ocr_server.py` is a ready-to-run implementation (RapidOCR,
   `pip install -r requirements-ocr-server.txt`) meant to run as its **own process** — its own
   venv, optionally its own machine — so the main app's virtualenv stays free of OCR weights and a
   whole team can share one engine. Because OCR sees the document **before** the privacy layer
   does, `_check_ocr_url()` refuses any `OCR_SERVER_URL` that isn't loopback unless
   `OCR_ALLOW_REMOTE=true` is set deliberately — otherwise raw contract pages could leave the
   machine unmasked.
2. **PaddleOCR PP-StructureV3**, in-process (`pip install -r requirements-ocr.txt`, ~1 GB) — OCR +
   layout + table detection in one pass, no server to run.

**Does PDF work?** Yes, three ways:

- **Digital PDFs work today**, with no extra install — PyMuPDF pulls the embedded text layer.
  Verified: 22 entities detected, 0 leaks, on a generated test contract.
- **Scanned PDFs need one of the two OCR backends above.** Without either, a scanned page has no
  text layer and produces an empty document, which the API rejects with a clear error rather than
  silently passing an empty file downstream.

The Home tab's **RUNTIME** panel tells you which engine is live.

All output goes through `_tidy()` — CRLF normalized, non-breaking spaces flattened, runs of blank
lines collapsed — so detection sees predictable text regardless of source format.

---

## 5. The security layer in detail (`privacy.py`)

Four local stages. Detection is hybrid; validation, classification, replacement, and verification
remain deterministic.

### Detect
`_PATTERNS` — an ordered list of `(type, regex)`. Order is load-bearing: IBAN is tested before
card numbers because an IBAN's digit groups look exactly like a card, and business registration
numbers before generic account numbers.

Covers Korean and English contract shapes: 주민등록번호, 사업자등록번호, 계좌번호, IBAN, card
numbers, phone numbers, emails, `…주식회사` / `… Co., Ltd.`, bank names, addresses, person names,
and internal project codenames. Money and dates default to `KEEP` so calculations and timeline
reasoning stay accurate; users can add them as custom tags when stronger protection is required.

Person names only match inside an explicit person context — `대표이사: 이도현`, `이도현 (서명)`,
`Representative: Dohyun Lee` — so ordinary Korean words are never swapped out by accident. (This
was a real bug: `담당자 정보` parsed "정보" as a surname + given name.)

### Classify — the Decision Engine
`TAXONOMY` maps each type to a risk level and one of three actions:

| Action | Applies to | Behaviour |
| --- | --- | --- |
| `MASK` | 주민등록번호, card numbers | redacted to `[REDACTED-TYPE]` — no fake is safe enough |
| `PSEUDONYMIZE` | everything else sensitive | consistent, realistic stand-in |
| `ALLOW` | percentages, durations, clause numbers | kept — the analysis needs them |

### Pseudonymize — semantic-preserving, this is the whole point
Naive masking (`[COMPANY]`, `XXX-XX-XXXX`) destroys the analysis. Two document-level constants,
derived from the document's own hash, prevent that:

Shapes survive too: phone numbers keep their `010-` prefix, business registration numbers keep
`000-00-00000`, and `Co., Ltd.` stays `Co., Ltd.` Amounts and dates are kept unchanged.

`_pick_unique()` guarantees two different originals never receive the same alias — merging two
companies into one fake name would silently corrupt the review.

Everything is seeded by document UID, so the same document always produces the same mapping.

### Verify — non-blocking post-mask checker
After masking, deterministic Python checks whether each detected original value is still present.
Intentional `KEEP` values become reminders. Originals marked `PSEUDONYMIZED` or `REMOVED` that
remain become risk warnings. The result appears in the document table, reasoning trace, and Chat
document reminder. Verification never blocks completion; users can change the tag policy and use
**Redo** to run all four stages again from the stored original Markdown.

### Remap
`fake → real`, longest-match-first, in this process, no network. `MASK`-ed values are never
restored — there is nothing to restore them to, which is the point.

---

## 6. Backend routes (`main.py`)

| Method | Route | What it does |
| --- | --- | --- |
| `GET` | `/api/health` | which OCR engine, agent chain and local models are live |
| `GET` | `/api/samples` | bundled demo documents |
| `POST` | `/api/documents` | upload → temp file → Markdown → store, temp file deleted |
| `POST` | `/api/documents/sample` | same, from `samples/` |
| `POST` | `/api/documents/{uid}/scan` | start or redo detection from the original Markdown |
| `POST` | `/api/documents/{uid}/mask` | pseudonymize and verify classified values |
| `GET` | `/api/documents` | list (never includes raw Markdown) |
| `GET` | `/api/documents/{uid}/download?variant=masked\|raw\|audit` | export |
| `DELETE` | `/api/documents/{uid}` | drop from the store |
| `POST` | `/api/chat` | send masked → remap answer |
| `GET/PUT` | `/api/chat-state` | load or save in-memory chat state, excluding API keys |
| `POST` | `/api/remap` | restore real values in pasted text |
| `GET/POST` | `/api/ner-tags` | list the policy or create a custom tag |
| `PUT` | `/api/ner-tags/{name}` | update default or custom tag guidance/handling |
| `POST` | `/api/ner-tags/{name}/reset` | reset a default tag |
| `DELETE` | `/api/ner-tags/{name}` | delete a custom tag |

`Document.public()` takes an `include_raw` flag that defaults to **False**, so the raw Markdown is
opt-in on the server side and never reaches the browser through a list or run response.

### Audit log
Every document carries an append-only `audit` list: `ingested` (converter, size),
`privacy_chain` (engine, entity count, completion status), and one
`external_query` / `local_query` per chat turn (provider, model, values restored).
Exportable as Markdown via `?variant=audit`.

---

## 7. Frontend (`frontend/app.jsx`)

Zero build step — React 18, Tailwind and lucide load from CDN, Babel compiles the JSX in the
browser, FastAPI serves the two files. No Node, no bundler, no `npm install`.

Four top tabs (Home, Team, Architecture, Demo) and four demo tabs (Upload & Mask, NER Tags, Chat,
Reconstruct). One `<App>` owns all shared state:

- `docs` — the document list, refreshed from `/api/documents` after every mutation
- `chat` — sessions, active session, provider, model, API key, draft input
- `health` — runtime capabilities

`ReasoningBox` polls the background review job and reveals each trace step as its CrewAI task
callback completes; the data
all arrives in one response.

---

## 8. How chat works — no RAG, and that is deliberate

**There is no vector store, no embedding model, and no retrieval.** The full masked Markdown of
every selected document goes into the prompt.

Contracts are the case where retrieval actively hurts. The dangerous clause is usually the one
nobody asked about, cross-references run across the whole document (`Article 10` limits liability
to a percentage defined in `Article 3`), and a typical contract is 3–10 KB of Markdown — well
inside any modern context window. Chunking would drop exactly the clause that mattered.

Request shape sent to the provider:

```
[system]     SYSTEM_PROMPT — "these documents are pseudonymized, analyze as written,
                              never point out that values look fake, answer in the
                              language of the question, quote clause numbers"
[user]       "Documents:\n\n# name\n\n<masked markdown>"   ← all selected documents
[user/asst]  …conversation history, assistant turns are the MASKED answers…
[user]       the current question
```

The history invariant matters: assistant turns are replayed as `masked_answer`, **never** the
remapped one. If the remapped text were replayed, the second question in a conversation would ship
every real value straight to the provider. The masked/real toggle is a display concern only.

Full detail — including memory layers, the tab-switch fix, and the scaling plan — is in
[CONTEXT-AND-CHAT.md](CONTEXT-AND-CHAT.md).

---

## 9. What is stored, and where

| Layer | Holds | Lifetime |
| --- | --- | --- |
| Browser (React state) | active UI state and provider API key | page reload clears it |
| Server (in-process memory) | raw/masked Markdown, mappings, audit log, tag policy, chat history | server restart clears it |
| Disk | **nothing** | — |
| Provider | masked Markdown only | their retention policy |

No database, cache file, `localStorage`, or `sessionStorage`. API keys are held in React state,
sent with the single request that needs them, and never persisted with chat history.

---

## 10. Known limits

- **Rule-based detection.** Precise and fast on contract-shaped documents; free-form prose with
  unusual name formats needs pattern tuning. `_PATTERNS` and `TAXONOMY` are meant to be edited.
- **In-memory store.** Restarting the server clears every document. Deliberate, but it means no
  cross-session history.
- **Whole-document prompting.** Fine to roughly 30 KB of Markdown; beyond that the plan in
  CONTEXT-AND-CHAT.md §6 applies.
- **OCR quality bounds everything.** The privacy layer can only protect text it can see.
