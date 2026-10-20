const HISTORY_PREFIX = 'clb:history:'

export function readInputHistory(storage: Storage, key: string, limit: number): string[] {
  if (limit <= 0) return []
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').slice(0, limit)
      : []
  } catch {
    return []
  }
}

export function pruneInputHistory(storage: Storage, limit: number): void {
  try {
    // Snapshot keys before deleting: Storage indices shift after removeItem.
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    for (const key of keys) {
      if (!key?.startsWith(HISTORY_PREFIX)) continue
      if (limit === 0) storage.removeItem(key)
      else storage.setItem(key, JSON.stringify(readInputHistory(storage, key, limit)))
    }
  } catch {
    // Unavailable local storage must not block editing or saving preferences.
  }
}
