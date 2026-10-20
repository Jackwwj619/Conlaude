import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import { WINDOW_COMMAND_CHANNEL, type WindowCommand } from '../shared/window-commands'
import type {
  AppSettings,
  AttachSessionRequest,
  BridgeEvent,
  ClaudeBridgeApi,
  CreateSessionRequest,
  Profile,
  ResizeTerminalRequest,
  RenameSessionRequest,
  SendPromptRequest,
  SessionTarget,
  WriteControlRequest,
  WriteTerminalInputRequest
} from '../shared/contracts'

const api: ClaudeBridgeApi = {
  files: {
    download: (request) => ipcRenderer.invoke(IPC.filesDownload, request),
    list: (request) => ipcRenderer.invoke(IPC.filesList, request),
    read: (request) => ipcRenderer.invoke(IPC.filesRead, request),
    save: (request) => ipcRenderer.invoke(IPC.filesSave, request)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<AppSettings>,
    update: (settings) => ipcRenderer.invoke(IPC.settingsUpdate, settings) as Promise<AppSettings>
  },
  profiles: {
    remove: (profileId) => ipcRenderer.invoke(IPC.profilesRemove, profileId),
    test: (profile: Profile) => ipcRenderer.invoke(IPC.profilesTest, profile),
    importSshConfig: () => ipcRenderer.invoke(IPC.profilesImportSshConfig),
    getSshConfig: () => ipcRenderer.invoke(IPC.profilesGetSshConfig),
    saveSshConfig: (content: string) => ipcRenderer.invoke(IPC.profilesSaveSshConfig, content),
    revealSshConfig: () => ipcRenderer.invoke(IPC.profilesRevealSshConfig)
  },
  sessions: {
    list: (profileId) => ipcRenderer.invoke(IPC.sessionsList, profileId),
    attach: (request: AttachSessionRequest) => ipcRenderer.invoke(IPC.sessionsAttach, request),
    detach: (target: SessionTarget) => ipcRenderer.invoke(IPC.sessionsDetach, target),
    create: (request: CreateSessionRequest) => ipcRenderer.invoke(IPC.sessionsCreate, request),
    rename: (request: RenameSessionRequest) => ipcRenderer.invoke(IPC.sessionsRename, request),
    terminate: (target: SessionTarget, confirmation: string) =>
      ipcRenderer.invoke(IPC.sessionsTerminate, target, confirmation)
  },
  prompts: {
    command: (request) => ipcRenderer.invoke(IPC.commandsRun, request),
    finishCommand: (target) => ipcRenderer.invoke(IPC.commandsFinish, target),
    interrupt: (target) => ipcRenderer.invoke(IPC.promptsInterrupt, target),
    send: (request: SendPromptRequest) => ipcRenderer.invoke(IPC.promptsSend, request)
  },
  terminal: {
    resize: (request: ResizeTerminalRequest) => ipcRenderer.invoke(IPC.terminalResize, request),
    writeControl: (request: WriteControlRequest) =>
      ipcRenderer.invoke(IPC.terminalWriteControl, request),
    writeInput: (request: WriteTerminalInputRequest) =>
      ipcRenderer.invoke(IPC.terminalWriteInput, request)
  },
  uploads: {
    image: (target, dataUrl) => ipcRenderer.invoke(IPC.uploadsImage, target, dataUrl),
    chooseAndUpload: (target: SessionTarget) =>
      ipcRenderer.invoke(IPC.uploadsChooseAndUpload, target)
  },
  helper: {
    status: (profileId) => ipcRenderer.invoke(IPC.helperStatus, profileId),
    install: (profileId) => ipcRenderer.invoke(IPC.helperInstall, profileId)
  },
  diagnostics: {
    run: (profileId) => ipcRenderer.invoke(IPC.diagnosticsRun, profileId),
    export: (profileId) => ipcRenderer.invoke(IPC.diagnosticsExport, profileId)
  },
  app: {
    listFonts: (refresh) => ipcRenderer.invoke(IPC.appListFonts, refresh),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    getVersion: () => ipcRenderer.invoke(IPC.appGetVersion)
  },
  events: {
    subscribe: (handler: (event: BridgeEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: BridgeEvent): void =>
        handler(value)
      ipcRenderer.on(IPC.event, listener)
      return () => ipcRenderer.removeListener(IPC.event, listener)
    }
  }
}

contextBridge.exposeInMainWorld('claudeBridge', api)
contextBridge.exposeInMainWorld('bridgeWindow', {
  execute: (command: WindowCommand) => ipcRenderer.invoke(WINDOW_COMMAND_CHANNEL, command)
})
