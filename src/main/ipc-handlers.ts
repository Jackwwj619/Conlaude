import { app, dialog, ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { changesConversation, parseClaudeCommand } from '../shared/claude-commands'
import {
  AppSettingsSchema,
  AttachSessionRequestSchema,
  CreateSessionRequestSchema,
  ProfileSchema,
  ResizeTerminalRequestSchema,
  RenameSessionRequestSchema,
  SendPromptRequestSchema,
  SessionTargetSchema,
  SshConfigContentSchema,
  WriteControlRequestSchema,
  WriteTerminalInputRequestSchema,
  type BridgeEvent
} from '../shared/contracts'
import { IPC } from '../shared/ipc'
import { translate } from '../shared/i18n'
import { encodePromptForTerminal } from '../shared/prompt'
import { TERMINAL_CONTROL_SEQUENCES } from '../shared/terminal-controls'
import type { ConfigStore } from './config-store'
import { redactDiagnosticReport, type Diagnostics } from './diagnostics'
import type { HelperManager } from './helper-manager'
import type { PtyManager } from './pty-manager'
import type { SessionManager } from './session-manager'
import type { SshClient } from './ssh-client'
import type { UploadManager } from './upload-manager'
import { listSystemFonts } from './system-fonts'
import { RemoteFiles } from './remote-files'
import {
  DirectoryRequestSchema,
  FileRequestSchema,
  SaveFileRequestSchema
} from '../shared/remote-files'

interface IpcDependencies {
  window: () => BrowserWindow | undefined
  config: ConfigStore
  ssh: SshClient
  sessions: SessionManager
  ptys: PtyManager
  helper: HelperManager
  uploads: UploadManager
  diagnostics: Diagnostics
  emit: (event: BridgeEvent) => void
  onSettingsChanged?: () => void
}

function profileId(value: unknown): string {
  return SessionTargetSchema.shape.profileId.parse(value)
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  const files = new RemoteFiles(deps.ssh, deps.helper)
  ipcMain.handle(IPC.filesDownload, async (_event, value: unknown) => {
    const request = FileRequestSchema.parse(value)
    const profile = deps.config.profile(request.profileId)
    const options = {
      defaultPath: request.path.split('/').at(-1) || 'download',
      title: translate(deps.config.get().language, 'files.download')
    }
    const owner = deps.window()
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }
    await files.download(profile, request.path, result.filePath)
    return { canceled: false, path: result.filePath }
  })
  ipcMain.handle(IPC.filesList, (_event, value: unknown) => {
    const request = DirectoryRequestSchema.parse(value)
    return files.execute(deps.config.profile(request.profileId), 'list', request)
  })
  for (const [channel, operation] of [
    [IPC.filesRead, 'read'],
    [IPC.filesSave, 'save']
  ] as const) {
    ipcMain.handle(channel, (_event, value: unknown) => {
      const request = (operation === 'save' ? SaveFileRequestSchema : FileRequestSchema).parse(
        value
      )
      const authorize = (): void => {
        if (
          operation === 'save' &&
          (!deps.sessions.isAttached(request) || deps.sessions.isReadOnly(request))
        )
          throw new Error('READ_ONLY')
      }
      authorize()
      return files.execute(deps.config.profile(request.profileId), operation, request, authorize)
    })
  }
  const t = (key: string, variables?: Record<string, string | number>): string =>
    translate(deps.config.get().language, key, variables)
  ipcMain.handle(IPC.settingsGet, () => deps.config.get())
  ipcMain.handle(IPC.appListFonts, (_event, refresh: unknown) => listSystemFonts(refresh === true))
  ipcMain.handle(IPC.settingsUpdate, (_event, value: unknown) => {
    const next = AppSettingsSchema.parse(value)
    deps.sessions.assertProfilesCanChange(next.profiles)
    const settings = deps.config.update(next)
    nativeTheme.themeSource = settings.theme
    deps.onSettingsChanged?.()
    return settings
  })
  ipcMain.handle(IPC.profilesRemove, (_event, value: unknown) => {
    const id = profileId(value)
    const current = deps.config.get()
    if (!current.profiles.some((profile) => profile.id === id))
      throw new Error(`Unknown profile: ${id}`)
    const profiles = current.profiles.filter((profile) => profile.id !== id)
    const next = {
      ...current,
      profiles,
      currentProfileId:
        current.currentProfileId === id ? (profiles[0]?.id ?? '') : current.currentProfileId
    }
    deps.sessions.detachProfile(id)
    const saved = deps.config.update(next)
    deps.onSettingsChanged?.()
    return saved
  })
  ipcMain.handle(IPC.profilesTest, async (_event, value: unknown) => {
    const profile = ProfileSchema.parse(value)
    return await deps.ssh.testProfile(profile)
  })
  ipcMain.handle(IPC.profilesImportSshConfig, async () => {
    const entries = await deps.ssh.importSshConfig()
    return deps.config.importSshConfigEntries(entries)
  })
  ipcMain.handle(IPC.profilesGetSshConfig, async () => await deps.ssh.getSshConfig())
  ipcMain.handle(IPC.profilesSaveSshConfig, async (_event, value: unknown) => {
    return await deps.ssh.saveSshConfig(SshConfigContentSchema.parse(value))
  })
  ipcMain.handle(IPC.profilesRevealSshConfig, () => {
    shell.showItemInFolder(deps.ssh.sshConfigPath())
  })
  ipcMain.handle(IPC.sessionsList, (_event, value: unknown) => deps.sessions.list(profileId(value)))
  ipcMain.handle(IPC.sessionsAttach, (_event, value: unknown) =>
    deps.sessions.attach(AttachSessionRequestSchema.parse(value))
  )
  ipcMain.handle(IPC.sessionsDetach, (_event, value: unknown) => {
    deps.sessions.detach(SessionTargetSchema.parse(value))
  })
  ipcMain.handle(IPC.sessionsCreate, (_event, value: unknown) =>
    deps.sessions.create(CreateSessionRequestSchema.parse(value))
  )
  ipcMain.handle(IPC.sessionsRename, (_event, value: unknown) =>
    deps.sessions.rename(RenameSessionRequestSchema.parse(value))
  )
  ipcMain.handle(IPC.sessionsTerminate, (_event, value: unknown, confirmation: unknown) =>
    deps.sessions.terminate(SessionTargetSchema.parse(value), String(confirmation))
  )
  ipcMain.handle(IPC.promptsSend, async (_event, value: unknown) => {
    const request = SendPromptRequestSchema.parse(value)
    const target = { profileId: request.profileId, sessionName: request.sessionName }
    if (!deps.sessions.isAttached(target)) throw new Error('Claude session is not connected')
    if (deps.sessions.isReadOnly(target))
      throw new Error('This session is attached in read-only mode')
    const maximum = deps.config.get().composer.maxCharacters
    if (request.text.length > maximum)
      throw new Error(`Message exceeds the ${maximum} character limit`)
    const encoded = encodePromptForTerminal(request.text)
    if (!encoded.sanitized.text.trim())
      throw new Error('Message is empty after control-character filtering')
    await deps.sessions.sendPrompt(target, encoded.sequence)
    if (encoded.sanitized.removedControlCharacters > 0) {
      deps.emit({
        type: 'notification',
        level: 'warning',
        title: t('main.controlsRemoved'),
        body: t('main.controlsRemovedBody', {
          count: encoded.sanitized.removedControlCharacters
        })
      })
    }
    return { accepted: true as const, requestId: request.requestId }
  })
  ipcMain.handle(IPC.commandsRun, async (_event, value: unknown) => {
    const request = SendPromptRequestSchema.parse({
      ...(value as object),
      requestId: randomUUID()
    })
    if (!deps.sessions.isAttached(request) || deps.sessions.isReadOnly(request))
      throw new Error('A writable remote Claude session is required')
    if (changesConversation(parseClaudeCommand(request.text) ?? '')) {
      const profile = deps.config.profile(request.profileId)
      const status = await deps.helper.status(profile)
      if (!status.installed) await deps.helper.install(profile)
    }
    return deps.sessions.runCommand(request, request.text)
  })
  ipcMain.handle(IPC.commandsFinish, (_event, value: unknown) =>
    deps.sessions.finishCommand(SessionTargetSchema.parse(value))
  )
  ipcMain.handle(IPC.promptsInterrupt, (_event, value: unknown) =>
    deps.sessions.interruptPrompt(SessionTargetSchema.parse(value))
  )
  ipcMain.handle(IPC.terminalResize, (_event, value: unknown) => {
    const request = ResizeTerminalRequestSchema.parse(value)
    deps.ptys.resize(request, request.cols, request.rows)
  })
  ipcMain.handle(IPC.terminalWriteControl, (_event, value: unknown) => {
    const request = WriteControlRequestSchema.parse(value)
    if (deps.sessions.isReadOnly(request)) throw new Error('This session is read-only')
    deps.ptys.write(request, TERMINAL_CONTROL_SEQUENCES[request.control])
    deps.sessions.refreshAfterInput(request, TERMINAL_CONTROL_SEQUENCES[request.control])
  })
  ipcMain.handle(IPC.terminalWriteInput, (_event, value: unknown) => {
    const request = WriteTerminalInputRequestSchema.parse(value)
    if (deps.sessions.isReadOnly(request)) throw new Error('This session is read-only')
    if (!deps.sessions.isAttached(request)) throw new Error('Claude session is not connected')
    deps.ptys.write(request, request.data)
    deps.sessions.refreshAfterInput(request, request.data)
  })
  ipcMain.handle(IPC.uploadsImage, async (_event, value: unknown, dataUrl: unknown) => {
    const target = SessionTargetSchema.parse(value)
    if (deps.sessions.isReadOnly(target)) throw new Error('This session is read-only')
    if (!deps.sessions.isAttached(target)) throw new Error('Claude session is not connected')
    return deps.uploads.uploadImage(
      deps.config.profile(target.profileId),
      target,
      deps.config.get().language,
      dataUrl
    )
  })
  ipcMain.handle(IPC.uploadsChooseAndUpload, async (_event, value: unknown) => {
    const target = SessionTargetSchema.parse(value)
    return await deps.uploads.chooseAndUpload(
      deps.config.profile(target.profileId),
      target,
      deps.config.get().language
    )
  })
  ipcMain.handle(IPC.helperStatus, (_event, value: unknown) => {
    const id = profileId(value)
    return deps.helper.status(deps.config.profile(id))
  })
  ipcMain.handle(IPC.helperInstall, (_event, value: unknown) => {
    const id = profileId(value)
    return deps.helper.install(deps.config.profile(id))
  })
  ipcMain.handle(IPC.diagnosticsRun, (_event, value: unknown) => {
    const id = profileId(value)
    return deps.diagnostics.run(deps.config.profile(id))
  })
  ipcMain.handle(IPC.diagnosticsExport, async (_event, value: unknown) => {
    const id = profileId(value)
    const report = deps.diagnostics.latest(deps.config.profile(id))
    if (!report) throw new Error(t('diagnostics.runFirst'))
    const result = await dialog.showSaveDialog(deps.window()!, {
      title: t('main.exportDiagnostics'),
      defaultPath: `claude-local-bridge-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }

    const contents = `${JSON.stringify(redactDiagnosticReport(report), null, 2)}\n`
    try {
      await writeFile(result.filePath, contents, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException
      if (fileError.code !== 'EEXIST') throw error
      const overwrite = await dialog.showMessageBox(deps.window()!, {
        type: 'warning',
        buttons: [t('common.cancel'), t('main.overwrite')],
        defaultId: 0,
        cancelId: 0,
        message: t('main.fileExists'),
        detail: result.filePath
      })
      if (overwrite.response !== 1) return { canceled: true }
      await writeFile(result.filePath, contents, 'utf8')
    }
    return { canceled: false, path: result.filePath }
  })
  ipcMain.handle(IPC.appOpenExternal, async (_event, value: unknown) => {
    const url = new URL(String(value))
    if (!['https:', 'http:'].includes(url.protocol))
      throw new Error('Only HTTP(S) links may be opened')
    if (deps.config.get().confirmExternalLinks) {
      const owner = deps.window()
      const result = await dialog.showMessageBox(owner!, {
        type: 'question',
        buttons: [t('common.cancel'), t('main.open')],
        defaultId: 0,
        cancelId: 0,
        title: t('main.openExternalTitle'),
        message: t('main.openExternalBody', { host: url.hostname }),
        detail: url.toString()
      })
      if (result.response !== 1) return false
    }
    await shell.openExternal(url.toString())
    return true
  })
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())
}
