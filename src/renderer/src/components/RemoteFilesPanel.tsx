import { Check, FileText, RefreshCw, Save } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { SessionTarget } from '../../../shared/contracts'
import type { RemoteFile } from '../../../shared/remote-files'
import { useI18n } from '../i18n'
import { fileError } from '../file-errors'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { RemoteImagePreview } from './RemoteImagePreview'
import { MarkdownContent } from './MarkdownContent'
import { useAppStore } from '../store'
import { RemoteFileOpenContext, resolveRemoteFileReference, remoteParent } from '../file-navigation'

export interface FilePanelActions {
  reload: () => void
  save: () => void
  close: () => void
}

/** An editor owns its document and draft. Navigation lives in FileWorkspace. */
export default function RemoteFilesPanel({
  hidden,
  id,
  target,
  initialFile,
  readOnly,
  onClose,
  actionsRef,
  onOpenReference,
  onFileState
}: {
  hidden: boolean
  id: number
  target: SessionTarget
  initialFile: string
  readOnly: boolean
  onClose: () => void
  actionsRef: RefObject<FilePanelActions | null>
  onOpenReference: (reference: string) => void
  onFileState: (state: { path: string; dirty: boolean }) => void
}): React.JSX.Element {
  const { language } = useI18n()
  const zh = language === 'zh-CN'
  const label = (cn: string, en: string): string => (zh ? cn : en)
  const [file, setFile] = useState<RemoteFile>()
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState<'read' | 'save'>()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState<() => void>()
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const panel = useRef<HTMLElement>(null)
  const conversation = useAppStore((state) => state.settings?.conversation)
  const mounted = useRef(false)
  const locked = useRef(false)
  const textFile = file && file.kind !== 'image' ? file : undefined
  const dirty = !!textFile && textFile.content !== content
  const markdown = !!textFile && /\.(md|markdown|mdown)$/i.test(textFile.path)
  const preview = markdown && view === 'preview'
  const writable = !readOnly && !!file?.writable
  const canSave = dirty && !busy && writable
  useEffect(() => {
    onFileState({ path: file?.path ?? initialFile, dirty })
  }, [file?.path, initialFile, dirty, onFileState])
  const run = async (kind: 'read' | 'save', action: () => Promise<void>): Promise<void> => {
    if (locked.current) return
    locked.current = true
    setBusy(kind)
    setError('')
    setSaved(false)
    try {
      await action()
    } catch (reason) {
      if (mounted.current) setError(fileError(reason, zh))
    } finally {
      locked.current = false
      if (mounted.current) setBusy(undefined)
    }
  }
  const read = (): void => {
    void run('read', async () => {
      const result = await window.claudeBridge.files.read({
        ...target,
        path: file?.path ?? initialFile
      })
      if (!mounted.current) return
      setFile(result)
      setContent(result.kind === 'image' ? '' : result.content)
    })
  }
  const guard = (action: () => void): void => {
    if (busy === 'save') return
    if (dirty) setPending(() => action)
    else action()
  }
  const save = (): void => {
    if (!canSave || !file) return
    void run('save', async () => {
      const result = await window.claudeBridge.files.save({
        ...target,
        path: file.path,
        content,
        version: file.version
      })
      if (!mounted.current) return
      setFile(result)
      setContent(result.content)
      setSaved(true)
    })
  }
  useEffect(() => {
    mounted.current = true
    read()
    return () => {
      mounted.current = false
    }
    // Each editor is pinned to its original file and server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    actionsRef.current = { save, reload: () => guard(read), close: () => guard(onClose) }
    return () => {
      actionsRef.current = null
    }
  })
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    if (dirty || busy === 'save') window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, busy])
  return (
    <section
      ref={panel}
      hidden={hidden}
      id={`file-editor-${id}`}
      role="tabpanel"
      aria-labelledby={`file-tab-${id}`}
      tabIndex={0}
      className="remote-file-document"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          event.stopPropagation()
          save()
        }
      }}
    >
      <div className="remote-file-editor">
        {file?.kind === 'image' ? (
          <RemoteImagePreview key={`${file.path}:${file.version}`} file={file} />
        ) : textFile ? (
          <>
            {preview && (
              <div
                className="remote-file-preview codex-content"
                style={
                  {
                    '--reply-font-size': `${conversation?.fontSize ?? 14}px`,
                    '--reply-line-height': conversation?.lineHeight ?? 1.75
                  } as CSSProperties
                }
              >
                <RemoteFileOpenContext.Provider
                  value={(reference) => {
                    const resolved = resolveRemoteFileReference(reference, remoteParent(file!.path))
                    if (resolved) onOpenReference(resolved)
                  }}
                >
                  <MarkdownContent key={textFile.path} text={content} />
                </RemoteFileOpenContext.Provider>
              </div>
            )}
            <textarea
              hidden={preview}
              className="remote-file-text"
              aria-label={label('文件内容', 'File contents')}
              value={content}
              onChange={(event) => {
                setContent(event.target.value)
                setSaved(false)
              }}
              readOnly={!writable || !!busy}
              spellCheck={false}
              wrap="off"
            />
          </>
        ) : (
          <div className="remote-file-empty">
            <FileText size={30} strokeWidth={1.3} />
            <p>
              {busy === 'read'
                ? label('正在读取文件…', 'Loading file…')
                : label('无法预览此文件', 'Cannot preview this file')}
            </p>
            {!busy && (
              <button className="quiet-button" onClick={read}>
                <RefreshCw size={14} />
                {label('重试', 'Retry')}
              </button>
            )}
            <small>
              {!busy &&
                label(
                  '可通过顶部“文件操作”下载文件。',
                  'Use File actions above to download this file.'
                )}
            </small>
          </div>
        )}
      </div>
      {error && (
        <div className="remote-file-error" role="alert">
          {error}
        </div>
      )}
      {textFile && (
        <footer className="remote-file-editor-footer">
          {markdown && (
            <div
              className="remote-file-view-switch"
              role="group"
              aria-label={label('文件视图', 'File view')}
            >
              <button aria-pressed={view === 'preview'} onClick={() => setView('preview')}>
                {label('预览', 'Preview')}
              </button>
              <button
                aria-pressed={view === 'source'}
                onClick={() => {
                  setView('source')
                  requestAnimationFrame(() =>
                    panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
                  )
                }}
              >
                {writable ? label('编辑', 'Edit') : label('源码', 'Source')}
              </button>
            </div>
          )}
          <span className="file-save-status" role="status" title={`UTF-8 · ${textFile.lineEnding}`}>
            {busy ? (
              label('处理中…', 'Working…')
            ) : dirty ? (
              label('未保存', 'Unsaved')
            ) : saved ? (
              <>
                <Check size={13} />
                {label('已保存', 'Saved')}
              </>
            ) : !writable ? (
              label('只读', 'Read only')
            ) : (
              `UTF-8 · ${textFile.lineEnding}`
            )}
          </span>
          {writable && (
            <button
              className="quiet-button remote-file-save"
              disabled={!canSave}
              onClick={save}
              title={label('保存到服务器 (Ctrl+S)', 'Save to server (Ctrl+S)')}
            >
              <Save size={14} />
              {busy === 'save' ? label('保存中…', 'Saving…') : label('保存', 'Save')}
            </button>
          )}
        </footer>
      )}
      {pending && (
        <DiscardChangesDialog
          fileName={initialFile.split('/').at(-1)}
          onContinue={() => setPending(undefined)}
          onDiscard={() => {
            const action = pending
            setPending(undefined)
            action()
          }}
        />
      )}
    </section>
  )
}
