import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { question, history, context } = await req.json()

  const {
    completedCount, totalTopics, courseProgress,
    avgScore, weakAreas, domainStats, topicsRemaining, completedTodayTopics,
  } = context
  const weakList = (weakAreas ?? []).map((w: { concept: string; wrong_count: number }) =>
    `${w.concept} (missed ${w.wrong_count}x)`
  ).join(', ') || 'none'

  const domainBreakdown = (domainStats ?? []).map((d: { domain: number; completed: number; total: number; avgScore: number | null }) =>
    `  Domain ${d.domain}: ${d.completed}/${d.total} complete${d.avgScore !== null ? `, avg ${d.avgScore}%` : ''}`
  ).join('\n')

  const doneToday = (completedTodayTopics ?? []).length

  const system = `You are a personal CompTIA Security+ SY0-701 study coach. Here is the student's live progress snapshot:

PROGRESS
- Topics complete: ${completedCount}/${totalTopics} (${courseProgress}%)
- Topics remaining: ${topicsRemaining}
- Completed today: ${doneToday}
- Quiz average: ${avgScore !== null ? avgScore + '%' : 'no data yet'}

PACING
- The student studies SELF-PACED — there is no exam date, no daily topic quota, and no "behind" status. Do NOT pressure them with catch-up targets, deadlines, or daily quotas, and do not invent a required topics/day number. If they ask whether they're on track, reason about topics remaining and weak areas, but frame it calmly and let them set the pace.

WEAK AREAS
- ${weakList}

DOMAIN BREAKDOWN
${domainBreakdown}

Be direct, practical, and encouraging. Reference specific numbers from the data when relevant. Keep responses focused and under 200 words unless they ask something that genuinely needs depth. You can discuss Security+ concepts if asked, but always tie back to exam readiness.`

  const messages = [
    ...((history ?? []) as Array<{ role: string; content: string }>).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: question as string },
  ]

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system,
    messages,
  })

  const readable = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          controller.enqueue(enc.encode(chunk.delta.text))
        }
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
