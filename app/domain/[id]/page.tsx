'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import styles from './domain.module.css'

interface Topic {
  topic_id: string
  topic_name: string
  domain: number
  status: string
  quiz_score: number | null
  quiz_attempts: number
}

interface ProgressData {
  topics: Topic[]
}

const DOMAIN_NAMES: Record<string, string> = {
  '1': 'General Security Concepts',
  '2': 'Threats, Vulnerabilities & Mitigations',
  '3': 'Security Architecture',
  '4': 'Security Operations',
  '5': 'Security Program Management',
}

const DOMAIN_COLORS: Record<string, string> = {
  '1': '#00d4a0',
  '2': '#f0a020',
  '3': '#4080f0',
  '4': '#9060f0',
  '5': '#f04060',
}

const STATUS_ICONS: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  studying: '…',
  pending: '○',
}

export default function DomainPage() {
  const params = useParams()
  const domainId = params.id as string
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/progress')
      .then((r) => r.json())
      .then((d: ProgressData) => {
        const filtered = d.topics.filter((t) => String(t.domain) === domainId)
        setTopics(filtered)
        setLoading(false)
      })
  }, [domainId])

  const color = DOMAIN_COLORS[domainId] || 'var(--green)'
  const completed = topics.filter((t) => t.status === 'passed').length

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Back</Link>
        <span className={styles.badge} style={{ color, borderColor: color }}>
          D{domainId}
        </span>
      </header>

      <div className={styles.domainTitle}>
        <div className={styles.domainTitleRow}>
          <h1 style={{ color }}>{DOMAIN_NAMES[domainId]}</h1>
          <Link href={`/quiz/domain/${domainId}`} className={styles.finalQuizBtn} style={{ borderColor: color, color }}>
            Final Quiz →
          </Link>
        </div>
        <span className={styles.progress}>{completed}/{topics.length} complete</span>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : (
        <div className={styles.topicList}>
          {topics.map((t, i) => (
            <Link
              key={t.topic_id}
              href={`/session/${t.topic_id}`}
              className={`${styles.topicItem} ${styles[t.status] || ''}`}
              style={{ animationDelay: `${i * 0.03}s` }}
            >
              <span className={styles.topicNum}>{t.topic_id}</span>
              <span className={styles.topicName}>{t.topic_name}</span>
              <div className={styles.topicRight}>
                {t.quiz_score !== null && (
                  <span
                    className={styles.score}
                    style={{ color: t.quiz_score >= 70 ? 'var(--green)' : 'var(--red)' }}
                  >
                    {t.quiz_score}%
                  </span>
                )}
                <span
                  className={styles.statusIcon}
                  style={{
                    color:
                      t.status === 'passed'
                        ? 'var(--green)'
                        : t.status === 'failed'
                        ? 'var(--red)'
                        : t.status === 'studying'
                        ? 'var(--amber)'
                        : 'var(--text-3)',
                  }}
                >
                  {STATUS_ICONS[t.status]}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
