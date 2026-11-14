import type { PredictionRecord, SleepEvent } from '../model'
import { activeEvents } from '../model'

const MATCH_WINDOW_MS = 3 * 60 * 60 * 1000
const DEDUPE_MS = 15 * 60 * 1000

export function rememberPrediction(
  records: PredictionRecord[],
  childId: string,
  predictedFor: string,
  now = new Date(),
): PredictionRecord[] {
  const when = new Date(predictedFor).getTime()
  const duplicate = records.some(
    (record) =>
      record.childId === childId &&
      !record.matchedEventId &&
      Math.abs(new Date(record.predictedFor).getTime() - when) < DEDUPE_MS,
  )
  if (duplicate) return records
  return [
    ...records,
    {
      id: `pred-${now.getTime()}-${childId}`,
      childId,
      predictedFor,
      createdAt: now.toISOString(),
    },
  ].slice(-200)
}

export function matchPredictions(records: PredictionRecord[], events: SleepEvent[]): PredictionRecord[] {
  const naps = activeEvents(events).filter((event) => event.kind === 'nap')
  const used = new Set(records.map((record) => record.matchedEventId).filter(Boolean))
  return records.map((record) => {
    if (record.matchedEventId) return record
    const created = new Date(record.createdAt).getTime()
    let best: SleepEvent | null = null
    let bestGap = Infinity
    for (const event of naps) {
      if (event.childId !== record.childId || used.has(event.id)) continue
      const start = new Date(event.start).getTime()
      const gap = start - created
      if (gap < -15 * 60 * 1000 || gap > MATCH_WINDOW_MS) continue
      const error = Math.abs(start - new Date(record.predictedFor).getTime())
      if (error < bestGap) {
        best = event
        bestGap = error
      }
    }
    if (!best) return record
    used.add(best.id)
    return {
      ...record,
      matchedEventId: best.id,
      errorMin: bestGap / 60_000,
    }
  })
}

export interface AccuracySummary {
  count: number
  maeMin: number | null
  label: string
}

export function accuracySummary(records: PredictionRecord[], childId: string, now = new Date()): AccuracySummary {
  const cutoff = now.getTime() - 7 * 86_400_000
  const matched = records.filter(
    (record) =>
      record.childId === childId &&
      record.errorMin != null &&
      new Date(record.createdAt).getTime() >= cutoff,
  )
  if (matched.length === 0) {
    return { count: 0, maeMin: null, label: 'Predictions will be scored after a few logged naps' }
  }
  const mae = matched.reduce((sum, record) => sum + (record.errorMin ?? 0), 0) / matched.length
  return {
    count: matched.length,
    maeMin: mae,
    label: `Predictions within ±${Math.round(mae)} min over the last 7 days`,
  }
}
