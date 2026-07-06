'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import styles from '../flashcards.module.css'

type Flashcard = {
  term: string
  expansion: string
  definition: string
  domain: number
  topicId: string
  type?: 'port'
}

type Filter = 'all' | 1 | 2 | 3 | 4 | 5 | 'ports'

const DOMAIN_NAMES: Record<number, string> = {
  1: 'General Security Concepts',
  2: 'Threats, Vulnerabilities & Mitigations',
  3: 'Security Architecture',
  4: 'Security Operations',
  5: 'Security Program Management',
}

const DOMAIN_COLORS: Record<number, string> = {
  1: '#00d4a0',
  2: '#f0a020',
  3: '#4080f0',
  4: '#9060f0',
  5: '#f04060',
}

// Fisher–Yates shuffle (returns a new array).
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function FlashcardsPage() {
  const [allCards, setAllCards] = useState<Flashcard[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [domain, setDomain] = useState<Filter>('all')

  // Drill state (client-only, per session).
  const [pile, setPile] = useState<Flashcard[]>([])
  const [flipped, setFlipped] = useState(false)
  const [mastered, setMastered] = useState(0)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    fetch('/api/flashcards')
      .then((r) => r.json())
      .then((d) => {
        setAllCards(Array.isArray(d.cards) ? d.cards : [])
        setLoading(false)
      })
      .catch(() => { setFailed(true); setLoading(false) })
  }, [])

  const filtered = useMemo(() => {
    if (domain === 'all') return allCards
    if (domain === 'ports') return allCards.filter((c) => c.type === 'port')
    // Numbered domains: acronym cards only (port cards carry no domain).
    return allCards.filter((c) => c.type !== 'port' && c.domain === domain)
  }, [allCards, domain])

  // (Re)start a drill whenever the filtered set changes (initial load or domain switch).
  const restart = useCallback(() => {
    setPile(shuffle(filtered))
    setFlipped(false)
    setMastered(0)
    setTotal(filtered.length)
  }, [filtered])

  useEffect(() => { restart() }, [restart])

  const current = pile[0] ?? null

  const gotIt = () => {
    setPile((prev) => prev.slice(1))
    setMastered((m) => m + 1)
    setFlipped(false)
  }

  const stillLearning = () => {
    setPile((prev) => (prev.length <= 1 ? prev : [...prev.slice(1), prev[0]]))
    setFlipped(false)
  }

  const domains: Filter[] = ['all', 1, 2, 3, 4, 5, 'ports']
  const chipLabel = (d: Filter) => (d === 'all' ? 'All' : d === 'ports' ? 'Ports' : `D${d}`)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Dashboard</Link>
        <span className={styles.title}>ACRONYM FLASHCARDS</span>
      </header>

      <main className={styles.main}>
        {/* Domain filter */}
        <div className={styles.filters}>
          {domains.map((d) => {
            const activeColor = typeof d === 'number' ? DOMAIN_COLORS[d] : d === 'ports' ? 'var(--blue)' : undefined
            return (
              <button
                key={d}
                className={`${styles.filterChip} ${domain === d ? styles.filterActive : ''}`}
                style={domain === d && activeColor ? { borderColor: activeColor, color: activeColor } : undefined}
                onClick={() => setDomain(d)}
              >
                {chipLabel(d)}
              </button>
            )
          })}
        </div>

        {loading && (
          <div className={styles.state}><span className={styles.dot} /> Loading cards…</div>
        )}

        {!loading && failed && (
          <div className={styles.state}>Couldn&apos;t load flashcards. Is the server running?</div>
        )}

        {!loading && !failed && total === 0 && (
          <div className={styles.state}>No cards for this domain yet.</div>
        )}

        {/* Active drill */}
        {!loading && !failed && current && (
          <>
            <div className={styles.progressRow}>
              <span className={styles.progressMeta}>{mastered} mastered</span>
              <span className={styles.progressSep}>·</span>
              <span className={styles.progressMeta}>{pile.length} left</span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${total > 0 ? (mastered / total) * 100 : 0}%` }}
              />
            </div>

            <button
              className={`${styles.card} ${flipped ? styles.cardFlipped : ''}`}
              onClick={() => setFlipped((f) => !f)}
              aria-label="Flip card"
            >
              <span
                className={styles.cardDomain}
                style={{ color: current.type === 'port' ? 'var(--blue)' : DOMAIN_COLORS[current.domain] }}
              >
                {current.type === 'port'
                  ? 'PORT / PROTOCOL'
                  : `D${current.domain} — ${DOMAIN_NAMES[current.domain]}`}
              </span>

              {!flipped ? (
                <>
                  <span className={styles.term}>{current.term}</span>
                  <span className={styles.hint}>tap to reveal</span>
                </>
              ) : (
                <>
                  <span className={styles.expansion}>{current.expansion}</span>
                  <span className={styles.definition}>{current.definition}</span>
                </>
              )}
            </button>

            <div className={styles.actions}>
              <button
                className={`${styles.rate} ${styles.rateAgain}`}
                onClick={stillLearning}
                disabled={!flipped}
              >
                Still learning
              </button>
              <button
                className={`${styles.rate} ${styles.rateGot}`}
                onClick={gotIt}
                disabled={!flipped}
              >
                Got it
              </button>
            </div>
            {!flipped && <div className={styles.rateHint}>Flip the card to rate it</div>}
          </>
        )}

        {/* Completion */}
        {!loading && !failed && total > 0 && !current && (
          <div className={styles.done}>
            <span className={styles.doneCheck}>✓</span>
            <span className={styles.doneTitle}>Cleared {total} card{total > 1 ? 's' : ''}</span>
            <span className={styles.doneSub}>
              {domain === 'all' ? 'The whole deck' : domain === 'ports' ? 'Ports & protocols' : `Domain ${domain}`} — nicely done.
            </span>
            <button className={styles.restart} onClick={restart}>Drill again</button>
          </div>
        )}
      </main>
    </div>
  )
}
