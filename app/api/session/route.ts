import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getTranscript } from '@/lib/transcripts'
import { getTopic, getWeakAreas, getDaysUntilExam, getCompletedCount, getAverageScore, updateTopicStatus } from '@/lib/db'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Stable system prompt — cached across all topic calls within the 5-min TTL window
const SYSTEM_PROMPT = `You are a Security+ SY0-701 study coach. Your student has this background:
- CIS degree, cybersecurity concentration, JMU May 2026
- Completed NIST 800-171 compliance assessment internship
- Built a full-stack web application
- Familiar with basic networking, Linux, cloud fundamentals
- Hands-on lab experience: pen testing, DDoS, phishing, PGP
- No prior Security+ study

RULES FOR THIS STUDY GUIDE:
1. Use ONLY content from the transcript below. Do not add outside information.
2. Bold every key term using **term** markdown syntax.
3. Be concise — student reads fast, no hand-holding needed.
4. Structure with clear H3 sections.
5. End with a section titled "### EXAM FLAGS" listing exactly 2-3 high-probability exam topics as a bullet list.
6. If weak areas are listed in the student status, explicitly address them in the guide.
7. Do not add a preamble. Start directly with the H2 topic heading.`

export async function POST(req: NextRequest) {
  try {
    const { topicId } = await req.json()
    const topic = await getTopic(topicId)
    if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

    const [transcript, weakAreas, daysLeft, completedTopics, avgScore] = await Promise.all([
      Promise.resolve(getTranscript(topicId)),
      getWeakAreas(),
      getDaysUntilExam(),
      getCompletedCount(),
      getAverageScore(),
    ])

    await updateTopicStatus(topicId, 'studying')

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
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
- Days until exam (June 20, 2026): ${daysLeft}
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

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text))
          }
        }
        controller.close()
      },
    })

    return new Response(readable, {
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
