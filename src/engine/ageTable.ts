import type { ScheduleOverride } from '../model'
import { ageMonths, parseHm } from './time'

export interface Range {
  min: number
  max: number
}

export interface AgeRow {
  months: number
  naps: number
  wakeFirst: Range
  wakeMiddle: Range
  wakeLast: Range
  napLength: Range
  daySleep: Range
  nightSleep: Range
  bedtimeStart: number
  bedtimeEnd: number
  totalSleep: Range
}

/** Minutes, except totalSleep which is hours. Combined from Napper, Huckleberry, CHOC, Babysential and Baby Sleep Site charts, plus AASM totals from 4 months. */
const ROWS: AgeRow[] = [
  row(0, 5, [45, 60], [50, 70], [60, 80], [20, 120], [6, 9], [8, 10], 0, 0, [14, 18]),
  row(1, 5, [45, 75], [60, 80], [70, 90], [30, 120], [5, 8], [8, 10], 0, 0, [14, 17]),
  row(2, 4, [60, 90], [75, 100], [80, 110], [30, 120], [5, 7], [9, 11], 19 * 60, 21 * 60, [14, 17]),
  row(3, 4, [75, 105], [90, 120], [100, 130], [30, 120], [4, 6], [10, 12], 19 * 60, 21 * 60, [14, 17]),
  row(4, 4, [90, 120], [100, 130], [110, 140], [40, 120], [3.5, 4.5], [10, 12], 19 * 60, 21 * 60, [12, 16]),
  row(5, 3, [105, 135], [120, 150], [135, 165], [40, 90], [3, 4], [11, 12], 19 * 60, 20 * 60, [12, 16]),
  row(6, 3, [120, 150], [135, 165], [150, 180], [40, 90], [2.5, 3.5], [11, 12], 19 * 60, 20 * 60, [12, 16]),
  row(7, 3, [135, 165], [150, 180], [160, 195], [45, 100], [2.5, 3.5], [11, 12], 19 * 60, 20 * 60, [12, 16]),
  row(8, 2, [150, 195], [165, 210], [180, 220], [60, 120], [2.5, 3.5], [11, 12], 19 * 60, 20 * 60, [12, 16]),
  row(9, 2, [165, 195], [180, 210], [190, 225], [60, 120], [2.5, 3.5], [11, 12], 19 * 60, 20 * 60, [12, 16]),
  row(10, 2, [180, 210], [190, 225], [200, 240], [60, 120], [2.5, 3], [11, 12], 19 * 60, 20 * 60, [12, 16]),
  row(12, 2, [180, 240], [200, 250], [210, 270], [60, 120], [2, 3], [11, 12], 19 * 60, 20 * 60, [11, 14]),
  row(15, 1, [270, 330], [270, 330], [300, 360], [90, 180], [1.5, 3], [11, 12], 19 * 60, 20 * 60, [11, 14]),
  row(18, 1, [300, 360], [300, 360], [330, 390], [90, 150], [1.5, 2.5], [11, 12], 19 * 60, 20 * 60, [11, 14]),
  row(24, 1, [330, 390], [330, 390], [360, 420], [60, 120], [1, 2], [10.5, 12], 19 * 60, 20.5 * 60, [11, 14]),
]

function row(
  months: number,
  naps: number,
  wakeFirst: [number, number],
  wakeMiddle: [number, number],
  wakeLast: [number, number],
  napLength: [number, number],
  daySleepHours: [number, number],
  nightSleepHours: [number, number],
  bedtimeStart: number,
  bedtimeEnd: number,
  totalSleep: [number, number],
): AgeRow {
  return {
    months,
    naps,
    wakeFirst: range(wakeFirst),
    wakeMiddle: range(wakeMiddle),
    wakeLast: range(wakeLast),
    napLength: range(napLength),
    daySleep: range([daySleepHours[0] * 60, daySleepHours[1] * 60]),
    nightSleep: range([nightSleepHours[0] * 60, nightSleepHours[1] * 60]),
    bedtimeStart,
    bedtimeEnd,
    totalSleep: range(totalSleep),
  }
}

function range(pair: [number, number]): Range {
  return { min: pair[0], max: pair[1] }
}

export function midpoint(value: Range): number {
  return (value.min + value.max) / 2
}

export interface AgeSnapshot {
  months: number
  chronologicalMonths: number
  correctedMonths: number
  usingCorrected: boolean
}

export function ageSnapshot(birthDate: string, dueDate: string, now: Date): AgeSnapshot | null {
  if (!birthDate) return null
  const chronologicalMonths = ageMonths(birthDate, now)
  const correctedMonths = dueDate ? ageMonths(dueDate, now) : chronologicalMonths
  const usingCorrected = Boolean(dueDate) && correctedMonths < 24
  return {
    months: usingCorrected ? correctedMonths : chronologicalMonths,
    chronologicalMonths,
    correctedMonths,
    usingCorrected,
  }
}

export function expectationForMonths(months: number): AgeRow {
  const clamped = Math.min(24, Math.max(0, months))
  let lower = ROWS[0]
  let upper = ROWS[ROWS.length - 1]
  for (let i = 0; i < ROWS.length - 1; i += 1) {
    if (clamped >= ROWS[i].months && clamped <= ROWS[i + 1].months) {
      lower = ROWS[i]
      upper = ROWS[i + 1]
      break
    }
  }
  if (lower === upper || lower.months === upper.months) return lower
  const t = (clamped - lower.months) / (upper.months - lower.months)
  return {
    months: clamped,
    naps: Math.round(lower.naps + (upper.naps - lower.naps) * t),
    wakeFirst: lerpRange(lower.wakeFirst, upper.wakeFirst, t),
    wakeMiddle: lerpRange(lower.wakeMiddle, upper.wakeMiddle, t),
    wakeLast: lerpRange(lower.wakeLast, upper.wakeLast, t),
    napLength: lerpRange(lower.napLength, upper.napLength, t),
    daySleep: lerpRange(lower.daySleep, upper.daySleep, t),
    nightSleep: lerpRange(lower.nightSleep, upper.nightSleep, t),
    bedtimeStart: lower.bedtimeStart + (upper.bedtimeStart - lower.bedtimeStart) * t,
    bedtimeEnd: lower.bedtimeEnd + (upper.bedtimeEnd - lower.bedtimeEnd) * t,
    totalSleep: lerpRange(lower.totalSleep, upper.totalSleep, t),
  }
}

function lerpRange(a: Range, b: Range, t: number): Range {
  return { min: a.min + (b.min - a.min) * t, max: a.max + (b.max - a.max) * t }
}

export function applyOverride(base: AgeRow, override: ScheduleOverride | null): AgeRow {
  if (!override) return base
  const next: AgeRow = {
    ...base,
    wakeFirst: { ...base.wakeFirst },
    wakeMiddle: { ...base.wakeMiddle },
    wakeLast: { ...base.wakeLast },
    napLength: { ...base.napLength },
    daySleep: { ...base.daySleep },
    nightSleep: { ...base.nightSleep },
    totalSleep: { ...base.totalSleep },
  }
  if (override.napCount && override.napCount > 0) next.naps = override.napCount
  const wakes = override.wakeWindowsMin?.filter((value) => value > 0) ?? []
  if (wakes.length === 1) {
    next.wakeFirst = point(wakes[0])
    next.wakeMiddle = point(wakes[0])
    next.wakeLast = point(wakes[0])
  } else if (wakes.length >= 3) {
    next.wakeFirst = point(wakes[0])
    next.wakeMiddle = point(wakes[1])
    next.wakeLast = point(wakes[wakes.length - 1])
  } else if (wakes.length === 2) {
    next.wakeFirst = point(wakes[0])
    next.wakeMiddle = point((wakes[0] + wakes[1]) / 2)
    next.wakeLast = point(wakes[1])
  }
  const lengths = override.napLengthsMin?.filter((value) => value > 0) ?? []
  if (lengths.length > 0) {
    const avg = lengths.reduce((sum, value) => sum + value, 0) / lengths.length
    next.napLength = point(avg)
  }
  if (override.bedtimeStart) next.bedtimeStart = parseHm(override.bedtimeStart)
  if (override.bedtimeEnd) next.bedtimeEnd = parseHm(override.bedtimeEnd)
  return next
}

function point(value: number): Range {
  return { min: value, max: value }
}

export function wakeForPosition(table: AgeRow, index: number, count: number): Range {
  if (count <= 1 || index <= 1) return table.wakeFirst
  if (index >= count) return table.wakeLast
  return table.wakeMiddle
}

export function clampToRange(value: number, band: Range, allowance = 0.1): number {
  const min = band.min * (1 - allowance)
  const max = band.max * (1 + allowance)
  return Math.min(max, Math.max(min, value))
}
