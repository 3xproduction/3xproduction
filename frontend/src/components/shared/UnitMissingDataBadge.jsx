import { AlertTriangle } from 'lucide-react'
import { formatMissingUnitDataText, getUnitMissingFields } from '../../utils/unitMissingData'

export default function UnitMissingDataBadge({ unit, role, compact = false }) {
  const missing = getUnitMissingFields(unit, role)
  if (!missing.length) return null

  const text = formatMissingUnitDataText(missing)
  return (
    <div
      title={text}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        marginTop: compact ? 0 : 8,
        padding: compact ? '3px 7px' : '6px 8px',
        borderRadius: 7,
        border: '1px solid #fb923c',
        background: '#fff7ed',
        color: '#9a3412',
        fontSize: compact ? 10.5 : 11,
        fontWeight: 800,
        lineHeight: 1.2,
      }}
    >
      <AlertTriangle size={compact ? 11 : 13} strokeWidth={2.2} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compact ? 'nowrap' : 'normal' }}>
        {text}
      </span>
    </div>
  )
}
