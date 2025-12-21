import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 32,
  height: 32,
}
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 18,
          background: 'linear-gradient(135deg, #0d1a12 0%, #132918 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          color: '#ffffff',
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: '-1px',
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
