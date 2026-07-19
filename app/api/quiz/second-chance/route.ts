import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { balanceQuizAnswers, enforceMCLengthParity } from '@/lib/quiz'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface WrongQuestion {
  type?: 'mc' | 'text'
  question: string
  options?: Record<string, string>
  correct?: string
  rubric?: string
  explanation: string
}

export async function POST(req: NextRequest) {
  try {
    const { wrongQuestions, topicName }: { wrongQuestions: WrongQuestion[]; topicName: string } = await req.json()

    const prompt = `You are writing CompTIA Security+ SY0-701 second-chance (makeup) questions for topic: ${topicName}.

For each missed question below, write ONE new question on the SAME concept, with the SAME type as the original:
- If the original type is "mc", write a new multiple-choice question.
- If the original type is "text", write a new free-text (written response) question with a rubric.
The new question must be as hard as the original — follow all of these rules:

STYLE RULES (mandatory):
- Scenario-based stem: "A technician discovers...", "A company must ensure...", "After an audit reveals..."
- Use a decision qualifier where natural: BEST, MOST likely, FIRST, PRIMARY reason
- For MC: all four options must be nearly identical in length and detail — within a few words of each other (the longest no more than ~1.15× the words of the shortest), carrying the same specificity. Never make the correct answer the longest or most detailed; no option may spell out more than the rest, so the answer cannot be spotted by picking the most thorough option. All three distractors must be plausible to someone with partial knowledge — no obviously wrong answers. The correct answer position (A/B/C/D) must differ from the original question's correct answer.
- For text: ask the student to APPLY or ANALYZE the concept (not just define it). Include a rubric listing 2-3 key points a complete answer must cover.
- Do not reuse any phrasing, examples, or wording from the original question
- Test application of the concept, not recognition of a definition
- SCOPE LOCK: Test the SAME concept as the original missed question and nothing beyond it. Do not introduce new technologies, products, acronyms, or techniques that were not part of the original question or its explanation. Stay at standard SY0-701 exam depth — no vendor-specific or implementation-level detail.

${wrongQuestions.map((q, i) => `--- Missed question ${i + 1} (type: ${q.type ?? 'mc'}) ---
Original question: ${q.question}
${q.type === 'text'
  ? `Rubric / model points: ${q.rubric ?? ''}`
  : `Correct answer was: ${q.correct}) ${q.options?.[q.correct ?? ''] ?? ''}`}
Concept explanation: ${q.explanation}`).join('\n\n')}

Output EXACTLY one new question per missed question, in the same order, with the SAME type as its original.

Respond with ONLY valid JSON, no markdown fences. MC questions use this shape:
{ "id": 1, "type": "mc", "question": "...", "options": { "A": "...", "B": "...", "C": "...", "D": "..." }, "correct": "B", "explanation": "Plain prose: why the correct answer is right, and why each distractor is wrong." }
Text questions use this shape:
{ "id": 2, "type": "text", "question": "In a scenario where..., explain how you would...", "rubric": "Key points: 1) ... 2) ... 3) ...", "explanation": "A complete answer would mention..." }

Wrap them as:
{ "questions": [ ... ] }`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean)
    await enforceMCLengthParity(parsed.questions)
    balanceQuizAnswers(parsed.questions)
    return NextResponse.json(parsed)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
