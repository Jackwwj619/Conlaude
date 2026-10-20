import { ArrowLeft, RotateCcw, Save } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import type { SshConfigFile } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { Modal } from './ui/Modal'

interface Props {
  onClose: () => void
  onSaved: (config: SshConfigFile) => void
  onCancelNavigation?: () => void
  embedded?: boolean
  navigationRef?: RefObject<(() => void) | null>
}

export function SshConfigDialog({
  onClose,
  onSaved,
  embedded,
  navigationRef,
  onCancelNavigation
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [config, setConfig] = useState<SshConfigFile>()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadRequest, setLoadRequest] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const requestClose = (): void => {
    if (confirmDiscard) {
      setConfirmDiscard(false)
      onCancelNavigation?.()
      return
    }
    if (config && content !== config.content) setConfirmDiscard(true)
    else onClose()
  }
  useEffect(() => {
    if (navigationRef)
      navigationRef.current = () => {
        if (!saving) requestClose()
      }
    return () => {
      if (navigationRef) navigationRef.current = null
    }
  })

  useEffect(() => {
    let active = true
    void window.claudeBridge.profiles
      .getSshConfig()
      .then((next) => {
        if (!active) return
        setConfig(next)
        setContent(next.content)
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            (reason instanceof Error ? reason.message : String(reason)).replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              ''
            )
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadRequest])

  const save = async (): Promise<void> => {
    if (!config || loading || saving || content === config.content) return
    setSaving(true)
    setError(undefined)
    try {
      const saved = await window.claudeBridge.profiles.saveSshConfig(content)
      setConfig(saved)
      setContent(saved.content)
      onSaved(saved)
      onClose()
    } catch (reason) {
      setError(
        (reason instanceof Error ? reason.message : String(reason)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          ''
        )
      )
    } finally {
      setSaving(false)
    }
  }

  if (confirmDiscard)
    return (
      <DiscardChangesDialog
        embedded={embedded}
        onContinue={() => {
          setConfirmDiscard(false)
          onCancelNavigation?.()
        }}
        onDiscard={onClose}
      />
    )
  return (
    <Modal
      embedded={embedded}
      className="small-modal ssh-config-modal"
      label={t('sshConfig.title')}
      onClose={requestClose}
      dismissible={!saving}
    >
      <header className="modal-header">
        <div>
          <h2>{t('sshConfig.title')}</h2>
          <p>{t('sshConfig.body')}</p>
        </div>
        <button
          className="icon-button"
          onClick={requestClose}
          disabled={saving}
          aria-label={t(embedded ? 'common.back' : 'common.close')}
        >
          {embedded ? <ArrowLeft size={18} /> : '×'}
        </button>
      </header>
      <div className="modal-content ssh-config-content">
        {loading ? (
          <div className="loading-row">{t('sshConfig.loading')}</div>
        ) : config ? (
          <>
            <p className="ssh-config-path" title={config.path}>
              {config.path}
            </p>
            <label className="ssh-config-editor-label">
              {t('sshConfig.contents')}
              <textarea
                autoFocus
                className="ssh-config-editor"
                value={content}
                disabled={saving}
                onChange={(event) => setContent(event.target.value)}
                placeholder={t('sshConfig.placeholder')}
                spellCheck={false}
              />
            </label>
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
          </>
        ) : (
          <div>
            <p className="error-banner" role="alert">
              {error}
            </p>
            <button
              className="secondary-button"
              onClick={() => {
                setLoading(true)
                setError(undefined)
                setLoadRequest((value) => value + 1)
              }}
            >
              <RotateCcw size={14} /> {t('sshConfig.retry')}
            </button>
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <button className="secondary-button" onClick={requestClose} disabled={saving}>
          {t('common.cancel')}
        </button>
        <button
          className="primary-button"
          onClick={() => void save()}
          disabled={loading || saving || !config || content === config.content}
        >
          <Save size={14} /> {saving ? t('sshConfig.saving') : t('sshConfig.save')}
        </button>
      </footer>
    </Modal>
  )
}
