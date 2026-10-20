import { MoreHorizontal } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '../use-escape-key'

export interface SidebarMenuItem {
  label: string
  icon: ReactNode
  run: () => void
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

/** Shared by the row's context gesture, keyboard and more-actions button. */
export function SidebarRowMenu({
  label,
  className,
  items,
  children,
  actions,
  showTrigger = true
}: {
  label: string
  className: string
  items: SidebarMenuItem[]
  children: ReactNode
  actions?: ReactNode
  showTrigger?: boolean
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<{ x: number; y: number; rowX: number; rowY: number }>()
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const close = (): void => {
    setAnchor(undefined)
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
  }
  useEscapeKey(close, !!anchor)
  const open = (x: number, y: number, origin: HTMLElement): void => {
    window.dispatchEvent(new Event('clb:sidebar-menu-open'))
    returnFocus.current = origin
    const bounds = origin.getBoundingClientRect()
    setAnchor({ x, y, rowX: bounds.x, rowY: bounds.y })
  }
  useLayoutEffect(() => {
    if (!anchor || !menu.current) return
    const place = (): void => {
      if (!menu.current) return
      const bounds = menu.current.getBoundingClientRect()
      const row = returnFocus.current?.getBoundingClientRect()
      setPosition({
        left: Math.max(
          8,
          Math.min(anchor.x + (row ? row.x - anchor.rowX : 0), innerWidth - bounds.width - 8)
        ),
        top: Math.max(
          8,
          Math.min(anchor.y + (row ? row.y - anchor.rowY : 0), innerHeight - bounds.height - 8)
        )
      })
    }
    place()
    menu.current
      .querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus({ preventScroll: true })
    document.addEventListener('scroll', place, true)
    return () => document.removeEventListener('scroll', place, true)
  }, [anchor])
  useEffect(() => {
    if (!anchor) return
    const dismiss = (): void => setAnchor(undefined)
    const outside = (event: PointerEvent): void => {
      if (
        !root.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        dismiss()
    }
    const scroll = (event: Event): void => {
      if (!menu.current?.contains(event.target as Node)) dismiss()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('wheel', scroll, true)
    document.addEventListener('touchmove', scroll, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    window.addEventListener('clb:sidebar-menu-open', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('wheel', scroll, true)
      document.removeEventListener('touchmove', scroll, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('clb:sidebar-menu-open', dismiss)
    }
  }, [anchor])
  return (
    <div
      ref={root}
      className={`sidebar-menu-row ${className}`}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const row = root.current!.querySelector<HTMLButtonElement>('button')!
        const bounds = row.getBoundingClientRect()
        open(event.clientX || bounds.right, event.clientY || bounds.bottom, row)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
        event.preventDefault()
        event.stopPropagation()
        const row = event.target as HTMLElement
        const bounds = row.getBoundingClientRect()
        open(bounds.right, bounds.bottom, row)
      }}
    >
      {children}
      {showTrigger && (
        <div className="session-row-actions">
          {actions}
          <button
            ref={trigger}
            className="icon-button"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={!!anchor}
            onClick={() => {
              if (anchor) close()
              else {
                const bounds = trigger.current!.getBoundingClientRect()
                open(bounds.right - 204, bounds.bottom + 4, trigger.current!)
              }
            }}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      )}
      {anchor &&
        createPortal(
          <div
            ref={menu}
            className="session-row-menu sidebar-context-menu"
            role="menu"
            aria-label={label}
            style={{ left: position.left, top: position.top }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault()
                close()
                return
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
              ]
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
                      buttons.length
              buttons[next]?.focus()
            }}
          >
            {items.map((item) => (
              <div key={item.label}>
                {item.separator && <hr role="separator" />}
                <button
                  role="menuitem"
                  disabled={item.disabled}
                  className={item.danger ? 'danger' : undefined}
                  onClick={() => {
                    close()
                    item.run()
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
