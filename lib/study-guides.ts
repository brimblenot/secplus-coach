import fs from 'fs'
import path from 'path'

// Loader for the pre-generated study guides + checkpoints produced offline by
// scripts/build-study-guides.cjs (npm run guides:build). The deployed app serves
// these committed static files verbatim so the normal study path makes no live
// LLM call — see app/api/session/route.ts and app/api/session/checkpoints/route.ts.
// Mirrors lib/transcripts.ts, but returns null (not a placeholder) on a miss so
// callers can cleanly fall back to live generation.

const GUIDES_DIR = path.join(process.cwd(), 'study-guides')

export function getStoredGuide(topicId: string): string | null {
  try {
    const file = path.join(GUIDES_DIR, `${topicId}.md`)
    if (!fs.existsSync(file)) return null
    const content = fs.readFileSync(file, 'utf-8')
    return content.trim() ? content : null
  } catch {
    return null
  }
}

// Returns the parsed { checkpoints: [...] } object (already length-parity +
// answer-balanced at build time), or null if not pre-generated.
export function getStoredCheckpoints(topicId: string): { checkpoints: unknown[] } | null {
  try {
    const file = path.join(GUIDES_DIR, `${topicId}.checkpoints.json`)
    if (!fs.existsSync(file)) return null
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return Array.isArray(parsed?.checkpoints) ? parsed : null
  } catch {
    return null
  }
}
