import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

test('exp isolated session: live indicator, switch, interrupt and disconnect', async () => {
  const name = `bridge-iteration-${Date.now()}`
  const other = `${name}-switch`
  test.skip(
    process.env.CLB_TEST_SSH_HOST !== 'exp',
    'Requires explicit exp opt-in; creates and cleans isolated sessions'
  )
  test.setTimeout(300000)
  const folder = resolve('playwright-report', `generation-lifecycle-${Date.now()}`)
  const userData = resolve(folder, 'user-data')
  await mkdir(userData, { recursive: true })
  const ssh = (cmd: string): string =>
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'exp', cmd], {
      encoding: 'utf8',
      timeout: 20000
    })
  const home = ssh('printf \'%s\' "$HOME"').trim()
  const cwd = `${home}/.cache/claude-local-bridge-tests/${name}`
  if (!/^\/[A-Za-z0-9_./-]+$/.test(cwd)) throw new Error('Unexpected test directory')
  ssh(`mkdir -p '${cwd}' && tmux new-session -d -s '${other}' -c '${cwd}'`)
  const profile = {
    ...DEFAULT_SETTINGS.profiles[0]!,
    id: 'exp',
    label: 'EXP generation validation',
    sshHost: 'exp',
    host: 'exp',
    claudePath: 'cc',
    defaultCwd: cwd,
    defaultSession: name
  }
  await writeFile(
    resolve(userData, 'config.json'),
    JSON.stringify({ ...DEFAULT_SETTINGS, profiles: [profile], currentProfileId: 'exp' })
  )
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: userData }
  })
  const pageFailure = async (): Promise<void> => {
    await writeFile(
      resolve(folder, 'failure-terminal.txt'),
      ssh(`tmux capture-pane -p -t '=${name}:0.0' 2>/dev/null || true`)
    )
  }
  try {
    const page = await app.firstWindow()
    await page
      .locator('.server-card')
      .getByRole('button', { name: '查看会话', exact: true })
      .click()
    await page.evaluate(() => window.claudeBridge.helper.install('exp'))
    await page.locator('.new-session-button').click()
    const create = page.getByRole('dialog', { name: '新建 Claude 会话' })
    await create.locator('summary').click()
    await create.getByLabel('tmux 会话名', { exact: true }).fill(name)
    await create.getByLabel('远程工作目录', { exact: true }).fill(cwd)
    await create.getByRole('button', { name: '创建并连接' }).click()
    await expect(create).toBeHidden({ timeout: 30000 })
    await expect
      .poll(() => ssh(`tmux capture-pane -p -t '=${name}:0.0'`), { timeout: 30000 })
      .toMatch(
        /trust this folder|trust the files|manual mode|for agents|for shortcuts|What can I help/
      )
    const initial = ssh(`tmux capture-pane -p -t '=${name}:0.0'`)
    if (/trust this folder|trust the files/.test(initial)) {
      if (/❯ No, exit/.test(initial)) ssh(`tmux send-keys -t '=${name}:0.0' Down`)
      ssh(`tmux send-keys -t '=${name}:0.0' Enter`)
    }

    await expect(page.locator('.connection-label.attached')).toBeVisible({ timeout: 30000 })
    await page.evaluate(() => {
      Object.assign(window, { liveStates: [] })
      window.claudeBridge.events.subscribe((event) => {
        if (event.type === 'session-status')
          (window as unknown as { liveStates: unknown[] }).liveStates.push(event.status)
      })
    })
    await page
      .locator('.cm-content')
      .fill(
        '请逐行列出 35 条桌面界面检查点，每条至少 20 个汉字，最后单独一行输出 LIFECYCLE_READY。不要调用工具。'
      )
    await expect(page.locator('.send-button')).toBeEnabled({ timeout: 30000 })
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.message.assistant')).toContainText('LIFECYCLE_READY', {
      timeout: 150000
    })

    await page
      .locator('.cm-content')
      .fill('请深入思考桌面软件可用性的 80 个具体检查点，每条至少 20 个汉字。不要调用任何工具。')
    await expect(page.locator('.send-button')).toBeEnabled({ timeout: 20000 })
    await page.keyboard.press('Control+Enter')
    const latest = () =>
      page.evaluate(
        (sessionName) =>
          (
            window as unknown as {
              liveStates: { generating?: boolean; state: string; sessionName: string }[]
            }
          ).liveStates
            .filter((status) => status.sessionName === sessionName)
            .at(-1),
        name
      )
    let sample = 0
    await expect
      .poll(
        async () => {
          await writeFile(
            resolve(folder, `generating-${sample++}.txt`),
            ssh(`tmux capture-pane -p -t '=${name}:0.0'`)
          )
          return (await latest())?.generating
        },
        { timeout: 90000, intervals: [500, 1000] }
      )
      .toBe(true)
    await page.locator('.timeline').evaluate((node) => {
      node.scrollTop = 0
    })
    await expect(page.locator('.generating-dots i')).toHaveCount(3)
    await writeFile(resolve(folder, 'thinking.txt'), ssh(`tmux capture-pane -p -t '=${name}:0.0'`))
    await page.screenshot({ path: resolve(folder, 'live-dots.png') })
    await page.locator('.session-entry').filter({ hasText: other }).click()
    await expect(page.locator('.generating-dots')).not.toBeVisible()
    await page.getByTitle(new RegExp(`\\n${name}$`)).click()
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect.poll(async () => (await latest())?.generating, { timeout: 15000 }).toBe(false)
    await expect
      .poll(() => ssh(`tmux capture-pane -p -t '=${name}:0.0'`), { timeout: 15000 })
      .toMatch(/Interrupted|interrupted|中断/)
    const interrupted = ssh(`tmux capture-pane -p -t '=${name}:0.0'`)
    await writeFile(resolve(folder, 'interrupted.txt'), interrupted)
    expect(interrupted).toMatch(/Interrupted|interrupted|中断/)
    await page.locator('.timeline').evaluate((node) => {
      node.scrollTop = 0
    })
    await expect(page.locator('.timeline-jump-to-latest')).toHaveAttribute(
      'data-generating',
      'false'
    )
    await page.screenshot({ path: resolve(folder, 'interrupted-arrow.png') })
    await page.evaluate(
      (sessionName) => window.claudeBridge.sessions.detach({ profileId: 'exp', sessionName }),
      name
    )
    await expect.poll(async () => (await latest())?.state).toBe('detached')
    expect((await latest())?.generating).not.toBe(true)
    await writeFile(
      resolve(folder, 'states.json'),
      JSON.stringify(
        await page.evaluate(() => (window as unknown as { liveStates: unknown[] }).liveStates),
        null,
        2
      )
    )
  } catch (error) {
    const page = await app.firstWindow()
    await writeFile(resolve(folder, 'failure-dom.txt'), await page.locator('body').innerText())
    await pageFailure()
    throw error
  } finally {
    await app.close()
    ssh(
      `tmux kill-session -t '=${name}' 2>/dev/null || true; tmux kill-session -t '=${other}' 2>/dev/null || true; rm -rf -- '${cwd}'`
    )
  }
})
