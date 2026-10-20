import { create } from 'zustand'
import type { Profile, SessionTarget } from '../../shared/contracts'
import { connectionIdentity } from '../../shared/profile-identity'

const STORAGE_KEY = 'clb:workspace:v1'
export interface SessionPreference {
  cwd?: string
  title?: string
  pinned?: boolean
  lastOpened?: number
  readOnly?: boolean
}
interface ProjectPreference {
  identity: string
  sessions: Record<string, SessionPreference>
}
export interface WorkspacePreferences {
  projects: Record<string, ProjectPreference>
  lastTarget?: SessionTarget
  collapsed: boolean
}

export function readWorkspacePreferences(): WorkspacePreferences {
  const empty = { projects: {}, collapsed: false }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!saved || saved.version !== 1 || typeof saved.projects !== 'object') return empty
    const projects: Record<string, ProjectPreference> = {}
    for (const [id, value] of Object.entries(saved.projects)) {
      const project = value as ProjectPreference
      if (!project || typeof project.identity !== 'string' || !project.sessions) continue
      const sessions: Record<string, SessionPreference> = {}
      for (const [name, entry] of Object.entries(project.sessions)) {
        if (!entry || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) continue
        sessions[name] = {
          cwd: typeof entry.cwd === 'string' ? entry.cwd.slice(0, 4096) : undefined,
          title: typeof entry.title === 'string' ? entry.title.slice(0, 120) : undefined,
          pinned: entry.pinned === true,
          readOnly: entry.readOnly === true,
          lastOpened: typeof entry.lastOpened === 'number' ? entry.lastOpened : undefined
        }
      }
      projects[id] = { identity: project.identity, sessions }
    }
    const last = saved.lastTarget
    return {
      projects,
      collapsed: saved.collapsed === true,
      lastTarget:
        last && typeof last.profileId === 'string' && typeof last.sessionName === 'string'
          ? { profileId: last.profileId, sessionName: last.sessionName }
          : undefined
    }
  } catch {
    return empty
  }
}

function persist(value: WorkspacePreferences): WorkspacePreferences {
  // Navigation must still work if storage is full or disabled.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...value }))
  } catch {
    /* Keep the in-memory workspace usable. */
  }
  return value
}

interface PreferenceStore extends WorkspacePreferences {
  reconcile: (profiles: Profile[]) => void
  remember: (profile: Profile, sessionName: string, cwd?: string) => void
  updateSession: (profile: Profile, sessionName: string, change: SessionPreference) => void
  forget: (target: SessionTarget) => void
  setCollapsed: (collapsed: boolean) => void
}

export const useWorkspacePreferences = create<PreferenceStore>((set) => ({
  ...readWorkspacePreferences(),
  reconcile: (profiles) =>
    set((state) => {
      const projects = Object.fromEntries(
        profiles.map((profile) => {
          const saved = state.projects[profile.id]
          const identity = connectionIdentity(profile)
          return [profile.id, saved?.identity === identity ? saved : { identity, sessions: {} }]
        })
      )
      const last = state.lastTarget
      const valid = last && projects[last.profileId]?.sessions[last.sessionName]
      return persist({ projects, collapsed: state.collapsed, lastTarget: valid ? last : undefined })
    }),
  remember: (profile, sessionName, cwd) =>
    set((state) => {
      const identity = connectionIdentity(profile)
      const previous = state.projects[profile.id]
      const sessions = previous?.identity === identity ? previous.sessions : {}
      return persist({
        collapsed: state.collapsed,
        projects: {
          ...state.projects,
          [profile.id]: {
            identity,
            sessions: {
              ...sessions,
              [sessionName]: {
                ...sessions[sessionName],
                ...(cwd ? { cwd } : {}),
                lastOpened: Date.now()
              }
            }
          }
        },
        lastTarget: { profileId: profile.id, sessionName }
      })
    }),
  updateSession: (profile, sessionName, change) =>
    set((state) => {
      const identity = connectionIdentity(profile)
      const previous = state.projects[profile.id]
      const sessions = previous?.identity === identity ? previous.sessions : {}
      return persist({
        collapsed: state.collapsed,
        lastTarget: state.lastTarget,
        projects: {
          ...state.projects,
          [profile.id]: {
            identity,
            sessions: { ...sessions, [sessionName]: { ...sessions[sessionName], ...change } }
          }
        }
      })
    }),
  forget: (target) =>
    set((state) => {
      const project = state.projects[target.profileId]
      if (!project) return state
      const sessions = { ...project.sessions }
      delete sessions[target.sessionName]
      const same =
        state.lastTarget?.profileId === target.profileId &&
        state.lastTarget.sessionName === target.sessionName
      return persist({
        projects: { ...state.projects, [target.profileId]: { ...project, sessions } },
        collapsed: state.collapsed,
        lastTarget: same ? undefined : state.lastTarget
      })
    }),
  setCollapsed: (collapsed) =>
    set((state) => persist({ projects: state.projects, lastTarget: state.lastTarget, collapsed }))
}))

export function projectName(profile: Profile): string {
  return (
    profile.defaultCwd
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) || profile.label
  )
}

export function sessionTitle(target: SessionTarget): string {
  return (
    useWorkspacePreferences.getState().projects[target.profileId]?.sessions[target.sessionName]
      ?.title || target.sessionName
  )
}
