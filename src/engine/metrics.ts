import type { SleepEvent } from '../model'
import { activeEvents } from '../model'
import { dateKey, shiftDateKey, zonedTimeToUtc, addMinutes, minutesBetween } from './time'

export interface DayBlock {
  id: string
  startMin: number
  endMin: number
  kind: SleepEvent['kind']
  predicted?: boolean
  label?: string
}

export function blocksOnDay(events: SleepEvent[], childId: string, key: string, now = new Date()): DayBlock[] {
  const blocks: DayBlock[] = []
  for (const event of activeEvents(events)) {
    if (event.childId !== childId) continue
    const clipped = clip(event.start, event.end ?? now.toISOString(), key)
    if (!clipped) continue
    blocks.push({ id: event.id, startMin: clipped[0], endMin: clipped[1], kind: event.kind })
  }
  return blocks
}

export function clip(startIso: string, endIso: string, key: string): [number, number] | null {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (end.getTime() <= start.getTime()) return null
  const [year, month, day] = key.split('-').map(Number)
  const dayStart = zonedTimeToUtc(year, month, day, 0, 0)
  const startMs = dayStart.getTime()
  const endMs = addMinutes(dayStart, 24 * 60).getTime()
  const from = Math.max(start.getTime(), startMs)
  const to = Math.min(end.getTime(), endMs)
  if (to <= from) return null
  return [(from - startMs) / 60_000, (to - startMs) / 60_000]
}

export function togetherStats(
  events: SleepEvent[],
  childA: string,
  childB: string,
  now = new Date(),
  dayCount = 7,
): {
  overlapMin: number
  percent: number
} {
  const today = dateKey(now)
  let overlap = 0
  let sleepA = 0
  let sleepB = 0
  for (let ago = 0; ago < dayCount; ago += 1) {
    const key = shiftDateKey(today, -ago)
    const a = blocksOnDay(events, childA, key, now)
    const b = blocksOnDay(events, childB, key, now)
    sleepA += a.reduce((sum, block) => sum + (block.endMin - block.startMin), 0)
    sleepB += b.reduce((sum, block) => sum + (block.endMin - block.startMin), 0)
    for (const left of a) {
      for (const right of b) {
        const from = Math.max(left.startMin, right.startMin)
        const to = Math.min(left.endMin, right.endMin)
        if (to > from) overlap += to - from
      }
    }
  }
  const baseline = (sleepA + sleepB) / 2
  return { overlapMin: overlap, percent: baseline > 0 ? (overlap / baseline) * 100 : 0 }
}

export function rangesOverlap(
  startA: Date,
  endA: Date | null,
  startB: Date,
  endB: Date | null,
  now = new Date(),
): boolean {
  const aEnd = endA ?? now
  const bEnd = endB ?? now
  return startA < bEnd && startB < aEnd
}

export function durationMinutes(start: string, end: string | null, now = new Date()): number {
  return minutesBetween(new Date(start), end ? new Date(end) : now)
}
