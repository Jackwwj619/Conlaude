import { lazy, memo, Suspense, useContext, useMemo, useState, type ReactNode } from 'react'
import { File, FileText, FileCode2, Image as ImageIcon, WrapText } from 'lucide-react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { common, createLowlight } from 'lowlight'
import type { RootContent } from 'hast'
import { useI18n } from '../i18n'
import { fileLinkDetails, isWebLink, markdownUrl } from '../markdown-links'
import {
  RemoteFileOpenContext,
  remarkRemoteFilePaths,
  resolveRemoteFileReference
} from '../file-navigation'
import { FileReferenceHint } from './FileReferenceHint'
import { CopyButton } from './CopyButton'
import { ContentBoundary } from './ContentBoundary'
import 'katex/dist/katex.min.css'
import '../content-rendering.css'

const highlighter = createLowlight(common)
const MermaidPreview = lazy(() => import('./MermaidPreview'))
const remarkPlugins = [remarkGfm, remarkMath, remarkRemoteFilePaths]
const rehypePlugins: NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']> = [
  [
    rehypeKatex,
    { trust: false, strict: 'ignore', throwOnError: false, maxExpand: 500, maxSize: 20 }
  ]
]

function highlightNodes(nodes: RootContent[]): ReactNode {
  return nodes.map((node, index) =>
    node.type === 'text' ? (
      node.value
    ) : node.type === 'element' ? (
      <span
        key={index}
        className={
          Array.isArray(node.properties.className) ? node.properties.className.join(' ') : undefined
        }
      >
        {highlightNodes(node.children)}
      </span>
    ) : null
  )
}

export function CodeBlock({
  code,
  language = ''
}: {
  code: string
  language?: string
}): React.JSX.Element {
  const { t } = useI18n()
  const [wrap, setWrap] = useState(false)
  const [source, setSource] = useState(false)
  const normalized = language.toLowerCase()
  const diagram = normalized === 'mermaid'
  const highlighted = useMemo(() => {
    if (code.length > 30000 || !normalized || !highlighter.registered(normalized)) return code
    try {
      return highlightNodes(highlighter.highlight(normalized, code).children)
    } catch {
      return code
    }
  }, [code, normalized])
  const plain = (
    <pre
      tabIndex={0}
      className={wrap ? 'code-wrap' : undefined}
      aria-label={`${language || t('render.plainText')} ${t('render.code')}`}
    >
      <code>{highlighted}</code>
    </pre>
  )
  return (
    <div className={`code-block ${diagram ? 'diagram-block' : ''}`} data-code-source={code}>
      <div className="code-block-toolbar">
        <span className="code-language">{language || t('render.plainText')}</span>
        <div className="code-block-actions">
          {diagram ? (
            <button
              className="content-action"
              type="button"
              onClick={() => setSource(!source)}
              aria-pressed={source}
            >
              {t(source ? 'render.diagram' : 'render.source')}
            </button>
          ) : (
            <button
              className="content-action code-wrap-toggle"
              type="button"
              title={t('render.wrapCode')}
              aria-label={t('render.wrapCode')}
              aria-pressed={wrap}
              onClick={() => setWrap(!wrap)}
            >
              <WrapText size={15} />
            </button>
          )}
          <CopyButton text={code} label={t('render.copyCode')} />
        </div>
      </div>
      {diagram && !source ? (
        <Suspense fallback={plain}>
          <MermaidPreview code={code} />
        </Suspense>
      ) : (
        plain
      )}
    </div>
  )
}

function MarkdownPre({
  node,
  children
}: React.ComponentPropsWithoutRef<'pre'> & ExtraProps): React.JSX.Element {
  const code = node?.children[0]
  if (code?.type !== 'element' || code.tagName !== 'code') return <pre>{children}</pre>
  const classes = code.properties.className
  const language = Array.isArray(classes)
    ? String(classes.find((value) => String(value).startsWith('language-')) ?? '').slice(9)
    : ''
  const text = code.children
    .map((child) => (child.type === 'text' ? child.value : ''))
    .join('')
    .replace(/\n$/, '')
  return <CodeBlock code={text} language={language} />
}

function MarkdownLink({
  href = '',
  children
}: React.ComponentPropsWithoutRef<'a'>): React.JSX.Element {
  const { t } = useI18n()
  const [error, setError] = useState(false)
  const openFile = useContext(RemoteFileOpenContext)
  const file = fileLinkDetails(href)
  if (file) {
    const label =
      typeof children === 'string' && (children === href || fileLinkDetails(children))
        ? file.name
        : children
    const Icon = /\.(?:md|txt|rst)$/i.test(file.name)
      ? FileText
      : /\.(?:py|js|jsx|ts|tsx|json|css|html|sh|rs|go|java|c|cpp|yml|yaml)$/i.test(file.name)
        ? FileCode2
        : File
    const suffix =
      file.line && !String(label).includes(`line ${file.line}`) ? ` (line ${file.line})` : ''
    const caption = (
      <>
        <Icon size={15} aria-hidden="true" />
        <span>
          {typeof label === 'string' ? (
            `${label}${suffix}`
          ) : (
            <>
              {label}
              {suffix}
            </>
          )}
        </span>
      </>
    )
    const tooltip = `${file.path}${file.line ? ` (line ${file.line})` : ''}`
    return (
      <FileReferenceHint path={tooltip}>
        {openFile && resolveRemoteFileReference(href, '~') ? (
          <button className="markdown-file-link" type="button" onClick={() => openFile(href)}>
            {caption}
          </button>
        ) : (
          <CopyButton
            className="markdown-file-link"
            text={href}
            label={t('render.copyPath', { path: href })}
          >
            {caption}
          </CopyButton>
        )}
      </FileReferenceHint>
    )
  }
  if (!isWebLink(href)) return <span>{children}</span>
  return (
    <>
      <a
        href={href}
        title={href}
        onClick={(event) => {
          event.preventDefault()
          void window.claudeBridge.app.openExternal(href).catch(() => setError(true))
        }}
      >
        {children}
      </a>
      {error && (
        <span className="copy-error" role="status">
          {t('render.openFailed')}
        </span>
      )}
    </>
  )
}

function MarkdownImage({
  src,
  alt = ''
}: React.ComponentPropsWithoutRef<'img'>): React.JSX.Element {
  const { t } = useI18n()
  if (typeof src === 'string' && src.startsWith('data:image/'))
    return <img className="markdown-image" src={src} alt={alt} loading="lazy" />
  return (
    <span className="markdown-image-reference">
      <ImageIcon size={14} />
      <MarkdownLink href={typeof src === 'string' ? src : ''}>
        {alt || t('render.openImage')}
      </MarkdownLink>
    </span>
  )
}

function MarkdownTable({ children }: React.ComponentPropsWithoutRef<'table'>): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div
      className="markdown-table-scroll"
      role="region"
      aria-label={t('render.table')}
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  )
}

const components: Components = {
  code: ({ children, className }) => {
    const path = typeof children === 'string' ? children : ''
    if (fileLinkDetails(path)) return <MarkdownLink href={path}>{children}</MarkdownLink>
    return <code className={className}>{children}</code>
  },
  pre: MarkdownPre,
  table: MarkdownTable,
  a: MarkdownLink,
  img: MarkdownImage
}

export const MarkdownContent = memo(function MarkdownContent({
  text
}: {
  text: string
}): React.JSX.Element {
  return (
    <div className="markdown-content">
      <ContentBoundary source={text}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
          urlTransform={markdownUrl}
          skipHtml
        >
          {text}
        </ReactMarkdown>
      </ContentBoundary>
    </div>
  )
})
