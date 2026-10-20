import { Notification } from 'electron'

// Exercise the callback registered by the production entry point without
// displaying OS toasts or modifying the user's Windows notification history.
Notification.handleActivation = (callback) => {
  globalThis.activateTestNotification = callback
}
await import('./offline-entry.mjs')
