// scripts/init-db.js
// Optional: create the schema + seed topics in your Supabase Postgres DB up front.
// Seeding also happens automatically on the app's first request (see lib/db.ts
// ready()), so this script is mainly to verify your DATABASE_URL works.
//
//   npm run db:init
//
// Reads DATABASE_URL from .env.local (or the environment).

const fs = require('fs')
const path = require('path')
const postgres = require('postgres')

// Minimal .env.local loader (avoids a dotenv dependency).
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// Keep this list in sync with ALL_TOPICS in lib/db.ts.
const ALL_TOPICS = require('./topics.json')

async function main() {
  loadEnvLocal()
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('✗ DATABASE_URL is not set. Add your Supabase connection string to .env.local first.')
    process.exit(1)
  }

  const sql = postgres(url, { prepare: false, max: 2 })
  try {
    console.log('Connecting to Postgres…')
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY DEFAULT 1,
        exam_date TEXT NOT NULL DEFAULT '2026-06-18',
        study_hours_per_day INTEGER DEFAULT 1,
        last_weak_session TEXT
      );
      CREATE TABLE IF NOT EXISTS topic_progress (
        id SERIAL PRIMARY KEY,
        topic_id TEXT NOT NULL UNIQUE,
        topic_name TEXT NOT NULL,
        domain INTEGER NOT NULL,
        completed_at TIMESTAMPTZ,
        quiz_score INTEGER,
        quiz_attempts INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        study_minutes INTEGER
      );
      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id SERIAL PRIMARY KEY,
        topic_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        questions_json TEXT NOT NULL,
        wrong_questions TEXT,
        attempted_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS weak_areas (
        id SERIAL PRIMARY KEY,
        concept TEXT NOT NULL UNIQUE,
        topic_id TEXT NOT NULL,
        topic_name TEXT NOT NULL,
        domain INTEGER NOT NULL,
        wrong_count INTEGER DEFAULT 1,
        last_seen TIMESTAMPTZ DEFAULT now(),
        resolved INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS domain_quizzes (
        domain INTEGER PRIMARY KEY,
        passed INTEGER DEFAULT 0,
        best_score INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        last_attempted TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS daily_plan (
        date TEXT PRIMARY KEY,
        topic_ids TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      INSERT INTO profile (id, exam_date) VALUES (1, '2026-06-18') ON CONFLICT (id) DO NOTHING;
    `)

    let seeded = 0
    for (const t of ALL_TOPICS) {
      const res = await sql`INSERT INTO topic_progress (topic_id, topic_name, domain)
                            VALUES (${t.id}, ${t.name}, ${t.domain})
                            ON CONFLICT (topic_id) DO NOTHING`
      seeded += res.count
    }
    console.log(`✓ Schema ready. Seeded ${seeded} new topics (of ${ALL_TOPICS.length}).`)
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
