import type { SleepDay } from './days'
import { minutesBetween, minutesOfDay, shiftDateKey } from './time'

export interface Sample {
  ageDays: number
  value: number
}

export interface WeightedStat {
  n: number
  mean: number
  stdev: number
}

const HALF_LIFE_DAYS = 3

export function weight(ageDays: number): number {
  return 0.5 ** (ageDays / HALF_LIFE_DAYS)
}

export function weightedStat(samples: Sample[]): WeightedStat | null {
  if (samples.length === 0) return null
  let weightSum = 0
  let meanSum = 0
  for (const sample of samples) {
    const w = weight(sample.ageDays)
    weightSum += w
    meanSum += w * sample.value
  }
  if (weightSum === 0) return null
  const mean = meanSum / weightSum
  let variance = 0
  for (const sample of samples) {
    const w = weight(sample.ageDays)
    variance += w * (sample.value - mean) ** 2
  }
  return { n: samples.length, mean, stdev: Math.sqrt(variance / weightSum) }
}

export interface PersonalStats {
  wake: Map<string, WeightedStat>
  length: Map<string, WeightedStat>
  napCounts: number[]
  bedtimes: number[]
  wakeMinutes: number[]
}

function groupKey(napCount: number, napIndex: number): string {
  return `${napCount}:${napIndex}`
}

export function personalStats(days: SleepDay[], todayKey: string): PersonalStats {
  const wake = new Map<string, Sample[]>()
  const length = new Map<string, Sample[]>()
  const bedKey = 'bed'
  const napCounts: number[] = []
  const bedtimes: number[] = []
  const wakeMinutes: number[] = []

  const push = (bucket: Map<string, Sample[]>, key: string, sample: Sample) => {
    const list = bucket.get(key) ?? []
    list.push(sample)
    bucket.set(key, list)
  }

  for (let ago = 1; ago <= 7; ago += 1) {
    const key = shiftDateKey(todayKey, -ago)
    const day = days.find((item) => item.dateKey === key)
    if (!day || day.excluded) continue
    const naps = day.naps.filter((nap) => nap.valid)
    napCounts.push(naps.length)
    if (day.wake) wakeMinutes.push(minutesOfDay(day.wake))
    if (day.bedtime) bedtimes.push(minutesOfDay(day.bedtime))
    let cursor = day.wake
    naps.forEach((nap, index) => {
      if (cursor) {
        push(wake, groupKey(naps.length, index + 1), {
          ageDays: ago,
          value: minutesBetween(cursor, nap.start),
        })
      }
      push(length, groupKey(naps.length, index + 1), { ageDays: ago, value: nap.minutes })
      cursor = nap.end
    })
    if (cursor && day.bedtime) {
      push(wake, bedKey, { ageDays: ago, value: minutesBetween(cursor, day.bedtime) })
    }
  }

  return {
    wake: finalize(wake),
    length: finalize(length),
    napCounts,
    bedtimes,
    wakeMinutes,
  }
}

function finalize(samples: Map<string, Sample[]>): Map<string, WeightedStat> {
  const stats = new Map<string, WeightedStat>()
  for (const [key, list] of samples) {
    const stat = weightedStat(list)
    if (stat) stats.set(key, stat)
  }
  return stats
}

export function lookupStat(stats: Map<string, WeightedStat>, napCount: number, napIndex: number): WeightedStat | null {
  return stats.get(`${napCount}:${napIndex}`) ?? null
}

export function mode(values: number[]): number | null {
  if (values.length === 0) return null
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best = values[0]
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

export { groupKey }
