# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A personal CompTIA Security+ SY0-701 study coach app built for one specific student (CIS degree, cybersecurity concentration, JMU May 2026 graduate, exam June 18 2026). It generates AI-powered study guides from raw lecture transcripts, runs adaptive quizzes, tracks weak areas, and provides a dashboard coach. Not a generic study tool — student context and exam date are hardcoded into system prompts and DB defaults.

See [ROADMAP.md](ROADMAP.md) for known issues, planned improvements, and the fastest places to extend the app.

## Commands

```bash
npm run dev        # Start dev server (localhost:3000)
npm run build      # Production build
npm run start      # Serve the production build
npx tsc --noEmit   # Type check (no test suite exists)
npm run db:init    # Seed topic_progress rows from ALL_TOPICS (node scripts/init-db.js)
```

The SQLite DB is created automatically at `data/coach.db` on first request. No manual setup needed beyond `ANTHROPIC_API_KEY` in `.env.local`.

## Architecture

**Stack:** Next.js 15 App Router, TypeScript, **Supabase Postgres** (via the `postgres` driver), Anthropic SDK, ReactMarkdown + remark-gfm, CSS Modules. Deployable to Vercel (see [DEPLOY.md](DEPLOY.md)).

**Key constraint:** `postgres` is server-only. `next.config.js` externalizes it (`serverExternalPackages: ['postgres']`). All DB calls happen in API routes via `lib/db.ts`, never in client components.

**Auth:** A single-password gate (`middleware.ts` + `APP_PASSWORD` env var) protects every route except `/login` and `/api/login`. `POST /api/login` sets an httpOnly cookie checked by the middleware. If `APP_PASSWORD` is unset, the gate is disabled (local dev convenience).

**Env vars** (`.env.local` locally, Vercel project settings in prod): `ANTHROPIC_API_KEY`, `DATABASE_URL` (Supabase Transaction-pooler URI, port 6543), `APP_PASSWORD`.

**Mobile/PWA:** Viewport + theme color in `app/layout.tsx`; installable manifest in `app/manifest.ts` with generated icons (`app/icon.tsx`, `app/apple-icon.tsx`). Pages have `@media (max-width: 460px)` breakpoints for phone layout.

**File map (pages):**
- `app/page.tsx` — dashboard (progress, daily plan, coach chat, domain gate, weak-area entry). Calls `/api/progress`; links to `/session/[id]`, `/weak-area-session`, `/domain/[id]`.
- `app/session/[id]/page.tsx` — per-topic study guide → quiz → second-chance → results flow (the main study loop).
- `app/domain/[id]/page.tsx` — domain detail / topic list; links into per-topic sessions and the domain mastery quiz.
- `app/quiz/domain/[id]/page.tsx` — the 20-question domain mastery quiz UI (calls `/api/quiz/domain` + `/api/quiz/domain/save`).
- `app/quiz/random/page.tsx` — random/cumulative quiz UI. Builds a multi-domain quiz by calling `/api/quiz/domain` once per domain (5×) and merging the results; there is no dedicated random route. (Has a contract mismatch with the domain route — see ROADMAP.md.)
- `app/weak-area-session/page.tsx` — grouped weak-area review (all flagged concepts of a topic in one guide + quiz).
- `app/weak-area/[id]/page.tsx` — single weak-area session (calls `/api/weak-area/session` + `/api/weak-area/quiz`).
- `app/layout.tsx`, `app/globals.css` — shell + design tokens.
- `lib/db.ts` — all DB + topic data (see below)
- `lib/prompts.ts` — shared prompt builders (study guide, weak-area guide/quiz, domain final quiz, weak-area extraction)
- `lib/transcripts.ts` — `getTranscript(topicId)` file loader

There is no `components/` directory — all UI lives in the page files.

### Data Layer (`lib/db.ts`)

Single file handles everything: connection, schema, seeding, and all query functions. A pooled `postgres` client is module-level and reused across requests. `ready()` lazily creates the tables and seeds `ALL_TOPICS` on first query (idempotent). Helpers `queryAll`/`queryOne`/`run` take the legacy `?`-placeholder SQL and convert it to Postgres `$1,$2` via `toPg()`, so the original query strings carried over. Every public function is `async`.

**Seeding/migration scripts:** `npm run db:init` (`scripts/init-db.js`) creates schema + seeds topics in Supabase. `npm run db:migrate` (`scripts/migrate-sqlite-to-pg.js`) is the one-time importer that copied the old local `data/coach.db` (sql.js) into Postgres — kept for reference. The legacy sql.js path is fully removed.

**Schema tables:**
- `profile` — exam date (default `2026-06-18`; `runMigrations()` also rewrites a legacy `2026-06-20` value to `2026-06-18`), `study_hours_per_day`, `last_weak_session` date (for day-based lesson locking)
- `topic_progress` — one row per topic: status (pending/studying/passed/failed), quiz_score, quiz_attempts, completed_at, study_minutes (AI estimate cache)
- `quiz_attempts` — historical quiz records with questions_json + wrong_questions
- `weak_areas` — flagged concepts with wrong_count, resolved flag, topic_id/topic_name/domain for grouping (concept is UNIQUE)
- `domain_quizzes` — domain mastery quiz results (passed/best_score/attempts)
- `daily_plan` — date → JSON array of topic IDs (persisted once per day, not recalculated on revisit)

**Topic ordering:** `STUDY_ORDER` in `lib/db.ts` defines the canonical study sequence: D1 → D4 → D2 → D5 → D3 (by exam-weight priority). Topics are zero-padded string IDs `'002'`–`'121'`. `ALL_TOPICS` is the master list with id/name/domain for each of the **120** study topics. (Note: transcript `001` is the intro "How to Pass" video and is intentionally NOT in `ALL_TOPICS`.)

**Seeding:** `npm run db:init` (`node scripts/init-db.js`, a standalone ~6KB script) seeds `topic_progress` rows from the topic list. The DB also auto-creates at `data/coach.db` on first request via `getDb()`. After any mutation, `saveDb()` writes the full DB back to disk with `_db.export()` + `fs.writeFileSync` (so progress survives restarts).

**Migrations:** `runMigrations()` runs on every DB open via `ALTER TABLE ... ADD COLUMN` wrapped in try/catch (plus a `CREATE TABLE IF NOT EXISTS daily_plan` and the exam-date correction). Add new columns there, not in `initSchema`.

### Claude API Usage

Models in use:
- **claude-sonnet-4-20250514** (Sonnet 4): study guides (streaming), topic/domain/second-chance quiz generation, quiz save weak-area analysis, free-text grading, coach chat, weak-area guide/quiz
- **claude-haiku-4-5-20251001** (Haiku 4.5): in-session chat Q&A

**Prompt caching** is used on expensive repeated content — system prompts and transcript/guide text get `cache_control: { type: 'ephemeral' }`. Critical for the session route (re-sends large transcripts) and the domain quiz (now sends many transcripts — see below).

### Content Pipeline (`transcripts/` → `lib/transcripts.ts`)

Transcripts are 121 `.txt` files named `{id}-{topic-name}...en.txt` (Professor Messer SY0-701 captions), e.g. `002-Security Controls - CompTIA Security+ SY0-701 - 1.1.en.txt`. `getTranscript(topicId)` matches by prefix (`{id}-`) and caps content at 12,000 chars. Missing files return a `[Transcript ... not found]` placeholder string (the app does not crash, but generated content degrades — keep the folder populated).

### Scope Lock — quizzes test ONLY taught content

**This is a hard product rule** (see `memory/quiz-scope-lecture-only.md`). Every quiz generator is constrained to the student's actual lecture material; it must never introduce real-but-untaught CompTIA concepts (this caused a complaint where a topic quiz tested cryptographic erasure on SEDs that wasn't in the lecture). Where the lock lives:

- **Study guide** (`buildStudyGuidePrompt` in `lib/prompts.ts`) — "use ONLY the transcript; do not introduce untaught technologies/terms; Exam-flags must be transcript-covered." The guide is the only source the topic quiz sees, so a leak here propagates.
- **Topic quiz** (`app/api/quiz/route.ts`, inline `SYSTEM_PROMPT`) — strict CONTENT RULE scope lock against `studyGuideContent`.
- **Second-chance** (`app/api/quiz/second-chance/route.ts`) — receives only the missed questions + topic name (not the guide); re-tests the same concept with a scope-lock guardrail.
- **Domain mastery quiz** (`app/api/quiz/domain/route.ts`) — now **feeds the actual transcripts** for the domain's topics (`getTranscript`, capped `PER_TOPIC_CHARS = 4000` each) and locks generation to that content. Trade-off: large token payload per domain quiz (accepted in favor of lecture-faithfulness).

### Quiz Grading Flow (topic, in `app/session/[id]/page.tsx`)

1. Student takes main quiz. **Every** question is scored — MC auto-graded, free-text graded via `POST /api/quiz/grade` (results kept per-index in `textResults`). First-pass score = correct / total questions.
2. Any wrong answer of **either type** → `POST /api/quiz/second-chance` regenerates a same-type makeup question on the same concept (MC→MC, text→text).
3. **Half credit:** each makeup question answered correctly is worth 0.5 of a question toward the final score (`finalScore = round((firstPassCorrect + 0.5·makeupCorrect) / total · 100)`). This keeps a corrected slip from failing the quiz.
4. Only concepts wrong on **both** passes get flagged → `POST /api/quiz/save` with `weakAreaIndices` (subset of `wrongIndices`). Save route calls Claude to extract specific concept names → `upsertWeakArea` per concept.
5. Pass thresholds: **70%** for a topic quiz, **80%** for a domain mastery quiz.

**Gotcha (fixed, watch for regressions):** "Retake Quiz" must reset `phase` back to a loading state in the **same** state batch as it clears `questions`/`wrongIndices`; otherwise the results view renders against an empty `questions` array and crashes (`questions[i].question` is undefined). See `handleRetake`.

### Weak Area Session Flow

Weak areas are grouped by `topic_id` in `app/weak-area-session/page.tsx` (`groupByTopic()`). Each group gets one combined guide + quiz covering all concepts together (not one session per flag). The daily lesson lock (`lessonLocked`) is based on `isWeakAreaSessionDoneToday()`, which compares `profile.last_weak_session` against today's UTC date.

### Pace & Daily Plan (`app/api/progress/route.ts`)

Pacing is **purely topic-count based** — there are no time estimates or a minutes budget. The goal is `GOAL_TOPICS_PER_DAY` (5), and catch-up is **front-loaded into today** rather than spread as a daily rate. With `effectiveDays = daysLeft − EXAM_BUFFER_DAYS` (3-day buffer before the June 18 exam) and `daysAfterToday = effectiveDays − 1`:

```
catchupToday  = topicsRemaining − goal · daysAfterToday   // do this many today…
topicsPerDay  = min(remaining, max(goal, catchupToday))   // …then goal/day clears the rest
behind        = topicsPerDay > goal
```

So `topicsPerDay` is today's target: the goal (5) when on pace, or a one-day burst when behind. `requiredPerDay = ceil(remaining / effectiveDays)` is the even-spread rate, kept only for the coach's context. On the first load of the day, `getDailyPlan(today)` returns null → the plan is the next `topicsPerDay` remaining topics in `STUDY_ORDER`, saved via `saveDailyPlan()` and reused on later loads that day.

**Timezone:** "today" is anchored to US Eastern (`localToday()` / `APP_TZ = 'America/New_York'` in `lib/db.ts`), not UTC. `getTopicsCompletedOn(date)` compares `(completed_at AT TIME ZONE 'America/New_York')::date` so an evening study session counts as one day's work instead of splitting across UTC midnight (the old UTC-based query under-counted topics finished after ~8pm Eastern).

### Domain Gate

`getDomainQuizPending()` returns the domain number of a mastery quiz that's blocking progression. After all topics in a domain are passed, the student must pass that domain's 20-question quiz at 80%+ before the next domain unlocks.

## CSS System

Global design tokens in `app/globals.css` `:root`: `--bg/--bg-2/--bg-3` (dark layers), `--green/--amber/--red/--blue` (semantic colors with `-dim` and `-border` variants), `--radius/--radius-lg`. Fonts: IBM Plex Mono (UI labels, badges, numbers) + IBM Plex Sans (body).

Two markdown render classes:
- `.md-content` — full-size for study guides (15px, generous spacing, H2/H3 hierarchy, amber blockquotes for exam flags)
- `.chat-md-content` — compact for AI chat responses (13px, tight spacing, green H3 labels, no extra padding)

All page styles are CSS Modules (`.module.css` per page). No Tailwind, no CSS-in-JS.

## API Routes Reference

| Route | Purpose | Model |
|-------|---------|-------|
| `GET /api/progress` | Dashboard data + daily plan | — |
| `POST /api/session` | Streaming study guide | Sonnet (streaming) |
| `POST /api/session/chat` | In-lecture Q&A | Haiku (streaming) |
| `POST /api/coach` | Dashboard coach chat | Sonnet (streaming) |
| `POST /api/quiz` | Generate topic quiz (scope-locked to study guide) | Sonnet |
| `POST /api/quiz/save` | Grade + flag weak areas | Sonnet |
| `POST /api/quiz/second-chance` | Regenerate questions for misses | Sonnet |
| `POST /api/quiz/grade` | Grade free-text answer | Sonnet |
| `POST /api/quiz/domain` | Generate 20-question domain quiz (scope-locked to fed transcripts) | Sonnet |
| `POST /api/quiz/domain/save` | Save domain quiz result | — |
| `GET /api/weak-areas` | List unresolved weak areas | — |
| `POST /api/weak-areas/complete` | Mark weak area session done today | — |
| `POST /api/weak-area/session` | Streaming weak area guide | Sonnet (streaming) |
| `POST /api/weak-area/quiz` | Generate weak area mini quiz | Sonnet |

**No `/api/quiz/random` route exists** — the random quiz page composes its quiz from 5× `/api/quiz/domain` calls instead. (Historic docs referenced a random route; it was never built and isn't required.) The page and the domain route disagree on shape, so the random quiz has live bugs — see ROADMAP.md.

## Prompt Engineering Notes

Shared quiz/guide prompts live in `lib/prompts.ts`. Two quiz prompts are inline in their routes: the topic quiz (`app/api/quiz/route.ts`) and the domain quiz (`app/api/quiz/domain/route.ts`). The second-chance prompt is inline in `app/api/quiz/second-chance/route.ts`.

Key rules baked into the quiz prompts:
- **Scope lock first** — only test content present in the provided lecture material (see "Scope Lock" above).
- Scenario-based stems mandatory ("A security analyst discovers...").
- All four MC options must be within ±15 words of each other — the correct answer must not be the longest.
- Distractors must use named strategies (related-but-wrong-scenario, right-concept-wrong-implementation, compound wrong answers).
- No verbatim phrases from the study guide in questions or answers.
- Stay at SY0-701 exam depth — no vendor-specific or implementation-level minutiae.

The coach (`app/api/coach/route.ts`) receives the full `ProgressData` object serialized into its system prompt — days left, topic counts, weak areas, domain breakdown, pace, today's completions — so it can give data-grounded advice without an extra DB call.
