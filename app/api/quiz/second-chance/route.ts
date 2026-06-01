import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface WrongQuestion {
  question: string
  options: Record<string, string>
  correct: string
  explanation: string
}

export async function POST(req: NextRequest) {
  try {
    const { wrongQuestions, topicName }: { wrongQuestions: WrongQuestion[]; topicName: string } = await req.json()

    const prompt = `You are writing CompTIA Security+ SY0-701 second-chance questions for topic: ${topicName}.

For each missed question, write ONE new MC question on the same concept. The new question must be as hard as the original — follow all of these rules:

STYLE RULES (mandatory):
- Scenario-based stem: "A technician discovers...", "A company must ensure...", "After an audit reveals..."
- Use a decision qualifier: BEST, MOST likely, FIRST, PRIMARY reason
- All four options must be approximately equal length (±15 words). Never make the correct answer longer than the others.
- All three distractors must be plausible to someone with partial knowledge — no obviously wrong answers
- Do not reuse any phrasing, examples, or wording from the original question
- The correct answer position (A/B/C/D) must differ from the original question's correct answer
- Test application of the concept, not recognition of a definition
- SCOPE LOCK: Test the SAME concept as the original missed question and nothing beyond it. Do not introduce new technologies, products, acronyms, or techniques that were not part of the original question or its explanation. Stay at standard SY0-701 exam depth — no vendor-specific or implementation-level detail.

${wrongQuestions.map((q, i) => `--- Missed question ${i + 1} ---
Original question: ${q.question}
Correct answer was: ${q.correct}) ${q.options[q.correct]}
Concept explanation: ${q.explanation}`).join('\n\n')}

Respond with ONLY valid JSON, no markdown fences:
{
  "questions": [
    {
      "id": 1,
      "type": "mc",
      "question": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct": "B",
      "explanation": "Plain prose: why the correct answer is right, and why each distractor is wrong."
    }
  ]
}`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    return NextResponse.json(JSON.parse(clean))
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
