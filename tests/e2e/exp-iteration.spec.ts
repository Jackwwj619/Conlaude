import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { bundledHelperVersion } from './runtime-target'

// Explicit opt-in: this test creates a real Claude session and sends one small prompt.
test('exp: workspace, alias launch, reply, upload and reconnect', async () => {
  test.skip(
    process.env.CLB_TEST_SSH_HOST !== 'exp',
    'Set CLB_TEST_SSH_HOST=exp to run against the designated test server'
  )
  test.setTimeout(240000)
  const root = resolve(import.meta.dirname, '../..')
  const name = `bridge-iteration-${Date.now()}`
  // Keep review artifacts outside Playwright's output directory, which it clears on each run.
  const artifactDir = resolve(root, 'playwright-report', name)
  const userData = resolve(artifactDir, 'user-data')
  const ssh = (command: string): string =>
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'exp', command], {
      encoding: 'utf8',
      timeout: 20000
    }).trim()
  const home = ssh('printf \'%s\' "$HOME"')
  const cwd = `${home}/.cache/claude-local-bridge-tests/${name}`
  if (!/^\/[A-Za-z0-9_./-]+$/.test(cwd)) throw new Error('Unexpected test directory')
  ssh(`mkdir -p '${cwd}'`)
  await mkdir(userData, { recursive: true })
  const profile = {
    ...DEFAULT_SETTINGS.profiles[0]!,
    id: 'exp',
    label: 'EXP · 测试服务器',
    sshHost: 'exp',
    host: 'exp',
    claudePath: 'cc',
    defaultCwd: cwd,
    defaultSession: name
  }
  await writeFile(
    resolve(userData, 'config.json'),
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      profiles: [profile, { ...profile, id: 'exp-second', label: 'EXP · 第二工作区' }],
      currentProfileId: 'exp'
    })
  )
  const app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: userData }
  })
  const page = await app.firstWindow()
  const rendererErrors: string[] = []
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  const screenshot = async (label: string): Promise<void> => {
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined))
      )
    )
    await page.screenshot({ path: resolve(artifactDir, `${label}.png`) })
  }
  try {
    await expect(page.locator('.server-library')).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 960))
    await screenshot('server-library')
    await page.getByRole('button', { name: '添加服务器', exact: true }).first().click()
    const serverEditor = page.getByRole('dialog', { name: '添加服务器' })
    await serverEditor.getByLabel('服务器名称', { exact: true }).fill('EXP · 新增服务器')
    await serverEditor.getByLabel('OpenSSH Host', { exact: true }).fill('exp')
    await screenshot('server-editor')
    await serverEditor.getByRole('button', { name: '保存服务器' }).click()
    await expect(page.locator('.server-card')).toHaveCount(3)
    await page.getByRole('button', { name: '列表视图' }).click()
    await expect(page.locator('.server-cards')).toHaveClass(/list/)
    await screenshot('server-list')
    await page.getByRole('button', { name: '卡片视图' }).click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const modal = page.getByRole('dialog', { name: '设置', exact: true })
    for (let index = 0; index < 20; index++) {
      await page.keyboard.press('Tab')
      expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused()

    await page
      .locator('.server-card')
      .filter({ hasText: profile.label })
      .getByRole('button', { name: '查看会话', exact: true })
      .click()
    await expect(page.locator('.workspace-frame')).toBeVisible({ timeout: 20000 })

    const installed = await page.evaluate(() => window.claudeBridge.helper.install('exp'))
    expect(installed.version).toBe(bundledHelperVersion)
    const diagnostics = await page.evaluate(() => window.claudeBridge.diagnostics.run('exp'))
    expect(diagnostics.checks.find((check) => check.id === 'remote-tools')?.status).toBe('ok')

    await page.locator('.new-session-button').click()
    const create = page.getByRole('dialog', { name: '新建 Claude 会话' })
    await create.locator('summary').click()
    await create.getByLabel('tmux 会话名', { exact: true }).fill(name)
    await create.getByLabel('远程工作目录', { exact: true }).fill(cwd)
    await create.getByRole('button', { name: '创建并连接' }).click()
    await expect(create).toBeHidden({ timeout: 30000 })
    await expect(page.locator('.connection-label.attached')).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: '终端视图', exact: true }).click()
    await expect
      .poll(() => ssh(`tmux capture-pane -p -t '${name}'`), { timeout: 25000 })
      .toMatch(/Claude Code|trust this folder|trust the files/)
    const initialScreen = ssh(`tmux capture-pane -p -t '${name}'`)
    await writeFile(resolve(artifactDir, 'initial-terminal.txt'), initialScreen)
    if (/trust this folder|trust the files/.test(initialScreen)) {
      await expect(page.locator('.workspace-notice')).toContainText('Claude 正在等待确认', {
        timeout: 20000
      })
      await page.getByRole('button', { name: '对话', exact: true }).click()
      const blockedDraft = '这条消息应保留，不得确认退出'
      await page.locator('.cm-content').click()
      await page.keyboard.insertText(blockedDraft)
      await expect(page.locator('.send-button')).toBeDisabled()
      await page.keyboard.press('Control+Enter')
      await expect(page.locator('.cm-content')).toContainText(blockedDraft)
      const rejection = await page.evaluate(async (sessionName) => {
        try {
          await window.claudeBridge.prompts.send({
            profileId: 'exp',
            sessionName,
            requestId: crypto.randomUUID(),
            text: 'must not confirm exit'
          })
          return ''
        } catch (error) {
          return String(error)
        }
      }, name)
      expect(rejection).toContain('Claude 正在等待确认')
      expect(ssh(`tmux capture-pane -p -t '${name}'`)).toContain('I trust this folder')
      await screenshot('confirmation-protected')
      await page.getByRole('button', { name: '查看终端', exact: true }).click()
      if (/❯ No, exit/.test(initialScreen)) {
        await page.evaluate(
          (sessionName) =>
            window.claudeBridge.terminal.writeControl({
              profileId: 'exp',
              sessionName,
              control: 'arrowDown'
            }),
          name
        )
      }
      await page.evaluate(
        (sessionName) =>
          window.claudeBridge.terminal.writeControl({
            profileId: 'exp',
            sessionName,
            control: 'enter'
          }),
        name
      )
    }
    await screenshot('terminal-start')
    await expect
      .poll(() => ssh(`tmux capture-pane -p -t '${name}'`), { timeout: 30000 })
      .toMatch(/bypass permissions|manual mode|for agents|for shortcuts|What can I help|Try "/)

    await page.getByRole('button', { name: '对话', exact: true }).click()
    const marker = `BRIDGE_EXP_OK_${name.split('-').at(-1)}`
    await page.evaluate(() => {
      Object.assign(window, { generationStates: [] })
      window.claudeBridge.events.subscribe((event) => {
        if (event.type === 'session-status')
          (window as unknown as { generationStates: unknown[] }).generationStates.push(event.status)
      })
    })
    const editor = page.locator('.cm-content')
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText(
      `请列出 50 条桌面软件界面可用性检查点，每条至少 20 个汉字，按数字编号逐行输出。最后单独一行回复 ${marker}。不要调用任何工具。`
    )
    await expect(page.locator('.send-button')).toBeEnabled({ timeout: 20000 })
    await page.keyboard.press('Control+Enter')
    let sample = 0
    await expect
      .poll(
        async () => {
          const screen = ssh(`tmux capture-pane -p -t '${name}'`)
          await writeFile(resolve(artifactDir, 'generation-terminal.txt'), screen)
          await writeFile(resolve(artifactDir, `generation-screen-${sample++}.txt`), screen)
          return page.evaluate(() =>
            (
              window as unknown as { generationStates: { generating?: boolean }[] }
            ).generationStates.some((s) => s.generating)
          )
        },
        { timeout: 60000 }
      )
      .toBe(true)
    await expect(page.locator('.message.assistant')).toContainText(marker, { timeout: 90000 })
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as { generationStates: { generating?: boolean }[] }
              ).generationStates.at(-1)?.generating
          ),
        { timeout: 15000 }
      )
      .toBe(false)
    await writeFile(
      resolve(artifactDir, 'generation-states.json'),
      JSON.stringify(
        await page.evaluate(
          () => (window as unknown as { generationStates: unknown[] }).generationStates
        ),
        null,
        2
      )
    )
    await screenshot('conversation')

    await editor.click()
    await page.keyboard.insertText('这个草稿只属于第一台服务器')
    await page.locator('.project-heading[title^="EXP · 第二工作区"]').click()
    await expect(editor).not.toContainText('这个草稿只属于第一台服务器')
    await screenshot('project-navigation')
    await page.locator('.project-heading[title^="EXP · 测试服务器"]').click()
    await expect(editor).toContainText('这个草稿只属于第一台服务器')
    await expect(page.locator('.timeline-shell')).toHaveCount(1)
    await expect(page.locator('.cm-editor')).toHaveCount(1)
    await expect(page.locator('.connection-label.attached')).toBeVisible()
    await expect(page.locator('.message.assistant')).toContainText(marker)

    const blocked = await page.evaluate(async () => {
      const settings = await window.claudeBridge.settings.get()
      try {
        await window.claudeBridge.settings.update({
          ...settings,
          profiles: settings.profiles.map((p) =>
            p.id === 'exp' ? { ...p, sshHost: 'wrong-host' } : p
          )
        })
        return false
      } catch {
        return true
      }
    })
    expect(blocked).toBe(true)
    await page.getByLabel('搜索项目或会话…', { exact: true }).fill('no-matching-session')
    await expect(page.locator('.session-row')).toHaveCount(0)
    await page.getByLabel('搜索项目或会话…', { exact: true }).fill(name)
    await expect(page.locator('.session-row').first()).toBeVisible()
    await page.getByLabel('搜索项目或会话…', { exact: true }).fill('')

    await page.getByRole('button', { name: '分屏', exact: true }).click()
    const chatBox = await page.locator('.conversation-area').boundingBox()
    const terminalBox = await page.locator('.terminal-drawer').boundingBox()
    expect(chatBox && terminalBox && chatBox.x + chatBox.width <= terminalBox.x + 1).toBeTruthy()
    await screenshot('split')
    await page.getByRole('button', { name: '切换到深色主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await screenshot('split-dark')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1000, 700))
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.getByRole('button', { name: '终端视图', exact: true }).click()
    await expect(page.locator('.conversation-area')).toBeHidden()
    expect(
      await page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().x)
    ).toBe(0)
    expect(
      await page.locator('#root').evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true)
    await screenshot('compact-terminal')

    const uploadPath = resolve(artifactDir, '测试附件.txt')
    await writeFile(uploadPath, 'EXP upload verification 你好\n')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, uploadPath)
    const upload = await page.evaluate(
      (sessionName) =>
        window.claudeBridge.uploads.chooseAndUpload({ profileId: 'exp', sessionName }),
      name
    )
    expect(upload.canceled).toBe(false)
    expect(upload.remotePath).toBeTruthy()
    expect(ssh(`cat '${upload.remotePath}'`)).toBe('EXP upload verification 你好')

    await page.evaluate(() => {
      const states: string[] = []
      Object.assign(window, { testConnectionStates: states })
      window.claudeBridge.events.subscribe((event) => {
        if (event.type === 'session-status') states.push(event.status.state)
      })
    })
    ssh(`tmux detach-client -s '${name}'`)
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as { testConnectionStates: string[] }).testConnectionStates
          ),
        { timeout: 30000 }
      )
      .toEqual(expect.arrayContaining(['reconnecting', 'attached']))
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await expect(page.locator('.message.assistant')).toHaveCount(1)
    await expect(page.locator('.message.assistant')).toContainText(marker)
    ssh(`tmux kill-session -t '${name}'`)
    await expect(page.locator('.connection-label.failed')).toBeVisible({ timeout: 30000 })
    await expect(page.locator('.workspace-notice')).toContainText('已停止重连')
    expect(rendererErrors).toEqual([])
    await writeFile(
      resolve(artifactDir, 'verification.json'),
      JSON.stringify(
        {
          server: 'exp',
          command: 'cc',
          helperVersion: installed.version,
          reply: marker,
          upload: true,
          reconnect: true,
          confirmationProtected: true,
          endedSessionStopsReconnecting: true,
          modalFocus: true,
          profileIsolation: true,
          rendererErrors
        },
        null,
        2
      )
    )
  } catch (error) {
    await screenshot('failure').catch(() => undefined)
    await writeFile(
      resolve(artifactDir, 'failure-terminal.txt'),
      ssh(`tmux capture-pane -p -t '${name}' 2>/dev/null || true`)
    )
    throw error
  } finally {
    await page
      .evaluate(
        (sessionName) =>
          window.claudeBridge.sessions.terminate({ profileId: 'exp', sessionName }, sessionName),
        name
      )
      .catch(() => undefined)
    await app.close()
    // Only this test's unique session and directories are eligible for cleanup.
    ssh(
      `tmux kill-session -t '${name}' 2>/dev/null || true; rm -rf -- '${cwd}' '${home}/.local/share/claude-local-bridge/uploads/${name}'`
    )
    console.log(`EXP test artifacts: ${artifactDir}`)
  }
})
