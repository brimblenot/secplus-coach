import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildRefresherPrompt } from '@/lib/prompts'
import { getTopic } from '@/lib/db'
import { getTranscript } from '@/lib/transcripts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PER_TOPIC_CHARS = 6000

// Optional "Need a refresher?" recap shown before a review quiz — a tight TL;DR.
// Haiku: cheap and fast, well under the 60s limit.
export async function POST(req: NextRequest) {
  try {
    const { topicId } = await req.json()
    const topic = await getTopic(topicId)
    if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

    const transcript = getTranscript(topicId).slice(0, PER_TOPIC_CHARS)

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: buildRefresherPrompt(topic.topic_name, transcript) }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    return NextResponse.json({ recap: text.trim() })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
