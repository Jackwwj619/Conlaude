import { useEffect, useRef, useState, type ReactNode } from 'react'
import { runWorkspaceCommand } from '../app-commands'
import { targetKey, useAppStore } from '../store'
import { useI18n } from '../i18n'
import { SidebarToggleIcon } from './SidebarToggleIcon'
import { useWorkspacePreferences } from '../workspace-preferences'

const COMMAND_SHORTCUTS: Record<string, string> = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  cut: 'Ctrl+X',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  selectAll: 'Ctrl+A',
  find: 'Ctrl+F',
  'focus-input': 'Ctrl+Shift+P'
}

export interface AppMenuItem {
  id: string
  label: string
  run: () => void
  disabled?: boolean
  reason?: string
  shortcut?: string
}
export interface AppMenu {
  id: string
  label: string
  items: AppMenuItem[]
}

/** A single non-wrapping title bar; native Windows caption buttons occupy the right inset. */
export function AppTitleBar({
  menus,
  unavailableReason,
  panelControls,
  children
}: {
  menus: AppMenu[]
  unavailableReason?: string
  panelControls?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  const { language, t } = useI18n()
  const collapsed = useWorkspacePreferences((state) => state.collapsed)
  const setCollapsed = useWorkspacePreferences((state) => state.setCollapsed)
  const canPasteTerminal = useAppStore((state) => {
    const status = state.selected ? state.statuses[targetKey(state.selected)] : undefined
    return state.directControl && status?.state === 'attached' && !status.readOnly
  })
  const [open, setOpen] = useState<number>()
  const [compact, setCompact] = useState(() => innerWidth < 740)
  const visibleMenus = compact
    ? [
        ...menus.slice(0, 3),
        {
          id: 'more',
          label: language === 'zh-CN' ? '更多' : 'More',
          items: menus.slice(3).flatMap((menu) => menu.items)
        }
      ]
    : menus
  useEffect(() => {
    const resize = (): void => {
      setCompact(innerWidth < 740)
      setOpen(undefined)
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const bar = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const [terminalTarget, setTerminalTarget] = useState(false)
  const previousSelection = useRef<Range | undefined>(undefined)
  const close = (restore = true): void => {
    setOpen(undefined)
    if (restore && previousFocus.current?.isConnected)
      previousFocus.current.focus({ preventScroll: true })
    if (restore && previousSelection.current) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(previousSelection.current)
    }
  }
  const rememberFocus = (): void => {
    if (open !== undefined) return
    previousFocus.current = document.activeElement as HTMLElement
    setTerminalTarget(!!previousFocus.current?.closest('.terminal-drawer'))
    const selection = window.getSelection()
    previousSelection.current = selection?.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : undefined
  }
  useEffect(() => {
    if (open === undefined) return
    const outside = (event: PointerEvent): void => {
      if (!bar.current?.querySelector('.app-menubar')?.contains(event.target as Node))
        setOpen(undefined)
    }
    const blur = (): void => setOpen(undefined)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('blur', blur)
    const firstItem = bar.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)'
    )
    const trigger = bar.current?.querySelector<HTMLButtonElement>(
      '.app-menu-trigger[aria-expanded="true"]'
    )
    ;(firstItem ?? trigger)?.focus()
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('blur', blur)
    }
  }, [open])
  useEffect(() => {
    const access = (event: KeyboardEvent): void => {
      if (
        !(
          (event.key === 'F10' && !event.altKey) ||
          (event.altKey && ['f', 'e', 'v', 's', 'h'].includes(event.key.toLowerCase()))
        ) ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.repeat ||
        event.shiftKey ||
        document.querySelector('[role="dialog"]') ||
        (event.target as HTMLElement)?.closest('.terminal-drawer')
      )
        return
      event.preventDefault()
      previousFocus.current = document.activeElement as HTMLElement
      setTerminalTarget(false)
      const index =
        event.key === 'F10' ? 0 : ['f', 'e', 'v', 's', 'h'].indexOf(event.key.toLowerCase())
      setOpen(compact ? Math.min(index, 3) : index)
    }
    document.addEventListener('keydown', access)
    return () => document.removeEventListener('keydown', access)
  }, [compact])
  return (
    <header className="app-titlebar" ref={bar}>
      <nav
        className="app-menubar"
        aria-label={language === 'zh-CN' ? '应用菜单' : 'Application menu'}
        onKeyDown={(event) => {
          if (open === undefined) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
            return
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            setOpen(
              (open + (event.key === 'ArrowRight' ? 1 : visibleMenus.length - 1)) %
                visibleMenus.length
            )
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            const items = [
              ...bar.current!.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)'
              )
            ]
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
            items[next]?.focus()
          }
          if (event.key === 'Tab') close(false)
        }}
      >
        {visibleMenus.map((menu, index) => (
          <div className="app-menu" key={menu.id}>
            <button
              className="app-menu-trigger"
              title={`Alt+${menu.id === 'more' ? 'S / Alt+H' : menu.id[0]!.toUpperCase()}`}
              aria-haspopup="menu"
              aria-expanded={open === index}
              onMouseDown={(event) => {
                rememberFocus()
                event.preventDefault()
              }}
              onFocus={() => {
                if (open === undefined && !bar.current?.contains(previousFocus.current))
                  rememberFocus()
              }}
              onClick={() => {
                if (open === index) close()
                else {
                  rememberFocus()
                  setOpen(index)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && open === undefined) {
                  event.preventDefault()
                  rememberFocus()
                  setOpen(index)
                }
              }}
            >
              {menu.label}
            </button>
            {open === index && (
              <div className="app-menu-popup" role="menu" aria-label={menu.label}>
                {menu.items.map((item) => {
                  const terminalCommand =
                    menu.id === 'edit' &&
                    terminalTarget &&
                    ['copy', 'paste', 'selectAll'].includes(item.id)
                  const terminalEdit =
                    menu.id === 'edit' &&
                    item.id !== 'focus-input' &&
                    terminalTarget &&
                    (!terminalCommand || (item.id === 'paste' && !canPasteTerminal))
                  return (
                    <button
                      key={item.id}
                      role="menuitem"
                      aria-label={item.label}
                      disabled={item.disabled || terminalEdit}
                      title={
                        terminalEdit
                          ? language === 'zh-CN'
                            ? '请在真实终端中使用终端操作'
                            : 'Use terminal controls in the terminal'
                          : item.disabled
                            ? (item.reason ??
                              unavailableReason ??
                              (language === 'zh-CN'
                                ? '当前状态下不可用'
                                : 'Unavailable in the current state'))
                            : undefined
                      }
                      onClick={() => {
                        close()
                        if (terminalCommand)
                          runWorkspaceCommand(
                            `terminal-${item.id}` as
                              'terminal-copy' | 'terminal-paste' | 'terminal-selectAll'
                          )
                        else item.run()
                      }}
                    >
                      <span>{item.label}</span>
                      {(item.shortcut || COMMAND_SHORTCUTS[item.id]) && (
                        <kbd>{item.shortcut || COMMAND_SHORTCUTS[item.id]}</kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </nav>
      <button
        className="icon-button sidebar-visibility-toggle sidebar-close"
        aria-label={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
        title={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
        aria-expanded={!collapsed}
        aria-controls="workspace-sidebar"
        onClick={() => setCollapsed(!collapsed)}
      >
        <SidebarToggleIcon side="left" />
      </button>
      {children ?? <span className="app-titlebar-label">Conlaude</span>}
      {panelControls}
    </header>
  )
}
