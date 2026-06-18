'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './session.module.css'

interface DueTopic {
  topic_id: string
  topic_name: string
  domain: number
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

type Phase = 'loading' | 'overview' | 'loading-quiz' | 'quiz' | 'transition' | 'summary'

// A review is "passed" when the student recalls the clear majority correctly.
const PASS_RATIO = 0.6

const inlineP = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> }

export default function ReviewSessionPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [topics, setTopics] = useState<DueTopic[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([])
  const [quizError, setQuizError] = useState('')
  const [currentQ, setCurrentQ] = useState(0)
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({})
  const [answered, setAnswered] = useState(false)
  const [textAnswer, setTextAnswer] = useState('')
  const [textGrading, setTextGrading] = useState(false)
  const [textGradeResult, setTextGradeResult] = useState<{ passed: boolean; feedback: string } | null>(null)
  const [textResults, setTextResults] = useState<Record<number, { passed: boolean; feedback: string }>>({})

  // Refresher
  const [refresherOpen, setRefresherOpen] = useState(false)
  const [refresherText, setRefresherText] = useState('')
  const [refresherLoading, setRefresherLoading] = useState(false)

  // Results
  const [results, setResults] = useState<{ topicId: string; name: string; passed: boolean }[]>([])

  useEffect(() => {
    fetch('/api/review/due')
      .then((r) => r.json())
      .then((data) => {
        const due: DueTopic[] = data.topics ?? []
        setTopics(due)
        setPhase(due.length > 0 ? 'overview' : 'summary')
      })
      .catch(() => setPhase('summary'))
  }, [])

  const currentTopic = topics[currentIdx]
  const overallProgress = currentIdx / Math.max(topics.length, 1)

  function resetQuizState() {
    setQuestions([])
    setQuizError('')
    setCurrentQ(0)
    setUserAnswers({})
    setAnswered(false)
    setTextAnswer('')
    setTextGradeResult(null)
    setTextResults({})
    setRefresherOpen(false)
    setRefresherText('')
  }

  async function startTopic(idx: number) {
    resetQuizState()
    setCurrentIdx(idx)
    setPhase('loading-quiz')
    try {
      const res = await fetch('/api/review/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId: topics[idx].topic_id }),
      })
      if (!res.ok) throw new Error(`Quiz generation failed (${res.status})`)
      const data = await res.json()
      if (!Array.isArray(data.questions) || data.questions.length === 0) throw new Error('Quiz came back empty')
      setQuestions(data.questions)
      setPhase('quiz')
    } catch {
      setQuizError('Could not generate the review. Tap Retry.')
      setPhase('quiz')
    }
  }

  async function loadRefresher() {
    if (refresherOpen) { setRefresherOpen(false); return }
    setRefresherOpen(true)
    if (refresherText || refresherLoading) return
    setRefresherLoading(true)
    try {
      const res = await fetch('/api/review/refresher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId: currentTopic.topic_id }),
      })
      if (res.ok) {
        const data = await res.json()
        setRefresherText(data.recap || '_No refresher available._')
      } else {
        setRefresherText('_Could not load a refresher._')
      }
    } catch {
      setRefresherText('_Could not load a refresher._')
    } finally {
      setRefresherLoading(false)
    }
  }

  const handleMCAnswer = (letter: string) => {
    if (answered) return
    setUserAnswers((prev) => ({ ...prev, [currentQ]: letter }))
    setAnswered(true)
  }

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

  const nextQuestion = async () => {
    setTextAnswer('')
    setTextGradeResult(null)

    if (currentQ < questions.length - 1) {
      setCurrentQ((p) => p + 1)
      setAnswered(false)
      return
    }

    // Score every question (MC auto, text AI-graded), then schedule the next review.
    let correct = 0
    const wrongQuestions: { question: string; userAnswer: string; correct: string; explanation: string }[] = []
    questions.forEach((q, i) => {
      const ok = q.type === 'text'
        ? !!textResults[i]?.passed
        : userAnswers[i] === (q as MCQuestion).correct
      if (ok) {
        correct++
      } else {
        wrongQuestions.push({
          question: q.question,
          userAnswer: q.type === 'text' ? '(free response)' : (userAnswers[i] || '(no answer)'),
          correct: q.type === 'text' ? (q as TextQuestion).rubric : (q as MCQuestion).correct,
          explanation: q.explanation,
        })
      }
    })
    const passed = correct / questions.length >= PASS_RATIO

    await fetch('/api/review/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicId: currentTopic.topic_id, passed, wrongQuestions }),
    }).catch(() => {})

    setResults((prev) => [...prev, { topicId: currentTopic.topic_id, name: currentTopic.topic_name, passed }])

    const nextIdx = currentIdx + 1
    if (nextIdx < topics.length) {
      setCurrentIdx(nextIdx)
      setPhase('transition')
    } else {
      setPhase('summary')
    }
  }

  const q = questions[currentQ]
  const userAns = userAnswers[currentQ]
  const isTextQ = q?.type === 'text'

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading' || phase === 'loading-quiz') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
          <span className={styles.sessionBadge}>Review</span>
        </header>
        <div className={styles.loadingWrap}>
          <div className={styles.loadingDot} />
          <span>{phase === 'loading-quiz' ? 'Building your recall check…' : 'Loading reviews…'}</span>
        </div>
      </div>
    )
  }

  // ── Overview ──────────────────────────────────────────────────────────────
  if (phase === 'overview') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
          <span className={styles.sessionBadge}>Spaced Review</span>
        </header>

        <div className={styles.overviewHero}>
          <div className={styles.overviewTitle}>Today&apos;s reviews</div>
          <div className={styles.overviewMeta}>
            {topics.length} topic{topics.length > 1 ? 's' : ''} due · quick recall checks
          </div>
        </div>

        <div className={styles.areaList}>
          {topics.map((t, i) => (
            <div key={t.topic_id} className={styles.areaListItem}>
              <span className={styles.areaListNum}>{i + 1}</span>
              <div className={styles.areaListInfo}>
                <span className={styles.areaListConcept}>{t.topic_name}</span>
                <span className={styles.areaListTopic}>Domain {t.domain}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.overviewActions}>
          <button className={styles.btnStart} onClick={() => startTopic(0)}>
            Start Review →
          </button>
        </div>
      </div>
    )
  }

  // ── Transition ──────────────────────────────────────────────────────────────
  if (phase === 'transition') {
    const nextTopic = topics[currentIdx]
    const prev = results[results.length - 1]
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
          <span className={styles.sessionBadge}>{currentIdx}/{topics.length} done</span>
        </header>

        <div className={styles.transitionCard}>
          <div className={styles.transitionPrev}>
            {prev?.passed
              ? <span className={styles.resolvedTag}>✓ Recalled: {prev.name} — pushed further out</span>
              : <span className={styles.unresolvedTag}>✗ Shaky: {prev?.name} — back in the queue soon</span>
            }
          </div>
          <div className={styles.transitionNext}>
            <div className={styles.transitionLabel}>Up next</div>
            <div className={styles.transitionConcept}>{nextTopic.topic_name}</div>
            <div className={styles.transitionTopic}>Domain {nextTopic.domain}</div>
          </div>
          <button className={styles.btnStart} onClick={() => startTopic(currentIdx)}>
            Continue →
          </button>
        </div>
      </div>
    )
  }

  // ── Quiz ──────────────────────────────────────────────────────────────────
  if (phase === 'quiz') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>← Dashboard</Link>
          <span className={styles.sessionBadge}>
            {currentIdx + 1}/{topics.length}{questions.length > 0 ? ` · Q${currentQ + 1}/${questions.length}` : ''}
          </span>
        </header>

        <div className={styles.areaHeader}>
          <div className={styles.areaHeaderInfo}>
            <span className={styles.areaHeaderLabel}>Review</span>
            <span className={styles.areaHeaderConcept}>{currentTopic?.topic_name}</span>
          </div>
        </div>

        <div className={styles.progressBar}>
          <div className={styles.progressBarFill} style={{ width: `${overallProgress * 100}%` }} />
        </div>

        {quizError && questions.length === 0 ? (
          <div className={styles.quizCard}>
            <div className={styles.qText}>{quizError}</div>
            <button className={styles.btnPrimary} onClick={() => startTopic(currentIdx)}>Retry</button>
          </div>
        ) : (
          <>
            {/* Refresher */}
            <div className={styles.refresherBar}>
              <button className={styles.refresherBtn} onClick={loadRefresher} disabled={refresherLoading}>
                {refresherLoading ? 'Loading…' : refresherOpen ? 'Hide refresher' : 'Need a refresher?'}
              </button>
            </div>
            {refresherOpen && refresherText && (
              <div className={`${styles.refresherBox} chat-md-content`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{refresherText}</ReactMarkdown>
              </div>
            )}

            <div className={styles.quizProgress}>
              <div className={styles.quizProgressFill} style={{ width: `${(currentQ / Math.max(questions.length, 1)) * 100}%` }} />
            </div>

            {q && !isTextQ && (
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

            {q && isTextQ && (
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
                  {currentQ < questions.length - 1 ? 'Next →' : currentIdx < topics.length - 1 ? 'Next Topic →' : 'Finish →'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const recalled = results.filter((r) => r.passed).length
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Dashboard</Link>
        <span className={styles.sessionBadge}>Review Complete</span>
      </header>

      {results.length === 0 ? (
        <div className={styles.overviewHero}>
          <div className={styles.overviewTitle}>No reviews due</div>
          <div className={styles.overviewMeta}>You&apos;re all caught up. Reviews appear here as topics come due.</div>
        </div>
      ) : (
        <>
          <div className={styles.summaryCard}>
            <div className={styles.summaryScore}>{recalled}/{results.length}</div>
            <div className={styles.summaryLabel}>topic{recalled !== 1 ? 's' : ''} recalled</div>
          </div>

          <div className={styles.summaryList}>
            {results.map((r) => (
              <div key={r.topicId} className={`${styles.summaryItem} ${r.passed ? styles.summaryResolved : styles.summaryRemaining}`}>
                <span>{r.passed ? '✓' : '✗'}</span>
                <span>{r.name}</span>
              </div>
            ))}
            <div className={styles.summaryNote}>
              Recalled topics move further out; shaky ones come back sooner.
            </div>
          </div>
        </>
      )}

      <div className={styles.summaryActions}>
        <Link href="/" className={styles.btnPrimary} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          Back to Dashboard →
        </Link>
      </div>
    </div>
  )
}
