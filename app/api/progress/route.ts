import { NextResponse } from 'next/server'
import {
  getAllTopics, getWeakAreas, getDaysUntilExam, getCompletedCount, getAverageScore,
  getNextTopic, getCourseProgress, getDomainQuizPending, isWeakAreaSessionDoneToday,
  getDailyPlan, saveDailyPlan, getTopicsCompletedOn, localToday,
  STUDY_ORDER, ALL_TOPICS,
} from '@/lib/db'

export const dynamic = 'force-dynamic'

const GOAL_TOPICS_PER_DAY = 5   // the daily goal
const EXAM_BUFFER_DAYS = 3      // finish 3 days before exam (leaves review time)

export async function GET() {
  try {
    const today = localToday()

    const [topics, weakAreas, daysLeft, completedCount, avgScore, nextTopic, courseProgress, domainQuizPending, weakAreaSessionDoneToday, savedPlan, completedToday] =
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
        getDailyPlan(today),
        getTopicsCompletedOn(today),
      ])

    const passedIds = new Set(topics.filter((t) => t.status === 'passed').map((t) => t.topic_id))
    const remainingInOrder = STUDY_ORDER.filter((id) => !passedIds.has(id))
    const topicsRemaining = remainingInOrder.length

    // ── Pace (pure topic-count calculation) ──────────────────────────────────
    // Catch-up is front-loaded into TODAY rather than spread as a daily rate:
    // we tell the student exactly how many topics to finish today so that the
    // remaining days can run at the manageable GOAL_TOPICS_PER_DAY pace and still
    // finish by the exam (minus a small buffer).
    //
    //   catchupToday = remaining − goal · (daysAfterToday)
    //
    // i.e. do this many today, then 5/day clears the rest. When on pace this is
    // ≤ goal, so today's target is just the goal.
    const effectiveDays = Math.max(1, daysLeft - EXAM_BUFFER_DAYS)
    const goalPerDay = GOAL_TOPICS_PER_DAY
    const daysAfterToday = Math.max(0, effectiveDays - 1)
    const catchupToday = topicsRemaining - goalPerDay * daysAfterToday
    // Today's target: the goal, bumped up to the catch-up burst when behind,
    // never more than what's actually left.
    const topicsPerDay = Math.min(topicsRemaining, Math.max(goalPerDay, catchupToday))
    const behind = topicsPerDay > goalPerDay
    // Even-spread rate, kept for the coach's context only.
    const requiredPerDay = topicsRemaining > 0 ? Math.ceil(topicsRemaining / effectiveDays) : 0

    // ── Persist today's plan (generate once, reuse on revisits) ───────────────
    let planIds: string[]
    if (savedPlan) {
      planIds = savedPlan
    } else {
      planIds = remainingInOrder.slice(0, topicsPerDay)
      if (planIds.length > 0) await saveDailyPlan(today, planIds)
    }

    // Enrich plan with completion status
    const completedTodaySet = new Set(completedToday)
    const planTopics = planIds.map((id) => {
      const meta = ALL_TOPICS.find((t) => t.id === id)
      return {
        id,
        name: meta?.name ?? id,
        completedToday: completedTodaySet.has(id),
      }
    })

    const planCompletedCount = planTopics.filter((t) => t.completedToday).length

    // Topics completed today that weren't in the original plan
    const planSet = new Set(planIds)
    const additionalCompleted = completedToday
      .filter((id) => !planSet.has(id))
      .map((id) => {
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
      effectiveDays,
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
      // Plan tracking
      planTopics,
      planCompletedCount,
      additionalCompleted,
      // Topic-based pace
      topicsRemaining,
      goalPerDay,
      requiredPerDay,
      topicsPerDay,
      catchupToday: topicsPerDay,
      behind,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
