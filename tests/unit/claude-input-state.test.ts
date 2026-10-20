import { describe, expect, it } from 'vitest'
import {
  classifyClaudeScreen,
  claudeGeneratingFromScreen,
  ClaudeGenerationObserver,
  claudePermissionModeFromScreen
} from '../../src/shared/claude-input-state'

describe('Claude input screen', () => {
  it('retains a live generation through spinner-free streamed output and clears on completion', () => {
    const observer = new ClaudeGenerationObserver()
    const footer = '\n─────\n❯\n─────\n? for shortcuts'
    expect(observer.observe('Old reply' + footer, 0)).toBe(false)
    expect(observer.observe('✻ Thinking… (esc to interrupt · 2s)' + footer, 1000)).toBe(true)
    expect(observer.observe('✻ Worked for 2s\n❯ next prompt\n● Partial reply' + footer, 2000)).toBe(
      true
    )
    expect(observer.observe('● Partial reply, continued' + footer, 8000)).toBe(true)
    expect(
      observer.observe('● Finished reply\n✻ Worked for 8s · done 3:25 PM' + footer, 9000)
    ).toBe(false)
  })
  it('does not replay old spinners and waits for a stable ready screen without a completion footer', () => {
    const observer = new ClaudeGenerationObserver()
    const footer = '\n❯\n? for shortcuts'
    expect(
      observer.observe(
        '✻ Thinking… (esc to interrupt · 2s)\n' + 'old line\n'.repeat(20) + footer,
        0
      )
    ).toBe(false)
    expect(observer.observe('✻ Thinking… (esc to interrupt · 2s)' + footer, 1000)).toBe(true)
    expect(observer.observe('● Reply' + footer, 2000)).toBe(true)
    expect(observer.observe('● Reply' + footer, 7999)).toBe(true)
    expect(observer.observe('● Reply' + footer, 8000)).toBe(false)
  })
  it('clears live generation on a confirmation or interruption', () => {
    const observer = new ClaudeGenerationObserver()
    const footer = '\n❯\n? for shortcuts'
    observer.observe('✻ Thinking… (esc to interrupt · 2s)' + footer)
    expect(observer.observe('❯ Yes\nEnter to confirm')).toBe(false)
    observer.observe('✻ Thinking… (esc to interrupt · 2s)' + footer)
    expect(observer.observe('⎿ Interrupted · What should Claude do instead?' + footer)).toBe(false)
  })
  it('recognizes the observed 2.1.259 thinking footer without confusing retries or completion', () => {
    const footer =
      '\n  ⎿ Tip: Use /btw without interrupting current work\n\n─────\n❯\n─────\n\n  ⏸ manual mode on · ← for agents'
    expect(claudeGeneratingFromScreen('✻ Churning… (38s · thinking)' + footer)).toBe(true)
    expect(claudeGeneratingFromScreen('· Propagating… (6s · thinking)' + footer)).toBe(true)
    expect(claudeGeneratingFromScreen('* Propagating…' + footer)).toBe(true)
    expect(claudeGeneratingFromScreen('* Retrying…' + footer)).toBe(false)
    expect(claudeGeneratingFromScreen('* Example…\n❯\n? for shortcuts')).toBe(false)
    expect(claudeGeneratingFromScreen('✽ Churning… (1m 12s · thinking)' + footer)).toBe(true)
    expect(
      claudeGeneratingFromScreen('✻ 503 No active API keys ava… · Retrying in 4s' + footer)
    ).toBe(false)
    expect(claudeGeneratingFromScreen('✻ Churned for 2s · done 3:25 PM' + footer)).toBe(false)
    expect(
      claudeGeneratingFromScreen(
        '✻ Churning… (38s · thinking)\n' + 'old line\n'.repeat(20) + footer
      )
    ).toBe(false)
  })
  it('requires a current spinner and interrupt affordance for generation', () => {
    const spinner = '✻ Thinking… (esc to interrupt · 2s · 20 tokens)'
    expect(claudeGeneratingFromScreen(`${spinner}\n❯\n? for shortcuts`)).toBe(true)
    expect(claudeGeneratingFromScreen('Sending message…')).toBe(false)
    expect(claudeGeneratingFromScreen('❯\n? for shortcuts')).toBe(false)
    expect(
      claudeGeneratingFromScreen(`${spinner}\n${'old line\n'.repeat(20)}❯\n? for shortcuts`)
    ).toBe(false)
    expect(claudeGeneratingFromScreen(`${spinner}\n❯ Yes\nEnter to confirm`)).toBe(false)
  })
  it.each([
    ['⏸ manual mode on · ← for agents', 'default'],
    ['⏵⏵ accept edits on (shift+tab to cycle)', 'acceptEdits'],
    ['⏸ plan mode on (shift+tab to cycle)', 'plan'],
    ['⏵⏵ bypass permissions on (shift+tab to cycle)', 'bypassPermissions'],
    ['auto mode on (shift+tab to cycle)', 'auto'],
    ["don't ask mode on (shift+tab to cycle)", 'dontAsk'],
    ['? for shortcuts', 'default']
  ])('reads the active permission mode from %s', (footer, expected) => {
    expect(claudePermissionModeFromScreen(`❯\n${footer}`)).toBe(expected)
    expect(classifyClaudeScreen(`❯\n${footer}`)).toBe('ready')
  })

  it('ignores historical modes, draft text, and confirmation menus', () => {
    expect(
      claudePermissionModeFromScreen(
        '❯ old message\nplan mode on\n❯ bypass permissions on\n? for shortcuts'
      )
    ).toBe('default')
    expect(claudePermissionModeFromScreen('plan mode on\nubuntu@exp:~$')).toBeUndefined()
    expect(
      claudePermissionModeFromScreen('❯ Yes\nmanual mode on\nEnter to confirm')
    ).toBeUndefined()
  })
  it('prioritizes confirmation over a prompt or permission-mode footer', () => {
    expect(classifyClaudeScreen('❯ No, exit\nYes, I trust this folder\nEnter to confirm')).toBe(
      'confirmation'
    )
    expect(classifyClaudeScreen('Do you want to run this command?\n❯ Yes\nmanual mode on')).toBe(
      'confirmation'
    )
  })
  it('does not mistake loading output, a shell, or a selector for the input prompt', () => {
    for (const screen of [
      '',
      'Claude Code',
      'ubuntu@exp:~$ ',
      '❯ Select a theme',
      'manual mode on'
    ]) {
      expect(classifyClaudeScreen(screen)).toBe('checking')
    }
  })
  it('recognizes the observed Claude input footer', () => {
    expect(classifyClaudeScreen('❯ Try "hello"\n⏸ manual mode on · ← for agents')).toBe('ready')
    expect(classifyClaudeScreen('❯\n⏵⏵ bypass permissions on (shift+tab to cycle)')).toBe('ready')
  })
  it('does not treat a quoted consent dialog in conversation history as an active dialog', () => {
    expect(
      classifyClaudeScreen(
        '❯ Explain: Yes, I trust this folder\nAnswer: Enter to confirm\n❯\nmanual mode on'
      )
    ).toBe('ready')
  })
})
