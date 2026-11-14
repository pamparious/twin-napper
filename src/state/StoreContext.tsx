import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { Store, type Snapshot } from './store'

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new Store())
  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        store.markUpdateReady()
      },
    })
    store.setUpdater(() => {
      void update(true)
    })
    void store.start()
    return () => store.stop()
  }, [store])
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('Store missing')
  return store
}

export function useSnapshot(): Snapshot {
  const store = useStore()
  const [snapshot, setSnapshot] = useState(() => store.snapshot())
  useEffect(() => store.subscribe(() => setSnapshot(store.snapshot())), [store])
  return snapshot
}
