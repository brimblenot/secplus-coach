import { NextResponse } from 'next/server'
import {
  getAllTopics, getWeakAreas, getDaysUntilExam, getCompletedCount, getAverageScore,
  getNextTopic, getCourseProgress, getDomainQuizPending, isWeakAreaSessionDoneToday,
  getTopicsCompletedOn, localToday,
  STUDY_ORDER, ALL_TOPICS,
} from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const today = localToday()

    const [topics, weakAreas, daysLeft, completedCount, avgScore, nextTopic, courseProgress, domainQuizPending, weakAreaSessionDoneToday, completedToday] =
      await Promise.all([
        getAllTopics(),
        getWeakAreas(),
        getDaysUntilExam(),
        getCompletedCount(),
        getAverageScore(),
        getNextTopic(),
        getCourseProgress(),
        getDomainQuizPending(),
        isWeakAreaSessionDoneToday(),
        getTopicsCompletedOn(today),
      ])

    const passedIds = new Set(topics.filter((t) => t.status === 'passed').map((t) => t.topic_id))
    const topicsRemaining = STUDY_ORDER.filter((id) => !passedIds.has(id)).length

    // Self-paced: no daily quota, no "behind" pressure. We just report what the
    // student finished today (any topic, in any order) so the dashboard can show it.
    const completedTodayTopics = completedToday.map((id) => {
      const meta = ALL_TOPICS.find((t) => t.id === id)
      return { id, name: meta?.name ?? id }
    })

    // ── Domain stats ───────────────────────────────────────────────────────
    const byDomain: Record<number, typeof topics> = {}
    for (const t of topics) {
      if (!byDomain[t.domain]) byDomain[t.domain] = []
      byDomain[t.domain].push(t)
    }
    const domainStats = Object.entries(byDomain).map(([domain, dt]) => ({
      domain: parseInt(domain),
      total: dt.length,
      completed: dt.filter((t) => t.status === 'passed').length,
      avgScore: (() => {
        const scored = dt.filter((t) => t.quiz_score !== null)
        if (!scored.length) return null
        return Math.round(scored.reduce((s, t) => s + (t.quiz_score ?? 0), 0) / scored.length)
      })(),
    }))

    return NextResponse.json({
      daysLeft,
      completedCount,
      totalTopics: topics.length,
      courseProgress,
      avgScore,
      nextTopic,
      weakAreas,
      domainStats,
      topics,
      domainQuizPending,
      weakAreaSessionDoneToday,
      topicsRemaining,
      completedTodayTopics,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
