import type { DayBlock } from '../engine/metrics'

export function DayBar({
  blocks,
  ghosts = [],
  label,
}: {
  blocks: DayBlock[]
  ghosts?: DayBlock[]
  label: string
}) {
  return (
    <svg className="daybar" viewBox="0 0 240 36" role="img" aria-label={label}>
      <rect className="daybar-track" x="0" y="8" width="240" height="16" rx="4" />
      {blocks.map((block) => (
        <rect
          key={block.id}
          className={block.kind === 'night' ? 'daybar-night' : 'daybar-nap'}
          x={(block.startMin / 1440) * 240}
          y="8"
          width={Math.max(1.5, ((block.endMin - block.startMin) / 1440) * 240)}
          height="16"
          rx="3"
        />
      ))}
      {ghosts.map((block) => (
        <rect
          key={block.id}
          className="daybar-ghost"
          x={(block.startMin / 1440) * 240}
          y="8"
          width={Math.max(1.5, ((block.endMin - block.startMin) / 1440) * 240)}
          height="16"
          rx="3"
        />
      ))}
    </svg>
  )
}

export function ColumnChart({
  values,
  target,
  color,
  labels,
  label,
}: {
  values: number[]
  target: [number, number] | null
  color: string
  labels?: string[]
  label: string
}) {
  const width = 320
  const plot = 72
  const height = labels ? 96 : 80
  const max = Math.max(target?.[1] ?? 0, ...values, 1)
  const gap = values.length > 14 ? 1 : 3
  const barW = (width - gap * Math.max(0, values.length - 1)) / Math.max(1, values.length)
  return (
    <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {target && target[1] > target[0] && (
        <rect
          className="target-band"
          x="0"
          y={plot - (target[1] / max) * plot}
          width={width}
          height={((target[1] - target[0]) / max) * plot}
        />
      )}
      {values.map((value, index) => {
        const bar = (value / max) * plot
        return (
          <rect
            key={index}
            x={index * (barW + gap)}
            y={plot - bar}
            width={barW}
            height={value > 0 ? Math.max(2, bar) : 0}
            rx="2"
            fill={color}
          />
        )
      })}
      {labels?.map((text, index) => (
        <text key={`${text}-${index}`} x={index * (barW + gap) + barW / 2} y={height - 2} textAnchor="middle" className="trend-label">
          {text}
        </text>
      ))}
    </svg>
  )
}

export function DualTrend({
  wake,
  bed,
  label,
}: {
  wake: (number | null)[]
  bed: (number | null)[]
  label: string
}) {
  const width = 320
  const height = 88
  const min = 4 * 60
  const max = 23 * 60
  const xAt = (index: number) => (wake.length <= 1 ? width / 2 : (index / (wake.length - 1)) * width)
  const yAt = (minute: number) => height - 12 - ((minute - min) / (max - min)) * (height - 20)
  const path = (values: (number | null)[]) => {
    let drawing = false
    let commands = ''
    values.forEach((value, index) => {
      if (value == null) {
        drawing = false
        return
      }
      commands += `${drawing ? 'L' : 'M'}${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)} `
      drawing = true
    })
    return commands.trim()
  }
  return (
    <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {[6, 12, 18].map((hour) => (
        <line key={hour} className="trend-grid" x1="0" x2={width} y1={yAt(hour * 60)} y2={yAt(hour * 60)} />
      ))}
      <path className="trend-wake" d={path(wake)} />
      <path className="trend-bed" d={path(bed)} />
    </svg>
  )
}

export function HourScale() {
  return (
    <div className="hour-scale" aria-hidden="true">
      <span>00</span>
      <span>06</span>
      <span>12</span>
      <span>18</span>
      <span>24</span>
    </div>
  )
}
