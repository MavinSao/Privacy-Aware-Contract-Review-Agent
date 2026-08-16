# Privacy-Aware Contract Review Agent

> Review sensitive documents with AI without sending the original private data to an external model.

Built by **muffin_team**.

## Motivation

Contracts and business documents often contain names, company details, account numbers, contact
information, internal project names, and credentials. Sending those documents directly to a hosted
AI service can expose information that should remain private.

This project adds a privacy layer before AI review. It converts a document to Markdown, detects
sensitive values locally, decides how each value should be handled, and creates a pseudonymized
copy. Only that processed copy is used for chat. When the model responds, known pseudonyms can be
mapped back to their original values locally.

The goal is simple: keep the usefulness of AI-assisted contract review while reducing unnecessary
data exposure.

## What it does

```text
Document
   |
   v
OCR / conversion
   |
   v
Detect -> Classify -> Pseudonymize
                            |
                            v
                     Masked Markdown
                            |
                            v
                  Ollama / OpenAI / Mistral
                            |
                            v
                    Local reconstruction
```

The privacy workflow has three main steps:

1. **Detect** — find sensitive values with deterministic patterns and a local Gemma model.
2. **Classify** — assign `PSEUDONYMIZED`, `KEEP`, or `REMOVED` to every accepted value.
3. **Pseudonymize** — replace or redact values before the document can be sent to a chat model.

## Main features

- Converts PDF, images, DOCX, HWP, spreadsheets, HTML, Markdown, text, and CSV into Markdown.
- Runs sample OCR in the background and immediately shows progress in the document table.
- Uses deterministic detection together with contextual detection from local Ollama/Gemma.
- Validates model findings against the original document and the authorized NER taxonomy.
- Supports custom NER tags for project-specific privacy and security categories.
- Shows the detector prompt, loading state, validated output, and agent explanation progressively.
- Provides chat through local Ollama, OpenAI, or Mistral using only masked documents.
- Renders model answers as Markdown and can reconstruct pseudonymized values locally.
- Downloads masked Markdown and audit reports.
- Keeps documents, mappings, and custom tags in memory instead of writing them to disk.
- Includes English and Korean UI modes, light and dark themes, and responsive mobile layouts.
- Provides scripts for temporary public demos through Cloudflare Tunnel.

## Privacy model

Built-in detection covers:

- resident registration numbers;
- payment-card numbers;
- bank accounts and IBANs;
- business registration numbers;
- phone numbers and email addresses;
- people, organizations, banks, and postal addresses;
- internal project codenames.

`MONEY`, `MONEY_TEXT`, and `DATE` are intentionally excluded. Amounts and dates stay unchanged.

The detector accepts a local-model finding only when:

- its value is an exact substring of the source document; and
- its type exists in the current built-in or custom NER taxonomy.

This prevents invented values and unauthorized entity types from entering the mapping store.

| Status | Internal action | Result |
| --- | --- | --- |
| `PSEUDONYMIZED` | `PSEUDONYMIZE` | Replace the value with a consistent stand-in. |
| `KEEP` | `ALLOW` | Preserve the original value. |
| `REMOVED` | `MASK` | Replace the value with `[REDACTED-TYPE]`. |

The project does not run a post-mask leak scanner. Detection quality therefore defines the
privacy boundary: anything missed by both detection methods remains unchanged. Review the output
before sending highly sensitive documents to an external provider.

## Custom NER tags

Use **Demo -> NER Tags** to teach the detector additional security or privacy categories.

| Field | Meaning | Example |
| --- | --- | --- |
| Root tag | Uppercase category returned by the model | `SECRET_KEY` |
| Detection guidance | Values, patterns, or keywords that belong to the category | `API keys, access tokens, credentials` |
| Handling | How matching values should be processed | `REMOVED` |

Custom tags are injected into the local detector prompt for new scans. They are stored in memory
and disappear when the backend restarts. Because no regex is generated automatically, custom tags
require the local semantic detector.

## Requirements

- Python 3.10+
- Ollama for contextual detection and local chat
- An optional OCR server or PaddleOCR for scanned PDFs and images
- Internet access when loading the UI dependencies from their CDNs

## Installation

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Install Ollama and download the default local model:

```powershell
winget install Ollama.Ollama
ollama pull gemma4:12b
```

To use another installed model, update `CREW_MODEL` in `.env`.

## Run locally

From the project root:

```powershell
Set-Location backend
uvicorn main:app --reload --port 8000
```

Open <http://127.0.0.1:8000>.

### OCR options

For the lightweight standalone OCR server:

```powershell
pip install -r requirements-ocr-server.txt
python backend\ocr_server.py --port 10000
```

Then add this to `.env`:

```dotenv
OCR_SERVER_URL=http://127.0.0.1:10000
```

Alternatively, install in-process PaddleOCR:

```powershell
pip install -r requirements-ocr.txt
```

Digital PDFs and text-based formats work without OCR. Scanned PDFs and images require one of the
OCR options. Remote OCR endpoints are rejected by default because OCR receives the raw document
before masking; set `OCR_ALLOW_REMOTE=true` only when that exposure is intentional.

## Demo workflow

1. Optionally add a category under **Demo -> NER Tags**.
2. Open **Upload & Mask** and upload a document or select a bundled sample.
3. Follow the table status through `OCR processing`, `detecting`, `masking`, and `Done`.
4. Review the detected values, handling decisions, reasoning output, and masked Markdown.
5. Open **Chat**, select the processed document, and choose Ollama, OpenAI, or Mistral.
6. Toggle the response between pseudonymized and locally reconstructed values.
7. Use **Reconstruct** to restore known placeholders in pasted model output.

## Temporary demo with Cloudflare Tunnel

Install `cloudflared`:

```powershell
winget install --id Cloudflare.cloudflared
```

Start the FastAPI application, then run this from the project root in another terminal:

```powershell
.\scripts\tunnel.ps1

# Different application port
.\scripts\tunnel.ps1 -Port 8080
```

On macOS or Linux:

```bash
chmod +x ./scripts/tunnel.sh
./scripts/tunnel.sh

# Different application port
./scripts/tunnel.sh 8080
```

The script prints a temporary `https://*.trycloudflare.com` URL. No Cloudflare account is needed.
The URL changes each time and remains active only while the tunnel runs.

This is for demonstrations, not production. The tunnel does not add application authentication,
so anyone with the URL can access the running app and its in-memory session data.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama endpoint |
| `CREW_MODEL` | `gemma4:12b` | Local detector model |
| `CREW_ENABLED` | `true` | Use the CrewAI workflow; disable for deterministic fallback |
| `OPENAI_API_KEY` | unset | Optional OpenAI key |
| `MISTRAL_API_KEY` | unset | Optional Mistral key |
| `OCR_SERVER_URL` | unset | OpenAI-compatible OCR endpoint |
| `OCR_MODEL` | `Unlimited-OCR` | OCR endpoint model name |
| `OCR_PROMPT` | `document parsing.` | OCR instruction |
| `OCR_DPI` | `300` | PDF rasterization resolution |
| `OCR_TIMEOUT` | `120` | OCR timeout per page |
| `OCR_ALLOW_REMOTE` | `false` | Allow a non-loopback OCR endpoint |

## API

Interactive documentation is available at `/docs` while the application is running.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Show available engines and local models |
| `GET` | `/api/samples` | List bundled sample documents |
| `POST` | `/api/documents` | Upload and convert documents |
| `POST` | `/api/documents/sample` | Add a sample and start background conversion |
| `GET` | `/api/documents` | List session documents |
| `POST` | `/api/documents/{uid}/scan` | Run detection and classification again |
| `POST` | `/api/documents/{uid}/mask` | Run pseudonymization |
| `GET` | `/api/documents/{uid}/download` | Download raw, masked, or audit Markdown |
| `DELETE` | `/api/documents/{uid}` | Remove a session document |
| `GET` | `/api/ner-tags` | List custom NER tags |
| `POST` | `/api/ner-tags` | Create or replace a custom NER tag |
| `DELETE` | `/api/ner-tags/{name}` | Delete a custom NER tag |
| `POST` | `/api/chat` | Chat about processed documents |
| `POST` | `/api/remap` | Restore known placeholders in text |

## Project structure

```text
backend/
  convert.py       Document-to-Markdown conversion
  crew.py          Detection, classification, pseudonymization, and progress events
  llm.py           Ollama, OpenAI, and Mistral routing
  main.py          FastAPI routes, background jobs, and frontend serving
  ocr_server.py    Optional standalone OCR service
  privacy.py       NER taxonomy, validation, masking, remapping, and in-memory store
frontend/
  index.html       Browser entry point and shared responsive styles
  app.jsx          React interface
docs/
  ARCHITECTURE.md
  CONTEXT-AND-CHAT.md
samples/            Bundled demonstration documents
scripts/            Cloudflare Tunnel launchers
```

## Contributing

Contributions are welcome, especially in these areas:

- detection rules and entity validation;
- Korean and English prompt quality;
- OCR accuracy and additional document formats;
- privacy and security review;
- accessibility, responsive UI, and translation quality;
- tests and documentation.

To contribute:

1. Fork the repository and create a focused branch.
2. Install the project and verify the existing workflow locally.
3. Make one clear change and avoid committing real contracts, credentials, or personal data.
4. Test both deterministic fallback and local-model behavior when your change affects detection.
5. Open a pull request explaining the problem, the change, and how you verified it.

For security-sensitive findings, do not include private documents or usable secrets in a public
issue. Use sanitized examples that reproduce the problem.

## Known limitations

- Documents, mappings, audit data, and custom tags disappear when the backend restarts.
- Detection and OCR quality determine what is protected.
- Custom tags depend on the local semantic model.
- The deterministic fallback cannot detect newly invented custom categories.
- There is no post-mask leak detection.
- Browser dependencies are loaded from CDNs instead of a bundled frontend build.
- The application has no authentication and is not production-ready.

## Troubleshooting

**Ollama is unavailable**

Run `ollama serve`, check installed models with `ollama list`, and confirm that `CREW_MODEL`
matches one of them.

**The reasoning panel has no model output**

The application probably used deterministic fallback. Check the backend console and verify that
Ollama and the configured model are available.

**A scanned PDF or image cannot be converted**

Start the standalone OCR server or install `requirements-ocr.txt`. Digital PDFs do not need OCR.

**A custom tag is not detected**

Confirm that Ollama is active, make the detection guidance concrete, and start a new scan. Custom
tags do not update previous scan results.

## Copyright

Copyright (c) 2026 **muffin_team**. All rights reserved.
