import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Notification, Tray } from 'electron'
import logoPath from '../../logo.png?asset'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { BridgeEvent } from '../shared/contracts'
import { translate } from '../shared/i18n'
import { ConfigStore } from './config-store'
import { Diagnostics } from './diagnostics'
import { HelperManager } from './helper-manager'
import { registerIpcHandlers } from './ipc-handlers'
import { logger } from './logger'
import { PtyManager } from './pty-manager'
import { SessionManager } from './session-manager'
import { SshClient } from './ssh-client'
import { TranscriptWatcher } from './transcript-watcher'
import { UploadManager } from './upload-manager'
import { registerWindowCommands } from './window-commands'
import { SessionNotifications } from './session-notifications'
import { DesktopNotifications } from './desktop-notifications'
import { createWindowState, restoreWindowBounds } from './window-state'
import { trayMenu } from './tray-menu'

let mainWindow: BrowserWindow | undefined
let sessionManager: SessionManager | undefined
let tray: Tray | undefined
let isQuitting = false
let windowActivationRequested = false
const hiddenTest =
  process.env.NODE_ENV === 'test' &&
  !!process.env.CLB_USER_DATA_DIR &&
  process.env.CLB_TEST_HIDDEN === '1'
const sessionNotifications = new SessionNotifications()
const desktopNotifications = new DesktopNotifications(
  () => mainWindow,
  (target) => emit({ type: 'focus-session', target })
)

// Keep the existing Electron profile across the display-name change.
app.setPath('userData', join(app.getPath('appData'), 'Claude Local Bridge'))
app.setName('Conlaude')
// Separate portable and development windows from installed shortcuts: Windows
// otherwise reuses their taskbar group and its potentially stale icon location.
const APP_ID = `com.local.claudelocalbridge${!app.isPackaged ? '.development' : process.env.PORTABLE_EXECUTABLE_FILE ? '.portable' : ''}`
const windowsIconPath = app.isPackaged
  ? join(process.resourcesPath, 'icon.ico')
  : resolve(__dirname, '../../build/icon.ico')
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
if (process.env.NODE_ENV === 'test' && process.env.CLB_USER_DATA_DIR) {
  app.setPath('userData', resolve(process.env.CLB_USER_DATA_DIR))
}

// Acquire the lock after selecting the profile, before creating services or windows.
// Distinguish rapid relaunch messages so Windows does not suppress identical requests.
const hasInstanceLock = app.requestSingleInstanceLock({ pid: process.pid })
if (!hasInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', showMainWindow)
}

function showMainWindow(): void {
  windowActivationRequested = true
  if (hiddenTest) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.moveTop()
  mainWindow.focus()
}

function emit(event: BridgeEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bridge:event', event)
  if (event.type === 'session-status') {
    const notice = sessionNotifications.observe(event.status)
    const settings = configStore?.get()
    if (
      notice &&
      settings?.notifications &&
      !mainWindow?.isFocused() &&
      Notification.isSupported()
    ) {
      const target = { profileId: event.status.profileId, sessionName: event.status.sessionName }
      const profile = settings.profiles.find((item) => item.id === target.profileId)
      desktopNotifications.show(
        {
          title: translate(settings.language, `notice.${notice}`),
          body: `${profile?.label ?? target.profileId} · ${target.sessionName}`
        },
        target
      )
    }
  }
  if (event.type === 'notification' && !mainWindow?.isFocused()) {
    const settings = configStore?.get()
    if (settings?.notifications && Notification.isSupported()) {
      desktopNotifications.show({ title: event.title, body: event.body })
    }
  }
}

let configStore: ConfigStore | undefined

function createWindow(): BrowserWindow {
  const darkBackground = nativeTheme.shouldUseDarkColors
  const windowState = createWindowState()
  const window = new BrowserWindow({
    ...windowState.bounds,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: darkBackground ? '#0b0d12' : '#f7f8fb',
    title: 'Conlaude',
    icon: process.platform === 'win32' ? windowsIconPath : logoPath,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: darkBackground ? '#1b1c1e' : '#ffffff',
      symbolColor: darkBackground ? '#eef1f7' : '#25262b',
      height: 44
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !hiddenTest,
      webSecurity: true
    }
  })
  if (windowState.maximized) window.once('show', () => window.maximize())
  window.setMenu(null)
  window.on('unresponsive', () => {
    logger.error(`Window unresponsive; renderer PID ${window.webContents.getOSProcessId()}`)
  })
  window.on('responsive', () => logger.info('Window responsive again'))
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Renderer exited: ${details.reason}, exit code ${details.exitCode}`)
  })
  if (process.platform === 'win32') {
    // Windows uses shell relaunch properties for grouped and pinned taskbar icons.
    // Keep the ICO outside ASAR so the Windows shell can load it directly.
    const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE
    const executable =
      portableExecutable && existsSync(portableExecutable) ? portableExecutable : process.execPath
    window.setAppDetails({
      appId: APP_ID,
      appIconPath: app.isPackaged ? executable : windowsIconPath,
      appIconIndex: 0,
      relaunchDisplayName: app.isPackaged ? `@${executable},-65001` : 'Conlaude',
      relaunchCommand: app.isPackaged ? `"${executable}"` : `"${executable}" "${app.getAppPath()}"`
    })
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const developmentOrigin = rendererUrl ? new URL(rendererUrl).origin : undefined
  const developmentSocket = developmentOrigin?.replace(/^http/, 'ws')
  const connectSources = ["'self'", developmentOrigin, developmentSocket].filter(Boolean).join(' ')
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy]
      }
    })
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (
      !url.startsWith('file://') &&
      !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')
    ) {
      event.preventDefault()
    }
  })
  window.once('ready-to-show', () => {
    restoreWindowBounds(window, windowState.bounds)
    windowState.track(window)
    if (hiddenTest) return
    if (windowActivationRequested) showMainWindow()
    else if (!configStore?.get().startMinimizedToTray) window.show()
  })
  window.on('close', (event) => {
    if (!isQuitting && configStore?.get().closeToTray) {
      event.preventDefault()
      window.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function refreshTrayMenu(): void {
  if (!tray) return
  const language = configStore?.get().language ?? 'zh-CN'
  tray.setContextMenu(
    Menu.buildFromTemplate(
      trayMenu({
        language,
        hasProfiles: !!configStore?.get().profiles.length,
        show: showMainWindow,
        hide: () => mainWindow?.hide(),
        open: (action) => {
          showMainWindow()
          emit({ type: 'app-action', action })
        },
        quit: () => {
          isQuitting = true
          app.quit()
        }
      })
    )
  )
}

function refreshWindowBackground(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f7f8fb')
  mainWindow.setTitleBarOverlay({
    color: nativeTheme.shouldUseDarkColors ? '#1b1c1e' : '#ffffff',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#eef1f7' : '#25262b'
  })
}

function handleSettingsChanged(): void {
  refreshTrayMenu()
  refreshWindowBackground()
}

async function createTray(): Promise<void> {
  // Pass the ICO path through so Windows can select the native size for its DPI.
  // Converting it to one 32px bitmap discards the smaller tray representations.
  const icon =
    process.platform === 'win32'
      ? windowsIconPath
      : nativeImage.createFromPath(logoPath).resize({ width: 32, height: 32 })
  tray = new Tray(icon)
  tray.setToolTip('Conlaude')
  refreshTrayMenu()
  tray.on('click', showMainWindow)
}

app.whenReady().then(() => {
  if (!hasInstanceLock) return
  configStore = new ConfigStore()
  nativeTheme.themeSource = configStore.get().theme
  const ssh = new SshClient()
  const helper = new HelperManager(ssh)
  const transcripts = new TranscriptWatcher(
    ssh,
    (target, event) => emit({ type: 'timeline-event', target, event }),
    (target) => emit({ type: 'timeline-reset', target }),
    (target, status) => emit({ type: 'transcript-status', target, status })
  )
  const ptys = new PtyManager(
    (target, data) => {
      emit({ type: 'pty-data', target, data })
      sessionManager?.refreshAfterOutput(target)
    },
    (event) => sessionManager?.onPtyExit(event)
  )
  sessionManager = new SessionManager(configStore, ssh, ptys, transcripts, (status) =>
    emit({ type: 'session-status', status })
  )
  mainWindow = createWindow()
  desktopNotifications.registerActivationHandler()
  registerWindowCommands(() => mainWindow)
  void createTray().catch((error) => logger.error('Unable to create system tray', error))
  const uploads = new UploadManager(
    () => mainWindow,
    ssh,
    (target, progress) => emit({ type: 'upload-progress', target, progress })
  )
  const diagnostics = new Diagnostics(ssh, helper, (profileId, report) =>
    emit({ type: 'diagnostics-progress', profileId, report })
  )
  registerIpcHandlers({
    window: () => mainWindow,
    config: configStore,
    ssh,
    sessions: sessionManager,
    ptys,
    helper,
    uploads,
    diagnostics,
    emit,
    onSettingsChanged: handleSettingsChanged
  })

  nativeTheme.on('updated', refreshWindowBackground)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  desktopNotifications.closeAll()
  sessionManager?.closeAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (error) => logger.error('Uncaught main-process exception', error))
process.on('unhandledRejection', (error) => logger.error('Unhandled main-process rejection', error))
