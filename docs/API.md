# BotDesk API v1

Base URL: `https://<project-ref>.supabase.co/functions/v1/api/v1` (shown in **Settings → API keys**).

All requests and responses are JSON unless noted. Errors look like:

```json
{ "error": { "code": "bad_request", "message": "\"message\" is required (up to 4,000 characters)." } }
```

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Missing or invalid field |
| 401 | `unauthorized`, `session_expired` | Bad key, or the widget session expired (start a new one) |
| 403 | `forbidden` | Wrong key type, missing scope, or a website that isn't allowed |
| 404 | `not_found` | Not found in this key's workspace |
| 409 | `duplicate` | `client_message_id` was already received |
| 413 | `too_large` | Upload over 50 MB |
| 402 | `quota_exceeded` | The plan's messages for this month are used up |
| 429 | `rate_limited` | Too many requests per minute |
| 503 | `unavailable` | The bot is paused or not live |

## Keys

Create keys in **Settings → API keys**.

| | Publishable `bd_pk_…` | Secret `bd_sk_…` |
| --- | --- | --- |
| Where | Web pages, the widget | Your servers only |
| Bot | Exactly one | Any (send `bot_id`) or one |
| Can | Chat, hand-off, feedback, read its own conversation | Scopes: `chat`, `ingest`, `conversations`, `analyze` |
| Checks | Allowed domains (Origin header), signed widget session | Rejected if sent with an `Origin` header |

Send the key as `Authorization: Bearer <key>` (or `x-api-key`). Keys are stored hashed; a secret key is shown once.

Rate limits: each person may send `rate_limit_per_min` messages per minute to a bot (set per bot, default 12); each secret key may make 600 requests per minute.

---

## Chat

### `POST /widget/session` (publishable key)

Starts or resumes a visitor's session. The widget calls this for you.

```json
{ "visitor_id": "a-random-id-kept-in-localStorage", "page_url": "https://example.com/pricing", "language": "en" }
```

Returns `session` (send it as `x-session` on later calls), the bot's display settings, and the visitor's open conversation, if any, with its last 30 messages.

### `POST /chat`

Ask a question. With a publishable key send `x-session`; with a secret key send `user`.

```json
{
  "message": "Can my employer dismiss me without notice?",
  "user": { "id": "your-user-id", "name": "Ada", "email": "ada@example.com", "phone": "+265…", "metadata": {} },
  "bot_id": "uuid",                 // secret keys that aren't tied to one bot
  "conversation_id": "uuid",        // optional: continue a specific conversation
  "conversation_ref": "thread-42",  // optional: your own thread id; each ref is one conversation
  "new_conversation": false,        // optional: start fresh
  "jurisdiction": "MW",             // legal pack: filter sources to this jurisdiction (plus untagged ones)
  "format": "legal",                // legal pack: "legal" (structured) or "text"
  "client_message_id": "…",         // optional: idempotency; a repeat returns 409
  "stream": false
}
```

Response:

```json
{
  "conversation_id": "uuid",
  "message_id": "uuid",
  "handoff": false,
  "answer": {
    "text": "No. Your employer must give written notice [1] …",
    "outcome": "answered",                 // or "no_answer"
    "citations": [
      { "n": 1, "source_id": "uuid", "chunk_id": "uuid", "title": "Employment Act", "citation": "Employment Act (Cap. 55:01)",
        "section": "s. 29", "url": null, "snippet": "A contract of employment shall not be terminated…", "score": 0.71 }
    ],
    "confidence": 0.78,
    "offer_handoff": false,                // true when the bot couldn't answer and a person can help
    "disclaimer": "General legal information, not legal advice…",   // legal pack only
    "jurisdiction": "MW",
    "legal": {                             // when format is "legal"
      "summary": "…", "points": ["…"], "sources": [{ "n": 1, "title": "…", "detail": "s. 29", "url": null }],
      "follow_ups": ["…"], "see_a_lawyer": false, "disclaimer": "…"
    }
  }
}
```

If a person has taken over the conversation, `handoff` is `true` and `answer` is `null`; poll the messages endpoint for their reply.

**Streaming:** with `"stream": true` the response is `text/event-stream` with events `start` (`{conversation_id, user_message_id}`), `delta` (`{text}`, repeated) and `done` (`{conversation_id, message_id, answer}`, the same `answer` object as above).

### `POST /handoff`

Ask for a person. Optional contact details are saved on the contact.

```json
{ "conversation_id": "uuid", "name": "Ada", "email": "ada@example.com", "phone": "+265…", "note": "About my contract" }
```

Returns `{ "ok": true, "message": "Thanks! Someone from our team will reply here…" }`. The team is emailed and the conversation appears under **Inbox → Needs a person**.

### `GET /conversations/{id}/messages?after=<ISO time>`

Messages in a conversation (user, assistant and agent), oldest first, up to 100. Widget callers pass `?session=…` or `x-session`; secret keys need the `conversations` scope.

### `POST /feedback`

```json
{ "message_id": "uuid", "rating": -1, "comment": "Didn't answer my question" }
```

A thumbs-down puts the answer in the review queue.

### `POST /search` (secret key, `chat`)

Retrieval only, no answer: `{ "query": "…", "bot_id": "uuid", "top_k": 8, "min_score": 0.3, "jurisdiction": "MW" }` → `{ "results": [ { "chunk_id", "source_id", "title", "section", "heading", "content", "citation", "url", "jurisdiction", "vector_score", "text_score", "score" } ] }`.

---

## Knowledge (secret key, `ingest`)

### `GET /knowledge-bases`

`{ "knowledge_bases": [ { "id", "name", "description", "embedding_model", "legal", "created_at" } ] }`

### `POST /sources`

Add text, Q&A or a web page. Indexing starts immediately; poll `GET /sources/{id}` until `status` is `ready`.

```json
{ "knowledge_base_id": "uuid", "kind": "text", "title": "Employment Act", "content": "PART III …",
  "external_id": "cms-123",                         // optional: upsert key from your system
  "jurisdiction": "MW", "source_type": "statute", "citation": "Employment Act (Cap. 55:01)",
  "effective_date": "2000-05-01", "superseded": false, "metadata": {} }
```

- `kind: "qa"` with `question` and `answer`.
- `kind: "url"` with `url`, optional `refresh_hours`.
- `kind: "sitemap"` with `url` (a sitemap.xml, or a page whose links to follow) and optional `max_pages` (up to 500).
- `source_type`: `statute`, `regulation`, `case_law`, `constitution`, `guidance`, `practice_note`, `form`, `faq`, `verified_answer`, `other`.

With `external_id`, a second call for the same id updates and re-indexes that source (`"updated": true`) instead of adding a new one, so a content system can sync documents.

### `POST /sources/upload`

`multipart/form-data` with `file` (PDF, DOCX, TXT, MD, CSV, HTML, JSON; up to 50 MB) and the same fields as above as form fields (`knowledge_base_id` required; `metadata` as a JSON string).

### `GET /sources/{id}` · `DELETE /sources/{id}`

`status` is `queued`, `processing`, `ready`, `failed` (see `error`) or `disabled`; `progress` shows pages read or passages embedded for large files.

---

## Legal pack (secret key, `analyze`)

Available when the workspace has the legal pack on. Used by LegAI's **Listen In**.

### `POST /legal/analyze`

Analyse the newest few seconds of a transcribed conversation.

```json
{
  "bot_id": "uuid",
  "segment": { "id": "seg-12", "text": "Officer: Give me your phone.", "start_ms": 84000, "speaker": "other" },
  "context": { "topic": "arrest", "jurisdiction": "MW", "already_flagged": ["right_to_silence"], "previous": [ { "id": "seg-11", "text": "…" } ] }
}
```

```json
{ "flags": [
    { "key": "phone_search", "kind": "rights", "title": "You can ask why they need your phone.",
      "body": "…", "quote": "Give me your phone.", "citation": "Constitution s. 21", "source_id": "uuid",
      "segment_id": "seg-12", "at_ms": 84000 }
  ], "model": "<model id>" }
```

`kind` is `rights`, `caution` or `next_step`. Most segments return no flags. Pass the keys you've already shown in `already_flagged` so they aren't repeated.

### `POST /legal/summarize`

`{ "bot_id": "uuid", "segments": [ … ], "flags": [ { "title": "…" } ], "topic": "arrest" }` → `{ "summary": "Two plain sentences: what happened and what matters legally." }`.

---

## Privacy

### `DELETE /contacts/{external_id}?channel=api` (secret key, `conversations`)

Deletes a person and all their conversations and messages. `channel` is `api` (default), `web`, `whatsapp` or `sms` (for WhatsApp/SMS the external id is the phone number). Returns `{ "deleted": 1 }`.

Workspaces can also set a retention period (Settings → General) after which conversations are deleted automatically.

## Health

`GET /health` → `{ "ok": true, "service": "botdesk-api", "version": 2 }`

---

## Channel webhooks

These are configured in the dashboard (bot → Channels), which shows the exact URLs.

| Provider | URL | Auth |
| --- | --- | --- |
| WhatsApp Cloud API | `…/functions/v1/channels/whatsapp/<token>` (GET verify, POST messages) | Verify token + `X-Hub-Signature-256` with the app secret |
| Twilio SMS | `…/functions/v1/channels/twilio/<token>` | `X-Twilio-Signature` with the auth token |
| Africa's Talking SMS | `…/functions/v1/channels/africastalking/<token>` | Unguessable token |

People can reply **HUMAN** to ask for a person. Agent replies from the inbox are sent back through the same channel.
