// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { parseSystemFonts } from '../../src/main/system-fonts'
import {
  InterfaceFontSchema,
  TerminalFontSchema,
  interfaceFontFamily,
  terminalFontFamily
} from '../../src/shared/font-presets'
import { AppSettingsSchema } from '../../src/shared/contracts'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

vi.mock('../../src/main/process-runner', () => ({ runProcess: vi.fn() }))
const encoded = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64')

describe('installed font families', () => {
  it('decodes Chinese names without corruption and removes invalid families', () => {
    expect(
      parseSystemFonts(
        encoded(['宋体', 'Consolas', '宋体', ' @宋体', ' ', 42, 'bad\nfont', 'A'.repeat(257)])
      )
    ).toEqual(expect.arrayContaining(['宋体', 'Consolas']))
    expect(
      parseSystemFonts(encoded(['宋体', 'Consolas', '宋体', '@宋体', 'bad\nfont']))
    ).toHaveLength(2)
    expect(() => parseSystemFonts(encoded({ font: 'Consolas' }))).toThrow(
      'Invalid system font list'
    )
  })
  it('retains existing presets and persists arbitrary local fonts in every font preference', () => {
    const settings = AppSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      interfaceFont: 'local:思源黑体 CN',
      replyFont: 'local:宋体',
      terminal: { ...DEFAULT_SETTINGS.terminal, font: 'local:My Mono' }
    })
    expect(settings.interfaceFont).toBe('local:思源黑体 CN')
    expect(settings.replyFont).toBe('local:宋体')
    expect(settings.terminal.font).toBe('local:My Mono')
    expect(InterfaceFontSchema.parse('yahei')).toBe('yahei')
    expect(TerminalFontSchema.parse('consolas')).toBe('consolas')
    for (const value of ['Unknown font', 'local:', 'local:  ', 'local:bad\nfont'])
      expect(InterfaceFontSchema.safeParse(value).success).toBe(false)
  })
  it('quotes font family names as one CSS family and keeps fallback stacks', () => {
    expect(interfaceFontFamily('local:Name, With "Quotes"')).toBe(
      '"Name, With \\"Quotes\\"", \'Microsoft YaHei\', \'Segoe UI\', sans-serif'
    )
    expect(terminalFontFamily('local:My Mono')).toBe(
      '"My Mono", \'Cascadia Mono\', Consolas, monospace'
    )
  })
})
