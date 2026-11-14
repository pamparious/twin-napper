import { TIME_ZONE } from '../model'

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const partFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function zonedParts(date: Date): ZonedParts {
  const bag: Partial<ZonedParts> = {}
  for (const part of partFormat.formatToParts(date)) {
    if (part.type === 'year') bag.year = Number(part.value)
    if (part.type === 'month') bag.month = Number(part.value)
    if (part.type === 'day') bag.day = Number(part.value)
    if (part.type === 'hour') bag.hour = Number(part.value)
    if (part.type === 'minute') bag.minute = Number(part.value)
    if (part.type === 'second') bag.second = Number(part.value)
  }
  return bag as ZonedParts
}

/** Convert a Stockholm wall-clock time to a UTC Date. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  let utc = desired
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(utc))
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    utc += desired - asUtc
  }
  return new Date(utc)
}

export function minutesOfDay(date: Date): number {
  const parts = zonedParts(date)
  return parts.hour * 60 + parts.minute
}

export function dateKey(date: Date): string {
  const parts = zonedParts(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function monthKey(date: Date): string {
  return dateKey(date).slice(0, 7)
}

export function parseHm(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

export function formatHm(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440
  const hour = Math.floor(wrapped / 60)
  const minute = wrapped % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function formatClock(date: Date): string {
  const parts = zonedParts(date)
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

export function formatDayLabel(date: Date, now = new Date()): string {
  const key = dateKey(date)
  const today = dateKey(now)
  const yesterdayDate = addMinutes(startOfLocalDay(now), -24 * 60)
  if (key === today) return 'Today'
  if (key === dateKey(yesterdayDate)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date)
}

export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

export function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function startOfLocalDay(date: Date): Date {
  const parts = zonedParts(date)
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0)
}

export function atMinutes(day: Date, minutes: number): Date {
  const parts = zonedParts(startOfLocalDay(day))
  const extraDays = Math.floor(minutes / 1440)
  const mins = ((minutes % 1440) + 1440) % 1440
  const base = zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0)
  return addMinutes(base, extraDays * 1440 + mins)
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

export function minutesBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000
}

export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes))
  const hours = Math.floor(rounded / 60)
  const mins = rounded % 60
  if (hours <= 0) return `${mins} min`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${String(mins).padStart(2, '0')}m`
}

export function formatCounter(from: Date, now: Date): string {
  const total = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function ageMonths(isoDate: string, now: Date): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  const born = Date.UTC(year, month - 1, day, 12)
  const days = (now.getTime() - born) / 86_400_000
  return days / 30.4375
}

export function formatAge(months: number): string {
  if (!Number.isFinite(months) || months < 0) return 'not set'
  const whole = Math.floor(months)
  const weeks = Math.round((months - whole) * 4.345)
  if (whole <= 0) return weeks <= 1 ? '1 week' : `${weeks} weeks`
  if (weeks <= 0) return whole === 1 ? '1 month' : `${whole} months`
  return `${whole} mo ${weeks} wk`
}

export function roundToFive(date: Date): Date {
  const parts = zonedParts(date)
  const rounded = Math.round((parts.hour * 60 + parts.minute) / 5) * 5
  return atMinutes(date, rounded)
}

export function inClockRange(date: Date, startHm: string, endHm: string): boolean {
  const minute = minutesOfDay(date)
  const start = parseHm(startHm)
  const end = parseHm(endHm)
  if (start <= end) return minute >= start && minute < end
  return minute >= start || minute < end
}

export function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day + days, 12))
  return utc.toISOString().slice(0, 10)
}
