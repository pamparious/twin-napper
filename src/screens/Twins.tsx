import { DayBar, HourScale } from '../components/Charts'
import { blocksOnDay, togetherStats } from '../engine/metrics'
import { dateKey, formatDuration } from '../engine/time'
import { useSnapshot, useStore } from '../state/StoreContext'

export function Twins({ now }: { now: Date }) {
  const snap = useSnapshot()
  const store = useStore()
  const [first, second] = snap.profile.children
  const today = dateKey(now)
  const together = first && second ? togetherStats(snap.events, first.id, second.id, now) : { overlapMin: 0, percent: 0 }
  return (
    <section className="screen">
      <header className="top">
        <p className="eyebrow">Both twins</p>
        <h1>Same clock</h1>
        <p className="subtitle">
          Slept together {formatDuration(together.overlapMin)} over 7 days
          {together.percent > 0 ? ` · ${Math.round(together.percent)}% of their sleep` : ''}
        </p>
      </header>
      <HourScale />
      {snap.profile.children.map((child) => (
        <div key={child.id} className="twin-row">
          <span className="avatar" style={{ background: child.color }}>
            {(store.displayName(child.id, child.nickname) || '?').slice(0, 1)}
          </span>
          <div>
            <strong>{store.displayName(child.id, child.nickname)}</strong>
            <DayBar blocks={blocksOnDay(snap.events, child.id, today, now)} label={`${child.nickname} today`} />
          </div>
        </div>
      ))}
      <p className="subtitle">Solid blocks are sleep. Overlapping times are when both were asleep.</p>
    </section>
  )
}
