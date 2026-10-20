export const WINDOW_COMMAND_CHANNEL = 'app:window-command'
export const WINDOW_COMMANDS = [
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'selectAll',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'close',
  'quit'
] as const
export type WindowCommand = (typeof WINDOW_COMMANDS)[number]

declare global {
  interface Window {
    bridgeWindow: { execute: (command: WindowCommand) => Promise<void> }
  }
}
