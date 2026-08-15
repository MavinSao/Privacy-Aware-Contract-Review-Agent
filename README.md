# Privacy-Aware Contract Review Agent

> Local-first document masking and contract review by **muffin_team**.

The application converts business documents to Markdown, detects configured sensitive entities,
applies a handling decision to each entity, and lets users review the processed document with a
local or external language model. Entity mapping and response reconstruction happen locally.

```text
Document
   |
   v
OCR / conversion -> Detect -> Classify -> Pseudonymize -> Masked Markdown
                                      |                     |
                                      |                     v
                                      +----------> OpenAI / Mistral / Ollama
                                                            |
                                                            v
                                              Local fake-to-real remapping
```

## Current features

- PDF, image, DOCX, HWP, spreadsheet, HTML, Markdown, text, and CSV ingestion.
- Background OCR for bundled samples with visible status transitions:
  `OCR processing` -> `detecting` -> `masking` -> `Done`.
- Three-stage CrewAI workflow using local Ollama:
  Detect -> Classify -> Pseudonymize.
- Progressive detection UI: the prompt appears first, a Gemma loading indicator is shown, then
  validated model output and the final agent response appear as they become available.
- Deterministic pattern detection plus contextual local-model detection.
- English-only detector prompt instructions and examples.
- Custom NER tags that can be created or deleted from the **NER Tags** tab.
- Three public handling statuses: `PSEUDONYMIZED`, `KEEP`, and `REMOVED`.
- Chat through OpenAI, Mistral, or local Ollama.
- Local reconstruction of pseudonymized values in model responses.
- In-memory document store and downloadable masked Markdown or audit reports.
- Zero-build React interface served directly by FastAPI.

## Privacy scope

Built-in detection currently covers:

- resident registration numbers;
- payment-card numbers;
- bank accounts and IBANs;
- business registration numbers;
- phone numbers and email addresses;
- people, organizations, banks, and postal addresses;
- internal project codenames.

`MONEY`, `MONEY_TEXT`, and `DATE` are intentionally not NER tags. Amounts and dates remain
unchanged.

The application no longer performs a post-mask leak scan. Processing finishes with `Done` after
pseudonymization. Detection quality therefore defines what is protected: a value missed by both
the deterministic patterns and the local detector remains unchanged.

## Processing method

### 1. OCR and conversion

Every supported input becomes Markdown before entity detection begins.

| Input | Method |
| --- | --- |
| Digital PDF | pypdf text layer |
| Scanned PDF | OCR server or PaddleOCR |
| PNG, JPG, JPEG, WEBP, BMP, TIFF | OCR server or PaddleOCR |
| DOCX | mammoth + markdownify |
| HWP | pyhwp |
| XLSX, XLS | pandas + tabulate |
| HTML | markdownify |
| Markdown, text, CSV | direct text conversion |

Bundled samples are registered in the document table immediately. Conversion then runs in a
background thread, allowing the UI to show `OCR processing` before detection begins.

### 2. Detect

The Sensitive Information Detector combines two sources:

1. deterministic regular-expression matches from `backend/privacy.py`;
2. contextual entities proposed by the configured local Ollama model.

Model proposals are accepted only when the value is an exact substring of the source document
and the returned type exists in the current NER taxonomy. This prevents the model from inventing
values or unauthorized entity types.

The reasoning panel is updated progressively:

1. publish the detector prompt;
2. show `Gemma is detecting...`;
3. publish the validated JSON model output;
4. publish the completed detector summary.

### 3. Classify

The Risk Assessment & Decision Engine assigns one handling action to every accepted entity.
Internal risk values may still support backend decisions, but the public UI displays only the
result:

| Public status | Internal action | Result |
| --- | --- | --- |
| `PSEUDONYMIZED` | `PSEUDONYMIZE` | Replace with a consistent stand-in. |
| `KEEP` | `ALLOW` | Preserve the original value. |
| `REMOVED` | `MASK` | Replace with `[REDACTED-TYPE]`. |

### 4. Pseudonymize

The Pseudonymization Engine applies the selected action. Built-in types receive format-aware
stand-ins where supported. Custom pseudonymized types use a `[TYPE]` placeholder. Values marked
`KEEP` remain unchanged, and values marked `REMOVED` are redacted.

The document status becomes `Done` when this stage finishes.

### 5. Chat and reconstruction

The processed Markdown can be sent to:

- Ollama on the local machine;
- OpenAI;
- Mistral.

The returned answer initially contains stand-ins. The browser can display the reconstructed
answer by asking the backend to replace known fake values with their originals from the in-memory
mapping store. Removed values are never restored.

## Detector prompt

The local semantic detector receives an English system prompt with these rules:

- return JSON only;
- copy exact source text;
- never infer, normalize, translate, or invent values;
- inspect labeled fields, prose, tables, signatures, headers, and footers;
- return every distinct notation and every occurrence category;
- use only the currently authorized NER types;
- return an empty entity list when nothing matches.

The allowed-type list is built at scan time. Custom tag names and their detection guidance are
appended to this prompt automatically.

## Custom NER tags

Open **Demo -> NER Tags** to add project-specific security or privacy categories that are not in
the built-in list.

Each custom tag has three fields:

| Field | Meaning | Example |
| --- | --- | --- |
| Root tag | Uppercase NER category returned by the model | `SECRET_KEY` |
| What belongs in this tag? | Keywords, patterns, or examples that guide detection | `API keys, access tokens, private credentials` |
| Handling | What happens to matched values | `REMOVED` |

Tag names must contain 2-32 uppercase letters, numbers, or underscores and must start with a
letter. Built-in tags cannot be overwritten.

Custom tags are held in server memory. They apply to new scans and are cleared when the backend
restarts. They require the local semantic detector; the deterministic fallback has no generated
regex for custom categories.

## Requirements

- Python 3.10+
- Ollama for contextual NER and local chat
- Optional OCR server or PaddleOCR for scanned PDFs and images
- Internet access on initial UI load for React, Tailwind, and Babel CDN assets

## Installation

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Install and prepare Ollama:

```powershell
winget install Ollama.Ollama
ollama pull gemma4:12b
```

Use another installed Ollama model by changing `CREW_MODEL` in `.env`.

## OCR options

### Separate OCR server

```powershell
pip install -r requirements-ocr-server.txt
python backend\ocr_server.py --port 10000
```

Then configure:

```dotenv
OCR_SERVER_URL=http://127.0.0.1:10000
```

### In-process PaddleOCR

```powershell
pip install -r requirements-ocr.txt
```

Without either OCR option, digital PDFs and text-based formats still work. Scanned PDFs and
images require OCR. Non-loopback OCR endpoints are refused unless `OCR_ALLOW_REMOTE=true` is set
explicitly because OCR receives the raw document before masking.

## Run

Optional OCR server, in terminal 1:

```powershell
python backend\ocr_server.py --port 10000
```

Main application, in terminal 2:

```powershell
Set-Location backend
uvicorn main:app --reload --port 8000
```

Open <http://127.0.0.1:8000>.

## Demo workflow

1. Open **Demo -> NER Tags** and optionally add custom categories.
2. Open **Upload & Mask** and choose a file or bundled sample.
3. Watch `OCR processing`, `detecting`, `masking`, and `Done` in the table.
4. Open the reasoning panel to see the prompt, loading state, validated output, and agent response.
5. Review the mapping store and processed Markdown.
6. Open **Chat**, select the document, choose a provider, and ask a contract question.
7. Toggle the answer between pseudonymized and locally reconstructed values.
8. Use **Reconstruct** to remap known placeholders in pasted model output.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama endpoint |
| `CREW_MODEL` | `gemma4:12b` | Local model used by CrewAI |
| `CREW_ENABLED` | `true` | Disable to use deterministic tools only |
| `OPENAI_API_KEY` | unset | Optional OpenAI key |
| `MISTRAL_API_KEY` | unset | Optional Mistral key |
| `OCR_SERVER_URL` | unset | OpenAI-compatible OCR endpoint |
| `OCR_MODEL` | `Unlimited-OCR` | OCR endpoint model name |
| `OCR_PROMPT` | `document parsing.` | OCR instruction |
| `OCR_DPI` | `300` | PDF rasterization resolution |
| `OCR_TIMEOUT` | `120` | OCR timeout per page |
| `OCR_ALLOW_REMOTE` | `false` | Permit a non-loopback OCR endpoint |

## API

Interactive API documentation is available at `/docs`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Runtime engines and installed local models |
| `GET` | `/api/samples` | List bundled documents |
| `POST` | `/api/documents` | Upload and convert documents |
| `POST` | `/api/documents/sample` | Register a sample and start background conversion |
| `GET` | `/api/documents` | List session documents |
| `POST` | `/api/documents/{uid}/scan` | Re-run detection and classification |
| `POST` | `/api/documents/{uid}/mask` | Run pseudonymization |
| `GET` | `/api/documents/{uid}/download` | Download masked, raw, or audit Markdown |
| `DELETE` | `/api/documents/{uid}` | Remove a session document |
| `GET` | `/api/ner-tags` | List custom NER tags |
| `POST` | `/api/ner-tags` | Create or replace a custom NER tag |
| `DELETE` | `/api/ner-tags/{name}` | Delete a custom NER tag |
| `POST` | `/api/chat` | Ask a model about processed documents |
| `POST` | `/api/remap` | Restore known placeholders in pasted text |

## Project layout

```text
backend/
  convert.py       Document-to-Markdown conversion
  crew.py          Three-agent CrewAI workflow and progressive trace events
  llm.py           Ollama, OpenAI, and Mistral routing
  main.py          FastAPI routes, background jobs, and UI serving
  ocr_server.py    Optional standalone OCR service
  privacy.py       NER taxonomy, detection, classification, masking, remapping, store
frontend/
  index.html       Browser entry point
  app.jsx          React interface
docs/
  ARCHITECTURE.md
  CONTEXT-AND-CHAT.md
samples/            Bundled demonstration documents
scripts/            Temporary tunnel launchers
```

## Known limitations

- Documents, mappings, audit data, and custom tags are in memory and disappear after restart.
- Custom tags depend on the local model and are unavailable in deterministic-only mode.
- The local model must return exact source substrings and valid tag names for proposals to be used.
- OCR quality limits downstream detection quality.
- No post-mask leak detection is performed.
- The UI loads its JavaScript dependencies from CDNs rather than a bundled build.

## Troubleshooting

**Ollama is unavailable**

Run `ollama serve`, confirm the model with `ollama list`, and ensure `CREW_MODEL` matches an
installed model.

**The reasoning panel has no model output**

The app probably used deterministic fallback. Check the backend console for a CrewAI fallback
message and confirm Ollama supports the selected model.

**A scanned PDF or image cannot be converted**

Start the OCR server or install `requirements-ocr.txt`. Digital PDFs do not require OCR.

**A custom tag is not detected**

Confirm Ollama is active, make the guidance concrete, and run a new scan. Existing scan results
are not retroactively updated.

**The interface remains on “compiling”**

The browser could not load React, Tailwind, or Babel from their CDNs.

## Copyright

Copyright (c) 2026 **muffin_team**. All rights reserved.
