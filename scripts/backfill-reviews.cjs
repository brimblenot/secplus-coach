// scripts/backfill-reviews.cjs
// One-off: stage already-passed topics into the spaced-repetition schedule.
// Topics passed before the scheduler existed have review_due = NULL and would
// never resurface; this assigns them a review_due, staggered over the next few
// days, OLDEST-completed first (most decayed -> reviewed soonest).
//
//   node scripts/backfill-reviews.cjs [days]     (days defaults to 3)
//
// Idempotent: only touches passed topics that have NO review scheduled yet, so
// re-running it won't disturb topics already in the schedule.
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

// Eastern "today" + date math, matching lib/db.ts (localToday / addDaysStr).
function easternToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}
function addDaysStr(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function main() {
  loadEnvLocal()
  const url = process.env.DATABASE_URL
  if (!url) { console.error('✗ DATABASE_URL is not set.'); process.exit(1) }
  const days = Math.max(1, parseInt(process.argv[2] || '3', 10))

  const sql = postgres(url, { prepare: false, max: 2 })
  try {
    const rows = await sql`
      SELECT topic_id, topic_name FROM topic_progress
      WHERE status = 'passed' AND review_due IS NULL
      ORDER BY completed_at ASC NULLS FIRST`
    if (rows.length === 0) {
      console.log('No unscheduled passed topics — nothing to backfill.')
      return
    }

    const today = easternToday()
    const perDay = Math.ceil(rows.length / days)
    const counts = {}
    for (let i = 0; i < rows.length; i++) {
      const offset = Math.min(days - 1, Math.floor(i / perDay))
      const due = addDaysStr(today, offset)
      // Enter at rung 0: the first successful review will bump to the next
      // interval (1 -> 3 -> 7 -> 16 -> 35 days).
      await sql`UPDATE topic_progress
                SET review_due = ${due}, review_interval = 1, review_streak = 0
                WHERE topic_id = ${rows[i].topic_id}`
      counts[due] = (counts[due] || 0) + 1
    }

    console.log(`✓ Scheduled ${rows.length} passed topics across ${days} day(s), oldest first:`)
    for (const d of Object.keys(counts).sort()) {
      console.log(`   ${d}: ${counts[d]} due${d === today ? '  (due now)' : ''}`)
    }
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
