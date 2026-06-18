import { NextResponse } from 'next/server'
import { getDueReviews, localToday } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const topics = await getDueReviews(localToday())
    return NextResponse.json({
      topics: topics.map((t) => ({
        topic_id: t.topic_id,
        topic_name: t.topic_name,
        domain: t.domain,
      })),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
