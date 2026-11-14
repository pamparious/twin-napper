import { useEffect, useState } from 'react'
import { aiPrompt, buildBundle, copyText, shareOrDownload, toCsv } from '../export/export'
import type { Child, ScheduleOverride } from '../model'
import { statusLabel } from '../state/store'
import { useSnapshot, useStore } from '../state/StoreContext'

const COLORS = ['#64D2FF', '#FFD60A', '#FF9F0A', '#BF5AF2', '#30D158', '#FF375F']

export function Settings({ now }: { now: Date }) {
  const store = useStore()
  const snap = useSnapshot()
  const [token, setToken] = useState(store.token())
  const [connection, setConnection] = useState('')
  const [overrideText, setOverrideText] = useState(
    snap.profile.scheduleOverride ? JSON.stringify(snap.profile.scheduleOverride, null, 2) : '',
  )
  const [message, setMessage] = useState('')
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)

  async function exportJson() {
    const bundle = buildBundle(snap.profile, snap.events, snap.predictions, now)
    await shareOrDownload(`twin-napper-${stamp(now)}.json`, JSON.stringify(bundle, null, 2), 'application/json')
  }

  async function exportCsv() {
    await shareOrDownload(`twin-napper-${stamp(now)}.csv`, toCsv(snap.events), 'text/csv')
  }

  async function copyAi() {
    await copyText(aiPrompt(snap.profile, snap.events, now))
    setMessage('Copied a 14-day summary and a prompt. Paste it into an AI chat.')
  }

  function saveOverride() {
    try {
      const parsed = parseOverride(overrideText)
      store.updateProfile((profile) => ({ ...profile, scheduleOverride: parsed }))
      setMessage(parsed ? 'Schedule override saved.' : 'Schedule override cleared.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not read that JSON')
    }
  }

  return (
    <section className="screen">
      <header className="top">
        <p className="eyebrow">Settings</p>
        <h1>Family</h1>
        <p className="subtitle">{statusLabel(snap.status)}</p>
      </header>

      {!standalone && (
        <div className="banner">
          <p>
            {ios ? 'In Safari, tap Share, then Add to Home Screen.' : 'Install this page to your home screen.'} Open Twin Napper from
            the icon before you paste the GitHub token. Safari and the home-screen app keep separate storage.
          </p>
        </div>
      )}

      <h2>Twins</h2>
      {snap.profile.children.map((child) => (
        <fieldset key={child.id} className="group">
          <NicknameField
            value={child.nickname}
            onCommit={(nickname) => patchChild(store, child.id, { nickname })}
          />
          <RealNameField
            value={snap.realNames[child.id] ?? ''}
            onCommit={(name) => store.setRealName(child.id, name)}
          />
          <label className="field">
            <span>Birthday</span>
            <input
              type="date"
              value={child.birthDate}
              onChange={(input) => patchChild(store, child.id, { birthDate: input.target.value })}
            />
          </label>
          <label className="field">
            <span>Due date</span>
            <input
              type="date"
              value={child.dueDate}
              onChange={(input) => patchChild(store, child.id, { dueDate: input.target.value })}
            />
          </label>
          {child.birthDate && child.dueDate && child.dueDate < child.birthDate && (
            <p className="error-text">The due date is before the birthday. Corrected age is for babies born early.</p>
          )}
          <div className="chip-row" role="group" aria-label={`${child.nickname} colour`}>
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="color"
                style={{ background: color, outline: child.color === color ? '2px solid var(--text)' : 'none' }}
                aria-label={color}
                onClick={() => patchChild(store, child.id, { color })}
              />
            ))}
          </div>
        </fieldset>
      ))}

      <h2>Schedule</h2>
      <fieldset className="group">
        <TimeField label="Night starts" value={snap.profile.settings.nightStart} onChange={(value) => patchSettings(store, { nightStart: value })} />
        <TimeField label="Night ends" value={snap.profile.settings.nightEnd} onChange={(value) => patchSettings(store, { nightEnd: value })} />
        <TimeField label="Bedtime from" value={snap.profile.settings.bedtimeStart} onChange={(value) => patchSettings(store, { bedtimeStart: value })} />
        <TimeField label="Bedtime until" value={snap.profile.settings.bedtimeEnd} onChange={(value) => patchSettings(store, { bedtimeEnd: value })} />
        <label className="toggle">
          <input
            type="checkbox"
            checked={snap.profile.settings.twinSync}
            onChange={(input) => patchSettings(store, { twinSync: input.target.checked })}
          />
          <span>Line up nap suggestions for both twins</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={snap.nightManual} onChange={(input) => store.setNightManual(input.target.checked)} />
          <span>Larger buttons now</span>
        </label>
      </fieldset>

      <h2>GitHub</h2>
      <fieldset className="group">
        <YourNameField value={snap.yourName} onCommit={(name) => store.setYourName(name)} />
        <p className="help">This label is stored in the public repository. Use Mum or Dad, not a full name.</p>
        <ol className="help">
          <li>Open GitHub → Settings → Developer settings → Fine-grained tokens.</li>
          <li>Limit the token to the {`pamparious/twin-napper`} repository.</li>
          <li>Contents: Read and write. Nothing else.</li>
          <li>Generate it, then paste it here on each phone. The same token can be used on both.</li>
        </ol>
        <label className="field">
          <span>Token</span>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(input) => setToken(input.target.value)}
            placeholder="github_pat_…"
          />
        </label>
        <button type="button" className="button secondary" onClick={() => store.setToken(token)}>
          Save token on this phone
        </button>
        <button
          type="button"
          className="button quiet"
          onClick={() => {
            void store
              .testConnection()
              .then(setConnection)
              .catch((error: unknown) => setConnection(error instanceof Error ? error.message : 'Connection failed'))
          }}
        >
          Test connection
        </button>
        {connection && <p className="help">{connection}</p>}
      </fieldset>

      <h2>Export</h2>
      <div className="stack">
        <button type="button" className="button secondary" onClick={() => void exportJson()}>
          Export JSON
        </button>
        <button type="button" className="button secondary" onClick={() => void exportCsv()}>
          Export CSV
        </button>
        <button type="button" className="button secondary" onClick={() => void copyAi()}>
          Copy for AI
        </button>
      </div>

      <h2>Schedule override</h2>
      <fieldset className="group">
        <p className="help">Paste JSON from an AI chat to replace the age table. Leave it empty to use the built-in engine.</p>
        <textarea value={overrideText} onChange={(input) => setOverrideText(input.target.value)} rows={8} spellCheck={false} aria-label="Schedule override JSON" />
        <button type="button" className="button primary" onClick={saveOverride}>
          Save override
        </button>
      </fieldset>
      {message && <p className="help">{message}</p>}
      <p className="disclaimer">
        Nap times are guidance based on age and your logs, not medical advice. Watch your babies, not only the clock. The data branch of this
        repository is public: it stores nicknames, dates and sleep times.
      </p>
    </section>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="time"
        value={draft}
        onChange={(input) => setDraft(input.target.value)}
        onBlur={() => {
          if (draft !== value) onChange(draft)
        }}
      />
    </label>
  )
}

function NicknameField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field">
      <span>Nickname (shared, public)</span>
      <input
        value={draft}
        onChange={(input) => setDraft(input.target.value)}
        onBlur={() => {
          if (draft.trim() && draft !== value) onCommit(draft.trim())
        }}
      />
    </label>
  )
}

function RealNameField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field">
      <span>Real name (this phone only)</span>
      <input
        value={draft}
        placeholder="Stays on this phone"
        onChange={(input) => setDraft(input.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft)
        }}
      />
    </label>
  )
}

function YourNameField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field">
      <span>Your label on new entries</span>
      <input
        value={draft}
        onChange={(input) => setDraft(input.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft)
        }}
      />
    </label>
  )
}

function patchChild(
  store: ReturnType<typeof useStore>,
  id: string,
  patch: Partial<Pick<Child, 'nickname' | 'birthDate' | 'dueDate' | 'color'>>,
) {
  store.updateProfile((profile) => ({
    ...profile,
    children: profile.children.map((child) => (child.id === id ? { ...child, ...patch } : child)),
  }))
}

function patchSettings(
  store: ReturnType<typeof useStore>,
  patch: Partial<{ nightStart: string; nightEnd: string; bedtimeStart: string; bedtimeEnd: string; twinSync: boolean }>,
) {
  store.updateProfile((profile) => ({ ...profile, settings: { ...profile.settings, ...patch } }))
}

function parseOverride(text: string): ScheduleOverride | null {
  const trimmed = text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()
  if (!trimmed) return null
  const value = JSON.parse(trimmed) as ScheduleOverride
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Override must be a JSON object')
  return value
}

function stamp(now: Date): string {
  return now.toISOString().slice(0, 10)
}
