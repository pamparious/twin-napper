import type { DayBlock } from '../engine/metrics'

export function DayBar({
  blocks,
  ghosts = [],
  label,
  napColor,
}: {
  blocks: DayBlock[]
  ghosts?: DayBlock[]
  label: string
  napColor?: string
}) {
  return (
    <svg className="daybar" viewBox="0 0 240 36" role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      <rect className="daybar-track" x="0" y="8" width="240" height="16" rx="4" />
      {blocks.map((block) => (
        <rect
          key={block.id}
          className={block.kind === 'night' ? 'daybar-night' : 'daybar-nap'}
          fill={block.kind === 'nap' && napColor ? napColor : undefined}
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

export function SleepColumns({
  night,
  naps,
  target,
  color,
  labels,
  sublabels,
  label,
}: {
  night: number[]
  naps: number[]
  target: [number, number] | null
  color: string
  labels: string[]
  sublabels?: string[]
  label: string
}) {
  const width = 320
  const gutter = 32
  const plotW = width - gutter - 2
  const plotH = 96
  const top = 14
  const bottom = sublabels?.some(Boolean) ? 30 : 16
  const height = top + plotH + bottom
  const totals = night.map((value, index) => value + (naps[index] ?? 0))
  const max = Math.max(target?.[1] ?? 0, ...totals, 8 * 60)
  const count = Math.max(1, night.length)
  const gap = count > 14 ? 1 : 4
  const barW = (plotW - gap * (count - 1)) / count
  const yAt = (minutes: number) => top + plotH - (minutes / max) * plotH
  const ticks = hourTicks(max)
  return (
    <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {ticks.map((minutes) => (
        <g key={minutes}>
          <line className="trend-grid" x1={gutter} x2={width} y1={yAt(minutes)} y2={yAt(minutes)} />
          <text className="trend-axis" x={gutter - 4} y={yAt(minutes)} textAnchor="end" dominantBaseline="middle">
            {minutes / 60}h
          </text>
        </g>
      ))}
      {target && target[1] > target[0] && (
        <g>
          <rect className="target-band" x={gutter} y={yAt(target[1])} width={plotW} height={yAt(target[0]) - yAt(target[1])} />
          {yAt(target[0]) - yAt(target[1]) >= 14 && (
            <text className="trend-axis" x={width - 4} y={(yAt(target[0]) + yAt(target[1])) / 2} textAnchor="end" dominantBaseline="middle">
              Target
            </text>
          )}
        </g>
      )}
      {night.map((value, index) => {
        const nap = naps[index] ?? 0
        const total = value + nap
        const x = gutter + index * (barW + gap)
        return (
          <g key={index}>
            {value > 0 && (
              <rect x={x} y={yAt(value)} width={barW} height={Math.max(1, (value / max) * plotH)} rx="2" className="sleep-night" />
            )}
            {nap > 0 && (
              <rect x={x} y={yAt(total)} width={barW} height={Math.max(1, (nap / max) * plotH)} rx="2" fill={color} />
            )}
            {count <= 8 && total > 0 && (
              <text className="trend-value" x={x + barW / 2} y={yAt(total) - 3} textAnchor="middle">
                {compactHours(total)}
              </text>
            )}
            <text className="trend-axis" x={x + barW / 2} y={top + plotH + 12} textAnchor="middle">
              {labels[index]}
            </text>
            {sublabels?.[index] && (
              <text className="trend-axis" x={x + barW / 2} y={top + plotH + 24} textAnchor="middle">
                {sublabels[index]}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function DualTrend({
  wake,
  bed,
  labels,
  label,
}: {
  wake: (number | null)[]
  bed: (number | null)[]
  labels?: string[]
  label: string
}) {
  const width = 320
  const gutter = 32
  const height = labels?.length ? 128 : 100
  const min = 5 * 60
  const max = 23 * 60
  const plotBottom = labels?.length ? height - 22 : height - 8
  const plotTop = 8
  const xAt = (index: number) => {
    if (wake.length <= 1) return gutter + (width - gutter) / 2
    return gutter + (index / (wake.length - 1)) * (width - gutter - 4)
  }
  const yAt = (minute: number) => plotBottom - ((minute - min) / (max - min)) * (plotBottom - plotTop)
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
  const hours = [6, 12, 18, 22]
  return (
    <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {hours.map((hour) => (
        <g key={hour}>
          <line className="trend-grid" x1={gutter} x2={width} y1={yAt(hour * 60)} y2={yAt(hour * 60)} />
          <text className="trend-axis" x={gutter - 4} y={yAt(hour * 60)} textAnchor="end" dominantBaseline="middle">
            {String(hour).padStart(2, '0')}
          </text>
        </g>
      ))}
      <path className="trend-wake" d={path(wake)} />
      <path className="trend-bed" d={path(bed)} />
      {wake.map((value, index) =>
        value == null ? null : <circle key={`w${index}`} className="trend-wake-dot" cx={xAt(index)} cy={yAt(value)} r="3" />,
      )}
      {bed.map((value, index) =>
        value == null ? null : <circle key={`b${index}`} className="trend-bed-dot" cx={xAt(index)} cy={yAt(value)} r="3" />,
      )}
      {labels?.map((text, index) => (
        <text key={`${text}-${index}`} className="trend-axis" x={xAt(index)} y={height - 4} textAnchor="middle">
          {text}
        </text>
      ))}
    </svg>
  )
}

function hourTicks(maxMinutes: number): number[] {
  const maxHours = Math.max(8, Math.ceil(maxMinutes / 60))
  const step = maxHours > 16 ? 4 : 2
  const ticks: number[] = []
  for (let hour = step; hour <= maxHours; hour += step) ticks.push(hour * 60)
  return ticks
}

function compactHours(minutes: number): string {
  const hours = minutes / 60
  if (hours >= 10) return `${Math.round(hours)}h`
  const rounded = Math.round(hours * 10) / 10
  return `${rounded}h`
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
