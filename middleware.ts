import { NextRequest, NextResponse } from 'next/server'

// Single-password gate for the whole app. Protects the Anthropic API key from
// being run up by anyone who finds the public URL. The login route sets an
// httpOnly cookie whose value must match APP_PASSWORD.
//
// If APP_PASSWORD is unset, the gate is disabled (useful for quick local dev).

const COOKIE = 'app_auth'

export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD
  if (!password) return NextResponse.next() // gate disabled

  const { pathname } = req.nextUrl

  // Always allow the login page + its API so the user can authenticate.
  if (pathname === '/login' || pathname === '/api/login') {
    return NextResponse.next()
  }

  const authed = req.cookies.get(COOKIE)?.value === password
  if (authed) return NextResponse.next()

  // API calls get a clean 401; page requests get redirected to /login.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('from', pathname)
  return NextResponse.redirect(url)
}

// Run on everything except Next internals and static assets.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest).*)'],
}
