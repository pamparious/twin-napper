import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, type Profile, type SleepEvent } from '../model'
import { accuracySummary, matchPredictions, rememberPrediction } from './accuracy'
import { expectationForMonths, ageSnapshot } from './ageTable'
import { planChild, twinSyncPlan } from './recommend'
import { addMinutes, minutesBetween, zonedTimeToUtc } from './time'

const now = zonedTimeToUtc(2026, 11, 14, 8, 0)

function profile(override: Profile['scheduleOverride'] = null, twinSync = false): Profile {
  return {
    ...DEFAULT_PROFILE,
    settings: { ...DEFAULT_PROFILE.settings, twinSync },
    scheduleOverride: override,
  }
}

let seq = 0
function event(partial: Partial<SleepEvent> & Pick<SleepEvent, 'start' | 'kind'>): SleepEvent {
  seq += 1
  return {
    id: `e${seq}`,
    childId: 'twin-a',
    end: null,
    updatedAt: now.toISOString(),
    updatedBy: 'Test',
    ...partial,
  }
}

function on(dayOffset: number, hour: number, minute: number): string {
  const utc = new Date(Date.UTC(2026, 10, 14 + dayOffset, 12))
  return zonedTimeToUtc(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), hour, minute).toISOString()
}

function child(birthDate = '2026-06-14', dueDate = '2026-06-14') {
  return { id: 'twin-a', birthDate, dueDate }
}

describe('age table', () => {
  it('interpolates wake windows between monthly rows', () => {
    const mid = expectationForMonths(5.5)
    expect(mid.wakeFirst.min).toBeCloseTo(112.5, 5)
    expect(mid.naps).toBe(3)
  })

  it('uses corrected age until 24 months', () => {
    const premature = ageSnapshot('2026-04-14', '2026-06-14', now)
    expect(premature?.usingCorrected).toBe(true)
    expect(premature?.months).toBeCloseTo(ageSnapshot('2026-06-14', '2026-06-14', now)?.months ?? 0, 5)
    const older = ageSnapshot('2023-10-01', '2024-01-01', now)
    expect(older?.usingCorrected).toBe(false)
    expect(older?.months).toBeCloseTo(older?.chronologicalMonths ?? 0, 5)
  })
})

describe('recommendations', () => {
  it('places the first nap from the age wake window after a normal wake-up', () => {
    const baby = child()
    const events = [event({ kind: 'night', start: on(-1, 19, 30), end: on(0, 7, 0) })]
    const plan = planChild(baby, events, profile(), now)
    const table = expectationForMonths(plan.age?.months ?? 0)
    const expected = addMinutes(new Date(events[0].end as string), (table.wakeFirst.min + table.wakeFirst.max) / 2)
    expect(plan.next).not.toBeNull()
    expect(minutesBetween(expected, plan.next!.start)).toBeCloseTo(0, 0)
    expect(plan.headline).toMatch(/Next nap/)
  })

  it('shortens the next wake window after a nap under 30 minutes', () => {
    const baby = child()
    const events = [
      event({ kind: 'night', start: on(-1, 19, 30), end: on(0, 7, 0) }),
      event({ kind: 'nap', start: on(0, 9, 0), end: on(0, 9, 25) }),
    ]
    const plan = planChild(baby, events, profile(), zonedTimeToUtc(2026, 11, 14, 9, 30))
    const table = expectationForMonths(plan.age?.months ?? 0)
    const expected = addMinutes(new Date(events[1].end as string), table.wakeMiddle.min)
    expect(plan.next?.reason).toMatch(/Shorter wake window/)
    expect(minutesBetween(expected, plan.next!.start)).toBeCloseTo(0, 0)
  })

  it('keeps the first window short after an early wake-up', () => {
    const baby = child()
    const wake = on(0, 5, 30)
    const events = [event({ kind: 'night', start: on(-1, 19, 30), end: wake })]
    const plan = planChild(baby, events, profile(), zonedTimeToUtc(2026, 11, 14, 5, 40))
    const table = expectationForMonths(plan.age?.months ?? 0)
    const expected = addMinutes(new Date(wake), table.wakeFirst.min)
    expect(plan.next?.reason).toMatch(/Early wake-up/)
    expect(minutesBetween(expected, plan.next!.start)).toBeCloseTo(0, 0)
  })

  it('warns about a nap transition without dropping a nap on its own', () => {
    const baby = child()
    const events: SleepEvent[] = []
    for (let ago = 1; ago <= 5; ago += 1) {
      events.push(
        event({ kind: 'night', start: on(-ago - 1, 19, 30), end: on(-ago, 7, 0) }),
        event({ kind: 'nap', start: on(-ago, 9, 0), end: on(-ago, 10, 0) }),
        event({ kind: 'nap', start: on(-ago, 13, 0), end: on(-ago, 14, 30) }),
        event({ kind: 'night', start: on(-ago, 19, 30), end: on(-ago + 1, 7, 0) }),
      )
    }
    events.push(event({ kind: 'night', start: on(-1, 19, 30), end: on(0, 7, 0) }))
    const plan = planChild(baby, events, profile(), now)
    expect(plan.transitionNote).toMatch(/Possible move from 3 to 2/)
    expect(plan.transitionNote).not.toMatch(/Using 2/)
  })

  it('falls back to a 07:00 wake-up when today has no logs', () => {
    const plan = planChild(child(), [], profile(), now)
    expect(plan.next?.reason).toMatch(/no wake-up logged/)
    const table = expectationForMonths(plan.age?.months ?? 0)
    const expected = addMinutes(zonedTimeToUtc(2026, 11, 14, 7, 0), (table.wakeFirst.min + table.wakeFirst.max) / 2)
    expect(minutesBetween(expected, plan.next!.start)).toBeCloseTo(0, 0)
  })

  it('pulls a repeated personal wake window toward the child and keeps it inside the age range', () => {
    const baby = child()
    const events: SleepEvent[] = []
    for (let ago = 1; ago <= 5; ago += 1) {
      events.push(
        event({ kind: 'night', start: on(-ago - 1, 19, 0), end: on(-ago, 7, 0) }),
        event({ kind: 'nap', start: on(-ago, 9, 0), end: on(-ago, 10, 0) }),
        event({ kind: 'nap', start: on(-ago, 13, 0), end: on(-ago, 14, 0) }),
        event({ kind: 'nap', start: on(-ago, 16, 30), end: on(-ago, 17, 0) }),
        event({ kind: 'night', start: on(-ago, 19, 30), end: on(-ago + 1, 7, 0) }),
      )
    }
    events.push(
      event({ kind: 'night', start: on(-1, 19, 30), end: on(0, 7, 0) }),
      event({ kind: 'nap', start: on(0, 9, 0), end: on(0, 9, 40) }),
    )
    const at = zonedTimeToUtc(2026, 11, 14, 9, 45)
    const plan = planChild(baby, events, profile(), at)
    const table = expectationForMonths(plan.age?.months ?? 0)
    const gap = minutesBetween(new Date(on(0, 9, 40)), plan.next!.start)
    const prior = (table.wakeMiddle.min + table.wakeMiddle.max) / 2
    expect(gap).toBeGreaterThan(prior)
    expect(gap).toBeLessThanOrEqual(table.wakeMiddle.max * 1.1 + 0.1)
  })

  it('lets an override replace the age table while same-day adjustments can still be turned off', () => {
    const baby = child()
    const events = [
      event({ kind: 'night', start: on(-1, 19, 30), end: on(0, 7, 0) }),
      event({ kind: 'nap', start: on(0, 8, 0), end: on(0, 8, 20) }),
    ]
    const overridden = planChild(
      baby,
      events,
      profile({ napCount: 2, wakeWindowsMin: [180, 180, 180], disableIntraday: true, note: 'AI plan' }),
      zonedTimeToUtc(2026, 11, 14, 8, 25),
    )
    expect(overridden.transitionNote).toBe('AI plan')
    expect(minutesBetween(new Date(events[1].end as string), overridden.next!.start)).toBeCloseTo(180, 0)
    expect(overridden.naps).toHaveLength(1)
  })

  it('keeps the later naps while a nap is still running', () => {
    const running = event({ kind: 'nap', start: on(0, 7, 30), end: null })
    const plan = planChild(child(), [running], profile(), now)
    expect(plan.headline).toMatch(/Likely awake around/)
    expect(plan.naps[0]?.index).toBe(2)
    expect(plan.bedtime).not.toBeNull()
  })

  it('lines twins up on the earlier nap window', () => {
    const events = [
      event({ kind: 'night', childId: 'twin-a', start: on(-1, 19, 30), end: on(0, 7, 0) }),
      event({ kind: 'night', childId: 'twin-b', start: on(-1, 20, 30), end: on(0, 8, 0) }),
    ]
    const a = planChild({ id: 'twin-a', birthDate: '2026-06-14', dueDate: '2026-06-14' }, events, profile(), now)
    const b = planChild({ id: 'twin-b', birthDate: '2026-06-14', dueDate: '2026-06-14' }, events, profile(), now)
    const shared = twinSyncPlan([a, b])
    expect(shared).not.toBeNull()
    expect(shared!.start.toISOString()).toBe(a.next!.start.toISOString())
    expect(a.next!.start.getTime()).toBeLessThan(b.next!.start.getTime())
  })
})

describe('accuracy', () => {
  it('scores a logged nap against the prediction', () => {
    const predictedFor = zonedTimeToUtc(2026, 11, 14, 13, 0).toISOString()
    const created = rememberPrediction([], 'twin-a', predictedFor, zonedTimeToUtc(2026, 11, 14, 11, 0))
    const logged = event({
      kind: 'nap',
      start: zonedTimeToUtc(2026, 11, 14, 13, 10).toISOString(),
      end: zonedTimeToUtc(2026, 11, 14, 14, 0).toISOString(),
    })
    const matched = matchPredictions(created, [logged])
    const summary = accuracySummary(matched, 'twin-a', zonedTimeToUtc(2026, 11, 14, 15, 0))
    expect(summary.maeMin).toBeCloseTo(10, 5)
    expect(summary.label).toMatch(/±10 min/)
  })
})
