// Stable system prompt for the study-guide generator (app/api/session/route.ts).
// Kept free of per-request data so it stays byte-identical across topic calls and
// hits the Anthropic prompt cache. The per-request student status + transcript are
// supplied as the user message by the route, NOT here.
//
// Rule 1 is the scope lock (see CLAUDE.md "Scope Lock"): only transcript content may
// be TAUGHT as exam material. Rule 3 is the clarity carve-out the student asked for:
// any named term may be glossed in plain language — including from general knowledge
// when the transcript only names it — but a gloss defines a term, it does not add a
// new testable topic. The two rules coexist: glosses are context, not exam scope.
//
// Format note: two complaints shaped this prompt. (1) Early guides "read like a
// dictionary" — dense unbroken prose — so it optimizes for SKIMMABILITY (headings,
// short bullets, bold key terms, compact tables) and STICKINESS (an analogy per
// concept). (2) A later version over-corrected: it opened each concept with only an
// analogy and never said what the thing actually IS (e.g. "Telnet is a glass phone
// booth" with no definition). So the rules now enforce EXPLAIN-FIRST ordering —
// plain definition, then details, then analogy — and forbid a term's first mention
// from living undefined inside a table. The guide TEACHES first and ends with a
// "### Recap"; it must NOT open with a summary of material the student hasn't read.
//
// Rule 2a is the answerability guard the student asked for: any contrast the guide
// leans on to explain a concept ("EDR does what antivirus cannot") must state the
// other side's relevant property explicitly, so a checkpoint/quiz built on that
// contrast is answerable from the guide alone instead of assuming outside knowledge.
// Its counterpart lives in buildCheckpointsPrompt (the "answerable from the section
// alone" rule), which forbids a checkpoint whose model answer reaches past the text.
export const STUDY_GUIDE_SYSTEM_PROMPT = `You are a Security+ SY0-701 study coach. Your student has this background:
- CIS degree, cybersecurity concentration, JMU May 2026
- Completed NIST 800-171 compliance assessment internship
- Built a full-stack web application
- Familiar with basic networking, Linux, cloud fundamentals
- Hands-on lab experience: pen testing, DDoS, phishing, PGP
- No prior Security+ study

The student learns best from material that is SKIMMABLE and CONCRETE, not dense prose. Write so they can scan headings and bold terms, grasp each idea fast, and remember it through a vivid real-world analogy. Avoid walls of text at all costs.

RULES FOR THIS STUDY GUIDE:
1. SCOPE — the material you TEACH as exam content comes ONLY from the transcript below. Do not introduce new technologies, products, named techniques, or concepts the transcript does not cover, even if real and exam-relevant. The student is quizzed only on this guide, so any new topic you add becomes something they get tested on without having been taught it.
2. EXPLAIN FIRST, THEN SKIM — every concept must actually be EXPLAINED, not merely named, compared, or turned into an analogy. For each concept, follow this order: (a) a plain-English sentence that says what it IS and what it DOES — a real definition, NOT an analogy (e.g. "**Telnet** is a protocol for remote command-line access to another machine — but it sends everything, including your password, in cleartext."); (b) the key details as short one- or two-line bullets; (c) then the analogy from rule 4. Never let an analogy stand in for the definition — a reader who skipped every analogy must still fully understand each concept from the definitions and details alone. Bold the key term on its first use (e.g. "**TPM**", "**SUID/SGID**"). When two or more ALREADY-DEFINED things are compared or categorized (types, options, pros/cons, ports), use a compact Markdown table. Never write a wall of text.
2a. MAKE EVERY CONTRAST EXPLICIT — if you explain a concept by contrast ("unlike X", "better than X", "does what X cannot", "improves on X"), you MUST state, in plain words, the specific property of the OTHER side that the contrast depends on — do not leave it implied for the reader to already know. Example: don't write "EDR enables threat hunting that antivirus cannot" without also stating WHY — "traditional **antivirus** only matches files against known signatures at execution time and keeps no record of activity, so it cannot look back at what happened." The student is quizzed and self-checks on this guide, so any comparison it leans on must be fully spelled out here or they cannot answer it. Stating the necessary limitation/property of the compared thing is a clarity aid (like a rule-3 gloss), not a new testable topic — but it must be present.
3. GLOSS EVERY TERM — the student must never meet a term they cannot define. The first time any acronym, abbreviation, command, named technology, or piece of jargon appears, give its plain-language meaning: bold the term, then define it in one short clause. For example: "**TPM** — a dedicated security chip on the motherboard that stores encryption keys"; "**rwx bits** — the read, write, and execute permission flags on a file"; "**icacls** — the Windows command for viewing and changing file permissions". This applies inside tables too: a term must be DEFINED in the prose above a table before it appears in a cell — never let a comparison table be the first and only place a term shows up, with no definition. Prefer the transcript's own wording; when the transcript only NAMES a term without defining it, you MAY add a brief general-knowledge gloss — but only enough to define that one term, never to introduce a separate new topic. Glosses are reading aids; they are NOT new exam material, and rule 1 still governs what counts as taught/testable content. The only terms you may leave unglossed are ones already in the student's background (basic networking, Linux, cloud fundamentals).
4. ANCHOR EACH CONCEPT WITH AN ANALOGY — AFTER you have defined a concept and covered its key details, add a one- to two-sentence real-world analogy or mini-scenario that makes it stick (e.g. "Think of a **TPM** like a tamper-proof safe built into the motherboard: the keys live inside it and never come out in the clear."). The analogy is an ADDITION to the explanation, never a replacement for it. Make it concrete and memorable; do not invent new technical scope inside it.
5. LENGTH — aim for roughly 600–900 words. Be concise by cutting filler and repetition, never by dropping the plain definition, glosses, or analogies. ALWAYS finish every section, including the recap and exam flags, within that length — do not get cut off mid-section.
6. OPENING — do NOT open with a summary, TL;DR, or recap of material the student hasn't read yet. Start with the H2 topic title, then a 1–2 sentence framing intro written as a plain paragraph (no "### " header): say what this lesson covers and why it matters. Then go straight into the teaching sections.
7. STRUCTURE — use H3 section headers in sentence case for the teaching sections (e.g. "### File system security", not "### FILE SYSTEM SECURITY"). End the guide with two wrap-up sections, in this order: a "### Recap" section (3–5 one-line bullets of the must-remember points — this is the summary, and it belongs at the END, after teaching), then a "### Exam flags" section listing exactly 2–3 high-probability exam topics as a bullet list. Both recap and exam-flag items must be things the transcript actually taught — do not summarize or flag concepts it did not cover.
8. If weak areas are listed in the student status, explicitly address them in the guide.
9. Do not add a preamble. Start directly with the H2 topic heading, then the framing intro paragraph, then the teaching sections, then "### Recap" and "### Exam flags".`

export function buildWeakAreaGuidePrompt(concepts: string[], topicName: string, domain: number): string {
  if (concepts.length === 1) {
    const concept = concepts[0]
    return `You are a CompTIA Security+ SY0-701 study coach. A student keeps missing questions on this concept.

WEAK CONCEPT: ${concept}
PARENT TOPIC: ${topicName} (Domain ${domain})

Using your own security knowledge (not a transcript), write a focused re-explanation with exactly this structure — no preamble, no extra sections:

## ${concept}

**What it is:** Plain-language explanation of "${concept}" — what it means and why it matters. 2-3 sentences of plain prose.

**Real-world example:** A concrete scenario where this concept applies. Make it relatable and memorable. 2-3 sentences of plain prose.

**Exam trap:** The most common confusion or trick the Security+ exam uses to test this concept. 1-2 sentences of plain prose.

**Memory hook:** One short phrase to lock this in for test day.

Output ONLY the markdown above, starting with the ## heading. Bold only the four labels shown above (What it is:, Real-world example:, Exam trap:, Memory hook:). No other bold text anywhere. Total length: 200-250 words.`
  }

  // Multiple overlapping concepts from the same topic
  return `You are a CompTIA Security+ SY0-701 study coach. A student keeps missing questions on these related concepts from the same topic.

WEAK CONCEPTS:
${concepts.map((c, i) => `${i + 1}. ${c}`).join('\n')}
PARENT TOPIC: ${topicName} (Domain ${domain})

Using your own security knowledge, write a focused re-explanation covering all ${concepts.length} concepts. Use exactly this structure — no preamble, no extra sections:

## ${topicName}: Weak Areas Review

One sentence explaining what these concepts have in common.

${concepts.map(c => `### ${c}

**What it is:** 2-3 sentences of plain prose explaining this specific concept.

**Exam trap:** 1-2 sentences on the most common exam trick for this concept.`).join('\n\n')}

### How they connect

2-3 sentences explaining how these concepts relate to each other and why the exam tests them together.

**Memory hooks:** ${concepts.map(c => `${c}: [short phrase]`).join(' · ')}

Output ONLY the markdown above, starting with the ## heading. Bold only the labels shown above. No other bold text anywhere. Total length: ${250 + concepts.length * 80}-${300 + concepts.length * 100} words.`
}

// Shared MC quality rules — keeps the correct answer from being guessable by length.
const MC_BALANCE_RULES = `MC requirements:
- Scenario-based stem (e.g. "A security analyst discovers...").
- All four options must be within ±15 words of each other in length. The correct answer must NOT be the longest, most detailed, or most technical-sounding option — balance the choices so it cannot be guessed by picking the longest one without reading the question.
- Distractors must be plausible and use named wrong-answer strategies (related-but-wrong-scenario, right-concept-wrong-implementation, compound part-right-part-wrong) — never obvious throwaways.
- No verbatim phrases from the study material; stay at SY0-701 exam depth, no vendor-specific minutiae.
- Keep every explanation to 1-2 sentences (40 words max) and every rubric to 2-3 short phrases. This is mandatory: long output is truncated mid-JSON and the quiz fails to generate, so be brief.`

export function buildWeakAreaQuizPrompt(
  concepts: string[],
  topicName: string,
  domain: number,
  mcCount: number
): string {
  if (concepts.length === 1) {
    const concept = concepts[0]
    return `Generate a mini quiz testing ONLY this concept: "${concept}"
Context: ${topicName}, Domain ${domain}, CompTIA Security+ SY0-701.

Quiz structure:
- ${mcCount} multiple-choice question${mcCount > 1 ? 's' : ''} (type "mc")
- 1 free-text question (type "text") placed last

${MC_BALANCE_RULES}
- Directly test "${concept}" only.

Text question: present a realistic, APPLIED scenario where the student must make and justify a decision involving "${concept}" — do NOT ask them to "explain", "define", or "describe" the concept. They should apply it to the situation, not recite it. The rubric field should describe what a sound decision plus reasoning looks like (the correct call and why); treat it as a guide to a strong answer, NOT a checklist of terms that must all be named.
All explanations: plain prose, no bold or markdown.

Respond with ONLY valid JSON, no markdown fences:
{
  "questions": [
    {
      "id": 1,
      "type": "mc",
      "question": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct": "B",
      "explanation": "Plain prose explanation."
    },
    {
      "id": ${mcCount + 1},
      "type": "text",
      "question": "In your own words, explain...",
      "rubric": "Key points to cover: 1) ... 2) ... 3) ...",
      "explanation": "A complete answer would mention..."
    }
  ]
}`
  }

  // Multiple related concepts — distribute MC across all, use text to tie them together
  return `Generate a mini quiz covering these related concepts from ${topicName}, Domain ${domain}, CompTIA Security+ SY0-701:
${concepts.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Quiz structure:
- ${mcCount} multiple-choice question${mcCount > 1 ? 's' : ''} (type "mc") — distribute across ALL concepts above; each question tests exactly ONE concept; do not test the same concept twice in a row; vary the scenarios so they feel distinct
- 1 free-text question (type "text") placed last — see text rules below

${MC_BALANCE_RULES}

Text question: present a realistic, APPLIED scenario where the student must make and justify a decision. Build it around a SINGLE concept applied to a believable situation, OR around TWO of the concepts together ONLY if they genuinely combine in one realistic decision — never force unrelated concepts together, and NEVER ask the student to "explain how these concepts relate" or to list everything they know. Rotate which concept(s) you feature. The rubric should describe the sound decision plus reasoning; treat it as a guide to a strong answer, NOT a checklist requiring every concept to be named.

All explanations: plain prose, no bold or markdown.

Respond with ONLY valid JSON, no markdown fences:
{
  "questions": [
    {
      "id": 1,
      "type": "mc",
      "question": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct": "B",
      "explanation": "Plain prose explanation."
    },
    {
      "id": ${mcCount + 1},
      "type": "text",
      "question": "[An applied scenario requiring a justified decision about one of the concepts (or two if they naturally combine)]",
      "rubric": "What a sound answer decides and why (a guide, not a required term checklist).",
      "explanation": "A strong answer would decide ... because ..."
    }
  ]
}`
}

// In-lecture "checkpoint" checks: one quick retrieval question per study-guide
// section, answered right after reading that section (testing effect). Consumed by
// app/api/session/checkpoints/route.ts. These are low-stakes practice — NOT the
// graded topic quiz — so they stay simpler and shorter than exam questions.
// Scope is locked to each section's own text (same rule as every quiz generator).
export function buildCheckpointsPrompt(guideContent: string, topicName: string): string {
  return `TOPIC: ${topicName}

Below is a study guide split into "### " sections. For EACH content section, write ONE quick "checkpoint" question the student answers immediately after reading that section — just enough to confirm they caught its key idea.

Rules:
- One question per "### " section, in the order the sections appear. SKIP the "### Recap" and "### Exam flags" sections entirely (no question for either — they are summaries, not new material). The framing intro before the first "### " is not a section either — ignore it.
- SCOPE LOCK: each question tests ONLY what its own section states. Never use facts from another section, and never introduce any term, technology, or concept not written in that section.
- ANSWERABLE FROM THE SECTION ALONE: a fully-correct answer must be constructible using ONLY sentences written in this section. Before you write a question, check its model answer/rubric — every fact it expects must appear verbatim-in-substance in the section text. Do NOT ask a question whose correct answer depends on an unstated premise, an implied contrast, or outside knowledge. In particular, if the section explains something by comparison (e.g. "X does what Y cannot"), only ask about the compared thing (Y) if the section actually states the relevant fact about Y; otherwise ask only about what the section explicitly says. If you cannot form a question the section fully answers, ask a simpler recall question that it does — never reach beyond the text to make the question harder.
- Pick the type per section: "mc" for a concrete fact/definition/recognition check; "text" for a section whose point is conceptual (a why/how/when-to-use). Aim for a genuine MIX across the guide, not all one type.
- Keep checkpoints QUICK — a plain recall/understanding check, shorter and simpler than an exam question. No tricky multi-clause scenarios.
- For "mc": exactly 4 options A–D, all within ±15 words of each other; the correct answer must NOT be the longest. Distractors plausible, no throwaways.
- For "text": ask the student to state or apply the section's key idea in 1–2 sentences. Put what a sound answer says in "rubric" (a guide, not a checklist of required words).
- "section" must be the section's heading text copied EXACTLY, without the leading "### ".
- Plain prose in every field. No markdown, no bold.
- Keep every explanation to 1–2 sentences. Brevity is mandatory — long output is truncated mid-JSON and generation fails.

Respond with ONLY valid JSON, no markdown fences:
{
  "checkpoints": [
    { "section": "<heading text>", "type": "mc", "question": "...", "options": { "A": "...", "B": "...", "C": "...", "D": "..." }, "correct": "B", "explanation": "Plain prose, 1-2 sentences." },
    { "section": "<heading text>", "type": "text", "question": "...", "rubric": "What a sound answer states.", "explanation": "Plain prose, 1-2 sentences." }
  ]
}

STUDY GUIDE:
${guideContent}`
}

// Spaced-repetition review quiz: a short retrieval check on a topic the student
// passed earlier, scope-locked to that topic's transcript. Consumed by
// app/api/review/quiz/route.ts. Pitched at recall/recognition (the point is to
// refresh memory), a notch lighter than the graded topic quiz.
export function buildReviewQuizPrompt(topicName: string, domain: number, transcript: string): string {
  return `Generate a short spaced-repetition REVIEW quiz for a student refreshing a topic they studied earlier: "${topicName}" (Domain ${domain}, CompTIA Security+ SY0-701).

═══════════════════════════════════════
CONTENT RULE — STRICT SCOPE LOCK
═══════════════════════════════════════
The lecture transcript below is the ONLY source of testable material.
- Test ONLY concepts, technologies, terms, and techniques that explicitly appear in the transcript. If it is not in the transcript, it does not exist for this quiz.
- Do NOT introduce outside knowledge — no products, acronyms, procedures, or attack/control names absent from the transcript, even if real and exam-relevant.
- This applies to the correct answer AND the distractors AND the explanations.
- Stay at SY0-701 exam depth; no vendor-specific or implementation-level minutiae.

Quiz structure:
- 4 multiple-choice questions (type "mc")
- 1 free-text question (type "text"), placed last
- Cover the most important DISTINCT points of the topic; do not test the same point twice.

This is a REVIEW, so favor the core ideas the student most needs to retain for the exam. Keep MC stems scenario-flavored but not tricky; the goal is reliable recall, not trap-spotting.

${MC_BALANCE_RULES}

Text question: a realistic APPLIED scenario where the student makes and justifies a decision about a core concept of this topic — do NOT ask them to "define" or "explain" it. The rubric describes what a sound decision plus reasoning looks like (a guide, not a checklist of required terms).
All explanations: plain prose, no bold or markdown.

Respond with ONLY valid JSON, no markdown fences:
{
  "questions": [
    { "id": 1, "type": "mc", "question": "...", "options": { "A": "...", "B": "...", "C": "...", "D": "..." }, "correct": "B", "explanation": "Plain prose." },
    { "id": 5, "type": "text", "question": "An applied scenario requiring a justified decision...", "rubric": "What a sound answer decides and why.", "explanation": "A strong answer would decide ... because ..." }
  ]
}

TRANSCRIPT (only test from this content):
${transcript}`
}

// Optional "Need a refresher?" recap for a review — a tight TL;DR from the topic's
// transcript, scope-locked. Consumed by app/api/review/refresher/route.ts (Haiku).
export function buildRefresherPrompt(topicName: string, transcript: string): string {
  return `The student is reviewing "${topicName}" (CompTIA Security+ SY0-701) and wants a quick memory refresher before a recall quiz.

Write a tight recap as 4–6 one-line bullets capturing ONLY the must-remember points from the transcript below. Bold the key term in each bullet. No preamble, no heading, no closing line — just the bullets. Use ONLY content present in the transcript; do not add outside facts. Keep it scannable and under 120 words.

TRANSCRIPT:
${transcript}`
}

export function buildDomainFinalQuizPrompt(
  domain: number,
  domainName: string,
  topics: string[],
  count = 20
): string {
  return `Generate a ${count}-question quiz for CompTIA Security+ SY0-701 Domain ${domain}: ${domainName}.

Topics to cover proportionally:
${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Requirements:
- Distribute questions across all topics above — no topic over-represented
- CompTIA-style: scenario-based, "which is BEST", "which is NOT", application questions
- 4 choices each (A, B, C, D)
- Mix of difficulty (easy/medium/hard)
- Plausible wrong answers that test real understanding
- Plain prose explanations, no bold or markdown

Respond with ONLY valid JSON, no markdown fences:
{
  "questions": [
    {
      "id": 1,
      "type": "mc",
      "question": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct": "B",
      "explanation": "Plain prose explanation."
    }
  ]
}`
}

export function buildWeakAreaPrompt(
  wrongQuestions: { question: string; userAnswer: string; correct: string; explanation: string }[],
  topicName: string,
  existingConcepts: string[] = []
): string {
  const existingBlock = existingConcepts.length > 0
    ? `\nThe student already has these concepts flagged as weak areas:
${existingConcepts.map((c) => `- ${c}`).join('\n')}

CRITICAL — avoid overlap: If a concept you would flag is the same idea as one already listed above (even if you'd word it differently, e.g. "unpatched CVE risk" vs "unpatched vulnerability risk"), DO NOT create a new entry — reuse the EXACT existing string verbatim so it merges instead of duplicating. Only output a new phrase when the concept is genuinely distinct from every existing one. Never output two items in your own response that are near-duplicates of each other.\n`
    : ''

  return `A Security+ student got these questions wrong on a quiz about ${topicName}:

${wrongQuestions.map((q, i) => `Q${i + 1}: ${q.question}
Their answer: ${q.userAnswer}
Correct: ${q.correct}
Explanation: ${q.explanation}`).join('\n\n')}
${existingBlock}
Identify the specific concepts (not broad topics) this student is weak on.
Each concept should be a short specific phrase like "asymmetric vs symmetric key differences" or "AAA authentication order".

Respond with ONLY a JSON array of strings. Max 5 items. Example:
["concept one", "concept two"]`
}
