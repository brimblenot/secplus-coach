'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from '../../../quiz.module.css'

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

const DOMAIN_NAMES: Record<string, string> = {
  '1': 'General Security Concepts',
  '2': 'Threats, Vulnerabilities & Mitigations',
  '3': 'Security Architecture',
  '4': 'Security Operations',
  '5': 'Security Program Management',
}

const DOMAIN_COLORS: Record<string, string> = {
  '1': '#00c896',
  '2': '#e8980a',
  '3': '#4080f0',
  '4': '#9060f0',
  '5': '#e8304c',
}

type Phase = 'loading' | 'quiz' | 'saving' | 'results'

export default function DomainQuizPage() {
  const params = useParams()
  const domainId = params.id as string

  const [phase, setPhase] = useState<Phase>('loading')
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentQ, setCurrentQ] = useState(0)
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({})
  const [answered, setAnswered] = useState(false)
  const [score, setScore] = useState(0)
  const [wrongIndices, setWrongIndices] = useState<number[]>([])
  const [quizPassed, setQuizPassed] = useState(false)
  const [error, setError] = useState('')

  const [textAnswer, setTextAnswer] = useState('')
  const [textGrading, setTextGrading] = useState(false)
  const [textGradeResult, setTextGradeResult] = useState<{ passed: boolean; feedback: string } | null>(null)

  const color = DOMAIN_COLORS[domainId] || 'var(--green)'

  const loadQuiz = () => {
    setPhase('loading')
    setUserAnswers({})
    setCurrentQ(0)
    setAnswered(false)
    setWrongIndices([])
    setTextAnswer('')
    setTextGradeResult(null)

    fetch('/api/quiz/domain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: domainId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setQuestions(data.questions)
        setPhase('quiz')
      })
      .catch((e) => setError(String(e)))
  }

  useEffect(() => { loadQuiz() }, [domainId])

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
        setTextGradeResult(await res.json())
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
      // Score MC only
      const wrong: number[] = []
      let correct = 0
      let mcTotal = 0
      questions.forEach((q, i) => {
        if (q.type === 'text') return
        mcTotal++
        if (userAnswers[i] === (q as MCQuestion).correct) correct++
        else wrong.push(i)
      })
      const finalScore = mcTotal > 0 ? Math.round((correct / mcTotal) * 100) : 100
      setScore(finalScore)
      setWrongIndices(wrong)
      setPhase('saving')

      const saveRes = await fetch('/api/quiz/domain/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainId, score: finalScore }),
      })
      const saveData = await saveRes.json()
      setQuizPassed(saveData.passed)
      setPhase('results')
    }
  }

  const q = questions[currentQ]
  const userAns = userAnswers[currentQ]
  const isTextQ = q?.type === 'text'
  const mcTotal = questions.filter(q => q.type !== 'text').length

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingWrap}>
          <span style={{ color: 'var(--red)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
            Error: {error}
          </span>
          <Link href={`/domain/${domainId}`} className={styles.btn}>← Back</Link>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href={`/domain/${domainId}`} className={styles.back}>← Domain</Link>
        <div className={styles.titleArea}>
          <span className={styles.titleMain} style={{ color }}>Domain {domainId} — Cumulative Quiz</span>
          <span className={styles.titleSub}>{DOMAIN_NAMES[domainId]}</span>
        </div>
        <span className={styles.phaseBadge}>
          {phase === 'loading' && '⟳ Generating'}
          {phase === 'quiz' && `${currentQ + 1}/${questions.length}`}
          {phase === 'saving' && '⟳ Saving'}
          {phase === 'results' && 'Results'}
        </span>
      </header>

      {/* Loading */}
      {phase === 'loading' && (
        <div className={styles.loadingWrap}>
          <div className={styles.loadingDot} />
          <span className={styles.loadingTitle}>
            Generating 20 CompTIA-style questions across all {DOMAIN_NAMES[domainId]} topics…
          </span>
        </div>
      )}

      {/* Saving */}
      {phase === 'saving' && (
        <div className={styles.loadingWrap}>
          <div className={styles.loadingDot} />
          <span className={styles.loadingTitle}>Saving results…</span>
        </div>
      )}

      {/* Quiz */}
      {phase === 'quiz' && q && (
        <div className={styles.quizWrap}>
          <div className={styles.quizProgress}>
            <div
              className={styles.quizProgressFill}
              style={{ width: `${(currentQ / questions.length) * 100}%`, background: color }}
            />
          </div>

          {/* MC question */}
          {!isTextQ && (
            <div className={styles.quizCard}>
              <div className={styles.qNum}>Question {currentQ + 1} of {questions.length}</div>
              <div className={styles.qText}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
                  {q.question}
                </ReactMarkdown>
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
              <button className={styles.btnPrimary} onClick={nextQuestion} style={{ background: color }}>
                {currentQ < questions.length - 1 ? 'Next →' : 'See Results →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {phase === 'results' && (
        <div className={styles.results}>
          <div className={`${styles.scoreCard} ${quizPassed ? styles.scorePassed : styles.scoreFailed}`}>
            <div className={styles.scoreBig} style={{ color: quizPassed ? 'var(--green)' : 'var(--red)' }}>
              {score}%
            </div>
            <div className={styles.scoreLabel}>
              {mcTotal - wrongIndices.length}/{mcTotal} MC correct
              {quizPassed
                ? ` — Domain ${domainId} quiz passed`
                : ` — need 80% to pass (${Math.ceil(mcTotal * 0.8)}/${mcTotal} correct)`}
            </div>
            {!quizPassed && (
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-3)', fontFamily: 'IBM Plex Mono, monospace' }}>
                Review missed topics and retake to unlock the next domain.
              </div>
            )}
          </div>

          {wrongIndices.length > 0 && (
            <div className={styles.reviewSection}>
              <div className={styles.reviewLabel}>MISSED QUESTIONS</div>
              {wrongIndices.map((i) => (
                <div key={i} className={styles.reviewItem}>
                  <div className={styles.reviewQ}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
                      {questions[i].question}
                    </ReactMarkdown>
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
            <button className={styles.btnPrimary} onClick={loadQuiz}>Retake</button>
            <Link href={`/domain/${domainId}`} className={styles.btn}>← Domain</Link>
            <Link href="/" className={styles.btn}>Dashboard</Link>
          </div>
        </div>
      )}
    </div>
  )
}
