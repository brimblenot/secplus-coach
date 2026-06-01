import { ImageResponse } from 'next/og'

// Apple touch icon (180x180) for iOS "Add to Home Screen". Harmless on Android.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
          fontSize: 105,
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
