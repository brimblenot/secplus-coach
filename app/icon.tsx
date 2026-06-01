import { ImageResponse } from 'next/og'

// Generated app icon (512x512) — a simple monospace "S+" mark on the app's
// dark background. Used by the PWA manifest and as the favicon.
export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d0d15',
          color: '#00c896',
          fontSize: 300,
          fontWeight: 700,
          fontFamily: 'monospace',
          letterSpacing: '-0.05em',
        }}
      >
        S+
      </div>
    ),
    size
  )
}
