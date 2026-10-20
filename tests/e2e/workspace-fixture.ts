import { type ElectronApplication } from '@playwright/test'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { bundledHelperVersion } from './runtime-target'
import { IPC } from '../../src/shared/ipc'
import type {
  AppSettings,
  SessionTarget,
  SessionStatus,
  TimelineEvent,
  WriteControlRequest,
  ClaudePermissionMode,
  WriteTerminalInputRequest
} from '../../src/shared/contracts'

type TestCommand = {
  type: string
  target?: SessionTarget
  status?: Partial<SessionStatus>
  event?: TimelineEvent
}
type TestGlobal = typeof globalThis & { bridgeUxCommand: (command: TestCommand) => unknown }
export async function command(app: ElectronApplication, value: TestCommand): Promise<unknown> {
  return app.evaluate((_electron, next) => (globalThis as TestGlobal).bridgeUxCommand(next), value)
}

export async function fixture(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain, BrowserWindow }, { channels, defaults, helperVersion }) => {
      let settings: AppSettings = {
        ...defaults,
        conversation: { ...defaults.conversation, autoScroll: true },
        profiles: [
          defaults.profiles[0]!,
          {
            ...defaults.profiles[0]!,
            id: 'exp',
            label: 'EXP · Experiments',
            host: 'exp',
            sshHost: 'exp',
            defaultCwd: '/srv/Experiments'
          }
        ]
      }
      const calls: { channel: string; request: unknown }[] = []
      const sessions: Record<string, string[]> = {
        mas: ['claude-review', 'claude-check'],
        exp: ['claude-review']
      }
      let finishSend: (() => void) | undefined
      let finishUpload: (() => void) | undefined
      let terminateError = false
      const permissionModes: Record<string, ClaudePermissionMode> = {}
      const emit = (event: unknown): void => {
        BrowserWindow.getAllWindows()[0]!.webContents.send(channels.event, event)
      }
      const status = (
        target: SessionTarget,
        extra: Partial<SessionStatus> = {}
      ): SessionStatus => ({
        ...target,
        state: 'attached',
        readOnly: false,
        promptState: 'ready',
        attempt: 0,
        changedAt: Date.now(),
        permissionMode: permissionModes[`${target.profileId}:${target.sessionName}`] ?? 'default',
        ...extra
      })
      function handle<T = undefined>(channel: string, fn: (request: T) => unknown): void {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (_event, request) => {
          calls.push({ channel, request })
          return fn(request)
        })
      }
      handle(channels.settingsGet, () => settings)
      handle(channels.settingsUpdate, (next: AppSettings) => {
        settings = next
        return next
      })
      handle(channels.profilesRemove, (id: string) => {
        const profiles = settings.profiles.filter((profile) => profile.id !== id)
        settings = {
          ...settings,
          profiles,
          currentProfileId:
            settings.currentProfileId === id ? (profiles[0]?.id ?? '') : settings.currentProfileId
        }
        return settings
      })
      handle(channels.helperStatus, () => ({ installed: true, version: helperVersion }))
      handle(channels.sessionsList, (id: string) =>
        (sessions[id] ?? []).map((name) => ({
          name,
          windows: 1,
          attachedClients: 2,
          currentPath: settings.profiles.find((p) => p.id === id)!.defaultCwd,
          isClaude: true
        }))
      )
      handle(channels.sessionsAttach, (request: SessionTarget & { readOnly: boolean }) => {
        const attached = status(request, { readOnly: request.readOnly })
        emit({ type: 'session-status', status: attached })
        emit({
          type: 'timeline-event',
          target: request,
          event: {
            id: 'request',
            kind: 'user',
            text: '检查回测结果，并说明异常来自哪里。',
            timestamp: '2026-10-04T08:00:00Z'
          }
        })
        emit({
          type: 'timeline-event',
          target: request,
          event: {
            id: 'tool',
            kind: 'tool-use',
            toolName: 'Read',
            toolInput: { file: 'reports/backtest.csv' }
          }
        })
        emit({
          type: 'timeline-event',
          target: request,
          event: {
            id: 'reply',
            kind: 'assistant',
            isFinal: true,
            text: '## 回测结果检查\n\n已检查最近一轮回测记录。收益波动集中在高换手区间，建议先核对手续费假设。\n\n| 检查项 | 结果 |\n| --- | --- |\n| 数据覆盖 | 完整 |\n| 时间对齐 | 通过 |\n| 交易成本 | 需要复核 |\n\n下一步可以对比两组成本参数，并查看差异最大的交易日。',
            timestamp: '2026-10-04T08:00:15Z'
          }
        })
        emit({
          type: 'pty-data',
          target: request,
          data: '\r\nClaude Code · isolated UI fixture\r\n❯ Ready for input\r\n'
        })
        return attached
      })
      handle(channels.sessionsDetach, (target: SessionTarget) => {
        emit({ type: 'session-status', status: status(target, { state: 'detached' }) })
      })
      handle(channels.sessionsCreate, (target: SessionTarget & { cwd: string }) => {
        sessions[target.profileId]!.push(target.sessionName)
        return { name: target.sessionName, windows: 1, attachedClients: 0, currentPath: target.cwd }
      })
      handle(channels.sessionsTerminate, (request: SessionTarget) => {
        if (terminateError) throw new Error('Offline fixture: server unavailable')
        sessions[request.profileId] = sessions[request.profileId]!.filter(
          (name) => name !== request.sessionName
        )
        emit({ type: 'session-status', status: status(request, { state: 'detached' }) })
      })
      handle(
        channels.promptsSend,
        () =>
          new Promise((done) => {
            finishSend = () => done({ accepted: true })
          })
      )
      handle(channels.promptsInterrupt, (target: SessionTarget) => {
        emit({ type: 'session-status', status: status(target, { generating: false }) })
      })
      handle(
        channels.uploadsChooseAndUpload,
        (target: SessionTarget) =>
          new Promise((done) => {
            emit({
              type: 'upload-progress',
              target,
              progress: {
                filename: '回测报告.csv',
                bytes: 1024,
                startedAt: Date.now(),
                stage: 'transferring'
              }
            })
            finishUpload = () => done({ canceled: false, remotePath: '/srv/uploads/回测报告.csv' })
          })
      )
      const switchMode = (target: SessionTarget): void => {
        const key = `${target.profileId}:${target.sessionName}`
        const modes: ClaudePermissionMode[] = ['default', 'acceptEdits', 'plan']
        permissionModes[key] =
          modes[(modes.indexOf(permissionModes[key] ?? 'default') + 1) % modes.length]!
        emit({ type: 'session-status', status: status(target) })
      }
      handle(channels.terminalWriteControl, (request: WriteControlRequest) => {
        if (request.control === 'shiftTab') switchMode(request)
      })
      handle(channels.terminalWriteInput, (request: WriteTerminalInputRequest) => {
        if (request.data === '\u001b[Z') switchMode(request)
      })
      for (const channel of [channels.terminalResize]) handle(channel, () => undefined)
      ;(globalThis as TestGlobal).bridgeUxCommand = (next) => {
        if (next.type === 'calls') return calls
        if (next.type === 'terminate-error') terminateError = true
        if (next.type === 'terminate-ok') terminateError = false
        if (next.type === 'send-done') finishSend?.()
        if (next.type === 'upload-done') finishUpload?.()
        if (next.type === 'status' && next.target)
          emit({ type: 'session-status', status: status(next.target, next.status) })
        if (next.type === 'event' && next.target && next.event)
          emit({ type: 'timeline-event', target: next.target, event: next.event })
      }
    },
    { channels: IPC, defaults: DEFAULT_SETTINGS, helperVersion: bundledHelperVersion }
  )
}
