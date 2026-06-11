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
  options?: Record<string, string>
  correct?: string
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
