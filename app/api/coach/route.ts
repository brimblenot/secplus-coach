import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { question, history, context } = await req.json()

  const {
    completedCount, totalTopics, courseProgress,
    avgScore, weakAreas, domainStats, topicsRemaining, completedTodayTopics, pace,
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
- The student has set a target: finish all topics by ${pace?.finishTopicsBy ?? 'their finish date'} (${pace?.daysUntilFinish ?? '?'} days away) and take the exam on ${pace?.examDate ?? 'their exam date'} (${pace?.daysUntilExam ?? '?'} days away).
- To finish the ${topicsRemaining} remaining topics on time they need to average about ${pace?.perDay ?? '?'} topic(s)/day. Today they have done ${doneToday}${pace ? ` of ~${pace.perDay}` : ''}.
- They are currently ${pace?.onPace ? 'ON pace' : 'a bit BEHIND the pace'}${pace?.finishPastDue ? ' (the finish date is already past)' : ''}. Be honest about pace when asked, and give concrete catch-up math (topics/day, days left), but stay encouraging and practical — never guilt-trip.

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
