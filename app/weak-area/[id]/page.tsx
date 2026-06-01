'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './weakarea.module.css'

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

function getPassCount(mcCount: number): number {
  if (mcCount <= 1) return 1
  if (mcCount <= 3) return 2
  return 4
}

const inlineP = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> }

interface WeakArea {
  id: number
  concept: string
  topic_id: string
  topic_name: string
  domain: number
  wrong_count: number
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

type Phase = 'loading-meta' | 'loading-guide' | 'guide' | 'loading-quiz' | 'quiz' | 'results'

const DOMAIN_NAMES: Record<number, string> = {
  1: 'General Security Concepts',
  2: 'Threats, Vulnerabilities & Mitigations',
  3: 'Security Architecture',
  4: 'Security Operations',
  5: 'Security Program Management',
}

export default function WeakAreaPage() {
  const params = useParams()
  const weakAreaId = params.id as string

  const [phase, setPhase] = useState<Phase>('loading-meta')
  const [weakArea, setWeakArea] = useState<WeakArea | null>(null)
  const [guideContent, setGuideContent] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [mcCount, setMcCount] = useState(0)
  const [currentQ, setCurrentQ] = useState(0)
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({})
  const [answered, setAnswered] = useState(false)
  const [wrongIndices, setWrongIndices] = useState<number[]>([])
  const [score, setScore] = useState(0)
  const [resolved, setResolved] = useState(false)

  // Text question state
  const [textAnswer, setTextAnswer] = useState('')
  const [textGrading, setTextGrading] = useState(false)
  const [textGradeResult, setTextGradeResult] = useState<{ passed: boolean; feedback: string } | null>(null)

  const streamBufRef = useRef('')
  const rafIdRef = useRef(0)
  const didFetchRef = useRef(false)

  useEffect(() => {
    if (didFetchRef.current) return
    didFetchRef.current = true

    fetch('/api/progress')
      .then((r) => r.json())
      .then((data) => {
        const wa = data.weakAreas?.find((w: WeakArea) => String(w.id) === weakAreaId)
        if (!wa) return
        setWeakArea(wa)
        setPhase('loading-guide')
        startGuide(wa.id)
      })
  }, [weakAreaId])

  function startGuide(id: number) {
    setGuideContent('')
    streamBufRef.current = ''

    const flush = () => {
      setGuideContent(streamBufRef.current)
      rafIdRef.current = 0
    }

    fetch('/api/weak-area/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weakAreaId: id }),
    }).then(async (res) => {
      if (!res.ok) {
        setGuideContent('Error loading explanation.')
        setPhase('guide')
        return
      }

      setPhase('guide')

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        streamBufRef.current += decoder.decode(value, { stream: true })
        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(flush)
        }
      }

      if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = 0 }
      streamBufRef.current += decoder.decode()
      setGuideContent(streamBufRef.current)
    })
  }

  const startQuiz = async () => {
    setPhase('loading-quiz')
    setUserAnswers({})
    setCurrentQ(0)
    setAnswered(false)
    setWrongIndices([])
    setTextAnswer('')
    setTextGradeResult(null)

    const res = await fetch('/api/weak-area/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weakAreaId: Number(weakAreaId) }),
    })

    if (!res.ok) { setPhase('guide'); return }

    const data = await res.json()
    setQuestions(data.questions)
    setMcCount(data.mcCount ?? data.questions.filter((q: Question) => q.type === 'mc').length)
    setPhase('quiz')
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
    } else {
      // Score only MC questions
      const wrong: number[] = []
      let correct = 0
      let mcTotal = 0
      questions.forEach((q, i) => {
        if (q.type === 'text') return
        mcTotal++
        if (userAnswers[i] === (q as MCQuestion).correct) correct++
        else wrong.push(i)
      })
      const passCount = getPassCount(mcTotal)
      const finalScore = mcTotal > 0 ? Math.round((correct / mcTotal) * 100) : 100
      setScore(finalScore)
      setWrongIndices(wrong)

      if (correct >= passCount) {
        await fetch('/api/weak-areas', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(weakAreaId) }),
        })
        setResolved(true)
      }

      setPhase('results')
    }
  }

  const q = questions[currentQ]
  const userAns = userAnswers[currentQ]
  const isTextQ = q?.type === 'text'
  const passCount = getPassCount(mcCount)
  const passed = resolved

  if (phase === 'loading-meta') {
    return (
      <div className={styles.page}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '60px 0', color: 'var(--text-3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
          <div className={styles.loadingDot} />
          Loading…
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Dashboard</Link>
        <span className={styles.phaseBadge}>
          {(phase === 'loading-guide' || phase === 'guide') && '⚠ Weak Area'}
          {phase === 'loading-quiz' && '⟳ Quiz'}
          {phase === 'quiz' && `${currentQ + 1}/${questions.length}`}
          {phase === 'results' && (passed ? '✓ Resolved' : '✗ Retry')}
        </span>
      </header>

      {weakArea && (
        <div className={styles.conceptHeader}>
          <div className={styles.conceptInfo}>
            <span className={styles.conceptLabel}>Weak Area</span>
            <span className={styles.conceptName}>{weakArea.concept}</span>
            <span className={styles.topicRef}>
              {weakArea.topic_name} · Domain {weakArea.domain} — {DOMAIN_NAMES[weakArea.domain]}
            </span>
          </div>
          {(() => {
            const l = getWeakLevel(weakArea.wrong_count)
            return (
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: l.color, background: l.bg, border: `1px solid ${l.border}`, padding: '4px 10px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                {l.label} IMPORTANCE
              </span>
            )
          })()}
        </div>
      )}

      {/* Study guide */}
      {(phase === 'loading-guide' || phase === 'guide') && (
        <div className={styles.guideWrap}>
          {phase === 'loading-guide' && !guideContent && (
            <div className={styles.loadingBar}>
              <div className={styles.loadingBarFill} />
            </div>
          )}
          <div className={`${styles.guideContent} md-content`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{guideContent}</ReactMarkdown>
          </div>
          {phase === 'guide' && guideContent && weakArea && (
            <div className={styles.guideActions}>
              <button className={styles.btnAmber} onClick={startQuiz}>
                Mini Quiz →
              </button>
              <span className={styles.miniQuizNote}>
                {getMcCount(weakArea.wrong_count) + 1} questions · {getPassCount(getMcCount(weakArea.wrong_count))}/{getMcCount(weakArea.wrong_count)} MC correct to resolve
              </span>
            </div>
          )}
        </div>
      )}

      {/* Quiz loading */}
      {phase === 'loading-quiz' && (
        <div className={styles.loadingQuiz}>
          <div className={styles.loadingDot} />
          <span>Generating quiz…</span>
        </div>
      )}

      {/* Quiz */}
      {phase === 'quiz' && q && (
        <div className={styles.quizWrap}>
          <div className={styles.quizProgress}>
            <div
              className={styles.quizProgressFill}
              style={{ width: `${(currentQ / questions.length) * 100}%` }}
            />
          </div>

          {/* ── Multiple choice ── */}
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

          {/* ── Text question ── */}
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
                <button
                  className={styles.btnSubmitText}
                  onClick={gradeTextAnswer}
                  disabled={!textAnswer.trim() || textGrading}
                >
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
                {currentQ < questions.length - 1 ? 'Next →' : 'See Results →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {phase === 'results' && (
        <div className={styles.results}>
          <div className={passed ? styles.resolvedCard : styles.failedCard}>
            <div className={styles.scoreBig} style={{ color: passed ? 'var(--green)' : 'var(--red)' }}>
              {score}%
            </div>
            <div className={styles.scoreLabel}>
              {questions.filter(q => q.type !== 'text').length - wrongIndices.length}/{questions.filter(q => q.type !== 'text').length} MC correct
            </div>
            {passed && resolved && (
              <div className={styles.resolvedBadge}>WEAK AREA RESOLVED</div>
            )}
            {!passed && (
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-3)', fontFamily: 'IBM Plex Mono, monospace' }}>
                Need {passCount}/{mcCount} MC correct to resolve — review the explanation and retry
              </div>
            )}
          </div>

          {wrongIndices.length > 0 && (
            <div className={styles.reviewSection}>
              <div className={styles.reviewLabel}>MISSED QUESTIONS</div>
              {wrongIndices.map((i) => (
                <div key={i} className={styles.reviewItem}>
                  <div className={styles.reviewQ}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineP}>{questions[i].question}</ReactMarkdown>
                  </div>
                  <div className={styles.reviewAnswers}>
                    <span className={styles.reviewWrong}>
                      You: {userAnswers[i]} — {(questions[i] as MCQuestion).options[userAnswers[i]]}
                    </span>
                    <span className={styles.reviewCorrect}>
                      Correct: {(questions[i] as MCQuestion).correct} — {(questions[i] as MCQuestion).options[(questions[i] as MCQuestion).correct]}
                    </span>
                  </div>
                  <div className={styles.reviewExp}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{questions[i].explanation}</ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.resultActions}>
            {!passed && (
              <button className={styles.btnAmber} onClick={() => {
                setPhase('loading-guide')
                if (weakArea) startGuide(weakArea.id)
              }}>
                Review Again
              </button>
            )}
            <Link href="/" className={styles.btn}>
              {resolved ? 'Back to Dashboard ✓' : 'Dashboard'}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
