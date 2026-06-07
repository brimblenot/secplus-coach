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

Grade for applied reasoning, not exhaustive recall. Pass the answer when the student reaches a correct decision/conclusion AND gives sound justification for it — even if they paraphrase or omit some points the rubric lists. Do NOT fail an answer merely for leaving out rubric terms when the core reasoning is correct. Penalize only vague, off-topic, or genuinely incorrect reasoning.

Respond ONLY with valid JSON (no markdown fences):
{"passed": true, "feedback": "Specific 1-2 sentence feedback mentioning what they got right or what they missed."}`,
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
