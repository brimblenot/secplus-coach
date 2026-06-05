import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getTranscript } from '@/lib/transcripts'
import { getTopic, getWeakAreas, getDaysUntilExam, getCompletedCount, getAverageScore, updateTopicStatus } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
3. Be concise — student reads fast, no hand-holding needed. Keep the whole guide to about 600–800 words and ALWAYS finish every section, including the exam flags, within that length. Do not get cut off mid-section.
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

    // Non-streaming: the client buffers the whole guide before displaying it
    // anyway, so streaming bought no UX — but an error thrown mid-stream could
    // not be caught here, surfacing to the user as a generic "failed to load".
    // Buffering server-side keeps any Anthropic error inside this try/catch so
    // we can return a clean 500 with the real message.
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      // Headroom above the ~600–800 word target so the guide completes its final
      // section instead of being cut off at the cap (~35–40s end to end, well
      // under the 60s function limit).
      max_tokens: 2400,
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
- Days until exam (June 18, 2026): ${daysLeft}
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
