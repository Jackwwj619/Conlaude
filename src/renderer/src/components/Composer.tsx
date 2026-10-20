import { EMPTY_IMAGES, useImageAttachments } from '../image-attachments'
import { createPortal } from 'react-dom'
import { history, historyKeymap } from '@codemirror/commands'
import { TranscriptSyncNotice } from './TranscriptSyncNotice'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import {
  Paperclip,
  ArrowUp,
  LoaderCircle,
  ShieldCheck,
  Square,
  CircleCheck,
  CircleAlert,
  WifiOff,
  LockKeyhole,
  Server,
  X,
  FolderOpen
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { SessionTarget } from '../../../shared/contracts'
import { sanitizePrompt } from '../../../shared/prompt'
import { commandSuggestions, parseClaudeCommand } from '../../../shared/claude-commands'
import { canUpload, onWorkspaceCommand } from '../app-commands'
import { useI18n } from '../i18n'
import { targetKey, useAppStore } from '../store'
import { pruneInputHistory, readInputHistory } from '../composer-history'
import { useWorkspacePreferences } from '../workspace-preferences'

interface Props {
  target?: SessionTarget
  connected: boolean
  readOnly: boolean
  promptBlocked?: boolean
  active?: boolean
  statusBarHost?: HTMLDivElement | null
}

function draftKey(target?: SessionTarget): string {
  return target ? `clb:draft:${targetKey(target)}` : 'clb:draft:none'
}

function historyKey(target?: SessionTarget): string {
  return target ? `clb:history:${targetKey(target)}` : 'clb:history:none'
}

function readHistory(target?: SessionTarget): string[] {
  return readInputHistory(
    localStorage,
    historyKey(target),
    useAppStore.getState().settings?.composer.historyLimit ?? 100
  )
}

function insertComposerNewline(view: EditorView): boolean {
  view.dispatch(
    view.state.update(view.state.replaceSelection(view.state.lineBreak), {
      scrollIntoView: true,
      userEvent: 'input'
    })
  )
  return true
}

function canBrowseHistory(view: EditorView, direction: 'up' | 'down'): boolean {
  const selection = view.state.selection.main
  if (!selection.empty) return false

  // A single-line prompt behaves exactly like a terminal command line. In a
  // multi-line prompt, preserve normal arrow navigation until the cursor reaches
  // the relevant edge of the document.
  if (view.state.doc.lines === 1) return true
  return direction === 'up' ? selection.head === 0 : selection.head === view.state.doc.length
}

export function Composer({
  target,
  connected,
  readOnly,
  promptBlocked = false,
  active = true,
  statusBarHost
}: Props): React.JSX.Element {
  const { language, t } = useI18n()
  const editorHost = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | undefined>(undefined)
  const wrapping = useRef(new Compartment())
  const placeholderConfig = useRef(new Compartment())
  const uploadRef = useRef<() => Promise<void>>(async () => undefined)
  const sendRef = useRef<() => Promise<void>>(async () => undefined)
  const toggleModeRef = useRef<() => Promise<void>>(async () => undefined)
  const canToggleModeRef = useRef(false)
  const sendingRef = useRef(false)
  const commandKeyRef = useRef<(event: KeyboardEvent) => void>(() => {})
  const lastEscape = useRef(0)
  const [commandIndex, setCommandIndex] = useState(0)
  const [dismissedCommand, setDismissedCommand] = useState<string>()
  const stoppingRef = useRef(false)
  const [stopping, setStopping] = useState(false)
  const [now, setNow] = useState(Date.now)
  const historyCursor = useRef(-1)
  const historyDraft = useRef('')
  const [text, setText] = useState(() => localStorage.getItem(draftKey(target)) ?? '')
  const imagesKey = draftKey(target)
  const images = useImageAttachments((state) => state.drafts[imagesKey] ?? EMPTY_IMAGES)
  const imagesPending = images.some((image) => !image.remotePath)
  const sending = useAppStore((state) =>
    Boolean(target && state.composerBusy[targetKey(target)]?.sending)
  )
  const uploading = useAppStore((state) =>
    Boolean(target && state.composerBusy[targetKey(target)]?.uploading)
  )
  const feedback = useAppStore((state) =>
    target ? state.composerFeedback[targetKey(target)] : undefined
  )
  useEffect(() => {
    if (!target || !feedback?.message || feedback.kind === 'error' || sending || uploading) return
    const timer = setTimeout(() => {
      if (useAppStore.getState().composerFeedback[targetKey(target)] === feedback)
        useAppStore.getState().setComposerFeedback(target, { kind: 'info', message: '' })
    }, 8000)
    return () => clearTimeout(timer)
  }, [target, feedback, sending, uploading])
  const settings = useAppStore((state) => state.settings)
  const nativeCommand = useAppStore((state) =>
    target ? state.nativeCommands[targetKey(target)] : undefined
  )
  const suggestions = dismissedCommand === text ? [] : commandSuggestions(text)
  const model = useAppStore((state) =>
    target
      ? state.timelines[targetKey(target)]?.findLast((event) => Boolean(event.model))?.model
      : undefined
  )
  const delivery = useAppStore((state) => (target ? state.delivery[targetKey(target)] : undefined))
  const generating = useAppStore((state) =>
    Boolean(target && state.statuses[targetKey(target)]?.generating)
  )
  const progress = useAppStore((state) =>
    target ? state.uploadProgress[targetKey(target)] : undefined
  )
  const remoteSession = useAppStore((state) =>
    target
      ? state.sessionsByProfile[target.profileId]?.find(
          (session) => session.name === target.sessionName
        )
      : undefined
  )
  const profile = settings?.profiles.find((item) => item.id === target?.profileId)
  const permissionMode = useAppStore((state) =>
    target
      ? (state.statuses[targetKey(target)]?.permissionMode ?? state.claudeModes[targetKey(target)])
      : undefined
  )
  const addTimelineEvent = useAppStore((state) => state.addTimelineEvent)
  const showToast = useAppStore((state) => state.showToast)
  const permissionModeLabel = t(`composer.mode.${permissionMode ?? 'unknown'}`)
  const sendShortcut = settings?.composer.sendShortcut ?? 'Ctrl+Enter'
  const sendShortcutLabel =
    sendShortcut === 'Enter' ? t('composer.sendShortcutEnter') : t('composer.sendShortcutCtrlEnter')
  const shortcutHint =
    sendShortcut === 'Enter' ? t('composer.shortcutHintEnter') : t('composer.shortcutHintCtrlEnter')

  useEffect(() => {
    if (!uploading) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [uploading])
  useEffect(() => {
    if (!generating || !connected || promptBlocked) {
      stoppingRef.current = false
      // A remote status transition acknowledges the local stop request.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStopping(false)
    }
  }, [generating, connected, promptBlocked])
  useEffect(() => {
    if (!stopping || !target) return
    const timer = setTimeout(() => {
      useAppStore
        .getState()
        .setComposerFeedback(target, { kind: 'error', message: t('composer.stopUnconfirmed') })
    }, 15000)
    return () => clearTimeout(timer)
  }, [stopping, target, t])
  const stop = async (): Promise<void> => {
    if (!target || !connected || readOnly || promptBlocked || !generating || stoppingRef.current)
      return
    stoppingRef.current = true
    useAppStore.getState().requestTurnStop(target, true)
    setStopping(true)
    try {
      await window.claudeBridge.prompts.interrupt(target)
    } catch (error) {
      useAppStore.getState().requestTurnStop(target, false)
      stoppingRef.current = false
      setStopping(false)
      showToast({
        level: 'error',
        title: t('composer.stopFailed'),
        body: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const replaceEditor = useCallback((next: string, fromHistory = false): void => {
    const view = editor.current
    if (!view) return
    const transaction = {
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: next.length }
    }
    view.dispatch(
      fromHistory
        ? { ...transaction, annotations: Transaction.userEvent.of('input.history') }
        : transaction
    )
  }, [])

  useEffect(() => {
    const replaceDraft = (event: Event): void => {
      const { key, previous, next } = (
        event as CustomEvent<{ key: string; previous: string; next: string }>
      ).detail
      if (key === draftKey(target) && editor.current?.state.doc.toString() === previous)
        replaceEditor(next)
    }
    window.addEventListener('clb:replace-draft', replaceDraft)
    return () => window.removeEventListener('clb:replace-draft', replaceDraft)
  }, [target, replaceEditor])

  const navigateHistory = useCallback(
    (view: EditorView, direction: 'up' | 'down'): boolean => {
      if (!canBrowseHistory(view, direction)) return false
      const entries = readHistory(target)
      if (!entries.length) return false

      if (direction === 'up') {
        if (historyCursor.current < 0) historyDraft.current = view.state.doc.toString()
        historyCursor.current = Math.min(historyCursor.current + 1, entries.length - 1)
        replaceEditor(entries[historyCursor.current] ?? '', true)
        return true
      }

      if (historyCursor.current < 0) return false
      historyCursor.current -= 1
      replaceEditor(
        historyCursor.current < 0 ? historyDraft.current : (entries[historyCursor.current] ?? ''),
        true
      )
      return true
    },
    [replaceEditor, target]
  )

  useEffect(() => {
    canToggleModeRef.current = Boolean(target && connected && !readOnly && !promptBlocked)
  }, [connected, readOnly, target, promptBlocked])

  useEffect(() => {
    if (!editorHost.current || editor.current) return
    const initialText = localStorage.getItem(draftKey(target)) ?? ''
    const state = EditorState.create({
      doc: initialText,
      extensions: [
        history(),
        markdown(),
        wrapping.current.of(EditorView.lineWrapping),
        placeholderConfig.current.of([]),
        keymap.of([
          {
            key: 'Enter',
            run: (view) => {
              if (useAppStore.getState().settings?.composer.sendShortcut !== 'Enter') return false
              if (view.composing) return false
              void sendRef.current()
              return true
            },
            shift: insertComposerNewline
          },
          {
            key: 'Ctrl-Enter',
            run: (view) => {
              if (
                useAppStore.getState().settings?.composer.sendShortcut === 'Enter' ||
                view.composing
              )
                return false
              void sendRef.current()
              return true
            }
          },
          {
            key: 'ArrowUp',
            run: (view) =>
              (useAppStore.getState().settings?.composer.historyNavigation ?? 'arrows') ===
                'arrows' && navigateHistory(view, 'up')
          },
          {
            key: 'ArrowDown',
            run: (view) =>
              (useAppStore.getState().settings?.composer.historyNavigation ?? 'arrows') ===
                'arrows' && navigateHistory(view, 'down')
          },
          {
            key: 'Alt-ArrowUp',
            run: (view) =>
              useAppStore.getState().settings?.composer.historyNavigation === 'alt-arrows' &&
              navigateHistory(view, 'up')
          },
          {
            key: 'Alt-ArrowDown',
            run: (view) =>
              useAppStore.getState().settings?.composer.historyNavigation === 'alt-arrows' &&
              navigateHistory(view, 'down')
          },
          ...historyKeymap
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const next = update.state.doc.toString()
          setText(next)
          setDismissedCommand(undefined)
          setCommandIndex(0)
          lastEscape.current = 0
          const movedThroughHistory = update.transactions.some((transaction) =>
            transaction.isUserEvent('input.history')
          )
          if (!movedThroughHistory) localStorage.setItem(draftKey(target), next)
        }),
        EditorView.theme({
          '&': {
            backgroundColor: 'transparent',
            color: 'var(--text)',
            fontFamily: 'var(--interface-font-family)',
            fontSize: 'var(--composer-font-size, 14px)'
          },
          '.cm-content': {
            minHeight: '0',
            padding: '9px 12px',
            lineHeight: '1.5',
            caretColor: 'var(--accent)'
          },
          '.cm-scroller': { fontFamily: 'inherit' },
          '.cm-cursor': { borderLeftColor: 'var(--accent)' },
          '.cm-gutters': { display: 'none' },
          '.cm-activeLine': { backgroundColor: 'transparent' },
          '&.cm-focused': { outline: 'none' },
          '.cm-selectionBackground': { backgroundColor: 'var(--accent-soft) !important' }
        })
      ]
    })
    const view = new EditorView({ state, parent: editorHost.current })
    // Some IMEs mark keydown before CodeMirror receives compositionstart. Skip
    // shortcuts while leaving the native candidate-confirmation default intact.
    const guardComposition = (event: KeyboardEvent): void => {
      if (event.isComposing || event.keyCode === 229) {
        lastEscape.current = 0
        event.stopImmediatePropagation()
      } else commandKeyRef.current(event)
    }
    view.contentDOM.addEventListener('keydown', guardComposition, { capture: true })
    editor.current = view
    return () => {
      view.contentDOM.removeEventListener('keydown', guardComposition, { capture: true })
      editor.current?.destroy()
      editor.current = undefined
    }
  }, [navigateHistory, target])

  useEffect(() => {
    editor.current?.dispatch({
      effects: placeholderConfig.current.reconfigure(
        placeholder(t('composer.placeholder', { shortcutHint }))
      )
    })
  }, [shortcutHint, target, t])

  useEffect(() => {
    if (active && target && !document.querySelector('[aria-modal="true"]')) editor.current?.focus()
  }, [active, target])

  useEffect(() => {
    editor.current?.dispatch({
      effects: wrapping.current.reconfigure(
        settings?.composer.lineWrapping === false ? [] : EditorView.lineWrapping
      )
    })
  }, [
    settings?.composer.lineWrapping,
    language,
    navigateHistory,
    sendShortcut,
    shortcutHint,
    target,
    t
  ])

  useEffect(() => {
    pruneInputHistory(localStorage, settings?.composer.historyLimit ?? 100)
    historyCursor.current = -1
  }, [settings?.composer.historyLimit])

  const executeCommand = async (command: string): Promise<void> => {
    if (
      !target ||
      !connected ||
      readOnly ||
      promptBlocked ||
      generating ||
      sendingRef.current ||
      nativeCommand
    )
      return
    const destination = target
    sendingRef.current = true
    useAppStore.getState().setComposerBusy(destination, 'sending', true)
    try {
      await window.claudeBridge.prompts.command({ ...destination, text: command })
      useAppStore.getState().setNativeCommand(destination, command)
      if (localStorage.getItem(draftKey(destination)) === command) {
        localStorage.removeItem(draftKey(destination))
        window.dispatchEvent(
          new CustomEvent('clb:replace-draft', {
            detail: { key: draftKey(destination), previous: command, next: '' }
          })
        )
      }
    } catch (error) {
      showToast({
        level: 'error',
        title: language === 'zh-CN' ? '命令未执行' : 'Command not executed',
        body: error instanceof Error ? error.message : String(error)
      })
    } finally {
      sendingRef.current = false
      useAppStore.getState().setComposerBusy(destination, 'sending', false)
    }
  }

  const send = async (): Promise<void> => {
    const activeTarget = target
    const draftText = editor.current?.state.doc.toString() ?? text
    const sentImages = [...images]
    const message = [draftText, ...sentImages.map((image) => image.remotePath)]
      .filter(Boolean)
      .join('\n')
    if (
      !activeTarget ||
      !connected ||
      readOnly ||
      promptBlocked ||
      !message.trim() ||
      imagesPending ||
      uploading ||
      sending ||
      sendingRef.current ||
      stoppingRef.current
    )
      return
    if (nativeCommand) return
    if (parseClaudeCommand(message)) {
      await executeCommand(message)
      return
    }
    const limit = settings?.composer.maxCharacters ?? 200000
    if (message.length > limit) {
      showToast({
        level: 'error',
        title: t('composer.tooLong'),
        body: t('composer.limit', { limit: limit.toLocaleString(language) })
      })
      return
    }

    sendingRef.current = true
    useAppStore.getState().setComposerBusy(activeTarget, 'sending', true)
    useAppStore.getState().setComposerFeedback(activeTarget, { kind: 'info', message: '' })
    useAppStore.getState().setDelivery(activeTarget, 'sending')
    localStorage.setItem(draftKey(activeTarget), draftText)
    const requestId = crypto.randomUUID()
    const localId = `local-${requestId}`
    addTimelineEvent(activeTarget, {
      id: localId,
      kind: 'user',
      text: sanitizePrompt(message).text,
      timestamp: new Date().toISOString(),
      turnStartedAt: Date.now(),
      localDelivery: 'sending'
    })
    try {
      await window.claudeBridge.prompts
        .send({ ...activeTarget, requestId, text: message })
        .catch((error: unknown) => {
          // The transcript can confirm receipt before the transport reports an error.
          const received = useAppStore
            .getState()
            .timelines[targetKey(activeTarget)]?.some(
              (event) => event.renderId === localId && !event.id.startsWith('local-')
            )
          if (!received) throw error
        })
      useAppStore.getState().setDelivery(activeTarget, 'sent')
      useAppStore.getState().updatePromptDelivery(activeTarget, localId, 'sent')
      const entries = readHistory(activeTarget)
      const historyLimit = useAppStore.getState().settings?.composer.historyLimit ?? 100
      if (historyLimit > 0) {
        localStorage.setItem(
          historyKey(activeTarget),
          JSON.stringify(
            [message, ...entries.filter((item) => item !== message)].slice(0, historyLimit)
          )
        )
      }
      useImageAttachments
        .getState()
        .update(draftKey(activeTarget), (current) =>
          current.filter((image) => !sentImages.some((sent) => sent.id === image.id))
        )
      const unchanged = localStorage.getItem(draftKey(activeTarget)) === draftText
      if (unchanged) {
        localStorage.removeItem(draftKey(activeTarget))
        window.dispatchEvent(
          new CustomEvent('clb:replace-draft', {
            detail: { key: draftKey(activeTarget), previous: draftText, next: '' }
          })
        )
      }
      useAppStore.getState().setComposerFeedback(activeTarget, {
        kind: 'info',
        message: unchanged ? '' : t('work.changedDraft')
      })
      if (
        profile &&
        !useWorkspacePreferences.getState().projects[profile.id]?.sessions[activeTarget.sessionName]
          ?.title
      ) {
        useWorkspacePreferences.getState().updateSession(profile, activeTarget.sessionName, {
          title: message.trim().split('\n')[0]!.slice(0, 60)
        })
      }
      historyCursor.current = -1
      historyDraft.current = ''
    } catch (error) {
      useAppStore
        .getState()
        .updatePromptDelivery(
          activeTarget,
          localId,
          'failed',
          error instanceof Error ? error.message : String(error)
        )
      useAppStore.getState().setDelivery(activeTarget, 'failed')
      useAppStore
        .getState()
        .setComposerFeedback(activeTarget, {
          kind: 'error',
          message: t('work.sendError'),
          promptId: localId
        })
    } finally {
      sendingRef.current = false
      useAppStore.getState().setComposerBusy(activeTarget, 'sending', false)
    }
  }
  useEffect(() => {
    sendRef.current = send
  })

  useEffect(() => {
    commandKeyRef.current = (event) => {
      if (event.isComposing || event.repeat || document.querySelector('[aria-modal="true"]')) return
      const consume = (): void => {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      if (suggestions.length) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          consume()
          setCommandIndex(
            (index) =>
              (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
              suggestions.length
          )
          return
        }
        if (event.key === 'Tab' && !event.shiftKey) {
          consume()
          replaceEditor(`/${suggestions[commandIndex % suggestions.length]![0]} `)
          setCommandIndex(0)
          return
        }
        if (event.key === 'Escape') {
          consume()
          setDismissedCommand(text)
          lastEscape.current = 0
          return
        }
      }
      if (event.key !== 'Escape') {
        lastEscape.current = 0
        return
      }
      if (generating) {
        consume()
        lastEscape.current = 0
        void stop()
        return
      }
      if (text || !connected || readOnly || promptBlocked || nativeCommand) {
        lastEscape.current = 0
        return
      }
      consume()
      const now = Date.now()
      if (lastEscape.current && now - lastEscape.current < 450) {
        lastEscape.current = 0
        void executeCommand('/rewind')
      } else lastEscape.current = now
    }
  })

  useEffect(() => {
    lastEscape.current = 0
  }, [target])
  useEffect(() => {
    editorHost.current?.parentElement
      ?.querySelector('.composer-command-list [aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [commandIndex, text])

  useEffect(
    () =>
      onWorkspaceCommand((command) => {
        if (!active || document.querySelector('[aria-modal="true"]')) return
        if (command === 'focus-input') editor.current?.focus()
        if (command === 'upload') void uploadRef.current()
      }),
    [active]
  )
  const upload = async (): Promise<void> => {
    if (!target || !canUpload(target, connected, readOnly, uploading)) return
    const activeTarget = target
    useAppStore.getState().setComposerBusy(activeTarget, 'uploading', true)
    useAppStore.getState().setUploadProgress(activeTarget, {
      filename: '',
      bytes: 0,
      startedAt: Date.now(),
      stage: 'preparing'
    })
    useAppStore
      .getState()
      .setComposerFeedback(activeTarget, { kind: 'info', message: t('work.uploading') })
    try {
      const result = await window.claudeBridge.uploads.chooseAndUpload(activeTarget)
      if (!result.canceled && result.remotePath) {
        const view = editor.current
        const previous =
          view?.state.doc.toString() ?? localStorage.getItem(draftKey(activeTarget)) ?? ''
        const next = `${previous}${previous ? '\n' : ''}${result.remotePath}`
        localStorage.setItem(draftKey(activeTarget), next)
        window.dispatchEvent(
          new CustomEvent('clb:replace-draft', {
            detail: { key: draftKey(activeTarget), previous, next }
          })
        )
        useAppStore.getState().setComposerFeedback(activeTarget, {
          kind: 'info',
          message: `${t('work.uploadReady')} · ${result.remotePath.split(/[\\/]/).at(-1)}`
        })
      } else {
        useAppStore.getState().setComposerFeedback(activeTarget, { kind: 'info', message: '' })
        useAppStore.getState().setUploadProgress(activeTarget, {
          filename: '',
          bytes: 0,
          startedAt: Date.now(),
          stage: 'complete'
        })
      }
    } catch (error) {
      const previous = useAppStore.getState().uploadProgress[targetKey(activeTarget)]
      useAppStore.getState().setUploadProgress(activeTarget, {
        filename: '',
        bytes: 0,
        startedAt: Date.now(),
        ...previous,
        stage: 'failed'
      })
      useAppStore
        .getState()
        .setComposerFeedback(activeTarget, { kind: 'error', message: t('work.uploadError') })
      showToast({
        level: 'error',
        title: t('composer.uploadFailed'),
        body: error instanceof Error ? error.message : t('composer.notUploaded')
      })
    } finally {
      useAppStore.getState().setComposerBusy(activeTarget, 'uploading', false)
      if (!document.querySelector('[aria-modal="true"]')) editor.current?.focus()
    }
  }

  useEffect(() => {
    uploadRef.current = upload
  })

  const toggleMode = async (): Promise<void> => {
    if (!target || !connected || readOnly || promptBlocked) return
    try {
      await window.claudeBridge.terminal.writeControl({ ...target, control: 'shiftTab' })
    } catch (error) {
      showToast({
        level: 'error',
        title: t('app.controlFailed'),
        body: error instanceof Error ? error.message : t('composer.unavailable')
      })
    }
  }

  useEffect(() => {
    toggleModeRef.current = toggleMode
  })

  useEffect(() => {
    const switchMode = (event: KeyboardEvent): void => {
      if (
        !active ||
        !canToggleModeRef.current ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.key !== 'Tab' ||
        !event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        document.querySelector('[aria-modal="true"]')
      )
        return
      if (!(event.target instanceof Node) || !editor.current?.contentDOM.contains(event.target))
        return
      event.preventDefault()
      void toggleModeRef.current()
    }
    window.addEventListener('keydown', switchMode)
    return () => window.removeEventListener('keydown', switchMode)
  }, [active])

  const statusLabel = !target
    ? t('work.noTarget')
    : !connected
      ? t('work.offlineCompose')
      : readOnly
        ? t('composer.readOnly')
        : promptBlocked
          ? t('work.blocked')
          : stopping
            ? t('composer.stopping')
            : sending
              ? t('composer.sending')
              : generating
                ? t('composer.generatingStatus')
                : delivery === 'sent'
                  ? t('composer.sentStatus')
                  : delivery === 'finished'
                    ? t('composer.finishedStatus')
                    : delivery === 'response-failed'
                      ? t('composer.responseFailedStatus')
                      : delivery === 'stopped'
                        ? t('composer.stoppedStatus')
                        : delivery === 'failed'
                          ? t('composer.failedStatus')
                          : t('composer.ready')
  const StatusIcon = !connected
    ? WifiOff
    : readOnly
      ? LockKeyhole
      : promptBlocked || delivery === 'failed' || delivery === 'response-failed'
        ? CircleAlert
        : delivery === 'stopped'
          ? Square
          : CircleCheck

  return (
    <div className="composer-area">
      <TranscriptSyncNotice target={target} connected={connected} />
      {uploading && progress?.filename && (
        <div className="upload-progress" role="status">
          <span>
            {progress.filename} · {(progress.bytes / 1024 / 1024).toFixed(2)} MB
          </span>
          <span>
            {t(`upload.${progress.stage}`)} ·{' '}
            {Math.max(0, Math.floor((now - progress.startedAt) / 1000))} s
          </span>
        </div>
      )}
      {!uploading && progress?.stage === 'failed' && (
        <button
          className="quiet-button upload-retry"
          disabled={!connected || readOnly}
          onClick={() => void upload()}
        >
          {t('upload.retry')}
        </button>
      )}
      {feedback?.message && (
        <p
          className={`composer-feedback ${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
          <button
            className="icon-button"
            aria-label={t('common.close')}
            onClick={() => target && useAppStore.getState().dismissComposerFeedback(target)}
          >
            <X size={14} />
          </button>
        </p>
      )}
      <section
        className="composer-shell"
        onPasteCapture={(event) => {
          const files = Array.from(event.clipboardData.items)
            .filter((item) => item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter((file): file is File => !!file)
          if (!files.length) return
          event.preventDefault()
          event.stopPropagation()
          if (!target || !connected || readOnly || sending || nativeCommand) return
          const destination = target
          const key = draftKey(destination)
          for (const file of files) {
            if (file.size > 100 * 1024 * 1024) {
              showToast({
                level: 'error',
                title: t('composer.uploadFailed'),
                body: t('upload.tooLarge')
              })
              continue
            }
            const id = crypto.randomUUID()
            useImageAttachments.getState().update(key, (items) => [...items, { id, preview: '' }])
            const reader = new FileReader()
            const fail = (error: unknown) =>
              useImageAttachments
                .getState()
                .update(key, (items) =>
                  items.map((item) =>
                    item.id === id
                      ? { ...item, error: error instanceof Error ? error.message : String(error) }
                      : item
                  )
                )
            reader.onerror = () => fail(new Error('Unable to read clipboard image'))
            reader.onload = () => {
              const preview = String(reader.result)
              useImageAttachments
                .getState()
                .update(key, (items) =>
                  items.map((item) => (item.id === id ? { ...item, preview } : item))
                )
              void window.claudeBridge.uploads
                .image(destination, preview)
                .then((result) => {
                  if (!result.remotePath) throw new Error('Image upload canceled')
                  useImageAttachments
                    .getState()
                    .update(key, (items) =>
                      items.map((item) =>
                        item.id === id ? { ...item, remotePath: result.remotePath } : item
                      )
                    )
                })
                .catch(fail)
            }
            reader.readAsDataURL(file)
          }
        }}
        style={
          { '--composer-font-size': `${settings?.composer.fontSize ?? 14}px` } as CSSProperties
        }
      >
        {suggestions.length > 0 && (
          <div
            className="composer-command-list"
            role="listbox"
            aria-label={language === 'zh-CN' ? 'Claude 命令' : 'Claude commands'}
          >
            {suggestions.map(([name, zh, en], index) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={index === commandIndex % suggestions.length}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  replaceEditor(`/${name} `)
                  setCommandIndex(0)
                  editor.current?.focus()
                }}
              >
                <code>/{name}</code>
                <span>{language === 'zh-CN' ? zh : en}</span>
              </button>
            ))}
            <small>
              {language === 'zh-CN'
                ? '↑↓ 选择 · Tab 补全 · 按发送快捷键执行'
                : '↑↓ select · Tab complete · Use your send shortcut to execute'}
            </small>
          </div>
        )}
        {nativeCommand && (
          <div className="composer-native-hint" role="status">
            {language === 'zh-CN'
              ? '命令正在终端中处理，可自由切换视图。草稿会保留。'
              : 'Command active in terminal. Switch views freely; your draft is preserved.'}
          </div>
        )}
        {images.length > 0 && (
          <div
            className="composer-images"
            aria-label={language === 'zh-CN' ? '图片附件' : 'Image attachments'}
          >
            {images.map((image) => (
              <div className="composer-image" key={image.id}>
                {image.preview && (
                  <img
                    src={image.preview}
                    alt={language === 'zh-CN' ? '粘贴的图片' : 'Pasted image'}
                  />
                )}
                <button
                  type="button"
                  disabled={sending}
                  aria-label={language === 'zh-CN' ? '移除图片' : 'Remove image'}
                  onClick={() =>
                    useImageAttachments
                      .getState()
                      .update(imagesKey, (items) => items.filter((item) => item.id !== image.id))
                  }
                >
                  ×
                </button>
                {!image.remotePath && (
                  <span role="status" title={image.error}>
                    {image.error
                      ? language === 'zh-CN'
                        ? '上传失败，请移除后重贴'
                        : 'Upload failed. Remove and paste again.'
                      : t('work.uploading')}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div ref={editorHost} className="composer-editor" />
        <div className="composer-footer">
          <div className="composer-tools">
            <button
              className="quiet-button composer-upload"
              aria-label={t(uploading ? 'work.uploading' : 'composer.upload')}
              title={
                !connected
                  ? t('composer.connectFirst')
                  : readOnly
                    ? t('composer.readOnly')
                    : t(uploading ? 'work.uploading' : 'upload.limit')
              }
              onClick={upload}
              disabled={!canUpload(target, connected, readOnly, uploading)}
            >
              {uploading ? <LoaderCircle size={16} className="spin" /> : <Paperclip size={17} />}
              {uploading && <span>{t('work.uploading')}</span>}
            </button>
            <button
              className="quiet-button"
              onClick={() => void toggleMode()}
              aria-keyshortcuts="Shift+Tab"
              aria-label={t('composer.currentMode', { mode: permissionModeLabel })}
              disabled={!target || !connected || readOnly || promptBlocked}
              title={
                !connected
                  ? t('composer.connectFirst')
                  : readOnly
                    ? t('composer.readOnly')
                    : t('composer.toggleModeHint', { mode: permissionModeLabel })
              }
            >
              <ShieldCheck size={15} /> {permissionModeLabel}
            </button>
            {text.length > (settings?.composer.maxCharacters ?? 200000) * 0.8 && (
              <span
                className={`character-count ${text.length > (settings?.composer.maxCharacters ?? 200000) ? 'over' : ''}`}
              >
                {text.length.toLocaleString(language)}
              </span>
            )}
          </div>
          <span
            className="composer-model"
            title={model ?? t('composer.modelUnknown')}
            aria-label={model ?? t('composer.modelUnknown')}
          >
            {model ?? t('composer.modelUnknown')}
          </span>
          {generating ? (
            <button
              className="stop-button"
              onClick={() => void stop()}
              disabled={!connected || readOnly || promptBlocked || stopping}
              aria-label={t(stopping ? 'composer.stopping' : 'composer.stop')}
              title={t(stopping ? 'composer.stopping' : 'composer.stop')}
              aria-busy={stopping}
            >
              {stopping ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Square size={16} fill="currentColor" />
              )}
            </button>
          ) : (
            <button
              className="send-button"
              aria-label={t(sending ? 'composer.sending' : 'composer.send')}
              aria-busy={sending}
              onClick={() => void send()}
              disabled={
                !connected ||
                readOnly ||
                promptBlocked ||
                (!text.trim() && images.length === 0) ||
                imagesPending ||
                uploading ||
                sending ||
                stopping ||
                !!nativeCommand ||
                (generating && !!parseClaudeCommand(text))
              }
              title={
                !connected
                  ? t('composer.connectFirst')
                  : readOnly
                    ? t('composer.readOnly')
                    : `${t('composer.send')} · ${sendShortcutLabel}`
              }
            >
              {sending ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}
            </button>
          )}
        </div>
      </section>
      {statusBarHost &&
        createPortal(
          <div className="composer-context">
            <div
              className="composer-state"
              role="status"
              aria-label={t('composer.status')}
              title={statusLabel}
              data-state={
                !connected
                  ? 'offline'
                  : promptBlocked
                    ? 'confirmation'
                    : generating
                      ? 'generating'
                      : (delivery ?? 'ready')
              }
            >
              {sending || generating || stopping ? (
                <LoaderCircle size={13} className="spin" aria-hidden="true" />
              ) : (
                <StatusIcon size={13} aria-hidden="true" />
              )}
              <span>{statusLabel}</span>
            </div>
            {target && profile && (
              <div className="composer-destination" aria-label={t('composer.destination')}>
                <div className="status-bar-server" title={profile.sshHost ?? profile.host}>
                  <Server size={13} aria-hidden="true" />
                  <strong>{profile.sshHost ?? profile.host}</strong>
                </div>
                <div
                  className="status-bar-path"
                  title={remoteSession?.currentPath ?? profile.defaultCwd}
                >
                  <FolderOpen size={13} aria-hidden="true" />
                  <span>{remoteSession?.currentPath ?? profile.defaultCwd}</span>
                </div>
              </div>
            )}
          </div>,
          statusBarHost
        )}
    </div>
  )
}
