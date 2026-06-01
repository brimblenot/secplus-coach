// scripts/migrate-sqlite-to-pg.js
// ONE-TIME migration: copy existing progress from the legacy sql.js file
// (data/coach.db) into your Supabase Postgres database.
//
//   1. Set DATABASE_URL in .env.local (Supabase Transaction pooler URI).
//   2. npm run db:migrate
//
// Safe to re-run: it clears the dynamic tables and reloads from coach.db,
// so running twice does not duplicate rows.

const fs = require('fs')
const path = require('path')
const postgres = require('postgres')
const initSqlJs = require('sql.js')

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// Read every row of a table from the sql.js DB as plain objects.
function readTable(db, table) {
  let res
  try { res = db.exec(`SELECT * FROM ${table}`) } catch { return [] }
  if (!res[0]) return []
  const { columns, values } = res[0]
  return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
}

async function main() {
  loadEnvLocal()
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('✗ DATABASE_URL is not set. Add your Supabase connection string to .env.local first.')
    process.exit(1)
  }
  const DB_PATH = path.join(process.cwd(), 'data', 'coach.db')
  if (!fs.existsSync(DB_PATH)) {
    console.error(`✗ No legacy DB found at ${DB_PATH} — nothing to migrate.`)
    process.exit(1)
  }

  const SQL = await initSqlJs()
  const lite = new SQL.Database(fs.readFileSync(DB_PATH))

  const profile = readTable(lite, 'profile')[0] || {}
  const topics = readTable(lite, 'topic_progress')
  const attempts = readTable(lite, 'quiz_attempts')
  const weak = readTable(lite, 'weak_areas')
  const domains = readTable(lite, 'domain_quizzes')
  const plans = readTable(lite, 'daily_plan')

  const sql = postgres(url, { prepare: false, max: 2 })
  try {
    console.log('Ensuring schema exists…')
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY DEFAULT 1, exam_date TEXT NOT NULL DEFAULT '2026-06-18',
        study_hours_per_day INTEGER DEFAULT 1, last_weak_session TEXT );
      CREATE TABLE IF NOT EXISTS topic_progress (
        id SERIAL PRIMARY KEY, topic_id TEXT NOT NULL UNIQUE, topic_name TEXT NOT NULL,
        domain INTEGER NOT NULL, completed_at TIMESTAMPTZ, quiz_score INTEGER,
        quiz_attempts INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', study_minutes INTEGER );
      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id SERIAL PRIMARY KEY, topic_id TEXT NOT NULL, score INTEGER NOT NULL,
        questions_json TEXT NOT NULL, wrong_questions TEXT, attempted_at TIMESTAMPTZ DEFAULT now() );
      CREATE TABLE IF NOT EXISTS weak_areas (
        id SERIAL PRIMARY KEY, concept TEXT NOT NULL UNIQUE, topic_id TEXT NOT NULL,
        topic_name TEXT NOT NULL, domain INTEGER NOT NULL, wrong_count INTEGER DEFAULT 1,
        last_seen TIMESTAMPTZ DEFAULT now(), resolved INTEGER DEFAULT 0 );
      CREATE TABLE IF NOT EXISTS domain_quizzes (
        domain INTEGER PRIMARY KEY, passed INTEGER DEFAULT 0, best_score INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0, last_attempted TIMESTAMPTZ DEFAULT now() );
      CREATE TABLE IF NOT EXISTS daily_plan (
        date TEXT PRIMARY KEY, topic_ids TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now() );
      INSERT INTO profile (id, exam_date) VALUES (1, '2026-06-18') ON CONFLICT (id) DO NOTHING;
    `)

    console.log('Clearing existing dynamic tables (idempotent reload)…')
    await sql`TRUNCATE quiz_attempts, weak_areas, domain_quizzes, daily_plan RESTART IDENTITY`

    // profile (single row, id=1)
    await sql`UPDATE profile SET
      exam_date = ${profile.exam_date || '2026-06-18'},
      study_hours_per_day = ${profile.study_hours_per_day ?? 1},
      last_weak_session = ${profile.last_weak_session ?? null}
      WHERE id = 1`

    // topic_progress — rows are pre-seeded by schema/app; upsert mutable fields by topic_id
    let tUpserted = 0
    for (const t of topics) {
      const res = await sql`INSERT INTO topic_progress
        (topic_id, topic_name, domain, completed_at, quiz_score, quiz_attempts, status, study_minutes)
        VALUES (${t.topic_id}, ${t.topic_name}, ${t.domain}, ${t.completed_at ?? null},
                ${t.quiz_score ?? null}, ${t.quiz_attempts ?? 0}, ${t.status ?? 'pending'}, ${t.study_minutes ?? null})
        ON CONFLICT (topic_id) DO UPDATE SET
          completed_at = EXCLUDED.completed_at, quiz_score = EXCLUDED.quiz_score,
          quiz_attempts = EXCLUDED.quiz_attempts, status = EXCLUDED.status,
          study_minutes = EXCLUDED.study_minutes`
      tUpserted += res.count
    }

    for (const a of attempts) {
      await sql`INSERT INTO quiz_attempts (topic_id, score, questions_json, wrong_questions, attempted_at)
        VALUES (${a.topic_id}, ${a.score}, ${a.questions_json}, ${a.wrong_questions ?? null},
                ${a.attempted_at ?? null})`
    }
    for (const w of weak) {
      await sql`INSERT INTO weak_areas (concept, topic_id, topic_name, domain, wrong_count, last_seen, resolved)
        VALUES (${w.concept}, ${w.topic_id}, ${w.topic_name}, ${w.domain}, ${w.wrong_count ?? 1},
                ${w.last_seen ?? null}, ${w.resolved ?? 0})`
    }
    for (const d of domains) {
      await sql`INSERT INTO domain_quizzes (domain, passed, best_score, attempts, last_attempted)
        VALUES (${d.domain}, ${d.passed ?? 0}, ${d.best_score ?? 0}, ${d.attempts ?? 0},
                ${d.last_attempted ?? null})`
    }
    for (const p of plans) {
      await sql`INSERT INTO daily_plan (date, topic_ids) VALUES (${p.date}, ${p.topic_ids})`
    }

    console.log('✓ Migration complete:')
    console.log(`  profile: 1`)
    console.log(`  topic_progress: ${tUpserted} rows`)
    console.log(`  quiz_attempts: ${attempts.length}`)
    console.log(`  weak_areas: ${weak.length}`)
    console.log(`  domain_quizzes: ${domains.length}`)
    console.log(`  daily_plan: ${plans.length}`)
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
