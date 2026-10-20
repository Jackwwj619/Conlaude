import { CheckCircle2, CircleAlert, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DiagnosticReport } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { Modal } from './ui/Modal'

interface Props {
  profileId: string
  onClose: () => void
  onInstalled: () => void
}

export function DiagnosticsDialog({ profileId, onClose, onInstalled }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [report, setReport] = useState<DiagnosticReport>()
  const [error, setError] = useState('')
  const [installing, setInstalling] = useState(false)
  const [confirmInstall, setConfirmInstall] = useState(false)
  const [running, setRunning] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [runNumber, setRunNumber] = useState(0)
  const [exported, setExported] = useState(false)

  const run = (): void => {
    if (running) return
    setRunning(true)
    setReport(undefined)
    setError('')
    setExported(false)
    setRunNumber((value) => value + 1)
  }

  useEffect(() => {
    let active = true
    const unsubscribe = window.claudeBridge.events.subscribe((event) => {
      if (active && event.type === 'diagnostics-progress' && event.profileId === profileId)
        setReport(event.report)
    })
    window.claudeBridge.diagnostics
      .run(profileId)
      .then((nextReport) => {
        if (active) setReport(nextReport)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (active) setRunning(false)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [profileId, runNumber])

  const install = async (): Promise<void> => {
    setInstalling(true)
    try {
      await window.claudeBridge.helper.install(profileId)
      onInstalled()
      setConfirmInstall(false)
      run()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('diagnostics.installFailed'))
    } finally {
      setInstalling(false)
    }
  }

  const exportReport = async (): Promise<void> => {
    if (exporting || !report) return
    setExporting(true)
    try {
      const result = await window.claudeBridge.diagnostics.export(profileId)
      setExported(!result.canceled)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('diagnostics.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      className="diagnostics-modal"
      label={t('diagnostics.label')}
      onClose={() => {
        if (confirmInstall) setConfirmInstall(false)
        else onClose()
      }}
      dismissible={!installing}
    >
      <header className="modal-header">
        <div>
          <h2>{t('diagnostics.title')}</h2>
          <p>{t('diagnostics.body', { profile: profileId })}</p>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          disabled={installing}
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>
      </header>
      <div className="modal-content">
        {running && (
          <div className="loading-row" role="status">
            <LoaderCircle className="spin" size={18} /> {t('diagnostics.running')}
            {report?.activeCheck && ` · ${t(`diagnostics.check.${report.activeCheck}`)}`}
            {report && ` · ${report.checks.length}/6`}
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <p className="muted">{t('diagnostics.exportPrivacy')}</p>
        {exported && <p role="status">{t('diagnostics.exported')}</p>}
        {report && (
          <div className="diagnostic-list">
            {report.checks.map((check) => (
              <div className={`diagnostic-item ${check.status}`} key={check.id}>
                {check.status === 'ok' ? (
                  <CheckCircle2 size={18} />
                ) : check.status === 'warning' || check.status === 'skipped' ? (
                  <TriangleAlert size={18} />
                ) : (
                  <CircleAlert size={18} />
                )}
                <div>
                  <strong>{t(`diagnostics.check.${check.id}`)}</strong>
                  {check.status === 'skipped' && <small>{t('diagnostics.skipped')}</small>}
                  <span>{check.detail}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {confirmInstall && (
          <div className="helper-install-confirm">
            <div>
              <strong>{t('diagnostics.confirmTitle')}</strong>
              <span>{t('diagnostics.confirmBody')}</span>
            </div>
            <button className="secondary-button" onClick={() => setConfirmInstall(false)}>
              {t('common.cancel')}
            </button>
            <button className="primary-button" onClick={() => void install()} disabled={installing}>
              {installing ? t('diagnostics.installing') : t('diagnostics.confirmInstall')}
            </button>
          </div>
        )}
      </div>
      <footer className="modal-footer split">
        <div>
          <button
            className="secondary-button"
            onClick={() => setConfirmInstall(true)}
            disabled={installing || running}
          >
            {t('diagnostics.install')}
          </button>
          <button
            className="secondary-button"
            disabled={!report?.checks.length || exporting}
            onClick={() => void exportReport()}
          >
            {t('diagnostics.export')}
          </button>
        </div>
        <div>
          <button className="secondary-button" disabled={running || installing} onClick={run}>
            {t('diagnostics.rerun')}
          </button>
          <button className="primary-button" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </footer>
    </Modal>
  )
}
