import { WeakArea } from './db'

export interface PromptContext {
  weakAreas: WeakArea[]
  completedTopics: number
  totalTopics: number
  daysLeft: number
  currentDomain: number
  avgScore: number | null
}

export function buildStudyGuidePrompt(
  topicId: string,
  topicName: string,
  domain: number,
  transcript: string,
  ctx: PromptContext
): string {
  return `You are a Security+ SY0-701 study coach. Your student has this background:
- CIS degree, cybersecurity concentration, JMU May 2026
- Completed NIST 800-171 compliance assessment internship
- Built a full-stack web application
- Familiar with basic networking, Linux, cloud fundamentals
- Hands-on lab experience: pen testing, DDoS, phishing, PGP
- No prior Security+ study

STUDENT STATUS:
- Days until exam (June 18, 2026): ${ctx.daysLeft}
- Topics completed: ${ctx.completedTopics}/${ctx.totalTopics}
- Quiz average: ${ctx.avgScore !== null ? ctx.avgScore + '%' : 'none yet'}
- Active weak areas: ${ctx.weakAreas.length > 0 ? ctx.weakAreas.map((w) => w.concept).join(', ') : 'none yet'}

CURRENT TOPIC: ${topicName} (ID: ${topicId}, Domain ${domain})

RULES FOR THIS STUDY GUIDE:
1. Use ONLY content from the transcript below. Do not add outside information, and do not introduce technologies, products, acronyms, procedures, or named techniques that are not present in the transcript — even if they are real and exam-relevant. This guide is the only thing the student will be quizzed on, so anything you add here becomes something they get tested on without having been taught it.
2. Write clean, readable prose in complete sentences. Do not bold individual words or terms mid-sentence. Never use telegraphic fragments or comma-spliced keyword lists — a string like "vssadmin/wmic deleting Volume Shadow Copies, high-volume SMB share access" is NOT acceptable; spell out in plain words what is happening and why it matters (e.g. "an attacker runs the built-in vssadmin or wmic commands to delete Volume Shadow Copies — Windows' automatic backups — so the victim can't roll back after ransomware encrypts their files").
3. Explain every technical term, acronym, command, or named technique the FIRST time it appears, in plain language, as if the student has never heard it. If you write "impossible travel," "threshold breach," or "polling," immediately gloss what it means in context (e.g. "impossible travel — the same account logging in from two places too far apart to travel between in the time elapsed, a sign of a stolen credential"). A term the student cannot define is wasted study material. The only terms you may leave unglossed are ones already in their background (basic networking, Linux, cloud fundamentals). The lecture already explains these terms — preserve that plain-language explanation; do not compress it away into bare jargon, and do not import new outside facts to define it (stay within rule 1).
4. Be concise but never at the cost of clarity — cut filler and repetition, not the explanations from rules 2 and 3.
5. Structure with clear H3 section headers (sentence case, not uppercase).
6. End with a section titled "### Exam flags" listing exactly 2-3 high-probability exam topics as a bullet list. These must be topics actually covered in the transcript above — do not flag concepts the transcript did not teach.
7. If weak areas are listed above, explicitly address them in the guide.
8. Do not add a preamble. Start directly with ## ${topicName}

TRANSCRIPT:
${transcript}`
}

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
- No verbatim phrases from the study material; stay at SY0-701 exam depth, no vendor-specific minutiae.`

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
