import { NextRequest, NextResponse } from 'next/server'
import { getWeakAreas, resolveWeakArea } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ weakAreas: await getWeakAreas() })
}

export async function PATCH(req: NextRequest) {
  const { id } = await req.json()
  await resolveWeakArea(id)
  return NextResponse.json({ success: true })
}
