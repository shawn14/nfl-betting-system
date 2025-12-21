import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 180,
  height: 180,
}
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 90,
          background: 'linear-gradient(135deg, #0d1a12 0%, #132918 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 32,
          color: '#ffffff',
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: '-4px',
        }}
      >
        PM
      </div>
    ),
    {
      ...size,
    }
  )
}
