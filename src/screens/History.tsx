import { useState } from 'react'
import { ColumnChart, DualTrend } from '../components/Charts'
import { ageSnapshot, expectationForMonths } from '../engine/ageTable'
import { dayByKey, reconstructDays } from '../engine/days'
import { togetherStats } from '../engine/metrics'
import { dateKey, formatDuration, shiftDateKey, minutesOfDay, zonedTimeToUtc } from '../engine/time'
import { TIME_ZONE } from '../model'
import { useSnapshot, useStore } from '../state/StoreContext'

export function History({ now }: { now: Date }) {
  const snap = useSnapshot()
  const store = useStore()
  const [span, setSpan] = useState<7 | 28>(7)
  const [first, second] = snap.profile.children
  const together = first && second ? togetherStats(snap.events, first.id, second.id, now, span) : { overlapMin: 0, percent: 0 }

  return (
    <section className="screen">
      <header className="top">
        <p className="eyebrow">Over time</p>
        <h1>History</h1>
        <p className="subtitle">
          Slept together {formatDuration(together.overlapMin)}
          {together.percent > 0 ? ` · ${Math.round(together.percent)}% of their sleep` : ''}
        </p>
      </header>
      <div className="segment" role="group" aria-label="History length">
        {[7, 28].map((count) => (
          <button key={count} type="button" className={span === count ? 'segment-on' : ''} onClick={() => setSpan(count as 7 | 28)}>
            {count} days
          </button>
        ))}
      </div>
      {snap.profile.children.map((child) => {
        const name = store.displayName(child.id, child.nickname)
        const series = seriesFor(child.id, snap.events, now, span)
        const logged = series.filter((day) => day.total > 0)
        const averageSleep = logged.length ? logged.reduce((sum, day) => sum + day.total, 0) / logged.length : null
        const averageNaps = logged.length ? logged.reduce((sum, day) => sum + day.naps, 0) / logged.length : null
        const age = child.birthDate ? ageSnapshot(child.birthDate, child.dueDate, now) : null
        const target = age ? expectationForMonths(age.months).totalSleep : null
        const targetLabel = target ? `${formatHours(target.min)}–${formatHours(target.max)}` : ''
        return (
          <section key={child.id} className="group">
            <h2 style={{ color: child.color }}>{name}</h2>
            <p className="subtitle">
              {averageSleep == null ? 'No sleep logged in this period.' : `${formatDuration(averageSleep)} a day`}
              {targetLabel ? ` · target ${targetLabel}` : ''}
            </p>
            {averageNaps != null && <p className="subtitle">About {averageNaps.toFixed(1)} naps a day</p>}
            <h3>Sleep</h3>
            <ColumnChart
              values={series.map((day) => day.total)}
              target={target ? [target.min * 60, target.max * 60] : null}
              color={child.color}
              labels={span === 7 ? series.map((day) => day.weekday) : undefined}
              label={`${name} sleep over ${span} days${targetLabel ? `, target ${targetLabel}` : ''}`}
            />
            <h3>Wake and bedtime</h3>
            <DualTrend
              wake={series.map((day) => day.wake)}
              bed={series.map((day) => day.bed)}
              label={`${name} wake-up and bedtime over ${span} days`}
            />
            <p className="subtitle">
              <span className="swatch wake" /> Wake-up
              <span className="swatch bed" /> Bedtime
            </p>
          </section>
        )
      })}
    </section>
  )
}

function seriesFor(childId: string, events: Parameters<typeof reconstructDays>[1], now: Date, count: number) {
  const days = reconstructDays(childId, events, now)
  const today = dateKey(now)
  const rows = []
  for (let ago = count - 1; ago >= 0; ago -= 1) {
    const key = shiftDateKey(today, -ago)
    const day = dayByKey(days, key)
    const napMinutes = day?.naps.reduce((sum, nap) => sum + nap.minutes, 0) ?? 0
    rows.push({
      key,
      weekday: weekday(key),
      wake: day?.wake ? minutesOfDay(day.wake) : null,
      bed: day?.bedtime ? minutesOfDay(day.bedtime) : null,
      total: (day?.nightMinutes ?? 0) + napMinutes,
      naps: day?.naps.length ?? 0,
    })
  }
  return rows
}

function weekday(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'narrow' }).format(zonedTimeToUtc(year, month, day, 12, 0))
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10
  return `${rounded}h`
}
