'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './GuideHelper.module.css'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

// Floating "explain this" helper available while reading any study guide. A button
// opens a chat popup where the student can paste/name a concept from the guide they
// didn't grasp; the helper explains it short-first and offers to go deeper. Backed by
// the low-cost Haiku route /api/session/helper. Self-contained + per-session (no
// persistence) — mirrors the flashcard drill's client-only model.
export default function GuideHelper({
  topicName,
  domain,
  guideContent,
}: {
  topicName: string
  domain: number
  guideContent: string
}) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const send = useCallback(async () => {
    const q = input.trim()
    if (!q || loading) return
    setInput('')

    const prev = history
    const withUser = [...prev, { role: 'user' as const, content: q }]
    setHistory([...withUser, { role: 'assistant' as const, content: '' }])
    setLoading(true)

    try {
      const res = await fetch('/api/session/helper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicName, domain, guideContent, question: q, history: prev }),
      })
      if (!res.ok) throw new Error('helper failed')
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let text = ''
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setHistory([...withUser, { role: 'assistant' as const, content: text }])
      }
      text += decoder.decode()
      setHistory([...withUser, { role: 'assistant' as const, content: text }])
    } catch {
      setHistory([...withUser, { role: 'assistant' as const, content: 'Sorry, something went wrong. Try asking again.' }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, history, topicName, domain, guideContent])

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, open])

  // Focus the input when the popup opens.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {/* Floating launcher — always available while a guide is on screen */}
      {!open && (
        <button
          className={styles.fab}
          onClick={() => setOpen(true)}
          aria-label="Ask the helper to explain a concept"
        >
          <span className={styles.fabIcon}>?</span>
          <span className={styles.fabText}>Explain</span>
        </button>
      )}

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Study guide helper">
          <div className={styles.head}>
            <div className={styles.headTitle}>
              <span className={styles.headDot} />
              Helper
            </div>
            <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close helper">
              ✕
            </button>
          </div>

          <div className={styles.body}>
            {history.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyTitle}>Stuck on something in this guide?</div>
                <div className={styles.emptyBody}>
                  Paste the line or name the concept you didn&apos;t get — I&apos;ll explain it simply, then
                  we can go deeper if you need.
                </div>
              </div>
            ) : (
              history.map((m, i) => (
                <div key={i} className={m.role === 'user' ? styles.msgUser : styles.msgAI}>
                  <span className={styles.msgRole}>{m.role === 'user' ? 'You' : 'Helper'}</span>
                  {m.role === 'user' ? (
                    <span className={styles.msgText}>{m.content}</span>
                  ) : (
                    <div className={`${styles.msgText} chat-md-content`}>
                      {m.content
                        ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        : <span className={styles.typing}>…</span>}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          <div className={styles.inputRow}>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              placeholder="e.g. explain Union-based SQL injection…"
              rows={2}
              disabled={loading}
            />
            <button className={styles.send} onClick={send} disabled={!input.trim() || loading}>
              {loading ? '…' : 'Ask →'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
