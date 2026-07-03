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

// A review is "recalled" when the student gets the clear majority right.
const PASS_RATIO = 0.6

const inlineP = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> }

type Phase = 'loading' | 'quiz' | 'saving' | 'results'

export default function TopicReviewPage() {
  const params = useParams()
  const topicId = params.id as string

  const [phase, setPhase] = useState<Phase>('loading')
  const [topicName, setTopicName] = useState('')
  const [domain, setDomain] = useState<number | null>(null)

  const [questions, setQuestions] = useState<Question[]>([])
  const [error, setError] = useState('')
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
  const [recalled, setRecalled] = useState(0)
  const [passed, setPassed] = useState(false)
  const [wrongList, setWrongList] = useState<number[]>([])

  // Pull the topic name/domain (for the header + back link) from the shared progress feed.
  useEffect(() => {
    fetch('/api/progress')
      .then((r) => r.json())
      .then((d) => {
        const t = (d.topics ?? []).find((x: { topic_id: string }) => x.topic_id === topicId)
        if (t) { setTopicName(t.topic_name); setDomain(t.domain) }
      })
      .catch(() => {})
  }, [topicId])

  const loadQuiz = () => {
    setPhase('loading')
    setError('')
    setCurrentQ(0)
    setUserAnswers({})
    setAnswered(false)
    setTextAnswer('')
    setTextGradeResult(null)
    setTextResults({})
    setRefresherOpen(false)
    setRefresherText('')

    fetch('/api/review/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicId }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Quiz generation failed (${r.status})`)
        return r.json()
      })
      .then((data) => {
        if (!Array.isArray(data.questions) || data.questions.length === 0) throw new Error('Quiz came back empty')
        setQuestions(data.questions)
        setPhase('quiz')
      })
      .catch(() => setError('Could not generate the review. Tap Retry.'))
  }

  useEffect(() => { loadQuiz() }, [topicId])

  async function loadRefresher() {
    if (refresherOpen) { setRefresherOpen(false); return }
    setRefresherOpen(true)
    if (refresherText || refresherLoading) return
    setRefresherLoading(true)
    try {
      const res = await fetch('/api/review/refresher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId }),
      })
      setRefresherText(res.ok ? ((await res.json()).recap || '_No refresher available._') : '_Could not load a refresher._')
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

    // Score everything (MC auto, text AI-graded), then flag misses back into weak areas.
    let correct = 0
    const wrong: number[] = []
    const wrongQuestions: { question: string; userAnswer: string; correct: string; explanation: string }[] = []
    questions.forEach((qq, i) => {
      const ok = qq.type === 'text' ? !!textResults[i]?.passed : userAnswers[i] === (qq as MCQuestion).correct
      if (ok) {
        correct++
      } else {
        wrong.push(i)
        wrongQuestions.push({
          question: qq.question,
          userAnswer: qq.type === 'text' ? '(free response)' : (userAnswers[i] || '(no answer)'),
          correct: qq.type === 'text' ? (qq as TextQuestion).rubric : (qq as MCQuestion).correct,
          explanation: qq.explanation,
        })
      }
    })
    const didPass = correct / questions.length >= PASS_RATIO
    setRecalled(correct)
    setWrongList(wrong)
    setPassed(didPass)
    setPhase('saving')

    await fetch('/api/review/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicId, passed: didPass, wrongQuestions }),
    }).catch(() => {})

    setPhase('results')
  }

  const q = questions[currentQ]
  const userAns = userAnswers[currentQ]
  const isTextQ = q?.type === 'text'
  const backHref = domain !== null ? `/domain/${domain}` : '/'

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingWrap}>
          <span style={{ color: 'var(--red)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>{error}</span>
          <button className={styles.btnPrimary} onClick={loadQuiz}>Retry</button>
          <Link href={backHref} className={styles.btn}>← Back</Link>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href={backHref} className={styles.back}>← Back</Link>
        <div className={styles.titleArea}>
          <span className={styles.titleMain} style={{ color: 'var(--blue)' }}>Topic Review</span>
          <span className={styles.titleSub}>{topicName || `Topic ${topicId}`}</span>
        </div>
        <span className={styles.phaseBadge}>
          {phase === 'loading' && '⟳ Generating'}
          {phase === 'quiz' && `${currentQ + 1}/${questions.length}`}
          {phase === 'saving' && '⟳ Saving'}
          {phase === 'results' && 'Results'}
        </span>
      </header>

      {(phase === 'loading' || phase === 'saving') && (
        <div className={styles.loadingWrap}>
          <div className={styles.loadingDot} />
          <span className={styles.loadingTitle}>
            {phase === 'saving' ? 'Saving…' : 'Building your recall check…'}
          </span>
        </div>
      )}

      {phase === 'quiz' && q && (
        <div className={styles.quizWrap}>
          {/* Refresher */}
          <div className={styles.nextRow} style={{ justifyContent: 'flex-start', marginTop: 0, marginBottom: 14 }}>
            <button className={styles.btnSubmitText} onClick={loadRefresher} disabled={refresherLoading}>
              {refresherLoading ? 'Loading…' : refresherOpen ? 'Hide refresher' : 'Need a refresher?'}
            </button>
          </div>
          {refresherOpen && refresherText && (
            <div className={`${styles.quizCard} chat-md-content`} style={{ marginBottom: 14 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{refresherText}</ReactMarkdown>
            </div>
          )}

          <div className={styles.quizProgress}>
            <div className={styles.quizProgressFill} style={{ width: `${(currentQ / questions.length) * 100}%`, background: 'var(--blue)' }} />
          </div>

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
              <button className={styles.btnPrimary} onClick={nextQuestion} style={{ background: 'var(--blue)' }}>
                {currentQ < questions.length - 1 ? 'Next →' : 'See Results →'}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'results' && (
        <div className={styles.results}>
          <div className={`${styles.scoreCard} ${passed ? styles.scorePassed : styles.scoreFailed}`}>
            <div className={styles.scoreBig} style={{ color: passed ? 'var(--green)' : 'var(--red)' }}>
              {recalled}/{questions.length}
            </div>
            <div className={styles.scoreLabel}>
              {passed ? 'recalled — solid on this one' : 'recalled — worth another look'}
            </div>
            {wrongList.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-3)', fontFamily: 'IBM Plex Mono, monospace' }}>
                Missed concepts were added back to your weak areas.
              </div>
            )}
          </div>

          {wrongList.length > 0 && (
            <div className={styles.reviewSection}>
              <div className={styles.reviewLabel}>MISSED</div>
              {wrongList.map((i) => {
                const wq = questions[i]
                return (
                  <div key={i} className={styles.reviewItem}>
                    <div className={styles.reviewQ}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineP}>{wq.question}</ReactMarkdown>
                    </div>
                    {wq.type === 'mc' && (
                      <div className={styles.reviewAnswers}>
                        <span className={styles.reviewWrong}>
                          You: {userAnswers[i] || '—'}{userAnswers[i] ? ` — ${(wq as MCQuestion).options[userAnswers[i]]}` : ''}
                        </span>
                        <span className={styles.reviewCorrect}>
                          Correct: {(wq as MCQuestion).correct} — {(wq as MCQuestion).options[(wq as MCQuestion).correct]}
                        </span>
                      </div>
                    )}
                    <div className={styles.reviewExp}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{wq.explanation}</ReactMarkdown>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className={styles.resultActions}>
            <button className={styles.btnPrimary} onClick={loadQuiz} style={{ background: 'var(--blue)' }}>Review Again</button>
            <Link href={backHref} className={styles.btn}>← Back</Link>
            <Link href="/" className={styles.btn}>Dashboard</Link>
          </div>
        </div>
      )}
    </div>
  )
}
