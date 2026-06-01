import { NextResponse } from 'next/server'
import {
  getAllTopics, getWeakAreas, getDaysUntilExam, getCompletedCount, getAverageScore,
  getNextTopic, getCourseProgress, getDomainQuizPending, isWeakAreaSessionDoneToday,
  getTopicEstimates, saveTopicEstimates, getDailyPlan, saveDailyPlan, getTopicsCompletedOn,
  STUDY_ORDER, ALL_TOPICS,
} from '@/lib/db'
import { estimateTopicMinutes } from '@/lib/estimates'

export const dynamic = 'force-dynamic'

const DAILY_BUDGET_MINUTES = 75  // midpoint of 1–1.5h
const EXAM_BUFFER_DAYS = 3       // finish 3 days before exam

export async function GET() {
  try {
    const today = new Date().toISOString().split('T')[0]

    const [topics, weakAreas, daysLeft, completedCount, avgScore, nextTopic, courseProgress, domainQuizPending, weakAreaSessionDoneToday, existingEstimates, savedPlan, completedToday] =
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
        getTopicEstimates(),
        getDailyPlan(today),
        getTopicsCompletedOn(today),
      ])

    // ── Ensure all topics have estimates (one-time batch call if cache is cold) ──
    const passedIds = new Set(topics.filter((t) => t.status === 'passed').map((t) => t.topic_id))
    const remainingInOrder = STUDY_ORDER.filter((id) => !passedIds.has(id))

    const missingIds = remainingInOrder.filter((id) => !(id in existingEstimates))
    if (missingIds.length > 0) {
      const toEstimate = ALL_TOPICS
        .filter((t) => missingIds.includes(t.id))
        .map((t) => ({ topic_id: t.id, topic_name: t.name, domain: t.domain }))
      try {
        const newEstimates = await estimateTopicMinutes(toEstimate)
        await saveTopicEstimates(newEstimates)
        Object.assign(existingEstimates, newEstimates)
      } catch (e) {
        console.error('Estimate call failed, using defaults:', e)
      }
    }

    // ── Density metrics ────────────────────────────────────────────────────
    const DEFAULT_MINUTES = 20
    const effectiveDays = Math.max(0, daysLeft - EXAM_BUFFER_DAYS)

    const totalRemainingMinutes = remainingInOrder.reduce(
      (sum, id) => sum + (existingEstimates[id] ?? DEFAULT_MINUTES), 0
    )

    const minutesPerDayNeeded = effectiveDays > 0
      ? Math.round(totalRemainingMinutes / effectiveDays)
      : totalRemainingMinutes

    // ── Persist today's plan (generate once, reuse on revisits) ───────────
    let planIds: string[]
    if (savedPlan) {
      planIds = savedPlan
    } else {
      // Generate fresh plan: fill up to budget from remaining topics
      const freshIds: string[] = []
      let mins = 0
      for (const id of remainingInOrder) {
        const m = existingEstimates[id] ?? DEFAULT_MINUTES
        const meta = ALL_TOPICS.find((t) => t.id === id)
        if (!meta) continue
        if (mins === 0 || mins + m <= DAILY_BUDGET_MINUTES) {
          freshIds.push(id)
          mins += m
        } else {
          break
        }
      }
      planIds = freshIds
      if (planIds.length > 0) await saveDailyPlan(today, planIds)
    }

    // Enrich plan with completion status
    const completedTodaySet = new Set(completedToday)
    const planTopics = planIds.map((id) => {
      const meta = ALL_TOPICS.find((t) => t.id === id)
      return {
        id,
        name: meta?.name ?? id,
        minutes: existingEstimates[id] ?? DEFAULT_MINUTES,
        completedToday: completedTodaySet.has(id),
      }
    })

    const planCompletedCount = planTopics.filter((t) => t.completedToday).length
    const planTotalMinutes = planTopics.reduce((s, t) => s + t.minutes, 0)
    const planDoneMinutes = planTopics.filter((t) => t.completedToday).reduce((s, t) => s + t.minutes, 0)

    // Topics completed today that weren't in the original plan
    const planSet = new Set(planIds)
    const additionalCompleted = completedToday
      .filter((id) => !planSet.has(id))
      .map((id) => {
        const meta = ALL_TOPICS.find((t) => t.id === id)
        return { id, name: meta?.name ?? id }
      })

    // Legacy todayTopics/todayMinutes fields derived from plan
    const todayMinutes = planTotalMinutes

    // Catch-up: topics needed to eliminate deficit
    const totalAvailableMinutes = effectiveDays * DAILY_BUDGET_MINUTES
    const deficitMinutes = Math.max(0, totalRemainingMinutes - totalAvailableMinutes)
    let catchupTopics = 0
    let catchupMinutes = 0
    for (const id of remainingInOrder) {
      if (catchupMinutes >= deficitMinutes) break
      catchupMinutes += existingEstimates[id] ?? DEFAULT_MINUTES
      catchupTopics++
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
      planTotalMinutes,
      planDoneMinutes,
      additionalCompleted,
      // Density-aware fields
      todayMinutes,
      totalRemainingMinutes,
      minutesPerDayNeeded,
      catchupTopics,
      catchupMinutes,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
