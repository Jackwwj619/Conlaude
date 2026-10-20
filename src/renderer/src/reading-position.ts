export interface ReadingPosition {
  top: number
  follow: boolean
  anchorId?: string
  paragraph?: number
  offset?: number
  unread?: boolean
}
const KEY = 'clb:reading:v2'
const positions = new Map<string, ReadingPosition>()
try {
  const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
  if (Array.isArray(saved))
    for (const entry of saved.slice(-200)) {
      if (
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        entry[1] &&
        Number.isFinite(entry[1].top)
      )
        positions.set(entry[0], entry[1])
    }
} catch {
  /* A missing UI cache never prevents reading. */
}
export function readPosition(key?: string): ReadingPosition | undefined {
  return key ? positions.get(key) : undefined
}
export function savePosition(
  key: string | undefined,
  position: ReadingPosition,
  persist = false
): void {
  if (!key) return
  positions.set(key, position)
  if (positions.size > 200) positions.delete(positions.keys().next().value!)
  if (persist)
    try {
      localStorage.setItem(KEY, JSON.stringify([...positions]))
    } catch {
      /* Keep memory cache usable. */
    }
}
const blocks = (element: Element): Element[] => [
  ...element.querySelectorAll(
    '.message-body p, .message-body li, .message-body pre, .message-body h1, .message-body h2, .message-body h3, .message-body table'
  )
]
export function capturePosition(
  element: HTMLElement,
  follow: boolean,
  unread = false
): ReadingPosition {
  // Following output needs only a bottom marker, not geometry from every old reply.
  if (follow) return { top: element.scrollTop, follow, unread }
  const top = element.getBoundingClientRect().top
  const items = element.querySelectorAll<HTMLElement>(
    '.timeline-inner > [data-timeline-id], .timeline-inner > .turn-response'
  )
  // Only measure the visible turn. Measuring descendants of every offscreen turn
  // defeats content-visibility and forces Chromium to lay out the whole history.
  let low = 0
  let high = items.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (items[middle]!.getBoundingClientRect().bottom > top + 1) high = middle
    else low = middle + 1
  }
  const item = items[low]
  const anchor = item?.dataset.timelineId
    ? item
    : [...(item?.querySelectorAll<HTMLElement>('[data-timeline-id]') ?? [])].find(
        (node) => node.getBoundingClientRect().bottom > top + 1
      )
  const paragraphs = anchor ? blocks(anchor) : []
  const paragraph = paragraphs.findIndex((node) => node.getBoundingClientRect().bottom > top + 1)
  const node = paragraph >= 0 ? paragraphs[paragraph]! : anchor
  return {
    top: element.scrollTop,
    follow,
    unread,
    anchorId: anchor?.dataset.timelineId,
    paragraph: paragraph >= 0 ? paragraph : undefined,
    offset: node ? node.getBoundingClientRect().top - top : 0
  }
}
export function restorePosition(element: HTMLElement, position: ReadingPosition): void {
  const anchor = position.anchorId
    ? element.querySelector<HTMLElement>(`[data-timeline-id="${CSS.escape(position.anchorId)}"]`)
    : null
  const node =
    anchor && position.paragraph !== undefined
      ? (blocks(anchor)[position.paragraph] ?? anchor)
      : anchor
  if (node)
    element.scrollTop +=
      node.getBoundingClientRect().top -
      element.getBoundingClientRect().top -
      (position.offset ?? 0)
  else if (element.scrollTop !== position.top) element.scrollTop = position.top
}
