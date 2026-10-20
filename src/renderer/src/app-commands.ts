import type { RemoteSession, SessionStatus } from '../../shared/contracts'

export type WorkspaceCommand =
  | 'focus-input'
  | 'upload'
  | 'find-conversation'
  | 'latest'
  | 'edit-title'
  | 'terminal-copy'
  | 'terminal-paste'
  | 'terminal-selectAll'
export function runWorkspaceCommand(command: WorkspaceCommand): void {
  window.dispatchEvent(new CustomEvent('clb:command', { detail: command }))
}
export function onWorkspaceCommand(handler: (command: WorkspaceCommand) => void): () => void {
  const listener = (event: Event): void => handler((event as CustomEvent<WorkspaceCommand>).detail)
  window.addEventListener('clb:command', listener)
  return () => window.removeEventListener('clb:command', listener)
}
export function canUpload(
  target: unknown,
  connected: boolean,
  readOnly: boolean,
  uploading: boolean
): boolean {
  return !!target && connected && !readOnly && !uploading
}
export function canDisconnect(status?: SessionStatus): boolean {
  return !!status && ['attached', 'reconnecting', 'connecting', 'checking'].includes(status.state)
}

export function sessionCommands(session?: RemoteSession, status?: SessionStatus) {
  return {
    observe: !!session && !status?.readOnly,
    takeover: !!session?.attachedClients,
    disconnect: canDisconnect(status),
    rename: !!session && !canDisconnect(status),
    terminate: !!session
  }
}
