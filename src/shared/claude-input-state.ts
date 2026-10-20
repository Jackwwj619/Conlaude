import type { ClaudePermissionMode } from './contracts'

export type ClaudeInputState = 'checking' | 'ready' | 'confirmation' | 'unavailable'

/** Claude can hide its spinner while streaming text. Keep a live observation
 * until its current completion footer appears, or a ready screen settles. */
export class ClaudeGenerationObserver {
  private active = false
  private lastScreen = ''
  private changedAt = 0

  observe(screen: string, now = Date.now()): boolean {
    const state = classifyClaudeScreen(screen)
    if (state === 'confirmation') this.active = false
    if (state !== 'ready') return false
    const spinner = claudeGeneratingFromScreen(screen)
    if (spinner) this.active = true
    if (spinner || screen !== this.lastScreen) this.changedAt = now
    this.lastScreen = screen
    const prompt = [...screen.matchAll(/(?:^|\n)\s*❯/gu)].at(-1)
    const output =
      screen
        .slice(0, prompt?.index ?? 0)
        .trimEnd()
        .split(/\r?\n/)
        .filter((line) => line.trim() && !/^\s*[─━]{3,}/u.test(line))
        .at(-1) ?? ''
    const finished =
      /^\s*[·✢✳✶✻✽*]\s+.{1,60}\bfor\s+\d+(?:[ms]|\s)/u.test(output) ||
      /^\s*(?:⎿\s*)?(?:Interrupted\b|中断)/i.test(output)
    if (!spinner && (finished || now - this.changedAt >= 6000)) this.active = false
    return this.active
  }
}

/** Recognize live Claude footer indicators, never transcript history or retry notices. */
export function claudeGeneratingFromScreen(screen: string): boolean {
  const state = classifyClaudeScreen(screen)
  if (state === 'confirmation') return false
  const footer = screen.trimEnd().split(/\r?\n/).slice(-12)
  const spinner = footer.find((line) => /^\s*[·✢✳✶✻✽*]\s+[^\r\n]{1,90}(?:…|\.{3})/u.test(line))
  if (!spinner || /retrying|\b(?:error|failed|503|429)\b/i.test(spinner)) return false
  // Claude 2.1.259 replaces "esc to interrupt" with contextual tips. Its
  // active spinner still exposes elapsed time and "thinking" in the footer.
  return (
    footer.some((line) => /\besc to interrupt\b/i.test(line)) ||
    (state === 'ready' &&
      (/\(\d+(?:m\s*\d+)?s\s*·\s*thinking\)/i.test(spinner) ||
        (/^\s*[·✢✳✶✻✽*]\s+[A-Za-z][A-Za-z -]{1,50}(?:…|\.{3})\s*$/u.test(spinner) &&
          /^\s*⎿\s*Tip:/u.test(footer[footer.indexOf(spinner) + 1] ?? ''))))
  )
}

export function claudePermissionModeFromScreen(screen: string): ClaudePermissionMode | undefined {
  if (classifyClaudeScreen(screen) !== 'ready') return undefined
  const cursor = [...screen.matchAll(/(?:^|\n)\s*❯/gu)].at(-1)
  if (!cursor) return undefined
  // Read the live footer below the prompt, not mode names quoted in a message
  // or typed on the prompt line.
  const footer = screen.slice(cursor.index).trimStart().split(/\r?\n/).slice(1)
  for (const line of footer.reverse()) {
    const mode = line
      .match(
        /^\s*(?:[⏵⏸▶»]+\s*)?(bypass permissions|accept edits|plan mode|manual mode|auto mode|don['’]?t ask(?: mode)?)\s+on\b/i
      )?.[1]
      ?.toLowerCase()
    if (mode === 'bypass permissions') return 'bypassPermissions'
    if (mode === 'accept edits') return 'acceptEdits'
    if (mode === 'plan mode') return 'plan'
    if (mode === 'manual mode') return 'default'
    if (mode === 'auto mode') return 'auto'
    if (mode?.startsWith('don')) return 'dontAsk'
    if (/^\s*\?\s+for shortcuts\b/i.test(line)) return 'default'
  }
  return undefined
}

// Inspect the current screen, never scrollback: old consent prompts must not
// keep blocking an already initialized session. Unknown screens fail closed.
export function classifyClaudeScreen(screen: string): ClaudeInputState {
  const cursors = [...screen.matchAll(/(?:^|\n)\s*❯/gu)]
  const cursor = cursors.at(-1)
  // Only the active input region matters; conversation text can itself quote a
  // confirmation dialog. The last cursor excludes earlier transcript messages.
  const inputRegion = cursor ? screen.slice(cursor.index).trimStart() : screen
  if (
    /trust (?:this folder|the files)|Yes, I trust|Enter to confirm|Do you (?:want|trust)|需要.*确认|是否信任|^❯\s*(?:\d+[.)]\s*)?(?:Yes|No)\b/i.test(
      inputRegion
    )
  ) {
    return 'confirmation'
  }
  // A cursor alone also appears in selectors and shells. Require Claude's
  // input footer before forwarding a chat message and its Enter key.
  if (
    cursor &&
    /manual mode|bypass permissions|accept edits|plan mode|auto mode|don['’]?t ask|shift\+tab|for shortcuts|for agents/i.test(
      inputRegion
    )
  ) {
    return 'ready'
  }
  return 'checking'
}
