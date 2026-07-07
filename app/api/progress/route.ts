import { NextResponse } from 'next/server'
import {
  getAllTopics, getWeakAreas, getCompletedCount, getAverageScore,
  getNextTopic, getCourseProgress, getDomainQuizPending, isWeakAreaSessionDoneToday,
  getTopicsCompletedOn, localToday, getPaceSettings, daysUntil,
  STUDY_ORDER, ALL_TOPICS,
} from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const today = localToday()

    const [topics, weakAreas, completedCount, avgScore, nextTopic, courseProgress, domainQuizPending, weakAreaSessionDoneToday, completedToday, paceSettings] =
      await Promise.all([
        getAllTopics(),
        getWeakAreas(),
        getCompletedCount(),
        getAverageScore(),
        getNextTopic(),
        getCourseProgress(),
        getDomainQuizPending(),
        isWeakAreaSessionDoneToday(),
        getTopicsCompletedOn(today),
        getPaceSettings(),
      ])

    const passedIds = new Set(topics.filter((t) => t.status === 'passed').map((t) => t.topic_id))
    const topicsRemaining = STUDY_ORDER.filter((id) => !passedIds.has(id)).length

    // Self-paced: no daily quota, no "behind" pressure. We just report what the
    // student finished today (any topic, in any order) so the dashboard can show it.
    const completedTodayTopics = completedToday.map((id) => {
      const meta = ALL_TOPICS.find((t) => t.id === id)
      return { id, name: meta?.name ?? id }
    })

    // ── Pace ────────────────────────────────────────────────────────────────
    // Self-paced but goal-anchored: derive the topics/day needed to finish the
    // remaining topics by the target date. daysUntilFinish counts today, so with
    // N days left (today inclusive) the pace spreads the remaining work evenly.
    const daysUntilFinishRaw = daysUntil(paceSettings.finishTopicsBy)
    const daysUntilFinish = Math.max(0, daysUntilFinishRaw)
    const finishPastDue = daysUntilFinishRaw < 0
    // Days remaining are counted inclusively of today (so "1 day left" = do the
    // rest today). If the target is today or past, all remaining topics are due now.
    const daysToWork = Math.max(1, daysUntilFinish + 1)
    const perDay = topicsRemaining === 0
      ? 0
      : finishPastDue
        ? topicsRemaining
        : Math.ceil(topicsRemaining / daysToWork)
    const doneToday = completedTodayTopics.length
    const pace = {
      finishTopicsBy: paceSettings.finishTopicsBy,
      examDate: paceSettings.examDate,
      daysUntilFinish,
      daysUntilExam: Math.max(0, daysUntil(paceSettings.examDate)),
      finishPastDue,
      topicsRemaining,
      perDay,
      doneToday,
      onPace: topicsRemaining === 0 || (!finishPastDue && doneToday >= perDay),
    }

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
      pace,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
