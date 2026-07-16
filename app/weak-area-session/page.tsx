'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './session.module.css'
import GuideHelper from '../components/GuideHelper'

interface WeakArea {
  id: number
  concept: string
  topic_id: string
  topic_name: string
  domain: number
  wrong_count: number
}

interface WeakAreaGroup {
  topicId: string
  topicName: string
  domain: number
  areas: WeakArea[]
  maxWrongCount: number
}

interface MCQuestion {
  id: number
  type: 'mc'
  question: string
  options: Record<string, string>
  correct: string
  explanation: string
}

interface TextQuestion {
  id: number
  type: 'text'
  question: string
  rubric: string
  explanation: string
}

type Question = MCQuestion | TextQuestion

// In-lecture comprehension checks: one per guide section, from /api/session/checkpoints
interface MCCheckpoint {
  section: string
  type: 'mc'
  question: string
  options: Record<string, string>
  correct: string
  explanation: string
}
interface TextCheckpoint {
  section: string
  type: 'text'
  question: string
  rubric: string
  explanation: string
}
type Checkpoint = MCCheckpoint | TextCheckpoint

type SessionPhase =
  | 'loading'
  | 'overview'
  | 'area-guide'
  | 'area-quiz'
  | 'area-second-chance'
  | 'area-transition'
  | 'summary'

const normHeading = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// Split a guide into its intro (everything before the first "### ") and its "### "
// sections (heading + raw markdown, heading line included so it re-renders). Same
// contract as the main study session — the weak-area guide is generated to match.
function parseGuide(md: string): { introMd: string; sections: { heading: string; raw: string }[] } {
  const sections: { heading: string; raw: string }[] = []
  const intro: string[] = []
  let cur: { heading: string; lines: string[] } | null = null
  for (const line of md.split('\n')) {
    const m = /^###\s+(.*)$/.exec(line)
    if (m) {
      if (cur) sections.push({ heading: cur.heading, raw: cur.lines.join('\n') })
      cur = { heading: m[1].trim(), lines: [line] }
    } else if (cur) {
      cur.lines.push(line)
    } else {
      intro.push(line)
    }
  }
  if (cur) sections.push({ heading: cur.heading, raw: cur.lines.join('\n') })
  return { introMd: intro.join('\n').trim(), sections }
}

function getWeakLevel(wrongCount: number) {
  if (wrongCount >= 4) return { label: 'HIGH', color: 'var(--red)', bg: 'var(--red-dim)', border: 'var(--red-border)' }
  if (wrongCount >= 2) return { label: 'MED', color: 'var(--amber)', bg: 'var(--amber-dim)', border: 'var(--amber-border)' }
  return { label: 'LOW', color: 'var(--text-3)', bg: 'var(--bg-3)', border: 'var(--border)' }
}

function getMcCount(wrongCount: number): number {
  if (wrongCount >= 4) return 5
  if (wrongCount >= 2) return 3
  return 1
}

// Mirror of MAX_MC in app/api/weak-area/quiz/route.ts so the question-count preview
// matches the quiz the route actually generates.
const MAX_MC = 5
function cappedMcCount(areaCount: number, maxWrongCount: number): number {
  return Math.min(MAX_MC, Math.max(areaCount, getMcCount(maxWrongCount)))
}

function groupByTopic(areas: WeakArea[]): WeakAreaGroup[] {
  const map = new Map<string, WeakArea[]>()
  for (const area of areas) {
    if (!map.has(area.topic_id)) map.set(area.topic_id, [])
    map.get(area.topic_id)!.push(area)
  }
  return Array.from(map.values())
    .map((groupAreas) => ({
      topicId: groupAreas[0].topic_id,
      topicName: groupAreas[0].topic_name,
      domain: groupAreas[0].domain,
      areas: groupAreas,
      maxWrongCount: Math.max(...groupAreas.map((a) => a.wrong_count)),
    }))
    .sort((a, b) => b.maxWrongCount - a.maxWrongCount)
}

function estimateMinutes(groups: WeakAreaGroup[]): number {
  return groups.reduce((total, g) => total + cappedMcCount(g.areas.length, g.maxWrongCount) + 2 + 3, 0)
}

const inlineP = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> }

export default function WeakAreaSessionPage() {
  const [phase, setPhase] = useState<SessionPhase>('loading')
  const [groups, setGroups] = useState<WeakAreaGroup[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)

  // Guide state
  const [guideContent, setGuideContent] = useState('')

  // Section-by-section checkpoint reading (mirrors the main study session)
  const [introMd, setIntroMd] = useState('')
  const [sections, setSections] = useState<{ heading: string; raw: string }[]>([])
  const [checkpoints, setCheckpoints] = useState<(Checkpoint | null)[]>([])
  const [visibleCount, setVisibleCount] = useState(1)
  const [cpMc, setCpMc] = useState<Record<number, string>>({})
  const [cpText, setCpText] = useState<Record<number, string>>({})
  const [cpTextGrading, setCpTextGrading] = useState<number | null>(null)
  const [cpTextResult, setCpTextResult] = useState<Record<number, { passed: boolean; feedback: string }>>({})

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([])
  const [quizError, setQuizError] = useState('')
  const [currentQ, setCurrentQ] = useState(0)
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({})
  const [answered, setAnswered] = useState(false)

  // Text question state (per index so text can be scored alongside MC at the end)
  const [textAnswer, setTextAnswer] = useState('')
  const [textGrading, setTextGrading] = useState(false)
  const [textGradeResult, setTextGradeResult] = useState<{ passed: boolean; feedback: string } | null>(null)
  const [textResults, setTextResults] = useState<Record<number, { passed: boolean; feedback: string }>>({})

  // Second-chance (makeup) state — rephrases each miss instead of failing the group
  const [secondChanceQs, setSecondChanceQs] = useState<Question[]>([])
  const [scIdx, setScIdx] = useState(0)
  const [scAnswers, setScAnswers] = useState<Record<number, string>>({})
  const [scAnswered, setScAnswered] = useState(false)
  const [scTextAnswer, setScTextAnswer] = useState('')
  const [scTextGrading, setScTextGrading] = useState(false)
  const [scTextResults, setScTextResults] = useState<Record<number, { passed: boolean; feedback: string }>>({})

  // Results tracking (per group)
  const [sessionResults, setSessionResults] = useState<{ topicId: string; label: string; resolved: boolean }[]>([])

  useEffect(() => {
    fetch('/api/progress')
      .then((r) => r.json())
      .then((data) => {
        const areas: WeakArea[] = data.weakAreas ?? []
        const grouped = groupByTopic(areas)
        setGroups(grouped)
        setPhase(grouped.length > 0 ? 'overview' : 'summary')
      })
  }, [])

  const currentGroup = groups[currentIdx]

  // ── Start guide for current group ─────────────────────────────────────────
  function startGuide() {
    setGuideContent('')
    setIntroMd('')
    setSections([])
    setCheckpoints([])
    setVisibleCount(1)
    setCpMc({})
    setCpText({})
    setCpTextResult({})
    setCpTextGrading(null)
    setPhase('area-guide')

    // Buffer the whole guide, then render it once. Painting each streamed chunk as
    // it arrived made the text appear in ugly jerks; the user reads it all at once
    // anyway, so we wait for the full response, then split it into sections.
    fetch('/api/weak-area/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weakAreaIds: currentGroup.areas.map((a) => a.id) }),
    }).then(async (res) => {
      if (!res.ok) { setGuideContent('Error loading explanation.'); return }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
      }
      buf += decoder.decode()
      setGuideContent(buf)
      loadCheckpoints(buf, currentGroup.topicName)
    })
  }

  // ── Checkpoint reading ──────────────────────────────────────────────────────
  // Parse the guide into sections and fetch one comprehension check per section.
  // On any failure we reveal the whole guide unblocked (checks are practice, not a gate).
  const loadCheckpoints = async (guideText: string, name: string) => {
    const { introMd: intro, sections: secs } = parseGuide(guideText)
    setIntroMd(intro)
    setSections(secs)
    setVisibleCount(1)
    setCpMc({})
    setCpText({})
    setCpTextResult({})
    setCpTextGrading(null)
    if (secs.length === 0) { setCheckpoints([]); return }

    try {
      const res = await fetch('/api/session/checkpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guideContent: guideText, topicName: name }),
      })
      if (!res.ok) throw new Error('checkpoints failed')
      const data = await res.json()
      const cps: Checkpoint[] = Array.isArray(data.checkpoints) ? data.checkpoints : []
      const aligned = secs.map(
        (s) => cps.find((c) => normHeading(c.section || '') === normHeading(s.heading)) || null
      )
      setCheckpoints(aligned)
    } catch {
      // Couldn't generate checks — don't trap the reader. Reveal everything, no checks.
      setCheckpoints(secs.map(() => null))
      setVisibleCount(secs.length)
    }
  }

  const checkpointsReady = sections.length > 0 && checkpoints.length === sections.length
  const cpFor = (i: number): Checkpoint | null => checkpoints[i] ?? null
  const cpAnswered = (i: number): boolean => {
    const cp = cpFor(i)
    if (!cp) return true
    return cp.type === 'mc' ? cpMc[i] != null : !!cpTextResult[i]
  }

  const handleCpMc = (i: number, letter: string) => {
    if (cpMc[i] != null) return
    setCpMc((prev) => ({ ...prev, [i]: letter }))
  }

  const gradeCpText = async (i: number) => {
    const cp = cpFor(i)
    if (!cp || cp.type !== 'text') return
    const ans = (cpText[i] || '').trim()
    if (!ans) return
    setCpTextGrading(i)
    try {
      const res = await fetch('/api/quiz/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: cp.question, correctAnswer: cp.rubric, explanation: cp.explanation, userText: ans }),
      })
      if (res.ok) {
        const result = await res.json()
        setCpTextResult((prev) => ({ ...prev, [i]: result }))
      }
    } finally {
      setCpTextGrading(null)
    }
  }

  const advanceSection = () => setVisibleCount((c) => Math.min(c + 1, sections.length))
  const allSectionsRevealed = sections.length === 0 || visibleCount >= sections.length
  const lastSectionAnswered = sections.length === 0 || (checkpointsReady && cpAnswered(sections.length - 1))

  // ── Start quiz for current group ──────────────────────────────────────────
  async function startQuiz() {
    setPhase('loading')
    setQuizError('')
    setUserAnswers({})
    setCurrentQ(0)
    setAnswered(false)
    setTextAnswer('')
    setTextGradeResult(null)
    setTextResults({})
    setSecondChanceQs([])
    setScIdx(0)
    setScAnswers({})
    setScAnswered(false)
    setScTextAnswer('')
    setScTextResults({})

    try {
      const res = await fetch('/api/weak-area/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weakAreaIds: currentGroup.areas.map((a) => a.id) }),
      })
      if (!res.ok) throw new Error(`Quiz generation failed (${res.status})`)

      const data = await res.json()
      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error('Quiz came back empty')
      }
      setQuestions(data.questions)
      setPhase('area-quiz')
    } catch {
      // Surface the failure on the guide instead of silently bouncing.
      setQuizError('Could not generate the quiz. Tap Start Quiz to try again.')
      setPhase('area-guide')
    }
  }

  // ── MC answer ────────────────────────────────────────────────────────────
  const handleMCAnswer = (letter: string) => {
    if (answered) return
    setUserAnswers((prev) => ({ ...prev, [currentQ]: letter }))
    setAnswered(true)
  }

  // ── Text answer ──────────────────────────────────────────────────────────
  const gradeTextAnswer = async () => {
    const q = questions[currentQ]
    if (!q || q.type !== 'text' || !textAnswer.trim()) return
    setTextGrading(true)
    try {
      const res = await fetch('/api/quiz/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q.question,
          correctAnswer: (q as TextQuestion).rubric,
          explanation: q.explanation,
          userText: textAnswer,
        }),
      })
      if (res.ok) {
        const result = await res.json()
        setTextGradeResult(result)
        setTextResults((prev) => ({ ...prev, [currentQ]: result }))
        setAnswered(true)
      }
    } finally {
      setTextGrading(false)
    }
  }

  // ── Resolve the current group + advance ───────────────────────────────────
  // A group resolves only when nothing was still wrong after the makeup round.
  const finishGroup = async (resolved: boolean) => {
    if (resolved) {
      for (const area of currentGroup.areas) {
        await fetch('/api/weak-areas', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: area.id }),
        })
      }
    }

    const label = currentGroup.areas.length === 1
      ? currentGroup.areas[0].concept
      : `${currentGroup.topicName} (${currentGroup.areas.length} concepts)`

    setSessionResults((prev) => [...prev, { topicId: currentGroup.topicId, label, resolved }])

    const nextIdx = currentIdx + 1
    if (nextIdx < groups.length) {
      setCurrentIdx(nextIdx)
      setPhase('area-transition')
    } else {
      fetch('/api/weak-areas/complete', { method: 'POST' }).catch(() => {})
      setPhase('summary')
    }
  }

  // ── Next question / launch makeup or finish group ─────────────────────────
  const nextQuestion = async () => {
    setTextAnswer('')
    setTextGradeResult(null)

    if (currentQ < questions.length - 1) {
      setCurrentQ((p) => p + 1)
      setAnswered(false)
      return
    }

    // Score EVERY question — MC (auto) and text (AI-graded). Any wrong answer of
    // either type goes to the makeup round rather than failing the whole group.
    const wrong: number[] = []
    questions.forEach((q, i) => {
      const ok = q.type === 'text'
        ? !!textResults[i]?.passed
        : userAnswers[i] === (q as MCQuestion).correct
      if (!ok) wrong.push(i)
    })

    if (wrong.length === 0) {
      await finishGroup(true)
      return
    }

    // Something was missed — offer a rephrased second-chance on the same concepts.
    setPhase('loading')
    const wrongQs = wrong.map((i) => {
      const q = questions[i]
      return q.type === 'text'
        ? { type: 'text', question: q.question, rubric: (q as TextQuestion).rubric, explanation: q.explanation }
        : { type: 'mc', question: q.question, options: (q as MCQuestion).options, correct: (q as MCQuestion).correct, explanation: q.explanation }
    })
    try {
      const res = await fetch('/api/quiz/second-chance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wrongQuestions: wrongQs, topicName: currentGroup.topicName }),
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.questions) && data.questions.length > 0) {
          setSecondChanceQs(data.questions)
          setScIdx(0)
          setScAnswers({})
          setScAnswered(false)
          setScTextAnswer('')
          setScTextResults({})
          setPhase('area-second-chance')
          return
        }
      }
    } catch { /* fall through */ }
    // Makeup couldn't be generated — keep the group flagged for next time.
    await finishGroup(false)
  }

  // ── Second-chance handlers ────────────────────────────────────────────────
  const handleSCAnswer = (letter: string) => {
    if (scAnswered) return
    setScAnswers((prev) => ({ ...prev, [scIdx]: letter }))
    setScAnswered(true)
  }

  const gradeSCTextAnswer = async () => {
    const scQ = secondChanceQs[scIdx]
    if (!scQ || scQ.type !== 'text' || !scTextAnswer.trim()) return
    setScTextGrading(true)
    try {
      const res = await fetch('/api/quiz/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: scQ.question,
          correctAnswer: (scQ as TextQuestion).rubric,
          explanation: scQ.explanation,
          userText: scTextAnswer,
        }),
      })
      if (res.ok) {
        const result = await res.json()
        setScTextResults((prev) => ({ ...prev, [scIdx]: result }))
        setScAnswered(true)
      }
    } finally {
      setScTextGrading(false)
    }
  }

  const scIsCorrect = (i: number): boolean => {
    const scQ = secondChanceQs[i]
    if (!scQ) return false
    return scQ.type === 'text' ? !!scTextResults[i]?.passed : scAnswers[i] === (scQ as MCQuestion).correct
  }

  const nextSecondChance = async () => {
    if (scIdx < secondChanceQs.length - 1) {
      setScIdx((p) => p + 1)
      setScAnswered(false)
      setScTextAnswer('')
      return
    }
    // The group resolves only if every miss was recovered on the makeup — a single
    // corrected slip clears it, but a concept still wrong on both passes keeps it flagged.
    const stillWrong = secondChanceQs.filter((_, i) => !scIsCorrect(i)).length
    await finishGroup(stillWrong === 0)
  }

  const q = questions[currentQ]
  const userAns = userAnswers[currentQ]
  const isTextQ = q?.type === 'text'
  const level = currentGroup ? getWeakLevel(currentGroup.maxWrongCount) : null
  const overallProgress = currentIdx / Math.max(groups.length, 1)
  const groupMcCount = currentGroup ? cappedMcCount(currentGroup.areas.length, currentGroup.maxWrongCount) : 1

  // One in-lecture comprehension check, rendered under its guide section.
  const renderCheckpoint = (i: number) => {
    if (!checkpointsReady) {
      return i === visibleCount - 1 ? (
        <div className={styles.cpLoading}>
          <div className={styles.loadingDot} />
          <span>Preparing a quick check…</span>
        </div>
      ) : null
    }
    const cp = cpFor(i)
    if (!cp) return null

    if (cp.type === 'mc') {
      const chosen = cpMc[i]
      return (
        <div className={styles.checkpoint}>
          <div className={styles.cpLabel}>Quick check</div>
          <div className={styles.quizCard}>
            <div className={styles.qText}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineP}>{cp.question}</ReactMarkdown>
            </div>
            <div className={styles.options}>
              {Object.entries(cp.options).map(([letter, text]) => {
                let optClass = styles.option
                if (chosen != null) {
                  if (letter === cp.correct) optClass = `${styles.option} ${styles.optCorrect}`
                  else if (letter === chosen) optClass = `${styles.option} ${styles.optWrong}`
                  else optClass = `${styles.option} ${styles.optDim}`
                }
                return (
                  <button key={letter} className={optClass} onClick={() => handleCpMc(i, letter)} disabled={chosen != null}>
                    <span className={styles.optLetter}>{letter}</span>
                    <span className={styles.optText}>{text}</span>
                  </button>
                )
              })}
            </div>
            {chosen != null && (
              <div className={`${styles.explanation} ${chosen === cp.correct ? styles.expCorrect : styles.expWrong}`}>
                <div className={styles.expLabel}>
                  {chosen === cp.correct ? '✓ Correct' : `✗ Not quite — answer: ${cp.correct}`}
                </div>
                <div className={styles.expText}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{cp.explanation}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </div>
      )
    }

    // Text checkpoint
    const result = cpTextResult[i]
    return (
      <div className={styles.checkpoint}>
        <div className={styles.cpLabel}>Quick check</div>
        <div className={styles.quizCard}>
          <div className={styles.qText}>{cp.question}</div>
          {!result ? (
            <>
              <textarea
                className={styles.textInput}
                value={cpText[i] || ''}
                onChange={(e) => setCpText((prev) => ({ ...prev, [i]: e.target.value }))}
                placeholder="Write a quick answer…"
                disabled={cpTextGrading === i}
                rows={3}
              />
              <button
                className={styles.btnSubmitText}
                onClick={() => gradeCpText(i)}
                disabled={!(cpText[i] || '').trim() || cpTextGrading === i}
              >
                {cpTextGrading === i ? 'Checking…' : 'Check Answer →'}
              </button>
            </>
          ) : (
            <div className={`${styles.textFeedback} ${result.passed ? styles.textFeedbackPass : styles.textFeedbackFail}`}>
              <div className={styles.textFeedbackLabel}>
                {result.passed ? '✓ Good understanding' : '✗ Review this'}
              </div>
              <div className={styles.textFeedbackBody}>{result.feedback}</div>
              <div className={styles.textFeedbackModel}>
                <span className={styles.textFeedbackModelLabel}>Model answer:</span> {cp.explanation}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
        </header>
        <div className={styles.loadingWrap}>
          <div className={styles.loadingDot} />
          <span>Loading session…</span>
        </div>
      </div>
    )
  }

  // ── Overview ─────────────────────────────────────────────────────────────
  if (phase === 'overview') {
    const est = estimateMinutes(groups)
    const totalAreas = groups.reduce((n, g) => n + g.areas.length, 0)
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
          <span className={styles.sessionBadge}>Weak Area Session</span>
        </header>

        <div className={styles.overviewHero}>
          <div className={styles.overviewTitle}>Today&apos;s review</div>
          <div className={styles.overviewMeta}>
            {groups.length} topic{groups.length > 1 ? 's' : ''} · {totalAreas} concept{totalAreas > 1 ? 's' : ''} · ~{est} min
          </div>
        </div>

        <div className={styles.areaList}>
          {groups.map((group, i) => {
            const l = getWeakLevel(group.maxWrongCount)
            return (
              <div key={group.topicId} className={styles.areaListItem}>
                <span className={styles.areaListNum}>{i + 1}</span>
                <div className={styles.areaListInfo}>
                  <span className={styles.areaListConcept}>{group.topicName}</span>
                  <span className={styles.areaListTopic}>
                    {group.areas.length === 1
                      ? group.areas[0].concept
                      : `${group.areas.length} concepts: ${group.areas.map((a) => a.concept).join(', ')}`}
                  </span>
                </div>
                <span className={styles.levelBadge} style={{ color: l.color, background: l.bg, borderColor: l.border }}>
                  {l.label}
                </span>
              </div>
            )
          })}
        </div>

        <div className={styles.overviewActions}>
          <button className={styles.btnStart} onClick={startGuide}>
            Start Session →
          </button>
        </div>
      </div>
    )
  }

  // ── Transition between groups ─────────────────────────────────────────────
  if (phase === 'area-transition') {
    const nextGroup = groups[currentIdx]
    const nextLevel = getWeakLevel(nextGroup.maxWrongCount)
    const prevResult = sessionResults[sessionResults.length - 1]
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
          <span className={styles.sessionBadge}>{currentIdx}/{groups.length} done</span>
        </header>

        <div className={styles.transitionCard}>
          <div className={styles.transitionPrev}>
            {prevResult?.resolved
              ? <span className={styles.resolvedTag}>✓ Resolved: {prevResult.label}</span>
              : <span className={styles.unresolvedTag}>✗ Still flagged: {prevResult?.label}</span>
            }
          </div>
          <div className={styles.transitionNext}>
            <div className={styles.transitionLabel}>Up next</div>
            <div className={styles.transitionConcept}>{nextGroup.topicName}</div>
            <div className={styles.transitionTopic}>
              {nextGroup.areas.length === 1
                ? nextGroup.areas[0].concept
                : `${nextGroup.areas.length} concepts`}
            </div>
            <span className={styles.levelBadge} style={{ color: nextLevel.color, background: nextLevel.bg, borderColor: nextLevel.border }}>
              {nextLevel.label}
            </span>
          </div>
          <button className={styles.btnStart} onClick={startGuide}>
            Continue →
          </button>
        </div>
      </div>
    )
  }

  // ── Guide phase (section-by-section reading) ──────────────────────────────
  if (phase === 'area-guide') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
          <span className={styles.sessionBadge}>{currentIdx + 1}/{groups.length}</span>
        </header>

        <div className={styles.areaHeader}>
          <div className={styles.areaHeaderInfo}>
            <span className={styles.areaHeaderLabel}>Weak Area{currentGroup?.areas.length > 1 ? 's' : ''}</span>
            <span className={styles.areaHeaderConcept}>{currentGroup?.topicName}</span>
            <span className={styles.areaHeaderTopic}>
              {currentGroup?.areas.length === 1
                ? currentGroup.areas[0].concept
                : `${currentGroup?.areas.length} concepts: ${currentGroup?.areas.map((a) => a.concept).join(', ')}`}
            </span>
          </div>
          {level && (
            <span className={styles.levelBadge} style={{ color: level.color, background: level.bg, borderColor: level.border }}>
              {level.label}
            </span>
          )}
        </div>

        <div className={styles.progressBar}>
          <div className={styles.progressBarFill} style={{ width: `${overallProgress * 100}%` }} />
        </div>

        <div className={styles.guideWrap}>
          {!guideContent && (
            <div className={styles.loadingBar}><div className={styles.loadingBarFill} /></div>
          )}

          {guideContent && (
            <>
              {introMd && (
                <div className={`${styles.guideContent} md-content`} style={{ marginBottom: 8 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{introMd}</ReactMarkdown>
                </div>
              )}
              {sections.length === 0 && (
                <div className={`${styles.guideContent} md-content`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{guideContent}</ReactMarkdown>
                </div>
              )}
              {sections.slice(0, visibleCount).map((s, i) => (
                <div key={i} className={styles.sectionBlock}>
                  <div className={`${styles.guideContent} md-content`} style={{ marginBottom: 0 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.raw}</ReactMarkdown>
                  </div>
                  {renderCheckpoint(i)}
                </div>
              ))}

              {/* Advance to next section — gated on answering the current check */}
              {sections.length > 0 && !allSectionsRevealed && (
                <div className={styles.guideActions}>
                  <button
                    className={styles.btnPrimary}
                    onClick={advanceSection}
                    disabled={!checkpointsReady || !cpAnswered(visibleCount - 1)}
                  >
                    Next section →
                  </button>
                  <span className={styles.retakeNote}>
                    {!checkpointsReady
                      ? 'Preparing check…'
                      : !cpAnswered(visibleCount - 1)
                        ? 'Answer the check to continue'
                        : `Section ${visibleCount} of ${sections.length}`}
                  </span>
                </div>
              )}

              {/* Start the quiz — only once the last section's check is done */}
              {allSectionsRevealed && (
                <div className={styles.guideFooter}>
                  <button className={styles.btnPrimary} onClick={startQuiz} disabled={!lastSectionAnswered}>
                    Start Quiz →
                  </button>
                  <span className={styles.quizNote}>
                    {!lastSectionAnswered
                      ? 'Answer the check to continue'
                      : `${groupMcCount + 1} questions · miss one and you'll get a rephrased retry`}
                  </span>
                  {quizError && <span className={styles.quizError}>{quizError}</span>}
                </div>
              )}
            </>
          )}
        </div>

        {/* Floating helper — explain-a-concept popup, available any time while reading */}
        {guideContent && currentGroup && (
          <GuideHelper topicName={currentGroup.topicName} domain={currentGroup.domain} guideContent={guideContent} />
        )}
      </div>
    )
  }

  // ── Quiz phase ───────────────────────────────────────────────────────────
  if (phase === 'area-quiz' && q) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
          <span className={styles.sessionBadge}>{currentIdx + 1}/{groups.length} · Q{currentQ + 1}/{questions.length}</span>
        </header>

        <div className={styles.areaHeader}>
          <div className={styles.areaHeaderInfo}>
            <span className={styles.areaHeaderLabel}>Weak Area Quiz</span>
            <span className={styles.areaHeaderConcept}>{currentGroup?.topicName}</span>
          </div>
          {level && (
            <span className={styles.levelBadge} style={{ color: level.color, background: level.bg, borderColor: level.border }}>
              {level.label}
            </span>
          )}
        </div>

        <div className={styles.progressBar}>
          <div className={styles.progressBarFill} style={{ width: `${overallProgress * 100}%` }} />
        </div>

        <div className={styles.quizProgress}>
          <div className={styles.quizProgressFill} style={{ width: `${(currentQ / questions.length) * 100}%` }} />
        </div>

        {/* MC question */}
        {!isTextQ && (
          <div className={styles.quizCard}>
            <div className={styles.qNum}>Question {currentQ + 1} of {questions.length}</div>
            <div className={styles.qText}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineP}>{q.question}</ReactMarkdown>
            </div>
            <div className={styles.options}>
              {Object.entries((q as MCQuestion).options).map(([letter, text]) => {
                let cls = styles.option
                if (answered) {
                  if (letter === (q as MCQuestion).correct) cls = `${styles.option} ${styles.optCorrect}`
                  else if (letter === userAns) cls = `${styles.option} ${styles.optWrong}`
                  else cls = `${styles.option} ${styles.optDim}`
                }
                return (
                  <button key={letter} className={cls} onClick={() => handleMCAnswer(letter)} disabled={answered}>
                    <span className={styles.optLetter}>{letter}</span>
                    <span className={styles.optText}>{text}</span>
                  </button>
                )
              })}
            </div>
            {answered && (
              <div className={`${styles.explanation} ${userAns === (q as MCQuestion).correct ? styles.expCorrect : styles.expWrong}`}>
                <div className={styles.expLabel}>
                  {userAns === (q as MCQuestion).correct ? '✓ Correct' : `✗ Wrong — correct: ${(q as MCQuestion).correct}`}
                </div>
                <div className={styles.expText}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.explanation}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Text question */}
        {isTextQ && (
          <div className={styles.quizCard}>
            <div className={styles.qNum}>Question {currentQ + 1} of {questions.length} — Written Response</div>
            <div className={styles.qText}>{q.question}</div>
            <textarea
              className={styles.textInput}
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              placeholder="Write your answer here…"
              disabled={textGrading || !!textGradeResult}
              rows={5}
            />
            {!textGradeResult && (
              <button className={styles.btnSubmitText} onClick={gradeTextAnswer} disabled={!textAnswer.trim() || textGrading}>
                {textGrading ? 'Grading…' : 'Submit Answer →'}
              </button>
            )}
            {textGradeResult && (
              <div className={`${styles.textFeedback} ${textGradeResult.passed ? styles.textFeedbackPass : styles.textFeedbackFail}`}>
                <div className={styles.textFeedbackLabel}>
                  {textGradeResult.passed ? '✓ Good understanding' : '✗ Needs more detail'}
                </div>
                <div className={styles.textFeedbackBody}>{textGradeResult.feedback}</div>
                <div className={styles.textFeedbackModel}>
                  <span className={styles.textFeedbackModelLabel}>Model answer:</span> {q.explanation}
                </div>
              </div>
            )}
          </div>
        )}

        {answered && (
          <div className={styles.nextRow}>
            <button className={styles.btnPrimary} onClick={nextQuestion}>
              {currentQ < questions.length - 1 ? 'Next →' : 'Continue →'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Second-chance (makeup) phase ──────────────────────────────────────────
  if (phase === 'area-second-chance' && secondChanceQs[scIdx]) {
    const scQ = secondChanceQs[scIdx]
    const scAns = scAnswers[scIdx]
    const scTextResult = scTextResults[scIdx]
    const isScText = scQ.type === 'text'
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
          <span className={styles.sessionBadge}>{currentIdx + 1}/{groups.length} · Makeup {scIdx + 1}/{secondChanceQs.length}</span>
        </header>

        <div className={styles.scBanner}>
          <span className={styles.scBannerLabel}>Makeup</span>
          <span className={styles.scBannerSub}>
            Same concept, freshly worded — get these right and the topic clears. Only what you miss again stays flagged.
          </span>
        </div>

        <div className={styles.quizProgress}>
          <div className={styles.quizProgressFill} style={{ width: `${(scIdx / secondChanceQs.length) * 100}%`, background: 'var(--amber)' }} />
        </div>

        <div className={styles.quizCard} style={{ borderColor: 'var(--amber-border)' }}>
          <div className={styles.qNum}>
            Question {scIdx + 1} of {secondChanceQs.length}{isScText ? ' — Written Response' : ''}
          </div>
          <div className={styles.qText}>
            {isScText ? scQ.question : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineP}>{scQ.question}</ReactMarkdown>
            )}
          </div>

          {/* MC makeup */}
          {!isScText && (
            <>
              <div className={styles.options}>
                {Object.entries((scQ as MCQuestion).options).map(([letter, text]) => {
                  let cls = styles.option
                  if (scAnswered) {
                    if (letter === (scQ as MCQuestion).correct) cls = `${styles.option} ${styles.optCorrect}`
                    else if (letter === scAns) cls = `${styles.option} ${styles.optWrong}`
                    else cls = `${styles.option} ${styles.optDim}`
                  }
                  return (
                    <button key={letter} className={cls} onClick={() => handleSCAnswer(letter)} disabled={scAnswered}>
                      <span className={styles.optLetter}>{letter}</span>
                      <span className={styles.optText}>{text}</span>
                    </button>
                  )
                })}
              </div>
              {scAnswered && (
                <div className={`${styles.explanation} ${scIsCorrect(scIdx) ? styles.expCorrect : styles.expWrong}`}>
                  <div className={styles.expLabel}>
                    {scIsCorrect(scIdx) ? '✓ Correct — this concept clears' : '✗ Wrong — this concept stays flagged'}
                  </div>
                  <div className={styles.expText}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{scQ.explanation}</ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Written makeup */}
          {isScText && (
            <>
              <textarea
                className={styles.textInput}
                value={scTextAnswer}
                onChange={(e) => setScTextAnswer(e.target.value)}
                placeholder="Write your answer here…"
                disabled={scTextGrading || !!scTextResult}
                rows={5}
              />
              {!scTextResult && (
                <button className={styles.btnSubmitText} onClick={gradeSCTextAnswer} disabled={!scTextAnswer.trim() || scTextGrading}>
                  {scTextGrading ? 'Grading…' : 'Submit Answer →'}
                </button>
              )}
              {scTextResult && (
                <div className={`${styles.textFeedback} ${scTextResult.passed ? styles.textFeedbackPass : styles.textFeedbackFail}`}>
                  <div className={styles.textFeedbackLabel}>
                    {scTextResult.passed ? '✓ Good understanding — this concept clears' : '✗ Needs more detail — this concept stays flagged'}
                  </div>
                  <div className={styles.textFeedbackBody}>{scTextResult.feedback}</div>
                  <div className={styles.textFeedbackModel}>
                    <span className={styles.textFeedbackModelLabel}>Model answer:</span> {scQ.explanation}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {scAnswered && (
          <div className={styles.nextRow}>
            <button className={styles.btnPrimary} style={{ background: 'var(--amber)' }} onClick={nextSecondChance}>
              {scIdx < secondChanceQs.length - 1
                ? 'Next →'
                : currentIdx < groups.length - 1 ? 'Next Topic →' : 'Finish Session →'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const resolvedCount = sessionResults.filter((r) => r.resolved).length
  const remaining = sessionResults.filter((r) => !r.resolved)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Dashboard</Link>
        <span className={styles.sessionBadge}>Session Complete</span>
      </header>

      <div className={styles.summaryCard}>
        <div className={styles.summaryScore}>
          {resolvedCount}/{sessionResults.length || groups.length}
        </div>
        <div className={styles.summaryLabel}>
          topic{resolvedCount !== 1 ? 's' : ''} resolved
        </div>
      </div>

      {sessionResults.length > 0 && (
        <div className={styles.summaryList}>
          {sessionResults.map((r) => (
            <div key={r.topicId} className={`${styles.summaryItem} ${r.resolved ? styles.summaryResolved : styles.summaryRemaining}`}>
              <span>{r.resolved ? '✓' : '✗'}</span>
              <span>{r.label}</span>
            </div>
          ))}
          {remaining.length > 0 && (
            <div className={styles.summaryNote}>
              Flagged items will appear again next session.
            </div>
          )}
        </div>
      )}

      <div className={styles.summaryActions}>
        <Link href="/" className={styles.btnPrimary} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          Back to Dashboard →
        </Link>
      </div>
    </div>
  )
}
