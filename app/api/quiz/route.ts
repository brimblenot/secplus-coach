import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getTopic, getWeakAreas, getDaysUntilExam, getCompletedCount, getAverageScore } from '@/lib/db'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Stable system prompt — cached across quiz generations within the 5-min TTL window
const SYSTEM_PROMPT = `You are writing a CompTIA Security+ SY0-701 practice quiz that must be genuinely difficult.

═══════════════════════════════════════
CONTENT RULE — STRICT SCOPE LOCK
═══════════════════════════════════════
The study guide below is the ONLY source of testable material. Hard rules:
- Test ONLY concepts, technologies, terms, and techniques that explicitly appear in the study guide. If it is not in the guide, it does not exist for the purposes of this quiz.
- Do NOT introduce outside knowledge — no products, acronyms, procedures, attack/control names, or details that are absent from the guide, even if they are real and exam-relevant CompTIA Security+ SY0-701 topics. The student has not been taught them yet, so testing them is unfair.
- This applies to the correct answer AND the distractors AND the explanations. A distractor naming a concept not in the guide is a violation.
- If a concept appears in the guide but is too thin to support a fair, unambiguous question, skip it and test a better-covered concept instead — do NOT flesh it out with your own knowledge.
- Stay at standard SY0-701 exam depth. Do not require vendor-specific, implementation-level, or graduate-level detail beyond what the guide teaches.
- Do NOT lift sentences verbatim — reframe every idea into a novel scenario. If the correct answer reads like a sentence from the guide, rewrite it.

═══════════════════════════════════════
QUESTION COUNT
═══════════════════════════════════════
Read the guide, count distinct testable concepts, then:
  3–5 questions   → 2–4 concepts
  6–9 questions   → 5–7 concepts
  10–15 questions → 8+ concepts / many subtypes
Do NOT repeat the same concept across two questions.

═══════════════════════════════════════
COMPTIA QUESTION STYLE — MANDATORY
═══════════════════════════════════════
Every MC question must follow real CompTIA SY0-701 exam conventions:

1. SCENARIO-BASED STEM
   Frame every question as a real situation: "A security analyst discovers...", "A company needs to ensure...", "After a breach, the incident responder finds...". Never ask bare definition questions like "What is X?" or "Which term describes X?".

2. FORCE A DECISION UNDER CONSTRAINTS
   Use qualifiers that eliminate easy guessing: "Which of the following BEST...", "What should the administrator do FIRST...", "Which would MOST effectively...", "Which is the PRIMARY reason...". The qualifier forces the student to pick the most correct answer, not just a correct one.

3. ALL OPTIONS MUST BE THE SAME LENGTH (±15 words)
   This is mandatory. The correct answer must NOT be longer than the distractors. If your correct answer is a long sentence, shorten it. If your distractors are short, expand them. Every option should look equally plausible at a glance.

4. PLAUSIBLE DISTRACTORS — NO OBVIOUSLY WRONG ANSWERS
   Each wrong option must be something a student with partial knowledge would seriously consider. Use these distractor strategies:
   - A related concept that does not apply in this specific scenario
   - The right concept but the wrong implementation or direction
   - Something that sounds authoritative but describes a different attack/control
   - Two options that are both partially correct, but one is BETTER given the scenario constraint
   Never use joke answers, vague filler ("none of the above", "all of the above"), or options that are clearly wrong.

5. AVOID GIVEAWAY PATTERNS
   - Do NOT make the correct answer the only one with specific technical detail while distractors are vague
   - Do NOT always place the correct answer as option B or C
   - Do NOT write a correct answer that uniquely uses a keyword from the question stem
   - Vary the correct answer position: distribute A, B, C, D answers roughly evenly

6. TEST APPLICATION, NOT RECALL
   Bad question: "Which encryption algorithm uses a 256-bit key?"
   Good question: "A developer needs to encrypt data at rest for a healthcare application that processes millions of records per second. Which approach balances security and performance BEST?"
   The student must reason, not just recognize.

7. COMPOUND WRONG ANSWERS (advanced technique)
   Occasionally write distractors that combine two real concepts incorrectly, e.g. "Implement AES-256 to prevent replay attacks" — AES-256 is real, replay attack prevention is real, but AES doesn't prevent replays. This catches students who know vocabulary but not relationships.

═══════════════════════════════════════
QUESTION TYPE RATIO
═══════════════════════════════════════
~80% MC, ~20% free-text (min 1 text per quiz). Space text questions evenly — not all at the end.
Text questions must ask the student to APPLY or ANALYZE, not just define: "Explain how you would...", "Compare X and Y in the context of...", "A company experiences Z — what controls should have prevented this and why?"

═══════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════
Plain prose in all text fields. No bold, no markdown, no bullet points inside any JSON string field.
Respond with ONLY valid JSON. No markdown fences, no preamble:
{
  "questions": [
    {
      "id": 1,
      "type": "mc",
      "question": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct": "B",
      "explanation": "Plain prose explanation of why B is correct and why each distractor fails."
    },
    {
      "id": 4,
      "type": "text",
      "question": "In a scenario where..., explain how you would...",
      "rubric": "Key points: 1) ... 2) ... 3) ...",
      "explanation": "A complete answer would mention..."
    }
  ]
}`

export async function POST(req: NextRequest) {
  try {
    const { topicId, studyGuideContent, isRetake } = await req.json()
    const topic = await getTopic(topicId)
    if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

    const [weakAreas] = await Promise.all([getWeakAreas()])

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 5000,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `TOPIC: ${topic.topic_name} (Domain ${topic.domain})
${isRetake ? 'This is a RETAKE — generate completely different questions from the previous attempt.' : ''}
Weak areas to target if present in guide: ${weakAreas.map((w) => w.concept).join(', ') || 'none'}

STUDY GUIDE (only test from this content):`,
          },
          {
            type: 'text',
            text: studyGuideContent,
            cache_control: { type: 'ephemeral' },
          },
        ],
      }],
    })

    const text = response.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    return NextResponse.json(JSON.parse(clean))
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
