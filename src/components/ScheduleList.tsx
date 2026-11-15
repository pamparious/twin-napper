export type ScheduleRow = {
  key: string
  time: string
  label: string
  detail?: string
  tone: 'done' | 'now' | 'next' | 'later'
  reason?: string
  eventId?: string
}

export function ScheduleList({
  label,
  rows,
  onEdit,
}: {
  label: string
  rows: ScheduleRow[]
  onEdit: (eventId: string) => void
}) {
  return (
    <ol className="schedule" aria-label={label}>
      {rows.map((row) => {
        const body = (
          <>
            <span className="when">{row.time}</span>
            <span className="what">
              <span className="what-line">
                <span>{row.label}</span>
                {row.tone === 'next' && <span className="pill">Next</span>}
                {row.tone === 'now' && <span className="pill">Now</span>}
                {row.eventId && <span className="edit-hint">Edit</span>}
              </span>
              {row.detail && <small>{row.detail}</small>}
              {row.reason && <small className="row-reason">{row.reason}</small>}
            </span>
          </>
        )
        return (
          <li key={row.key} className={row.tone}>
            {row.eventId ? (
              <button type="button" className="row" onClick={() => onEdit(row.eventId!)}>
                {body}
              </button>
            ) : (
              <div className="row">{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
