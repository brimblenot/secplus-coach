import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildWeakAreaGuidePrompt } from '@/lib/prompts'
import { getWeakAreasByIds } from '@/lib/db'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { weakAreaIds } = await req.json()
    const ids: number[] = Array.isArray(weakAreaIds) ? weakAreaIds : [weakAreaIds]
    const areas = await getWeakAreasByIds(ids)
    if (areas.length === 0) return NextResponse.json({ error: 'Weak areas not found' }, { status: 404 })

    const concepts = areas.map((a) => a.concept)
    const { topic_name, domain } = areas[0]
    const prompt = buildWeakAreaGuidePrompt(concepts, topic_name, domain)

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
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
        'X-Topic-Name': encodeURIComponent(topic_name),
        'X-Domain': String(domain),
      },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
