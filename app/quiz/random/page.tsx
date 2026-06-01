'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from '../../quiz.module.css'

interface Question {
  id: number
  question: string
  options: Record<string, string>
  correct: string
  explanation: string
  domain: number
}

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

type DomainStatus = 'pending' | 'loading' | 'done' | 'error'
type Phase = 'loading' | 'quiz' | 'results'

export default function RandomQuizPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [domainStatus, setDomainStatus] = useState<Record<number, DomainStatus>>({
    1: 'loading', 2: 'loading', 3: 'loading', 4: 'loading', 5: 'loading',
  })
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentQ, setCurrentQ] = useState(0)
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({})
  const [answered, setAnswered] = useState(false)
  const [wrongIndices, setWrongIndices] = useState<number[]>([])
  const [textAnswer, setTextAnswer] = useState('')
  const [gradingText, setGradingText] = useState(false)
  const [gradeResult, setGradeResult] = useState<{ passed: boolean; feedback: string } | null>(null)

  const gradeTextAnswer = async () => {
    const currentQuestion = questions[currentQ]
    if (!currentQuestion || !textAnswer.trim()) return
    setGradingText(true)
    try {
      const res = await fetch('/api/quiz/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: currentQuestion.question,
          correctAnswer: `${currentQuestion.correct}: ${currentQuestion.options[currentQuestion.correct]}`,
          explanation: currentQuestion.explanation,
          userText: textAnswer,
        }),
      })
      if (res.ok) setGradeResult(await res.json())
    } finally {
      setGradingText(false)
    }
  }

  const loadQuiz = () => {
    setPhase('loading')
    setDomainStatus({ 1: 'loading', 2: 'loading', 3: 'loading', 4: 'loading', 5: 'loading' })
    setUserAnswers({})
    setCurrentQ(0)
    setAnswered(false)
    setWrongIndices([])
    setTextAnswer('')
    setGradeResult(null)

    const fetches = [1, 2, 3, 4, 5].map((d) =>
      fetch('/api/quiz/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: d, count: 10 }),
      })
        .then((r) => r.json())
        .then((data) => {
          setDomainStatus((prev) => ({ ...prev, [d]: 'done' }))
          return data.questions as Question[]
        })
        .catch(() => {
          setDomainStatus((prev) => ({ ...prev, [d]: 'error' }))
          return [] as Question[]
        })
    )

    Promise.all(fetches).then((results) => {
      // Merge in domain order, renumber ids
      const merged = results.flat().map((q, i) => ({ ...q, id: i + 1 }))
      setQuestions(merged)
      setPhase('quiz')
    })
  }

  useEffect(() => {
    loadQuiz()
  }, [])

  const handleAnswer = (letter: string) => {
    if (answered) return
    setUserAnswers((prev) => ({ ...prev, [currentQ]: letter }))
    setAnswered(true)
  }

  const nextQuestion = () => {
    setTextAnswer('')
    setGradeResult(null)
    if (currentQ < questions.length - 1) {
      setCurrentQ((p) => p + 1)
      setAnswered(false)
    } else {
      const wrong: number[] = []
      questions.forEach((q, i) => {
        if (userAnswers[i] !== q.correct) wrong.push(i)
      })
      setWrongIndices(wrong)
      setPhase('results')
    }
  }

  // Score per domain
  const domainScores = [1, 2, 3, 4, 5].map((d) => {
    const qs = questions.filter((q) => q.domain === d)
    const correct = qs.filter((q, _) => {
      const idx = questions.indexOf(q)
      return userAnswers[idx] === q.correct
    }).length
    return { domain: d, correct, total: qs.length }
  })

  const overallScore =
    questions.length > 0
      ? Math.round(
          (questions.filter((q, i) => userAnswers[i] === q.correct).length / questions.length) * 100
        )
      : 0

  const q = questions[currentQ]
  const userAns = userAnswers[currentQ]

  // Show domain divider when entering a new domain boundary
  const prevDomain = currentQ > 0 ? questions[currentQ - 1]?.domain : null
  const showDomainDivider = q && prevDomain !== null && q.domain !== prevDomain

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Dashboard</Link>
        <div className={styles.titleArea}>
          <span className={styles.titleMain}>Random Quiz</span>
          <span className={styles.titleSub}>10 questions × 5 domains</span>
        </div>
        <span className={styles.phaseBadge}>
          {phase === 'loading' && '⟳ Building'}
          {phase === 'quiz' && `${currentQ + 1}/${questions.length}`}
          {phase === 'results' && 'Results'}
        </span>
      </header>

      {/* Loading — show per-domain progress */}
      {phase === 'loading' && (
        <div className={styles.loadingWrap}>
          <span className={styles.loadingTitle}>Generating questions from all domains…</span>
          <div className={styles.domainProgress}>
            {[1, 2, 3, 4, 5].map((d) => (
              <span
                key={d}
                className={`${styles.domainPill} ${
                  domainStatus[d] === 'loading'
                    ? styles.loading
                    : domainStatus[d] === 'done'
                    ? styles.done
                    : ''
                }`}
              >
                D{d} {domainStatus[d] === 'done' ? '✓' : domainStatus[d] === 'loading' ? '⟳' : '✗'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Quiz */}
      {phase === 'quiz' && q && (
        <div className={styles.quizWrap}>
          {showDomainDivider && (
            <div className={styles.domainDivider}>
              <div className={styles.domainDividerLine} />
              <span
                className={styles.domainDividerLabel}
                style={{ color: DOMAIN_COLORS[q.domain] }}
              >
                DOMAIN {q.domain} — {DOMAIN_NAMES[q.domain].toUpperCase()}
              </span>
              <div className={styles.domainDividerLine} />
            </div>
          )}

          <div className={styles.quizProgress}>
            <div
              className={styles.quizProgressFill}
              style={{ width: `${(currentQ / questions.length) * 100}%` }}
            />
          </div>

          <div className={styles.quizCard}>
            <div className={styles.qNum}>
              Q{currentQ + 1}/{questions.length} · D{q.domain}
            </div>
            <div className={styles.qText}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
                {q.question}
              </ReactMarkdown>
            </div>

            <div className={styles.options}>
              {Object.entries(q.options).map(([letter, text]) => {
                let cls = styles.option
                if (answered) {
                  if (letter === q.correct) cls = `${styles.option} ${styles.optCorrect}`
                  else if (letter === userAns) cls = `${styles.option} ${styles.optWrong}`
                  else cls = `${styles.option} ${styles.optDim}`
                }
                return (
                  <button key={letter} className={cls} onClick={() => handleAnswer(letter)} disabled={answered}>
                    <span className={styles.optLetter}>{letter}</span>
                    <span className={styles.optText}>{text}</span>
                  </button>
                )
              })}
            </div>

            {answered && (
              <div className={`${styles.explanation} ${userAns === q.correct ? styles.expCorrect : styles.expWrong}`}>
                <div className={styles.expLabel}>
                  {userAns === q.correct ? '✓ Correct' : `✗ Wrong — correct: ${q.correct}`}
                </div>
                <div className={styles.expText}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.explanation}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>

          {answered && (
            <div className="text-grader">
              <div className="text-grader-label">TEST YOUR UNDERSTANDING</div>
              <textarea
                className="text-grader-input"
                value={textAnswer}
                onChange={(e) => setTextAnswer(e.target.value)}
                placeholder="Explain the key concept this question tests, in your own words…"
                disabled={gradingText || !!gradeResult}
                rows={3}
              />
              {!gradeResult && (
                <button
                  className="text-grader-submit"
                  onClick={gradeTextAnswer}
                  disabled={!textAnswer.trim() || gradingText}
                >
                  {gradingText ? 'Grading…' : 'Grade My Answer →'}
                </button>
              )}
              {gradeResult && (
                <div className={`ai-grade ${gradeResult.passed ? 'ai-grade-pass' : 'ai-grade-fail'}`}>
                  <div className="ai-grade-label">
                    {gradeResult.passed ? 'AI GRADER: SOLID UNDERSTANDING' : 'AI GRADER: NEEDS REVIEW'}
                  </div>
                  <div className="ai-grade-text">{gradeResult.feedback}</div>
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
          <div
            className={`${styles.scoreCard} ${overallScore >= 70 ? styles.scorePassed : styles.scoreFailed}`}
          >
            <div
              className={styles.scoreBig}
              style={{ color: overallScore >= 70 ? 'var(--green)' : 'var(--red)' }}
            >
              {overallScore}%
            </div>
            <div className={styles.scoreLabel}>
              {questions.length - wrongIndices.length}/{questions.length} correct across all domains
            </div>
          </div>

          {/* Per-domain breakdown */}
          <div className={styles.domainBreakdown}>
            {domainScores.map(({ domain, correct, total }) => {
              const pct = total > 0 ? Math.round((correct / total) * 100) : 0
              return (
                <div key={domain} className={styles.domainScore}>
                  <span className={styles.domainScoreLabel} style={{ color: DOMAIN_COLORS[domain] }}>
                    D{domain}
                  </span>
                  <span
                    className={styles.domainScoreVal}
                    style={{ color: pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)' }}
                  >
                    {pct}%
                  </span>
                  <span className={styles.domainScoreFrac}>{correct}/{total}</span>
                </div>
              )
            })}
          </div>

          {wrongIndices.length > 0 && (
            <div className={styles.reviewSection}>
              <div className={styles.reviewLabel}>MISSED QUESTIONS</div>
              {wrongIndices.map((i) => (
                <div key={i} className={styles.reviewItem}>
                  <div className={styles.reviewHeader}>
                    <div />
                    <span className={styles.reviewDomainTag}>D{questions[i].domain}</span>
                  </div>
                  <div className={styles.reviewQ}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
                      {questions[i].question}
                    </ReactMarkdown>
                  </div>
                  <div className={styles.reviewAnswers}>
                    <span className={styles.reviewWrong}>
                      You: {userAnswers[i]} — {questions[i].options[userAnswers[i]]}
                    </span>
                    <span className={styles.reviewCorrect}>
                      Correct: {questions[i].correct} — {questions[i].options[questions[i].correct]}
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
            <button className={styles.btnPrimary} onClick={loadQuiz}>New Random Quiz</button>
            <Link href="/" className={styles.btn}>Dashboard</Link>
          </div>
        </div>
      )}
    </div>
  )
}
