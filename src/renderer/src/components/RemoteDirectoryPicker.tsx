import { ArrowUp, ChevronRight, Folder, Home, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RemoteDirectory } from '../../../shared/remote-files'
import { useI18n } from '../i18n'

interface Props {
  profileId: string
  initialPath: string
  disabled: boolean
  onSelect: (path: string) => void
}

/** Uses the same on-demand directory listing as the remote files panel. */
export function RemoteDirectoryPicker({
  profileId,
  initialPath,
  disabled,
  onSelect
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [path, setPath] = useState(initialPath)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    profileId: string
    path: string
    revision: number
    directory?: RemoteDirectory
    error?: string
  }>()
  const loading =
    result?.profileId !== profileId || result?.path !== path || result?.revision !== revision
  const directory = loading ? undefined : result?.directory
  const error = loading ? undefined : result?.error
  useEffect(() => {
    let active = true
    void window.claudeBridge.files
      .list({ profileId, path })
      .then((result) => {
        if (active) setResult({ profileId, path, revision, directory: result })
      })
      .catch((reason: unknown) => {
        if (active)
          setResult({
            profileId,
            path,
            revision,
            error: (reason instanceof Error ? reason.message : String(reason)).replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              ''
            )
          })
      })
    return () => {
      active = false
    }
  }, [profileId, path, revision])
  const folders = directory?.entries.filter((entry) => entry.kind === 'directory') ?? []
  return (
    <section
      id="create-directory-browser"
      className="directory-picker"
      aria-label={t('create.browse')}
      aria-busy={loading}
    >
      <div className="directory-picker-toolbar">
        <button
          type="button"
          className="icon-button"
          aria-label={t('create.home')}
          title={t('create.home')}
          disabled={disabled}
          onClick={() => setPath('~')}
        >
          <Home size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('create.parent')}
          title={t('create.parent')}
          disabled={disabled || loading || !directory || directory.parent === directory.path}
          onClick={() => setPath(directory!.parent)}
        >
          <ArrowUp size={16} />
        </button>
        <span className="directory-picker-path" title={directory?.path ?? path}>
          {directory?.path ?? path}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('create.reload')}
          title={t('create.reload')}
          disabled={disabled || loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {loading ? (
        <p className="directory-picker-note" role="status">
          <LoaderCircle size={15} className="spin" />
          {t('create.loadingFolders')}
        </p>
      ) : error ? (
        <div className="directory-picker-error" role="alert">
          <p>{t('create.folderError')}</p>
          <small>{error}</small>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={() => setRevision((value) => value + 1)}
          >
            {t('work.retry')}
          </button>
        </div>
      ) : (
        <>
          <ul className="directory-picker-list" aria-label={t('create.folders')}>
            {folders.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  disabled={disabled}
                  title={entry.path}
                  onClick={() => setPath(entry.path)}
                >
                  <Folder size={16} />
                  <span>{entry.name}</span>
                  <ChevronRight size={14} />
                </button>
              </li>
            ))}
            {folders.length === 0 && (
              <li className="directory-picker-note">{t('create.noFolders')}</li>
            )}
          </ul>
          {directory?.truncated && <p className="directory-picker-note">{t('create.truncated')}</p>}
        </>
      )}
      <div className="directory-picker-footer">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || loading || !directory}
          onClick={() => onSelect(directory!.path)}
        >
          {t('create.selectFolder')}
        </button>
      </div>
    </section>
  )
}
