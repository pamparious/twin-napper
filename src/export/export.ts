import type { PredictionRecord, Profile, SleepEvent } from '../model'
import { activeEvents } from '../model'
import { accuracySummary } from '../engine/accuracy'
import { ageSnapshot } from '../engine/ageTable'
import { reconstructDays } from '../engine/days'
import { planChild } from '../engine/recommend'
import { dateKey, formatClock, formatDuration, minutesBetween } from '../engine/time'

export interface ExportBundle {
  exportedAt: string
  timezone: 'Europe/Stockholm'
  profile: Profile
  ages: { childId: string; chronologicalMonths: number; correctedMonths: number; usingCorrected: boolean }[]
  events: SleepEvent[]
  days: ReturnType<typeof reconstructDays>[]
  accuracy: { childId: string; label: string; maeMin: number | null }[]
  predictions: PredictionRecord[]
}

export function buildBundle(profile: Profile, events: SleepEvent[], predictions: PredictionRecord[], now = new Date()): ExportBundle {
  const visible = activeEvents(events)
  return {
    exportedAt: now.toISOString(),
    timezone: 'Europe/Stockholm',
    profile,
    ages: profile.children.map((child) => {
      const age = ageSnapshot(child.birthDate, child.dueDate, now)
      return {
        childId: child.id,
        chronologicalMonths: age?.chronologicalMonths ?? 0,
        correctedMonths: age?.correctedMonths ?? 0,
        usingCorrected: age?.usingCorrected ?? false,
      }
    }),
    events: visible,
    days: profile.children.map((child) => reconstructDays(child.id, visible, now)),
    accuracy: profile.children.map((child) => {
      const summary = accuracySummary(predictions, child.id, now)
      return { childId: child.id, label: summary.label, maeMin: summary.maeMin }
    }),
    predictions,
  }
}

export function toCsv(events: SleepEvent[]): string {
  const header = ['id', 'childId', 'kind', 'start', 'end', 'minutes', 'note', 'updatedAt', 'updatedBy']
  const lines = activeEvents(events)
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((event) => {
      const minutes = event.end ? minutesBetween(new Date(event.start), new Date(event.end)).toFixed(1) : ''
      return [event.id, event.childId, event.kind, event.start, event.end ?? '', minutes, event.note ?? '', event.updatedAt, event.updatedBy]
        .map(csvCell)
        .join(',')
    })
  return [header.join(','), ...lines].join('\n')
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function aiPrompt(profile: Profile, events: SleepEvent[], now = new Date()): string {
  const lines: string[] = []
  lines.push('# Twin Napper — last 14 days')
  lines.push('')
  lines.push('Times are Europe/Stockholm, 24-hour clock. Suggestions are guidance, not medical advice.')
  lines.push('')
  for (const child of profile.children) {
    const age = ageSnapshot(child.birthDate, child.dueDate, now)
    const plan = planChild(child, events, profile, now)
    lines.push(`## ${child.nickname}`)
    lines.push(`- Birthday: ${child.birthDate || 'not set'}`)
    lines.push(`- Due date: ${child.dueDate || 'not set'}`)
    if (age) {
      lines.push(`- Chronological age: ${age.chronologicalMonths.toFixed(1)} months`)
      lines.push(`- Corrected age: ${age.correctedMonths.toFixed(1)} months${age.usingCorrected ? ' (used for the schedule)' : ''}`)
    }
    if (plan.table) {
      lines.push(`- Age-table naps: ${plan.table.naps}`)
      if (plan.bedtimeWindowStart && plan.bedtimeWindowEnd) {
        lines.push(`- Bedtime range: ${formatClock(plan.bedtimeWindowStart)}–${formatClock(plan.bedtimeWindowEnd)}`)
      }
    }
    const days = reconstructDays(child.id, events, now).filter((day) => day.dateKey >= shiftBack(now, 14))
    lines.push('')
    lines.push('| Day | Wake | Naps | Night start | Day sleep |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const day of days) {
      const naps = day.naps
        .map((nap) => `${formatClock(nap.start)}–${formatClock(nap.end)} (${formatDuration(nap.minutes)})`)
        .join(', ')
      const daySleep = day.naps.reduce((sum, nap) => sum + nap.minutes, 0)
      lines.push(
        `| ${day.dateKey} | ${day.wake ? formatClock(day.wake) : ''} | ${naps} | ${day.bedtime ? formatClock(day.bedtime) : ''} | ${daySleep ? formatDuration(daySleep) : ''} |`,
      )
    }
    lines.push('')
  }
  lines.push('## Ask')
  lines.push('Look at both twins. Suggest one scheduleOverride JSON object that Twin Napper can import.')
  lines.push('Keep wake windows inside a sensible range for their corrected age. Prefer a routine that lets them nap at the same time when that does not push bedtime late.')
  lines.push('Return only JSON in this shape:')
  lines.push('')
  lines.push('```json')
  lines.push(
    JSON.stringify(
      {
        napCount: 3,
        wakeWindowsMin: [120, 140, 160],
        napLengthsMin: [70, 80, 40],
        bedtimeStart: '19:00',
        bedtimeEnd: '20:00',
        disableIntraday: false,
        note: 'Why you chose this',
      },
      null,
      2,
    ),
  )
  lines.push('```')
  return lines.join('\n')
}

function shiftBack(now: Date, days: number): string {
  return dateKey(new Date(now.getTime() - days * 86_400_000))
}

export async function shareOrDownload(filename: string, text: string, mime: string): Promise<'shared' | 'downloaded'> {
  const file = new File([text], filename, { type: mime })
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: filename })
    return 'shared'
  }
  download(filename, text, mime)
  return 'downloaded'
}

export function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
