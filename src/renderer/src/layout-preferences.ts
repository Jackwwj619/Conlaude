import { create } from 'zustand'

const KEY = 'clb:layout:v1'
interface Layout {
  sidebarWidth: number
  fileTreeWidth?: number
  fileDirectorySidebar?: boolean
  filesWidth?: number
  terminalRatio: number
  folded: Record<string, boolean>
  foldedServers: Record<string, boolean>
}
function read(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      sidebarWidth: clampSidebarWidth(1440, Number(saved.sidebarWidth) || 258),
      filesWidth:
        Number.isFinite(saved.filesWidth) && saved.filesWidth >= 300 ? saved.filesWidth : undefined,
      fileTreeWidth:
        Number.isFinite(saved.fileTreeWidth) && saved.fileTreeWidth >= 160
          ? Math.min(saved.fileTreeWidth, 600)
          : undefined,
      fileDirectorySidebar: saved.fileDirectorySidebar === true,
      terminalRatio: clampRatio(Number(saved.terminalRatio) || 0.465),
      folded: saved.folded && typeof saved.folded === 'object' ? saved.folded : {},
      foldedServers:
        saved.foldedServers && typeof saved.foldedServers === 'object' ? saved.foldedServers : {}
    }
  } catch {
    return { sidebarWidth: 258, terminalRatio: 0.465, folded: {}, foldedServers: {} }
  }
}
export function clampSidebarWidth(windowWidth: number, width: number): number {
  return Math.round(Math.max(190, Math.min(width, 420, Math.max(190, windowWidth - 420))))
}
export const clampRatio = (ratio: number): number => Math.max(0.28, Math.min(0.65, ratio))
interface Store extends Layout {
  update: (patch: Partial<Layout>) => void
}
export const useLayoutPreferences = create<Store>((set) => ({
  ...read(),
  update: (patch) =>
    set((state) => {
      const next = {
        sidebarWidth: state.sidebarWidth,
        filesWidth: state.filesWidth,
        fileTreeWidth: state.fileTreeWidth,
        fileDirectorySidebar: state.fileDirectorySidebar,
        terminalRatio: state.terminalRatio,
        folded: state.folded,
        foldedServers: state.foldedServers,
        ...patch
      }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* Layout remains usable. */
      }
      return next
    })
}))
