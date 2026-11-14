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
