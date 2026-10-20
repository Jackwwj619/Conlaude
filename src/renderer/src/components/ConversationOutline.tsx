import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { ConversationTurn } from '../conversation-turns'
import { useI18n } from '../i18n'
import '../conversation-outline.css'

interface Props {
  turns: ConversationTurn[]
  timeline: RefObject<HTMLElement | null>
  onNavigate: (id: string) => void
}

export function ConversationOutline({ turns, timeline, onNavigate }: Props): React.JSX.Element {
  const { language } = useI18n()
  const zh = language === 'zh-CN'
  const tooltipId = useId()
  const root = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [activeId, setActiveId] = useState<string>()
  const [hoveredId, setHoveredId] = useState<string>()
  const [focusedId, setFocusedId] = useState<string>()
  const selectedId = hoveredId ?? focusedId
  const selectedIndex = turns.findIndex((turn) => turn.id === selectedId)
  const selected = turns[selectedIndex]
  const currentId = activeId ?? turns[0]?.id
  const answer = selected?.events
    .filter((event) => event.kind === 'assistant' && event.isFinal !== false && event.text?.trim())
    .map((event) => event.text)
    .join('\n\n')
    .slice(0, 900)

  const cancelClose = (): void => clearTimeout(closeTimer.current)
  const scheduleClose = (): void => {
    cancelClose()
    closeTimer.current = setTimeout(() => setHoveredId(undefined), 120)
  }
  useEffect(() => {
    if (!selectedId) return
    // A hover preview can be open while focus stays in the composer. Dismiss it
    // before the editor consumes Escape for its own command shortcuts.
    const dismiss = (event: KeyboardEvent): void => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('[aria-modal="true"]')
      )
        return
      event.preventDefault()
      event.stopPropagation()
      clearTimeout(closeTimer.current)
      setHoveredId(undefined)
      setFocusedId(undefined)
    }
    window.addEventListener('keydown', dismiss, true)
    return () => window.removeEventListener('keydown', dismiss, true)
  }, [selectedId])
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useEffect(() => {
    const element = timeline.current
    if (!element) return
    let frame = 0
    const update = (): void => {
      frame = 0
      const prompts = element.querySelectorAll<HTMLElement>('[data-outline-turn]')
      if (!prompts.length) return
      const top = element.getBoundingClientRect().top + 32
      // Measure only outer prompt boxes; keep offscreen replies under content-visibility.
      let low = 0
      let high = prompts.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (prompts[middle]!.getBoundingClientRect().top <= top) low = middle + 1
        else high = middle
      }
      setActiveId(prompts[Math.max(0, low - 1)]?.dataset.outlineTurn)
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    schedule()
    element.addEventListener('scroll', schedule, { passive: true })
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(element)
    if (element.firstElementChild) observer?.observe(element.firstElementChild)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      element.removeEventListener('scroll', schedule)
    }
  }, [timeline, turns])

  useEffect(() => {
    if (selectedId) return
    const list = rail.current
    const button = list?.querySelector<HTMLElement>('[aria-current="location"]')
    if (!list || !button || !list.clientHeight || !button.offsetHeight) return
    if (button.offsetTop < list.scrollTop) list.scrollTop = button.offsetTop
    else if (button.offsetTop + button.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = button.offsetTop + button.offsetHeight - list.clientHeight
  }, [currentId, selectedId])

  useEffect(() => {
    const container = root.current
    const card = preview.current
    const list = rail.current
    const button = list?.querySelector<HTMLElement>('[data-preview="true"]')
    if (!container || !card || !button) return
    const position = (): void => {
      const bounds = container.getBoundingClientRect()
      const anchor = button.getBoundingClientRect()
      const top = anchor.top - bounds.top + anchor.height / 2 - card.offsetHeight / 2
      card.style.top = `${Math.max(0, Math.min(top, bounds.height - card.offsetHeight))}px`
    }
    position()
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position)
    observer?.observe(container)
    observer?.observe(card)
    list?.addEventListener('scroll', position, { passive: true })
    return () => {
      observer?.disconnect()
      list?.removeEventListener('scroll', position)
    }
  }, [selectedId, answer])

  return (
    <div className="conversation-outline" ref={root}>
      <nav
        className="conversation-outline-rail"
        aria-label={zh ? '对话大纲' : 'Conversation outline'}
        ref={rail}
        onPointerLeave={scheduleClose}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(undefined)
        }}
      >
        {turns.map((turn, index) => {
          const distance = selectedIndex < 0 ? Infinity : Math.abs(index - selectedIndex)
          const width = 10 + 24 * Math.exp(-(distance * distance) / 5)
          return (
            <button
              type="button"
              key={turn.id}
              className="conversation-outline-item"
              aria-label={`${zh ? '跳转到第' : 'Jump to turn '}${index + 1}${zh ? '轮：' : ': '}${turn.prompt.text?.slice(0, 100)}`}
              aria-current={currentId === turn.id ? 'location' : undefined}
              aria-describedby={selectedId === turn.id ? tooltipId : undefined}
              data-preview={selectedId === turn.id}
              tabIndex={(focusedId ?? currentId) === turn.id ? 0 : -1}
              style={{ '--outline-line-width': `${width}px` } as CSSProperties}
              onPointerMove={() => {
                cancelClose()
                setFocusedId(undefined)
                setHoveredId(turn.id)
              }}
              onPointerDown={(event) => {
                // Pointer navigation must not leave a keyboard preview stuck open.
                if (event.button === 0) event.preventDefault()
              }}
              onFocus={() => {
                setHoveredId(undefined)
                setFocusedId(turn.id)
              }}
              onKeyDown={(event) => {
                const next =
                  event.key === 'ArrowDown'
                    ? Math.min(index + 1, turns.length - 1)
                    : event.key === 'ArrowUp'
                      ? Math.max(index - 1, 0)
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? turns.length - 1
                          : undefined
                if (next === undefined) return
                event.preventDefault()
                const button = rail.current?.querySelectorAll('button')[next]
                button?.focus({ preventScroll: true })
                button?.scrollIntoView({ block: 'nearest' })
              }}
              onClick={() => onNavigate(turn.id)}
            >
              <span className="conversation-outline-line" aria-hidden="true" />
            </button>
          )
        })}
      </nav>
      {selected && (
        <div
          className="conversation-outline-preview"
          ref={preview}
          id={tooltipId}
          role="tooltip"
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
        >
          <strong>{selected.prompt.text}</strong>
          <p>{answer || (zh ? '暂无回答' : 'No response yet')}</p>
        </div>
      )}
    </div>
  )
}
