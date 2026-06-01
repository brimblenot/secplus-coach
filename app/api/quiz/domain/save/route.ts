import { NextRequest, NextResponse } from 'next/server'
import { saveDomainQuizResult } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { domain, score } = await req.json()
    await saveDomainQuizResult(Number(domain), Number(score))
    return NextResponse.json({ ok: true, passed: score >= 80 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
