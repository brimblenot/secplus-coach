// scripts/extract-acronyms.cjs
// ONE-TIME, OFFLINE build of the flashcard data set. Reads every lecture
// transcript, asks Haiku to pull the acronyms/abbreviations that transcript
// actually uses (expansion + a short plain definition), merges + dedupes across
// all lectures, and writes the static list to lib/flashcards.json.
//
//   npm run flashcards:build
//
// This is NOT a runtime path — the deployed app never calls Claude for flashcards;
// it just serves the committed JSON. Re-run this only to regenerate the data (e.g.
// after transcripts change). The output is hand-reviewable/editable static data.
// Reads ANTHROPIC_API_KEY from .env.local (or the environment).

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
const OUT_PATH = path.join(process.cwd(), 'lib', 'flashcards.json')
const MODEL = 'claude-haiku-4-5-20251001'
const CONCURRENCY = 5
const MAX_TRANSCRIPT_CHARS = 16000

const SYSTEM_PROMPT =
  'You extract a glossary of acronyms and abbreviations from a CompTIA Security+ ' +
  'SY0-701 lecture transcript, for study flashcards. You output STRICT JSON only — ' +
  'no prose, no markdown fences.'

function buildUserPrompt(topicName, transcript) {
  return `LECTURE TOPIC: ${topicName}

From the transcript below, list every acronym, abbreviation, or initialism that ACTUALLY APPEARS in it. For each, return:
- "term": the acronym exactly as used (preserve digits/casing/punctuation: e.g. 3DES, WPA3, S/MIME, IPsec, TLS 1.3).
- "expansion": what the letters stand for (full words).
- "definition": ONE plain-English sentence, 18 words max, of what it is or does. Prefer how THIS transcript explains it; if the transcript only names it, give a standard concise definition.

RULES:
- Only include acronyms that appear in the transcript text. Do NOT invent ones it does not use.
- DO include common ones the lecture uses even if it does not spell them out (e.g. IP, TCP, DNS, USB, CPU, HTTP).
- Do NOT include plain uppercase English words that are not real abbreviations (e.g. OK, AND, THE), single letters, or transcript section markers.
- Keep definitions flashcard-short.

Respond with ONLY a JSON array, no markdown fences:
[{"term":"SIEM","expansion":"Security Information and Event Management","definition":"Central system that aggregates and correlates logs to detect and investigate threats."}]

TRANSCRIPT:
${transcript}`
}

function stripHeader(text) {
  // Drop the leading "Kind: captions" / "Language: en" WebVTT-ish header lines.
  return text.replace(/^(Kind:.*|Language:.*|WEBVTT.*)\n/gim, '').trim()
}

function parseCards(raw) {
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = clean.indexOf('[')
  const end = clean.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error('no JSON array found')
  return JSON.parse(clean.slice(start, end + 1))
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

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const topics = require('./topics.json')
  const topicById = new Map(topics.map((t) => [t.id, t]))

  // Only transcripts that map to a real study topic (skips 001 intro).
  const files = fs
    .readdirSync(TRANSCRIPTS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => ({ file: f, id: (f.match(/^(\d{3})-/) || [])[1] }))
    .filter((x) => x.id && topicById.has(x.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  console.log(`Extracting acronyms from ${files.length} transcripts (model: ${MODEL}, concurrency: ${CONCURRENCY})…`)

  // term (uppercased) -> { term, expansion, definition, domain, topicId }
  const merged = new Map()
  const errors = []
  let done = 0

  async function processFile({ file, id }) {
    const topic = topicById.get(id)
    try {
      let text = stripHeader(fs.readFileSync(path.join(TRANSCRIPTS_DIR, file), 'utf-8'))
      if (text.length > MAX_TRANSCRIPT_CHARS) text = text.slice(0, MAX_TRANSCRIPT_CHARS)

      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(topic.name, text) }],
      })
      const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      const cards = parseCards(raw)

      for (const c of cards) {
        if (!c || typeof c.term !== 'string') continue
        const term = c.term.trim()
        const expansion = (c.expansion || '').trim()
        const definition = (c.definition || '').trim()
        // Drop CVSS vector fragments (AV:N, AC:L, S:U, …) — scoring notation, not acronyms.
        if (term.length < 2 || !/[A-Za-z]/.test(term) || !expansion || term.includes(':')) continue
        const key = term.toUpperCase().replace(/\s+/g, ' ')
        const existing = merged.get(key)
        if (!existing) {
          // First lecture to introduce it sets the domain/topic attribution.
          merged.set(key, { term, expansion, definition, domain: topic.domain, topicId: id })
        } else if (definition.length > (existing.definition || '').length) {
          // Keep the richer definition, but keep the original attribution.
          existing.expansion = existing.expansion || expansion
          existing.definition = definition
        }
      }
    } catch (err) {
      errors.push({ file, error: String(err && err.message ? err.message : err) })
    } finally {
      done++
      if (done % 10 === 0 || done === files.length) {
        console.log(`  …${done}/${files.length} transcripts, ${merged.size} distinct acronyms so far`)
      }
    }
  }

  // Simple fixed-size worker pool.
  let cursor = 0
  async function worker() {
    while (cursor < files.length) {
      const item = files[cursor++]
      await processFile(item)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const out = Array.from(merged.values()).sort((a, b) =>
    a.term.toUpperCase().localeCompare(b.term.toUpperCase())
  )
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf-8')

  console.log(`\n✓ Wrote ${out.length} flashcards to ${path.relative(process.cwd(), OUT_PATH)}`)
  if (errors.length) {
    console.log(`⚠ ${errors.length} transcript(s) failed to parse:`)
    for (const e of errors) console.log(`   ${e.file}: ${e.error}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
