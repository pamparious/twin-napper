import type { Profile, SleepEvent } from '../model'
import { monthKey } from '../engine/time'

export function mergeEvents(local: SleepEvent[], remote: SleepEvent[]): SleepEvent[] {
  const merged = new Map<string, SleepEvent>()
  for (const event of remote) merged.set(event.id, event)
  for (const event of local) {
    const previous = merged.get(event.id)
    if (!previous || previous.updatedAt <= event.updatedAt) merged.set(event.id, event)
  }
  return [...merged.values()]
}

export function mergeProfile(local: Profile, remote: Profile | null): Profile {
  if (!remote) return local
  return local.updatedAt >= remote.updatedAt ? local : remote
}

export function monthOf(event: SleepEvent): string {
  return monthKey(new Date(event.start))
}

/** Build one month file, tombstoning an entry that has moved to another month. */
export function reconcileMonth(all: SleepEvent[], remoteMonth: SleepEvent[], month: string): SleepEvent[] {
  const localMonth = all.filter((event) => monthOf(event) === month)
  const merged = new Map<string, SleepEvent>()
  for (const event of remoteMonth) merged.set(event.id, event)
  for (const event of localMonth) {
    const previous = merged.get(event.id)
    if (!previous || previous.updatedAt <= event.updatedAt) merged.set(event.id, event)
  }
  for (const event of remoteMonth) {
    const current = newest(all.filter((item) => item.id === event.id))
    if (current && monthOf(current) !== month && current.updatedAt >= event.updatedAt) {
      merged.set(event.id, {
        ...event,
        deleted: true,
        updatedAt: current.updatedAt,
        updatedBy: current.updatedBy,
      })
    }
  }
  return [...merged.values()]
}

function newest(events: SleepEvent[]): SleepEvent | null {
  return events.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1) ?? null
}

export function monthsIn(events: SleepEvent[]): string[] {
  return [...new Set(events.map(monthOf))].sort()
}
