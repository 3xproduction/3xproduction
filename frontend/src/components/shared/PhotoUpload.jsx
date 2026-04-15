import { useState, useRef } from 'react'

export default function PhotoUpload({ label, onChange }) {
  const [state, setState] = useState('idle') // idle | uploading | done | error
  const [preview, setPreview] = useState(null)
  const inputRef = useRef()

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setState('uploading')
    const reader = new FileReader()
    reader.onload = ev => {
      setPreview(ev.target.result)
      // TODO: upload to R2
      setTimeout(() => setState('done'), 800)
      onChange && onChange(file)
    }
    reader.onerror = () => setState('error')
    reader.readAsDataURL(file)
  }

  return (
    <div
      onClick={() => state !== 'uploading' && inputRef.current.click()}
      style={{
        width: '100%', aspectRatio: '4/3',
        borderRadius: 'var(--radius-card)',
        border: `2px dashed ${state === 'done' ? 'var(--green)' : state === 'error' ? 'var(--red)' : 'var(--border)'}`,
        background: preview ? 'none' : 'var(--bg)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: state === 'uploading' ? 'wait' : 'pointer',
        overflow: 'hidden', position: 'relative',
        transition: 'border-color 0.2s',
      }}
    >
      {preview ? (
        preview.startsWith('data:video') ? (
          <video src={preview} style={{ width: '100%', height: '100%', objectFit: 'contain' }} controls />
        ) : (
          <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        )
      ) : (
        <>
          <span style={{ fontSize: 28, marginBottom: 8 }}>
            {state === 'uploading' ? '⏳' : state === 'error' ? '❌' : '📷'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '0 12px' }}>
            {state === 'uploading' ? 'Загрузка...' : state === 'error' ? 'Ошибка, повторите' : label || 'Нажмите для фото'}
          </span>
        </>
      )}
      {state === 'done' && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: 'var(--green)', color: '#fff',
          borderRadius: '50%', width: 22, height: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
        }}>✓</div>
      )}
      <input ref={inputRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime"
        style={{ display: 'none' }} onChange={handleFile} />
    </div>
  )
}
