import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildReviewQuizPrompt } from '@/lib/prompts'
import { getTopic } from '@/lib/db'
import { getTranscript } from '@/lib/transcripts'
import { balanceQuizAnswers } from '@/lib/quiz'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Cap transcript size for review quizzes — a 4+1 question recall check doesn't need
// the full lecture, and a smaller payload keeps generation comfortably under 60s.
const PER_TOPIC_CHARS = 5000

export async function POST(req: NextRequest) {
  try {
    const { topicId } = await req.json()
    const topic = await getTopic(topicId)
    if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

    const transcript = getTranscript(topicId).slice(0, PER_TOPIC_CHARS)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      // Bounded to finish well under Vercel's 60s limit; 5 concise questions fit.
      max_tokens: 2800,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildReviewQuizPrompt(topic.topic_name, topic.domain, transcript), cache_control: { type: 'ephemeral' } },
        ],
      }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean)
    balanceQuizAnswers(parsed.questions)
    return NextResponse.json(parsed)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
