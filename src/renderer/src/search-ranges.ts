/** Build real text ranges so repeated matches and inline Markdown can be navigated. */
export function findSearchRanges(root: Element, query: string): Range[] {
  if (!query) return []
  const nodes: { node: Text; start: number; end: number }[] = []
  let text = ''
  let previousBlock: Element | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (
      node.parentElement?.closest(
        'button, time, .message-actions, .code-block-header, [aria-hidden="true"], [hidden]'
      )
    )
      continue
    const content = node.textContent ?? ''
    if (!content) continue
    const block = node.parentElement?.closest('p, li, pre, h1, h2, h3, h4, h5, h6, td, th') ?? root
    if (previousBlock && block !== previousBlock) text += '\n'
    previousBlock = block
    nodes.push({ node: node as Text, start: text.length, end: text.length + content.length })
    text += content
  }
  const results: Range[] = []
  let firstIndex = 0
  let lastIndex = 0
  // Match the original string: lowercasing can change its UTF-16 length (for example İ).
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    const end = start + match[0].length
    while (firstIndex < nodes.length && nodes[firstIndex]!.end <= start) firstIndex += 1
    lastIndex = Math.max(firstIndex, lastIndex)
    while (lastIndex < nodes.length && nodes[lastIndex]!.end < end) lastIndex += 1
    const first = nodes[firstIndex]
    const last = nodes[lastIndex]
    if (first && last) {
      const range = document.createRange()
      range.setStart(first.node, start - first.start)
      range.setEnd(last.node, end - last.start)
      results.push(range)
    }
  }
  return results
}
