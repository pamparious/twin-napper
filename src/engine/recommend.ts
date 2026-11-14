import type { Profile, ScheduleOverride, SleepEvent } from '../model'
import { activeEvents } from '../model'
import {
  ageSnapshot,
  applyOverride,
  clampToRange,
  expectationForMonths,
  midpoint,
  wakeForPosition,
  type AgeRow,
  type AgeSnapshot,
  type Range,
} from './ageTable'
import { dayByKey, reconstructDays, type SleepDay } from './days'
import { lookupStat, mode, personalStats, type PersonalStats } from './stats'
import {
  addMinutes,
  atMinutes,
  dateKey,
  formatClock,
  minutesBetween,
  minutesOfDay,
  parseHm,
  shiftDateKey,
  startOfLocalDay,
} from './time'

export interface PlannedNap {
  index: number
  start: Date
  end: Date
  windowStart: Date
  windowEnd: Date
  lengthMin: number
  catnap: boolean
  reason: string
}

export interface DayPlan {
  childId: string
  age: AgeSnapshot | null
  table: AgeRow | null
  naps: PlannedNap[]
  next: PlannedNap | null
  bedtime: Date | null
  bedtimeWindowStart: Date | null
  bedtimeWindowEnd: Date | null
  transitionNote: string | null
  headline: string
  asleepUntil: Date | null
  /** True when the day plan starts from 07:00 because no wake-up was logged. */
  assumedWake: boolean
}

export interface TwinSyncPlan {
  start: Date
  windowStart: Date
  windowEnd: Date
  label: string
}

const SHORT_NAP_MINUTES = 30

export function planChild(child: { id: string; birthDate: string; dueDate: string }, events: SleepEvent[], profile: Profile, now = new Date()): DayPlan {
  const age = ageSnapshot(child.birthDate, child.dueDate, now)
  if (!age) {
    return emptyPlan(child.id, 'Add a birthday in Settings to see nap guidance')
  }
  const base = expectationForMonths(age.months)
  const table = cloneRow(applyOverride(base, profile.scheduleOverride))
  if (!profile.scheduleOverride?.bedtimeStart) table.bedtimeStart = parseHm(profile.settings.bedtimeStart)
  if (!profile.scheduleOverride?.bedtimeEnd) table.bedtimeEnd = parseHm(profile.settings.bedtimeEnd)
  const days = reconstructDays(child.id, events, now)
  const todayKey = dateKey(now)
  const stats = personalStats(days, todayKey)
  const today = dayByKey(days, todayKey)
  const running = runningSleep(child.id, events)
  const { plannedCount, transitionNote } = chooseNapCount(table, stats, days, todayKey, profile.scheduleOverride)
  const usualWake = average(stats.wakeMinutes)
  let asleepUntil: Date | null = null
  if (running) {
    const length = blendedLength(
      table,
      stats,
      plannedCount,
      Math.max(1, (today?.naps.length ?? 0) + (running.kind === 'nap' ? 1 : 0)),
    )
    asleepUntil = addMinutes(new Date(running.start), running.kind === 'night' ? midpoint(table.nightSleep) : length)
  }

  const anchor = awakeSince(today, child.id, events, now)
  const logged = today?.naps.filter((nap) => nap.valid || nap.minutes > 0) ?? []
  const completed = running?.kind === 'night' ? [] : logged
  const assumedWake = !running && anchor.reason.startsWith('Based on age')
  const naps: PlannedNap[] = []
  let cursor = asleepUntil ?? anchor.since
  let reasonPrefix = running ? '' : anchor.reason
  const disableIntraday = Boolean(profile.scheduleOverride?.disableIntraday)
  const daySleepSoFar = logged.reduce((sum, nap) => sum + nap.minutes, 0)
  const behind =
    running?.kind !== 'night' &&
    daySleepSoFar < table.daySleep.min * 0.5 &&
    logged.length >= 1 &&
    minutesOfDay(now) >= 13 * 60
  const startIndex = running?.kind === 'nap' ? completed.length + 2 : completed.length + 1
  const bedAnchor = running?.kind === 'night' && asleepUntil ? asleepUntil : now

  for (let index = startIndex; index <= plannedCount; index += 1) {
    const band = wakeForPosition(table, index, plannedCount)
    let wakeMinutes = blendedWake(stats, plannedCount, index, band, profile.scheduleOverride)
    const previous = completed[completed.length - 1]
    let reason = reasonPrefix || 'Age-based wake window'
    if (!disableIntraday) {
      if (!running && index === completed.length + 1 && previous && previous.minutes < SHORT_NAP_MINUTES) {
        wakeMinutes = band.min
        reason = `Shorter wake window after a ${Math.round(previous.minutes)} min nap`
      } else if (!running && index === completed.length + 1 && previous && previous.minutes >= longNapCut(table.napLength)) {
        wakeMinutes = band.max
        reason = 'A long nap can support a slightly longer wake window'
      }
      if (index === 1 && isEarlyWake(cursor, usualWake)) {
        wakeMinutes = band.min
        reason = 'Early wake-up, so the first wake window stays short'
      }
      if (behind && index > completed.length) {
        wakeMinutes = Math.max(band.min, wakeMinutes * 0.85)
        reason = 'Daytime sleep is behind the usual target'
      }
    }
    wakeMinutes = profile.scheduleOverride ? wakeMinutes : clampToRange(wakeMinutes, band)
    let start = addMinutes(cursor, wakeMinutes)
    if (!running && index === completed.length + 1 && start.getTime() < now.getTime() - 5 * 60_000) {
      start = now
      reason = 'Wake window already passed — watch sleepy cues'
    }
    let length = blendedLength(table, stats, plannedCount, index)
    if (profile.scheduleOverride?.napLengthsMin && profile.scheduleOverride.napLengthsMin[index - 1]) {
      length = profile.scheduleOverride.napLengthsMin[index - 1]
    }
    const bedtimeEnd = atMinutes(bedAnchor, table.bedtimeEnd)
    const lastWake = profile.scheduleOverride ? table.wakeLast.min : midpoint(table.wakeLast)
    const latestFinish = addMinutes(bedtimeEnd, -lastWake)
    let catnap = false
    if (!disableIntraday && index === plannedCount) {
      const fullEnd = addMinutes(start, length)
      if (fullEnd.getTime() > latestFinish.getTime()) {
        const catnapLength = Math.min(45, Math.max(30, minutesBetween(start, latestFinish)))
        if (minutesBetween(start, latestFinish) >= 30) {
          length = catnapLength
          catnap = true
          reason = 'A short catnap so bedtime stays put'
        } else {
          reason = 'Skip this nap and head toward bedtime'
          break
        }
      }
    }
    const half = windowHalf(stats, plannedCount, index)
    const end = addMinutes(start, length)
    naps.push({
      index,
      start,
      end,
      windowStart: addMinutes(start, -half),
      windowEnd: addMinutes(start, half),
      lengthMin: length,
      catnap,
      reason,
    })
    cursor = end
    reasonPrefix = ''
    if (index === completed.length + 1) {
      // Only the next nap is adjusted against "now"; later naps project forward.
    }
  }

  const lastEnd = naps.length > 0 ? naps[naps.length - 1].end : cursor
  let bedMinutes = blendedBedWake(table, stats, profile.scheduleOverride)
  if (!disableIntraday && behind) bedMinutes = Math.max(table.wakeLast.min, bedMinutes * 0.9)
  let bedtime = addMinutes(lastEnd, bedMinutes)
  const bedStart = atMinutes(bedAnchor, table.bedtimeStart)
  const bedEnd = atMinutes(bedAnchor, table.bedtimeEnd)
  if (table.bedtimeEnd > 0) {
    if (bedtime.getTime() > bedEnd.getTime()) bedtime = bedEnd
    if (bedtime.getTime() < bedStart.getTime() && lastEnd.getTime() < bedStart.getTime()) bedtime = bedStart
  }
  const next = naps[0] ?? null
  const headline =
    running?.kind === 'night'
      ? 'Night sleep in progress'
      : running && asleepUntil
        ? `Likely awake around ${formatClock(asleepUntil)}`
        : next
          ? `Next nap ${formatClock(next.windowStart)}–${formatClock(next.windowEnd)}`
          : bedtime
            ? `Bedtime around ${formatClock(bedtime)}`
            : 'Log a wake-up to start the day plan'

  return {
    childId: child.id,
    age,
    table,
    naps,
    next,
    bedtime: table.bedtimeEnd > 0 ? bedtime : null,
    bedtimeWindowStart: table.bedtimeEnd > 0 ? bedStart : null,
    bedtimeWindowEnd: table.bedtimeEnd > 0 ? bedEnd : null,
    transitionNote,
    headline,
    asleepUntil,
    assumedWake,
  }
}

export function twinSyncPlan(plans: DayPlan[]): TwinSyncPlan | null {
  const upcoming = plans
    .map((plan) => plan.next)
    .filter((nap): nap is PlannedNap => Boolean(nap))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  if (upcoming.length < 2) return null
  const earliest = upcoming[0]
  return {
    start: earliest.start,
    windowStart: earliest.windowStart,
    windowEnd: earliest.windowEnd,
    label: `Together ${formatClock(earliest.windowStart)}–${formatClock(earliest.windowEnd)}`,
  }
}

function cloneRow(row: AgeRow): AgeRow {
  return {
    ...row,
    wakeFirst: { ...row.wakeFirst },
    wakeMiddle: { ...row.wakeMiddle },
    wakeLast: { ...row.wakeLast },
    napLength: { ...row.napLength },
    daySleep: { ...row.daySleep },
    nightSleep: { ...row.nightSleep },
    totalSleep: { ...row.totalSleep },
  }
}

function emptyPlan(childId: string, headline: string): DayPlan {
  return {
    childId,
    age: null,
    table: null,
    naps: [],
    next: null,
    bedtime: null,
    bedtimeWindowStart: null,
    bedtimeWindowEnd: null,
    transitionNote: null,
    headline,
    asleepUntil: null,
    assumedWake: false,
  }
}

function chooseNapCount(
  table: AgeRow,
  stats: PersonalStats,
  days: SleepDay[],
  todayKey: string,
  override: ScheduleOverride | null,
): { plannedCount: number; transitionNote: string | null } {
  if (override?.napCount) {
    return { plannedCount: override.napCount, transitionNote: override.note ?? null }
  }
  const personalMode = mode(stats.napCounts)
  const n = stats.napCounts.length
  const blended = personalMode == null ? table.naps : (n / (n + 4)) * personalMode + (1 - n / (n + 4)) * table.naps
  const stableLower = n >= 7 && stats.napCounts.every((count) => count < table.naps)
  let planned = stableLower ? Math.round(blended) : table.naps
  if (!stableLower) planned = table.naps
  const lastFive = lastDays(days, todayKey, 5).filter((day) => !day.excluded && (day.naps.length > 0 || day.wake || day.bedtime))
  const skipped = lastFive.filter((day) => day.naps.filter((nap) => nap.valid).length < table.naps).length
  const late = lastFive.filter((day) => day.bedtime && minutesOfDay(day.bedtime) > table.bedtimeEnd + 20).length
  const dropping = table.naps > 1 && (skipped >= 3 || late >= 3)
  if (dropping && !stableLower) {
    return {
      plannedCount: table.naps,
      transitionNote: `Possible move from ${table.naps} to ${table.naps - 1} naps`,
    }
  }
  if (stableLower) {
    return {
      plannedCount: Math.max(1, Math.round(blended)),
      transitionNote: `Using ${Math.max(1, Math.round(blended))} naps based on the last week`,
    }
  }
  return { plannedCount: planned, transitionNote: null }
}

function lastDays(days: SleepDay[], todayKey: string, count: number): SleepDay[] {
  const wanted = new Set<string>()
  for (let i = 1; i <= count; i += 1) wanted.add(shiftDateKey(todayKey, -i))
  return days.filter((day) => wanted.has(day.dateKey))
}

function longNapCut(band: Range): number {
  return band.min + (band.max - band.min) * 0.75
}

function blendedWake(
  stats: PersonalStats,
  napCount: number,
  index: number,
  band: Range,
  override: ScheduleOverride | null,
): number {
  if (override?.wakeWindowsMin?.length) return midpoint(band)
  const personal = lookupStat(stats.wake, napCount, index)
  if (!personal) return midpoint(band)
  const w = personal.n / (personal.n + 4)
  return clampToRange(w * personal.mean + (1 - w) * midpoint(band), band)
}

function blendedLength(table: AgeRow, stats: PersonalStats, napCount: number, index: number): number {
  const personal = lookupStat(stats.length, napCount, index)
  const prior = midpoint(table.napLength)
  if (!personal) return prior
  const w = personal.n / (personal.n + 4)
  return Math.min(table.napLength.max * 1.1, Math.max(20, w * personal.mean + (1 - w) * prior))
}

function blendedBedWake(table: AgeRow, stats: PersonalStats, override: ScheduleOverride | null): number {
  if (override?.wakeWindowsMin?.length) return midpoint(table.wakeLast)
  const personal = stats.wake.get('bed')
  if (!personal) return midpoint(table.wakeLast)
  const w = personal.n / (personal.n + 4)
  return clampToRange(w * personal.mean + (1 - w) * midpoint(table.wakeLast), table.wakeLast)
}

function windowHalf(stats: PersonalStats, napCount: number, index: number): number {
  const personal = lookupStat(stats.wake, napCount, index)
  const stdev = personal?.stdev ?? 15
  return Math.min(30, Math.max(10, stdev))
}

function runningSleep(childId: string, events: SleepEvent[]): SleepEvent | null {
  return (
    activeEvents(events)
      .filter((event) => event.childId === childId && !event.end)
      .sort((a, b) => b.start.localeCompare(a.start))[0] ?? null
  )
}

function awakeSince(
  today: SleepDay | undefined,
  childId: string,
  events: SleepEvent[],
  now: Date,
): { since: Date; reason: string } {
  const ended = activeEvents(events)
    .filter((event) => event.childId === childId && event.end && dateKey(new Date(event.end)) === dateKey(now))
    .sort((a, b) => (a.end ?? '').localeCompare(b.end ?? ''))
  const last = ended[ended.length - 1]
  if (last?.end) return { since: new Date(last.end), reason: '' }
  if (today?.wake) return { since: today.wake, reason: '' }
  return {
    since: atMinutes(startOfLocalDay(now), 7 * 60),
    reason: 'Based on age, no wake-up logged',
  }
}

function isEarlyWake(wake: Date, usual: number | null): boolean {
  const minute = minutesOfDay(wake)
  if (minute < 6 * 60) return true
  return usual != null && minute < usual - 45
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function suggestedWakeTime(event: SleepEvent, plan: DayPlan): Date {
  if (plan.asleepUntil) return plan.asleepUntil
  return addMinutes(new Date(event.start), event.kind === 'night' ? 11 * 60 : 60)
}
