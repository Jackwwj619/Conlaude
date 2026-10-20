import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import type { BridgeEvent, ClaudeBridgeApi, SessionTarget } from '../../src/shared/contracts'
import { useWorkspacePreferences } from '../../src/renderer/src/workspace-preferences'
import { useLayoutPreferences } from '../../src/renderer/src/layout-preferences'

// Real App and CSS, in an isolated headless browser. All remote/native APIs are fixtures.
const profile = {
  ...DEFAULT_SETTINGS.profiles[0]!,
  id: 'fixture',
  label: '文件工作区',
  host: 'fixture.invalid',
  sshHost: 'fixture.invalid',
  defaultCwd: '/workspace'
}
let settings = {
  ...structuredClone(DEFAULT_SETTINGS),
  profiles: [profile],
  currentProfileId: profile.id
}
const listeners = new Set<(event: BridgeEvent) => void>()
const emit = (event: BridgeEvent): void => {
  listeners.forEach((listener) => listener(event))
}
const target: SessionTarget = { profileId: profile.id, sessionName: 'file-review' }
const contents = new Map<string, string>([
  [
    '/workspace/notes.md',
    '# 文件栏重做\n\n目录浏览与文件编辑各自保留状态。\n\n## 本轮修改\n\n- 文件名只出现在顶部标签\n- 独立目录入口，完整宽度浏览\n- 下载、复制路径、重新读取\n\n| 操作 | 行为 |\n| --- | --- |\n| 切换标签 | 保留草稿 |\n| 浏览目录 | 保留位置 |\n| 关闭后台标签 | 当前文件不变 |'
  ],
  ['/workspace/docs/guide.md', '# 使用说明\n\n可切换到编辑视图。'],
  ['/workspace/example-with-a-very-long-name.ts', 'export const ready = true\n']
])
const names = [
  'docs/',
  'notes.md',
  'example-with-a-very-long-name.ts',
  'archive.zip',
  '.env.example'
]
const calls: unknown[] = []
const api = {
  settings: {
    get: async () => settings,
    update: async (next: typeof settings) => (settings = structuredClone(next))
  },
  sessions: {
    list: async () => [
      {
        name: target.sessionName,
        windows: 1,
        attachedClients: 0,
        currentPath: '/workspace',
        isClaude: true
      }
    ],
    attach: async () => {
      const status = {
        ...target,
        state: 'attached' as const,
        readOnly: false,
        promptState: 'ready' as const,
        attempt: 0,
        changedAt: Date.now()
      }
      emit({ type: 'session-status', status })
      emit({
        type: 'timeline-event',
        target,
        event: {
          id: 'fixture-reply',
          kind: 'assistant',
          isFinal: true,
          text: '可以查看 [notes.md](/workspace/notes.md)、[guide.md](/workspace/docs/guide.md) 和 [source](/workspace/example-with-a-very-long-name.ts)。'
        }
      })
      return status
    },
    detach: async () => undefined
  },
  helper: { status: async () => ({ installed: true, version: '1.4.1' }) },
  events: {
    subscribe: (listener: (event: BridgeEvent) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  },
  terminal: {
    resize: async () => undefined,
    writeControl: async () => undefined,
    writeInput: async () => undefined
  },
  app: { getVersion: async () => 'fixture', listFonts: async () => [] },
  files: {
    list: async (request: { path: string }) => {
      calls.push({ operation: 'list', ...request })
      const path = request.path.replace(/\/$/, '') || '/'
      if (path === '/missing') throw new Error('NOT_FOUND')
      return {
        path,
        parent: path.split('/').slice(0, -1).join('/') || '/',
        truncated: false,
        entries: (path === '/workspace/docs' ? ['guide.md'] : names).map((name) => ({
          name: name.replace(/\/$/, ''),
          path: `${path}/${name.replace(/\/$/, '')}`,
          kind: name.endsWith('/') ? 'directory' : 'file',
          size: name.endsWith('/') ? 0 : 4096,
          modified: 1792010100000
        }))
      }
    },
    read: async (request: { path: string }) => {
      calls.push({ operation: 'read', ...request })
      if (request.path.endsWith('.zip')) throw new Error('NOT_TEXT')
      return {
        path: request.path,
        content: contents.get(request.path) ?? 'Example text',
        writable: true,
        version: 'a'.repeat(64),
        lineEnding: 'LF'
      }
    },
    save: async (request: { path: string; content: string }) => {
      calls.push({ operation: 'save', ...request })
      contents.set(request.path, request.content)
      return { ...request, version: 'b'.repeat(64), writable: true, lineEnding: 'LF' }
    },
    download: async (request: { path: string }) => {
      calls.push({ operation: 'download', ...request })
      return { canceled: false, path: `C:/fixture/${request.path.split('/').at(-1)}` }
    }
  }
}
window.claudeBridge = api as unknown as ClaudeBridgeApi
window.bridgeWindow = { execute: async () => undefined }
Object.assign(window, { fileFixtureCalls: calls })
useWorkspacePreferences.getState().remember(profile, target.sessionName, '/workspace')
useLayoutPreferences.getState().update({ filesWidth: 480 })
void import('../../src/renderer/src/main')
