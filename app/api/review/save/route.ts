import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildWeakAreaPrompt } from '@/lib/prompts'
import { scheduleReview, getTopic, getWeakAreas, upsertWeakArea } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface WrongQ { question: string; userAnswer: string; correct: string; explanation: string }

export async function POST(req: NextRequest) {
  try {
    const { topicId, passed, wrongQuestions } = await req.json()
    const topic = await getTopic(topicId)
    if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

    // Advance or reset the spaced-repetition schedule for this topic.
    await scheduleReview(topicId, !!passed)

    // A forgotten topic re-enters the weak-area loop so its specific gaps get drilled.
    let newWeakAreas: string[] = []
    const wrongQs: WrongQ[] = Array.isArray(wrongQuestions) ? wrongQuestions : []
    if (!passed && wrongQs.length > 0) {
      const existing = (await getWeakAreas(false))
        .filter((w) => w.domain === topic.domain)
        .map((w) => w.concept)
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          messages: [{ role: 'user', content: buildWeakAreaPrompt(wrongQs, topic.topic_name, existing) }],
        })
        const text = response.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('')
        const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
        newWeakAreas = JSON.parse(clean)
        for (const concept of newWeakAreas) {
          await upsertWeakArea(concept, topicId, topic.topic_name, topic.domain)
        }
      } catch (e) {
        console.error('Review weak-area analysis failed:', e)
      }
    }

    return NextResponse.json({ ok: true, passed: !!passed, newWeakAreas })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
