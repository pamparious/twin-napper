import { useEffect, useMemo, useState } from 'react'
import { DayBar, HourScale } from '../components/Charts'
import { EditSheet } from '../components/EditSheet'
import { accuracySummary } from '../engine/accuracy'
import { midpoint } from '../engine/ageTable'
import { reconstructDays } from '../engine/days'
import { blocksOnDay, type DayBlock } from '../engine/metrics'
import { planChild } from '../engine/recommend'
import {
  dateKey,
  formatAge,
  formatClock,
  formatDayLabel,
  formatDuration,
  minutesBetween,
  minutesOfDay,
  shiftDateKey,
} from '../engine/time'
import { activeEvents, type SleepEvent } from '../model'
import type { Store } from '../state/store'
import { useSnapshot } from '../state/StoreContext'

export function ChildDetail({
  store,
  childId,
  now,
  onBack,
  onUndo,
}: {
  store: Store
  childId: string
  now: Date
  onBack: () => void
  onUndo: (message: string, run: () => void) => void
}) {
  const snap = useSnapshot()
  const child = snap.profile.children.find((item) => item.id === childId)
  const [daysShown, setDaysShown] = useState(7)
  const [editing, setEditing] = useState<SleepEvent | null>(null)
  const plan = child ? planChild(child, snap.events, snap.profile, now) : null

  useEffect(() => {
    if (plan?.next) store.recordPrediction(childId, plan.next.start.toISOString())
  }, [store, childId, plan?.next ? plan.next.start.toISOString() : ''])

  const days = useMemo(() => (child ? reconstructDays(child.id, snap.events, now) : []), [child, snap.events, now])
  if (!child || !plan) {
    return (
      <section className="screen">
        <button type="button" className="back" onClick={onBack}>
          Back
        </button>
        <p>That twin is no longer in Settings.</p>
      </section>
    )
  }

  const name = store.displayName(child.id, child.nickname)
  const todayKey = dateKey(now)
  const today = days.find((day) => day.dateKey === todayKey)
  const history = days.filter((day) => day.dateKey <= todayKey && day.dateKey >= shiftDateKey(todayKey, -(daysShown - 1)))
  const week = days.filter((day) => day.dateKey < todayKey && day.dateKey >= shiftDateKey(todayKey, -7))
  const napLengths = week.flatMap((day) => day.naps.filter((nap) => nap.valid).map((nap) => nap.minutes))
  const wakeGaps = week.flatMap((day) => {
    if (!day.wake || day.naps.length === 0) return []
    return [minutesBetween(day.wake, day.naps[0].start)]
  })
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
  const accuracy = accuracySummary(snap.predictions, child.id, now)
  const ghosts: DayBlock[] = plan.naps.map((nap) => ({
    id: `ghost-${nap.index}`,
    startMin: minutesOfDay(nap.windowStart),
    endMin: Math.max(minutesOfDay(nap.windowStart) + 20, minutesOfDay(nap.end)),
    kind: 'nap',
    predicted: true,
  }))
  const grouped = groupEvents(activeEvents(snap.events).filter((event) => event.childId === child.id), now)

  return (
    <section className="screen">
      <button type="button" className="back" onClick={onBack}>
        Back
      </button>
      <header className="top">
        <p className="eyebrow" style={{ color: child.color }}>
          {child.nickname}
        </p>
        <h1>{name}</h1>
        {plan.age && (
          <p className="subtitle">
            {formatAge(plan.age.chronologicalMonths)} old
            {plan.age.usingCorrected ? ` · corrected ${formatAge(plan.age.correctedMonths)}` : ''}
          </p>
        )}
      </header>
      <h2>Today</h2>
      <DayBar blocks={blocksOnDay(snap.events, child.id, todayKey, now)} ghosts={ghosts} label={`${name} today`} />
      <HourScale />
      <div className="metrics">
        <Metric label="Day sleep" value={formatDuration(today?.naps.reduce((sum, nap) => sum + nap.minutes, 0) ?? 0)} target={plan.table ? `${formatDuration(plan.table.daySleep.min)}–${formatDuration(plan.table.daySleep.max)}` : ''} />
        <Metric label="Last night" value={formatDuration(today?.nightMinutes ?? 0)} target={plan.table ? `${formatDuration(plan.table.nightSleep.min)}–${formatDuration(plan.table.nightSleep.max)}` : ''} />
        <Metric label="Naps today" value={String(today?.naps.length ?? 0)} target={plan.table ? `usually ${plan.table.naps}` : ''} />
        <Metric label="Avg nap, 7 days" value={average(napLengths) == null ? '—' : formatDuration(average(napLengths) ?? 0)} target={plan.table ? `around ${formatDuration(midpoint(plan.table.napLength))}` : ''} />
        <Metric label="First wake window" value={average(wakeGaps) == null ? '—' : formatDuration(average(wakeGaps) ?? 0)} target={plan.table ? `${formatDuration(plan.table.wakeFirst.min)}–${formatDuration(plan.table.wakeFirst.max)}` : ''} />
      </div>
      <p className="reason">{accuracy.label}</p>
      {plan.transitionNote && <p className="reason">{plan.transitionNote}</p>}
      <div className="segment" role="group" aria-label="Chart length">
        {[7, 14].map((count) => (
          <button key={count} type="button" className={daysShown === count ? 'segment-on' : ''} onClick={() => setDaysShown(count)}>
            {count} days
          </button>
        ))}
      </div>
      <ol className="chart-list">
        {history
          .slice()
          .reverse()
          .map((day) => (
            <li key={day.dateKey}>
              <span>{formatDayLabel(new Date(`${day.dateKey}T12:00:00Z`), now)}</span>
              <DayBar blocks={blocksOnDay(snap.events, child.id, day.dateKey, now)} label={day.dateKey} />
            </li>
          ))}
      </ol>
      <h2>Log</h2>
      {grouped.length === 0 && <p className="subtitle">No sleep logged yet.</p>}
      {grouped.map((group) => (
        <section key={group.key}>
          <h3>{group.label}</h3>
          <ul className="log-list">
            {group.events.map((event) => (
              <LogRow
                key={event.id}
                event={event}
                now={now}
                onOpen={() => setEditing(event)}
                onDelete={() => {
                  const copy = event
                  store.removeEvent(event.id)
                  onUndo('Sleep deleted', () => store.saveEvent({ ...copy, deleted: false }))
                }}
              />
            ))}
          </ul>
        </section>
      ))}
      {editing && (
        <EditSheet
          event={editing}
          creating={false}
          children={snap.profile.children}
          events={snap.events}
          profile={snap.profile}
          onClose={() => setEditing(null)}
          onSave={(event) => {
            const previous = editing
            store.saveEvent(event)
            setEditing(null)
            onUndo('Sleep updated', () => store.saveEvent(previous))
          }}
          onDelete={(id) => {
            const previous = editing
            store.removeEvent(id)
            setEditing(null)
            onUndo('Sleep deleted', () => store.saveEvent({ ...previous, deleted: false }))
          }}
        />
      )}
    </section>
  )
}

function Metric({ label, value, target }: { label: string; value: string; target: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {target && <small>{target}</small>}
    </div>
  )
}

function LogRow({
  event,
  now,
  onOpen,
  onDelete,
}: {
  event: SleepEvent
  now: Date
  onOpen: () => void
  onDelete: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [startX, setStartX] = useState<number | null>(null)
  const end = event.end ? new Date(event.end) : now
  const minutes = minutesBetween(new Date(event.start), end)
  return (
    <li className="swipe">
      <button type="button" className="swipe-delete" onClick={onDelete}>
        Delete
      </button>
      <div
        className="swipe-face"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(pointer) => setStartX(pointer.clientX)}
        onPointerMove={(pointer) => {
          if (startX == null) return
          setOffset(Math.max(-88, Math.min(0, pointer.clientX - startX)))
        }}
        onPointerUp={() => {
          setOffset((value) => (value < -44 ? -88 : 0))
          setStartX(null)
        }}
      >
        <button type="button" className="log-row" onClick={onOpen}>
          <span>
            <strong>{event.kind === 'nap' ? 'Nap' : 'Night'}</strong>
            <small>
              {formatClock(new Date(event.start))}–{event.end ? formatClock(new Date(event.end)) : 'now'}
            </small>
          </span>
          <span>{formatDuration(minutes)}</span>
        </button>
      </div>
    </li>
  )
}

function groupEvents(events: SleepEvent[], now: Date): { key: string; label: string; events: SleepEvent[] }[] {
  const groups = new Map<string, SleepEvent[]>()
  for (const event of events) {
    const key = dateKey(new Date(event.start))
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => ({
      key,
      label: formatDayLabel(new Date(`${key}T12:00:00Z`), now),
      events: items.sort((a, b) => b.start.localeCompare(a.start)),
    }))
}
