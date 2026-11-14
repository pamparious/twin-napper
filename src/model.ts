export type SleepKind = 'nap' | 'night'

export interface Child {
  id: string
  nickname: string
  birthDate: string
  dueDate: string
  color: string
}

/** AI or hand-tuned schedule. Replaces the age table and personal averages. */
export interface ScheduleOverride {
  napCount?: number
  wakeWindowsMin?: number[]
  napLengthsMin?: number[]
  bedtimeStart?: string
  bedtimeEnd?: string
  disableIntraday?: boolean
  note?: string
}

export interface ProfileSettings {
  nightStart: string
  nightEnd: string
  bedtimeStart: string
  bedtimeEnd: string
  twinSync: boolean
}

export interface Profile {
  updatedAt: string
  children: Child[]
  settings: ProfileSettings
  scheduleOverride: ScheduleOverride | null
}

export interface SleepEvent {
  id: string
  childId: string
  start: string
  end: string | null
  kind: SleepKind
  note?: string
  updatedAt: string
  updatedBy: string
  deleted?: boolean
}

export interface PredictionRecord {
  id: string
  childId: string
  predictedFor: string
  createdAt: string
  matchedEventId?: string
  errorMin?: number
}

export const REPO_OWNER = 'pamparious'
export const REPO_NAME = 'twin-napper'
export const DATA_BRANCH = 'data'
export const TIME_ZONE = 'Europe/Stockholm'

export const DEFAULT_PROFILE: Profile = {
  updatedAt: new Date(0).toISOString(),
  children: [
    { id: 'twin-a', nickname: 'A', birthDate: '', dueDate: '', color: '#64D2FF' },
    { id: 'twin-b', nickname: 'B', birthDate: '', dueDate: '', color: '#FFD60A' },
  ],
  settings: {
    nightStart: '18:30',
    nightEnd: '06:00',
    bedtimeStart: '19:00',
    bedtimeEnd: '20:00',
    twinSync: false,
  },
  scheduleOverride: null,
}

export function activeEvents(events: SleepEvent[]): SleepEvent[] {
  const live = events.filter((event) => !event.deleted)
  const newest = new Map<string, SleepEvent>()
  for (const event of live) {
    const previous = newest.get(event.id)
    if (!previous || previous.updatedAt <= event.updatedAt) newest.set(event.id, event)
  }
  return [...newest.values()]
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
