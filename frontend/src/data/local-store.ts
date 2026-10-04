import { SEED_ROWS } from './seed'
import type { EntryRow, ShuttleOpsStore } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-ops:entries'
// 摆渡车派车批次与里程台账单独存一份：跟业务台账分开，互不影响。
const OPS_STORAGE_KEY = 'airport-ground-ops:shuttle-ops'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

const EMPTY_OPS: ShuttleOpsStore = { batches: [], ledger: [] }

let opsCache: ShuttleOpsStore | null = null

export function loadShuttleOps(): ShuttleOpsStore {
  if (opsCache !== null) {
    return opsCache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    opsCache = clone(EMPTY_OPS)
    return opsCache
  }
  const raw = window.localStorage.getItem(OPS_STORAGE_KEY)
  if (!raw) {
    opsCache = clone(EMPTY_OPS)
    return opsCache
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ShuttleOpsStore>
    opsCache = { batches: parsed.batches ?? [], ledger: parsed.ledger ?? [] }
  } catch {
    opsCache = clone(EMPTY_OPS)
  }
  return opsCache
}

export function saveShuttleOps(store: ShuttleOpsStore): void {
  opsCache = store
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(OPS_STORAGE_KEY, JSON.stringify(store))
  }
}
