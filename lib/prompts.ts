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
- Days until exam (June 20, 2026): ${ctx.daysLeft}
- Topics completed: ${ctx.completedTopics}/${ctx.totalTopics}
- Quiz average: ${ctx.avgScore !== null ? ctx.avgScore + '%' : 'none yet'}
- Active weak areas: ${ctx.weakAreas.length > 0 ? ctx.weakAreas.map((w) => w.concept).join(', ') : 'none yet'}

CURRENT TOPIC: ${topicName} (ID: ${topicId}, Domain ${domain})

RULES FOR THIS STUDY GUIDE:
1. Use ONLY content from the transcript below. Do not add outside information, and do not introduce technologies, products, acronyms, procedures, or named techniques that are not present in the transcript — even if they are real and exam-relevant. This guide is the only thing the student will be quizzed on, so anything you add here becomes something they get tested on without having been taught it.
2. Write clean, readable prose. Do not bold individual words or terms mid-sentence.
3. Be concise — student reads fast, no hand-holding needed.
4. Structure with clear H3 section headers (sentence case, not uppercase).
5. End with a section titled "### Exam flags" listing exactly 2-3 high-probability exam topics as a bullet list. These must be topics actually covered in the transcript above — do not flag concepts the transcript did not teach.
6. If weak areas are listed above, explicitly address them in the guide.
7. Do not add a preamble. Start directly with ## ${topicName}

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

MC requirements: scenario-based, plausible distractors, directly test "${concept}" only.
Text question: ask the student to explain a key aspect of "${concept}" in their own words. Include a rubric field listing 2-3 key points the answer should cover.
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
- 1 free-text question (type "text") placed last — ask the student to explain how these ${concepts.length} concepts relate or work together in a real Security+ scenario; rubric must reference all ${concepts.length} concepts

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
      "question": "Explain how ${concepts.slice(0, 3).join(', ')}${concepts.length > 3 ? ' and the other related concepts' : ''} relate to each other in the context of Security+.",
      "rubric": "Key points: ${concepts.map((c, i) => `${i + 1}) [key point about ${c}]`).join(' ')}",
      "explanation": "A complete answer would mention..."
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
  topicName: string
): string {
  return `A Security+ student got these questions wrong on a quiz about ${topicName}:

${wrongQuestions.map((q, i) => `Q${i + 1}: ${q.question}
Their answer: ${q.userAnswer}
Correct: ${q.correct}
Explanation: ${q.explanation}`).join('\n\n')}

Identify the specific concepts (not broad topics) this student is weak on.
Each concept should be a short specific phrase like "asymmetric vs symmetric key differences" or "AAA authentication order".

Respond with ONLY a JSON array of strings. Max 5 items. Example:
["concept one", "concept two"]`
}
