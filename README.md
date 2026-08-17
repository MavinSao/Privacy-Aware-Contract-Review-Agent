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
Detect -> Classify -> Pseudonymize -> Verify
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

The privacy workflow has four main steps:

1. **Detect** — find sensitive values with deterministic patterns and a local Gemma model.
2. **Classify** — assign `PSEUDONYMIZED`, `KEEP`, or `REMOVED` to every accepted value.
3. **Pseudonymize** — replace or redact values before the document can be sent to a chat model.
4. **Verify** — report detected original values that remain without blocking completion.

## Main features

- Converts PDF, images, DOCX, HWP, spreadsheets, HTML, Markdown, text, and CSV into Markdown.
- Runs sample OCR in the background and immediately shows progress in the document table.
- Uses deterministic detection together with contextual detection from local Ollama/Gemma.
- Validates model findings against the original document and the authorized NER taxonomy.
- Supports custom NER tags for project-specific privacy and security categories.
- Shows the detector prompt, loading state, validated output, and agent explanation progressively.
- Runs a non-blocking post-mask verification and shows unchanged-tag reminders in Chat.
- Provides chat through local Ollama, OpenAI, or Mistral using only masked documents.
- Renders model answers as Markdown and can reconstruct pseudonymized values locally.
- Downloads masked Markdown and audit reports.
- Keeps documents, mappings, custom tags, and chat history in backend memory instead of writing them to disk.
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

`MONEY` and `DATE` are included as editable default tags with `KEEP` handling, so calculations and
timeline analysis remain accurate. Users can switch either tag to `PSEUDONYMIZED` when privacy is
more important than preserving exact values. Written-out monetary amounts (`MONEY_TEXT`) remain
outside deterministic detection.

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
before sending highly sensitive documents to an external provider. Chat supports local Ollama,
OpenAI, Anthropic Claude, and Mistral; provider API keys stay in the browser tab unless configured
through local environment variables.

## Custom NER tags

Use **Demo -> NER Tags** to review the complete detection policy. The table includes both default
and custom categories. Select a row to update its detection guidance or handling; select it again
to cancel editing. Default tags can be reset but not deleted, while custom tags can be deleted.

| Field | Meaning | Example |
| --- | --- | --- |
| Root tag | Uppercase category returned by the model | `SECRET_KEY` |
| Detection guidance | Values, patterns, or keywords that belong to the category | `API keys, access tokens, credentials` |
| Handling | How matching values should be processed | `REMOVED` |

All tag descriptions are injected into the local detector prompt for new scans. Policy changes are
stored in memory and disappear when the backend restarts. Editing a default tag does not change its
deterministic pattern. Because no regex is generated automatically, new custom tags require the
local semantic detector.

When `MONEY` or `DATE` is changed to `PSEUDONYMIZED`, it receives a realistic format-aware fake
instead of a generic placeholder. Exact fake values can be restored, but calculations derived from
fake amounts cannot be remapped reliably.

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for Windows or macOS
- Internet access when loading the UI dependencies from their CDNs

## Installation

Docker handles Python, dependencies, Ollama, Gemma, OCR, and all internal service connections.

1. Clone this repository or download and extract its ZIP file:

```bash
git clone https://github.com/MavinSao/Privacy-Aware-Contract-Review-Agent.git
cd Privacy-Aware-Contract-Review-Agent
```

2. Install and start Docker Desktop with the script for your system.

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-docker.ps1
```

macOS:

```bash
chmod +x ./scripts/install-docker.sh
./scripts/install-docker.sh
```

The Windows script uses `winget`; the macOS script uses Homebrew. If that package manager is not
available, the script prints the official manual download link instead of running an unknown
installer. After installation, wait until Docker Desktop reports that Docker is running.

3. Start MuffinGuard. The startup script tests Docker GPU access and falls back to CPU when a
compatible GPU is unavailable.

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

macOS:

```bash
chmod +x ./scripts/start.sh
./scripts/start.sh
```

The startup script prefers `gemma4:12b` when Docker has at least 14 GiB of memory and automatically
uses `gemma4:e4b` on smaller Docker environments to prevent the model process from being killed.
The first start downloads the selected model, so it can take several minutes. Wait
until the `app` service reports that Uvicorn is running, then open <http://127.0.0.1:8000>. Docker
starts OCR automatically; no separate frontend, Python, Ollama, or OCR installation is needed.

Docker GPU acceleration is used automatically on supported NVIDIA systems. Docker Desktop for
macOS does not pass the Apple GPU through to the Ollama container, so Macs use CPU. The 12B model
needs substantial memory; allocating at least 14 GiB to Docker Desktop enables it. To force a model,
set `CREW_MODEL=gemma4:12b` or `CREW_MODEL=gemma4:e4b` before running the startup script.

Useful Docker commands:

```bash
# Check service health and model-download progress
docker compose ps
docker compose logs -f model-init app

# Stop the stack without deleting the downloaded model
docker compose down
```

The model remains in the `ollama-data` Docker volume, so later starts do not download it again. Only
MuffinGuard port `8000` is exposed; Ollama and OCR remain private inside Docker. Open
<http://127.0.0.1:8000/api/health> to check all service connections.

## Demo workflow

1. Optionally add a category under **Demo -> NER Tags**.
2. Open **Upload & Mask** and upload a document or select a bundled sample.
3. Follow the table status through `OCR processing`, `detecting`, `masking`, and `Done`.
4. Review the detected values, handling decisions, reasoning output, and masked Markdown.
5. Use **Redo** after changing tag policy or reviewing verification warnings to rerun all four
   stages from the stored original document.
6. Open **Chat**, select the processed document, and choose Ollama, OpenAI, Claude, or Mistral.
7. Toggle the response between pseudonymized and locally reconstructed values.
8. Use **Reconstruct** to restore known placeholders in pasted model output.

## Temporary demo with Cloudflare Tunnel

Install `cloudflared`:

```powershell
winget install --id Cloudflare.cloudflared
```

On macOS:

```bash
brew install cloudflared
```

Keep the Docker stack running, then run this from the project root in another terminal:

```powershell
.\scripts\tunnel.ps1
```

On macOS or Linux:

```bash
chmod +x ./scripts/tunnel.sh
./scripts/tunnel.sh
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
| `ANTHROPIC_API_KEY` | unset | Optional Anthropic Claude key |
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
| `GET` | `/api/ner-tags` | List default and custom NER tags |
| `POST` | `/api/ner-tags` | Create a custom NER tag |
| `PUT` | `/api/ner-tags/{name}` | Update tag guidance or handling |
| `POST` | `/api/ner-tags/{name}/reset` | Reset a default tag |
| `DELETE` | `/api/ner-tags/{name}` | Delete a custom NER tag |
| `POST` | `/api/chat` | Chat about processed documents |
| `GET` | `/api/chat-state` | Load in-memory chat sessions after a browser refresh |
| `PUT` | `/api/chat-state` | Save non-secret chat state in backend memory |
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

- Documents, mappings, audit data, custom tags, and chat history disappear when the backend restarts.
- Detection and OCR quality determine what is protected.
- Custom tags depend on the local semantic model.
- The deterministic fallback cannot detect newly invented custom categories.
- Post-mask verification warns about unchanged values but does not block chat.
- Browser dependencies are loaded from CDNs instead of a bundled frontend build.
- The application has no authentication and is not production-ready.

## Troubleshooting

**Ollama is unavailable**

Run `docker compose ps` and `docker compose logs model-init ollama`. The first model download can
take several minutes. Restart the stack through the system startup script after it completes.

**Ollama returns `500` and `llama-server process has terminated: signal: killed`**

Docker ran out of memory while loading the model. Start through `scripts/start.ps1` or
`scripts/start.sh` so MuffinGuard selects a model that fits. Alternatively, increase Docker Desktop's
memory to at least 14 GiB or force the smaller model with `CREW_MODEL=gemma4:e4b`.

**The reasoning panel has no model output**

The application probably used deterministic fallback. Check `docker compose logs app model-init`
and confirm that the model download completed.

**A scanned PDF or image cannot be converted**

Check `docker compose ps ocr` and `docker compose logs ocr`, then restart it with
`docker compose restart ocr`. Digital PDFs do not need OCR.

**A custom tag is not detected**

Confirm that `ollama`, `model-init`, and `app` are healthy in `docker compose ps`, make the detection
guidance concrete, and start a new scan. Custom tags do not update previous scan results.

## Copyright

Copyright (c) 2026 **muffin_team**. All rights reserved.
