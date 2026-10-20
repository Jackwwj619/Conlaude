import { BrowserWindow } from 'electron'
import process from 'node:process'

// Isolated automation can render and inspect the application without showing
// windows, changing desktop focus, or interacting with the user's running app.
if (process.env.CLB_TEST_HIDDEN === '1') {
  for (const method of ['show', 'showInactive', 'focus', 'moveTop', 'restore']) {
    BrowserWindow.prototype[method] = function () {}
  }
}

// Hold the renderer until the test has replaced IPC handlers. This prevents
// restored sessions from issuing real SSH requests during a process restart.
const loadFile = BrowserWindow.prototype.loadFile
BrowserWindow.prototype.loadFile = function (...args) {
  globalThis.resumeOfflineRenderer = () => loadFile.apply(this, args)
  return Promise.resolve()
}
await import('../../out/main/index.js')
