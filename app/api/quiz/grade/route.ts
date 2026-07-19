import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { question, correctAnswer, explanation, userText } = await req.json()

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 250,
      messages: [{
        role: 'user',
        content: `Grade this Security+ student's written answer for conceptual understanding.

Question: ${question}
Rubric (a GUIDE to a strong answer, not a checklist): ${correctAnswer}
Explanation: ${explanation}

Student wrote: "${userText}"

Grade for applied reasoning, not exhaustive recall. Pass the answer when the student reaches the correct decision/conclusion AND gives a sound CORE justification for it — even if they paraphrase, omit some points the rubric lists, or get a secondary/peripheral detail wrong. Do NOT fail an answer merely for leaving out rubric terms when the core reasoning is correct.

SCOPE — grade ONLY against the rubric and explanation above. Do NOT import outside knowledge or a more advanced/exact version of the topic to find fault: if a fact is not part of the rubric or explanation, a student is neither required to know it nor penalized for stating it imperfectly. The student was taught at standard SY0-701 depth, not specialist depth.

CORE vs PERIPHERAL — decide the answer on its main claim, not its weakest side claim. If the decision is right and the primary reason is sound, a wrong or fuzzy secondary detail does NOT fail the answer — note it in the feedback instead. Fail ONLY when the decision itself is wrong, the CENTRAL justification is unsound, or the answer is vague/off-topic.

Respond ONLY with valid JSON (no markdown fences):
{"passed": true, "feedback": "Specific 1-2 sentence feedback: what they got right, and gently correct any peripheral slip without failing them for it."}`,
      }],
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
