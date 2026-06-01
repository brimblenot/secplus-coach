'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './session.module.css'

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

type Phase = 'loading-guide' | 'guide' | 'loading-quiz' | 'quiz' | 'loading-second-chance' | 'second-chance' | 'results'

export default function SessionPage() {
  const params = useParams()
  const topicId = params.id as string

  const [phase, setPhase] = useState<Phase>('loading-guide')
  const [guideContent, setGuideContent] = useState('')
  const [topicName, setTopicName] = useState('')
  const [domain, setDomain] = useState(0)
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentQ, setCurrentQ] = useState(0)
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({})
  const [answered, setAnswered] = useState(false)
  const [score, setScore] = useState(0)
  const [wrongIndices, setWrongIndices] = useState<number[]>([])
  const [passed, setPassed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newWeakAreas, setNewWeakAreas] = useState<string[]>([])

  // Text question state
  const [textAnswer, setTextAnswer] = useState('')
  const [textGrading, setTextGrading] = useState(false)
  const [textGradeResult, setTextGradeResult] = useState<{ passed: boolean; feedback: string } | null>(null)

  // Second-chance state
  const [secondChanceQs, setSecondChanceQs] = useState<MCQuestion[]>([])
  const [scIdx, setScIdx] = useState(0)
  const [scAnswers, setScAnswers] = useState<Record<number, string>>({})
  const [scAnswered, setScAnswered] = useState(false)
  // Maps second-chance index → original main-quiz wrong index
  const [wrongIdxMap, setWrongIdxMap] = useState<number[]>([])

  const [retakeKey, setRetakeKey] = useState(0)
  const isRetake = retakeKey > 0

  // Chat state
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const streamBufRef = useRef('')

  useEffect(() => {
    setPhase('loading-guide')
    setGuideContent('')
    streamBufRef.current = ''

    const ac = new AbortController()

    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicId }),
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          setGuideContent('Error loading study guide. Check your API key and transcripts folder.')
          setPhase('guide')
          return
        }

        setTopicName(decodeURIComponent(res.headers.get('X-Topic-Name') || ''))
        setDomain(parseInt(res.headers.get('X-Domain') || '0'))

        // Buffer the full stream silently — no progressive updates
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        if (!reader) return

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          streamBufRef.current += decoder.decode(value, { stream: true })
        }
        streamBufRef.current += decoder.decode()

        // Display all content at once when generation is complete
        setGuideContent(streamBufRef.current)
        setPhase('guide')
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setGuideContent('Error loading study guide. Check your API key.')
          setPhase('guide')
        }
      })

    return () => { ac.abort() }
  }, [topicId, retakeKey])

  const startQuiz = async () => {
    setPhase('loading-quiz')
    setUserAnswers({})
    setCurrentQ(0)
    setAnswered(false)
    setWrongIndices([])
    setTextAnswer('')
    setTextGradeResult(null)

    const res = await fetch('/api/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicId, studyGuideContent: guideContent, isRetake }),
    })

    if (!res.ok) {
      setPhase('guide')
      return
    }

    const data = await res.json()
    setQuestions(data.questions)
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

  const saveResults = async (finalScore: number, wrong: number[], weakAreaIdxs: number[]) => {
    setSaving(true)
    const saveRes = await fetch('/api/quiz/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicId, score: finalScore, questions, wrongIndices: wrong, userAnswers, weakAreaIndices: weakAreaIdxs }),
    })
    const saveData = await saveRes.json()
    setPassed(saveData.passed)
    setNewWeakAreas(saveData.newWeakAreas || [])
    setSaving(false)
    setPhase('results')
  }

  const nextQuestion = async () => {
    setTextAnswer('')
    setTextGradeResult(null)

    if (currentQ < questions.length - 1) {
      setCurrentQ((prev) => prev + 1)
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
      const finalScore = mcTotal > 0 ? Math.round((correct / mcTotal) * 100) : 100
      setScore(finalScore)
      setWrongIndices(wrong)

      // If any MC wrong, offer a second chance before flagging weak areas
      if (wrong.length > 0) {
        setPhase('loading-second-chance')
        const wrongQs = wrong.map((i) => ({
          question: (questions[i] as MCQuestion).question,
          options: (questions[i] as MCQuestion).options,
          correct: (questions[i] as MCQuestion).correct,
          explanation: questions[i].explanation,
        }))
        try {
          const res = await fetch('/api/quiz/second-chance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wrongQuestions: wrongQs, topicName }),
          })
          if (res.ok) {
            const data = await res.json()
            setSecondChanceQs(data.questions ?? [])
            setWrongIdxMap(wrong)
            setScIdx(0)
            setScAnswers({})
            setScAnswered(false)
            setPhase('second-chance')
            return
          }
        } catch { /* fall through to direct save */ }
        // Second-chance fetch failed — flag all wrong answers
        await saveResults(finalScore, wrong, wrong)
      } else {
        await saveResults(finalScore, wrong, [])
      }
    }
  }

  const handleSCAnswer = (letter: string) => {
    if (scAnswered) return
    setScAnswers((prev) => ({ ...prev, [scIdx]: letter }))
    setScAnswered(true)
  }

  const nextSecondChance = async () => {
    if (scIdx < secondChanceQs.length - 1) {
      setScIdx((p) => p + 1)
      setScAnswered(false)
    } else {
      // Determine which original-quiz indices still need to be flagged
      const currentAnswers = scAnswers
      const stillWrong = secondChanceQs
        .map((scQ, i) => (currentAnswers[i] !== scQ.correct ? wrongIdxMap[i] : -1))
        .filter((idx) => idx >= 0)
      await saveResults(score, wrongIndices, stillWrong)
    }
  }

  const sendChat = useCallback(async () => {
    const q = chatInput.trim()
    if (!q || chatLoading) return
    setChatInput('')

    const prevHistory = chatHistory
    const withUser = [...prevHistory, { role: 'user' as const, content: q }]
    setChatHistory([...withUser, { role: 'assistant' as const, content: '' }])
    setChatLoading(true)

    try {
      const res = await fetch('/api/session/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicName, domain, guideContent, question: q, history: prevHistory }),
      })
      if (!res.ok) throw new Error('Chat failed')
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let text = ''
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setChatHistory([...withUser, { role: 'assistant' as const, content: text }])
      }
      text += decoder.decode()
      setChatHistory([...withUser, { role: 'assistant' as const, content: text }])
    } catch {
      setChatHistory([...withUser, { role: 'assistant' as const, content: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setChatLoading(false)
    }
  }, [chatInput, chatLoading, chatHistory, topicName, domain, guideContent])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  const handleRetake = () => {
    setPhase('loading-guide')
    setQuestions([])
    setWrongIndices([])
    setUserAnswers({})
    setCurrentQ(0)
    setAnswered(false)
    setScore(0)
    setPassed(false)
    setNewWeakAreas([])
    setSecondChanceQs([])
    setScIdx(0)
    setScAnswers({})
    setScAnswered(false)
    setWrongIdxMap([])
    setTextAnswer('')
    setTextGradeResult(null)
    setRetakeKey((k) => k + 1)
  }

  const q = questions[currentQ]
  const userAnswerForCurrent = userAnswers[currentQ]
  const isTextQ = q?.type === 'text'

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href={domain ? `/domain/${domain}` : '/'} className={styles.back}>
          ← Back
        </Link>
        {topicName && (
          <span className={styles.topicBadge}>
            {topicId} · {topicName}
          </span>
        )}
        <span className={styles.phaseBadge} style={
          phase === 'second-chance' || phase === 'loading-second-chance'
            ? { color: 'var(--amber)', background: 'var(--amber-dim)', borderColor: 'var(--amber-border)' }
            : {}
        }>
          {phase === 'loading-guide' && '⟳ Loading'}
          {phase === 'guide' && 'Study'}
          {phase === 'loading-quiz' && '⟳ Generating quiz'}
          {phase === 'quiz' && `${currentQ + 1}/${questions.length}`}
          {phase === 'loading-second-chance' && '⟳ Second Chance'}
          {phase === 'second-chance' && `2nd Chance ${scIdx + 1}/${secondChanceQs.length}`}
          {phase === 'results' && 'Results'}
        </span>
      </header>

      {/* ── STUDY GUIDE ── */}
      {(phase === 'loading-guide' || phase === 'guide') && (
        <div className={styles.guideWrap}>
          {phase === 'loading-guide' && (
            <div className={styles.guideLoading}>
              <div className={styles.loadingBar}>
                <div className={styles.loadingBarFill} />
              </div>
              <span className={styles.guideLoadingLabel}>Generating study guide…</span>
            </div>
          )}
          {phase === 'guide' && (
            <div className={`${styles.guideContent} md-content`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{guideContent}</ReactMarkdown>
            </div>
          )}
          {phase === 'guide' && guideContent && (
            <div className={styles.guideActions}>
              <button className={styles.btnPrimary} onClick={startQuiz}>
                Start Quiz →
              </button>
              {isRetake && (
                <span className={styles.retakeNote}>Retake — new questions generated</span>
              )}
            </div>
          )}

          {/* ── Chat ── */}
          {phase === 'guide' && guideContent && (
            <div className={styles.chatSection}>
              <div className={styles.chatLabel}>ASK A QUESTION</div>
              {chatHistory.length > 0 && (
                <div className={styles.chatMessages}>
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={msg.role === 'user' ? styles.chatMsgUser : styles.chatMsgAI}>
                      <span className={styles.chatMsgRole}>{msg.role === 'user' ? 'You' : 'AI'}</span>
                      {msg.role === 'user'
                        ? <span className={styles.chatMsgText}>{msg.content}</span>
                        : <div className={`${styles.chatMsgText} chat-md-content`}><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div>
                      }
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
              <div className={styles.chatInputRow}>
                <input
                  className={styles.chatInput}
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendChat() }}
                  placeholder={`Ask anything about ${topicName || 'this topic'}…`}
                  disabled={chatLoading}
                />
                <button
                  className={styles.chatSend}
                  onClick={sendChat}
                  disabled={!chatInput.trim() || chatLoading}
                >
                  {chatLoading ? '…' : 'Ask →'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── QUIZ LOADING ── */}
      {phase === 'loading-quiz' && (
        <div className={styles.loadingQuiz}>
          <div className={styles.loadingDot} />
          <span>Generating quiz…</span>
        </div>
      )}

      {/* ── QUIZ ── */}
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
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
                  {q.question}
                </ReactMarkdown>
              </div>

              <div className={styles.options}>
                {Object.entries((q as MCQuestion).options).map(([letter, text]) => {
                  let optClass = styles.option
                  if (answered) {
                    if (letter === (q as MCQuestion).correct) optClass = `${styles.option} ${styles.optCorrect}`
                    else if (letter === userAnswerForCurrent) optClass = `${styles.option} ${styles.optWrong}`
                    else optClass = `${styles.option} ${styles.optDim}`
                  }
                  return (
                    <button
                      key={letter}
                      className={optClass}
                      onClick={() => handleMCAnswer(letter)}
                      disabled={answered}
                    >
                      <span className={styles.optLetter}>{letter}</span>
                      <span className={styles.optText}>{text}</span>
                    </button>
                  )
                })}
              </div>

              {answered && (
                <div className={`${styles.explanation} ${userAnswerForCurrent === (q as MCQuestion).correct ? styles.expCorrect : styles.expWrong}`}>
                  <div className={styles.expLabel}>
                    {userAnswerForCurrent === (q as MCQuestion).correct
                      ? '✓ Correct'
                      : `✗ Wrong — correct answer: ${(q as MCQuestion).correct}`}
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

      {/* ── SECOND CHANCE LOADING ── */}
      {phase === 'loading-second-chance' && (
        <div className={styles.loadingQuiz}>
          <div className={styles.loadingDot} />
          <span>Generating second-chance questions…</span>
        </div>
      )}

      {/* ── SECOND CHANCE QUIZ ── */}
      {phase === 'second-chance' && secondChanceQs[scIdx] && (() => {
        const scQ = secondChanceQs[scIdx]
        const scAns = scAnswers[scIdx]
        return (
          <div className={styles.quizWrap}>
            <div className={styles.scBanner}>
              <span className={styles.scBannerLabel}>Second Chance</span>
              <span className={styles.scBannerSub}>
                Same concept, different question — get it right and it won&apos;t be flagged as a weak area
              </span>
            </div>

            <div className={styles.quizProgress}>
              <div
                className={styles.quizProgressFill}
                style={{ width: `${(scIdx / secondChanceQs.length) * 100}%`, background: 'var(--amber)' }}
              />
            </div>

            <div className={styles.quizCard} style={{ borderColor: 'var(--amber-border)' }}>
              <div className={styles.qNum}>Question {scIdx + 1} of {secondChanceQs.length}</div>
              <div className={styles.qText}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
                  {scQ.question}
                </ReactMarkdown>
              </div>

              <div className={styles.options}>
                {Object.entries(scQ.options).map(([letter, text]) => {
                  let optClass = styles.option
                  if (scAnswered) {
                    if (letter === scQ.correct) optClass = `${styles.option} ${styles.optCorrect}`
                    else if (letter === scAns) optClass = `${styles.option} ${styles.optWrong}`
                    else optClass = `${styles.option} ${styles.optDim}`
                  }
                  return (
                    <button key={letter} className={optClass} onClick={() => handleSCAnswer(letter)} disabled={scAnswered}>
                      <span className={styles.optLetter}>{letter}</span>
                      <span className={styles.optText}>{text}</span>
                    </button>
                  )
                })}
              </div>

              {scAnswered && (
                <div className={`${styles.explanation} ${scAns === scQ.correct ? styles.expCorrect : styles.expWrong}`}>
                  <div className={styles.expLabel}>
                    {scAns === scQ.correct
                      ? '✓ Correct — this concept will not be flagged'
                      : `✗ Wrong — this concept will be flagged for review`}
                  </div>
                  <div className={styles.expText}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{scQ.explanation}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>

            {scAnswered && (
              <div className={styles.nextRow}>
                <button
                  className={styles.btnPrimary}
                  style={{ background: 'var(--amber)' }}
                  onClick={nextSecondChance}
                >
                  {scIdx < secondChanceQs.length - 1 ? 'Next →' : 'See Results →'}
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── RESULTS ── */}
      {phase === 'results' && (
        <div className={styles.results}>
          {saving ? (
            <div className={styles.loadingQuiz}>
              <div className={styles.loadingDot} />
              <span>Saving results…</span>
            </div>
          ) : (
            <>
              <div className={`${styles.scoreCard} ${passed ? styles.scorePassed : styles.scoreFailed}`}>
                <div className={styles.scoreBig} style={{ color: passed ? 'var(--green)' : 'var(--red)' }}>
                  {score}%
                </div>
                <div className={styles.scoreLabel}>
                  {passed
                    ? `Passed — ${questions.filter(q => q.type !== 'text').length - wrongIndices.length}/${questions.filter(q => q.type !== 'text').length} correct`
                    : `Failed — need 70% to pass`}
                </div>
                {!passed && (
                  <div className={styles.failNote}>
                    ⚠ Score below 70% — retake required before moving on
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

              {newWeakAreas.length > 0 && (
                <div className={styles.weakNotice}>
                  <div className={styles.weakNoticeLabel}>⚠ NEW WEAK AREAS FLAGGED</div>
                  {newWeakAreas.map((w) => (
                    <div key={w} className={styles.weakNoticeItem}>{w}</div>
                  ))}
                </div>
              )}

              <div className={styles.resultActions}>
                {!passed && (
                  <button className={styles.btnPrimary} onClick={handleRetake}>
                    Retake Quiz
                  </button>
                )}
                <Link href="/" className={styles.btn}>Dashboard</Link>
                {passed && (
                  <span className={styles.nextHint}>Next topic unlocked on dashboard →</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
