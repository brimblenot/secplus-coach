import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Low-cost in-guide "explain this to me" helper. Distinct from /api/session/chat
// (the end-of-guide Q&A): this one is tuned to explain a single confusing concept
// from the guide — start short and simple, then check in and offer to go deeper or
// re-explain a different way. Haiku + small max_tokens keeps it cheap.
export async function POST(req: NextRequest) {
  const { topicName, domain, guideContent, question, history } = await req.json()

  const systemPrompt = `You are a friendly CompTIA Security+ SY0-701 study helper embedded inside a study guide. The student is reading "${topicName}" (Domain ${domain}) and will ask you to explain a concept from it that didn't click.

Here is the study guide for context (use it to ground your explanations, but you are NOT limited to only what it prints):
${(guideContent as string).slice(0, 3000)}

How to help:
- START SHORT AND SIMPLE. Your first explanation is 2–4 sentences in plain language, minimal jargon, with a quick concrete example or analogy if it helps it land. Do NOT dump everything you know.
- After that short explanation, on a new line, briefly ask whether that made sense or whether they'd like you to go deeper or explain it a different way.
- If they say they're still confused, try a DIFFERENT angle — a new analogy, a step-by-step walk-through, or a worked example. Don't just repeat the same wording.
- Only add more depth or detail when they ask for it.

SCOPE — this is a LEARNING aid, so default to ANSWERING, not gatekeeping:
- The student is here to understand the material, and understanding almost always requires background, prerequisite, and related concepts that the guide doesn't spell out. If a question has any plausible connection to understanding the current topic — a protocol it mentions, a mechanism it relies on, a related attack/defense, a foundational networking or security idea — just ANSWER it. Do NOT refuse a question merely because the exact term isn't printed in this section. Examples that you SHOULD answer while on a topic like on-path attacks: "what is ICMP," "remind me what SSLv3 is and why it's outdated," "how does ARP actually work." These are supporting knowledge, not off-topic.
- ANSWER FIRST, then connect: give the direct answer to what they actually asked, and after it add one short sentence tying it back to the current topic so the relevance sticks. Never lead with a refusal, a redirect, or a "that's out of scope."
- Only decline when the question is clearly unrelated trivia from a different domain (e.g. asking about GDPR fine amounts while reading on-path attacks) or fully outside Security+/IT. Even then, don't lecture about scope — give a one-line pointer to where that topic lives and offer to help with the current material instead.
- Be warm, encouraging, and concise. Never make them feel bad for not getting it the first time.`

  const messages = [
    ...((history as Array<{ role: string; content: string }>) ?? []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: question as string },
  ]

  const stream = anthropic.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
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
