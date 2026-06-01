/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'postgres' is a server-only package; keep it external so it isn't bundled
  // for the client. (Replaces the old sql.js externalization.)
  serverExternalPackages: ['postgres'],
}

module.exports = nextConfig
