import postgres from 'postgres'

// ── Connection ───────────────────────────────────────────────────────────────
// Single pooled client, reused across requests in the same server process
// (created per cold start on Vercel).
//
// IMPORTANT: DATABASE_URL must point at Supabase's SESSION pooler (port 5432),
// NOT the transaction pooler (6543). Under this app's concurrent dashboard
// queries the 6543 pooler returned statement-timeout (57014) and the dashboard
// hung indefinitely; the session pooler runs the same queries in ~1s.
type Sql = ReturnType<typeof postgres>
let _sql: Sql | null = null

function client(): Sql {
  if (_sql) return _sql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set — add your Supabase connection string to .env.local')
  // max: 3 lets the dashboard's parallel queries run concurrently instead of
  // serializing. prepare: false is kept for safety/portability across poolers.
  // connect_timeout fails fast instead of hanging a request indefinitely.
  _sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 })
  return _sql
}

// Schema creation + seeding does NOT happen at request time. Running CREATE
// TABLE / INSERT on every serverless cold start took table locks on the shared
// Supabase pooler; when Vercel froze a function mid-transaction, the held locks
// stalled later requests until Postgres' statement timeout fired (the 504s).
// The schema is created once, out of band, by `npm run db:init` / `db:migrate`.
// At runtime the app ONLY queries existing tables.
async function ensureSchema(): Promise<void> {
  const sql = client()
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      study_hours_per_day INTEGER DEFAULT 1,
      last_weak_session TEXT
    );
    -- Self-paced-with-a-target: the student sets a date to finish all topics by
    -- and an exam date. Both drive the dashboard pace tracker. Additive/idempotent.
    ALTER TABLE profile ADD COLUMN IF NOT EXISTS finish_topics_by TEXT;
    ALTER TABLE profile ADD COLUMN IF NOT EXISTS exam_date TEXT;
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
    -- Spaced-repetition review schedule, per passed topic (idempotent migration).
    ALTER TABLE topic_progress ADD COLUMN IF NOT EXISTS review_due TEXT;
    ALTER TABLE topic_progress ADD COLUMN IF NOT EXISTS review_interval INTEGER;
    ALTER TABLE topic_progress ADD COLUMN IF NOT EXISTS review_streak INTEGER DEFAULT 0;
    INSERT INTO profile (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    UPDATE profile SET finish_topics_by = '${DEFAULT_FINISH_TOPICS_BY}' WHERE id = 1 AND finish_topics_by IS NULL;
    UPDATE profile SET exam_date = '${DEFAULT_EXAM_DATE}' WHERE id = 1 AND exam_date IS NULL;
  `)
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM topic_progress`
  if (count < ALL_TOPICS.length) {
    await sql`INSERT INTO topic_progress ${sql(ALL_TOPICS.map((t) => ({
      topic_id: t.id, topic_name: t.name, domain: t.domain,
    })))} ON CONFLICT (topic_id) DO NOTHING`
  }
}

// ── Local time ───────────────────────────────────────────────────────────────
// The student is in the US Eastern timezone (JMU, Virginia). Vercel runs in UTC,
// so a naive `toISOString()` "today" rolls over at 8pm Eastern and splits an
// evening study session across two calendar days — which is why a day of work
// showed only the topics finished after UTC midnight. Anchor every "today"
// comparison to Eastern instead.
export const APP_TZ = 'America/New_York'

export function localToday(): string {
  // en-CA formats as YYYY-MM-DD, which matches our stored date strings.
  return new Date().toLocaleDateString('en-CA', { timeZone: APP_TZ })
}

// Whole days from today (Eastern) to a YYYY-MM-DD target. Negative if the date
// is already past. Both dates are pinned to UTC midnight so only the calendar
// day matters (no clock-time / DST drift).
export function daysUntil(dateStr: string): number {
  const start = Date.parse(localToday() + 'T00:00:00Z')
  const end = Date.parse(dateStr + 'T00:00:00Z')
  return Math.round((end - start) / 86400000)
}

// ── Pace / target dates ────────────────────────────────────────────────────
// Studying is self-paced but goal-anchored: the student picks a date to finish
// all topics by and an exam date, and the dashboard derives a required
// topics/day pace from them. Both are editable (PATCH /api/settings). Defaults
// are used when the column is null (e.g. a legacy DB before the backfill ran).
export const DEFAULT_FINISH_TOPICS_BY = '2026-07-28'
export const DEFAULT_EXAM_DATE = '2026-07-29'

export interface PaceSettings {
  finishTopicsBy: string
  examDate: string
}

export async function getPaceSettings(): Promise<PaceSettings> {
  const row = await queryOne<{ finish_topics_by: string | null; exam_date: string | null }>(
    'SELECT finish_topics_by, exam_date FROM profile WHERE id = 1'
  )
  return {
    finishTopicsBy: row?.finish_topics_by ?? DEFAULT_FINISH_TOPICS_BY,
    examDate: row?.exam_date ?? DEFAULT_EXAM_DATE,
  }
}

// Accepts either date; updates only the ones provided. Values must already be
// validated YYYY-MM-DD strings (the route rejects anything else).
export async function updatePaceSettings(p: { finishTopicsBy?: string; examDate?: string }): Promise<PaceSettings> {
  if (p.finishTopicsBy) await run('UPDATE profile SET finish_topics_by = ? WHERE id = 1', [p.finishTopicsBy])
  if (p.examDate) await run('UPDATE profile SET exam_date = ? WHERE id = 1', [p.examDate])
  return getPaceSettings()
}

// ── Query helpers ────────────────────────────────────────────────────────────
// The legacy code was written with `?` placeholders. Convert them to Postgres
// `$1, $2, …` so the existing SQL strings carry over with minimal edits.
function toPg(query: string): string {
  let i = 0
  return query.replace(/\?/g, () => `$${++i}`)
}

async function queryAll<T>(query: string, params: (string | number | null)[] = []): Promise<T[]> {
  const rows = await client().unsafe(toPg(query), params)
  return rows as unknown as T[]
}

async function queryOne<T>(query: string, params: (string | number | null)[] = []): Promise<T | null> {
  const rows = await queryAll<T>(query, params)
  return rows[0] ?? null
}

async function run(query: string, params: (string | number | null)[] = []): Promise<void> {
  await client().unsafe(toPg(query), params)
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface TopicProgress {
  topic_id: string
  topic_name: string
  domain: number
  completed_at: string | null
  quiz_score: number | null
  quiz_attempts: number
  status: 'pending' | 'studying' | 'passed' | 'failed'
  review_due?: string | null
  review_interval?: number | null
  review_streak?: number | null
}

export interface WeakArea {
  id: number
  concept: string
  topic_id: string
  topic_name: string
  domain: number
  wrong_count: number
  last_seen: string
  resolved: number
}

// ── Study order ────────────────────────────────────────────────────────────
// D1 → D4 → D2 → D5 → D3 (by exam weight priority)
export const STUDY_ORDER = [
  '002','003','004','005','006','007','008','009','010','011',
  '012','013','014','015','016','017','018','019',
  '076','077','078','079','080','081','082','083','084','085',
  '086','087','088','089','090','091','092','093','094','095',
  '096','097','098','099','100','101','102','103','104',
  '020','021','022','023','024','025','026','027','028','029',
  '030','031','032','033','034','035','036','037','038','039',
  '040','041','042','043','044','045','046','047','048','049',
  '050','051','052','053','054','055','056','057',
  '105','106','107','108','109','110','111','112','113','114',
  '115','116','117','118','119','120','121',
  '058','059','060','061','062','063','064','065','066','067',
  '068','069','070','071','072','073','074','075',
]

export const ALL_TOPICS: { id: string; name: string; domain: number }[] = [
  { id: '002', name: 'Security Controls', domain: 1 },
  { id: '003', name: 'CIA Triad', domain: 1 },
  { id: '004', name: 'Non-repudiation', domain: 1 },
  { id: '005', name: 'Authentication, Authorization & Accounting', domain: 1 },
  { id: '006', name: 'Gap Analysis', domain: 1 },
  { id: '007', name: 'Zero Trust', domain: 1 },
  { id: '008', name: 'Physical Security', domain: 1 },
  { id: '009', name: 'Deception and Disruption', domain: 1 },
  { id: '010', name: 'Change Management', domain: 1 },
  { id: '011', name: 'Technical Change Management', domain: 1 },
  { id: '012', name: 'Public Key Infrastructure', domain: 1 },
  { id: '013', name: 'Encrypting Data', domain: 1 },
  { id: '014', name: 'Key Exchange', domain: 1 },
  { id: '015', name: 'Encryption Technologies', domain: 1 },
  { id: '016', name: 'Obfuscation', domain: 1 },
  { id: '017', name: 'Hashing and Digital Signatures', domain: 1 },
  { id: '018', name: 'Blockchain Technology', domain: 1 },
  { id: '019', name: 'Certificates', domain: 1 },
  { id: '020', name: 'Threat Actors', domain: 2 },
  { id: '021', name: 'Common Threat Vectors', domain: 2 },
  { id: '022', name: 'Phishing', domain: 2 },
  { id: '023', name: 'Impersonation', domain: 2 },
  { id: '024', name: 'Watering Hole Attacks', domain: 2 },
  { id: '025', name: 'Other Social Engineering Attacks', domain: 2 },
  { id: '026', name: 'Memory Injections', domain: 2 },
  { id: '027', name: 'Buffer Overflows', domain: 2 },
  { id: '028', name: 'Race Conditions', domain: 2 },
  { id: '029', name: 'Malicious Updates', domain: 2 },
  { id: '030', name: 'Operating System Vulnerabilities', domain: 2 },
  { id: '031', name: 'SQL Injection', domain: 2 },
  { id: '032', name: 'Cross-site Scripting', domain: 2 },
  { id: '033', name: 'Hardware Vulnerabilities', domain: 2 },
  { id: '034', name: 'Virtualization Vulnerabilities', domain: 2 },
  { id: '035', name: 'Cloud-specific Vulnerabilities', domain: 2 },
  { id: '036', name: 'Supply Chain Vulnerabilities', domain: 2 },
  { id: '037', name: 'Misconfiguration Vulnerabilities', domain: 2 },
  { id: '038', name: 'Mobile Device Vulnerabilities', domain: 2 },
  { id: '039', name: 'Zero-day Vulnerabilities', domain: 2 },
  { id: '040', name: 'An Overview of Malware', domain: 2 },
  { id: '041', name: 'Viruses and Worms', domain: 2 },
  { id: '042', name: 'Spyware and Bloatware', domain: 2 },
  { id: '043', name: 'Other Malware Types', domain: 2 },
  { id: '044', name: 'Physical Attacks', domain: 2 },
  { id: '045', name: 'Denial of Service', domain: 2 },
  { id: '046', name: 'DNS Attacks', domain: 2 },
  { id: '047', name: 'Wireless Attacks', domain: 2 },
  { id: '048', name: 'On-path Attacks', domain: 2 },
  { id: '049', name: 'Replay Attacks', domain: 2 },
  { id: '050', name: 'Malicious Code', domain: 2 },
  { id: '051', name: 'Application Attacks', domain: 2 },
  { id: '052', name: 'Cryptographic Attacks', domain: 2 },
  { id: '053', name: 'Password Attacks', domain: 2 },
  { id: '054', name: 'Indicators of Compromise', domain: 2 },
  { id: '055', name: 'Segmentation and Access Control', domain: 2 },
  { id: '056', name: 'Mitigation Techniques', domain: 2 },
  { id: '057', name: 'Hardening Techniques', domain: 2 },
  { id: '058', name: 'Cloud Infrastructures', domain: 3 },
  { id: '059', name: 'Network Infrastructure Concepts', domain: 3 },
  { id: '060', name: 'Other Infrastructure Concepts', domain: 3 },
  { id: '061', name: 'Infrastructure Considerations', domain: 3 },
  { id: '062', name: 'Secure Infrastructures', domain: 3 },
  { id: '063', name: 'Intrusion Prevention', domain: 3 },
  { id: '064', name: 'Network Appliances', domain: 3 },
  { id: '065', name: 'Port Security', domain: 3 },
  { id: '066', name: 'Firewall Types', domain: 3 },
  { id: '067', name: 'Secure Communication', domain: 3 },
  { id: '068', name: 'Data Types and Classifications', domain: 3 },
  { id: '069', name: 'States of Data', domain: 3 },
  { id: '070', name: 'Protecting Data', domain: 3 },
  { id: '071', name: 'Resiliency', domain: 3 },
  { id: '072', name: 'Capacity Planning', domain: 3 },
  { id: '073', name: 'Recovery Testing', domain: 3 },
  { id: '074', name: 'Backups', domain: 3 },
  { id: '075', name: 'Power Resiliency', domain: 3 },
  { id: '076', name: 'Secure Baselines', domain: 4 },
  { id: '077', name: 'Hardening Targets', domain: 4 },
  { id: '078', name: 'Securing Wireless and Mobile', domain: 4 },
  { id: '079', name: 'Wireless Security Settings', domain: 4 },
  { id: '080', name: 'Application Security', domain: 4 },
  { id: '081', name: 'Asset Management', domain: 4 },
  { id: '082', name: 'Vulnerability Scanning', domain: 4 },
  { id: '083', name: 'Threat Intelligence', domain: 4 },
  { id: '084', name: 'Penetration Testing', domain: 4 },
  { id: '085', name: 'Analyzing Vulnerabilities', domain: 4 },
  { id: '086', name: 'Vulnerability Remediation', domain: 4 },
  { id: '087', name: 'Security Monitoring', domain: 4 },
  { id: '088', name: 'Security Tools', domain: 4 },
  { id: '089', name: 'Firewalls', domain: 4 },
  { id: '090', name: 'Web Filtering', domain: 4 },
  { id: '091', name: 'Operating System Security', domain: 4 },
  { id: '092', name: 'Secure Protocols', domain: 4 },
  { id: '093', name: 'Email Security', domain: 4 },
  { id: '094', name: 'Monitoring Data', domain: 4 },
  { id: '095', name: 'Endpoint Security', domain: 4 },
  { id: '096', name: 'Identity and Access Management', domain: 4 },
  { id: '097', name: 'Access Controls', domain: 4 },
  { id: '098', name: 'Multifactor Authentication', domain: 4 },
  { id: '099', name: 'Password Security', domain: 4 },
  { id: '100', name: 'Scripting and Automation', domain: 4 },
  { id: '101', name: 'Incident Response', domain: 4 },
  { id: '102', name: 'Incident Planning', domain: 4 },
  { id: '103', name: 'Digital Forensics', domain: 4 },
  { id: '104', name: 'Log Data', domain: 4 },
  { id: '105', name: 'Security Policies', domain: 5 },
  { id: '106', name: 'Security Standards', domain: 5 },
  { id: '107', name: 'Security Procedures', domain: 5 },
  { id: '108', name: 'Security Considerations', domain: 5 },
  { id: '109', name: 'Data Roles and Responsibilities', domain: 5 },
  { id: '110', name: 'Risk Management', domain: 5 },
  { id: '111', name: 'Risk Analysis', domain: 5 },
  { id: '112', name: 'Risk Management Strategies', domain: 5 },
  { id: '113', name: 'Business Impact Analysis', domain: 5 },
  { id: '114', name: 'Third-party Risk Assessment', domain: 5 },
  { id: '115', name: 'Agreement Types', domain: 5 },
  { id: '116', name: 'Compliance', domain: 5 },
  { id: '117', name: 'Privacy', domain: 5 },
  { id: '118', name: 'Audits and Assessments', domain: 5 },
  { id: '119', name: 'Penetration Tests', domain: 5 },
  { id: '120', name: 'Security Awareness', domain: 5 },
  { id: '121', name: 'User Training', domain: 5 },
]

// ── Public API ─────────────────────────────────────────────────────────────

export async function getAllTopics(): Promise<TopicProgress[]> {
  return queryAll<TopicProgress>('SELECT * FROM topic_progress ORDER BY topic_id')
}

export async function getTopicsByDomain(domain: number): Promise<TopicProgress[]> {
  return queryAll<TopicProgress>('SELECT * FROM topic_progress WHERE domain = ? ORDER BY topic_id', [domain])
}

export async function getTopic(topicId: string): Promise<TopicProgress | null> {
  return queryOne<TopicProgress>('SELECT * FROM topic_progress WHERE topic_id = ?', [topicId])
}

export async function updateTopicStatus(
  topicId: string,
  status: string,
  quizScore?: number
) {
  if (status === 'passed' || status === 'failed') {
    await run(
      `UPDATE topic_progress SET status = ?, quiz_score = ?, quiz_attempts = quiz_attempts + 1,
       completed_at = CASE WHEN ? = 'passed' THEN now() ELSE completed_at END
       WHERE topic_id = ?`,
      [status, quizScore ?? null, status, topicId]
    )
  } else {
    await run('UPDATE topic_progress SET status = ? WHERE topic_id = ?', [status, topicId])
  }
}

export async function getCompletedCount(): Promise<number> {
  const row = await queryOne<{ c: number }>("SELECT COUNT(*)::int as c FROM topic_progress WHERE status = 'passed'")
  return row?.c ?? 0
}

export async function getAverageScore(): Promise<number | null> {
  const row = await queryOne<{ avg: number | null }>('SELECT AVG(score)::float as avg FROM quiz_attempts')
  return row?.avg != null ? Math.round(row.avg) : null
}

export async function saveQuizAttempt(
  topicId: string,
  score: number,
  questions: unknown[],
  wrongIndices: number[]
) {
  await run(
    'INSERT INTO quiz_attempts (topic_id, score, questions_json, wrong_questions) VALUES (?, ?, ?, ?)',
    [topicId, score, JSON.stringify(questions), JSON.stringify(wrongIndices)]
  )
}

export async function getWeakAreas(includeResolved = false): Promise<WeakArea[]> {
  const sql = includeResolved
    ? 'SELECT * FROM weak_areas ORDER BY wrong_count DESC'
    : 'SELECT * FROM weak_areas WHERE resolved = 0 ORDER BY wrong_count DESC'
  return queryAll<WeakArea>(sql)
}

// Significant-word fingerprint of a concept phrase. Drops grammatical filler and
// light-stems trailing plurals so "exception vs exemption definitional distinction"
// and "exception vs exemption functional distinction" share most of their tokens.
const CONCEPT_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'vs', 'versus', 'of', 'for', 'to', 'in', 'on',
  'when', 'it', 'its', 'their', 'that', 'this', 'is', 'are', 'be', 'with', 'how',
  'what', 'between', 'as', 'by', 'at', 'from',
])

function conceptTokens(concept: string): Set<string> {
  const tokens = concept
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !CONCEPT_STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
  return new Set(tokens)
}

// Jaccard overlap of the two token sets (0–1). Two phrases at/above
// CONCEPT_SIMILARITY_THRESHOLD are treated as the same weak area.
const CONCEPT_SIMILARITY_THRESHOLD = 0.5

export function conceptsAreSimilar(a: string, b: string): boolean {
  const ta = conceptTokens(a)
  const tb = conceptTokens(b)
  if (ta.size === 0 || tb.size === 0) return false
  let shared = 0
  Array.from(ta).forEach((t) => { if (tb.has(t)) shared++ })
  const union = ta.size + tb.size - shared
  return union > 0 && shared / union >= CONCEPT_SIMILARITY_THRESHOLD
}

export async function upsertWeakArea(
  concept: string,
  topicId: string,
  topicName: string,
  domain: number
) {
  // Merge into an existing near-duplicate (same domain) instead of creating a
  // second row for the same idea worded differently — the prompt-level guard in
  // buildWeakAreaPrompt is best-effort, so this is the hard gate against dupes.
  const existing = await queryAll<WeakArea>(
    'SELECT * FROM weak_areas WHERE domain = ? AND resolved = 0',
    [domain]
  )
  const match = existing.find(
    (w) => w.concept === concept || conceptsAreSimilar(w.concept, concept)
  )
  if (match) {
    await run(
      `UPDATE weak_areas SET wrong_count = wrong_count + 1, last_seen = now(), resolved = 0
       WHERE id = ?`,
      [match.id]
    )
    return
  }

  await run(
    `INSERT INTO weak_areas (concept, topic_id, topic_name, domain, wrong_count)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(concept) DO UPDATE SET
       wrong_count = weak_areas.wrong_count + 1,
       last_seen = now(),
       resolved = 0`,
    [concept, topicId, topicName, domain]
  )
}

export async function getWeakAreaById(id: number): Promise<WeakArea | null> {
  return queryOne<WeakArea>('SELECT * FROM weak_areas WHERE id = ?', [id])
}

export async function getWeakAreasByIds(ids: number[]): Promise<WeakArea[]> {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  return queryAll<WeakArea>(`SELECT * FROM weak_areas WHERE id IN (${placeholders})`, ids)
}

export async function resolveWeakArea(id: number) {
  await run('UPDATE weak_areas SET resolved = 1 WHERE id = ?', [id])
}

export async function getNextTopic(): Promise<TopicProgress | null> {
  for (const id of STUDY_ORDER) {
    const t = await queryOne<TopicProgress>(
      "SELECT * FROM topic_progress WHERE topic_id = ? AND status != 'passed'",
      [id]
    )
    if (t) return t
  }
  return null
}

export async function getCourseProgress(): Promise<number> {
  const completed = await getCompletedCount()
  return Math.round((completed / STUDY_ORDER.length) * 100)
}

// NOTE: Reviews are now on-demand and self-paced (per-topic and per-domain), not
// scheduled. The old Leitner-style spaced-repetition engine has been removed. The
// `review_due` / `review_interval` / `review_streak` columns on `topic_progress`
// remain in the schema but are DORMANT — nothing reads or writes them anymore. They
// are left in place to avoid a destructive migration; drop them only via db:init.

// ── Domain quiz ───────────────────────────────────────────────────────────────

// Study-order domain sequence. A domain quiz gates entry into the NEXT group.
const DOMAIN_STUDY_ORDER = [1, 4, 2, 5, 3]

// Last topic ID of each domain group in study order
const DOMAIN_LAST_TOPIC: Record<number, string> = {
  1: '019',
  4: '104',
  2: '057',
  5: '121',
  3: '075',
}

export interface DomainQuizResult {
  domain: number
  passed: number
  best_score: number
  attempts: number
}

export async function getDomainQuizResult(domain: number): Promise<DomainQuizResult | null> {
  return queryOne<DomainQuizResult>('SELECT * FROM domain_quizzes WHERE domain = ?', [domain])
}

export async function saveDomainQuizResult(domain: number, score: number): Promise<void> {
  const passed = score >= 80 ? 1 : 0
  await run(
    `INSERT INTO domain_quizzes (domain, passed, best_score, attempts)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(domain) DO UPDATE SET
       passed = GREATEST(domain_quizzes.passed, ?),
       best_score = GREATEST(domain_quizzes.best_score, ?),
       attempts = domain_quizzes.attempts + 1,
       last_attempted = now()`,
    [domain, passed, score, passed, score]
  )
}

// Returns the domain whose quiz must be passed before the next domain unlocks.
// Returns null if no quiz is currently gating progress.
export async function getDomainQuizPending(): Promise<number | null> {
  for (let i = 0; i < DOMAIN_STUDY_ORDER.length - 1; i++) {
    const domain = DOMAIN_STUDY_ORDER[i]

    // Check if all topics in this domain are passed
    const domainTopics = ALL_TOPICS.filter((t) => t.domain === domain)
    const passedCount = (await queryOne<{ c: number }>(
      `SELECT COUNT(*)::int as c FROM topic_progress WHERE domain = ? AND status = 'passed'`,
      [domain]
    ))?.c ?? 0

    if (passedCount < domainTopics.length) break // Not all done yet — no gate applies

    // All topics done — check if quiz passed
    const quizResult = await queryOne<{ passed: number }>(
      'SELECT passed FROM domain_quizzes WHERE domain = ?',
      [domain]
    )
    if (!quizResult || !quizResult.passed) return domain
    // Quiz passed — continue to check the next domain
  }
  return null
}

export async function markWeakAreaSessionDone(): Promise<void> {
  await run("UPDATE profile SET last_weak_session = ? WHERE id = 1", [localToday()])
}

export async function isWeakAreaSessionDoneToday(): Promise<boolean> {
  const row = await queryOne<{ last_weak_session: string | null }>(
    'SELECT last_weak_session FROM profile WHERE id = 1'
  )
  return row?.last_weak_session === localToday()
}

export async function getDailyPlan(date: string): Promise<string[] | null> {
  const row = await queryOne<{ topic_ids: string }>('SELECT topic_ids FROM daily_plan WHERE date = ?', [date])
  if (!row) return null
  return JSON.parse(row.topic_ids) as string[]
}

export async function saveDailyPlan(date: string, topicIds: string[]): Promise<void> {
  await run(
    `INSERT INTO daily_plan (date, topic_ids) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET topic_ids = EXCLUDED.topic_ids`,
    [date, JSON.stringify(topicIds)]
  )
}

export async function getTopicsCompletedOn(date: string): Promise<string[]> {
  // Compare against the Eastern calendar date so an evening study session counts
  // as one day's work instead of splitting across UTC midnight. `date` is
  // expected to already be an Eastern date string (see localToday()).
  const rows = await queryAll<{ topic_id: string }>(
    "SELECT topic_id FROM topic_progress WHERE status = 'passed' AND (completed_at AT TIME ZONE '" + APP_TZ + "')::date = ?::date",
    [date]
  )
  return rows.map((r) => r.topic_id)
}

// One-off schema creation + topic seeding for the db:init script. NOT called at
// request time — the deployed app only queries existing tables.
export async function seedTopics() {
  await ensureSchema()
}
