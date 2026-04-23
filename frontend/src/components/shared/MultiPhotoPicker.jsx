// Компактный multi-upload: одна иконка «Добавить фото», миниатюры под ней.
// Используется на выдаче/рентале/складе проекта. Минимум задаётся через prop `min`.

import { useRef } from 'react'

export default function MultiPhotoPicker({ files = [], onChange, min = 2, label = 'Фото' }) {
  const inputRef = useRef()
  const enough = files.length >= min

  function add(e) {
    const picked = Array.from(e.target.files || [])
    if (!picked.length) return
    onChange([...files, ...picked])
    e.target.value = ''
  }

  function remove(idx) {
    onChange(files.filter((_, i) => i !== idx))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => inputRef.current?.click()}
          style={{
            width: 72, height: 72, flexShrink: 0,
            borderRadius: 10,
            border: `2px dashed ${enough ? 'var(--green)' : 'var(--border)'}`,
            background: 'var(--bg)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', gap: 2, color: 'var(--muted)',
          }}
          title={`Добавить фото (мин. ${min})`}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>📷</span>
          <span style={{ fontSize: 10, fontWeight: 500 }}>+ {label}</span>
        </button>
        {files.map((f, i) => {
          const url = URL.createObjectURL(f)
          const isVideo = f.type?.startsWith('video/')
          return (
            <div key={i} style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
              {isVideo ? (
                <video src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
              ) : (
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
              )}
              <button type="button" onClick={() => remove(i)}
                style={{
                  position: 'absolute', top: -6, right: -6,
                  width: 20, height: 20, borderRadius: '50%',
                  border: 'none', background: 'var(--red)',
                  color: '#fff', fontSize: 12, cursor: 'pointer',
                  lineHeight: 1, padding: 0,
                }}>×</button>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 11, color: enough ? 'var(--green)' : 'var(--muted)' }}>
        {enough ? `✓ ${files.length} фото` : `Нужно ещё ${Math.max(0, min - files.length)} · минимум ${min}`}
      </div>
      <input ref={inputRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime"
        multiple style={{ display: 'none' }} onChange={add} />
    </div>
  )
}
