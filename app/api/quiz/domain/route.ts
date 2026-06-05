import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { ALL_TOPICS } from '@/lib/db'
import { getTranscript } from '@/lib/transcripts'

// Per-topic transcript cap for MC batches — keeps each batch's combined lecture
// payload small so the call finishes well under the Vercel function timeout.
const PER_TOPIC_CHARS = 4000
// Text questions get a thinner per-topic slice across the whole domain; we only
// need 3 of them, so the input can stay light.
const TEXT_PER_TOPIC_CHARS = 1500
// MC questions per Claude call. Small batches keep each generation short so a
// single buffered response always completes inside maxDuration (Hobby = 60s).
const MC_PER_BATCH = 5

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

const SYSTEM_PROMPT = `You are generating CompTIA Security+ SY0-701 domain mastery quiz questions.

Model every question on the real CompTIA SY0-701 exam format:
- Performance-based and scenario-based wording ("A security analyst discovers...", "Which of the following BEST...")
- Application-level questions — test concepts in realistic job contexts, not just definitions
- Use CompTIA's exact phrasing patterns: "which is MOST appropriate", "which is LEAST likely", "which BEST describes", "which should be done FIRST"
- Plausible distractors that represent common misconceptions or near-correct alternatives
- Mix: recall (20%), comprehension (40%), application (40%)
- No trick questions — every correct answer is clearly defensible
- All four MC options must be within ±15 words of each other — the correct answer must NOT be the longest

STRICT SCOPE LOCK:
- The lecture transcripts provided in the user message are the ONLY source of testable material. Test ONLY concepts, technologies, terms, and techniques that actually appear in those transcripts.
- Do NOT introduce outside knowledge — no products, acronyms, procedures, attack/control names, or details absent from the transcripts, even if they are real and exam-relevant SY0-701 topics. The student was only taught what is in these lectures, so testing anything else is unfair. This applies to the correct answer, the distractors, and the explanations.
- Stay at the depth the transcripts actually teach. Do NOT require vendor-specific products, implementation-level minutiae, or knowledge beyond what the lectures cover.
- Do NOT lift sentences verbatim from the transcripts — reframe every idea into a novel scenario.

Respond with ONLY valid JSON, no markdown fences. Plain prose in all fields — no bold or markdown inside any field.`

type Topic = (typeof ALL_TOPICS)[number]

interface MCQuestion {
  id: number
  type: 'mc'
  question: string
  options: Record<string, string>
  correct: string
  explanation: string
}

interface TextQuestion {
  id: number
  type: 'text'
  question: string
  rubric: string
  explanation: string
}

type Question = MCQuestion | TextQuestion

// Round-robin split so each batch covers a representative spread of topics
// (and a smaller transcript payload) rather than one contiguous block.
function splitTopics(topics: Topic[], batches: number): Topic[][] {
  const groups: Topic[][] = Array.from({ length: batches }, () => [])
  topics.forEach((t, i) => groups[i % batches].push(t))
  return groups.filter((g) => g.length > 0)
}

function buildLecture(topics: Topic[], perTopicChars: number): string {
  return topics
    .map((t, i) => `### Topic ${i + 1}: ${t.name}\n${getTranscript(t.id).slice(0, perTopicChars)}`)
    .join('\n\n')
}

function parseQuestions(text: string): unknown[] {
  const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(clean)
  return Array.isArray(parsed?.questions) ? parsed.questions : []
}

// Generate exactly `count` MC questions scoped to one slice of the domain's topics.
async function generateMCBatch(
  domainNum: number,
  topics: Topic[],
  count: number,
): Promise<unknown[]> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2800,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Generate exactly ${count} multiple-choice questions (type "mc") for Domain ${domainNum}: ${DOMAIN_NAMES[domainNum]}.

Distribute them across these ${topics.length} topics. Test ONLY content found in the lecture transcripts below.

Each question shape:
{ "type": "mc", "question": "...", "options": { "A": "...", "B": "...", "C": "...", "D": "..." }, "correct": "B", "explanation": "Plain prose." }

Respond with ONLY this JSON, no markdown fences:
{ "questions": [ ... ] }

LECTURE TRANSCRIPTS (the ONLY allowed source):
${buildLecture(topics, PER_TOPIC_CHARS)}`,
        cache_control: { type: 'ephemeral' },
      }],
    }],
  })
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
  return parseQuestions(text)
}

// Generate 3 free-text questions for the whole domain, scoped to a thin slice.
async function generateTextBatch(domainNum: number, topics: Topic[]): Promise<unknown[]> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Generate exactly 3 free-text questions (type "text") for Domain ${domainNum}: ${DOMAIN_NAMES[domainNum]}.

Each asks the student to explain or apply a concept in their own words, drawn from different topics. Test ONLY content found in the lecture transcripts below.

Each question shape:
{ "type": "text", "question": "In your own words, explain...", "rubric": "Key points to cover: 1) ... 2) ... 3) ...", "explanation": "A complete answer would mention..." }

Respond with ONLY this JSON, no markdown fences:
{ "questions": [ ... ] }

LECTURE TRANSCRIPTS (the ONLY allowed source):
${buildLecture(topics, TEXT_PER_TOPIC_CHARS)}`,
        cache_control: { type: 'ephemeral' },
      }],
    }],
  })
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
  return parseQuestions(text)
}

function isMC(q: unknown): q is MCQuestion {
  const o = q as Partial<MCQuestion>
  return !!o && o.type === 'mc' && !!o.options && !!o.correct && typeof o.question === 'string'
}

function isText(q: unknown): q is TextQuestion {
  const o = q as Partial<TextQuestion>
  return !!o && o.type === 'text' && typeof o.question === 'string'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const domainNum = parseInt(body.domain)
    // count = number of MC questions. Default 17 (mastery quiz = 17 MC + 3 text = 20).
    const mcCount: number = typeof body.count === 'number' ? body.count : 17
    // Text questions only for the mastery quiz; the random quiz page renders MC only.
    const includeText: boolean = body.includeText ?? mcCount === 17

    const domainTopics = ALL_TOPICS.filter((t) => t.domain === domainNum)
    if (domainTopics.length === 0) {
      return NextResponse.json({ error: `No topics for domain ${domainNum}` }, { status: 400 })
    }

    // Fan out MC generation into small parallel batches so each Claude call is
    // short enough to finish inside the function timeout.
    const numBatches = Math.ceil(mcCount / MC_PER_BATCH)
    const topicGroups = splitTopics(domainTopics, numBatches)
    let remaining = mcCount
    const mcJobs = topicGroups.map((group, i) => {
      // Spread the requested count across the groups we actually have.
      const groupsLeft = topicGroups.length - i
      const n = Math.ceil(remaining / groupsLeft)
      remaining -= n
      return generateMCBatch(domainNum, group, n)
    })

    const textJob = includeText
      ? generateTextBatch(domainNum, splitTopics(domainTopics, 3).flat())
      : null

    const results = await Promise.allSettled([...mcJobs, ...(textJob ? [textJob] : [])])

    const collected: unknown[][] = results
      .filter((r): r is PromiseFulfilledResult<unknown[]> => r.status === 'fulfilled')
      .map((r) => r.value)

    // The text batch (if any) is the last job; everything before it is MC.
    const textRaw = includeText && collected.length > 0 ? collected[collected.length - 1] : []
    const mcRaw = includeText ? collected.slice(0, -1).flat() : collected.flat()

    const mcQuestions = mcRaw.filter(isMC)
    const textQuestions = includeText ? textRaw.filter(isText) : []

    // Weave text questions into positions 5, 10, 17 (indices 4, 9, 16); MC fills the rest.
    const textPositions = [4, 9, 16]
    const assembled: Question[] = []
    const mcQueue = [...mcQuestions]
    const textQueue = [...textQuestions]
    const total = mcQuestions.length + textQuestions.length
    for (let i = 0; i < total; i++) {
      if (textPositions.includes(i) && textQueue.length > 0) {
        assembled.push(textQueue.shift() as TextQuestion)
      } else if (mcQueue.length > 0) {
        assembled.push(mcQueue.shift() as MCQuestion)
      } else if (textQueue.length > 0) {
        assembled.push(textQueue.shift() as TextQuestion)
      }
    }

    // Renumber ids sequentially and stamp the domain on every question (the random
    // quiz page groups/scores by question.domain).
    const questions = assembled.map((q, i) => ({ ...q, id: i + 1, domain: domainNum }))

    if (questions.length === 0) {
      return NextResponse.json({ error: 'Failed to generate any questions' }, { status: 500 })
    }

    return NextResponse.json({ questions })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
