import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildCheckpointsPrompt } from '@/lib/prompts'
import { balanceQuizAnswers, enforceMCLengthParity } from '@/lib/quiz'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Stable system prompt — cached across checkpoint generations within the 5-min TTL.
const SYSTEM_PROMPT = `You are a CompTIA Security+ SY0-701 study coach writing quick in-lecture comprehension checks. These are low-stakes retrieval practice the student answers section-by-section while reading — not the graded exam quiz — so keep them short and direct. You strictly obey the scope lock: a checkpoint may only test content written in its own section of the provided study guide.`

export async function POST(req: NextRequest) {
  try {
    const { guideContent, topicName } = await req.json()
    if (!guideContent || typeof guideContent !== 'string' || !guideContent.trim()) {
      return NextResponse.json({ error: 'Missing study guide content' }, { status: 400 })
    }

    const response = await anthropic.messages.create({
      // Haiku: these are light recall checks, not the scenario-heavy graded quiz.
      // Cheap and fast, keeping the request well under the 60s function limit.
      model: 'claude-haiku-4-5-20251001',
      // Bounded so generation finishes fast (~5 short questions ≈ well under budget).
      max_tokens: 2000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: buildCheckpointsPrompt(guideContent, topicName || 'this topic'),
      }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean)
    if (Array.isArray(parsed.checkpoints)) {
      await enforceMCLengthParity(parsed.checkpoints)
      balanceQuizAnswers(parsed.checkpoints)
    }
    return NextResponse.json(parsed)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
