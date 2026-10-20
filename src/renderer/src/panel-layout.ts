export const MIN_TERMINAL_PANEL_HEIGHT = 150
export const DEFAULT_TERMINAL_PANEL_HEIGHT = 320
export const WORKSPACE_RESERVED_HEIGHT = 300

export function clampTerminalPanelHeight(workspaceHeight: number, requestedHeight: number): number {
  const maximum = Math.max(MIN_TERMINAL_PANEL_HEIGHT, workspaceHeight - WORKSPACE_RESERVED_HEIGHT)
  return Math.round(Math.min(maximum, Math.max(MIN_TERMINAL_PANEL_HEIGHT, requestedHeight)))
}
