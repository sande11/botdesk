# Running LegAI on BotDesk

LegAI (the Flutter app) keeps its interface, on-device speech recognition, recordings and saved conversations on the phone. BotDesk becomes its backend for everything that needs law, models or people:

| LegAI needs | BotDesk provides |
| --- | --- |
| Answers to legal questions, with sources | `POST /v1/chat` with `format: "legal"`: a `LegalAnswer`-shaped JSON with summary, points, sources, follow-ups and a disclaimer |
| Listen In advice while a conversation is recorded | `POST /v1/legal/analyze` per transcript segment, `POST /v1/legal/summarize` at the end |
| The law itself, per country | Knowledge bases with legal metadata (jurisdiction, document type, citation, in-force date, superseded), section-aware indexing, hybrid search filtered by jurisdiction |
| Choosing and switching AI models | Per-bot model (Claude, OpenAI, Together, any OpenAI-compatible endpoint, or a fine-tune), workspace keys in Vault |
| Lawyers checking answers | Review queue (no-answer, low confidence, thumbs-down, 10% random sample), corrections published back as verified answers |
| Getting better over time | Evals to measure changes, datasets from reviewed answers, fine-tune jobs |

**Nothing in the app is connected yet.** This page is the contract and the steps for wiring it up by hand.

## 1. Set up the workspace

1. Sign up in the BotDesk dashboard and create a workspace with the **Legal** template. This turns on the legal pack, creates a first knowledge base and a draft bot.
2. **Settings → Legal pack:** add the jurisdictions LegAI supports (`MW, ZM, ZW, ZA, KE, TZ, UG, NG, GH, GB, US`) and set the default (`MW`).
3. **Settings → Models:** add an Anthropic key (answers) and a Voyage key (`voyage-law-2` embeddings are tuned for legal text), or rely on platform keys if your plan includes them.
4. **Knowledge:** one knowledge base per legal system is a good default (e.g. *Laws of Malawi*), with the embedding model set to Voyage law-2. Add Acts, regulations and guidance as PDF or Word with jurisdiction, document type, citation (e.g. `Employment Act (Cap. 55:01)`) and in-force date. Mark repealed law as **Superseded** instead of deleting it. Use **Test search** to check that a question finds the right section.
5. **Bots → your bot → Setup:** turn on *Legal mode*, set *Answer format* to structured, keep citations required, and write the disclaimer you want shown. Claude Sonnet is the default model for legal bots; compare models in the Playground or with an eval before switching.
6. **Bots → Playground:** try the Chat tab with each jurisdiction, and the Listen In tab with a pasted transcript.
7. **Settings → API keys:** create a **secret** key for the LegAI backend with the `chat` and `analyze` scopes. It is shown once.
8. **Settings → Members:** invite lawyers as **reviewers**. They see the Review queue and can correct and publish answers, but can't change bots or keys.

## 2. Keep the secret key off the phone

A secret key in a mobile app can be extracted, so the app should call a small function in **LegAI's own Supabase project**, which checks the user's LegAI session and forwards the call with the key. LegAI already uses `supabase_flutter`, so the app can call it with `Supabase.instance.client.functions.invoke`.

`supabase/functions/legai-assistant/index.ts` in the LegAI project:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'

const BOTDESK = Deno.env.get('BOTDESK_API_URL')!   // https://<botdesk-ref>.supabase.co/functions/v1/api/v1
const KEY = Deno.env.get('BOTDESK_SECRET_KEY')!    // bd_sk_...
const BOT = Deno.env.get('BOTDESK_BOT_ID')!

const ROUTES = { ask: '/chat', analyze: '/legal/analyze', summarize: '/legal/summarize' } as const
// Only these fields pass through from the app.
const ALLOWED = ['message', 'jurisdiction', 'conversation_ref', 'new_conversation', 'segment', 'context', 'segments', 'flags', 'topic']

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: { code: 'unauthorized', message: 'Sign in again.' } }, { status: 401 })

  const { action, ...input } = await req.json()
  const path = ROUTES[action as keyof typeof ROUTES]
  if (!path) return Response.json({ error: { code: 'bad_request', message: 'Unknown action.' } }, { status: 400 })

  const body: Record<string, unknown> = Object.fromEntries(Object.entries(input).filter(([k]) => ALLOWED.includes(k)))
  body.bot_id = BOT
  if (action === 'ask') Object.assign(body, { user: { id: user.id }, format: 'legal' })

  const res = await fetch(BOTDESK + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } })
})
```

```bash
supabase secrets set BOTDESK_API_URL=... BOTDESK_SECRET_KEY=bd_sk_... BOTDESK_BOT_ID=...
supabase functions deploy legai-assistant
```

BotDesk sees each LegAI user as a contact identified by their LegAI user id, so their conversations show in the BotDesk inbox and can be erased with `DELETE /v1/contacts/{user id}`.

## 3. Map the responses to LegAI's domain

The structured answer was designed to match `LegalAnswer` in `lib/features/chat/domain/entities/chat_entities.dart`:

| BotDesk `answer.legal` | LegAI |
| --- | --- |
| `summary` | `LegalAnswer.summary` |
| `points[]` | `LegalAnswer.points` |
| `sources[].title`, `sources[].detail` | `LegalSource.title`, `LegalSource.detail` |
| `follow_ups[]` | `LegalAnswer.followUps` |
| `see_a_lawyer`, `disclaimer` | Not in the entity yet; worth showing under the answer |
| `answer.outcome == "no_answer"` | Show `answer.text` (an honest "I couldn't find that") instead of a structured card |

Listen In flags match `AdviceFlag` in `lib/features/listen_in/domain/entities/listen_entities.dart`:

| BotDesk flag | LegAI `AdviceFlag` |
| --- | --- |
| `key`, `title`, `body`, `quote`, `citation`, `segment_id` | same fields (`segmentId`) |
| `kind`: `rights` / `caution` / `next_step` | `AdviceKind.rights` / `.caution` / `.nextStep` |
| `at_ms` | `at: Duration(milliseconds: at_ms)` |
| (none) | `id`: generate locally, e.g. `'${segmentId}-$key'` |

Request side: `TranscriptSegment` → `segment: { id, text, start_ms: start.inMilliseconds, speaker }`; `AnalysisContext` → `context: { topic: topic.name, jurisdiction: jurisdictionCode, already_flagged: alreadyFlagged.toList() }`. Send only final segments (`isFinal`), and include the last few as `context.previous` for continuity.

## 4. Repository implementations (sketch)

The app's Clean Architecture means only the data layer changes; the fakes can be swapped out in the dependency setup.

```dart
class BotDeskLegalAssistantRepository implements LegalAssistantRepository {
  BotDeskLegalAssistantRepository(this._client);
  final SupabaseClient _client;

  @override
  Future<LegalAnswer> ask({
    required String question,
    required String jurisdictionCode,
    List<ChatMessage> history = const [],
  }) async {
    final res = await _client.functions.invoke('legai-assistant', body: {
      'action': 'ask',
      'message': question,
      'jurisdiction': jurisdictionCode,
      'new_conversation': history.isEmpty,
      // Better: pass the local conversation id as 'conversation_ref' (needs a
      // conversationId parameter on ask()), so each LegAI thread maps to
      // exactly one BotDesk conversation.
    });
    final answer = (res.data as Map<String, dynamic>)['answer'] as Map<String, dynamic>;
    final legal = answer['legal'] as Map<String, dynamic>?;
    if (legal == null || answer['outcome'] == 'no_answer') {
      return LegalAnswer(summary: answer['text'] as String);
    }
    return LegalAnswer(
      summary: legal['summary'] as String,
      points: List<String>.from(legal['points'] as List),
      sources: [
        for (final s in legal['sources'] as List)
          LegalSource(title: s['title'] as String, detail: (s['detail'] ?? '') as String),
      ],
      followUps: List<String>.from(legal['follow_ups'] as List),
    );
  }
}
```

`LegalAnalysisRepository.analyze` and `summarize` follow the same pattern with `action: 'analyze'` and `action: 'summarize'`. Map HTTP errors to the app's existing failures: 401 → sign in again, 402 → the workspace's monthly messages are used up, 429 → slow down, anything else → `AssistantFailure`.

## 5. Running it day to day

- **Adding law:** upload in the dashboard, or push from a content pipeline with `POST /v1/sources` (`external_id` keeps one source per document and re-indexes it on change). Web sources can refresh themselves daily or weekly.
- **Quality:** answers the bot couldn't give appear on the Overview as knowledge gaps, with a one-click *Add answer*. Reviewers work through **Review**; a corrected answer can be published as a verified Q&A source, which the bot then cites.
- **Measuring changes:** keep an eval set of real questions per jurisdiction (import from reviewed answers), and run it before and after changing sources, instructions or the model.
- **Fine-tuning:** collect reviewed answers into a dataset and export JSONL or start a Together fine-tune. OpenAI fine-tuning is closed to new organisations since May 2026 and ends for new jobs on 6 January 2027.
