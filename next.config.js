/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'postgres' is a server-only package; keep it external so it isn't bundled
  // for the client. (Replaces the old sql.js externalization.)
  serverExternalPackages: ['postgres'],

  // The transcripts are read at runtime via a DYNAMIC fs path
  // (fs.readdirSync(path.join(process.cwd(), 'transcripts'))), which Next's
  // file tracer cannot detect — so without this the .txt files are NOT bundled
  // into the Vercel serverless functions and getTranscript() returns the
  // "[Transcript ... not found]" placeholder in production. Force-include them
  // for every route that calls getTranscript().
  outputFileTracingIncludes: {
    '/api/session': ['./transcripts/**/*'],
    '/api/quiz/domain': ['./transcripts/**/*'],
  },
}

module.exports = nextConfig
