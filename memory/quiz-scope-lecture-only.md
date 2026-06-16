---
name: quiz-scope-lecture-only
description: Quizzes must only test content taught in the student's lecture transcripts, at SY0-701 depth
metadata:
  type: project
---

Quizzes must test ONLY what the student was actually taught in their lecture transcripts (the 121 files in `transcripts/`, Professor Messer SY0-701 captions) — never outside knowledge, even if it's real and exam-relevant CompTIA Security+ SY0-701 content. If a concept *should* be on the exam but isn't in the lectures, it must be added to the study material before being tested, not tested cold. Questions must also stay at appropriate SY0-701 technical depth/difficulty (no vendor-specific or graduate-level detail).

**Why:** Student got a topic quiz (and its second-chance) question on cryptographic erasure / Self-Encrypting Drives that they say wasn't in their lecture, failed at 60%, and flagged it as unfair.

**How to apply:** Scope-lock lives in the generation prompts:
- Topic quiz — CONTENT RULE scope lock in `app/api/quiz/route.ts` (receives `studyGuideContent`).
- Study guide — `lib/prompts.ts` `STUDY_GUIDE_SYSTEM_PROMPT` (imported by `app/api/session/route.ts`); rule 1 forbids introducing untaught TOPICS (the guide is the only thing the topic quiz sees, so a leak here propagates). Rule 2 is a deliberate carve-out: the guide may add one-clause plain-language glosses for terms the lecture only names (e.g. defining what a TPM is) — glosses are reading aids, NOT new testable scope. Defining a named term ≠ adding a new topic.
- Second-chance — `app/api/quiz/second-chance/route.ts` only gets the missed questions + topic name (NOT the guide); it re-tests the same concept, so it inherits scope from the now-locked topic quiz, plus a SCOPE LOCK guardrail line.
- Domain mastery quiz — `app/api/quiz/domain/route.ts` now feeds the actual transcripts (via `getTranscript`, capped `PER_TOPIC_CHARS = 4000` each) for the domain's topics and tells the model those are the only allowed source. User chose "lecture-only (feed transcripts)" over broad exam-scope.

Note: CLAUDE.md lists a `/api/quiz/random` route but it does NOT exist in the codebase.
