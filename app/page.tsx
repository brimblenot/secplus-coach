'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './dashboard.module.css'

interface DomainStat {
  domain: number
  total: number
  completed: number
  avgScore: number | null
}

interface WeakArea {
  id: number
  concept: string
  topic_name: string
  wrong_count: number
}

interface NextTopic {
  topic_id: string
  topic_name: string
  domain: number
}

interface CompletedTopic {
  id: string
  name: string
}

interface ProgressData {
  completedCount: number
  totalTopics: number
  courseProgress: number
  avgScore: number | null
  nextTopic: NextTopic | null
  weakAreas: WeakArea[]
  domainStats: DomainStat[]
  domainQuizPending: number | null
  weakAreaSessionDoneToday: boolean
  topicsRemaining: number
  completedTodayTopics: CompletedTopic[]
}

type ChatMsg = { role: 'user' | 'assistant'; content: string }

const DOMAIN_NAMES: Record<number, string> = {
  1: 'General Security Concepts',
  2: 'Threats, Vulnerabilities & Mitigations',
  3: 'Security Architecture',
  4: 'Security Operations',
  5: 'Security Program Management',
}

const DOMAIN_WEIGHTS: Record<number, string> = {
  1: '12%',
  2: '22%',
  3: '18%',
  4: '28%',
  5: '20%',
}

const DOMAIN_COLORS: Record<number, string> = {
  1: '#00d4a0',
  2: '#f0a020',
  3: '#4080f0',
  4: '#9060f0',
  5: '#f04060',
}

const SUGGESTIONS = [
  'What should I focus on today?',
  'Where are my weakest areas?',
  'How much do I have left?',
]

export default function Dashboard() {
  const [data, setData] = useState<ProgressData | null>(null)
  const [loading, setLoading] = useState(true)

  const [coachHistory, setCoachHistory] = useState<ChatMsg[]>([])
  const [coachInput, setCoachInput] = useState('')
  const [coachLoading, setCoachLoading] = useState(false)
  const coachEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/progress')
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    coachEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [coachHistory])

  const sendCoach = useCallback(async (question: string) => {
    if (!question.trim() || coachLoading || !data) return
    setCoachInput('')

    const prev = coachHistory
    const withUser: ChatMsg[] = [...prev, { role: 'user', content: question }]
    setCoachHistory([...withUser, { role: 'assistant', content: '' }])
    setCoachLoading(true)

    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: prev, context: data }),
      })
      if (!res.ok) throw new Error('Coach unavailable')
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let text = ''
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setCoachHistory([...withUser, { role: 'assistant', content: text }])
      }
      text += decoder.decode()
      setCoachHistory([...withUser, { role: 'assistant', content: text }])
    } catch {
      setCoachHistory([...withUser, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setCoachLoading(false)
    }
  }, [coachHistory, coachLoading, data])

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingDot} />
        <span>Loading...</span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={styles.loadingScreen}>
        <span className={styles.errorText}>Failed to load. Is the server running?</span>
      </div>
    )
  }

  const topicsRemaining = data.topicsRemaining ?? (data.totalTopics - data.completedCount)
  const completedToday = data.completedTodayTopics ?? []

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logo}>SEC+</span>
          <span className={styles.logoSub}>SY0-701 Coach</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.selfPacedBadge}>Self-paced</span>
        </div>
      </header>

      <main className={styles.main}>

        {/* Coach */}
        <div className={styles.coachCard}>
          <div className={styles.coachHeader}>
            <span className={styles.coachLabel}>COACH</span>
            <span className={styles.coachSub}>Ask about your progress, strategy, or next steps</span>
          </div>

          {coachHistory.length > 0 && (
            <div className={styles.coachMessages}>
              {coachHistory.map((msg, i) => (
                <div key={i} className={msg.role === 'user' ? styles.coachMsgUser : styles.coachMsgAI}>
                  <span className={styles.coachMsgRole}>{msg.role === 'user' ? 'You' : 'Coach'}</span>
                  {msg.role === 'user'
                    ? <span className={styles.coachMsgText}>{msg.content}</span>
                    : <div className={`${styles.coachMsgText} chat-md-content`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                  }
                </div>
              ))}
              <div ref={coachEndRef} />
            </div>
          )}

          {coachHistory.length === 0 && (
            <div className={styles.coachSuggestions}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className={styles.coachSuggestion} onClick={() => sendCoach(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className={styles.coachInputRow}>
            <input
              className={styles.coachInput}
              type="text"
              value={coachInput}
              onChange={(e) => setCoachInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendCoach(coachInput) }}
              placeholder="Ask your coach anything…"
              disabled={coachLoading}
            />
            <button
              className={styles.coachSend}
              onClick={() => sendCoach(coachInput)}
              disabled={!coachInput.trim() || coachLoading}
            >
              {coachLoading ? '…' : 'Ask →'}
            </button>
          </div>
        </div>

        {/* Calm status line — informational, no quota or pressure */}
        <div className={styles.paceRow}>
          <span className={styles.paceMeta}>{topicsRemaining} topics remaining</span>
          <span className={styles.paceSep}>·</span>
          <span className={styles.paceMeta}>{completedToday.length} done today</span>
          <span className={styles.paceSep}>·</span>
          <span className={styles.paceMeta}>study at your own pace</span>
        </div>

        {/* Next topic CTA — always available, never locked */}
        {data.nextTopic && (
          <Link href={`/session/${data.nextTopic.topic_id}`} className={styles.nextTopicCard}>
            <div className={styles.nextTopicLeft}>
              <span className={styles.nextLabel}>UP NEXT</span>
              <span className={styles.nextName}>{data.nextTopic.topic_name}</span>
              <span className={styles.nextDomain}>
                Domain {data.nextTopic.domain} — {DOMAIN_NAMES[data.nextTopic.domain]}
              </span>
            </div>
            <div className={styles.nextArrow}>→</div>
          </Link>
        )}

        {/* Completed today */}
        {completedToday.length > 0 && (
          <div className={styles.additionalCard}>
            <span className={styles.additionalLabel}>COMPLETED TODAY — {completedToday.length} topic{completedToday.length > 1 ? 's' : ''}</span>
            <div className={styles.additionalList}>
              {completedToday.map((t) => (
                <div key={t.id} className={styles.additionalItem}>
                  <span className={styles.additionalCheck}>✓</span>
                  <span className={styles.additionalName}>{t.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Practice */}
        <Link href="/quiz/random" className={styles.randomQuizCard}>
          <div className={styles.nextTopicLeft}>
            <span className={styles.nextLabel}>PRACTICE</span>
            <span className={styles.nextName}>Random Quiz</span>
            <span className={styles.nextDomain}>10 questions × 5 domains — full coverage</span>
          </div>
          <div className={styles.nextArrow}>⚡</div>
        </Link>

        {/* Flashcards */}
        <Link href="/flashcards" className={styles.randomQuizCard}>
          <div className={styles.nextTopicLeft}>
            <span className={styles.nextLabel}>MEMORIZE</span>
            <span className={styles.nextName}>Acronym Flashcards</span>
            <span className={styles.nextDomain}>Every abbreviation from your lectures — flip &amp; drill</span>
          </div>
          <div className={styles.nextArrow}>🃏</div>
        </Link>

        {/* Metrics strip */}
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricVal} style={{ color: 'var(--green)' }}>
              {data.completedCount}
              <span className={styles.metricOf}>/{data.totalTopics}</span>
            </span>
            <span className={styles.metricLabel}>Topics done</span>
          </div>
          <div className={styles.metric}>
            <span
              className={styles.metricVal}
              style={{ color: data.avgScore ? (data.avgScore >= 70 ? 'var(--green)' : 'var(--red)') : 'var(--text-3)' }}
            >
              {data.avgScore !== null ? `${data.avgScore}%` : '—'}
            </span>
            <span className={styles.metricLabel}>Quiz avg</span>
          </div>
          <div className={styles.metric}>
            <span
              className={styles.metricVal}
              style={{ color: (data.weakAreas?.length ?? 0) > 0 ? 'var(--amber)' : 'var(--text-3)' }}
            >
              {data.weakAreas?.length ?? 0}
            </span>
            <span className={styles.metricLabel}>Weak areas</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricVal} style={{ color: 'var(--text)' }}>
              {data.courseProgress}%
            </span>
            <span className={styles.metricLabel}>Complete</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${data.courseProgress}%` }} />
        </div>

        {/* Domain grid */}
        <div className={styles.sectionLabel}>DOMAINS</div>
        <div className={styles.domainGrid}>
          {data.domainStats.map((d) => {
            const pct = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0
            const color = DOMAIN_COLORS[d.domain]
            return (
              <Link key={d.domain} href={`/domain/${d.domain}`} className={styles.domainCard}>
                <div className={styles.domainTop}>
                  <span className={styles.domainNum} style={{ color }}>D{d.domain}</span>
                  <span className={styles.domainWeight}>{DOMAIN_WEIGHTS[d.domain]}</span>
                </div>
                <div className={styles.domainName}>{DOMAIN_NAMES[d.domain]}</div>
                <div className={styles.domainBar}>
                  <div className={styles.domainBarFill} style={{ width: `${pct}%`, background: color }} />
                </div>
                <div className={styles.domainStats}>
                  <span>{d.completed}/{d.total}</span>
                  {d.avgScore !== null && <span>{d.avgScore}% avg</span>}
                </div>
              </Link>
            )
          })}
        </div>

        {/* Domain quiz gate */}
        {data.domainQuizPending !== null && (
          <>
            <div className={styles.sectionLabel}>DOMAIN QUIZ REQUIRED</div>
            <Link href={`/quiz/domain/${data.domainQuizPending}`} className={styles.domainQuizGateCard}>
              <div className={styles.nextTopicLeft}>
                <span className={styles.nextLabel} style={{ color: 'var(--blue)' }}>DOMAIN MASTERY QUIZ</span>
                <span className={styles.nextName}>Domain {data.domainQuizPending} Cumulative Quiz</span>
                <span className={styles.nextDomain}>Pass 80% to unlock the next domain</span>
              </div>
              <div className={styles.nextArrow} style={{ color: 'var(--blue)' }}>→</div>
            </Link>
          </>
        )}

        {/* Weak areas */}
        {data.weakAreas.length > 0 && (
          <>
            <div className={styles.sectionLabel}>⚠ WEAK AREAS</div>
            <Link href="/weak-area-session" className={styles.weakSessionCard}>
              <div className={styles.weakSessionLeft}>
                <span className={styles.weakSessionCount}>{data.weakAreas.length}</span>
                <div className={styles.weakSessionInfo}>
                  <span className={styles.weakSessionTitle}>
                    {data.weakAreas.length} concept{data.weakAreas.length > 1 ? 's' : ''} to review
                  </span>
                  <span className={styles.weakSessionSub}>
                    {data.weakAreas.slice(0, 3).map((w) => w.concept).join(', ')}
                    {data.weakAreas.length > 3 ? ` +${data.weakAreas.length - 3} more` : ''}
                  </span>
                </div>
              </div>
              <div className={styles.weakSessionCta}>Start Session →</div>
            </Link>
          </>
        )}
      </main>
    </div>
  )
}
