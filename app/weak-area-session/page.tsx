'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './session.module.css'

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

type SessionPhase =
  | 'loading'
  | 'overview'
  | 'area-guide'
  | 'area-quiz'
  | 'area-transition'
  | 'summary'

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

// Mirror of MAX_MC in app/api/weak-area/quiz/route.ts so the question-count
// preview and pass thresholds match the quiz the route actually generates.
const MAX_MC = 6
function cappedMcCount(areaCount: number, maxWrongCount: number): number {
  return Math.min(MAX_MC, Math.max(areaCount, getMcCount(maxWrongCount)))
}

function getPassCount(mcCount: number): number {
  if (mcCount <= 1) return 1
  if (mcCount <= 3) return 2
  return 4
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
  const streamBufRef = useRef('')
  const rafIdRef = useRef(0)

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([])
  const [quizError, setQuizError] = useState('')
  const [mcCount, setMcCount] = useState(0)
  const [currentQ, setCurrentQ] = useState(0)
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({})
  const [answered, setAnswered] = useState(false)

  // Text question state
  const [textAnswer, setTextAnswer] = useState('')
  const [textGrading, setTextGrading] = useState(false)
  const [textGradeResult, setTextGradeResult] = useState<{ passed: boolean; feedback: string } | null>(null)

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
    streamBufRef.current = ''
    setPhase('area-guide')

    const flush = () => { setGuideContent(streamBufRef.current); rafIdRef.current = 0 }

    fetch('/api/weak-area/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weakAreaIds: currentGroup.areas.map((a) => a.id) }),
    }).then(async (res) => {
      if (!res.ok) { setGuideContent('Error loading explanation.'); return }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        streamBufRef.current += decoder.decode(value, { stream: true })
        if (!rafIdRef.current) rafIdRef.current = requestAnimationFrame(flush)
      }
      if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = 0 }
      streamBufRef.current += decoder.decode()
      setGuideContent(streamBufRef.current)
    })
  }

  // ── Start quiz for current group ──────────────────────────────────────────
  async function startQuiz() {
    setPhase('loading')
    setQuizError('')
    setUserAnswers({})
    setCurrentQ(0)
    setAnswered(false)
    setTextAnswer('')
    setTextGradeResult(null)

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
      setMcCount(data.mcCount ?? data.questions.filter((q: Question) => q.type === 'mc').length)
      setPhase('area-quiz')
    } catch {
      // Surface the failure on the guide instead of silently bouncing — otherwise
      // the user just lands back on the guide with no idea the quiz didn't load.
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
        setTextGradeResult(await res.json())
        setAnswered(true)
      }
    } finally {
      setTextGrading(false)
    }
  }

  // ── Next question / finish group ──────────────────────────────────────────
  const nextQuestion = async () => {
    setTextAnswer('')
    setTextGradeResult(null)

    if (currentQ < questions.length - 1) {
      setCurrentQ((p) => p + 1)
      setAnswered(false)
      return
    }

    // Score MC only
    let correct = 0
    let mcTotal = 0
    questions.forEach((q, i) => {
      if (q.type === 'text') return
      mcTotal++
      if (userAnswers[i] === (q as MCQuestion).correct) correct++
    })

    const passCount = getPassCount(mcTotal)
    const resolved = correct >= passCount

    if (resolved) {
      // Resolve all areas in the group
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

  // ── Advance from transition ──────────────────────────────────────────────
  const advanceToNextArea = () => { startGuide() }

  const q = questions[currentQ]
  const userAns = userAnswers[currentQ]
  const isTextQ = q?.type === 'text'
  const level = currentGroup ? getWeakLevel(currentGroup.maxWrongCount) : null
  const overallProgress = currentIdx / Math.max(groups.length, 1)
  const groupMcCount = currentGroup ? cappedMcCount(currentGroup.areas.length, currentGroup.maxWrongCount) : 1

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
          <button className={styles.btnStart} onClick={advanceToNextArea}>
            Continue →
          </button>
        </div>
      </div>
    )
  }

  // ── Guide phase ──────────────────────────────────────────────────────────
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
          <div className={`${styles.guideContent} md-content`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{guideContent}</ReactMarkdown>
          </div>
          {guideContent && currentGroup && (
            <div className={styles.guideFooter}>
              <button className={styles.btnPrimary} onClick={startQuiz}>
                Start Quiz →
              </button>
              <span className={styles.quizNote}>
                {groupMcCount + 1} questions · need {getPassCount(groupMcCount)}/{groupMcCount} MC to resolve
              </span>
              {quizError && <span className={styles.quizError}>{quizError}</span>}
            </div>
          )}
        </div>
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
              {currentQ < questions.length - 1 ? 'Next →' : currentIdx < groups.length - 1 ? 'Next Topic →' : 'Finish Session →'}
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
