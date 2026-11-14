import { useEffect, useState } from 'react'
import { inClockRange } from './engine/time'
import { Home } from './screens/Home'
import { ChildDetail } from './screens/ChildDetail'
import { Settings } from './screens/Settings'
import { History } from './screens/History'
import { statusLabel } from './state/store'
import { useSnapshot, useStore } from './state/StoreContext'

type Route = { name: 'home' } | { name: 'history' } | { name: 'settings' } | { name: 'child'; id: string }

export function App() {
  const store = useStore()
  const snap = useSnapshot()
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [now, setNow] = useState(() => new Date())
  const [undo, setUndo] = useState<{ message: string; run: () => void } | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 5000)
    return () => window.clearTimeout(timer)
  }, [undo])

  const night =
    snap.nightManual || inClockRange(now, snap.profile.settings.nightStart, snap.profile.settings.nightEnd)
  useEffect(() => {
    document.documentElement.classList.toggle('night', night)
  }, [night])

  function rememberUndo(message: string, run: () => void) {
    setUndo({ message, run })
  }

  return (
    <div className="app">
      <p className="sync" role="status">
        {statusLabel(snap.status)}
      </p>
      {snap.updateReady && (
        <div className="banner">
          <p>Update available. Tap to reload.</p>
          <button type="button" onClick={() => store.reloadApp()}>
            Reload
          </button>
        </div>
      )}
      <div className="content">
        {route.name === 'home' && (
          <Home store={store} now={now} onOpenChild={(id) => setRoute({ name: 'child', id })} onUndo={rememberUndo} />
        )}
        {route.name === 'child' && (
          <ChildDetail store={store} childId={route.id} now={now} onBack={() => setRoute({ name: 'home' })} onUndo={rememberUndo} />
        )}
        {route.name === 'history' && <History now={now} />}
        {route.name === 'settings' && <Settings now={now} />}
      </div>
      {undo && (
        <div className="toast" role="status">
          <span>{undo.message}</span>
          <button
            type="button"
            onClick={() => {
              undo.run()
              setUndo(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
      <nav className="tabbar" aria-label="Sections">
        <button type="button" className={route.name === 'home' || route.name === 'child' ? 'tab on' : 'tab'} onClick={() => setRoute({ name: 'home' })}>
          Home
        </button>
        <button type="button" className={route.name === 'history' ? 'tab on' : 'tab'} onClick={() => setRoute({ name: 'history' })}>
          History
        </button>
        <button type="button" className={route.name === 'settings' ? 'tab on' : 'tab'} onClick={() => setRoute({ name: 'settings' })}>
          Settings
        </button>
      </nav>
    </div>
  )
}
