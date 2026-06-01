# ROADMAP.md

Living reference for the Security+ coach app: what's solid, what's fragile, what to build next, and **where to change things** so future work is fast. Pair with [CLAUDE.md](CLAUDE.md) (how it works today).

Last reviewed: 2026-05-31.

---

## Current State Snapshot

Working end to end: dashboard + daily plan, per-topic study guide → quiz → second-chance → results, weak-area sessions, domain mastery gate, coach chat, AI time estimates. All quizzes are now **scope-locked to lecture transcripts** (see CLAUDE.md → Scope Lock). DB persists to `data/coach.db` via `persist()`.

---

## Known Issues & Tech Debt

Priority: **P1** = correctness/cost risk, **P2** = quality/maintainability, **P3** = nice-to-have.

| P | Issue | Where | Suggested fix |
|---|-------|-------|---------------|
| P1 | **Random quiz contract mismatch** (not a missing route — it calls `/api/quiz/domain` 5×). Bugs: sends `{count:10}` but the domain route ignores `count` and always returns 20 (incl. 3 text Qs), so it's ~100 Qs not 50; expects a per-question `domain` field the route never sets (`q.domain` is `undefined` → domain dividers & per-domain breakdown are wrong); treats text questions as MC. | `app/quiz/random/page.tsx`, `app/api/quiz/domain/route.ts` | Add a purpose-built `/api/quiz/random` route (sample across domains, honor count, tag each question's domain, MC-only), or align the page with the domain route's real output. |
| P1 | **Cost blow-up from my scope-lock change**: because `/api/quiz/domain` now feeds transcripts, the random quiz (5 parallel domain calls) now pulls the **entire course corpus** (~all 120 transcripts) in one sitting. | `app/quiz/random/page.tsx` → `app/api/quiz/domain/route.ts` | Give random its own leaner route, or have the domain route accept a `count`/sampling param and cap transcripts fed. |
| P1 | Domain quiz now sends **all transcripts for a domain** (up to ~29 × 4000 chars ≈ 25–30k input tokens per generation). Faithful but expensive/slow. | `app/api/quiz/domain/route.ts` | Cache generated domain quizzes per-domain; or feed stored study guides instead of raw transcripts; or summarize transcripts once and reuse. |
| P2 | Study guides are **regenerated from scratch every session** (not cached) — repeated Sonnet cost for re-reads. | `app/api/session/route.ts`, `lib/db.ts` | Add a `study_guides` table (topic_id → markdown) and serve cached; add a "regenerate" action. Unlocks domain-quiz reuse too. |
| P2 | Scope-lock is **prompt-enforced only** — the model can still drift and test untaught content. No automated check. | all quiz routes | Optional post-generation validator: cross-check question/answer keywords against the source transcript; flag or regenerate outliers. |
| P2 | Crash class: results view indexes `questions[i].question` directly. The retake path was fixed by resetting `phase` in the same batch, but the indexing is still unguarded. | `app/session/[id]/page.tsx` | Defensive render: guard with `questions[i]?.question` / early-return when `questions` is empty, so no future state ordering bug can crash it. |
| P2 | Exam date has **multiple sources of truth that disagree**: DB is `2026-06-18` (default + a migration that rewrites `2026-06-20`→`2026-06-18`), but `lib/prompts.ts` hardcodes "June 20, 2026" in the study-guide prompt. The AI is telling the student the wrong exam date. | `lib/prompts.ts` (hardcoded), `lib/db.ts` (canonical) | Read exam date from `profile.exam_date` everywhere; stop hardcoding it in prompt strings. |
| P2 | Model IDs are **string literals scattered** across routes (`claude-sonnet-4-20250514`, `claude-haiku-4-5-20251001`). | all routes, `lib/estimates.ts` | Centralize in `lib/models.ts` (e.g. `MODELS.sonnet` / `MODELS.haiku`) so version bumps are one edit. |
| P2 | Prompt logic is **split**: `lib/prompts.ts` builders + inline prompts in topic/domain/second-chance routes. Easy to update one and miss another (already bit us during the scope-lock change). | `lib/prompts.ts` + 3 routes | Move the inline prompts into `lib/prompts.ts` so all generation rules live in one file. |
| P3 | **Two schema definitions can drift** — `scripts/init-db.js` declares its own `CREATE TABLE`s (e.g. `exam_date` default `2026-06-20`, and missing `last_weak_session` / `daily_plan`) separate from `lib/db.ts`. They're reconciled only because `runMigrations()` patches the gaps at runtime. | `scripts/init-db.js`, `lib/db.ts` | Have the seed script import/share the schema from `lib/db.ts`, or drop it in favor of lazy runtime seeding. |
| P3 | No test suite; `npx tsc --noEmit` is the only gate. | — | Add a few unit tests for `lib/db.ts` query helpers and the grading/weak-area flow. |
| P3 | `data/coach.db` is the only copy of student progress; no backup/export. | `lib/db.ts` | Add an export endpoint or periodic snapshot. |

---

## Improvement Opportunities (features)

- **Full exam simulation** — a 90-question, 90-minute timed mock across all domains. Natural home is a purpose-built `/api/quiz/random` route backing the existing `app/quiz/random/page.tsx` (which today improvises via the domain route); reuse the scope-lock + transcript-feeding pattern, but sample topics rather than feeding the whole corpus.
- **Spaced repetition for weak areas** — schedule weak-area resurfacing by interval instead of the once-per-day lock; track per-concept ease/streak.
- **Exam-readiness score** — single dashboard number from topic pass rate, domain-quiz scores, weak-area count, and pace vs. exam date. The coach already receives all this data.
- **Guide caching + on-demand regenerate** — depends on the `study_guides` table above; big cost win and enables instant re-reads.
- **Per-topic transcript coverage check** — validate every `ALL_TOPICS` id has a matching transcript file (and surface gaps), since missing files silently degrade generation.

---

## "Where do I change X?" — fast map

- **Quiz question rules / difficulty / scope** → `lib/prompts.ts` and the inline `SYSTEM_PROMPT`s in `app/api/quiz/route.ts`, `app/api/quiz/domain/route.ts`, `app/api/quiz/second-chance/route.ts`. (Consolidating these is on the roadmap above.)
- **Study guide format/rules** → `buildStudyGuidePrompt` in `lib/prompts.ts`.
- **Pass thresholds** → topic 70% / domain 80%, in the session page and domain save logic.
- **Study order / topic list** → `STUDY_ORDER` and `ALL_TOPICS` in `lib/db.ts`.
- **Daily workload** → `DAILY_BUDGET_MINUTES` in `app/api/progress/route.ts`.
- **DB schema / new columns** → `runMigrations()` in `lib/db.ts` (not `initSchema`).
- **Models** → currently scattered literals; centralize per the tech-debt table.
- **Colors / fonts / spacing** → tokens in `app/globals.css`; per-page `*.module.css`.
- **Student context (background, exam date)** → `lib/prompts.ts` + `profile` defaults in `lib/db.ts`.

---

## Conventions to keep

- sql.js is server-only — never import `lib/db.ts` from a client component.
- Add DB columns in `runMigrations()`, idempotently.
- Use `cache_control: ephemeral` on large/repeated prompt content (system prompts, transcripts, guides).
- Any new quiz generator **must** be scope-locked to taught content (`memory/quiz-scope-lecture-only.md`).
- Type-check (`npx tsc --noEmit`) before considering a change done.
