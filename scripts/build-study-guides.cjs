// scripts/build-study-guides.cjs
// ONE-TIME / OFFLINE build of the study-guide + checkpoint data set. For every
// study topic it generates the guide (Sonnet) exactly as app/api/session/route.ts
// would, then the per-section comprehension checkpoints (Haiku) exactly as
// app/api/session/checkpoints/route.ts would, and writes them as committed static
// files:
//
//   study-guides/{id}.md               — the guide markdown
//   study-guides/{id}.checkpoints.json — { checkpoints: [...] } (parity+balanced)
//
// The deployed app then serves these verbatim (lib/study-guides.ts), skipping the
// live LLM calls — near-instant load, ~$0 per session. This is NOT a runtime path.
//
//   npm run guides:build            # build all missing topics
//   node scripts/build-study-guides.cjs 020        # build a single topic id
//   node scripts/build-study-guides.cjs --force    # rebuild all (overwrite)
//   node scripts/build-study-guides.cjs 020 --force # rebuild one topic
//
// Idempotent/resumable: topics whose output files already exist are skipped unless
// --force is passed. Reads ANTHROPIC_API_KEY from .env.local (or the environment).
//
// The prompts below are copied byte-for-byte from lib/prompts.ts and the two API
// routes; keep them in sync if those change (that's why re-running exists).

const fs = require('fs')
const path = require('path')
const Anthropic = require('@anthropic-ai/sdk')

// Minimal .env.local loader (same pattern as scripts/init-db.js).
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const TRANSCRIPTS_DIR = path.join(process.cwd(), 'transcripts')
const OUT_DIR = path.join(process.cwd(), 'study-guides')
const GUIDE_MODEL = 'claude-sonnet-4-6'
const CHECKPOINT_MODEL = 'claude-haiku-4-5-20251001'
const CONCURRENCY = 5
const TRANSCRIPT_CAP = 12000 // matches lib/transcripts.ts

// ── Prompts (copied verbatim from lib/prompts.ts / the routes) ──────────────

// STUDY_GUIDE_SYSTEM_PROMPT (lib/prompts.ts) — kept byte-identical.
const STUDY_GUIDE_SYSTEM_PROMPT = `You are a Security+ SY0-701 study coach. Your student has this background:
- CIS degree, cybersecurity concentration, JMU May 2026
- Completed NIST 800-171 compliance assessment internship
- Built a full-stack web application
- Familiar with basic networking, Linux, cloud fundamentals
- Hands-on lab experience: pen testing, DDoS, phishing, PGP
- No prior Security+ study

The student learns best from material that is SKIMMABLE and CONCRETE, not dense prose. Write so they can scan headings and bold terms, grasp each idea fast, and remember it through a vivid real-world analogy. Avoid walls of text at all costs.

RULES FOR THIS STUDY GUIDE:
1. SCOPE — the material you TEACH as exam content comes ONLY from the transcript below. Do not introduce new technologies, products, named techniques, or concepts the transcript does not cover, even if real and exam-relevant. The student is quizzed only on this guide, so any new topic you add becomes something they get tested on without having been taught it.
2. EXPLAIN FIRST, THEN SKIM — every concept must actually be EXPLAINED, not merely named, compared, or turned into an analogy. For each concept, follow this order: (a) a plain-English sentence that says what it IS and what it DOES — a real definition, NOT an analogy (e.g. "**Telnet** is a protocol for remote command-line access to another machine — but it sends everything, including your password, in cleartext."); (b) the key details as short one- or two-line bullets; (c) then the analogy from rule 4. Never let an analogy stand in for the definition — a reader who skipped every analogy must still fully understand each concept from the definitions and details alone. Bold the key term on its first use (e.g. "**TPM**", "**SUID/SGID**"). When two or more ALREADY-DEFINED things are compared or categorized (types, options, pros/cons, ports), use a compact Markdown table. Never write a wall of text.
2a. MAKE EVERY CONTRAST EXPLICIT — if you explain a concept by contrast ("unlike X", "better than X", "does what X cannot", "improves on X"), you MUST state, in plain words, the specific property of the OTHER side that the contrast depends on — do not leave it implied for the reader to already know. Example: don't write "EDR enables threat hunting that antivirus cannot" without also stating WHY — "traditional **antivirus** only matches files against known signatures at execution time and keeps no record of activity, so it cannot look back at what happened." The student is quizzed and self-checks on this guide, so any comparison it leans on must be fully spelled out here or they cannot answer it. Stating the necessary limitation/property of the compared thing is a clarity aid (like a rule-3 gloss), not a new testable topic — but it must be present.
3. GLOSS EVERY TERM — the student must never meet a term they cannot define. The first time any acronym, abbreviation, command, named technology, or piece of jargon appears, give its plain-language meaning: bold the term, then define it in one short clause. For example: "**TPM** — a dedicated security chip on the motherboard that stores encryption keys"; "**rwx bits** — the read, write, and execute permission flags on a file"; "**icacls** — the Windows command for viewing and changing file permissions". This applies inside tables too: a term must be DEFINED in the prose above a table before it appears in a cell — never let a comparison table be the first and only place a term shows up, with no definition. Prefer the transcript's own wording; when the transcript only NAMES a term without defining it, you MAY add a brief general-knowledge gloss — but only enough to define that one term, never to introduce a separate new topic. Glosses are reading aids; they are NOT new exam material, and rule 1 still governs what counts as taught/testable content. The only terms you may leave unglossed are ones already in the student's background (basic networking, Linux, cloud fundamentals).
4. ANCHOR EACH CONCEPT WITH AN ANALOGY — AFTER you have defined a concept and covered its key details, add a one- to two-sentence real-world analogy or mini-scenario that makes it stick (e.g. "Think of a **TPM** like a tamper-proof safe built into the motherboard: the keys live inside it and never come out in the clear."). The analogy is an ADDITION to the explanation, never a replacement for it. Make it concrete and memorable; do not invent new technical scope inside it.
5. LENGTH — aim for roughly 600–900 words. Be concise by cutting filler and repetition, never by dropping the plain definition, glosses, or analogies. ALWAYS finish every section, including the recap and exam flags, within that length — do not get cut off mid-section.
6. OPENING — do NOT open with a summary, TL;DR, or recap of material the student hasn't read yet. Start with the H2 topic title, then a 1–2 sentence framing intro written as a plain paragraph (no "### " header): say what this lesson covers and why it matters. Then go straight into the teaching sections.
7. STRUCTURE — use H3 section headers in sentence case for the teaching sections (e.g. "### File system security", not "### FILE SYSTEM SECURITY"). End the guide with two wrap-up sections, in this order: a "### Recap" section (3–5 one-line bullets of the must-remember points — this is the summary, and it belongs at the END, after teaching), then a "### Exam flags" section listing exactly 2–3 high-probability exam topics as a bullet list. Both recap and exam-flag items must be things the transcript actually taught — do not summarize or flag concepts it did not cover.
8. If weak areas are listed in the student status, explicitly address them in the guide.
9. Do not add a preamble. Start directly with the H2 topic heading, then the framing intro paragraph, then the teaching sections, then "### Recap" and "### Exam flags".`

// Checkpoints system prompt (app/api/session/checkpoints/route.ts) — verbatim.
const CHECKPOINTS_SYSTEM_PROMPT = `You are a CompTIA Security+ SY0-701 study coach writing quick in-lecture comprehension checks. These are low-stakes retrieval practice the student answers section-by-section while reading — not the graded exam quiz — so keep them short and direct. Every checkpoint is MULTIPLE CHOICE (no free-text). You strictly obey the scope lock: a checkpoint may only test content written in its own section of the provided study guide.`

// buildCheckpointsPrompt (lib/prompts.ts) — verbatim.
function buildCheckpointsPrompt(guideContent, topicName) {
  return `TOPIC: ${topicName}

Below is a study guide split into "### " sections. For EACH content section, write ONE quick multiple-choice "checkpoint" question the student answers immediately after reading that section — just enough to confirm they caught its key idea.

Rules:
- One question per "### " section, in the order the sections appear. SKIP the "### Recap" and "### Exam flags" sections entirely (no question for either — they are summaries, not new material). The framing intro before the first "### " is not a section either — ignore it.
- EVERY checkpoint is multiple choice (type "mc"). Do NOT write any free-text / written-response questions — no "text" type at all.
- SCOPE LOCK: each question tests ONLY what its own section states. Never use facts from another section, and never introduce any term, technology, or concept not written in that section.
- ANSWERABLE FROM THE SECTION ALONE: a fully-correct answer must be constructible using ONLY sentences written in this section. Before you write a question, check its correct option — every fact it depends on must appear verbatim-in-substance in the section text. Do NOT ask a question whose correct answer depends on an unstated premise, an implied contrast, or outside knowledge. In particular, if the section explains something by comparison (e.g. "X does what Y cannot"), only ask about the compared thing (Y) if the section actually states the relevant fact about Y; otherwise ask only about what the section explicitly says. If you cannot form a question the section fully answers, ask a simpler recall question that it does — never reach beyond the text to make the question harder.
- Keep checkpoints QUICK — a plain recall/understanding check, shorter and simpler than an exam question. No tricky multi-clause scenarios.
- Exactly 4 options A–D that are PARALLEL and NEARLY IDENTICAL IN LENGTH — same grammatical shape, same level of detail, and within a couple of words of each other so they look the same at a glance. The correct answer must NOT be the most complete, specific, or detailed one, and NO option may carry more detail than the rest. The classic tell to avoid: a fully-spelled-out correct answer surrounded by terse distractors, so it can be picked by spotting the longest/most-thorough option without reading the question. Every distractor must be a fleshed-out, plausible statement carrying the same amount of detail as the answer — never a short throwaway.
- "section" must be the section's heading text copied EXACTLY, without the leading "### ".
- Plain prose in every field. No markdown, no bold.
- Keep every explanation to 1–2 sentences. Brevity is mandatory — long output is truncated mid-JSON and generation fails.

Respond with ONLY valid JSON, no markdown fences:
{
  "checkpoints": [
    { "section": "<heading text>", "type": "mc", "question": "...", "options": { "A": "...", "B": "...", "C": "...", "D": "..." }, "correct": "B", "explanation": "Plain prose, 1-2 sentences." },
    { "section": "<heading text>", "type": "mc", "question": "...", "options": { "A": "...", "B": "...", "C": "...", "D": "..." }, "correct": "C", "explanation": "Plain prose, 1-2 sentences." }
  ]
}

STUDY GUIDE:
${guideContent}`
}

// ── MC de-tell helpers (ported from lib/quiz.ts for use in a .cjs script) ────
// Kept behaviorally identical: enforceMCLengthParity() then balanceQuizAnswers(),
// same order the checkpoints route applies them.

function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function wordCount(s) {
  return (s || '').trim().split(/\s+/).filter(Boolean).length
}

function correctIsLengthOutlier(q) {
  if (q.type !== 'mc' || !q.options || !q.correct || !(q.correct in q.options)) return false
  const counts = Object.entries(q.options).map(([l, v]) => ({ l, n: wordCount(v) }))
  if (counts.length < 2) return false
  const correctN = wordCount(q.options[q.correct])
  const minN = Math.min(...counts.map((c) => c.n))
  const maxN = Math.max(...counts.map((c) => c.n))
  if (correctN !== maxN || minN === 0) return false
  return maxN > 1.25 * minN || maxN - minN >= 4
}

async function enforceMCLengthParity(anthropic, questions) {
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

    const response = await anthropic.messages.create({
      model: CHECKPOINT_MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean)
    const rewrites = Array.isArray(parsed && parsed.rewrites) ? parsed.rewrites : []

    for (const rec of rewrites) {
      if (typeof rec.idx !== 'number') continue
      const target = questions[rec.idx]
      if (!target || target.type !== 'mc' || !target.options || !rec.options) continue
      const keys = Object.keys(target.options)
      if (keys.every((k) => typeof rec.options[k] === 'string' && rec.options[k].trim())) {
        target.options = keys.reduce((acc, k) => {
          acc[k] = rec.options[k]
          return acc
        }, {})
      }
    }
  } catch (e) {
    console.error('  MC length-parity pass failed (keeping originals):', e.message || e)
  }

  return questions
}

function balanceQuizAnswers(questions) {
  if (!Array.isArray(questions)) return questions

  let bag = []
  const drawSlot = (slots) => {
    if (bag.length === 0) bag = fisherYates(Array.from({ length: slots }, (_, i) => i))
    return bag.pop()
  }

  for (const q of questions) {
    if (!q || q.type !== 'mc' || !q.options || typeof q.options !== 'object') continue
    const letters = Object.keys(q.options)
    const correctLetter = q.correct
    if (letters.length < 2 || !correctLetter || !(correctLetter in q.options)) continue

    const correctValue = q.options[correctLetter]
    const distractors = fisherYates(letters.filter((l) => l !== correctLetter).map((l) => q.options[l]))

    const target = letters.length === 4 ? drawSlot(4) : Math.floor(Math.random() * letters.length)

    let d = 0
    letters.forEach((letter, pos) => {
      q.options[letter] = pos === target ? correctValue : distractors[d++]
    })
    q.correct = letters[target]
  }
  return questions
}

// ── Transcript read (mirrors lib/transcripts.ts getTranscript) ──────────────

function readTranscript(topicId) {
  const files = fs.readdirSync(TRANSCRIPTS_DIR)
  const match = files.find((f) => f.startsWith(`${topicId}-`))
  if (!match) return null
  const content = fs.readFileSync(path.join(TRANSCRIPTS_DIR, match), 'utf-8')
  return content.length > TRANSCRIPT_CAP
    ? content.slice(0, TRANSCRIPT_CAP) + '\n...[transcript continues - truncated for context]'
    : content
}

function extractText(message) {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
}

// ── Per-topic build ─────────────────────────────────────────────────────────

async function buildGuide(anthropic, topic, transcript) {
  // Mirrors app/api/session/route.ts, minus the per-request STUDENT STATUS block
  // (guide content does not depend on it), so output is deterministic per topic.
  const message = await anthropic.messages.create({
    model: GUIDE_MODEL,
    max_tokens: 2800,
    system: [{ type: 'text', text: STUDY_GUIDE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `CURRENT TOPIC: ${topic.name} (ID: ${topic.id}, Domain ${topic.domain})

TRANSCRIPT:`,
        },
        { type: 'text', text: transcript, cache_control: { type: 'ephemeral' } },
      ],
    }],
  })
  const text = extractText(message).trim()
  if (!text) throw new Error('guide came back empty')
  return text
}

async function buildCheckpoints(anthropic, topic, guide) {
  // Mirrors app/api/session/checkpoints/route.ts, but with a higher token cap:
  // the live route keeps max_tokens at 2000 to stay under Vercel's 60s budget,
  // which truncates the JSON mid-string on many-section guides. Offline there is
  // no time budget, so we lift it well clear of that ceiling.
  const response = await anthropic.messages.create({
    model: CHECKPOINT_MODEL,
    max_tokens: 4000,
    system: [{ type: 'text', text: CHECKPOINTS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildCheckpointsPrompt(guide, topic.name) }],
  })
  const text = extractText(response)
  const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(clean)
  if (Array.isArray(parsed.checkpoints)) {
    await enforceMCLengthParity(anthropic, parsed.checkpoints)
    balanceQuizAnswers(parsed.checkpoints)
  }
  return parsed
}

async function main() {
  loadEnvLocal()
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('✗ ANTHROPIC_API_KEY is not set. Add it to .env.local first.')
    process.exit(1)
  }
  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    console.error('✗ transcripts/ folder not found.')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const onlyId = args.find((a) => /^\d{3}$/.test(a)) || null

  fs.mkdirSync(OUT_DIR, { recursive: true })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const allTopics = require('./topics.json')
  let topics = onlyId ? allTopics.filter((t) => t.id === onlyId) : allTopics
  if (onlyId && topics.length === 0) {
    console.error(`✗ Topic id ${onlyId} not found in scripts/topics.json`)
    process.exit(1)
  }

  const guidePath = (id) => path.join(OUT_DIR, `${id}.md`)
  const cpPath = (id) => path.join(OUT_DIR, `${id}.checkpoints.json`)
  const isBuilt = (id) => fs.existsSync(guidePath(id)) && fs.existsSync(cpPath(id))

  // Skip already-built topics unless --force (resumable across long runs).
  const queue = force ? topics : topics.filter((t) => !isBuilt(t.id))
  const skipped = topics.length - queue.length

  console.log(
    `Building ${queue.length} topic(s) (guide: ${GUIDE_MODEL}, checkpoints: ${CHECKPOINT_MODEL}, ` +
    `concurrency: ${CONCURRENCY})${skipped ? `, skipping ${skipped} already built` : ''}…`
  )

  const errors = []
  let done = 0

  async function processTopic(topic) {
    try {
      // Guide and checkpoints are independent artifacts: persist the guide the
      // moment it is generated so a later checkpoint failure never discards the
      // expensive Sonnet call, and on re-run regenerate only the missing piece.
      const needGuide = force || !fs.existsSync(guidePath(topic.id))
      const needCp = force || !fs.existsSync(cpPath(topic.id))

      let guide
      if (needGuide) {
        const transcript = readTranscript(topic.id)
        if (!transcript) throw new Error(`transcript for ${topic.id} not found in /transcripts`)
        guide = await buildGuide(anthropic, topic, transcript)
        fs.writeFileSync(guidePath(topic.id), guide + '\n', 'utf-8')
      } else {
        guide = fs.readFileSync(guidePath(topic.id), 'utf-8')
      }

      if (needCp) {
        const checkpoints = await buildCheckpoints(anthropic, topic, guide)
        fs.writeFileSync(cpPath(topic.id), JSON.stringify(checkpoints, null, 2) + '\n', 'utf-8')
      }
    } catch (err) {
      errors.push({ id: topic.id, name: topic.name, error: String(err && err.message ? err.message : err) })
    } finally {
      done++
      console.log(`  …${done}/${queue.length}  ${topic.id} ${topic.name}`)
    }
  }

  let cursor = 0
  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor++]
      await processTopic(item)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const built = queue.length - errors.length
  console.log(`\n✓ Built ${built} topic(s) into ${path.relative(process.cwd(), OUT_DIR)}`)
  if (errors.length) {
    console.log(`⚠ ${errors.length} topic(s) failed:`)
    for (const e of errors) console.log(`   ${e.id} ${e.name}: ${e.error}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
