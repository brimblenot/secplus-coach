import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getTranscript } from '@/lib/transcripts'
import { getTopic, getWeakAreas, getCompletedCount, getAverageScore, updateTopicStatus } from '@/lib/db'
import { STUDY_GUIDE_SYSTEM_PROMPT } from '@/lib/prompts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Stable system prompt (shared from lib/prompts.ts) — cached across all topic calls
// within the 5-min TTL window. Per-request student status + transcript go in the
// user message below.
const SYSTEM_PROMPT = STUDY_GUIDE_SYSTEM_PROMPT

export async function POST(req: NextRequest) {
  try {
    const { topicId } = await req.json()
    const topic = await getTopic(topicId)
    if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

    const [transcript, weakAreas, completedTopics, avgScore] = await Promise.all([
      Promise.resolve(getTranscript(topicId)),
      getWeakAreas(),
      getCompletedCount(),
      getAverageScore(),
    ])

    await updateTopicStatus(topicId, 'studying')

    // Non-streaming: the client buffers the whole guide before displaying it
    // anyway, so streaming bought no UX — but an error thrown mid-stream could
    // not be caught here, surfacing to the user as a generic "failed to load".
    // Buffering server-side keeps any Anthropic error inside this try/catch so
    // we can return a clean 500 with the real message.
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      // Headroom above the ~700–900 word target (now denser, since every term is
      // glossed) so the guide completes its final section instead of being cut off
      // at the cap (~40–45s end to end, comfortably under the 60s function limit).
      max_tokens: 2800,
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
            text: `STUDENT STATUS:
- Topics completed: ${completedTopics}/121
- Quiz average: ${avgScore !== null ? avgScore + '%' : 'none yet'}
- Active weak areas: ${weakAreas.length > 0 ? weakAreas.map((w) => w.concept).join(', ') : 'none yet'}

CURRENT TOPIC: ${topic.topic_name} (ID: ${topicId}, Domain ${topic.domain})

TRANSCRIPT:`,
          },
          {
            type: 'text',
            text: transcript,
            cache_control: { type: 'ephemeral' },
          },
        ],
      }],
    })

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    if (!text.trim()) {
      return NextResponse.json({ error: 'Study guide came back empty' }, { status: 502 })
    }

    return new Response(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Topic-Name': encodeURIComponent(topic.topic_name),
        'X-Domain': String(topic.domain),
      },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
