import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { topicName, domain, guideContent, question, history } = await req.json()

  const systemPrompt = `You are a CompTIA Security+ SY0-701 study tutor. The student is currently studying "${topicName}" (Domain ${domain}).

Here is the study guide for context:
${(guideContent as string).slice(0, 3000)}

Answer questions clearly and concisely. Focus on exam-relevant understanding. Clarify anything confusing. Keep responses under 200 words unless the question genuinely needs more depth.`

  const messages = [
    ...((history as Array<{ role: string; content: string }>) ?? []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: question as string },
  ]

  const stream = anthropic.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: systemPrompt,
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
