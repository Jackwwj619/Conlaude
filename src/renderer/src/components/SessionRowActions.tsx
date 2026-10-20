import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Profile, SessionTarget } from '../../../shared/contracts'
import { useWorkspacePreferences } from '../workspace-preferences'
import { useI18n } from '../i18n'
import { EditTitleDialog } from './EditTitleDialog'
import { SidebarRowMenu } from './SidebarRowMenu'

export function SessionRowActions({
  profile,
  name,
  onTerminate,
  children
}: {
  profile: Profile
  name: string
  onTerminate: (target: SessionTarget) => void
  children: ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  const saved = useWorkspacePreferences((s) => s.projects[profile.id]?.sessions[name])
  const update = useWorkspacePreferences((s) => s.updateSession)
  const [editing, setEditing] = useState(false)
  return (
    <>
      <SidebarRowMenu
        className="session-entry-wrap"
        label={`${t('work.actions')} · ${saved?.title || name}`}
        items={[
          { label: t('work.editTitle'), icon: <Pencil size={14} />, run: () => setEditing(true) },
          {
            label: t(saved?.pinned ? 'work.unpin' : 'work.pin'),
            icon: saved?.pinned ? <PinOff size={14} /> : <Pin size={14} />,
            run: () => update(profile, name, { pinned: !saved?.pinned })
          },
          {
            label: t('work.deleteSession'),
            icon: <Trash2 size={14} />,
            danger: true,
            separator: true,
            run: () => onTerminate({ profileId: profile.id, sessionName: name })
          }
        ]}
      >
        {children}
      </SidebarRowMenu>
      {editing && (
        <EditTitleDialog
          sessionName={name}
          title={saved?.title}
          onSave={(title) => update(profile, name, { title })}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}
