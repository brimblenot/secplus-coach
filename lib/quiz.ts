// Post-generation answer-position balancing.
//
// Claude tends to park the correct answer in the same slot (usually "B"). Each
// quiz route calls balanceQuizAnswers() on the parsed question list right before
// returning, so the correct option is spread evenly across A/B/C/D instead.
//
// This is pure CPU work on already-generated JSON — no extra model call — so it
// adds no measurable latency and never affects the Vercel function timeout. It
// runs once per quiz assembly (server-side), and the client stores the result
// for the whole attempt, so positions stay stable across re-renders.
//
// enforceMCLengthParity() (below) is the OTHER half of de-telling a quiz: it
// removes the "correct answer is the longest / most detailed one" tell that the
// generation prompts ask for but don't reliably get. It runs BEFORE
// balanceQuizAnswers() in each route (rewrite text first, then shuffle position).

import Anthropic from '@anthropic-ai/sdk'

// In-place Fisher-Yates shuffle.
function fisherYates<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

interface MCLike {
  type?: string
  question?: string
  options?: Record<string, string>
  correct?: string
}

function wordCount(s: string): number {
  return (s || '').trim().split(/\s+/).filter(Boolean).length
}

// Detects the "longest answer is correct" tell: the correct option is (tied for)
// the longest AND the longest option runs more than ~1.25× the words of the
// shortest. Under that ratio a student can pick the right answer by length/detail
// alone, so we flag it for a rewrite. The 1.25 threshold is deliberately tighter
// than the ~1.5 the prompts ask for — the prompt rule leaks, and the student
// reported still being able to spot the answer by detail. Also flags when the
// correct option is the longest by an absolute margin (≥4 words over the
// shortest) even if the ratio is under 1.25, since a few extra words of detail on
// an already-long option still reads as "the thorough one." Non-MC or malformed
// questions never flag.
function correctIsLengthOutlier(q: MCLike): boolean {
  if (q.type !== 'mc' || !q.options || !q.correct || !(q.correct in q.options)) return false
  const counts = Object.entries(q.options).map(([l, v]) => ({ l, n: wordCount(v) }))
  if (counts.length < 2) return false
  const correctN = wordCount(q.options[q.correct])
  const minN = Math.min(...counts.map((c) => c.n))
  const maxN = Math.max(...counts.map((c) => c.n))
  if (correctN !== maxN || minN === 0) return false
  return maxN > 1.25 * minN || maxN - minN >= 4
}

let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

// One bounded Haiku "editor" pass that rewrites the options of any MC question
// whose correct answer is a length outlier (see correctIsLengthOutlier) so all
// four options match in length and detail, WITHOUT changing which letter is
// correct or what each option means. Positions are still shuffled afterward by
// balanceQuizAnswers(). If nothing flags, no model call is made; if the call or
// parse fails, the original questions are returned untouched (fail-open, so a
// parity hiccup never blocks a quiz). Small max_tokens keeps it well under the
// 60s function budget. Mutates and returns the same array for call-site parity
// with balanceQuizAnswers().
export async function enforceMCLengthParity<Q extends MCLike>(questions: Q[]): Promise<Q[]> {
  if (!Array.isArray(questions)) return questions

  const flagged = questions
    .map((q, idx) => ({ idx, q }))
    .filter(({ q }) => q && correctIsLengthOutlier(q))
  if (flagged.length === 0) return questions

  try {
    const payload = flagged.map(({ idx, q }) => ({
      idx,
      question: q.question ?? '',
      correct: q.correct,
      options: q.options,
    }))

    const prompt = `You are editing CompTIA Security+ SY0-701 multiple-choice options to remove a length "tell". In each question below the CORRECT option is noticeably longer or more detailed than the distractors, which lets a student guess it by length alone.

For EACH question, rewrite ALL FOUR options so that:
- Every option is nearly identical in length and level of detail — the longest option must be no more than ~1.15× the words of the shortest, and ideally all four are within a few words of each other so they look the same at a glance.
- No single option is more specific, more technical, or more fully-explained than the others. If the correct answer currently spells out extra detail, trim it; if the distractors are terse, flesh them out to match — every option must carry the same amount of detail.
- The correct option must NOT be the longest or the most detailed one.
- Each letter keeps the SAME meaning it has now (letter A stays idea A, etc.) and the SAME letter stays correct. Do NOT change which answer is right, do NOT swap or merge options, do NOT introduce any new concept, technology, or term that is not already in that question's options.
- Plain prose, no markdown, SY0-701 exam depth.

Return ONLY valid JSON, no markdown fences:
{ "rewrites": [ { "idx": <number>, "options": { "A": "...", "B": "...", "C": "...", "D": "..." } } ] }

QUESTIONS:
${JSON.stringify(payload)}`

    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean)
    const rewrites: unknown[] = Array.isArray(parsed?.rewrites) ? parsed.rewrites : []

    for (const r of rewrites) {
      const rec = r as { idx?: number; options?: Record<string, string> }
      if (typeof rec.idx !== 'number') continue
      const target = questions[rec.idx]
      if (!target || target.type !== 'mc' || !target.options || !rec.options) continue
      // Only accept a rewrite that supplies every original letter as non-empty
      // text — otherwise keep the original so we never drop an option. The
      // correct letter is deliberately left as-is (meaning preserved per letter).
      const keys = Object.keys(target.options)
      if (keys.every((k) => typeof rec.options![k] === 'string' && rec.options![k].trim())) {
        target.options = keys.reduce((acc, k) => {
          acc[k] = rec.options![k]
          return acc
        }, {} as Record<string, string>)
      }
    }
  } catch (e) {
    console.error('MC length-parity pass failed (keeping originals):', e)
  }

  return questions
}

// Reorder each MC question's option values across its existing letter keys
// (A/B/C/D), repointing `correct` to the letter that now holds the right answer.
// Across the whole set the correct slot is distributed near-uniformly via a
// refilling shuffled "bag" of positions, so there's no clustering or long runs.
// Within each question the distractors are Fisher-Yates shuffled too.
//
// Only the option ordering and the `correct` reference change — question text,
// option text, explanations, and every field name are preserved untouched, and
// text-type questions are left exactly as-is.
export function balanceQuizAnswers<Q extends MCLike>(questions: Q[]): Q[] {
  if (!Array.isArray(questions)) return questions

  let bag: number[] = []
  const drawSlot = (slots: number): number => {
    if (bag.length === 0) bag = fisherYates(Array.from({ length: slots }, (_, i) => i))
    return bag.pop() as number
  }

  for (const q of questions) {
    if (!q || q.type !== 'mc' || !q.options || typeof q.options !== 'object') continue
    const letters = Object.keys(q.options)
    const correctLetter = q.correct
    if (letters.length < 2 || !correctLetter || !(correctLetter in q.options)) continue

    const correctValue = q.options[correctLetter]
    const distractors = fisherYates(
      letters.filter((l) => l !== correctLetter).map((l) => q.options![l])
    )

    // Balanced target slot for the correct answer. The bag keeps a standard
    // 4-option quiz perfectly spread; an odd option count (rare) falls back to
    // plain random so it can't corrupt the 4-slot bag.
    const target = letters.length === 4 ? drawSlot(4) : Math.floor(Math.random() * letters.length)

    let d = 0
    letters.forEach((letter, pos) => {
      q.options![letter] = pos === target ? correctValue : distractors[d++]
    })
    q.correct = letters[target]
  }
  return questions
}
