import { join } from 'node:path'
import { runProcess } from './process-runner'

// Fixed, read-only script: renderer input is never part of a shell command.
const FONT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$collection = New-Object System.Drawing.Text.InstalledFontCollection
try {
  $families = @($collection.Families | ForEach-Object { $_.Name })
  try {
    Add-Type -AssemblyName PresentationCore
    $families += @([System.Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source })
  } catch { }
  $families = @($families | Sort-Object -Unique)
  $json = ConvertTo-Json -InputObject $families -Compress
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
} finally { $collection.Dispose() }
`

export function parseSystemFonts(encoded: string): string[] {
  const value: unknown = JSON.parse(Buffer.from(encoded.trim(), 'base64').toString('utf8'))
  if (!Array.isArray(value)) throw new Error('Invalid system font list')
  return [
    ...new Set(
      value
        .filter((font): font is string => typeof font === 'string')
        .map((font) => font.trim())
        .filter(
          (font) =>
            font.length > 0 &&
            font.length <= 256 &&
            !font.startsWith('@') &&
            ![...font].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
        )
    )
  ].sort((a, b) => a.localeCompare(b))
}

let cached: { fonts: string[]; at: number } | undefined
let pending: Promise<string[]> | undefined

export async function listSystemFonts(refresh = false): Promise<string[]> {
  if (!refresh && cached && Date.now() - cached.at < 60_000) return cached.fonts
  if (pending) return pending
  if (process.platform !== 'win32') throw new Error('System font discovery requires Windows')
  pending = (async () => {
    const executable = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    const result = await runProcess(
      executable,
      ['-NoProfile', '-NonInteractive', '-Command', FONT_SCRIPT],
      { timeoutMs: 15000, maxOutputBytes: 1_000_000 }
    )
    if (result.exitCode !== 0) throw new Error('Unable to read installed fonts')
    const fonts = parseSystemFonts(result.stdout)
    cached = { fonts, at: Date.now() }
    return fonts
  })()
  try {
    return await pending
  } finally {
    pending = undefined
  }
}
