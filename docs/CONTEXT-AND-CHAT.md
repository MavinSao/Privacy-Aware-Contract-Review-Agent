# Context, memory and chat

Answers the question that started this: *"I switched tabs and my chat was gone."*

---

## 1. The bug, and the fix

`ChatTab` held the conversation in its own `useState`. Switching to Upload & Mask unmounted the
component, React discarded the state, and coming back mounted a fresh empty one. Nothing was lost
on the server — there was never anything on the server.

**Fixed** by lifting the conversation into `<App>`, which stays mounted for the whole page life:

```jsx
// frontend/app.jsx — inside <App>
const [chat, setChat] = useState({
  sessions: [{ id: "c1", title: "New chat", docUids: [], messages: [] }],
  activeId: "c1",
  provider: "ollama",
  model: PROVIDERS[0].defaultModel,
  apiKey: "",
  input: "",
});
```

`ChatTab` now receives `chat` / `setChat` and patches into them. Two useful side effects:

- A reply that arrives **after** you have switched tabs still lands in the right session, because
  the `setChat` closure outlives the component.
- The chosen model no longer resets on every remount. The old effect reset `model` whenever
  `provider` or `ollamaModels` changed, which fired on mount. It now only fills in a default when
  the current model is not actually installed, and provider changes are handled in the select's
  own `onChange`.

Verified: send a message → Upload & Mask → Home → Demo → Chat. The conversation is still there.

### Still lost on a full page reload — on purpose

See §4. This is a privacy decision, not an oversight.

---

## 2. Three separate memories

People say "memory" for three different things here. They have different lifetimes and different
risk profiles, and conflating them is how data leaks.

| # | Memory | Lives in | Contains | Cleared by |
| --- | --- | --- | --- | --- |
| 1 | **Conversation memory** | browser, `<App>` state | questions, masked answers, remapped answers | page reload |
| 2 | **Document memory** | server, `privacy.STORE` | raw Markdown, masked Markdown, mappings, audit log | server restart |
| 3 | **Model memory** | nowhere — rebuilt per request | the `messages` array sent to the provider | every request |

The model has **no** memory of its own. Every turn ships a freshly assembled `messages` array.
That is what makes the masking guarantee hold: there is no hidden state at the provider that could
have accumulated a real value.

---

## 3. What one chat turn actually does

```
browser                          server                            provider
───────                          ──────                            ────────
question + doc_uids + history ──► look up masked_markdown
                                  build outgoing payload
                                  privacy.verify(payload, entities)
                                        │
                                        ├─ leak found + external provider
                                        │      → HTTP 500, nothing sent ✋
                                        │
                                        └─ clean
                                             llm.chat(...) ──────────► masked
                                                                        answer
                                  privacy.remap(answer) ◄─────────────────┘
                                  audit.log(provider, leaks, restored)
◄── masked_answer + answer + leak_scan + restored
```

The response carries both versions. The lock badge in the UI is a pure display toggle — no second
request, no second chance to leak.

### The history invariant

```js
const history = session.messages.flatMap((m) => m.role === "user"
  ? [{ role: "user", content: m.text }]
  : [{ role: "assistant", content: m.masked_answer }]);   // ← masked, always
```

Replaying the **remapped** answer would ship every real value to the provider on the second
question of any conversation. This single line is the difference between a working privacy layer
and a decorative one.

`llm.chat()` backs it up with a signature-level guard — it takes a required
`payload_is_masked` argument and raises before opening a socket if an external provider is paired
with an uncleared payload.

---

## 4. Why the conversation is not persisted

`sessionStorage` would survive a reload and is the obvious fix. It is not used, because a chat
message object contains `answer` — the **remapped, real-value** version. Persisting it writes real
account numbers and contract values into browser storage, where they outlive the process, are
readable by any script on the origin, and sit outside the audit log.

That is precisely the exposure the project exists to prevent. The rule is: **real values live in
exactly one place — server memory — and are never written anywhere else.**

If persistence across reloads becomes necessary, the shape that keeps the guarantee is:

1. persist only `masked_answer` and metadata,
2. re-derive the real values on demand through `POST /api/remap`,
3. drop the whole thing if `/api/documents` no longer knows the referenced `uid`.

That is roadmap, not shipped.

---

## 5. Multi-document chat

Selecting several documents concatenates their masked Markdown under `# filename` headings and
unions their entity lists for the leak scan and the remap.

Mappings are seeded per document UID, so the same company in two files gets **two different**
aliases. For per-document review that is correct and safer. If cross-document entity resolution is
ever needed — "is this the same counterparty in both contracts?" — it requires a shared alias pool
keyed by normalized value across a session, which changes the threat model and is not implemented.

---

## 6. When this needs to scale

Current shape: every turn re-sends every selected document in full, plus the entire history. For a
3–10 KB contract and a handful of turns this is well inside any context window and costs less than
the retrieval machinery would.

It breaks down at roughly **30 KB of Markdown or ~20 turns**. In order of what to do first:

1. **Cap history.** Keep the last N turns verbatim; that alone buys a lot.
2. **Summarize older turns** with the *local* model, over masked text only, and replace them with
   one assistant message. Never summarize with an external model — it doubles the exposure surface
   for no benefit.
3. **Send documents once.** Providers with prompt caching make the leading document block nearly
   free on repeat turns; ordering already puts documents first, which is what caching needs.
4. **Chunk and retrieve — last.** Split masked Markdown by clause heading (`제N조`, `Article N`) and
   retrieve per question. Do this only when documents genuinely exceed the window, because it will
   miss the clause nobody asked about, which is usually the dangerous one.

A token budget check before the send, surfacing "this conversation is getting long" in the UI, is
the cheapest first step and is not implemented yet.

---

## 7. Other state that resets on tab switch

- **`focusUid` in `UploadTab`** — which document's reasoning panel is open. Deliberately left
  local; the document list itself is server-backed, so nothing is lost, and re-opening the panel
  replays the reveal animation, which is good for a demo.
- **`pickerOpen`, `sending`** — transient UI, correctly local.

---

## 8. Quick reference

| Question | Answer |
| --- | --- |
| Does the chat survive tab switches? | Yes, since the state was lifted to `<App>`. |
| Does it survive a page reload? | No — deliberately, see §4. |
| Does it survive a server restart? | No. Documents and mappings are in-process memory. |
| Is there RAG? | No. Whole masked document in the prompt. See ARCHITECTURE.md §8. |
| Does the model remember previous turns? | No. History is replayed explicitly every request. |
| What does the provider ever see? | Masked Markdown, masked history, the question. Never a real value. |
| Where are API keys stored? | One React state field. Not on disk, not logged. |
