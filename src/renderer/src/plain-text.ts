/** Copy the rendered reply without controls, retaining code and math source. */
export function renderedPlainText(root: Element): string {
  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof Element)) return ''
    if (node.matches('button, .copy-control, .sr-only, .code-block-toolbar, svg')) return ''
    if (node.hasAttribute('data-code-source')) return `\n${node.getAttribute('data-code-source')}\n`
    if (node.matches('.katex'))
      return node.querySelector('annotation')?.textContent ?? node.textContent ?? ''
    if (node.tagName === 'IMG') return node.getAttribute('alt') ?? ''
    if (node.tagName === 'BR') return '\n'
    const text = [...node.childNodes].map(visit).join('')
    if (node.matches('td, th')) return `${text}\t`
    if (node.matches('p, h1, h2, h3, h4, h5, h6, li, pre, tr, blockquote')) return `${text}\n`
    return text
  }
  return visit(root).trim()
}
