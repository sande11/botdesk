# BotDesk

Multi-tenant AI assistants that answer from your own documents, on any channel: a website widget, your mobile app, WhatsApp and SMS. Every answer is grounded in indexed sources (retrieval-augmented generation) and cites them. When the bot doesn't know, it says so and can hand the conversation to a person.

BotDesk also runs **LegAI**: a workspace with the *legal pack* turned on becomes the backend for legal information, model access, lawyer review and fine-tuning data. See [docs/LEGAI.md](docs/LEGAI.md).

```
            Website widget ─┐                       ┌─ Anthropic (Claude)
       Mobile app / server ─┼─▶ api ─┐              ├─ OpenAI
 WhatsApp · Twilio · Africa's ─▶ channels ─▶ answer engine ─┼─ Together / any OpenAI-compatible endpoint
                Talking SMS │         │   (hybrid search,   └─ Voyage / OpenAI embeddings
                            │         │    citations, review)
         Dashboard (React) ─┴─▶ admin │
                                      ▼
                Postgres (RLS per workspace) · pgvector · Storage · Vault · pg_cron ─▶ worker
```

## What's in it

- **Multi-tenant workspaces.** Every row belongs to a workspace; Postgres row-level security decides what each member sees. Roles: owner, admin, editor, reviewer, viewer. Invites, plan limits (bots, sources, members, messages), and an audit log.
- **Knowledge.** Upload PDF, Word, text, Markdown, CSV, HTML or JSON; add a web page or a whole site (sitemap or crawl, with scheduled refresh); paste text or Q&A. Sources are split into passages with section detection (`s. 29`, `Art. 5`), embedded, and indexed for **hybrid search** (vector + full text, fused by reciprocal rank). Large PDFs index in the background, page by page.
- **Answers you can trust.** Citations are required by default, an answer below the relevance threshold becomes an honest "I couldn't find that", follow-up questions are rewritten before searching, and every answer gets a confidence score. Unsure answers, thumbs-down and a random sample go to a **review queue**; corrections can be published back as verified Q&A.
- **Channels.** Web widget (8.7 KB gzipped, Shadow DOM, streaming), server/mobile API with secret keys, WhatsApp Cloud API, Twilio SMS, Africa's Talking SMS. Answers are reformatted per channel. Customers can ask for a person; agents reply from the inbox and the reply goes back on the same channel.
- **Models.** Choose per bot: Claude or OpenAI models, Together, any OpenAI-compatible endpoint, or a fine-tuned model. Workspaces bring their own keys (stored in Vault) or use the platform's keys if their plan allows. Usage and estimated cost are metered per workspace.
- **Quality and training.** Eval sets with graded runs (correctness, groundedness, citation rate, source recall, latency) to compare bots and models; datasets built from reviewed answers, exported as JSONL with emails and phone numbers masked; fine-tune jobs with OpenAI or Together.
- **Dashboard.** Overview with knowledge gaps, inbox with live updates and take-over, bot setup with a live widget preview, a playground that shows *why* the bot answered (what it searched for, which passages it found and used), knowledge management with test search, review, training, settings, and a platform admin page.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Database, auth, files | Supabase: Postgres 17, pgvector (HNSW), RLS, Storage, Vault, pg_cron, pg_net, Realtime | One managed service holds tenancy, vectors, secrets and scheduling. RLS makes isolation a database guarantee rather than an app convention. |
| Backend | Supabase Edge Functions (Deno): `api`, `channels`, `worker`, `admin` | Close to the database, no servers to run. Long jobs are split into resumable steps on a Postgres job queue. |
| Dashboard | React 19, React Router 7, TanStack Query, Tailwind 4, Radix UI, Vite 8, TypeScript | |
| Widget | Dependency-free TypeScript, one IIFE file | Safe to drop into any site. |

The original stack (Supabase + React) was kept and hardened rather than replaced: it already fits the problem, and a separate vector database or job runner would add operational cost without a clear gain at this scale. If indexing volume outgrows Edge Function limits, the `worker` can move to a long-running container unchanged, since it only talks to Postgres through the job queue.

## Repository

```
src/                      Dashboard (React)
  components/ui/          Design system: buttons, forms, dialogs, tables
  features/               Overview, inbox, bots, knowledge, review, training, settings, platform
  lib/                    Supabase client, session/workspace context, queries, types
widget/src/               Embeddable web widget
supabase/
  migrations/             Schema, RLS, RPCs, job queue, cron (v1 data is moved to schema "legacy" and imported)
  functions/
    api/                  Public API v1 (widget + server keys)
    channels/             WhatsApp / Twilio / Africa's Talking webhooks
    worker/               Background jobs: indexing, evals, fine-tunes, delivery, notifications
    admin/                Dashboard operations that need secrets (keys, channels, playground, search)
    _shared/              AI providers, RAG, ingestion, auth, channels, legal analysis, training
  tests/database/         pgTAP: tenancy, RLS, search, inbox, training
  tests/e2e/              End-to-end test against running functions (fake AI)
docs/API.md               API reference
docs/LEGAI.md             Running LegAI on BotDesk
```

## Run it locally

Needs Node 22+, Deno 2, Docker and the Supabase CLI (`npx supabase`).

```bash
npm install
npx supabase start                    # Postgres, Auth, Storage, Realtime in Docker
cp supabase/functions/.env.example supabase/functions/.env
#   set SESSION_SECRET and WORKER_SECRET (openssl rand -hex 32),
#   and BOTDESK_FAKE_AI=1 to try everything without model keys
npx supabase functions serve --env-file supabase/functions/.env

cp .env.example .env.local            # VITE_SUPABASE_URL and the anon/publishable key from `supabase status`
npm run dev                           # http://localhost:5173, widget at /widget.js
```

Background jobs (indexing, evals) run when the database kicks the worker. Locally, tell Postgres where the functions are once, in the SQL editor (Studio → SQL, or `psql`):

```sql
select vault.create_secret('http://kong:8000', 'botdesk_project_url');
select vault.create_secret('<your WORKER_SECRET>', 'botdesk_worker_secret');
```

Then sign up in the dashboard, create a workspace (choose *Legal* for the LegAI template), add a source, and try the bot in **Bots → Playground**.

To make yourself a platform admin (plans, features, all workspaces at `/platform`):

```sql
update profiles set is_platform_admin = true where email = 'you@example.com';
```

## Tests

```bash
npm run typecheck && npm run lint && npm test      # dashboard + widget
npm run test:functions                             # Deno unit tests (chunker, citations, channels, auth…)
npm run test:db                                    # pgTAP: isolation, roles, limits, search, review, training
npm run test:e2e                                   # full flow against running functions with fake AI
```

The end-to-end test signs up a user, builds a legal workspace, indexes sources (including a PDF), chats through the widget and the server API, hands off to a person, receives a signed Twilio webhook, runs Listen In analysis, builds a dataset, runs an eval and checks metering. Point it at your functions with `API_URL`, `CHANNELS_URL`, `WORKER_URL`, `ADMIN_URL` if they are not at `$SUPABASE_URL/functions/v1`.

## Deploy

1. **Create a Supabase project** and link it: `npx supabase link --project-ref <ref>`.
2. **Database:** `npx supabase db push`. This applies every migration, including moving v1 tables to the `legacy` schema and importing their data.
3. **Function secrets:**
   ```bash
   npx supabase secrets set SESSION_SECRET=$(openssl rand -hex 32) WORKER_SECRET=<random> \
     DASHBOARD_URL=https://app.yourdomain.com RESEND_API_KEY=... EMAIL_FROM="BotDesk <noreply@yourdomain.com>" \
     ANTHROPIC_API_KEY=... OPENAI_API_KEY=... VOYAGE_API_KEY=...   # optional platform keys
   ```
   Never set `BOTDESK_FAKE_AI` in production.
4. **Functions:** `npx supabase functions deploy api channels worker admin`. They verify callers themselves (API keys, signatures, user sessions), so JWT verification is off for them in `supabase/config.toml`.
5. **Worker kick and cron:** in the SQL editor,
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'botdesk_project_url');
   select vault.create_secret('<WORKER_SECRET>', 'botdesk_worker_secret');
   ```
   The migrations schedule `botdesk-worker` (every minute), `botdesk-refresh-sources` (hourly) and `botdesk-housekeeping` (nightly retention and cleanup) with pg_cron.
6. **Auth:** set the Site URL and redirect URLs to your dashboard domain (Authentication → URL configuration), and configure SMTP for sign-up emails.
7. **Dashboard:** `npm run build` and host `dist/` on any static host (Vercel, Netlify, Cloudflare Pages, S3). Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_WIDGET_URL=https://app.yourdomain.com/widget.js` at build time. `dist/widget.js` is the embeddable script; serve it with a short cache lifetime.
8. **Channels:** connect WhatsApp or SMS from a bot's **Channels** tab. The dashboard shows the webhook URL (and the WhatsApp verify token) to paste into Meta, Twilio or Africa's Talking.

## Security model

- **Isolation:** RLS on every table, keyed on workspace membership; composite foreign keys stop rows from referring across workspaces; storage paths are checked to belong to the source's workspace. pgTAP tests cover cross-tenant reads and writes.
- **Keys:** API keys are stored as SHA-256 hashes. Publishable keys (`bd_pk_`) only chat, for one bot, from allowed domains, through a signed short-lived widget session. Secret keys (`bd_sk_`) are rejected when sent from a browser. Provider keys and channel tokens live in Supabase Vault and are only read by functions.
- **Webhooks:** unguessable per-channel URLs, plus signature checks for WhatsApp (`X-Hub-Signature-256`) and Twilio (`X-Twilio-Signature`).
- **Untrusted content:** fetched pages go through an SSRF guard (public addresses only); sources and transcripts are fenced as data in prompts; training exports mask emails and phone numbers.
- **Audit log:** key creation and revocation, provider key changes, member invites, role changes and removals, channel changes, published reviews and fine-tunes.

## Fine-tuning, honestly

Most quality problems are fixed faster by better sources and instructions; BotDesk's evals tell you whether a change helped. When tone or format still needs work, datasets of reviewed answers export as JSONL for any provider, and jobs can be started from the dashboard:

- **OpenAI** closed fine-tuning to new organisations in May 2026 and stops accepting new jobs on 6 January 2027. It is supported for accounts that still have access.
- **Together AI** runs LoRA fine-tunes of open models. Serving the result needs a dedicated endpoint, which you then add as a custom model (Settings → Models).
- Any other OpenAI-compatible endpoint (vLLM, Fireworks, OpenRouter, your own) can be used for a bot as a custom model.
