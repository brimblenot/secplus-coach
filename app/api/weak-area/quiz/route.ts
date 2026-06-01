import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildWeakAreaQuizPrompt } from '@/lib/prompts'
import { getWeakAreasByIds } from '@/lib/db'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function getMcCount(wrongCount: number): number {
  if (wrongCount >= 4) return 5
  if (wrongCount >= 2) return 3
  return 1
}

export async function POST(req: NextRequest) {
  try {
    const { weakAreaIds } = await req.json()
    const ids: number[] = Array.isArray(weakAreaIds) ? weakAreaIds : [weakAreaIds]
    const areas = await getWeakAreasByIds(ids)
    if (areas.length === 0) return NextResponse.json({ error: 'Weak areas not found' }, { status: 404 })

    const concepts = areas.map((a) => a.concept)
    const { topic_name, domain } = areas[0]
    const maxWrongCount = Math.max(...areas.map((a) => a.wrong_count))
    // Cap MC count so we don't over-test: at least 1 per concept, not more than getMcCount allows
    const mcCount = Math.max(concepts.length, getMcCount(maxWrongCount))

    const prompt = buildWeakAreaQuizPrompt(concepts, topic_name, domain, mcCount)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean)
    return NextResponse.json({ ...parsed, mcCount })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
