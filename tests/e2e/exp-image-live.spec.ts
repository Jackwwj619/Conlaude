import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import type { BridgeEvent, SessionStatus } from '../../src/shared/contracts'

test('exp only: clipboard image upload and automatic submission', async () => {
  test.skip(process.env.CLB_TEST_SSH_HOST !== 'exp', 'Explicit exp-only opt-in required')
  test.setTimeout(360000)
  const root = resolve(import.meta.dirname, '../..')
  const name = `bridge-image-live-${Date.now()}`
  const target = { profileId: 'exp', sessionName: name }
  const evidence = resolve(root, 'playwright-report', name)
  const userData = resolve(evidence, 'user-data')
  await mkdir(userData, { recursive: true })
  // Hard-coded destination: this test cannot be redirected to mas or another host.
  const ssh = (command: string) =>
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'exp', command], {
      encoding: 'utf8',
      timeout: 20000
    }).trim()
  const cwd = ssh('mktemp -d /tmp/clb-native-live-XXXXXXXX')
  if (!/^\/tmp\/clb-native-live-[A-Za-z0-9]+$/.test(cwd))
    throw new Error('Unexpected test directory')
  const profile = {
    ...DEFAULT_SETTINGS.profiles[0]!,
    id: 'exp',
    host: 'exp',
    sshHost: 'exp',
    label: 'EXP native validation',
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
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: userData }
  })
  const page = await app.firstWindow()
  const screen = () => ssh(`tmux capture-pane -p -t '=${name}:0.0'`)
  try {
    await page.evaluate(() => {
      Object.assign(window, { liveEvents: [] })
      window.claudeBridge.events.subscribe((event) =>
        (window as unknown as { liveEvents: BridgeEvent[] }).liveEvents.push(event)
      )
    })
    await page.evaluate(
      ({ target, cwd }) => window.claudeBridge.sessions.create({ ...target, cwd }),
      { target, cwd }
    )
    await page
      .locator('.server-card')
      .filter({ hasText: profile.label })
      .getByRole('button', { name: '查看会话', exact: true })
      .click()
    await page.locator('.session-entry').filter({ hasText: name }).click()
    await expect.poll(screen, { timeout: 25000 }).toMatch(/Claude Code|trust/)
    if (/trust this folder|trust the files/i.test(screen())) {
      await page.evaluate(
        (target) => window.claudeBridge.terminal.writeControl({ ...target, control: 'arrowUp' }),
        target
      )
      await page.evaluate(
        (target) => window.claudeBridge.terminal.writeControl({ ...target, control: 'enter' }),
        target
      )
    }
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const events = (window as unknown as { liveEvents: BridgeEvent[] }).liveEvents
            const last = events.filter((event) => event.type === 'session-status').at(-1) as
              { status: SessionStatus } | undefined
            return last?.status.promptState
          }),
        { timeout: 30000 }
      )
      .toBe('ready')
    const png = readFileSync(resolve(root, 'tests/fixtures/clipboard-red.png')).toString('base64')
    await app.evaluate(
      ({ clipboard, ClipboardItem }, png) =>
        clipboard.write([
          new ClipboardItem({
            'image/png': new Blob([Buffer.from(png, 'base64')], { type: 'image/png' })
          })
        ]),
      png
    )
    await page
      .locator('.cm-content')
      .fill('Describe the color in the attached image in one short sentence.')
    await page.locator('.cm-content').press('Control+v')
    await expect(page.locator('.composer-image img')).toBeVisible()
    await page.screenshot({ path: resolve(evidence, '01-thumbnail.png') })
    await expect(page.locator('.composer-image [role=status]')).toHaveCount(0, { timeout: 30000 })
    await expect(page.locator('.send-button')).toBeEnabled()
    await page.locator('.send-button').click()
    await expect(page.locator('.composer-image')).toHaveCount(0, { timeout: 30000 })
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { liveEvents: BridgeEvent[] }).liveEvents.filter(
                (event) => event.type === 'timeline-event' && event.event.kind === 'user'
              ).length
          ),
        { timeout: 30000 }
      )
      .toBeGreaterThan(0)
    await expect(page.locator('article.message.user')).toHaveCount(1)
    // Optional model-health check: transport correctness does not require a healthy upstream API.
    if (process.env.CLB_TEST_REQUIRE_REPLY === '1') {
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              (window as unknown as { liveEvents: BridgeEvent[] }).liveEvents.some(
                (event) =>
                  event.type === 'timeline-event' &&
                  (event.event.kind === 'assistant' || event.event.kind === 'error')
              )
            ),
          { timeout: 120000 }
        )
        .toBe(true)
    }
    await writeFile(
      resolve(evidence, 'events.json'),
      JSON.stringify(
        await page.evaluate(() => (window as unknown as { liveEvents: BridgeEvent[] }).liveEvents),
        null,
        2
      )
    )
    await writeFile(resolve(evidence, 'terminal.txt'), screen())
    await page.screenshot({ path: resolve(evidence, '02-submitted.png') })
  } catch (error) {
    await page.screenshot({ path: resolve(evidence, 'failure.png') }).catch(() => {})
    await writeFile(resolve(evidence, 'failure-terminal.txt'), screen()).catch(() => {})
    throw error
  } finally {
    await app.close()
    ssh(`tmux kill-session -t '=${name}'`)
    ssh(
      `python3 -c 'import shutil,os; shutil.rmtree("${cwd}"); shutil.rmtree(os.path.expanduser("~/.local/share/claude-local-bridge/uploads/${name}"), ignore_errors=True)'`
    )
  }
})
