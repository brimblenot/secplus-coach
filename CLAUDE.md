# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Maintenance rule:** Keep this file in sync with the code. Any change that adds/removes a route, model, schema column, prompt, page, or flow must update the relevant section here in the same commit, before pushing. A fresh session should be able to understand the whole system from this file without re-reading the code.

## What This Is

A personal CompTIA Security+ SY0-701 study coach app built for one specific student (CIS degree, cybersecurity concentration, JMU May 2026 graduate, exam June 18 2026). It generates AI-powered study guides from raw lecture transcripts, runs adaptive quizzes, tracks weak areas, schedules spaced-repetition reviews, and provides a dashboard coach. Studying is **self-paced** (no daily quota). Not a generic study tool — student context and exam date are hardcoded into system prompts and DB defaults.

See [ROADMAP.md](ROADMAP.md) for known issues, planned improvements, and the fastest places to extend the app.

## Commands

```bash
npm run dev        # Start dev server (localhost:3000)
npm run build      # Production build
npm run start      # Serve the production build
npx tsc --noEmit   # Type check (no test suite exists)
npm run db:init    # Create schema + apply column migrations + seed topics (node scripts/init-db.js)
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
- `app/page.tsx` — dashboard (progress, **reviews-due card**, next-topic CTA, completed-today, coach chat, domain gate, weak-area entry, metrics, domain grid). Self-paced: no quota, the next topic is never locked. Calls `/api/progress`; links to `/session/[id]`, `/review-session`, `/weak-area-session`, `/domain/[id]`, `/quiz/random`.
- `app/session/[id]/page.tsx` — main study loop: study guide → **section-by-section checkpoint reading** → quiz → second-chance → results.
- `app/review-session/page.tsx` — spaced-repetition session: due topics → per-topic recall quiz (4 MC + 1 text) with an optional "Need a refresher?" recap → summary. Blue-themed.
- `app/domain/[id]/page.tsx` — domain detail / topic list; links into per-topic sessions and the domain mastery quiz.
- `app/quiz/domain/[id]/page.tsx` — the 20-question domain mastery quiz UI (calls `/api/quiz/domain` + `/api/quiz/domain/save`).
- `app/quiz/random/page.tsx` — random/cumulative quiz UI. Builds a multi-domain quiz by calling `/api/quiz/domain` once per domain (5×) and merging the results; there is no dedicated random route. (Has a contract mismatch with the domain route — see ROADMAP.md.)
- `app/weak-area-session/page.tsx` — grouped weak-area review (all flagged concepts of a topic in one guide + quiz).
- `app/weak-area/[id]/page.tsx` — single weak-area session (calls `/api/weak-area/session` + `/api/weak-area/quiz`).
- `app/layout.tsx`, `app/globals.css` — shell + design tokens.
- `lib/db.ts` — all DB + topic data (see below)
- `lib/prompts.ts` — shared prompt builders (study guide, checkpoints, weak-area guide/quiz, domain final quiz, weak-area extraction, review quiz, review refresher)
- `lib/quiz.ts` — `balanceQuizAnswers()` post-processing (spreads the correct MC option evenly across A/B/C/D)
- `lib/transcripts.ts` — `getTranscript(topicId)` file loader

There is no `components/` directory — all UI lives in the page files.

### Data Layer (`lib/db.ts`)

Single file handles connection, schema definition, seeding, and all query functions. A pooled `postgres` client is module-level and reused across requests (created per cold start; `max: 3`, `prepare: false`). Helpers `queryAll`/`queryOne`/`run` take the legacy `?`-placeholder SQL and convert it to Postgres `$1,$2` via `toPg()`, so the original query strings carried over. Every public function is `async`.

**Schema is NOT created or migrated at request time.** Running CREATE/ALTER on every serverless cold start took table locks on the shared Supabase pooler and caused 504s, so the runtime app only ever *queries* existing tables. Schema lives in two places that must be kept in sync:
- **`scripts/init-db.js`** — the operative migration path. `npm run db:init` runs this standalone CommonJS script (its own inline `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + topic seeding). It is idempotent and additive, safe to re-run.
- **`ensureSchema()` in `lib/db.ts`** — a mirror of the same DDL, only invoked by `seedTopics()` (not at request time). Keep it identical to the script.

> ⚠️ **When you add a table or column:** add it to BOTH `scripts/init-db.js` and `ensureSchema()`, then run `npm run db:init` against Supabase. Forgetting the script means the column never reaches the DB and any query referencing it 500s (this exact mistake broke the dashboard once the `review_*` columns were queried before `db:init` had been re-run).

**`npm run db:migrate`** (`scripts/migrate-sqlite-to-pg.js`) is the one-time importer that copied the old local `data/coach.db` (legacy sql.js) into Postgres — kept for reference only. The sql.js path is fully removed; there is no local SQLite file anymore.

**Schema tables:**
- `profile` — `exam_date` (default `2026-06-18`), `study_hours_per_day`, `last_weak_session` (date string of the last completed weak-area session)
- `topic_progress` — one row per topic: `status` (pending/studying/passed/failed), `quiz_score`, `quiz_attempts`, `completed_at`, `study_minutes`, plus spaced-repetition fields **`review_due`** (Eastern date string), **`review_interval`** (days), **`review_streak`** (index into the interval ladder)
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

### Study Guide Format (`STUDY_GUIDE_SYSTEM_PROMPT` in `lib/prompts.ts`)

Guides are written to be **skimmable and memorable**, not dense prose (an earlier "gloss every term inline, no bold, no lists" version read like a dictionary and caused burnout). The current rules:
- **Rule 1 — scope lock** (see below).
- **Rule 2 — skimmable structure:** one-line takeaway per section, short bullets, bold key terms on first use, compact Markdown tables for comparisons.
- **Rule 3 — gloss every term:** define each acronym/command/jargon term as **bold term + short plain definition** (the scope-lock carve-out: glosses are reading aids, NOT new testable scope).
- **Rule 4 — analogy per concept:** a 1–2 sentence real-world analogy so it sticks.
- **Rule 6 — structure:** begins with a `### TL;DR` (3–5 bullets, doubles as the review flashback), ends with `### Exam flags` (2–3 transcript-covered topics).
Target ~600–850 words. Consumed by `app/api/session/route.ts` (Sonnet, non-streaming — the client buffers the full guide then renders it).

### Scope Lock — quizzes test ONLY taught content

**This is a hard product rule** (see `memory/quiz-scope-lecture-only.md`). Every generator is constrained to the student's actual lecture material; it must never introduce real-but-untaught CompTIA concepts (this caused a complaint where a topic quiz tested cryptographic erasure on SEDs that wasn't in the lecture). Where the lock lives:

- **Study guide** (`STUDY_GUIDE_SYSTEM_PROMPT`, consumed by `app/api/session/route.ts`) — rule 1: only the transcript may be TAUGHT as exam material; the guide is the only source the topic quiz + checkpoints see, so a leak here propagates. Rule 3 glosses are the only carve-out.
- **Checkpoints** (`buildCheckpointsPrompt`, consumed by `app/api/session/checkpoints/route.ts`) — one question per `### ` section, locked to that section's text; skips `TL;DR` and `Exam flags`.
- **Topic quiz** (`app/api/quiz/route.ts`, inline `SYSTEM_PROMPT`) — strict scope lock against `studyGuideContent`.
- **Second-chance** (`app/api/quiz/second-chance/route.ts`) — receives only the missed questions + topic name; re-tests the same concept with a scope-lock guardrail.
- **Domain mastery quiz** (`app/api/quiz/domain/route.ts`) — feeds the actual transcripts for the domain's topics (`getTranscript`, capped `PER_TOPIC_CHARS = 4000` each) and locks generation to that content.
- **Review quiz** (`buildReviewQuizPrompt`, consumed by `app/api/review/quiz/route.ts`) — locked to the single topic's transcript (capped 5000 chars).

### Session Flow — checkpoint reading + quiz grading (`app/session/[id]/page.tsx`)

1. **Guide loads**, then `/api/session/checkpoints` returns one comprehension check per `### ` section. The guide is parsed into sections client-side (`parseGuide`); the student reads **one section at a time** and must answer that section's checkpoint (MC or free-text, graded via `/api/quiz/grade`) before the next section reveals. Checkpoints are practice only — they score/flag nothing. If checkpoint generation fails, the whole guide is revealed unblocked.
2. **Main quiz:** every question scored — MC auto-graded, free-text via `POST /api/quiz/grade` (kept per-index in `textResults`). First-pass score = correct / total.
3. Any wrong answer of either type → `POST /api/quiz/second-chance` regenerates a same-type makeup question on the same concept (MC→MC, text→text).
4. **Half credit:** each makeup answered correctly is worth 0.5 of a question (`finalScore = round((firstPassCorrect + 0.5·makeupCorrect) / total · 100)`).
5. Only concepts wrong on **both** passes get flagged → `POST /api/quiz/save` with `weakAreaIndices`. The save route marks the topic passed/failed, on a first pass **schedules the first spaced review** (`scheduleFirstReview`), and calls Claude to extract concept names → `upsertWeakArea` per concept.
6. Pass thresholds: **70%** for a topic quiz, **80%** for a domain mastery quiz.

**Gotcha (fixed, watch for regressions):** "Retake Quiz" must reset `phase` back to a loading state in the **same** state batch as it clears `questions`/`wrongIndices`; otherwise the results view renders against an empty `questions` array and crashes. See `handleRetake`.

### Spaced Repetition (the retention engine)

A Leitner-style schedule resurfaces passed topics as short retrieval checks (helpers in `lib/db.ts`):
- **Ladder:** `REVIEW_INTERVALS = [1, 3, 7, 16, 35]` days. `review_streak` is the index into it.
- **First review:** `scheduleFirstReview(topicId)` (called from `/api/quiz/save` on first pass) sets `review_due = today + 1`.
- **Subsequent:** `scheduleReview(topicId, passed)` advances one rung on a passed review, resets to rung 0 on a miss; the next `review_due` is clamped to ≤ `exam_date`.
- **Surfacing:** `getDueReviewCount(today)` feeds the dashboard "Review due: N" card; `getDueReviews(today)` (status=passed, `review_due <= today`) backs `GET /api/review/due`.
- **A review** (`/review-session`) = a 4 MC + 1 text recall quiz per topic (`/api/review/quiz`), an optional TL;DR recap (`/api/review/refresher`), and `/api/review/save`, which reschedules the topic and — on a miss — feeds the wrong questions to the weak-area extractor so the gap re-enters the weak-area loop. Review pass = ≥60% recalled (`PASS_RATIO`).

### Weak Area Session Flow

Weak areas are grouped by `topic_id` in `app/weak-area-session/page.tsx` (`groupByTopic()`). Each group gets one combined guide + quiz covering all concepts together (not one session per flag). The guide buffers fully before rendering (no chunky streaming). Weak areas are surfaced on the dashboard as a **nudge card, not a hard lock** — the next topic is always available (`isWeakAreaSessionDoneToday()` / `markWeakAreaSessionDone()` still exist and record the last session date, but no longer gate progression).

### Pace & Self-Paced Dashboard (`app/api/progress/route.ts`)

Studying is **self-paced**: there is no daily topic quota, no "behind" status, and no persisted daily plan. `/api/progress` returns informational fields only — `daysLeft`, `topicsRemaining`, `completedCount`/`totalTopics`, `courseProgress`, `avgScore`, `nextTopic`, `domainStats`, `weakAreas`, `domainQuizPending`, `completedTodayTopics`, and **`reviewsDue`**. The dashboard shows a calm status line ("N remaining · N done today · study at your own pace"), surfaces due reviews first, then the always-open next topic.

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
| `GET /api/progress` | Dashboard data (self-paced) + reviewsDue | — |
| `POST /api/session` | Study guide (buffered, non-streaming) | Sonnet |
| `POST /api/session/checkpoints` | Per-section comprehension checks (scope-locked) | Haiku |
| `POST /api/session/chat` | In-lecture Q&A | Haiku (streaming) |
| `POST /api/coach` | Dashboard coach chat | Sonnet (streaming) |
| `POST /api/quiz` | Generate topic quiz (scope-locked to study guide) | Sonnet |
| `POST /api/quiz/save` | Grade + schedule first review + flag weak areas | Sonnet |
| `POST /api/quiz/second-chance` | Regenerate questions for misses | Sonnet |
| `POST /api/quiz/grade` | Grade free-text answer | Sonnet |
| `POST /api/quiz/domain` | Generate 20-question domain quiz (scope-locked to fed transcripts) | Sonnet |
| `POST /api/quiz/domain/save` | Save domain quiz result | — |
| `GET /api/review/due` | List topics due for spaced review today | — |
| `POST /api/review/quiz` | Generate review recall quiz (4 MC + 1 text, scope-locked) | Sonnet |
| `POST /api/review/refresher` | Optional TL;DR recap for a review | Haiku |
| `POST /api/review/save` | Reschedule review + flag weak areas on miss | Sonnet |
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
- All four MC options within ±15 words of each other; the correct answer must not be the longest. `balanceQuizAnswers()` (`lib/quiz.ts`) then redistributes the correct slot evenly across A/B/C/D post-generation.
- Distractors must use named strategies (related-but-wrong-scenario, right-concept-wrong-implementation, compound wrong answers).
- No verbatim phrases from the study material; stay at SY0-701 exam depth — no vendor-specific or implementation-level minutiae.
- Keep explanations/rubrics short (long output is truncated mid-JSON and the quiz fails to generate).

The coach (`app/api/coach/route.ts`) receives the `ProgressData` object serialized into its system prompt — days left, topic counts, weak areas, domain breakdown, today's completions — and is explicitly told the student is self-paced (do not nag about quotas or "behind").
