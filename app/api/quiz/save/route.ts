import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildWeakAreaPrompt } from '@/lib/prompts'
import { saveQuizAttempt, updateTopicStatus, upsertWeakArea, getTopic } from '@/lib/db'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { topicId, score, questions, wrongIndices, userAnswers, weakAreaIndices } = await req.json()
    const topic = await getTopic(topicId)
    if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

    await saveQuizAttempt(topicId, score, questions, wrongIndices)
    const passed = score >= 70
    await updateTopicStatus(topicId, passed ? 'passed' : 'failed', score)

    // weakAreaIndices: subset of wrongIndices that also failed the second-chance question.
    // Falls back to wrongIndices when no second-chance was attempted.
    const indicesToFlag: number[] = weakAreaIndices ?? wrongIndices

    let newWeakAreas: string[] = []
    if (indicesToFlag.length > 0) {
      const wrongQs = indicesToFlag.map((i: number) => ({
        question: questions[i].question,
        userAnswer: userAnswers[i] || '?',
        correct: questions[i].correct,
        explanation: questions[i].explanation,
      }))
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: buildWeakAreaPrompt(wrongQs, topic.topic_name) }],
        })
        const text = response.content.filter((b) => b.type === 'text').map((b) => (b as {type:'text';text:string}).text).join('')
        const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
        newWeakAreas = JSON.parse(clean)
        for (const concept of newWeakAreas) {
          await upsertWeakArea(concept, topicId, topic.topic_name, topic.domain)
        }
      } catch (e) {
        console.error('Weak area analysis failed:', e)
      }
    }

    return NextResponse.json({ passed, score, newWeakAreas, requiresRetake: !passed })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
