import { app, ipcMain, type BrowserWindow } from 'electron'
import {
  WINDOW_COMMAND_CHANNEL,
  WINDOW_COMMANDS,
  type WindowCommand
} from '../shared/window-commands'

export function registerWindowCommands(getWindow: () => BrowserWindow | undefined): void {
  ipcMain.handle(WINDOW_COMMAND_CHANNEL, (event, value: unknown) => {
    const window = getWindow()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Unknown window')
    if (!WINDOW_COMMANDS.includes(value as WindowCommand)) throw new Error('Unknown window command')
    const command = value as WindowCommand
    const contents = window.webContents
    if (command === 'quit') {
      app.quit()
      return
    }
    if (command === 'close') {
      window.close()
      return
    }
    if (command === 'zoomReset') {
      contents.setZoomFactor(1)
      return
    }
    if (command === 'zoomIn' || command === 'zoomOut') {
      contents.setZoomFactor(
        Math.max(
          0.75,
          Math.min(1.5, contents.getZoomFactor() + (command === 'zoomIn' ? 0.25 : -0.25))
        )
      )
      return
    }
    // Send the same keyboard input as the user: CodeMirror and xterm own their
    // editing history and clipboard handlers, rather than Chromium's undo stack.
    const keys = { undo: 'Z', redo: 'Y', cut: 'X', copy: 'C', paste: 'V', selectAll: 'A' }
    const keyCode = keys[command]
    const modifiers: ('control' | 'meta')[] = [process.platform === 'darwin' ? 'meta' : 'control']
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  })
}
