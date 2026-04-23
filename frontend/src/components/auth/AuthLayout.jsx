export default function AuthLayout({ children }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '24px 16px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--white)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)',
        padding: '40px 32px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: 'var(--ink-950, #0A0A0A)',
            fontFamily: 'inherit',
            lineHeight: 1.1,
          }}>
            <span style={{
              background: 'linear-gradient(135deg, #C9A55C 0%, #FFF4D0 50%, #C9A55C 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              fontWeight: 900,
            }}>3X</span>
            <span style={{ marginLeft: 10 }}>ТРИИКС МЕДИА</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
