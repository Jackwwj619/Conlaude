import type { Profile, RemoteSession, SessionStatus } from '../../shared/contracts'
import { connectionIdentity } from '../../shared/profile-identity'

export type ActivityFilter = 'all' | 'running' | 'attention'
export const needsAttention = (status?: SessionStatus): boolean =>
  status?.state === 'failed' ||
  (status?.state === 'attached' && status.promptState === 'confirmation')
export function matchesActivity(
  status: SessionStatus | undefined,
  filter: ActivityFilter
): boolean {
  if (filter === 'attention') return needsAttention(status)
  if (filter === 'running') return status?.state === 'attached' && status.generating === true
  return true
}

export function normalizeDirectory(path: string): string {
  return (
    path
      .trim()
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '') || '/'
  )
}

export function groupSessionDirectories(profile: Profile, sessions: RemoteSession[]) {
  const defaultPath = normalizeDirectory(profile.defaultCwd)
  const folders = new Map<string, RemoteSession[]>()
  for (const session of sessions) {
    const path = normalizeDirectory(session.currentPath || profile.defaultCwd)
    folders.set(path, [...(folders.get(path) ?? []), session])
  }
  if (!folders.size) folders.set(defaultPath, [])
  const leaf = (path: string): string => path.split('/').at(-1) || '/'
  const names = [...folders.keys()].map(leaf)
  return [...folders]
    .map(([path, entries]) => ({
      path,
      label: names.filter((name) => name === leaf(path)).length > 1 ? path : leaf(path),
      sessions: entries,
      foldKey:
        path === defaultPath
          ? connectionIdentity(profile)
          : `${connectionIdentity(profile)}:${path}`,
      domId:
        path === defaultPath
          ? `project-sessions-${profile.id}`
          : `project-sessions-${profile.id}-${encodeURIComponent(path)}`
    }))
    .sort(
      (a, b) =>
        Number(b.path === defaultPath) - Number(a.path === defaultPath) ||
        a.path.localeCompare(b.path)
    )
}
