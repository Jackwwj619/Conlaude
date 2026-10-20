import { MoveHorizontal, Plus, Search, Server, Settings, Stethoscope } from 'lucide-react'
import type { SessionTarget } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { sessionActivity } from '../session-presentation'
import { targetKey, useAppStore } from '../store'
import { useWorkspacePreferences } from '../workspace-preferences'
import { BrandLogo } from './BrandLogo'
import { SessionStatusIcon } from './SessionStatusIcon'

export function SidebarRail({
  target,
  hasProfiles,
  onExpandSidebar,
  onNew,
  onSearch,
  onManage,
  onSettings,
  onDiagnostics
}: {
  target?: SessionTarget
  hasProfiles: boolean
  onExpandSidebar: () => void
  onNew: () => void
  onSearch: () => void
  onManage: () => void
  onSettings: () => void
  onDiagnostics: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const status = useAppStore((s) => (target ? s.statuses[targetKey(target)] : undefined))
  const events = useAppStore((s) => (target ? s.timelines[targetKey(target)] : undefined))
  const title = useWorkspacePreferences((s) =>
    target
      ? s.projects[target.profileId]?.sessions[target.sessionName]?.title || target.sessionName
      : ''
  )
  const activity = sessionActivity(status, events)
  const label = t(activity)
  return (
    <div className="sidebar-rail">
      <button
        type="button"
        className="icon-button sidebar-rail-brand"
        aria-label={t('sidebar.expand')}
        aria-expanded={false}
        aria-controls="sidebar-content"
        title={t('sidebar.expand')}
        onClick={onExpandSidebar}
      >
        <BrandLogo />
        <MoveHorizontal className="sidebar-rail-expand-icon" size={20} aria-hidden="true" />
      </button>
      <button
        className="icon-button"
        aria-label={t('work.new')}
        title={t('work.new')}
        onClick={() => onNew()}
      >
        <Plus size={18} />
      </button>
      <button
        className="icon-button"
        aria-label={t('work.search')}
        title={t('work.searchHint')}
        onClick={onSearch}
      >
        <Search size={17} />
      </button>
      <div className="sidebar-rail-current">
        {target && (
          <div className="rail-chat-status" title={`${title} · ${label}`}>
            <SessionStatusIcon activity={activity} label={`${title} · ${label}`} />
          </div>
        )}
      </div>
      <div className="sidebar-rail-footer">
        <button
          className="icon-button"
          aria-label={t('work.manage')}
          title={t('work.manage')}
          onClick={onManage}
        >
          <Server size={17} />
        </button>
        <button
          className="icon-button"
          aria-label={t('sidebar.diagnostics')}
          title={t('sidebar.diagnostics')}
          onClick={onDiagnostics}
          disabled={!hasProfiles}
        >
          <Stethoscope size={17} />
        </button>
        <button
          className="icon-button"
          aria-label={t('sidebar.settings')}
          title={t('sidebar.settings')}
          onClick={onSettings}
        >
          <Settings size={17} />
        </button>
      </div>
    </div>
  )
}
