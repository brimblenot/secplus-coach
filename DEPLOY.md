# Deploying to Vercel (phone access)

The app is a Next.js server app backed by **Supabase Postgres**, gated by a
password, and installable to your Android home screen as a PWA. This guide gets
it onto a public URL you can open on your phone.

## Prerequisites (already done in code)
- DB migrated to Supabase (`lib/db.ts` uses the `postgres` driver).
- Your existing study data is already copied into Supabase (`npm run db:migrate`).
- Password gate via `middleware.ts` + `APP_PASSWORD`.
- PWA manifest + icons (`app/manifest.ts`, `app/icon.tsx`, `app/apple-icon.tsx`).
- Production build verified locally (`npm run build` → exit 0).

## One-time deploy

1. **Put the code on GitHub** (Vercel deploys from a repo). In the project folder:
   ```bash
   git init
   git add .
   git commit -m "Security+ coach: Supabase + auth + mobile"
   ```
   Create a new **private** repo on github.com, then follow its "push an existing
   repository" commands. `.gitignore` already excludes `.env.local`, `data/`, and
   `*.db`, so no secrets or the old local DB get pushed.

2. **Import into Vercel:** vercel.com → Add New → Project → import your repo.
   Framework auto-detects as Next.js. Don't deploy yet — add env vars first.

3. **Add Environment Variables** (Vercel → Project → Settings → Environment
   Variables). Set all three for Production (and Preview if you want):
   | Name | Value |
   |------|-------|
   | `ANTHROPIC_API_KEY` | your Anthropic key (from `.env.local`) |
   | `DATABASE_URL` | your Supabase **Session pooler** URI, port **5432** |
   | `APP_PASSWORD` | the password you'll type to log in |

   ⚠ Use the **Session pooler** string — host `...pooler.supabase.com` ending in
   port **`5432`**. Do **NOT** use the Transaction pooler (port `6543`): under
   this app's concurrent dashboard queries it returned statement-timeout errors
   (`57014`) and the dashboard hung indefinitely. The session pooler runs the
   same queries in ~1s. (This must match the `DATABASE_URL` in your `.env.local`.)

4. **Deploy.** Vercel builds and gives you a URL like
   `https://your-app.vercel.app`.

## On your phone
1. Open the Vercel URL in Chrome → you'll hit the password screen → log in
   (the cookie lasts 60 days, so you won't re-enter it often).
2. Chrome menu → **Add to Home screen** → it installs as "Sec+ Coach" with its
   own icon and opens full-screen (standalone PWA).

## Notes & gotchas
- **Long AI calls:** study-guide/quiz generation can take a while. Vercel's
  Hobby plan caps serverless execution (~60s for streaming). If you ever see a
  generation cut off, that's the function timeout — bump `maxDuration` on the
  affected route or upgrade the plan.
- **Cost protection:** the password gate is what stops a stranger who finds the
  URL from running up your Anthropic bill. Keep `APP_PASSWORD` set in Vercel.
- **Updating later:** push to the GitHub repo → Vercel auto-redeploys.
- **Local dev still works:** `npm run dev` reads `.env.local`. With `APP_PASSWORD`
  set there too, you'll see the login locally as well; unset it locally to skip.
