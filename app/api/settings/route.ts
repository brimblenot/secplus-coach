import { NextRequest, NextResponse } from 'next/server'
import { getPaceSettings, updatePaceSettings } from '@/lib/db'

export const dynamic = 'force-dynamic'

// A strict YYYY-MM-DD check that also rejects impossible calendar dates
// (e.g. 2026-02-31) by round-tripping through Date.
function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export async function GET() {
  try {
    return NextResponse.json(await getPaceSettings())
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const patch: { finishTopicsBy?: string; examDate?: string } = {}

    if (body.finishTopicsBy !== undefined) {
      if (!isValidDate(body.finishTopicsBy)) {
        return NextResponse.json({ error: 'finishTopicsBy must be a valid YYYY-MM-DD date' }, { status: 400 })
      }
      patch.finishTopicsBy = body.finishTopicsBy
    }
    if (body.examDate !== undefined) {
      if (!isValidDate(body.examDate)) {
        return NextResponse.json({ error: 'examDate must be a valid YYYY-MM-DD date' }, { status: 400 })
      }
      patch.examDate = body.examDate
    }
    if (patch.finishTopicsBy === undefined && patch.examDate === undefined) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    return NextResponse.json(await updatePaceSettings(patch))
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
