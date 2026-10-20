import { z } from 'zod'

const InterfaceFontPresetSchema = z.enum([
  'system',
  'mona-sans',
  'space-grotesk',
  'segoe',
  'inter',
  'yahei',
  'dengxian',
  'simhei',
  'simsun',
  'kaiti',
  'fangsong',
  'tahoma',
  'arial',
  'verdana'
])
export const LocalFontSchema = z
  .string()
  .max(262)
  .startsWith('local:')
  .refine(
    (value) =>
      value.slice(6).trim().length > 0 &&
      ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
export const InterfaceFontSchema = z.union([InterfaceFontPresetSchema, LocalFontSchema])
export type InterfaceFont = z.infer<typeof InterfaceFontSchema>

const TerminalFontPresetSchema = z.enum([
  'cascadia-mono',
  'cascadia-code',
  'consolas',
  'courier-new',
  'lucida-console',
  'jetbrains-mono',
  'fira-code',
  'source-code-pro',
  'ibm-plex-mono',
  'nsimsun',
  'sarasa-mono',
  'lxgw-wenkai'
])
export const TerminalFontSchema = z.union([TerminalFontPresetSchema, LocalFontSchema])
export type TerminalFont = z.infer<typeof TerminalFontSchema>

export const INTERFACE_FONT_OPTIONS = [
  { value: 'system', labelKey: 'settings.interfaceFontSystem' },
  { value: 'mona-sans', labelKey: 'settings.interfaceFontMonaSans' },
  { value: 'space-grotesk', labelKey: 'settings.interfaceFontSpaceGrotesk' },
  { value: 'segoe', labelKey: 'settings.interfaceFontSegoe' },
  { value: 'inter', labelKey: 'settings.interfaceFontInter' },
  { value: 'yahei', labelKey: 'settings.interfaceFontYahei' },
  { value: 'dengxian', labelKey: 'settings.interfaceFontDengxian' },
  { value: 'simhei', labelKey: 'settings.interfaceFontSimHei' },
  { value: 'simsun', labelKey: 'settings.interfaceFontSimsun' },
  { value: 'kaiti', labelKey: 'settings.interfaceFontKaiTi' },
  { value: 'fangsong', labelKey: 'settings.interfaceFontFangSong' },
  { value: 'tahoma', labelKey: 'settings.interfaceFontTahoma' },
  { value: 'arial', labelKey: 'settings.interfaceFontArial' },
  { value: 'verdana', labelKey: 'settings.interfaceFontVerdana' }
] as const satisfies ReadonlyArray<{ value: InterfaceFont; labelKey: string }>

export const TERMINAL_FONT_OPTIONS = [
  { value: 'cascadia-mono', labelKey: 'settings.terminalFontCascadia' },
  { value: 'cascadia-code', labelKey: 'settings.terminalFontCascadiaCode' },
  { value: 'consolas', labelKey: 'settings.terminalFontConsolas' },
  { value: 'courier-new', labelKey: 'settings.terminalFontCourierNew' },
  { value: 'lucida-console', labelKey: 'settings.terminalFontLucidaConsole' },
  { value: 'jetbrains-mono', labelKey: 'settings.terminalFontJetBrains' },
  { value: 'fira-code', labelKey: 'settings.terminalFontFiraCode' },
  { value: 'source-code-pro', labelKey: 'settings.terminalFontSourceCodePro' },
  { value: 'ibm-plex-mono', labelKey: 'settings.terminalFontIbmPlexMono' },
  { value: 'nsimsun', labelKey: 'settings.terminalFontNSimSun' },
  { value: 'sarasa-mono', labelKey: 'settings.terminalFontSarasaMono' },
  { value: 'lxgw-wenkai', labelKey: 'settings.terminalFontLxgwWenKai' }
] as const satisfies ReadonlyArray<{ value: TerminalFont; labelKey: string }>

// Stacks end with CJK-capable fallbacks so mixed Chinese/Latin UI text always renders.
// Fonts that are not bundled (Inter, Fira Code, Source Code Pro, IBM Plex Mono,
// Sarasa Mono SC, LXGW WenKai Mono) resolve only when installed locally; otherwise
// the stack falls back gracefully, matching how editors like VS Code handle
// missing font families.
const INTERFACE_FONT_FAMILIES: Record<z.infer<typeof InterfaceFontPresetSchema>, string> = {
  system:
    "'Segoe UI Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  'mona-sans':
    "'Mona Sans', 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",
  'space-grotesk': "'Space Grotesk', 'Mona Sans', 'Segoe UI', 'Microsoft YaHei', sans-serif",
  segoe: "'Segoe UI', 'Segoe UI Variable', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",
  inter: "Inter, 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei', sans-serif",
  yahei: "'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', sans-serif",
  dengxian: "'DengXian', '等线', 'Microsoft YaHei', 'Segoe UI', sans-serif",
  simhei: "'SimHei', '黑体', 'Microsoft YaHei', 'Segoe UI', sans-serif",
  simsun: "'SimSun', 'NSimSun', 'Microsoft YaHei', 'Segoe UI', sans-serif",
  kaiti: "'KaiTi', '楷体', 'Microsoft YaHei', 'Segoe UI', sans-serif",
  fangsong: "'FangSong', '仿宋', 'Microsoft YaHei', 'Segoe UI', sans-serif",
  tahoma: "Tahoma, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  arial: "Arial, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  verdana: "Verdana, 'Segoe UI', 'Microsoft YaHei', sans-serif"
}

const TERMINAL_FONT_FAMILIES: Record<z.infer<typeof TerminalFontPresetSchema>, string> = {
  'cascadia-mono': "'Cascadia Mono', 'Cascadia Code', Consolas, 'Microsoft YaHei Mono', monospace",
  'cascadia-code': "'Cascadia Code', 'Cascadia Mono', Consolas, 'Microsoft YaHei Mono', monospace",
  consolas: "Consolas, 'Cascadia Mono', 'Microsoft YaHei Mono', monospace",
  'courier-new': "'Courier New', Consolas, 'Cascadia Mono', monospace",
  'lucida-console': "'Lucida Console', Consolas, 'Cascadia Mono', monospace",
  'jetbrains-mono': "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  'fira-code': "'Fira Code', 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  'source-code-pro': "'Source Code Pro', 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  'ibm-plex-mono': "'IBM Plex Mono', 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  nsimsun: "'NSimSun', 'SimSun', 'Microsoft YaHei', Consolas, monospace",
  'sarasa-mono': "'Sarasa Mono SC', 'Sarasa Term SC', 'JetBrains Mono', Consolas, monospace",
  'lxgw-wenkai': "'LXGW WenKai Mono', 'LXGW WenKai', 'JetBrains Mono', Consolas, monospace"
}

export function interfaceFontFamily(font: InterfaceFont): string {
  if (LocalFontSchema.safeParse(font).success)
    return `${localFontFamily(font.slice(6))}, 'Microsoft YaHei', 'Segoe UI', sans-serif`
  return (
    INTERFACE_FONT_FAMILIES[font as keyof typeof INTERFACE_FONT_FAMILIES] ??
    INTERFACE_FONT_FAMILIES['mona-sans']
  )
}

export function terminalFontFamily(font: TerminalFont): string {
  if (LocalFontSchema.safeParse(font).success)
    return `${localFontFamily(font.slice(6))}, 'Cascadia Mono', Consolas, monospace`
  return (
    TERMINAL_FONT_FAMILIES[font as keyof typeof TERMINAL_FONT_FAMILIES] ??
    TERMINAL_FONT_FAMILIES['cascadia-mono']
  )
}

export function localFontFamily(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function terminalFontFromLegacyFamily(fontFamily: unknown): TerminalFont {
  if (typeof fontFamily !== 'string') return 'cascadia-mono'
  const normalized = fontFamily.toLocaleLowerCase()
  if (normalized.includes('jetbrains')) return 'jetbrains-mono'
  if (normalized.includes('consolas')) return 'consolas'
  if (normalized.includes('fira')) return 'fira-code'
  if (normalized.includes('source code')) return 'source-code-pro'
  if (normalized.includes('plex')) return 'ibm-plex-mono'
  if (normalized.includes('cascadia code')) return 'cascadia-code'
  return 'cascadia-mono'
}

// Static display/mono stacks are not user-configurable; styles.css mirrors these defaults.
export const DISPLAY_FONT_FAMILY =
  "'Space Grotesk', 'Mona Sans', 'Segoe UI', 'Microsoft YaHei', sans-serif"
export const UI_MONO_FONT_FAMILY = "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
