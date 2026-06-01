import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { ALL_TOPICS } from '@/lib/db'
import { getTranscript } from '@/lib/transcripts'

// Per-topic transcript cap for domain quizzes — keeps the combined lecture
// payload manageable while still covering each topic enough to scope questions.
const PER_TOPIC_CHARS = 4000

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DOMAIN_NAMES: Record<number, string> = {
  1: 'General Security Concepts',
  2: 'Threats, Vulnerabilities & Mitigations',
  3: 'Security Architecture',
  4: 'Security Operations',
  5: 'Security Program Management',
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are generating a CompTIA Security+ SY0-701 domain mastery quiz.

Model every question on the real CompTIA SY0-701 exam format:
- Performance-based and scenario-based wording ("A security analyst discovers...", "Which of the following BEST...")
- Application-level questions — test concepts in realistic job contexts, not just definitions
- Use CompTIA's exact phrasing patterns: "which is MOST appropriate", "which is LEAST likely", "which BEST describes", "which should be done FIRST"
- Plausible distractors that represent common misconceptions or near-correct alternatives
- Mix: recall (20%), comprehension (40%), application (40%)
- No trick questions — every correct answer is clearly defensible

STRICT SCOPE LOCK:
- The lecture transcripts provided in the user message are the ONLY source of testable material. Test ONLY concepts, technologies, terms, and techniques that actually appear in those transcripts.
- Do NOT introduce outside knowledge — no products, acronyms, procedures, attack/control names, or details absent from the transcripts, even if they are real and exam-relevant SY0-701 topics. The student was only taught what is in these lectures, so testing anything else is unfair. This applies to the correct answer, the distractors, and the explanations.
- Stay at the depth the transcripts actually teach. Do NOT require vendor-specific products, implementation-level minutiae, or knowledge beyond what the lectures cover.
- If a topic's transcript is thin, ask fewer questions on it rather than inventing detail.

Quiz structure — exactly 20 questions total:
- 17 multiple-choice questions (type "mc"): 4 choices (A, B, C, D)
- 3 free-text questions (type "text") at positions 5, 10, and 17: ask the student to explain or apply a concept in their own words; include a rubric field with 2-3 key points
- Distribute MC questions proportionally across all listed topics
- Plain prose explanations — no bold or markdown inside any field

Respond with ONLY valid JSON, no markdown fences:
{
  "questions": [
    {
      "id": 1,
      "type": "mc",
      "question": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct": "B",
      "explanation": "Plain prose explanation."
    },
    {
      "id": 5,
      "type": "text",
      "question": "In your own words, explain...",
      "rubric": "Key points to cover: 1) ... 2) ... 3) ...",
      "explanation": "A complete answer would mention..."
    }
  ]
}`

export async function POST(req: NextRequest) {
  try {
    const { domain } = await req.json()
    const domainNum = parseInt(domain)
    const domainTopics = ALL_TOPICS.filter((t) => t.domain === domainNum)

    // Feed the actual lecture transcripts so the quiz is scoped to what the
    // student was taught, not to general CompTIA knowledge.
    const lectureContent = domainTopics
      .map((t, i) => {
        const transcript = getTranscript(t.id).slice(0, PER_TOPIC_CHARS)
        return `### Topic ${i + 1}: ${t.name}\n${transcript}`
      })
      .join('\n\n')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 9000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `Generate 20 questions for Domain ${domainNum}: ${DOMAIN_NAMES[domainNum]}.

Distribute 17 MC + 3 text (text at positions 5, 10, 17) proportionally across these ${domainTopics.length} topics. Test ONLY content found in the lecture transcripts below.

LECTURE TRANSCRIPTS (the ONLY allowed source):
${lectureContent}`,
          cache_control: { type: 'ephemeral' },
        }],
      }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean)

    return NextResponse.json(parsed)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
