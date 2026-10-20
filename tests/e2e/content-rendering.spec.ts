import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { IPC } from '../../src/shared/ipc'
import type { SessionTarget, TimelineEvent } from '../../src/shared/contracts'
import { useOfflineSessionList } from './offline-shell'
import { bundledHelperVersion } from './runtime-target'

const root = resolve(import.meta.dirname, '..', '..')
const evidence = resolve(root, 'playwright-report', 'content-rendering')
const executablePath = process.env.CLB_RENDERING_EXECUTABLE
const launch = (userData: string) =>
  electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: userData }
  })

test('loads actual installed fonts, filters them, and preserves all selections after restart', async () => {
  test.setTimeout(90000)
  await mkdir(evidence, { recursive: true })
  const userData = resolve(root, 'test-results', `local-fonts-${Date.now()}`)
  const app = await launch(userData)
  let families: string[]
  let selected: string
  try {
    const page = await app.firstWindow()
    await useOfflineSessionList(app)
    await page.reload()
    families = await page.evaluate(() => window.claudeBridge.app.listFonts())
    expect(families.length).toBeGreaterThan(30)
    expect(families).toContain('Consolas')
    expect(families.some((name) => /[\u4e00-\u9fff]/.test(name))).toBe(true)
    selected = families.includes('宋体') ? '宋体' : families[0]!
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.locator('.settings-modal')
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    const uiFont = dialog.getByRole('combobox', { name: '界面字体', exact: true })
    await uiFont.click()
    await uiFont.fill(selected)
    await dialog.locator(`.font-option[data-value="local:${selected}"]`).click()
    const replyFont = dialog.getByRole('combobox', { name: '回复字体', exact: true })
    await replyFont.click()
    await replyFont.fill(selected)
    await dialog.locator(`.font-option[data-value="local:${selected}"]`).click()
    await page.screenshot({ path: resolve(evidence, 'installed-fonts.png') })
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    const terminalFont = dialog.getByRole('combobox', { name: '终端字体', exact: true })
    await terminalFont.click()
    await terminalFont.fill('Consolas')
    await dialog.locator('.font-option[data-value="local:Consolas"]').click()
    await dialog
      .locator('.settings-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('html')).toHaveAttribute('data-interface-font', `local:${selected}`)
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--reply-font-family')
      )
    ).toContain(selected)
  } finally {
    await app.close()
  }
  const reopened = await launch(userData)
  try {
    const page = await reopened.firstWindow()
    await useOfflineSessionList(reopened)
    const saved = await page.evaluate(() => window.claudeBridge.settings.get())
    expect(saved).toMatchObject({
      interfaceFont: `local:${selected}`,
      replyFont: `local:${selected}`,
      terminal: { font: 'local:Consolas' }
    })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '外观', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '界面字体', exact: true })).toHaveValue(
      selected
    )
    await writeFile(
      resolve(evidence, 'font-verification.json'),
      JSON.stringify(
        {
          installedFamilyNames: families.length,
          selected,
          terminal: saved.terminal.font,
          restart: 'passed',
          executable: executablePath ?? 'development'
        },
        null,
        2
      )
    )
  } finally {
    await reopened.close()
  }
})

const code = `const greeting = "你好，Codex";\nconsole.log(greeting);\n// ${'long source line '.repeat(20)}`
const richText = [
  '## 渲染检查',
  '回复正文采用清晰的层级与紧凑间距。支持 **重点**、`行内代码`，以及 [远端文件](src/main.ts:42)。',
  '```typescript\n' + code + '\n```',
  '- [x] 代码高亮与复制\n- [x] 本机字体搜索\n- [ ] 检查下一步改动',
  '| 内容 | 显示方式 |\n| :--- | ---: |\n| 表格 | 横向滚动 |\n| 代码 | 保留缩进 |',
  '> 执行过程可以展开查看，回复正文保持简洁。',
  '公式：$E = mc^2$。',
  '```mermaid\nflowchart LR\n A[读取输入] --> B[渲染内容]\n B --> C[显示结果]\n```',
  '```mermaid\nthis is not a valid diagram\n```'
].join('\n\n')

async function installTranscript(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain, BrowserWindow }, { channels, text, helperVersion }) => {
      const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (_event, ...args) => fn(...args))
      }
      handle(channels.sessionsList, () => [
        {
          name: 'claude-rendering',
          windows: 1,
          attachedClients: 0,
          currentPath: '/srv/project',
          isClaude: true
        }
      ])
      handle(channels.helperStatus, () => ({ installed: true, version: helperVersion }))
      for (const channel of [
        channels.terminalResize,
        channels.terminalWriteControl,
        channels.sessionsDetach
      ])
        handle(channel, () => undefined)
      handle(channels.sessionsAttach, (value) => {
        const target = value as SessionTarget
        const send = (event: unknown): void =>
          BrowserWindow.getAllWindows()[0]!.webContents.send(channels.event, event)
        const status = {
          ...target,
          state: 'attached',
          promptState: 'ready',
          readOnly: false,
          attempt: 0,
          changedAt: Date.now()
        }
        send({ type: 'session-status', status })
        const events: TimelineEvent[] = [
          { id: 'user', kind: 'user', text: '检查这段 **原始输入**，并展示代码、表格和图表。' },
          {
            id: 'read',
            kind: 'tool-use',
            toolName: 'Read',
            toolInput: { file_path: 'src/main.ts' }
          },
          { id: 'assistant', kind: 'assistant', isFinal: true, text }
        ]
        for (const event of events) send({ type: 'timeline-event', target, event })
        return status
      })
    },
    { channels: IPC, text: richText, helperVersion: bundledHelperVersion }
  )
}

test('renders readable code, tables, math and diagrams in light, dark and narrow layouts', async () => {
  test.setTimeout(90000)
  await mkdir(evidence, { recursive: true })
  const app = await launch(resolve(root, 'test-results', `content-rendering-${Date.now()}`))
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await useOfflineSessionList(app)
    await installTranscript(app)
    await page.reload()
    await page.setViewportSize({ width: 1440, height: 980 })
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-rendering' }).click()
    const content = page.locator('.codex-content')
    await expect(content.locator('.assistant h2')).toHaveText('渲染检查')
    await expect(content.locator('.user strong')).toHaveCount(0)
    await expect(content.locator('.hljs-keyword').first()).toHaveText('const')
    await expect(content.locator('.katex')).toHaveCount(1)
    const diagram = content.getByRole('img', { name: 'Mermaid 图表' })
    await expect(diagram).toBeVisible({ timeout: 20000 })
    await expect
      .poll(() =>
        diagram.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
      )
      .toBe(true)
    await expect(content.locator('.diagram-notice')).toContainText('源码已保留')
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            document.documentElement.dataset.testCopied = text
          }
        }
      })
    })
    const firstCode = content.locator('.code-block').first()
    await firstCode.getByRole('button', { name: '复制代码' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-test-copied', code)
    await expect(firstCode.locator('pre')).toHaveCSS('white-space', 'pre')
    await firstCode.getByRole('button', { name: '代码折行' }).click()
    await expect(firstCode.locator('pre')).toHaveCSS('white-space', 'pre-wrap')
    await firstCode.getByRole('button', { name: '代码折行' }).click()
    await content.locator('.timeline').evaluate((element) => {
      element.scrollTop = 0
    })
    await page.screenshot({ path: resolve(evidence, 'transcript-light.png') })
    await diagram.scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(evidence, 'diagrams-light.png') })
    const oldDiagram = await diagram.getAttribute('src')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.locator('.settings-modal')
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await dialog.getByRole('button', { name: '深色', exact: true }).click()
    await dialog
      .locator('.settings-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(diagram).not.toHaveAttribute('src', oldDiagram!)
    await diagram.scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(evidence, 'diagrams-dark.png') })
    const diagramBlock = content.locator('.diagram-block').first()
    await diagramBlock.getByRole('button', { name: '源码', exact: true }).click()
    await expect(diagramBlock.locator('pre')).toContainText('flowchart LR')
    await diagramBlock.getByRole('button', { name: '图表', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setMinimumSize(500, 500)
      window.setSize(680, 800)
    })
    await page.setViewportSize({ width: 680, height: 800 })
    await content.locator('.timeline').evaluate((element) => {
      element.scrollTop = 0
    })
    await expect
      .poll(() => content.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true)
    expect(
      await content
        .locator('.timeline-inner')
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true)
    await page.screenshot({ path: resolve(evidence, 'transcript-narrow-dark.png') })
    expect(errors).toEqual([])
    await writeFile(
      resolve(evidence, 'rendering-verification.json'),
      JSON.stringify(
        {
          codeCopy: 'passed',
          codeWrap: 'passed',
          math: 'passed',
          mermaid: 'passed',
          invalidDiagramFallback: 'passed',
          theme: 'passed',
          narrowOverflow: 'passed',
          errors,
          executable: executablePath ?? 'development'
        },
        null,
        2
      )
    )
  } finally {
    await app.close()
  }
})
