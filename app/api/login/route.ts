import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Verifies the submitted password against APP_PASSWORD and, on success, sets an
// httpOnly cookie that the middleware checks on every subsequent request.
export async function POST(req: NextRequest) {
  const password = process.env.APP_PASSWORD
  if (!password) {
    return NextResponse.json({ ok: true }) // gate disabled — nothing to check
  }

  let submitted = ''
  try {
    const body = await req.json()
    submitted = typeof body?.password === 'string' ? body.password : ''
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }

  if (submitted !== password) {
    return NextResponse.json({ ok: false, error: 'Incorrect password' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('app_auth', password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 60, // 60 days
  })
  return res
}
