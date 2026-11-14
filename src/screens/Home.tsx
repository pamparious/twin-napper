import { useEffect, useState } from 'react'
import { blankEvent, EditSheet } from '../components/EditSheet'
import { addMinutes, formatClock, formatCounter, inClockRange, minutesOfDay, roundToFive } from '../engine/time'
import { planChild, suggestedWakeTime, twinSyncPlan, type DayPlan } from '../engine/recommend'
import { activeEvents, uid, type Child, type SleepEvent } from '../model'
import type { Store } from '../state/store'
import { useSnapshot } from '../state/StoreContext'

export function Home({
  store,
  now,
  onOpenChild,
  onUndo,
}: {
  store: Store
  now: Date
  onOpenChild: (id: string) => void
  onUndo: (message: string, run: () => void) => void
}) {
  const snap = useSnapshot()
  const [draft, setDraft] = useState<SleepEvent | null>(null)
  const plans = snap.profile.children.map((child) => planChild(child, snap.events, snap.profile, now))
  const shared = snap.profile.settings.twinSync ? twinSyncPlan(plans) : null

  useEffect(() => {
    for (const plan of plans) {
      if (plan.next) store.recordPrediction(plan.childId, plan.next.start.toISOString())
    }
  }, [store, plans.map((plan) => (plan.next ? plan.next.start.toISOString() : '')).join('|')])

  function running(childId: string): SleepEvent | undefined {
    return activeEvents(snap.events).find((event) => event.childId === childId && !event.end)
  }

  function start(child: Child) {
    const event: SleepEvent = {
      id: uid(),
      childId: child.id,
      start: now.toISOString(),
      end: null,
      kind: inClockRange(now, snap.profile.settings.nightStart, snap.profile.settings.nightEnd) ? 'night' : 'nap',
      updatedAt: now.toISOString(),
      updatedBy: snap.yourName,
    }
    store.saveEvent(event)
    onUndo('Sleep started', () => store.removeEvent(event.id))
  }

  function stop(event: SleepEvent) {
    const previous = event
    store.saveEvent({ ...event, end: now.toISOString() })
    onUndo('Sleep stopped', () => store.saveEvent({ ...previous, end: null }))
  }

  function toggleBoth() {
    const awake = snap.profile.children.filter((child) => !running(child.id))
    if (awake.length === 0) {
      const open = snap.profile.children.map((child) => running(child.id)).filter((event): event is SleepEvent => Boolean(event))
      const copies = open.map((event) => ({ ...event }))
      for (const event of open) store.saveEvent({ ...event, end: now.toISOString() })
      onUndo('Both stopped', () => {
        for (const event of copies) store.saveEvent({ ...event, end: null })
      })
      return
    }
    const created: SleepEvent[] = awake.map((child) => ({
      id: uid(),
      childId: child.id,
      start: now.toISOString(),
      end: null,
      kind: inClockRange(now, snap.profile.settings.nightStart, snap.profile.settings.nightEnd) ? 'night' : 'nap',
      updatedAt: now.toISOString(),
      updatedBy: snap.yourName,
    }))
    for (const event of created) store.saveEvent(event)
    onUndo('Sleep started', () => {
      for (const event of created) store.removeEvent(event.id)
    })
  }

  const bothAsleep = snap.profile.children.every((child) => running(child.id))

  return (
    <section className="home">
      <header className="top">
        <p className="eyebrow">Today</p>
        <h1>Twin Napper</h1>
      </header>
      {snap.catchUp && (
        <div className="banner">
          <p>{snap.catchUp}</p>
          <button type="button" onClick={() => store.dismissCatchUp()}>
            OK
          </button>
        </div>
      )}
      {snap.status.kind === 'auth' && <div className="banner warn">{snap.status.message}</div>}
      {shared && <p className="together">{shared.label}</p>}
      <div className="spacer" />
      <div className="card-stack">
        {snap.profile.children.map((child, index) => (
          <ChildCard
            key={child.id}
            child={child}
            name={store.displayName(child.id, child.nickname)}
            plan={plans[index]}
            active={running(child.id)}
            awakeFrom={awakeFrom(snap.events, child.id)}
            now={now}
            onOpen={() => onOpenChild(child.id)}
            onStart={() => start(child)}
            onStop={(event) => stop(event)}
            onFix={(event, end) => {
              const previous = event
              store.saveEvent({ ...event, end: end.toISOString() })
              onUndo('End time updated', () => store.saveEvent({ ...previous, end: null }))
            }}
            onLog={() => setDraft(blankEvent(child.id, snap.profile, now))}
          />
        ))}
        <button type="button" className="button both" onClick={toggleBoth}>
          {bothAsleep ? 'Wake both' : 'Sleep both'}
        </button>
      </div>
      {draft && (
        <EditSheet
          event={draft}
          creating
          children={snap.profile.children}
          events={snap.events}
          profile={snap.profile}
          onClose={() => setDraft(null)}
          onSave={(event) => {
            store.saveEvent(event)
            setDraft(null)
            onUndo('Sleep logged', () => store.removeEvent(event.id))
          }}
          onDelete={() => setDraft(null)}
        />
      )}
    </section>
  )
}

function ChildCard({
  child,
  name,
  plan,
  active,
  awakeFrom,
  now,
  onOpen,
  onStart,
  onStop,
  onFix,
  onLog,
}: {
  child: Child
  name: string
  plan: DayPlan
  active?: SleepEvent
  awakeFrom: Date | null
  now: Date
  onOpen: () => void
  onStart: () => void
  onStop: (event: SleepEvent) => void
  onFix: (event: SleepEvent, end: Date) => void
  onLog: () => void
}) {
  const asleep = Boolean(active)
  const since = active ? new Date(active.start) : awakeFrom
  const forgotten = active ? forgottenEnd(active, plan, now) : null
  return (
    <article className="child-card" style={{ borderColor: child.color }}>
      <button type="button" className="card-open" onClick={onOpen}>
        <span className="avatar" style={{ background: child.color }} aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <span>
          <strong>{name}</strong>
          <span className={asleep ? 'state asleep' : 'state awake'}>
            {asleep ? `Asleep ${formatCounter(since, now)}` : `Awake ${since ? formatCounter(since, now) : '—'}`}
          </span>
        </span>
      </button>
      <p className="guidance">{asleep ? plan.headline : plan.headline}</p>
      {!asleep && plan.next && <p className="reason">{plan.next.reason}</p>}
      {plan.transitionNote && <p className="reason">{plan.transitionNote}</p>}
      {active && forgotten && (
        <div className="forgotten">
          <p>Still asleep?</p>
          <button type="button" onClick={() => onFix(active, forgotten)}>
            Woke at {formatClock(forgotten)}?
          </button>
        </div>
      )}
      <div className="card-actions">
        <button type="button" className={asleep ? 'button stop' : 'button primary'} onClick={() => (active ? onStop(active) : onStart())}>
          {asleep ? 'Stop' : 'Start'}
        </button>
        <button type="button" className="button quiet" onClick={onLog}>
          + Log past sleep
        </button>
      </div>
    </article>
  )
}

function awakeFrom(events: SleepEvent[], childId: string): Date | null {
  const ended = activeEvents(events)
    .filter((event) => event.childId === childId && event.end)
    .sort((a, b) => (a.end ?? '').localeCompare(b.end ?? ''))
  const last = ended.at(-1)
  return last?.end ? new Date(last.end) : null
}

function forgottenEnd(event: SleepEvent, plan: DayPlan, now: Date): Date | null {
  const elapsed = now.getTime() - new Date(event.start).getTime()
  const napTooLong = event.kind === 'nap' && elapsed > 3.5 * 60 * 60 * 1000
  const nightLeftOn = event.kind === 'night' && minutesOfDay(now) >= 12 * 60
  if (!napTooLong && !nightLeftOn) return null
  const guess = suggestedWakeTime(event, plan)
  const when = guess.getTime() < now.getTime() ? guess : addMinutes(now, -15)
  return roundToFive(when)
}
