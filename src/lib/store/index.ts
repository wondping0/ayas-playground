import { storageConfig } from '@/lib/core/config'
import { setSingleton, singleton } from '@/lib/core/singleton'
import { MemoryStore } from './memory'
import { PostgresStore } from './postgres'
import type { Store } from './types'

export type { Store } from './types'
export { MemoryStore, auditEntry } from './memory'
export { PostgresStore } from './postgres'

const KEY = 'store'

export function getStore(): Store {
  return singleton<Store>(KEY, () => {
    const databaseUrl = storageConfig.databaseUrl()
    return databaseUrl ? new PostgresStore(databaseUrl) : new MemoryStore()
  })
}

/** Tests and scripts only. */
export function setStore(store: Store | null): void {
  setSingleton(KEY, store)
}
