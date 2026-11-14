import { matchPredictions, rememberPrediction } from '../engine/accuracy'
import { formatClock, formatDuration, minutesBetween } from '../engine/time'
import { DEFAULT_PROFILE, activeEvents, type PredictionRecord, type Profile, type SleepEvent } from '../model'
import { idbGet, idbSet } from '../sync/db'
import { GithubClient, GithubError } from '../sync/github'
import { mergeProfile, monthOf, monthsIn, reconcileMonth } from '../sync/merge'

const BACKUP_KEY = 'twin-napper-backup'
const TOKEN_KEY = 'twin-napper-token'
const NAMES_KEY = 'twin-napper-names'
const LABEL_KEY = 'twin-napper-label'
const NIGHT_KEY = 'twin-napper-night'
const SEEN_KEY = 'twin-napper-seen'
const IDB_KEY = 'state'

export type SyncStatus =
  | { kind: 'local'; detail: string }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: string }
  | { kind: 'offline' }
  | { kind: 'auth'; message: string }
  | { kind: 'rate'; until: number }
  | { kind: 'error'; message: string }

interface FileCache {
  sha: string | null
  etag: string | null
  text: string
}

interface Persisted {
  profile: Profile
  events: SleepEvent[]
  predictions: PredictionRecord[]
  files: Record<string, FileCache>
  remoteSha: string | null
}

export interface Snapshot {
  ready: boolean
  profile: Profile
  events: SleepEvent[]
  predictions: PredictionRecord[]
  status: SyncStatus
  realNames: Record<string, string>
  yourName: string
  nightManual: boolean
  catchUp: string | null
  updateReady: boolean
  tokenSet: boolean
}

type Listener = () => void

export class Store {
  private profile: Profile = structuredClone(DEFAULT_PROFILE)
  private events: SleepEvent[] = []
  private predictions: PredictionRecord[] = []
  private files: Record<string, FileCache> = {}
  private remoteSha: string | null = null
  private status: SyncStatus = { kind: 'local', detail: 'On this phone only' }
  private realNames: Record<string, string> = {}
  private yourName = 'Parent'
  private nightManual = false
  private catchUp: string | null = null
  private updateReady = false
  private applyUpdate: (() => void) | null = null
  private ready = false
  private dirty = false
  private generation = 0
  private flushing = false
  private pauseUntil = 0
  private timer = 0
  private flushTimer = 0
  private syncing = false
  private syncQueued = false
  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): Snapshot {
    return {
      ready: this.ready,
      profile: this.profile,
      events: this.events,
      predictions: this.predictions,
      status: this.status,
      realNames: this.realNames,
      yourName: this.yourName,
      nightManual: this.nightManual,
      catchUp: this.catchUp,
      updateReady: this.updateReady,
      tokenSet: Boolean(this.token()),
    }
  }

  async start(): Promise<void> {
    await this.hydrate()
    this.ready = true
    this.refreshCatchUp()
    this.emit()
    void navigator.storage?.persist?.()
    document.addEventListener('visibilitychange', this.onForeground)
    window.addEventListener('online', this.onForeground)
    window.addEventListener('offline', this.onOffline)
    this.timer = window.setInterval(() => void this.syncNow(), 15_000)
    void this.syncNow()
  }

  stop(): void {
    window.clearInterval(this.timer)
    window.clearTimeout(this.flushTimer)
    document.removeEventListener('visibilitychange', this.onForeground)
    window.removeEventListener('online', this.onForeground)
    window.removeEventListener('offline', this.onOffline)
  }

  setUpdater(apply: () => void): void {
    this.applyUpdate = apply
  }

  markUpdateReady(): void {
    this.updateReady = true
    this.emit()
  }

  reloadApp(): void {
    this.applyUpdate?.()
  }

  saveEvent(event: SleepEvent): void {
    const next: SleepEvent = {
      ...event,
      updatedAt: new Date().toISOString(),
      updatedBy: this.yourName || 'Parent',
    }
    this.events = this.events.flatMap((item) => {
      if (item.id !== next.id || item.deleted) return [item]
      if (monthOf(item) === monthOf(next)) return []
      return [{ ...item, deleted: true, updatedAt: next.updatedAt, updatedBy: next.updatedBy }]
    })
    this.events.push(next)
    this.predictions = matchPredictions(this.predictions, this.events)
    this.touch()
  }

  removeEvent(id: string): void {
    const now = new Date().toISOString()
    this.events = this.events.map((event) =>
      event.id === id && !event.deleted ? { ...event, deleted: true, updatedAt: now, updatedBy: this.yourName || 'Parent' } : event,
    )
    this.touch()
  }

  updateProfile(recipe: (profile: Profile) => Profile): void {
    this.profile = { ...recipe(this.profile), updatedAt: new Date().toISOString() }
    this.touch()
  }

  setToken(token: string): void {
    const trimmed = token.trim()
    if (trimmed) localStorage.setItem(TOKEN_KEY, trimmed)
    else localStorage.removeItem(TOKEN_KEY)
    this.remoteSha = null
    this.status = trimmed ? { kind: 'syncing' } : { kind: 'local', detail: 'On this phone only' }
    this.emit()
    if (trimmed) void this.syncNow()
  }

  token(): string {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  }

  async testConnection(): Promise<string> {
    const token = this.token()
    if (!token) throw new Error('Paste a GitHub token first')
    return new GithubClient(token).test()
  }

  setRealName(childId: string, name: string): void {
    this.realNames = { ...this.realNames, [childId]: name }
    localStorage.setItem(NAMES_KEY, JSON.stringify(this.realNames))
    this.emit()
  }

  setYourName(name: string): void {
    this.yourName = name.trim() || 'Parent'
    localStorage.setItem(LABEL_KEY, this.yourName)
    this.emit()
  }

  setNightManual(on: boolean): void {
    this.nightManual = on
    localStorage.setItem(NIGHT_KEY, on ? '1' : '0')
    this.emit()
  }

  dismissCatchUp(): void {
    localStorage.setItem(SEEN_KEY, new Date().toISOString())
    this.catchUp = null
    this.emit()
  }

  recordPrediction(childId: string, predictedFor: string): void {
    const next = rememberPrediction(this.predictions, childId, predictedFor)
    if (next === this.predictions) return
    this.predictions = matchPredictions(next, this.events)
    void this.persist()
    this.emit()
  }

  displayName(childId: string, nickname: string): string {
    const real = this.realNames[childId]?.trim()
    return real || nickname
  }

  private touch(): void {
    this.dirty = true
    this.generation += 1
    void this.persist()
    this.emit()
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    window.clearTimeout(this.flushTimer)
    this.flushTimer = window.setTimeout(() => void this.syncNow(), 400)
  }

  private async syncNow(): Promise<void> {
    if (this.syncing) {
      this.syncQueued = true
      return
    }
    this.syncing = true
    try {
      await this.poll()
    } finally {
      this.syncing = false
      if (this.syncQueued) {
        this.syncQueued = false
        void this.syncNow()
      }
    }
  }

  private onForeground = (): void => {
    if (document.visibilityState === 'visible') void this.syncNow()
  }

  private onOffline = (): void => {
    this.status = { kind: 'offline' }
    this.emit()
  }

  private async hydrate(): Promise<void> {
    this.realNames = readJson(NAMES_KEY, {})
    this.yourName = localStorage.getItem(LABEL_KEY) || 'Parent'
    this.nightManual = localStorage.getItem(NIGHT_KEY) === '1'
    const fromDb = await idbGet<Persisted>(IDB_KEY)
    const fromLocal = readJson<Persisted | null>(BACKUP_KEY, null)
    const saved = pickNewer(fromDb, fromLocal)
    if (saved) {
      this.profile = saved.profile
      this.events = saved.events
      this.predictions = saved.predictions
      this.files = saved.files ?? {}
      this.remoteSha = saved.remoteSha
    }
  }

  private async persist(): Promise<void> {
    const payload: Persisted = {
      profile: this.profile,
      events: this.events,
      predictions: this.predictions,
      files: this.files,
      remoteSha: this.remoteSha,
    }
    await idbSet(IDB_KEY, payload)
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(payload))
    } catch {
      // The browser may refuse the backup when storage is full. IndexedDB still has the copy.
    }
  }

  private async poll(): Promise<void> {
    const hidden = document.visibilityState === 'hidden'
    if (hidden) {
      if (this.dirty) await this.flush()
      return
    }
    if (this.pauseUntil > Date.now()) return
    const token = this.token()
    if (!token) {
      this.status = { kind: 'local', detail: 'On this phone only' }
      this.emit()
      return
    }
    if (this.flushing) return
    const client = new GithubClient(token)
    try {
      const sha = await client.getRef()
      if (!sha) {
        this.status = this.dirty ? { kind: 'syncing' } : { kind: 'local', detail: 'Will sync on the first save' }
        this.emit()
        if (this.dirty) await this.flush()
        return
      }
      if (sha !== this.remoteSha) await this.pull(client, sha)
      else if (!this.dirty) {
        this.status = { kind: 'synced', at: new Date().toISOString() }
        this.emit()
      }
      if (this.dirty) await this.flush()
    } catch (error) {
      this.fail(error)
    }
  }

  private async flush(): Promise<void> {
    const token = this.token()
    if (!token || !this.dirty || this.flushing) return
    this.flushing = true
    this.status = { kind: 'syncing' }
    this.emit()
    const client = new GithubClient(token)
    try {
      while (this.dirty) {
        const generation = this.generation
        await this.push(client)
        if (generation === this.generation) this.dirty = false
      }
      this.status = { kind: 'synced', at: new Date().toISOString() }
      await this.persist()
    } catch (error) {
      this.fail(error)
    } finally {
      this.flushing = false
      this.emit()
    }
  }

  private async push(client: GithubClient): Promise<void> {
    if (!(await client.getRef())) {
      this.remoteSha = await client.createDataBranch(JSON.stringify(this.profile, null, 2))
    }
    await this.writeProfile(client)
    const months = new Set([...monthsIn(this.events), ...(await client.listEvents())])
    for (const month of months) await this.writeMonth(client, month)
  }

  private async pull(client: GithubClient, sha: string): Promise<void> {
    const profileFile = await client.getFile('profile.json', this.files['profile.json']?.etag)
    if (!profileFile.notModified && profileFile.text) {
      const remote = JSON.parse(profileFile.text) as Profile
      this.profile = mergeProfile(this.profile, remote)
      this.files['profile.json'] = { sha: profileFile.sha, etag: profileFile.etag, text: JSON.stringify(this.profile, null, 2) }
    }
    const months = new Set([...monthsIn(this.events), ...(await client.listEvents())])
    for (const month of months) {
      const path = `events/${month}.json`
      const file = await client.getFile(path, this.files[path]?.etag)
      if (file.notModified) continue
      const remote = file.text ? (JSON.parse(file.text) as SleepEvent[]) : []
      const merged = reconcileMonth(this.events, remote, month)
      this.adopt(month, merged)
      this.files[path] = { sha: file.sha, etag: file.etag, text: JSON.stringify(merged, null, 2) }
    }
    this.remoteSha = sha
    this.predictions = matchPredictions(this.predictions, this.events)
    if (!this.dirty) this.status = { kind: 'synced', at: new Date().toISOString() }
    await this.persist()
    this.emit()
  }

  private async writeProfile(client: GithubClient): Promise<void> {
    const path = 'profile.json'
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const remote = await client.getFile(path)
      const remoteProfile = remote.text ? (JSON.parse(remote.text) as Profile) : null
      const merged = mergeProfile(this.profile, remoteProfile)
      this.profile = merged
      const text = JSON.stringify(merged, null, 2)
      if (remote.text && stable(remote.text) === stable(text)) {
        this.files[path] = { sha: remote.sha, etag: remote.etag, text }
        return
      }
      try {
        const saved = await client.putFile(path, text, remote.sha, 'Update Twin Napper profile')
        this.files[path] = { sha: saved.blobSha, etag: null, text }
        this.remoteSha = saved.commitSha
        return
      } catch (error) {
        if (!isConflict(error) || attempt === 4) throw error
        await delay(backoff(attempt))
      }
    }
  }

  private async writeMonth(client: GithubClient, month: string): Promise<void> {
    const path = `events/${month}.json`
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const remote = await client.getFile(path)
      const remoteEvents = remote.text ? (JSON.parse(remote.text) as SleepEvent[]) : []
      const merged = reconcileMonth(this.events, remoteEvents, month)
      this.adopt(month, merged)
      const text = JSON.stringify(merged, null, 2)
      if (remote.text && stable(remote.text) === stable(text)) {
        this.files[path] = { sha: remote.sha, etag: remote.etag, text }
        return
      }
      if (!remote.text && merged.length === 0) return
      try {
        const saved = await client.putFile(path, text, remote.sha, `Update ${month} sleep log`)
        this.files[path] = { sha: saved.blobSha, etag: null, text }
        this.remoteSha = saved.commitSha
        return
      } catch (error) {
        if (!isConflict(error) || attempt === 4) throw error
        await delay(backoff(attempt))
      }
    }
  }

  private adopt(month: string, merged: SleepEvent[]): void {
    const others = this.events.filter((event) => monthOf(event) !== month)
    this.events = dedupe([...others, ...merged])
  }

  private fail(error: unknown): void {
    if (error instanceof GithubError && error.status === 401) {
      this.status = { kind: 'auth', message: 'Reconnect GitHub. This token has expired or was revoked.' }
    } else if (error instanceof GithubError && error.retryAt) {
      this.pauseUntil = error.retryAt
      this.status = { kind: 'rate', until: error.retryAt }
    } else if (error instanceof TypeError) {
      this.status = { kind: 'offline' }
    } else {
      this.status = { kind: 'error', message: error instanceof Error ? error.message : 'Sync failed' }
    }
    this.emit()
  }

  private refreshCatchUp(): void {
    const seen = localStorage.getItem(SEEN_KEY)
    if (!seen) {
      localStorage.setItem(SEEN_KEY, new Date().toISOString())
      this.catchUp = null
      return
    }
    if (Date.now() - new Date(seen).getTime() < 2 * 60 * 60 * 1000) return
    this.catchUp = describeAway(this.profile, this.events, this.realNames, seen)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function describeAway(profile: Profile, events: SleepEvent[], names: Record<string, string>, seen: string): string | null {
  const since = new Date(seen).getTime()
  const parts: string[] = []
  for (const child of profile.children) {
    const name = names[child.id]?.trim() || child.nickname
    const mine = activeEvents(events).filter((event) => event.childId === child.id)
    const running = mine.find((event) => !event.end)
    if (running && new Date(running.start).getTime() >= since) {
      parts.push(`${name} is asleep since ${formatClock(new Date(running.start))}`)
      continue
    }
    const finished = mine
      .filter((event) => event.end && new Date(event.end).getTime() >= since)
      .sort((a, b) => (a.end ?? '').localeCompare(b.end ?? ''))
    const latest = finished.at(-1)
    if (!latest?.end) continue
    const minutes = minutesBetween(new Date(latest.start), new Date(latest.end))
    parts.push(`${name} ${latest.kind === 'night' ? 'slept' : 'napped'} ${formatDuration(minutes)}`)
  }
  if (parts.length === 0) return null
  return `While you were away: ${parts.join(', ')}`
}

function pickNewer(a?: Persisted, b?: Persisted | null): Persisted | undefined {
  if (!a) return b ?? undefined
  if (!b) return a
  const aStamp = a.profile?.updatedAt ?? ''
  const bStamp = b.profile?.updatedAt ?? ''
  if (aStamp === bStamp) return (a.events?.length ?? 0) >= (b.events?.length ?? 0) ? a : b
  return aStamp > bStamp ? a : b
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function dedupe(events: SleepEvent[]): SleepEvent[] {
  const map = new Map<string, SleepEvent>()
  for (const event of events) {
    const key = `${event.id}:${monthOf(event)}:${event.deleted ? 'deleted' : 'live'}`
    const previous = map.get(key)
    if (!previous || previous.updatedAt <= event.updatedAt) map.set(key, event)
  }
  return [...map.values()]
}

function stable(text: string): string {
  return JSON.stringify(JSON.parse(text))
}

function isConflict(error: unknown): boolean {
  return error instanceof GithubError && (error.status === 409 || error.status === 422)
}

function backoff(attempt: number): number {
  return 200 * 2 ** attempt + Math.random() * 200
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function statusLabel(status: SyncStatus): string {
  switch (status.kind) {
    case 'local':
      return status.detail
    case 'syncing':
      return 'Syncing'
    case 'synced':
      return 'Synced'
    case 'offline':
      return 'Offline — saved on this phone'
    case 'auth':
      return 'Reconnect GitHub'
    case 'rate':
      return 'GitHub is busy — will retry'
    case 'error':
      return status.message
  }
}
