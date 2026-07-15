import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildWeakAreaQuizPrompt } from '@/lib/prompts'
import { getWeakAreasByIds } from '@/lib/db'
import { balanceQuizAnswers, enforceMCLengthParity } from '@/lib/quiz'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function getMcCount(wrongCount: number): number {
  if (wrongCount >= 4) return 5
  if (wrongCount >= 2) return 3
  return 1
}

// Hard cap on MC questions per weak-area quiz. A grouped session passes every
// flagged concept of a topic at once, so without a cap mcCount grows with the
// group (1 MC/concept) and generation blows past Vercel's 60s limit or gets
// truncated mid-JSON — the quiz then never loads. A 9-concept group still timed
// out at 6, so the cap is 5 (=6 questions with the text item) and the prompt
// enforces brevity. Keep MAX_MC in sync with weak-area-session/page.tsx.
const MAX_MC = 5

export async function POST(req: NextRequest) {
  try {
    const { weakAreaIds } = await req.json()
    const ids: number[] = Array.isArray(weakAreaIds) ? weakAreaIds : [weakAreaIds]
    const areas = await getWeakAreasByIds(ids)
    if (areas.length === 0) return NextResponse.json({ error: 'Weak areas not found' }, { status: 404 })

    const concepts = areas.map((a) => a.concept)
    const { topic_name, domain } = areas[0]
    const maxWrongCount = Math.max(...areas.map((a) => a.wrong_count))
    // At least 1 MC per concept and scaled by how badly missed, but capped so the
    // quiz (mcCount MC + 1 text) stays within the token/time budget below.
    const mcCount = Math.min(MAX_MC, Math.max(concepts.length, getMcCount(maxWrongCount)))

    const prompt = buildWeakAreaQuizPrompt(concepts, topic_name, domain, mcCount)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      // Bounded so generation finishes under Vercel's 60s function limit and the
      // JSON is never truncated mid-object. Matches the topic quiz route's budget.
      max_tokens: 2800,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean)
    await enforceMCLengthParity(parsed.questions)
    balanceQuizAnswers(parsed.questions)
    return NextResponse.json({ ...parsed, mcCount })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
