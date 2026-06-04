import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { question, history, context } = await req.json()

  const {
    daysLeft, effectiveDays, completedCount, totalTopics, courseProgress,
    avgScore, weakAreas, domainStats, topicsRemaining, goalPerDay, requiredPerDay,
    catchupToday, behind, planCompletedCount, planTopics, additionalCompleted,
  } = context
  const weakList = (weakAreas ?? []).map((w: { concept: string; wrong_count: number }) =>
    `${w.concept} (missed ${w.wrong_count}x)`
  ).join(', ') || 'none'

  const domainBreakdown = (domainStats ?? []).map((d: { domain: number; completed: number; total: number; avgScore: number | null }) =>
    `  Domain ${d.domain}: ${d.completed}/${d.total} complete${d.avgScore !== null ? `, avg ${d.avgScore}%` : ''}`
  ).join('\n')

  const planDoneToday = planCompletedCount ?? 0
  const planTotal = (planTopics ?? []).length
  const extraToday = (additionalCompleted ?? []).length

  const system = `You are a personal CompTIA Security+ SY0-701 study coach. Here is the student's live progress snapshot:

EXAM & TIME
- Exam date: June 18, 2026 (${daysLeft} calendar days away, ${effectiveDays} effective study days before 3-day buffer)

PROGRESS
- Topics complete: ${completedCount}/${totalTopics} (${courseProgress}%)
- Topics remaining: ${topicsRemaining}
- Quiz average: ${avgScore !== null ? avgScore + '%' : 'no data yet'}

PACE (topic-based — there is no time/minutes budget; only topic counts matter)
- Goal: ${goalPerDay} topics/day (the manageable steady pace)
- Catch-up is front-loaded into TODAY: do ${catchupToday} topics today, then ${goalPerDay}/day clears the rest by exam (with a 3-day buffer, ${effectiveDays} study days left).
- Status: ${behind ? `BEHIND — today's catch-up target is ${catchupToday} topics (more than the ${goalPerDay}/day goal). After today, ${goalPerDay}/day is enough.` : `on track — ${catchupToday} topics today keeps the ${goalPerDay}/day pace`}

TODAY
- Plan topics completed: ${planDoneToday}/${planTotal}
- Bonus topics completed beyond plan: ${extraToday}

WEAK AREAS
- ${weakList}

DOMAIN BREAKDOWN
${domainBreakdown}

Be direct and practical. Give honest assessments — if they're behind, say so. Reference specific numbers from the data when relevant. Keep responses focused and under 200 words unless they ask something that genuinely needs depth. You can discuss Security+ concepts if asked, but always tie back to exam readiness.`

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
