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

interface Pace {
  finishTopicsBy: string
  examDate: string
  daysUntilFinish: number
  daysUntilExam: number
  finishPastDue: boolean
  topicsRemaining: number
  perDay: number
  doneToday: number
  onPace: boolean
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
  pace: Pace | null
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
  'Am I on pace to finish in time?',
  'What should I focus on today?',
  'Where are my weakest areas?',
]

// Format a YYYY-MM-DD string as "Jul 28" without timezone drift (noon avoids
// the date rolling back a day when parsed as UTC in a western timezone).
function fmtDate(s: string): string {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Dashboard() {
  const [data, setData] = useState<ProgressData | null>(null)
  const [loading, setLoading] = useState(true)

  const [coachHistory, setCoachHistory] = useState<ChatMsg[]>([])
  const [coachInput, setCoachInput] = useState('')
  const [coachLoading, setCoachLoading] = useState(false)
  const coachEndRef = useRef<HTMLDivElement>(null)

  // Pace date editor
  const [editingPace, setEditingPace] = useState(false)
  const [finishInput, setFinishInput] = useState('')
  const [examInput, setExamInput] = useState('')
  const [savingPace, setSavingPace] = useState(false)
  const [paceError, setPaceError] = useState('')

  const loadProgress = useCallback(async () => {
    try {
      const r = await fetch('/api/progress')
      const d = await r.json()
      setData(d)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProgress() }, [loadProgress])

  const openPaceEditor = useCallback(() => {
    if (!data?.pace) return
    setFinishInput(data.pace.finishTopicsBy)
    setExamInput(data.pace.examDate)
    setPaceError('')
    setEditingPace(true)
  }, [data])

  const savePace = useCallback(async () => {
    if (!finishInput || !examInput) { setPaceError('Both dates are required.'); return }
    if (examInput < finishInput) { setPaceError('Exam date should be on or after the finish date.'); return }
    setSavingPace(true)
    setPaceError('')
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finishTopicsBy: finishInput, examDate: examInput }),
      })
      if (!res.ok) throw new Error('save failed')
      await loadProgress()
      setEditingPace(false)
    } catch {
      setPaceError('Could not save. Try again.')
    } finally {
      setSavingPace(false)
    }
  }, [finishInput, examInput, loadProgress])

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
  const pace = data.pace

  const examUrgency = !pace
    ? 'var(--green)'
    : pace.daysUntilExam <= 7 ? 'var(--red)' : pace.daysUntilExam <= 14 ? 'var(--amber)' : 'var(--green)'

  // Course done + exam date reached: the countdown has nothing left to count.
  const examPassed = !!pace && pace.topicsRemaining === 0 && pace.daysUntilExam === 0

  // Pace headline color: red if the finish date has passed with work left,
  // green if today's target is met (or nothing left), amber if still behind.
  const paceColor = !pace || pace.topicsRemaining === 0
    ? 'var(--green)'
    : pace.finishPastDue ? 'var(--red)' : pace.onPace ? 'var(--green)' : 'var(--amber)'

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logo}>SEC+</span>
          <span className={styles.logoSub}>SY0-701 Coach</span>
        </div>
        <div className={styles.headerRight}>
          {/* Once the course is finished and the exam date has passed, the
              countdown is meaningless (it pins at a red "0d"), so show a
              completion chip instead of nagging. */}
          {data.pace && examPassed ? (
            <span
              className={styles.daysBadge}
              style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
            >
              CERTIFIED
            </span>
          ) : data.pace ? (
            <>
              <span className={styles.examDate}>Exam {fmtDate(data.pace.examDate)}</span>
              <span
                className={styles.daysBadge}
                style={{
                  color: examUrgency,
                  borderColor: examUrgency,
                }}
              >
                {data.pace.daysUntilExam}d
              </span>
            </>
          ) : null}
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

        {/* Pace tracker — required topics/day to finish by the target date */}
        {pace && (
          <div className={styles.paceCard}>
            <div className={styles.paceCardHead}>
              <span className={styles.paceCardLabel}>PACE</span>
              {!editingPace && (
                <button className={styles.paceEditBtn} onClick={openPaceEditor}>Edit dates</button>
              )}
            </div>

            {!editingPace ? (
              <>
                {pace.topicsRemaining === 0 ? (
                  <div className={styles.paceHero}>
                    <span className={styles.paceHeroNum} style={{ color: 'var(--green)' }}>✓</span>
                    <div className={styles.paceHeroInfo}>
                      <span className={styles.paceHeroLabel}>All topics complete — you&apos;re ready to review</span>
                      <span className={styles.paceHeroSub}>Exam in {pace.daysUntilExam} day{pace.daysUntilExam === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                ) : (
                  <div className={styles.paceHero}>
                    <span className={styles.paceHeroNum} style={{ color: paceColor }}>{pace.perDay}</span>
                    <div className={styles.paceHeroInfo}>
                      <span className={styles.paceHeroLabel}>
                        topic{pace.perDay === 1 ? '' : 's'}/day to finish {pace.finishPastDue ? 'now' : `by ${fmtDate(pace.finishTopicsBy)}`}
                      </span>
                      <span className={styles.paceHeroSub}>
                        {pace.topicsRemaining} left
                        {' · '}
                        {pace.finishPastDue
                          ? 'finish date passed'
                          : `${pace.daysUntilFinish} day${pace.daysUntilFinish === 1 ? '' : 's'} left`}
                        {' · '}
                        <span style={{ color: pace.doneToday >= pace.perDay ? 'var(--green)' : 'var(--text-3)' }}>
                          {pace.doneToday}/{pace.perDay} done today
                        </span>
                      </span>
                    </div>
                  </div>
                )}

                <div className={styles.paceFooter}>
                  <span className={styles.paceFooterItem}>🎯 Finish topics <strong>{fmtDate(pace.finishTopicsBy)}</strong></span>
                  <span className={styles.paceFooterItem}>📝 Exam <strong>{fmtDate(pace.examDate)}</strong> · {pace.daysUntilExam}d</span>
                </div>
              </>
            ) : (
              <div className={styles.paceEditor}>
                <label className={styles.paceField}>
                  <span className={styles.paceFieldLabel}>Finish all topics by</span>
                  <input
                    type="date"
                    className={styles.paceInput}
                    value={finishInput}
                    onChange={(e) => setFinishInput(e.target.value)}
                  />
                </label>
                <label className={styles.paceField}>
                  <span className={styles.paceFieldLabel}>Exam date</span>
                  <input
                    type="date"
                    className={styles.paceInput}
                    value={examInput}
                    onChange={(e) => setExamInput(e.target.value)}
                  />
                </label>
                {paceError && <span className={styles.paceErr}>{paceError}</span>}
                <div className={styles.paceEditorBtns}>
                  <button className={styles.paceCancelBtn} onClick={() => setEditingPace(false)} disabled={savingPace}>
                    Cancel
                  </button>
                  <button className={styles.paceSaveBtn} onClick={savePace} disabled={savingPace}>
                    {savingPace ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
            <span className={styles.nextDomain}>Exam acronyms + ports &amp; protocols — flip &amp; drill</span>
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
