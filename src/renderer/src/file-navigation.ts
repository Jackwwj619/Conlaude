import { createContext } from 'react'
import { fileLinkDetails } from './markdown-links'

export const RemoteFileOpenContext = createContext<((reference: string) => void) | undefined>(
  undefined
)

/** Remote Linux paths only; never turn a conversation link into a shell command or local read. */
export function resolveRemoteFileReference(reference: string, cwd: string): string | undefined {
  let path: string
  try {
    path = decodeURIComponent(reference)
  } catch {
    return undefined
  }
  if (!fileLinkDetails(path) || /^[a-z]:[\\/]/i.test(path)) return undefined
  path = path.replace(/#L\d+(?:C\d+)?$/i, '').replace(/:\d+(?::\d+)?$/, '')
  if (path.startsWith('/') || path.startsWith('~/')) return path
  return `${cwd.replace(/\/$/, '')}/${path}`
}

export function remoteParent(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || '/'
}

interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

/** Link bare absolute/home/dot-relative paths, while leaving URLs and code blocks untouched. */
export function remarkRemoteFilePaths(): (tree: MarkdownNode) => void {
  return (tree) => {
    const visit = (node: MarkdownNode): void => {
      if (!node.children || ['link', 'code', 'inlineCode', 'html'].includes(node.type)) return
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== 'text' || !child.value) {
          visit(child)
          return [child]
        }
        const text = child.value
        const result: MarkdownNode[] = []
        const pattern = /(^|[\s（(])((?:\/(?!\/)|~\/|\.{1,2}\/)[^\s<>()（）]+)/g
        let offset = 0
        for (const match of text.matchAll(pattern)) {
          const start = match.index + match[1]!.length
          const path = match[2]!.replace(/[.,;!?，。；！？]+$/, '')
          if (!fileLinkDetails(path)) continue
          result.push({ type: 'text', value: text.slice(offset, start) })
          result.push({ type: 'link', url: path, children: [{ type: 'text', value: path }] })
          offset = start + path.length
        }
        if (!result.length) return [child]
        result.push({ type: 'text', value: text.slice(offset) })
        return result
      })
    }
    visit(tree)
  }
}
