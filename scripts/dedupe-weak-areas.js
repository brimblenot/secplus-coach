// scripts/dedupe-weak-areas.js
// One-off cleanup: collapse near-duplicate unresolved weak_areas into a single row.
// Uses the same token-overlap rule as upsertWeakArea in lib/db.ts, so concepts like
// "exception vs exemption definitional distinction" and "...functional distinction"
// merge into one. Keeps the highest wrong_count row per cluster and sums the rest.
//
//   node scripts/dedupe-weak-areas.js          # apply
//   node scripts/dedupe-weak-areas.js --dry     # preview only
//
// Reads DATABASE_URL from .env.local (or the environment).

const fs = require('fs')
const path = require('path')
const postgres = require('postgres')

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// --- keep in sync with lib/db.ts ---
const CONCEPT_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'vs', 'versus', 'of', 'for', 'to', 'in', 'on',
  'when', 'it', 'its', 'their', 'that', 'this', 'is', 'are', 'be', 'with', 'how',
  'what', 'between', 'as', 'by', 'at', 'from',
])
function conceptTokens(concept) {
  const tokens = concept
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !CONCEPT_STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
  return new Set(tokens)
}
const CONCEPT_SIMILARITY_THRESHOLD = 0.5
function conceptsAreSimilar(a, b) {
  const ta = conceptTokens(a)
  const tb = conceptTokens(b)
  if (ta.size === 0 || tb.size === 0) return false
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  const union = ta.size + tb.size - shared
  return union > 0 && shared / union >= CONCEPT_SIMILARITY_THRESHOLD
}
// ---

async function main() {
  loadEnvLocal()
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('✗ DATABASE_URL is not set. Add it to .env.local first.')
    process.exit(1)
  }
  const dry = process.argv.includes('--dry')
  const sql = postgres(url, { prepare: false, max: 2 })
  try {
    const rows = await sql`SELECT * FROM weak_areas WHERE resolved = 0 ORDER BY domain, wrong_count DESC, id`
    // Greedy cluster within each domain. First row in a cluster (highest wrong_count) wins.
    const clusters = [] // { keeper, dupes: [], total }
    for (const row of rows) {
      const c = clusters.find(
        (cl) =>
          cl.keeper.domain === row.domain &&
          (cl.keeper.concept === row.concept || conceptsAreSimilar(cl.keeper.concept, row.concept))
      )
      if (c) {
        c.dupes.push(row)
        c.total += row.wrong_count
      } else {
        clusters.push({ keeper: row, dupes: [], total: row.wrong_count })
      }
    }

    const merged = clusters.filter((c) => c.dupes.length > 0)
    if (merged.length === 0) {
      console.log('No near-duplicate weak areas found. Nothing to do.')
      return
    }

    for (const c of merged) {
      console.log(`\n[Domain ${c.keeper.domain}] keep: "${c.keeper.concept}" (wrong_count → ${c.total})`)
      for (const d of c.dupes) console.log(`   merge & delete: "${d.concept}" (id ${d.id}, count ${d.wrong_count})`)
    }

    if (dry) {
      console.log(`\n--dry: ${merged.reduce((n, c) => n + c.dupes.length, 0)} row(s) would be deleted. No changes made.`)
      return
    }

    let deleted = 0
    for (const c of merged) {
      const dupeIds = c.dupes.map((d) => d.id)
      await sql`UPDATE weak_areas SET wrong_count = ${c.total}, resolved = 0 WHERE id = ${c.keeper.id}`
      await sql`DELETE FROM weak_areas WHERE id IN ${sql(dupeIds)}`
      deleted += dupeIds.length
    }
    console.log(`\n✓ Done. Collapsed into ${merged.length} concept(s); deleted ${deleted} duplicate row(s).`)
  } finally {
    await sql.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
