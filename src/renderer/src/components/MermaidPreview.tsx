import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'

type DiagramResult = { source: string; theme: string; image?: string; failed?: boolean }
const images = new Map<string, string>()
let queue: Promise<unknown> = Promise.resolve()
let nextDiagram = 0

async function renderDiagram(source: string, theme: string): Promise<string> {
  const key = `${theme}:${source}`
  const cached = images.get(key)
  if (cached) return cached
  // Keep diagram-local initialization from replacing our shared rendering policy.
  if (source.length > 20000 || /^\s*---/.test(source) || /%%\s*\{/.test(source))
    throw new Error('Unsupported diagram configuration')
  const task = queue
    .catch(() => undefined)
    .then(async () => {
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'neutral',
        htmlLabels: false,
        maxTextSize: 20000,
        maxEdges: 200,
        suppressErrorRendering: true,
        flowchart: { htmlLabels: false },
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif'
      })
      const container = document.createElement('div')
      container.style.cssText =
        'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none'
      document.body.append(container)
      try {
        const { svg } = await mermaid.render(`bridge-diagram-${++nextDiagram}`, source, container)
        // An SVG image cannot execute scripts or activate links from the diagram source.
        const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        images.set(key, image)
        if (images.size > 20) images.delete(images.keys().next().value!)
        return image
      } finally {
        container.remove()
      }
    })
  queue = task
  return task
}

export default function MermaidPreview({ code }: { code: string }): React.JSX.Element {
  const { t } = useI18n()
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light')
  const [result, setResult] = useState<DiagramResult>()
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme ?? 'light')
    )
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true
    void renderDiagram(code, theme)
      .then((image) => {
        if (active) setResult({ source: code, theme, image })
      })
      .catch(() => {
        if (active) setResult({ source: code, theme, failed: true })
      })
    return () => {
      active = false
    }
  }, [code, theme])
  const current = result?.source === code && result.theme === theme ? result : undefined
  if (current?.image)
    return (
      <div className="mermaid-preview">
        <img src={current.image} alt={t('render.diagramAlt')} />
      </div>
    )
  return (
    <div>
      <div className="diagram-notice" role="status">
        {t(current?.failed ? 'render.diagramUnavailable' : 'render.diagramLoading')}
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  )
}
