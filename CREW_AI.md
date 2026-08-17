# MuffinGuard CrewAI Architecture and Chat Memory

This document explains how MuffinGuard uses CrewAI to process documents, how the processing stages are chained, and how chat history is preserved between messages.

## Architecture at a Glance

MuffinGuard separates AI reasoning from security-critical data handling:

```text
Original document
        |
        v
1. Detect sensitive values       CrewAI Detector + local Gemma + Python rules
        |
        v
2. Classify each value           CrewAI Risk Analyst + deterministic taxonomy
        |
        v
3. Pseudonymize the document     CrewAI Pseudonymizer + local replacement logic
        |
        v
4. Verify every replacement      Deterministic Python check, non-blocking
        |
        v
Masked document -> external chat model -> local value restoration
```

CrewAI coordinates the agents and produces readable progress information. Python remains the source of truth for detected entities, classifications, replacements, mappings, and verification results. This prevents an agent's free-form response from directly changing protected data.

## Why the Chain Uses Two Crews

Document processing is divided into two phases so the interface can show useful progress before the complete result is ready.

### Scan phase: Detect -> Classify

The scan crew runs automatically after the original document has been converted to Markdown. It is read-only: it finds sensitive values and assigns their handling status without modifying the document.

### Protection phase: Pseudonymize -> Verify

After scanning, the mask crew applies the approved transformations. A deterministic verification stage then checks whether values that should have changed still appear in the result. Verification reports warnings but does not block the document.

The UI can therefore show statuses such as OCR processing, detecting, pseudonymizing, verifying, and done while work continues in the background. Redo starts the complete chain again from the original Markdown, not from an already masked copy.

## Agents and Stages

| Stage | Component | Responsibility |
| --- | --- | --- |
| Detect | CrewAI Detector | Combines deterministic pattern matches with local Gemma entity proposals. |
| Classify | CrewAI Risk Analyst | Assigns `PSEUDONYMIZED`, `KEEP`, or `REMOVED` using the supported taxonomy. |
| Pseudonymize | CrewAI Pseudonymizer | Calls the local masking pipeline to create consistent replacement values. |
| Verify | Python verifier | Checks that protected originals no longer remain and creates non-blocking warnings. |

### 1. Detect

The detector receives the original Markdown. Default and user-defined NER tags are injected into its system prompt, allowing project-specific categories such as `SECRET_KEY` or a custom `MONEY` tag.

Detection combines two sources:

- Deterministic rules identify supported formats reliably.
- Local Gemma proposes context-dependent entities that rules may miss.

Every model proposal is validated before acceptance. Its value must appear exactly in the original document and its type must exist in the current taxonomy. Rule-based matches take priority when results overlap.

### 2. Classify

The analyst applies one of three actions:

- `PSEUDONYMIZED`: replace the value with a realistic, consistent fake value.
- `KEEP`: retain the original because it is intentionally allowed.
- `REMOVED`: remove the value rather than replacing it.

The agent explains the stage, but the authoritative classification is produced and validated by the Python privacy pipeline.

### 3. Pseudonymize

The pseudonymizer applies replacements locally. Each original value is connected to a generated value in the in-memory mapping store. Repeated occurrences use the same replacement, which keeps the document internally consistent and allows exact restoration later.

Format-aware custom tags can generate value-like replacements. For example, a custom `MONEY` entity should become another monetary value instead of the literal placeholder `[MONEY]`.

### 4. Verify

Verification is deliberately deterministic and is not another CrewAI agent. It compares the protected output with the entity list and reports:

- protected values that remained unchanged;
- `KEEP` values that intentionally remain; and
- values that may still be risky.

These warnings are shown with the document and beside selected chat documents. They are reminders rather than blockers.

## Prompt and Output Flow

The chain does not trust an LLM response as application state:

1. CrewAI builds the task prompt for the current stage.
2. Local Gemma returns a structured proposal or narration.
3. Python validates the proposal and runs the relevant privacy function.
4. The application rebuilds the final stage result from validated Python data.
5. CrewAI callbacks publish prompt and progress traces so the UI can update while the stage is running.

If CrewAI or the local Ollama model is unavailable, MuffinGuard falls back to the deterministic scan and masking pipelines. The document can still be processed, although semantic detection may be less comprehensive.

## Chat Architecture

Only selected, successfully processed documents are added to chat context.

```text
Selected document IDs
        |
        v
Load masked Markdown from local memory
        |
        +-- system instructions
        +-- complete masked document context
        +-- previous masked conversation turns
        +-- current user question
        |
        v
Configured chat model
        |
        v
Masked answer
        |
        v
Restore exact mapped values locally
        |
        v
Rendered Markdown answer with entity highlighting
```

The current implementation sends the full masked text of every selected document on each request. It does not use embeddings, a vector database, or retrieval-augmented generation.

## How Previous Chat Is Remembered

The model itself has no hidden long-term memory. MuffinGuard reconstructs its memory on every request:

1. The frontend stores each chat session, selected document IDs, and its messages.
2. When the user sends a new question, the frontend includes earlier turns as `history`.
3. For assistant turns, it sends `masked_answer`, not the locally restored answer.
4. The backend prepends the selected masked documents and then forwards the history and new question to the model.
5. The new response is appended to the session and saved again.

This explicit replay is what lets a follow-up such as "compare that with the previous clause" relate to earlier messages.

### Rolling Conversation Summary

To keep long conversations within the model's context limit, MuffinGuard will compress only older chat history. Selected masked documents remain complete and are still sent in full.

```text
Full selected masked documents
+ summary of older masked chat
+ latest 5 user/assistant pairs verbatim
+ current user question
```

After every five new user/assistant pairs, the older messages are merged into a rolling summary of approximately 800-1,200 tokens. The summary preserves decisions, reviewed clauses, findings, calculations, unresolved questions, and relevant masked entity references. The latest five pairs remain unchanged so the model retains recent wording and conversational detail.

Summarization must use the masked user and assistant content, never locally restored private values. If summarization fails, MuffinGuard keeps the existing summary and recent messages instead of losing conversation context. This reduces chat-history tokens without shortening or summarizing the source documents.

### Memory Lifetime

| Event | What is preserved? |
| --- | --- |
| Change between Upload, NER Tags, Architecture, and Chat | Chat remains because state is owned by the top-level app. |
| Browser refresh | Chat is restored from the backend chat-state endpoint. |
| New chat message | Earlier masked turns are replayed to the model. |
| Backend process restart | Chat sessions, documents, and mappings are lost. |
| API key entry | Kept only in the current browser state and excluded from saved chat state. |

Chat state is currently an in-memory backend store, not a database. It is process-global and has no user-account isolation. That is suitable for a local demonstration, but a shared deployment should add authenticated per-user storage before relying on it for confidential conversations.

## Privacy Boundaries in Chat

- Selected documents are sent as masked Markdown.
- Previous assistant messages are sent back to the model in masked form.
- Exact fake-to-real restoration occurs locally after the response returns.
- The UI may store both masked and restored answer forms in local server memory so it can switch views after refresh.
- The user's newly typed question is currently forwarded as entered. Users should not paste new unmasked secrets into the chat box; masking the question before provider submission is a future security improvement.
- Verification warnings are advisory. A user can still chat with a document that contains a warned value.

## Main Implementation Files

| File | Purpose |
| --- | --- |
| `backend/crew.py` | CrewAI agents, tasks, stage chaining, callbacks, and deterministic fallbacks. |
| `backend/privacy.py` | Taxonomy, detection rules, masking, mappings, verification, and restoration. |
| `backend/main.py` | Processing endpoints, chat context construction, chat-state memory, and response restoration. |
| `backend/llm.py` | Local and external model routing and masked-payload enforcement. |
| `frontend/app.jsx` | Progressive status UI, chat sessions, history replay, persistence, and Markdown rendering. |

## Current Design Summary

CrewAI supplies specialized roles and a visible sequential workflow. Local Gemma improves semantic detection. Deterministic Python code owns every security-sensitive decision and provides a fallback. Chat continuity comes from replaying stored masked messages and documents on every request, while real-value restoration stays local.
