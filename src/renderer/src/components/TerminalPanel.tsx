import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'
import { Mouse, TerminalSquare, Maximize2, Minimize2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionTarget, TerminalControl } from '../../../shared/contracts'
import { terminalFontFamily } from '../../../shared/font-presets'
import { onWorkspaceCommand } from '../app-commands'
import { useI18n } from '../i18n'
import {
  clampTerminalPanelHeight,
  DEFAULT_TERMINAL_PANEL_HEIGHT,
  MIN_TERMINAL_PANEL_HEIGHT
} from '../panel-layout'
import { targetKey, useAppStore } from '../store'
import { useLayoutPreferences } from '../layout-preferences'
import { useEscapeKey } from '../use-escape-key'

interface Props {
  maximized?: boolean
  onMaximize?: () => void
  visible?: boolean
  docked?: boolean
  target?: SessionTarget
  connected: boolean
  readOnly: boolean
}

const PANEL_HEIGHT_KEY = 'clb:ui:terminal-panel-height'

function readPanelHeight(): number {
  const value = Number(localStorage.getItem(PANEL_HEIGHT_KEY))
  return Number.isFinite(value) && value >= MIN_TERMINAL_PANEL_HEIGHT
    ? value
    : DEFAULT_TERMINAL_PANEL_HEIGHT
}

function terminalTheme(): ITheme {
  if (document.documentElement.dataset.theme === 'light') {
    return {
      background: '#fcfdfe',
      foreground: '#2b3344',
      cursor: '#5d5ae1',
      cursorAccent: '#ffffff',
      selectionBackground: '#5d5ae133',
      black: '#202532',
      red: '#d14357',
      green: '#12805d',
      yellow: '#93610c',
      blue: '#2f6bd8',
      magenta: '#8250b5',
      cyan: '#0b7285',
      white: '#d9dde7',
      brightBlack: '#667085',
      brightWhite: '#ffffff'
    }
  }
  return {
    background: '#0e1117',
    foreground: '#d8dfec',
    cursor: '#8f8cf6',
    cursorAccent: '#0e1117',
    selectionBackground: '#8f8cf640',
    black: '#171a22',
    red: '#ff8090',
    green: '#5bd6a2',
    yellow: '#e8b86a',
    blue: '#84aaff',
    magenta: '#c099ff',
    cyan: '#67d4dc',
    white: '#d8dfec',
    brightBlack: '#7b8495',
    brightWhite: '#ffffff'
  }
}

export function TerminalPanel({
  maximized = false,
  onMaximize,
  target,
  connected,
  readOnly,
  visible = true,
  docked = false
}: Props): React.JSX.Element {
  const { t, language } = useI18n()
  const dockWidth = useLayoutPreferences((s) => s.filesWidth)
  const updateLayout = useLayoutPreferences((s) => s.update)
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | undefined>(undefined)
  const fitRef = useRef<FitAddon | undefined>(undefined)
  const searchRef = useRef<SearchAddon | undefined>(undefined)
  const targetRef = useRef(target)
  const directRef = useRef(false)
  const draggingPointer = useRef<number | undefined>(undefined)
  const [initialPanelHeight] = useState(readPanelHeight)
  const panelHeightRef = useRef(initialPanelHeight)
  const settings = useAppStore((state) => state.settings)
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const open = terminalOpen && visible
  const direct = useAppStore((state) => state.directControl)
  const setOpen = useAppStore((state) => state.setTerminalOpen)
  const setDirect = useAppStore((state) => state.setDirectControl)
  const workspaceMode = useAppStore((state) => state.workspaceMode)
  const setWorkspaceMode = useAppStore((state) => state.setWorkspaceMode)
  const showToast = useAppStore((state) => state.showToast)
  const [panelHeight, setPanelHeight] = useState(initialPanelHeight)
  const horizontal = workspaceMode === 'split'
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const nativeCommand = useAppStore((state) =>
    target ? state.nativeCommands[targetKey(target)] : undefined
  )
  const nativeReady = useAppStore((state) => {
    const status = target ? state.statuses[targetKey(target)] : undefined
    return status?.promptState === 'ready' && !status.generating
  })

  // Synchronization does not own navigation: the user can switch views at any time.
  useEffect(() => {
    if (!target || !nativeCommand || !nativeReady || !connected || readOnly) return
    const destination = target
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const synchronize = async (): Promise<void> => {
      try {
        await window.claudeBridge.prompts.finishCommand(destination)
        if (
          !cancelled &&
          useAppStore.getState().nativeCommands[targetKey(destination)] === nativeCommand
        )
          useAppStore.getState().setNativeCommand(destination)
      } catch {
        // The terminal may still be redrawing or the live binding may be pending.
        if (!cancelled) timer = setTimeout(() => void synchronize(), 2000)
      }
    }
    timer = setTimeout(() => void synchronize(), 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [target, nativeCommand, nativeReady, connected, readOnly])

  useEffect(
    () =>
      onWorkspaceCommand((command) => {
        const terminal = terminalRef.current
        if (!open || !terminal) return
        const report = (error: unknown): void =>
          showToast({
            level: 'error',
            title: t('app.controlFailed'),
            body: error instanceof Error ? error.message : String(error)
          })
        if (command === 'terminal-copy')
          void navigator.clipboard.writeText(terminal.getSelection()).catch(report)
        if (command === 'terminal-selectAll') terminal.selectAll()
        if (command === 'terminal-paste' && direct && connected && !readOnly) {
          const destination = targetRef.current
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (directRef.current && destination === targetRef.current) terminal.paste(text)
            })
            .catch(report)
        }
      }),
    [open, direct, connected, readOnly, showToast, t]
  )
  const closeSearch = useCallback((): void => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [])

  useEscapeKey(closeSearch, searchOpen)
  // Keep Escape available to the remote Claude TUI while direct control is enabled.
  useEscapeKey(() => setOpen(false), open && !direct && !searchOpen)

  const workspace = useCallback(
    (): HTMLElement | undefined =>
      hostRef.current?.closest<HTMLElement>('.dock-layout') ?? undefined,
    []
  )

  const applyPanelHeight = useCallback(
    (requestedHeight: number): number => {
      const container = workspace()
      if (!container) return requestedHeight
      const next = clampTerminalPanelHeight(container.clientHeight, requestedHeight)
      panelHeightRef.current = next
      container.style.setProperty('--terminal-panel-height', `${next}px`)
      return next
    },
    [workspace]
  )

  const savePanelHeight = useCallback(
    (requestedHeight: number): void => {
      const next = applyPanelHeight(requestedHeight)
      setPanelHeight(next)
      localStorage.setItem(PANEL_HEIGHT_KEY, String(next))
    },
    [applyPanelHeight]
  )

  useEffect(() => {
    targetRef.current = target
    const terminal = terminalRef.current
    if (terminal) {
      terminal.reset()
      if (target) terminal.write(useAppStore.getState().terminalBuffers[targetKey(target)] ?? '')
      requestAnimationFrame(() => fitRef.current?.fit())
    }
  }, [target])

  useEffect(() => {
    if (nativeCommand && connected && !readOnly) {
      setOpen(true)
      setDirect(true)
    }
  }, [nativeCommand, target, connected, readOnly, setOpen, setDirect])

  useEffect(() => {
    setDirect(!!target && connected && !readOnly)
  }, [target, connected, readOnly, setDirect])

  useEffect(() => {
    directRef.current = direct
    if (direct && open) terminalRef.current?.focus()
  }, [direct, open])

  useEffect(() => {
    const container = workspace()
    if (!container) return
    applyPanelHeight(panelHeightRef.current)
    const observer = new ResizeObserver(() => {
      const next = applyPanelHeight(panelHeightRef.current)
      setPanelHeight(next)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [applyPanelHeight, workspace])

  useEffect(() => {
    if (!hostRef.current || terminalRef.current) return
    const currentSettings = useAppStore.getState().settings
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: currentSettings?.terminal.cursorBlink ?? true,
      cursorStyle: currentSettings?.terminal.cursorStyle ?? 'block',
      lineHeight: currentSettings?.terminal.lineHeight ?? 1,
      fontFamily: terminalFontFamily(currentSettings?.terminal.font ?? 'cascadia-mono'),
      fontSize: currentSettings?.terminal.fontSize ?? 14,
      scrollback: currentSettings?.terminal.scrollback ?? 30000,
      theme: terminalTheme()
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(search)
    terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void window.claudeBridge.app.openExternal(uri)
      })
    )
    terminal.open(hostRef.current)
    fit.fit()
    terminalRef.current = terminal
    fitRef.current = fit
    searchRef.current = search

    let fitFrame: number | undefined
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let pendingResize: { cols: number; rows: number } | undefined
    const scheduleFit = (): void => {
      if (fitFrame !== undefined) return
      fitFrame = requestAnimationFrame(() => {
        fitFrame = undefined
        fit.fit()
      })
    }
    const flushRemoteResize = (): void => {
      resizeTimer = undefined
      const activeTarget = targetRef.current
      if (!activeTarget || !pendingResize) return
      const size = pendingResize
      pendingResize = undefined
      void window.claudeBridge.terminal.resize({ ...activeTarget, ...size }).catch(() => undefined)
    }

    const dataDisposable = terminal.onData((data) => {
      const activeTarget = targetRef.current
      if (!directRef.current || !activeTarget) return
      void window.claudeBridge.terminal.writeInput({ ...activeTarget, data }).catch(() => undefined)
    })
    const resizeDisposable = terminal.onResize((size) => {
      pendingResize = size
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(flushRemoteResize, 50)
    })
    const unsubscribe = window.claudeBridge.events.subscribe((event) => {
      const activeTarget = targetRef.current
      if (
        event.type === 'pty-data' &&
        activeTarget &&
        targetKey(event.target) === targetKey(activeTarget)
      ) {
        terminal.write(event.data)
      }
    })
    const observer = new ResizeObserver(scheduleFit)
    observer.observe(hostRef.current)
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    return () => {
      unsubscribe()
      observer.disconnect()
      themeObserver.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame)
      if (resizeTimer) clearTimeout(resizeTimer)
      terminal.dispose()
      terminalRef.current = undefined
    }
  }, [])

  useEffect(() => {
    if (open) {
      applyPanelHeight(panelHeightRef.current)
      const frame = requestAnimationFrame(() => fitRef.current?.fit())
      return () => cancelAnimationFrame(frame)
    }
  }, [applyPanelHeight, open])

  useEffect(() => {
    if (!terminalRef.current || !settings) return
    terminalRef.current.options.fontFamily = terminalFontFamily(settings.terminal.font)
    terminalRef.current.options.fontSize = settings.terminal.fontSize
    terminalRef.current.options.scrollback = settings.terminal.scrollback
    terminalRef.current.options.lineHeight = settings.terminal.lineHeight
    terminalRef.current.options.cursorStyle = settings.terminal.cursorStyle
    terminalRef.current.options.cursorBlink = settings.terminal.cursorBlink
    terminalRef.current.options.theme = terminalTheme()
    fitRef.current?.fit()
  }, [settings])

  const heightFromPointer = (clientY: number): number => {
    const container = workspace()
    if (!container) return panelHeightRef.current
    const bounds = container.getBoundingClientRect()
    const statusBarHeight = container.querySelector<HTMLElement>('.status-bar')?.offsetHeight ?? 0
    return clampTerminalPanelHeight(
      container.clientHeight,
      bounds.bottom - statusBarHeight - clientY
    )
  }

  const finishResize = (): void => {
    if (draggingPointer.current === undefined) return
    draggingPointer.current = undefined
    document.body.classList.remove('resizing-terminal-panel')
    savePanelHeight(panelHeightRef.current)
  }

  useEffect(
    () => () => {
      document.body.classList.remove('resizing-terminal-panel')
    },
    []
  )

  const toggleMaximize = (): void => {
    setWorkspaceMode(horizontal ? 'terminal' : 'split')
  }

  const sendControl = (control: TerminalControl): void => {
    if (!target || !connected || readOnly) return
    void window.claudeBridge.terminal.writeControl({ ...target, control }).catch((error) =>
      showToast({
        level: 'error',
        title: t('app.controlFailed'),
        body: error instanceof Error ? error.message : String(error)
      })
    )
  }

  const updateSearch = (query: string): void => {
    setSearchQuery(query)
    if (query) searchRef.current?.findNext(query)
  }

  return (
    <section
      onKeyDownCapture={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === 'f'
        ) {
          event.preventDefault()
          event.stopPropagation()
          setSearchOpen(true)
          requestAnimationFrame(() =>
            document.querySelector<HTMLInputElement>('.terminal-search-input')?.focus()
          )
        }
      }}
      id="terminal-panel"
      hidden={!open}
      data-docked={docked}
      className={`terminal-drawer ${open ? 'open' : ''}`}
      aria-label={t('terminal.label')}
    >
      <div
        hidden={docked}
        className="terminal-sash"
        role="separator"
        aria-label={t('terminal.resize')}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuemin={horizontal ? 300 : MIN_TERMINAL_PANEL_HEIGHT}
        aria-valuemax={undefined}
        aria-valuenow={horizontal ? (dockWidth ?? 500) : panelHeight}
        tabIndex={open ? 0 : -1}
        onDoubleClick={toggleMaximize}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          draggingPointer.current = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
          document.body.classList.add('resizing-terminal-panel')
        }}
        onPointerMove={(event) => {
          if (draggingPointer.current !== event.pointerId) return
          if (horizontal) {
            const bounds = workspace()!.getBoundingClientRect()
            updateLayout({
              filesWidth: Math.max(300, Math.min(bounds.right - event.clientX, bounds.width - 300))
            })
          } else applyPanelHeight(heightFromPointer(event.clientY))
        }}
        onPointerUp={(event) => {
          if (draggingPointer.current !== event.pointerId) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          finishResize()
        }}
        onLostPointerCapture={finishResize}
        onKeyDown={(event) => {
          if (horizontal) {
            if (event.key === 'ArrowLeft')
              updateLayout({
                filesWidth: Math.min(
                  (dockWidth ?? 500) + 24,
                  (workspace()?.clientWidth ?? 1000) - 300
                )
              })
            else if (event.key === 'ArrowRight')
              updateLayout({ filesWidth: Math.max(300, (dockWidth ?? 500) - 24) })
            else if (event.key === 'Home') updateLayout({ filesWidth: 340 })
            else if (event.key === 'End')
              updateLayout({ filesWidth: Math.max(300, (workspace()?.clientWidth ?? 1000) - 300) })
            else return
            event.preventDefault()
            return
          }
          const step = event.shiftKey ? 40 : 16
          if (event.key === 'ArrowUp') savePanelHeight(panelHeightRef.current + step)
          else if (event.key === 'ArrowDown') savePanelHeight(panelHeightRef.current - step)
          else if (event.key === 'Home') savePanelHeight(MIN_TERMINAL_PANEL_HEIGHT)
          else if (event.key === 'End') toggleMaximize()
          else return
          event.preventDefault()
        }}
      />
      <div className="terminal-toolbar dock-header">
        <div className={`terminal-title ${docked ? 'sr-only' : ''}`}>
          <TerminalSquare size={14} />
          <span>{language === 'zh-CN' ? '终端' : 'Terminal'}</span>
          <span className="terminal-note">{t('terminal.note')}</span>
        </div>
        <div className="terminal-actions">
          {searchOpen && (
            <input
              className="terminal-search-input"
              autoFocus
              value={searchQuery}
              onChange={(event) => updateSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchQuery) searchRef.current?.findNext(searchQuery)
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeSearch()
                }
              }}
              placeholder={t('terminal.search')}
            />
          )}
          <button
            className={`control-toggle ${direct ? 'active' : ''}`}
            aria-pressed={direct}
            onClick={() => setDirect(!direct)}
            disabled={!target || !connected || readOnly}
            title={t('terminal.directHint')}
          >
            <Mouse size={16} />
            {direct ? t('terminal.directOn') : t('terminal.direct')}
          </button>
          <button
            className="icon-button"
            hidden={docked}
            onClick={onMaximize}
            aria-label={
              language === 'zh-CN'
                ? maximized
                  ? '还原底部栏'
                  : '全屏底部栏'
                : maximized
                  ? 'Restore bottom panel'
                  : 'Maximize bottom panel'
            }
            title={
              language === 'zh-CN'
                ? maximized
                  ? '还原底部栏'
                  : '全屏底部栏'
                : maximized
                  ? 'Restore bottom panel'
                  : 'Maximize bottom panel'
            }
          >
            {maximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button
            className="icon-button"
            hidden={docked}
            onClick={() => {
              closeSearch()
              setOpen(false)
            }}
            title={language === 'zh-CN' ? '关闭终端面板' : 'Close terminal panel'}
            aria-label={language === 'zh-CN' ? '关闭终端面板' : 'Close terminal panel'}
          >
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="terminal-control-bar key-controls" aria-label={t('header.controls')}>
        {(
          [
            ['escape', 'Esc'],
            ['arrowUp', '↑'],
            ['arrowDown', '↓'],
            ['enter', 'Enter'],
            ['ctrlC', 'Ctrl+C']
          ] as const
        ).map(([control, label]) => (
          <button
            key={control}
            onClick={() => sendControl(control)}
            disabled={!connected || readOnly}
          >
            {label}
          </button>
        ))}
        <span>
          {readOnly
            ? t('statusbar.readOnly')
            : direct
              ? t('terminal.directOn')
              : t('terminal.directHint')}
        </span>
      </div>
      <div className="terminal-viewport" aria-hidden={!open}>
        <div ref={hostRef} className="xterm-host" />
      </div>
    </section>
  )
}
