import type { TimelineEvent } from '../../shared/contracts'

export function describeTool(event: TimelineEvent): {
  label: string
  detail: string
  language: string
  content: string
} {
  const input =
    event.toolInput && typeof event.toolInput === 'object'
      ? (event.toolInput as Record<string, unknown>)
      : {}
  const name = (event.toolName ?? '').toLowerCase()
  const labels: Record<string, string> = {
    read: 'render.read',
    readfile: 'render.read',
    edit: 'render.edit',
    multiedit: 'render.edit',
    write: 'render.write',
    bash: 'render.command',
    shell: 'render.command',
    grep: 'render.search',
    glob: 'render.search',
    websearch: 'render.search',
    webfetch: 'render.fetch'
  }
  const detail = [
    input.file_path,
    input.path,
    input.file,
    input.command,
    input.pattern,
    input.query,
    input.url
  ].find((value) => typeof value === 'string')
  const value = event.kind === 'tool-use' ? event.toolInput : event.toolResult
  return {
    label:
      event.kind === 'tool-result'
        ? 'render.result'
        : (labels[name] ?? event.toolName ?? 'timeline.toolUse'),
    detail: typeof detail === 'string' ? detail.replace(/\s+/g, ' ').slice(0, 160) : '',
    language: typeof value === 'string' ? '' : 'json',
    content: typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
  }
}
