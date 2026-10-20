import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { bundledHelperVersion } from './runtime-target'
import type { BridgeEvent, SessionStatus } from '../../src/shared/contracts'

test('exp only: real native commands, replies, clear, resume and rewind', async () => {
  test.skip(process.env.CLB_TEST_SSH_HOST !== 'exp', 'Explicit exp-only opt-in required')
  test.setTimeout(360000)
  const root = resolve(import.meta.dirname, '../..')
  const applicationVersion: string = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8')
  ).version
  const name = `bridge-native-live-${Date.now()}`
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
    ...(process.env.CLB_NATIVE_SOURCE === '1'
      ? { args: ['.'] }
      : {
          executablePath:
            process.env.CLB_NATIVE_EXECUTABLE ||
            resolve(root, 'dist', `Conlaude-${applicationVersion}`, 'win-unpacked', 'Conlaude.exe'),
          args: []
        }),
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: userData }
  })
  const page = await app.firstWindow()
  const screen = () => ssh(`tmux capture-pane -p -t '=${name}:0.0'`)
  const discovery = () =>
    JSON.parse(
      ssh(
        `python3 ~/.local/share/claude-local-bridge/bridge_agent.py discover-transcript --session-name '${name}' --cwd '${cwd}'`
      )
    ) as { boundSessionId?: string; liveBinding?: boolean }
  const stage = async (label: string) => {
    console.log(`EXP PASS: ${label}`)
    await writeFile(resolve(evidence, `${label}.txt`), screen())
    await page.screenshot({ path: resolve(evidence, `${label}.png`) })
  }
  const control = async (value: 'escape' | 'enter' | 'arrowUp' | 'arrowDown') =>
    page.evaluate(
      ({ target, control }) => window.claudeBridge.terminal.writeControl({ ...target, control }),
      { target, control: value }
    )
  const ready = async () =>
    expect
      .poll(
        () =>
          page.evaluate(() => {
            const events = (window as unknown as { liveEvents: BridgeEvent[] }).liveEvents
            const status = events.filter((event) => event.type === 'session-status').at(-1) as
              { status: SessionStatus } | undefined
            return status?.status.promptState === 'ready' && !status.status.generating
          }),
        { timeout: 30000 }
      )
      .toBe(true)
  const run = async (text: string) => {
    await ready()
    await page.locator('.cm-content').fill(text)
    await expect(page.locator('.send-button')).toBeEnabled({ timeout: 15000 })
    await page.locator('.cm-content').press('Control+Enter')
    await expect(page.locator('.terminal-drawer')).toHaveClass(/open/, { timeout: 20000 })
  }
  const finish = async () => {
    await ready()
    await expect(page.locator('.composer-native-hint')).toBeHidden({ timeout: 30000 })
  }

  try {
    const profiles = await page.evaluate(() => window.claudeBridge.settings.get())
    expect(profiles.profiles.map((item) => item.sshHost)).toEqual(['exp'])
    await page.evaluate(() => {
      Object.assign(window, { liveEvents: [] })
      window.claudeBridge.events.subscribe((event) =>
        (window as unknown as { liveEvents: BridgeEvent[] }).liveEvents.push(event)
      )
    })
    const installed = await page.evaluate(() => window.claudeBridge.helper.install('exp'))
    expect(installed.version).toBe(bundledHelperVersion)
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
      await control('arrowUp')
      await control('enter')
    }
    await ready()
    const initial = discovery()
    expect(initial.liveBinding).toBe(true)
    expect(initial.boundSessionId).toBeTruthy()
    await stage('01-connected')
    await run('/model')
    await expect.poll(screen, { timeout: 15000 }).toMatch(/Select model|Enter to confirm/i)
    await stage('02-model-menu')
    if (process.env.CLB_TEST_MODEL) {
      const rows = screen()
        .split('\n')
        .filter((line) => /^\s*(?:❯\s*)?\d+\.\s/.test(line))
      const from = rows.findIndex((line) => line.includes('❯'))
      const to = rows.findIndex((line) => line.includes(process.env.CLB_TEST_MODEL!))
      expect(from).toBeGreaterThanOrEqual(0)
      expect(to).toBeGreaterThanOrEqual(0)
      for (let index = from; index !== to; index += index < to ? 1 : -1)
        await control(index < to ? 'arrowDown' : 'arrowUp')
      // Native 's' applies only to this disposable session, never the default.
      await page.evaluate(
        (target) => window.claudeBridge.terminal.writeInput({ ...target, data: 's' }),
        target
      )
    } else if (process.env.CLB_NATIVE_UI_ONLY === '1') {
      // Confirm the current model for this disposable session only.
      await page.evaluate(
        (target) => window.claudeBridge.terminal.writeInput({ ...target, data: 's' }),
        target
      )
    } else await control('escape')
    await finish()
    if (process.env.CLB_TEST_MODEL) await stage('02b-session-model-selected')
    const marker = process.env.CLB_SEED_MARKER || `EXP_NATIVE_OK_${Date.now()}`
    if (process.env.CLB_SEED_TEST_SESSION) {
      const seed = process.env.CLB_SEED_TEST_SESSION
      if (!/^[a-f0-9-]{36}$/.test(seed)) throw new Error('Invalid test seed session')
      await run(`/resume ${seed}`)
      await expect.poll(() => discovery().boundSessionId, { timeout: 20000 }).toBe(seed)
      await finish()
      initial.boundSessionId = seed
      await expect(page.locator('.message.assistant').filter({ hasText: marker })).toBeVisible({
        timeout: 20000
      })
    } else {
      await page.locator('.cm-content').fill(`Reply with exactly ${marker}. Do not use any tools.`)
      await expect(page.locator('.send-button')).toBeEnabled()
      await page.locator('.cm-content').press('Control+Enter')
      await expect(page.locator('.message.assistant').filter({ hasText: marker })).toBeVisible({
        timeout: 120000
      })
      await ready()
      await expect(page.locator('.composer-model')).not.toContainText('未知')
    }
    await stage('03-real-reply-and-model')
    if (process.env.CLB_NATIVE_UI_ONLY === '1') {
      await expect(page.getByRole('button', { name: /返回对话|Return to chat/ })).toHaveCount(0)
      await expect(
        page
          .locator('.message')
          .filter({ hasText: /<local-command-|<command-name>|<command-args>/ })
      ).toHaveCount(0)
      await page.getByRole('button', { name: '终端面板', exact: true }).click()
      await expect(page.locator('.terminal-drawer')).not.toHaveClass(/open/)
      await page.locator('.cm-content').fill('draft retained after native command')
      await expect(page.locator('.send-button')).toBeEnabled()
      await expect(page.locator('.cm-content')).toHaveText('draft retained after native command')
      await stage('04-manual-chat-clean-history')
      await writeFile(
        resolve(evidence, 'result.json'),
        JSON.stringify(
          {
            host: 'exp',
            target,
            result: 'native-ui-passed',
            checks: [
              'session-only model confirmation',
              'background synchronization',
              'real subsequent reply',
              'no command protocol bubbles',
              'manual chat switch',
              'draft preserved'
            ]
          },
          null,
          2
        )
      )
      return
    }
    await run('/clear')
    await expect
      .poll(() => discovery().boundSessionId, { timeout: 20000 })
      .not.toBe(initial.boundSessionId)
    await finish()
    await expect(page.locator('.message.assistant').filter({ hasText: marker })).toHaveCount(0)
    await stage('04-clear-synchronized')
    await run(`/resume ${initial.boundSessionId}`)
    await expect
      .poll(() => discovery().boundSessionId, { timeout: 20000 })
      .toBe(initial.boundSessionId)
    await finish()
    await expect(page.locator('.message.assistant').filter({ hasText: marker })).toBeVisible({
      timeout: 20000
    })
    await stage('05-resume-synchronized')
    await page.locator('.cm-content').fill('')
    await page.locator('.cm-content').press('Escape')
    await page.locator('.cm-content').press('Escape')
    await expect(page.locator('.terminal-drawer')).toHaveClass(/open/, {
      timeout: 20000
    })
    await expect.poll(screen, { timeout: 20000 }).toMatch(/Rewind|checkpoint/i)
    await stage('06-double-escape-rewind')
    await control('escape')
    await finish()
    await stage('07-cancel-preserves-history')
    await run('/rewind')
    await control('arrowUp')
    await control('enter')
    await expect.poll(screen, { timeout: 15000 }).toMatch(/Restore conversation/i)
    await stage('08-rewind-confirmation')
    const options = screen()
      .split('\n')
      .filter((line) => /Restore (?:conversation|code)|Summarize|Cancel/.test(line))
    const selected = options.findIndex((line) => line.includes('❯'))
    const restore = options.findIndex((line) => /Restore conversation/.test(line))
    expect(selected).toBeGreaterThanOrEqual(0)
    expect(restore).toBeGreaterThanOrEqual(0)
    for (let move = selected; move !== restore; move += move < restore ? 1 : -1)
      await control(move < restore ? 'arrowDown' : 'arrowUp')
    await control('enter')
    await ready()
    await stage('09-rewind-applied-native')
    // The original question is restored into the native editor. Explicitly clear
    // this test-only text before checking graphical history and sending a new turn.
    await page.evaluate(
      (target) => window.claudeBridge.terminal.writeInput({ ...target, data: '\u0015' }),
      target
    )
    await finish()
    await stage('10-rewind-applied-graphical')
    if (process.env.CLB_SKIP_GENERATION !== '1') {
      await page
        .locator('.cm-content')
        .fill(
          'List 500 numbered observations about simple arithmetic. Do not use tools. Keep writing until all 500 are complete.'
        )
      await page.locator('.cm-content').press('Control+Enter')
      await expect(page.locator('.stop-button')).toBeVisible({ timeout: 60000 })
      await page.locator('.cm-content').fill('keep this local draft after interruption')
      await page.locator('.cm-content').press('Escape')
      await ready()
      await expect(page.locator('.composer-native-hint')).toHaveCount(0)
      await expect(page.locator('.cm-content')).toHaveText(
        'keep this local draft after interruption'
      )
      await stage('11-escape-stops-generation')
    } else console.log('EXP BLOCKED: generation interruption requires an available upstream model')
    await writeFile(
      resolve(evidence, 'result.json'),
      JSON.stringify(
        {
          host: 'exp',
          target,
          initial,
          result:
            process.env.CLB_SKIP_GENERATION === '1'
              ? 'native-history-passed-generation-blocked'
              : 'passed'
        },
        null,
        2
      )
    )
  } catch (error) {
    await page.screenshot({ path: resolve(evidence, 'failure.png') }).catch(() => {})
    try {
      await writeFile(resolve(evidence, 'failure-terminal.txt'), screen())
    } catch {
      /* session may have exited */
    }
    throw error
  } finally {
    await app.close()
    try {
      ssh(
        `python3 ~/.local/share/claude-local-bridge/bridge_agent.py terminate-session --name '${name}'`
      )
    } catch {
      /* may already have exited */
    }
    ssh(`python3 -c 'import shutil; shutil.rmtree("${cwd}")'`)
    const remains = ssh(`tmux has-session -t '=${name}' 2>/dev/null; printf '%s' $?`)
    expect(remains).not.toBe('0')
    console.log(`EXP cleanup verified: ${name}`)
  }
})
