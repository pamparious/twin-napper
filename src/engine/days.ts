import type { SleepEvent } from '../model'
import { activeEvents } from '../model'
import { dateKey, minutesBetween, minutesOfDay, shiftDateKey } from './time'

export interface NapSpan {
  eventId: string
  start: Date
  end: Date
  minutes: number
  valid: boolean
}

export interface SleepDay {
  childId: string
  dateKey: string
  wake: Date | null
  bedtime: Date | null
  nightMinutes: number
  naps: NapSpan[]
  /** Kept out of personal statistics, still shown in the log. */
  excluded: boolean
  excludeReason?: string
}

const NAP_OUTLIER_MINUTES = 210

export function reconstructDays(childId: string, events: SleepEvent[], now = new Date()): SleepDay[] {
  const mine = activeEvents(events)
    .filter((event) => event.childId === childId && event.end)
    .sort((a, b) => a.start.localeCompare(b.start))

  const days = new Map<string, SleepDay>()
  const ensure = (key: string): SleepDay => {
    const existing = days.get(key)
    if (existing) return existing
    const created: SleepDay = {
      childId,
      dateKey: key,
      wake: null,
      bedtime: null,
      nightMinutes: 0,
      naps: [],
      excluded: false,
    }
    days.set(key, created)
    return created
  }

  for (const event of mine) {
    const start = new Date(event.start)
    const end = new Date(event.end as string)
    const duration = minutesBetween(start, end)
    if (duration <= 0) continue
    if (event.kind === 'night') {
      const wakeDay = dateKey(end)
      const day = ensure(wakeDay)
      day.wake = end
      day.nightMinutes += duration
      const bedDay = dateKey(start)
      const bed = ensure(bedDay)
      bed.bedtime = start
    } else {
      const day = ensure(dateKey(start))
      day.naps.push({
        eventId: event.id,
        start,
        end,
        minutes: duration,
        valid: duration <= NAP_OUTLIER_MINUTES,
      })
    }
  }

  for (const day of days.values()) {
    day.naps.sort((a, b) => a.start.getTime() - b.start.getTime())
    const wakeMinute = day.wake ? minutesOfDay(day.wake) : null
    if (wakeMinute != null && (wakeMinute < 4 * 60 || wakeMinute > 14 * 60)) {
      day.excluded = true
      day.excludeReason = 'Wake-up outside 04:00–14:00'
    }
    if (day.bedtime && minutesOfDay(day.bedtime) < 17 * 60 && minutesOfDay(day.bedtime) >= 12 * 60) {
      day.excluded = true
      day.excludeReason = 'Bedtime before 17:00'
    }
  }

  const today = dateKey(now)
  if (!days.has(today)) ensure(today)
  return [...days.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

export function recentDays(days: SleepDay[], todayKey: string, count: number): SleepDay[] {
  const keys = new Set<string>()
  for (let i = 1; i <= count; i += 1) keys.add(shiftDateKey(todayKey, -i))
  return days.filter((day) => keys.has(day.dateKey))
}

export function dayByKey(days: SleepDay[], key: string): SleepDay | undefined {
  return days.find((day) => day.dateKey === key)
}
