import { describe, expect, it } from 'vitest'
import type { SleepEvent } from '../model'
import { mergeEvents, reconcileMonth } from './merge'

function event(partial: Partial<SleepEvent> & Pick<SleepEvent, 'id' | 'start' | 'updatedAt'>): SleepEvent {
  return {
    childId: 'twin-a',
    end: null,
    kind: 'nap',
    updatedBy: 'Test',
    ...partial,
  }
}

describe('sync merge', () => {
  it('keeps the newer copy of the same entry', () => {
    const local = [event({ id: '1', start: '2026-11-14T08:00:00.000Z', updatedAt: '2026-11-14T10:00:00.000Z', end: '2026-11-14T09:00:00.000Z' })]
    const remote = [event({ id: '1', start: '2026-11-14T08:00:00.000Z', updatedAt: '2026-11-14T09:00:00.000Z' })]
    const merged = mergeEvents(local, remote)
    expect(merged).toHaveLength(1)
    expect(merged[0].end).toBe('2026-11-14T09:00:00.000Z')
  })

  it('tombstones an entry that moved to another month', () => {
    const moved = event({
      id: '1',
      start: '2026-12-01T08:00:00.000Z',
      updatedAt: '2026-12-01T12:00:00.000Z',
    })
    const remote = [event({ id: '1', start: '2026-11-14T08:00:00.000Z', updatedAt: '2026-11-14T09:00:00.000Z' })]
    const month = reconcileMonth([moved], remote, '2026-11')
    expect(month[0].deleted).toBe(true)
    const december = reconcileMonth([moved], [], '2026-12')
    expect(december[0].deleted).toBeUndefined()
  })
})
