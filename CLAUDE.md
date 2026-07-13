# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Maintenance rule:** Keep this file in sync with the code. Any change that adds/removes a route, model, schema column, prompt, page, or flow must update the relevant section here in the same commit, before pushing. A fresh session should be able to understand the whole system from this file without re-reading the code.

## What This Is

A personal CompTIA Security+ SY0-701 study coach app built for one specific student (CIS degree, cybersecurity concentration, JMU May 2026 graduate). It generates AI-powered study guides from raw lecture transcripts, runs adaptive quizzes, tracks weak areas, offers on-demand topic and section reviews, and provides a dashboard coach. Studying is **self-paced but goal-anchored**: the student sets a date to finish all topics by and an exam date (both editable on the dashboard), and the app derives a required "topics/day" pace and exam countdown from them. There is no per-day *quota lock* — the next topic is never gated by pace, and reviews stay on-demand. Not a generic study tool — the student's background context is hardcoded into system prompts.

See [ROADMAP.md](ROADMAP.md) for known issues, planned improvements, and the fastest places to extend the app.

## Commands

```bash
npm run dev        # Start dev server (localhost:3000)
npm run build      # Production build
npm run start      # Serve the production build
npx tsc --noEmit   # Type check (no test suite exists)
npm run db:init    # Create schema + apply column migrations + seed topics (node scripts/init-db.js)
npm run flashcards:build  # ONE-TIME/offline: regenerate lib/flashcards.json from transcripts (node scripts/extract-acronyms.cjs)
```

Setup: put `ANTHROPIC_API_KEY`, `DATABASE_URL`, and (for the deployed app) `APP_PASSWORD` in `.env.local`, then run `npm run db:init` once to create the schema in Supabase. **The app never creates or migrates the schema at request time** (see "Data Layer" below) — `db:init` is the only path that changes the database structure.

## Architecture

**Stack:** Next.js 15 App Router, TypeScript, **Supabase Postgres** (via the `postgres` driver), Anthropic SDK, ReactMarkdown + remark-gfm, CSS Modules. Deployable to Vercel (see [DEPLOY.md](DEPLOY.md)).

**Key constraint:** `postgres` is server-only. `next.config.js` externalizes it (`serverExternalPackages: ['postgres']`). All DB calls happen in API routes via `lib/db.ts`, never in client components.

**Auth:** A single-password gate (`middleware.ts` + `APP_PASSWORD` env var) protects every route except `/login` and `/api/login`. `POST /api/login` sets an httpOnly cookie checked by the middleware. If `APP_PASSWORD` is unset, the gate is disabled (local dev convenience).

**Env vars** (`.env.local` locally, Vercel project settings in prod): `ANTHROPIC_API_KEY`, `DATABASE_URL`, `APP_PASSWORD`.
- `DATABASE_URL` **must use Supabase's SESSION pooler (port 5432), NOT the transaction pooler (6543).** Under this app's concurrent dashboard queries the 6543 pooler returned statement-timeout (57014) and the dashboard hung; the session pooler runs the same queries in ~1s. The same `DATABASE_URL` is used in dev and prod (there is no separate local DB).

**Mobile/PWA:** Viewport + theme color in `app/layout.tsx`; installable manifest in `app/manifest.ts` with generated icons (`app/icon.tsx`, `app/apple-icon.tsx`). Pages have `@media (max-width: 460px)` breakpoints for phone layout.

**File map (pages):**
- `app/page.tsx` — dashboard (progress, **pace tracker card**, next-topic CTA, completed-today, coach chat, domain gate, weak-area entry, metrics, domain grid). The header shows an exam countdown badge; the pace card shows required topics/day to finish by the target date, today's progress vs that target, and both dates — with an inline "Edit dates" editor that PATCHes `/api/settings` and refetches. No quota lock: the next topic is never gated. Calls `/api/progress`; links to `/session/[id]`, `/weak-area-session`, `/domain/[id]`, `/quiz/random`, `/flashcards`.
- `app/flashcards/page.tsx` — acronym flashcard drill (`app/flashcards.module.css`). Fetches `/api/flashcards`, shuffles, and runs a flip + self-rate loop ("Got it" clears the card, "Still learning" resurfaces it later in the session). Filter chips: All + D1–D5 + **Ports** (the last shows only the `type: 'port'` protocol/port cards). **Entirely client-side, per-session** — no persistence, no DB, no runtime LLM.
- `app/session/[id]/page.tsx` — main study loop: study guide → **section-by-section checkpoint reading** → quiz → second-chance → results.
- `app/review/topic/[id]/page.tsx` — on-demand single-topic review: a 4 MC + 1 text recall quiz (`/api/review/quiz`) with an optional "Need a refresher?" recap; misses flow back to weak areas via `/api/review/save`. Blue-themed, reuses `app/quiz.module.css`.
- `app/review/domain/[id]/page.tsx` — section review: one mixed quiz across a whole domain (`/api/quiz/domain`), ungated and retakeable (does NOT touch the mastery-quiz gate). Reuses `app/quiz.module.css`.
- `app/domain/[id]/page.tsx` — domain detail / topic list; each studied topic row has a **Review** button (amber-accented when shaky), plus **Review Domain** (section review) and **Final Quiz** (mastery) buttons in the title row.
- `app/quiz/domain/[id]/page.tsx` — the 20-question domain mastery quiz UI (calls `/api/quiz/domain` + `/api/quiz/domain/save`).
- `app/quiz/random/page.tsx` — random/cumulative quiz UI. Builds a multi-domain quiz by calling `/api/quiz/domain` once per domain (5×) and merging the results; there is no dedicated random route. (Has a contract mismatch with the domain route — see ROADMAP.md.)
- `app/weak-area-session/page.tsx` — grouped weak-area review (all flagged concepts of a topic in one guide + quiz).
- `app/weak-area/[id]/page.tsx` — single weak-area session (calls `/api/weak-area/session` + `/api/weak-area/quiz`).
- `app/layout.tsx`, `app/globals.css` — shell + design tokens.
- `lib/db.ts` — all DB + topic data (see below)
- `lib/prompts.ts` — shared prompt builders (study guide, checkpoints, weak-area guide/quiz, domain final quiz, weak-area extraction, review quiz, review refresher)
- `lib/quiz.ts` — `balanceQuizAnswers()` post-processing (spreads the correct MC option evenly across A/B/C/D)
- `lib/transcripts.ts` — `getTranscript(topicId)` file loader
- `lib/flashcards.json` — static flashcard deck (`{term, expansion, definition, domain, topicId, type?}`) served verbatim by `/api/flashcards`. Two kinds of card: **acronyms** (bootstrapped by `scripts/extract-acronyms.cjs`, then hand-curated down to genuine exam abbreviations — vendor/product/tool names, non-acronym algorithm names, general/non-security abbreviations, and specific IDs were pruned) and **ports** (`type: 'port'`, `domain: 0`, hand-authored: front = protocol, expansion = port number(s), definition = role). Hand-editable; re-running the extract script would re-introduce raw acronyms and need re-curation.

There is no `components/` directory — all UI lives in the page files.

### Data Layer (`lib/db.ts`)

Single file handles connection, schema definition, seeding, and all query functions. A pooled `postgres` client is module-level and reused across requests (created per cold start; `max: 3`, `prepare: false`). Helpers `queryAll`/`queryOne`/`run` take the legacy `?`-placeholder SQL and convert it to Postgres `$1,$2` via `toPg()`, so the original query strings carried over. Every public function is `async`.

**Schema is NOT created or migrated at request time.** Running CREATE/ALTER on every serverless cold start took table locks on the shared Supabase pooler and caused 504s, so the runtime app only ever *queries* existing tables. Schema lives in two places that must be kept in sync:
- **`scripts/init-db.js`** — the operative migration path. `npm run db:init` runs this standalone CommonJS script (its own inline `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + topic seeding). It is idempotent and additive, safe to re-run.
- **`ensureSchema()` in `lib/db.ts`** — a mirror of the same DDL, only invoked by `seedTopics()` (not at request time). Keep it identical to the script.

> ⚠️ **When you add a table or column:** add it to BOTH `scripts/init-db.js` and `ensureSchema()`, then run `npm run db:init` against Supabase. Forgetting the script means the column never reaches the DB and any query referencing it 500s (this exact mistake broke the dashboard once the `review_*` columns were queried before `db:init` had been re-run).

**`npm run db:migrate`** (`scripts/migrate-sqlite-to-pg.js`) is the one-time importer that copied the old local `data/coach.db` (legacy sql.js) into Postgres — kept for reference only. The sql.js path is fully removed; there is no local SQLite file anymore.

**Schema tables:**
- `profile` — `study_hours_per_day`, `last_weak_session` (date string of the last completed weak-area session), `finish_topics_by` (YYYY-MM-DD target to finish all topics), `exam_date` (YYYY-MM-DD). The two date columns drive the dashboard pace tracker; both are read by `getPaceSettings()` and written by `updatePaceSettings()` (via `PATCH /api/settings`). Defaults (backfilled by `db:init` when null): finish `2026-07-28`, exam `2026-07-29`. (`exam_date` was previously dropped for the "fully self-paced" era and re-added here; a legacy row may carry a stale value, so `db:init` only backfills when the column is null.)
- `topic_progress` — one row per topic: `status` (pending/studying/passed/failed), `quiz_score`, `quiz_attempts`, `completed_at`, `study_minutes`. The `review_due` / `review_interval` / `review_streak` columns still exist but are **dormant** — the old scheduled spaced-repetition engine was removed; reviews are now on-demand (nothing reads or writes these columns).
- `quiz_attempts` — historical topic-quiz records with `questions_json` + `wrong_questions` (review quizzes are NOT logged here, so the quiz average stays a measure of first-time topic performance)
- `weak_areas` — flagged concepts with `wrong_count`, `resolved` flag, `topic_id`/`topic_name`/`domain` for grouping (`concept` is UNIQUE)
- `domain_quizzes` — domain mastery quiz results (`passed`/`best_score`/`attempts`)
- `daily_plan` — date → JSON array of topic IDs. **Legacy/unused** since pacing went self-paced; the table remains but `/api/progress` no longer reads or writes it.

**Topic ordering:** `STUDY_ORDER` in `lib/db.ts` defines the canonical study sequence: D1 → D4 → D2 → D5 → D3 (by exam-weight priority). Topics are zero-padded string IDs `'002'`–`'121'`. `ALL_TOPICS` is the master list with id/name/domain for each of the **120** study topics. (Transcript `001` is the intro "How to Pass" video and is intentionally NOT in `ALL_TOPICS`.) `scripts/topics.json` is the seeding copy used by `db:init` — keep it in sync with `ALL_TOPICS`.

**Timezone:** "today" is anchored to US Eastern (`localToday()` / `APP_TZ = 'America/New_York'`), not UTC. `getTopicsCompletedOn(date)` compares `(completed_at AT TIME ZONE 'America/New_York')::date`, and all review-schedule dates are Eastern `YYYY-MM-DD` strings, so an evening study session counts as one day's work instead of splitting across UTC midnight.

### Claude API Usage

Models in use (string literals scattered across routes — see ROADMAP for the "centralize model ids" cleanup):
- **`claude-sonnet-4-6`** (Sonnet): study guide, topic/domain/second-chance/weak-area/review quiz generation, quiz-save + review-save weak-area analysis, free-text grading, coach chat, weak-area guide.
- **`claude-haiku-4-5-20251001`** (Haiku 4.5): in-session chat Q&A (`/api/session/chat`), per-section checkpoints (`/api/session/checkpoints`), review refresher (`/api/review/refresher`).

**maxDuration:** every LLM route sets `export const maxDuration = 60`. Generation is bounded with small `max_tokens` (≈2800 for quizzes/guides, 500 for extraction/refresher) so it finishes under Vercel's 60s function limit — exceeding it returns a non-JSON 504.

**Prompt caching:** expensive repeated content (system prompts, transcript/guide text) gets `cache_control: { type: 'ephemeral' }` (5-min TTL). Used on the session route, topic quiz, checkpoints, domain quiz, and review quiz.

### Content Pipeline (`transcripts/` → `lib/transcripts.ts`)

Transcripts are 121 `.txt` files named `{id}-{topic-name}...en.txt` (Professor Messer SY0-701 captions), e.g. `002-Security Controls - CompTIA Security+ SY0-701 - 1.1.en.txt`. `getTranscript(topicId)` matches by prefix (`{id}-`) and caps content at 12,000 chars. Missing files return a `[Transcript ... not found]` placeholder (the app does not crash, but generated content degrades — keep the folder populated). Review/domain routes further slice the transcript (`PER_TOPIC_CHARS`) to bound tokens.

**Flashcard deck build (`scripts/extract-acronyms.cjs` → `lib/flashcards.json`):** a **one-time, offline** script (`npm run flashcards:build`) reads every transcript, asks Haiku (concurrency 5) to pull the acronyms each lecture actually uses (`{term, expansion, definition}`, scope-locked to that transcript), merges + dedupes by uppercased term across all lectures (first lecture to use it sets the `domain`/`topicId`; the richest definition wins), and writes the sorted static deck. It is NOT a runtime path — the deployed app never calls Claude for flashcards, it just serves the committed JSON. Re-run only to regenerate; the output is hand-reviewable/editable.

### Study Guide Format (`STUDY_GUIDE_SYSTEM_PROMPT` in `lib/prompts.ts`)

Guides are written to be **skimmable and memorable**, not dense prose (an earlier "gloss every term inline, no bold, no lists" version read like a dictionary and caused burnout) — but they must still **actually explain each concept**, not just analogize it (a later version opened concepts with only an analogy, e.g. "Telnet is a glass phone booth," and never said what Telnet *is*). The current rules:
- **Rule 1 — scope lock** (see below).
- **Rule 2 — explain first, then skim:** each concept is taught in order — (a) a plain definition of what it IS and DOES (**not** an analogy), (b) key details as short bullets, (c) *then* the analogy. An analogy may never substitute for the definition; a term's first mention may never be an undefined table cell. Bold key terms on first use; compact Markdown tables only for **already-defined** things.
- **Rule 2a — make every contrast explicit:** if a concept is taught by contrast ("unlike X", "does what X cannot"), the guide must spell out the *other side's* relevant property in plain words (e.g. it may not say "EDR does what antivirus can't" without stating that AV only signature-matches at execution and keeps no activity record). This is the fix for a checkpoint that graded EDR-vs-AV against AV facts the guide never stated. Stating the compared thing's limitation is a clarity aid (like a rule-3 gloss), not new testable scope — but it must be present so the guide is self-sufficient to answer from.
- **Rule 3 — gloss every term:** define each acronym/command/jargon term as **bold term + short plain definition**, in prose *before* any table it appears in (the scope-lock carve-out: glosses are reading aids, NOT new testable scope).
- **Rule 4 — analogy per concept:** a 1–2 sentence real-world analogy *after* the explanation, so it sticks.
- **Rule 6 — opening:** H2 title, then a 1–2 sentence framing intro (plain paragraph, no header) — **no** top-of-guide TL;DR/summary of unread material.
- **Rule 7 — structure:** H3 sentence-case teaching sections, then a `### Recap` (3–5 bullets, the summary lives at the END now) and `### Exam flags` (2–3 transcript-covered topics).
Target ~600–900 words. Consumed by `app/api/session/route.ts` (Sonnet, non-streaming — the client buffers the full guide then renders it). `parseGuide` (session page) keeps the pre-first-`###` framing intro always-visible; the `### Recap`/`### Exam flags` sections get no checkpoint and so never gate reading.

### Scope Lock — quizzes test ONLY taught content

**This is a hard product rule** (see `memory/quiz-scope-lecture-only.md`). Every generator is constrained to the student's actual lecture material; it must never introduce real-but-untaught CompTIA concepts (this caused a complaint where a topic quiz tested cryptographic erasure on SEDs that wasn't in the lecture). Where the lock lives:

- **Study guide** (`STUDY_GUIDE_SYSTEM_PROMPT`, consumed by `app/api/session/route.ts`) — rule 1: only the transcript may be TAUGHT as exam material; the guide is the only source the topic quiz + checkpoints see, so a leak here propagates. Rule 3 glosses are the only carve-out.
- **Checkpoints** (`buildCheckpointsPrompt`, consumed by `app/api/session/checkpoints/route.ts`) — one question per `### ` section, locked to that section's text; skips `Recap` and `Exam flags` (and the header-less framing intro). Beyond the scope lock on the *question*, an **answerability rule** locks the *model answer*: a fully-correct answer must be constructible from the section's own sentences, so a checkpoint may not depend on an implied contrast or outside fact the section never states (this is what let a "what does EDR do that AV can't?" checkpoint grade against unstated AV limitations). Paired with study-guide rule 2a, which makes those contrasts explicit in the first place.
- **Topic quiz** (`app/api/quiz/route.ts`, inline `SYSTEM_PROMPT`) — strict scope lock against `studyGuideContent`.
- **Second-chance** (`app/api/quiz/second-chance/route.ts`) — receives only the missed questions + topic name; re-tests the same concept with a scope-lock guardrail.
- **Domain mastery quiz** (`app/api/quiz/domain/route.ts`) — feeds the actual transcripts for the domain's topics (`getTranscript`, capped `PER_TOPIC_CHARS = 4000` each) and locks generation to that content.
- **Review quiz** (`buildReviewQuizPrompt`, consumed by `app/api/review/quiz/route.ts`) — locked to the single topic's transcript (capped 5000 chars).

### Session Flow — checkpoint reading + quiz grading (`app/session/[id]/page.tsx`)

1. **Guide loads**, then `/api/session/checkpoints` returns one comprehension check per `### ` section. The guide is parsed into sections client-side (`parseGuide`); the student reads **one section at a time** and must answer that section's checkpoint (MC or free-text, graded via `/api/quiz/grade`) before the next section reveals. Checkpoints are practice only — they score/flag nothing. If checkpoint generation fails, the whole guide is revealed unblocked.
2. **Main quiz:** every question scored — MC auto-graded, free-text via `POST /api/quiz/grade` (kept per-index in `textResults`). First-pass score = correct / total.
3. Any wrong answer of either type → `POST /api/quiz/second-chance` regenerates a same-type makeup question on the same concept (MC→MC, text→text).
4. **Half credit:** each makeup answered correctly is worth 0.5 of a question (`finalScore = round((firstPassCorrect + 0.5·makeupCorrect) / total · 100)`).
5. Only concepts wrong on **both** passes get flagged → `POST /api/quiz/save` with `weakAreaIndices`. The save route marks the topic passed/failed and calls Claude to extract concept names → `upsertWeakArea` per concept.
6. Pass thresholds: **70%** for a topic quiz, **80%** for a domain mastery quiz.

**Gotcha (fixed, watch for regressions):** "Retake Quiz" must reset `phase` back to a loading state in the **same** state batch as it clears `questions`/`wrongIndices`; otherwise the results view renders against an empty `questions` array and crashes. See `handleRetake`.

### On-demand Review (self-paced reinforcement)

Reviews are **student-triggered, not scheduled** — there is no due date, no queue, and no dashboard "due" card. The model is: learn all the content first, fix misses as you go, then reinforce (weakest-first) as you get closer to being exam-ready. Two granularities, both reached from the domain page:

- **Per-topic review** (`app/review/topic/[id]`) — the **Review** button on any *studied* topic row (a topic must be `passed`/`failed` before it's reviewable). A 4 MC + 1 text recall quiz (`/api/review/quiz`, scope-locked to the topic transcript) with an optional TL;DR recap (`/api/review/refresher`). On finish it posts to `/api/review/save`, which — on a miss (< 60% recalled, `PASS_RATIO`) — feeds the wrong questions to the weak-area extractor so the gap re-enters the weak-area loop. It does **not** schedule anything.
- **Section review** (`app/review/domain/[id]`) — the **Review Domain** button on the domain page. One mixed quiz across the whole domain, generated by `/api/quiz/domain` (the same generator as the mastery quiz). It is **ungated and retakeable**: MC-scored for feedback only, no pass threshold, and it deliberately does NOT call `/api/quiz/domain/save`, so it never affects the 80% mastery gate. No weak-area writes (matches mastery-quiz precedent — its questions aren't attributed to a single topic).

**Weakest-first hint:** the domain page marks a topic's Review button amber when it's shaky (`status === 'failed'`, or passed under 80%), so near-exam reinforcement naturally targets what's decayed — the only thing left of the old spacing logic, minus any schedule.

The old Leitner engine (`scheduleFirstReview`/`scheduleReview`/`getDueReviews`/`getDueReviewCount`, `REVIEW_INTERVALS`, `GET /api/review/due`, `/review-session`) has been **removed**. The `review_due`/`review_interval`/`review_streak` columns remain in the schema but are **dormant** (nothing reads or writes them).

### Weak Area Session Flow

Weak areas are grouped by `topic_id` in `app/weak-area-session/page.tsx` (`groupByTopic()`). Each group gets one combined guide + quiz covering all concepts together (not one session per flag). The guide buffers fully before rendering (no chunky streaming). Weak areas are surfaced on the dashboard as a **nudge card, not a hard lock** — the next topic is always available (`isWeakAreaSessionDoneToday()` / `markWeakAreaSessionDone()` still exist and record the last session date, but no longer gate progression).

### Pace & Goal-Anchored Dashboard (`app/api/progress/route.ts`)

Studying is self-paced but **goal-anchored to two dates**: `finish_topics_by` and `exam_date` (see the `profile` schema). There is still no per-day quota *lock* and no persisted daily plan — the next topic is always open regardless of pace. `/api/progress` returns the informational fields (`topicsRemaining`, `completedCount`/`totalTopics`, `courseProgress`, `avgScore`, `nextTopic`, `domainStats`, `weakAreas`, `domainQuizPending`, `completedTodayTopics`) plus a **`pace` object** computed from the target dates:
- `finishTopicsBy`, `examDate` — the raw target dates.
- `daysUntilFinish`, `daysUntilExam` — whole days from today (Eastern, via `daysUntil()`), floored at 0.
- `finishPastDue` — true when the finish date is already in the past.
- `perDay` — required topics/day = `ceil(topicsRemaining / (daysUntilFinish + 1))` (today counts, so "1 day left" means finish the rest today). Falls back to all remaining when past due, and `0` when nothing is left.
- `doneToday`, `onPace` (`doneToday >= perDay`, or nothing remaining).

The dashboard header shows an **exam countdown badge** (`Exam Jul 29 · Nd`, colored red ≤7d / amber ≤14d / green otherwise). Below the coach sits the **pace card**: a big required-topics/day number (red if past due, green if today's target met, amber if behind), the "N left · N days left · N/N done today" line, both target dates, and an **Edit dates** toggle that reveals two `<input type="date">` fields → `PATCH /api/settings` → refetch. (Review is on-demand from the domain pages, so nothing review-related surfaces here.)

### Domain Gate

`getDomainQuizPending()` returns the domain number of a mastery quiz that's blocking progression. After all topics in a domain are passed, the student must pass that domain's 20-question quiz at 80%+ before the next domain unlocks.

## CSS System

Global design tokens in `app/globals.css` `:root`: `--bg/--bg-2/--bg-3` (dark layers), `--green/--amber/--red/--blue` (semantic colors with `-dim` and `-border` variants), `--radius/--radius-lg`. Fonts: IBM Plex Mono (UI labels, badges, numbers) + IBM Plex Sans (body).

Two markdown render classes:
- `.md-content` — full-size for study guides (15px, generous spacing, H2/H3 hierarchy, amber blockquotes for exam flags, **styled GFM tables**)
- `.chat-md-content` — compact for AI chat responses / review refresher (13px, tight spacing, green H3 labels, no extra padding)

All page styles are CSS Modules (`.module.css` per page). No Tailwind, no CSS-in-JS.

## API Routes Reference

| Route | Purpose | Model |
|-------|---------|-------|
| `GET /api/progress` | Dashboard data + computed `pace` object | — |
| `GET /api/settings` | Read pace target dates (`finishTopicsBy`, `examDate`) | — |
| `PATCH /api/settings` | Update either/both target dates (validates YYYY-MM-DD) | — |
| `GET /api/flashcards` | Serve the static acronym deck (`?domain=N` filter); no LLM, no DB | — |
| `POST /api/session` | Study guide (buffered, non-streaming) | Sonnet |
| `POST /api/session/checkpoints` | Per-section comprehension checks (scope-locked) | Haiku |
| `POST /api/session/chat` | In-lecture Q&A | Haiku (streaming) |
| `POST /api/coach` | Dashboard coach chat | Sonnet (streaming) |
| `POST /api/quiz` | Generate topic quiz (scope-locked to study guide) | Sonnet |
| `POST /api/quiz/save` | Grade topic quiz + flag weak areas | Sonnet |
| `POST /api/quiz/second-chance` | Regenerate questions for misses | Sonnet |
| `POST /api/quiz/grade` | Grade free-text answer | Sonnet |
| `POST /api/quiz/domain` | Generate 20-question domain quiz (scope-locked to fed transcripts) — backs both the mastery quiz and the ungated section review | Sonnet |
| `POST /api/quiz/domain/save` | Save domain **mastery** quiz result (section review does not call this) | — |
| `POST /api/review/quiz` | Generate on-demand topic review quiz (4 MC + 1 text, scope-locked) | Sonnet |
| `POST /api/review/refresher` | Optional TL;DR recap for a topic review | Haiku |
| `POST /api/review/save` | Flag weak areas on miss (no scheduling) | Sonnet |
| `GET /api/weak-areas` | List unresolved weak areas | — |
| `PATCH /api/weak-areas` | Mark a weak area resolved | — |
| `POST /api/weak-areas/complete` | Mark weak area session done today | — |
| `POST /api/weak-area/session` | Streaming weak area guide | Sonnet (streaming) |
| `POST /api/weak-area/quiz` | Generate weak area mini quiz | Sonnet |

**No `/api/quiz/random` route exists** — the random quiz page composes its quiz from 5× `/api/quiz/domain` calls instead. The page and the domain route disagree on shape, so the random quiz has live bugs — see ROADMAP.md.

## Prompt Engineering Notes

Shared prompts live in `lib/prompts.ts` (`STUDY_GUIDE_SYSTEM_PROMPT`, `buildCheckpointsPrompt`, `buildWeakAreaGuidePrompt`, `buildWeakAreaQuizPrompt`, `buildReviewQuizPrompt`, `buildRefresherPrompt`, `buildDomainFinalQuizPrompt`, `buildWeakAreaPrompt`). Inline prompts: the topic quiz (`app/api/quiz/route.ts`), the domain quiz (`app/api/quiz/domain/route.ts`), the checkpoints system prompt (`app/api/session/checkpoints/route.ts`), and the second-chance prompt (`app/api/quiz/second-chance/route.ts`).

Key rules baked into the quiz prompts:
- **Scope lock first** — only test content present in the provided lecture material.
- Scenario-based stems mandatory ("A security analyst discovers...").
- All four MC options must be **parallel** — same grammatical shape and level of detail, closely matched in length (longest ≤ ~1.5× the shortest). The correct answer must not be the longest/most-complete/most-specific, and distractors must not be terse throwaways next to a fully-spelled-out answer (the "obvious longest answer sticks out" tell — same rule in both `MC_BALANCE_RULES` for quizzes and `buildCheckpointsPrompt` for quick checks). `balanceQuizAnswers()` (`lib/quiz.ts`) then redistributes the correct slot evenly across A/B/C/D post-generation.
- Distractors must use named strategies (related-but-wrong-scenario, right-concept-wrong-implementation, compound wrong answers).
- No verbatim phrases from the study material; stay at SY0-701 exam depth — no vendor-specific or implementation-level minutiae.
- Keep explanations/rubrics short (long output is truncated mid-JSON and the quiz fails to generate).

The coach (`app/api/coach/route.ts`) receives the `ProgressData` object serialized into its system prompt — topic counts, weak areas, domain breakdown, today's completions, and the **`pace` object** (target dates, days left, required topics/day, on-pace flag). It is told to give honest, concrete pace/catch-up math when asked but to stay encouraging and never guilt-trip.
