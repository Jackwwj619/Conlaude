const BRACKETED_PASTE_START = '\u001b[200~'
const BRACKETED_PASTE_END = '\u001b[201~'

export interface SanitizedPrompt {
  text: string
  removedControlCharacters: number
}

export function sanitizePrompt(input: string): SanitizedPrompt {
  const normalized = input.replace(/\r\n?/g, '\n')
  let removedControlCharacters = 0
  let text = ''

  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0
    const allowedWhitespace = character === '\n' || character === '\t'
    const isControl =
      codePoint === 0x1b || (codePoint < 0x20 && !allowedWhitespace) || codePoint === 0x7f

    if (isControl) {
      removedControlCharacters += 1
      continue
    }

    text += character
  }

  return { text, removedControlCharacters }
}

export function encodePromptForTerminal(input: string): {
  sequence: string
  sanitized: SanitizedPrompt
} {
  const sanitized = sanitizePrompt(input)
  return {
    sequence: `${BRACKETED_PASTE_START}${sanitized.text}${BRACKETED_PASTE_END}\r`,
    sanitized
  }
}
