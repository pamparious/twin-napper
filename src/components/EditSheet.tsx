import { useMemo, useState } from 'react'
import { rangesOverlap } from '../engine/metrics'
import { addMinutes, dateKey, formatWhen, inClockRange, zonedParts, zonedTimeToUtc } from '../engine/time'
import type { Child, Profile, SleepEvent, SleepKind } from '../model'
import { activeEvents, uid } from '../model'

export function EditSheet({
  event,
  children,
  events,
  profile,
  creating,
  onClose,
  onSave,
  onDelete,
}: {
  event: SleepEvent
  children: Child[]
  events: SleepEvent[]
  profile: Profile
  creating: boolean
  onClose: () => void
  onSave: (event: SleepEvent) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = useState(event)
  const [error, setError] = useState('')
  const start = splitLocal(draft.start)
  const end = draft.end ? splitLocal(draft.end) : { date: start.date, time: '' }

  const overlap = useMemo(() => {
    const startDate = new Date(draft.start)
    const endDate = draft.end ? new Date(draft.end) : null
    return activeEvents(events).some(
      (other) =>
        other.id !== draft.id &&
        other.childId === draft.childId &&
        rangesOverlap(startDate, endDate, new Date(other.start), other.end ? new Date(other.end) : null),
    )
  }, [draft, events])

  function setStart(date: string, time: string) {
    if (!time) return
    setDraft({ ...draft, start: joinLocal(date, time) })
  }

  function setEnd(date: string, time: string) {
    setDraft({ ...draft, end: time ? joinLocal(date || start.date, time) : null })
  }

  function shiftStart(minutesAgo: number) {
    const next = addMinutes(new Date(), -minutesAgo)
    const parts = zonedParts(next)
    const date = dateKey(next)
    const time = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
    setDraft({ ...draft, start: joinLocal(date, time), kind: kindFor(next, profile) })
  }

  function save() {
    if (draft.end && new Date(draft.end) <= new Date(draft.start)) {
      setError('The end time needs to be after the start.')
      return
    }
    if (overlap) {
      setError('This overlaps another sleep for the same twin.')
      return
    }
    onSave(draft)
  }

  const other = children.find((child) => child.id !== draft.childId)

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="sheet-handle" />
        <h2 id="edit-title">{creating ? 'Log past sleep' : 'Edit sleep'}</h2>
        <div className="segment" role="group" aria-label="Sleep type">
          {(['nap', 'night'] as SleepKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className={draft.kind === kind ? 'segment-on' : ''}
              onClick={() => setDraft({ ...draft, kind })}
            >
              {kind === 'nap' ? 'Nap' : 'Night'}
            </button>
          ))}
        </div>
        <div className="chip-row">
          {[5, 10, 15].map((minutes) => (
            <button key={minutes} type="button" className="chip" onClick={() => shiftStart(minutes)}>
              Started {minutes} min ago
            </button>
          ))}
        </div>
        <label className="field">
          <span>Start</span>
          <span className="time-pair">
            <input type="date" value={start.date} onChange={(input) => setStart(input.target.value, start.time)} />
            <input aria-label="Start time" type="time" value={start.time} onChange={(input) => setStart(start.date, input.target.value)} />
          </span>
        </label>
        <label className="field">
          <span>End</span>
          <span className="time-pair">
            <input type="date" value={end.date} onChange={(input) => setEnd(input.target.value, end.time)} />
            <input aria-label="End time" type="time" value={end.time} onChange={(input) => setEnd(end.date, input.target.value)} />
          </span>
        </label>
        <label className="field">
          <span>Note</span>
          <input value={draft.note ?? ''} onChange={(input) => setDraft({ ...draft, note: input.target.value })} placeholder="Optional" />
        </label>
        {other && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setDraft({ ...draft, childId: other.id })}
          >
            Move to {other.nickname}
          </button>
        )}
        {!creating && (
          <p className="who">
            Logged by {draft.updatedBy} · {formatWhen(new Date(draft.updatedAt))}
          </p>
        )}
        {overlap && <p className="error-text">This overlaps another sleep for the same twin.</p>}
        {error && <p className="error-text">{error}</p>}
        <button type="button" className="button primary" onClick={save}>
          Save
        </button>
        {!creating && (
          <button type="button" className="button danger" onClick={() => onDelete(draft.id)}>
            Delete
          </button>
        )}
        <button type="button" className="button quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function blankEvent(childId: string, profile: Profile, now = new Date()): SleepEvent {
  const start = addMinutes(now, -30)
  return {
    id: uid(),
    childId,
    start: start.toISOString(),
    end: now.toISOString(),
    kind: kindFor(start, profile),
    note: '',
    updatedAt: now.toISOString(),
    updatedBy: '',
  }
}

function kindFor(date: Date, profile: Profile): SleepKind {
  return inClockRange(date, profile.settings.nightStart, profile.settings.nightEnd) ? 'night' : 'nap'
}

function splitLocal(iso: string): { date: string; time: string } {
  const date = new Date(iso)
  const parts = zonedParts(date)
  return {
    date: dateKey(date),
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  }
}

function joinLocal(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return zonedTimeToUtc(year, month, day, hour, minute).toISOString()
}
