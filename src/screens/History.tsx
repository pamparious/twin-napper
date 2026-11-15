import { useState } from 'react'
import { DayBar, DualTrend, HourScale, SleepColumns } from '../components/Charts'
import { EditSheet } from '../components/EditSheet'
import { ScheduleList, type ScheduleRow } from '../components/ScheduleList'
import { ageSnapshot, expectationForMonths } from '../engine/ageTable'
import { dayByKey, reconstructDays } from '../engine/days'
import { blocksOnDay, togetherStats } from '../engine/metrics'
import {
  dateKey,
  formatClock,
  formatDayLabel,
  formatDuration,
  formatHm,
  formatLongDate,
  minutesBetween,
  minutesOfDay,
  shiftDateKey,
  zonedParts,
  zonedTimeToUtc,
} from '../engine/time'
import { TIME_ZONE, activeEvents, type SleepEvent } from '../model'
import { useSnapshot, useStore } from '../state/StoreContext'

export function History({ now }: { now: Date }) {
  const snap = useSnapshot()
  const store = useStore()
  const [span, setSpan] = useState<7 | 28>(7)
  const [dayKey, setDayKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<SleepEvent | null>(null)
  const [first, second] = snap.profile.children
  const together = first && second ? togetherStats(snap.events, first.id, second.id, now, span) : { overlapMin: 0, percent: 0 }
  const seriesByChild = snap.profile.children.map((child) => ({
    child,
    name: store.displayName(child.id, child.nickname),
    series: pointsFor(child.id, snap.events, now, span),
  }))
  const dayKeys = seriesByChild[0]?.series.map((day) => day.key) ?? []

  function openEvent(id: string) {
    const found = activeEvents(snap.events).find((event) => event.id === id)
    if (found) setEditing(found)
  }

  return (
    <section className="screen">
      <header className="top">
        <p className="eyebrow">Over time</p>
        <h1>History</h1>
        <p className="subtitle">Averages skip empty days. Press a day to see and edit what was logged.</p>
      </header>
      <div className="segment" role="group" aria-label="History length">
        {[7, 28].map((count) => (
          <button key={count} type="button" className={span === count ? 'segment-on' : ''} onClick={() => setSpan(count as 7 | 28)}>
            {count} days
          </button>
        ))}
      </div>

      <section className="group">
        <h2>Both twins</h2>
        {together.overlapMin > 0 ? (
          <>
            <p className="dash-lead">Asleep at the same time for {formatDuration(together.overlapMin)}</p>
            <p className="subtitle">That is {Math.round(together.percent)}% of their sleep across these {span} days.</p>
          </>
        ) : (
          <p className="subtitle">No overlapping sleep in these {span} days.</p>
        )}
      </section>

      {seriesByChild.map(({ child, name, series }) => {
        const withSleep = series.filter((day) => day.total > 0)
        const wakes = series.filter((day) => day.wake != null)
        const beds = series.filter((day) => day.bed != null)
        const age = child.birthDate ? ageSnapshot(child.birthDate, child.dueDate, now) : null
        const table = age ? expectationForMonths(age.months) : null
        const averageSleep = mean(withSleep.map((day) => day.total))
        const averageNight = mean(series.filter((day) => day.night > 0).map((day) => day.night))
        const averageNaps = mean(withSleep.map((day) => day.naps))
        const missingNight = withSleep.some((day) => day.night === 0)
        const averageCount = mean(withSleep.map((day) => day.napCount))
        const loggedLabel = withSleep.length === 0 ? 'Nothing logged in this period' : `Across ${withSleep.length} logged day${withSleep.length === 1 ? '' : 's'}`
        return (
          <section key={child.id} className="group">
            <h2 style={{ color: child.color }}>{name}</h2>
            <p className="subtitle">{loggedLabel}</p>
            <div className="metrics">
              <Stat
                label="Total sleep"
                value={averageSleep == null ? '—' : `${formatDuration(averageSleep)} a day`}
                hint={
                  table && averageSleep != null
                    ? `${rangeStatus(averageSleep / 60, table.totalSleep.min, table.totalSleep.max)} · target ${hourRange(table.totalSleep.min, table.totalSleep.max)}${missingNight ? ' · some days have no night logged' : ''}`
                    : 'Night plus naps'
                }
              />
              <Stat
                label="Night"
                value={averageNight == null ? '—' : formatDuration(averageNight)}
                hint={table ? `Logged nights · target ${formatDuration(table.nightSleep.min)}–${formatDuration(table.nightSleep.max)}` : 'Sleep that ended in the morning'}
              />
              <Stat
                label="Naps"
                value={averageNaps == null ? '—' : formatDuration(averageNaps)}
                hint={table ? `Target ${formatDuration(table.daySleep.min)}–${formatDuration(table.daySleep.max)}` : 'Daytime sleep'}
              />
              <Stat
                label="Naps a day"
                value={averageCount == null ? '—' : countLabel(averageCount)}
                hint={table ? `Usual for this age: ${countLabel(table.naps)}` : undefined}
              />
              <Stat label="Usual wake-up" value={clockAverage(wakes.map((day) => day.wake))} hint={wakes.length ? `From ${wakes.length} morning${wakes.length === 1 ? '' : 's'}` : 'No wake-up logged'} />
              <Stat label="Usual bedtime" value={clockAverage(beds.map((day) => day.bed))} hint={beds.length ? `From ${beds.length} night${beds.length === 1 ? '' : 's'}` : 'No bedtime logged'} />
            </div>

            <h3>Sleep each day</h3>
            <p className="subtitle">
              The lower part of each bar is night. The upper part is naps. The band is the age target for total sleep. A missing bar is a day with nothing logged.
              {span === 28 ? ' Numbers under the bars are the day of the month.' : ''}
            </p>
            {withSleep.length > 0 ? (
              <SleepColumns
                night={series.map((day) => day.night)}
                naps={series.map((day) => day.naps)}
                target={table ? [table.totalSleep.min * 60, table.totalSleep.max * 60] : null}
                color={child.color}
                labels={series.map((day) => day.axis)}
                sublabels={span === 7 ? series.map((day) => day.axisSub) : undefined}
                label={sleepChartLabel(name, series)}
              />
            ) : (
              <p className="subtitle">No sleep logged in these {span} days.</p>
            )}
            <p className="legend">
              <span className="swatch night" /> Night
              <span className="swatch" style={{ background: child.color }} /> Naps
              <span className="swatch target" /> Age target
            </p>

            <h3>Wake-up and bedtime</h3>
            <p className="subtitle">Higher on the chart is later in the day. The numbers on the left are the hour.</p>
            <DualTrend
              wake={series.map((day) => day.wake)}
              bed={series.map((day) => day.bed)}
              labels={series.map((day) => day.axis)}
              label={clockChartLabel(name, series)}
            />
            <p className="legend">
              <span className="swatch wake" /> Wake-up
              <span className="swatch bed" /> Bedtime
            </p>
          </section>
        )
      })}

      <h2>Each day</h2>
      <p className="subtitle">Midnight is on the left and the next midnight is on the right. Purple is night. Each twin’s colour is a nap.</p>
      <div className="day-scale" aria-hidden="true">
        <HourScale />
      </div>
      <ul className="log-list">
        {[...dayKeys].reverse().map((key) => {
          const when = dateFromKey(key)
          const title = formatDayLabel(when, now)
          return (
          <li key={key}>
            <button type="button" className="day-card" onClick={() => setDayKey(key)}>
              <span className="day-heading">
                <strong>{title}</strong>
                {(title === 'Today' || title === 'Yesterday') && <span>{formatLongDate(when)}</span>}
              </span>
              {seriesByChild.map(({ child, name, series }) => {
                const day = series.find((item) => item.key === key)
                return (
                  <span key={child.id} className="day-twin">
                    <span className="day-name" style={{ color: child.color }}>
                      {name}
                    </span>
                    <DayBar blocks={blocksOnDay(snap.events, child.id, key, now)} napColor={child.color} label="" />
                    <span className="day-meta">{day ? daySummary(day) : 'No sleep logged'}</span>
                  </span>
                )
              })}
            </button>
          </li>
          )
        })}
      </ul>

      {dayKey && (
        <div className="sheet-backdrop" onClick={() => setDayKey(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={dayKey} onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <h2>{formatLongDate(dateFromKey(dayKey))}</h2>
            {snap.profile.children.map((child) => {
              const rows = loggedRows(snap.events, child.id, dayKey)
              return (
                <article key={child.id} className="child-card">
                  <div className="card-open">
                    <span className="avatar" style={{ background: child.color }} aria-hidden="true">
                      {store.displayName(child.id, child.nickname).slice(0, 1)}
                    </span>
                    <strong>{store.displayName(child.id, child.nickname)}</strong>
                  </div>
                  {rows.length > 0 ? (
                    <ScheduleList label={`${child.nickname} on ${dayKey}`} rows={rows} onEdit={openEvent} />
                  ) : (
                    <p className="subtitle">No sleep logged this day.</p>
                  )}
                </article>
              )
            })}
            <button type="button" className="button secondary" onClick={() => setDayKey(null)}>
              Close
            </button>
          </div>
        </div>
      )}
      {editing && (
        <EditSheet
          event={editing}
          creating={false}
          children={snap.profile.children}
          events={snap.events}
          profile={snap.profile}
          onClose={() => setEditing(null)}
          onSave={(event) => {
            store.saveEvent(event)
            setEditing(null)
          }}
          onDelete={() => {
            store.removeEvent(editing.id)
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  )
}

type DayPoint = {
  key: string
  axis: string
  axisSub: string
  wake: number | null
  bed: number | null
  night: number
  naps: number
  napCount: number
  total: number
}

function pointsFor(childId: string, events: SleepEvent[], now: Date, count: number): DayPoint[] {
  const days = reconstructDays(childId, events, now)
  const today = dateKey(now)
  const rows: DayPoint[] = []
  for (let ago = count - 1; ago >= 0; ago -= 1) {
    const key = shiftDateKey(today, -ago)
    const day = dayByKey(days, key)
    const napMinutes = day?.naps.reduce((sum, nap) => sum + nap.minutes, 0) ?? 0
    const night = day?.nightMinutes ?? 0
    const date = dateFromKey(key)
    const parts = zonedParts(date)
    const show = count <= 8 || ago % 4 === 0 || ago === count - 1
    rows.push({
      key,
      axis: show ? (count <= 8 ? weekday(date) : String(parts.day)) : '',
      axisSub: count <= 8 ? String(parts.day) : '',
      wake: day?.wake ? minutesOfDay(day.wake) : null,
      bed: day?.bedtime ? minutesOfDay(day.bedtime) : null,
      night,
      naps: napMinutes,
      napCount: day?.naps.length ?? 0,
      total: night + napMinutes,
    })
  }
  return rows
}

function daySummary(day: DayPoint): string {
  if (day.total <= 0 && day.wake == null && day.bed == null) return 'No sleep logged'
  const parts: string[] = []
  if (day.wake != null) parts.push(`Woke ${formatHm(day.wake)}`)
  if (day.bed != null) parts.push(`Bed ${formatHm(day.bed)}`)
  parts.push(day.napCount > 0 ? `${day.napCount} nap${day.napCount === 1 ? '' : 's'}, ${formatDuration(day.naps)}` : 'No naps')
  return parts.join(' · ')
}

function loggedRows(events: SleepEvent[], childId: string, key: string): ScheduleRow[] {
  const mine = activeEvents(events).filter((event) => event.childId === childId)
  const rows: ScheduleRow[] = []
  const wake = mine.find((event) => event.kind === 'night' && event.end && dateKey(new Date(event.end)) === key)
  if (wake?.end) {
    rows.push({
      key: `${wake.id}-wake`,
      eventId: wake.id,
      time: formatClock(new Date(wake.end)),
      label: 'Woke',
      detail: 'Night sleep',
      tone: 'done',
    })
  }
  const naps = mine
    .filter((event) => event.kind === 'nap' && dateKey(new Date(event.start)) === key)
    .sort((a, b) => a.start.localeCompare(b.start))
  naps.forEach((nap, index) => {
    rows.push({
      key: nap.id,
      eventId: nap.id,
      time: nap.end ? `${formatClock(new Date(nap.start))}–${formatClock(new Date(nap.end))}` : formatClock(new Date(nap.start)),
      label: `Nap ${index + 1}`,
      detail: nap.end ? formatDuration(minutesBetween(new Date(nap.start), new Date(nap.end))) : 'Still asleep',
      tone: nap.end ? 'done' : 'now',
    })
  })
  const bed = mine.find((event) => event.kind === 'night' && dateKey(new Date(event.start)) === key)
  if (bed) {
    rows.push({
      key: bed.id,
      eventId: bed.id,
      time: bed.end ? `${formatClock(new Date(bed.start))}–${formatClock(new Date(bed.end))}` : formatClock(new Date(bed.start)),
      label: 'Night',
      detail: bed.end ? formatDuration(minutesBetween(new Date(bed.start), new Date(bed.end))) : 'Still asleep',
      tone: bed.end ? 'done' : 'now',
    })
  }
  return rows
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return zonedTimeToUtc(year, month, day, 12, 0)
}

function weekday(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short' }).format(date)
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clockAverage(values: (number | null)[]): string {
  const logged = values.filter((value): value is number => value != null)
  const average = mean(logged)
  return average == null ? '—' : formatHm(average)
}

function countLabel(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function hourRange(min: number, max: number): string {
  return `${countLabel(min)}–${countLabel(max)}h`
}

function rangeStatus(hours: number, min: number, max: number): string {
  if (hours < min - 0.15) return 'Under the age range'
  if (hours > max + 0.15) return 'Over the age range'
  return 'Inside the age range'
}

function sleepChartLabel(name: string, series: DayPoint[]): string {
  const days = series
    .filter((day) => day.total > 0)
    .map((day) => `${day.axis || day.axisSub}: night ${formatDuration(day.night)}, naps ${formatDuration(day.naps)}`)
  return `${name} sleep each day. ${days.join('. ')}`
}

function clockChartLabel(name: string, series: DayPoint[]): string {
  const days = series
    .filter((day) => day.wake != null || day.bed != null)
    .map((day) => `${day.axis || day.axisSub}: wake ${day.wake == null ? 'not logged' : formatHm(day.wake)}, bedtime ${day.bed == null ? 'not logged' : formatHm(day.bed)}`)
  return `${name} wake-up and bedtime. ${days.join('. ')}`
}
