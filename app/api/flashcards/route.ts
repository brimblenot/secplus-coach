import { NextRequest, NextResponse } from 'next/server'
import cards from '@/lib/flashcards.json'

// Static, scope-locked acronym flashcards generated once, offline, by
// scripts/extract-acronyms.cjs (`npm run flashcards:build`). No model, no DB —
// this route just serves the committed JSON, optionally filtered by domain.

export type Flashcard = {
  term: string
  expansion: string
  definition: string
  domain: number
  topicId: string
  type?: 'port'
}

export async function GET(req: NextRequest) {
  const all = cards as Flashcard[]
  const domainParam = req.nextUrl.searchParams.get('domain')
  if (domainParam) {
    const d = parseInt(domainParam, 10)
    if (!Number.isNaN(d)) {
      return NextResponse.json({ cards: all.filter((c) => c.domain === d) })
    }
  }
  return NextResponse.json({ cards: all })
}
