import { NextResponse } from 'next/server'
import { markWeakAreaSessionDone } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await markWeakAreaSessionDone()
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
