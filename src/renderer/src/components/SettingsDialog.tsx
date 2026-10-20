import {
  FileText,
  FolderOpen,
  Keyboard,
  MessageSquare,
  PanelLeft,
  Pencil,
  Plug,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SunMoon,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AppSettingsSchema, type AppSettings } from '../../../shared/contracts'
import { DEFAULT_SETTINGS } from '../../../shared/defaults'
import { settingHelp, settingUnit } from '../settings-help'
import { translate } from '../../../shared/i18n'
import { pruneInputHistory } from '../composer-history'
import {
  SETTINGS_FIELDS,
  resetSettingsCategory,
  settingValue,
  updateSetting,
  type SettingField,
  type SettingPath,
  type SettingsCategory
} from '../settings-fields'
import { Modal } from './ui/Modal'
import { ProfileEditor } from './ProfileEditor'
import { SshConfigDialog } from './SshConfigDialog'
import { FontPicker } from './FontPicker'
import '../settings.css'
const APPEARANCE_SECTIONS = [
  'theme',
  'interface',
  'layout',
  'reading',
  'code',
  'terminalText',
  'cursor'
]
interface Props {
  settings: AppSettings
  onClose: () => void
  onSave: (settings: AppSettings) => Promise<void>
  onPreview?: (settings: AppSettings) => void
  initialProfileId?: string
}
const ADVANCED = new Set([
  'composer.maxCharacters',
  'composer.historyLimit',
  'terminal.scrollback',
  'appearance.cornerRadius',
  'appearance.motion',
  'appearance.contentPadding'
])
const VISIT_KEY = 'clb:settings-visit:v1'
function readVisit(): { category: SettingsCategory; positions: Record<string, number> } {
  try {
    const saved = JSON.parse(localStorage.getItem(VISIT_KEY) ?? '{}')
    return {
      category:
        saved.category === 'terminal'
          ? 'appearance'
          : CATEGORIES.some((c) => c.id === saved.category)
            ? saved.category
            : 'general',
      positions: saved.positions ?? {}
    }
  } catch {
    return { category: 'general', positions: {} }
  }
}
const CATEGORIES = [
  {
    id: 'general',
    label: 'settings.categoryGeneral',
    description: 'settings.generalDescription',
    icon: SlidersHorizontal
  },
  {
    id: 'appearance',
    label: 'settings.categoryAppearance',
    description: 'settings.appearanceDescription',
    icon: SunMoon
  },
  {
    id: 'navigation',
    label: 'settings.categoryNavigation',
    description: 'settings.navigationDescription',
    icon: PanelLeft
  },
  {
    id: 'conversation',
    label: 'settings.categoryConversation',
    description: 'settings.conversationDescription',
    icon: MessageSquare
  },
  {
    id: 'composer',
    label: 'settings.categoryComposer',
    description: 'settings.composerDescription',
    icon: Keyboard
  },
  {
    id: 'connection',
    label: 'settings.categoryConnection',
    description: 'settings.connectionDescription',
    icon: Plug
  }
] as const

const SERVER_SEARCH_KEYS = [
  'settings.categoryConnection',
  'settings.profileName',
  'settings.host',
  'settings.port',
  'settings.user',
  'settings.auth',
  'settings.keyPath',
  'settings.proxyJump',
  'settings.defaultSession',
  'settings.defaultCwd',
  'settings.claudePath',
  'settings.sshHost'
]

export function SettingsDialog({
  settings,
  onClose,
  onSave,
  onPreview,
  initialProfileId
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState(() => structuredClone(settings))
  const draftRef = useRef(draft)
  const savedRef = useRef(settings)
  const chain = useRef(Promise.resolve())
  const version = useRef(0)
  const alive = useRef(true)
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(() =>
    initialProfileId ? 'connection' : readVisit().category
  )
  const positions = useRef(readVisit().positions)
  const beforeSearch = useRef<{ category: SettingsCategory; top: number } | undefined>(undefined)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [resultIndex, setResultIndex] = useState(0)
  const [highlight, setHighlight] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [numeric, setNumeric] = useState<Record<string, string>>({})
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const [pendingChange, setPendingChange] =
    useState<{ id: SettingPath; value: string | number | boolean }[]>()
  const [profileId, setProfileId] = useState(initialProfileId ?? settings.currentProfileId)
  const [editingProfile, setEditingProfile] = useState(!!initialProfileId)
  const [sshConfigOpen, setSshConfigOpen] = useState(false)
  const [revealError, setRevealError] = useState('')
  const [revealing, setRevealing] = useState(false)
  const editorButton = useRef<HTMLButtonElement>(null)
  const sshButton = useRef<HTMLButtonElement>(null)
  const navigationRef = useRef<(() => void) | null>(null)
  const pendingNavigation = useRef<(() => void) | null>(null)
  const leaveEditor = (): void => {
    setEditingProfile(false)
    setSshConfigOpen(false)
    const next = pendingNavigation.current
    pendingNavigation.current = null
    next?.()
  }
  const navigate = (next: () => void): void => {
    if (navigationRef.current) {
      pendingNavigation.current = next
      navigationRef.current()
    } else next()
  }
  const previousEditor = useRef({ profile: false, ssh: false })
  useEffect(() => {
    const previous = previousEditor.current
    previousEditor.current = { profile: editingProfile, ssh: sshConfigOpen }
    if ((previous.profile && !editingProfile) || (previous.ssh && !sshConfigOpen)) {
      const frame = requestAnimationFrame(() => {
        if (panel.current) panel.current.scrollTop = positions.current[activeCategory] ?? 0
        ;(previous.profile ? editorButton.current : sshButton.current)?.focus({
          preventScroll: true
        })
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [editingProfile, sshConfigOpen, activeCategory])
  const revealConfig = async (): Promise<void> => {
    setRevealing(true)
    setRevealError('')
    try {
      await window.claudeBridge.profiles.revealSshConfig()
    } catch (error) {
      setRevealError(
        String(error).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, '')
      )
    } finally {
      setRevealing(false)
    }
  }
  const [fontRequest, setFontRequest] = useState(0)
  const [fontCatalog, setFontCatalog] = useState({
    request: -1,
    fonts: [] as string[],
    error: false
  })
  const t = (key: string, variables?: Record<string, string | number>): string =>
    translate(draft.language, key, variables)
  const label = (zh: string, en: string): string => (draft.language === 'zh-CN' ? zh : en)
  const profile = draft.profiles.find((p) => p.id === profileId) ?? draft.profiles[0]
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    let active = true
    void Promise.resolve(window.claudeBridge.app?.listFonts?.(fontRequest > 0) ?? [])
      .then((fonts) => {
        if (active) setFontCatalog({ request: fontRequest, fonts, error: false })
      })
      .catch(() => {
        if (active)
          setFontCatalog((previous) => ({ ...previous, request: fontRequest, error: true }))
      })
    return () => {
      active = false
    }
  }, [fontRequest])
  useEffect(() => {
    const find = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        !event.isComposing &&
        !document.querySelector('.font-popup') &&
        search.current !== null
      ) {
        event.preventDefault()
        event.stopPropagation()
        search.current?.focus()
        search.current?.select()
      }
    }
    window.addEventListener('keydown', find)
    return () => window.removeEventListener('keydown', find)
  }, [])
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = positions.current[activeCategory] ?? 0
    try {
      localStorage.setItem(
        VISIT_KEY,
        JSON.stringify({ category: activeCategory, positions: positions.current })
      )
    } catch {
      /* Navigation remains usable. */
    }
  }, [activeCategory])
  useEffect(() => {
    if (!highlight) return
    const element = document.getElementById(`setting-${highlight}`)
    element?.closest('.setting-row')?.scrollIntoView?.({ block: 'center' })
    element?.focus({ preventScroll: true })
    const timer = setTimeout(() => setHighlight(''), 1800)
    return () => clearTimeout(timer)
  }, [highlight, activeCategory, advanced])
  const enqueue = (next: AppSettings, prune = false): Promise<void> => {
    draftRef.current = next
    setDraft(next)
    onPreview?.(next)
    const ticket = ++version.current
    setSaving(true)
    setSaveError('')
    const operation = chain.current
      .catch(() => undefined)
      .then(async () => {
        // Only preference fields are merged; a preference save never replays stale server data.
        const payload = SETTINGS_FIELDS.reduce(
          (value, field) => updateSetting(value, field.id, settingValue(next, field.id)),
          savedRef.current
        )
        await onSave(AppSettingsSchema.parse(payload))
        savedRef.current = payload
        if (prune) pruneInputHistory(localStorage, payload.composer.historyLimit)
      })
    chain.current = operation
    void operation.then(
      () => {
        if (alive.current) {
          onPreview?.(draftRef.current)
          if (ticket === version.current) setSaving(false)
        }
      },
      (error) => {
        if (alive.current) {
          onPreview?.(draftRef.current)
          if (ticket === version.current) {
            setSaving(false)
            setSaveError(error instanceof Error ? error.message : String(error))
          }
        }
      }
    )
    return operation
  }
  const apply = (next: AppSettings): void => {
    if (next.composer.historyLimit < savedRef.current.composer.historyLimit) {
      setPendingChange(
        SETTINGS_FIELDS.filter(
          (field) => settingValue(next, field.id) !== settingValue(draftRef.current, field.id)
        ).map((field) => ({ id: field.id, value: settingValue(next, field.id) }))
      )
      return
    }
    void enqueue(next).catch(() => undefined)
  }
  const change = (path: SettingPath, value: string | boolean | number): void =>
    apply(updateSetting(draftRef.current, path, value))
  const close = (): void => {
    if (saving) return
    if (navigationRef.current) {
      navigate(onClose)
      return
    }
    if (saveError || Object.keys(invalid).length) {
      onPreview?.(savedRef.current)
    }
    onClose()
  }
  const setSearch = (next: string): void => {
    if (next && !query)
      beforeSearch.current = { category: activeCategory, top: panel.current?.scrollTop ?? 0 }
    setQuery(next)
    setResultIndex(0)
    if (!next && beforeSearch.current) {
      const previous = beforeSearch.current
      positions.current[previous.category] = previous.top
      setActiveCategory(previous.category)
      if (panel.current) panel.current.scrollTop = previous.top
      beforeSearch.current = undefined
    }
  }
  const normalized = query.trim().toLocaleLowerCase()
  const matches = (keys: string[]): boolean =>
    keys.some((key) =>
      [key, translate('zh-CN', key), translate('en-US', key)].some((value) =>
        value.toLocaleLowerCase().includes(normalized)
      )
    )
  const results = SETTINGS_FIELDS.filter(
    (field) =>
      (settingHelp(field.id, 'zh-CN') + ' ' + settingHelp(field.id, 'en-US'))
        .toLocaleLowerCase()
        .includes(normalized) ||
      matches([
        field.id,
        field.label,
        field.hint ?? '',
        CATEGORIES.find((c) => c.id === field.category)!.label,
        ...(field.options?.map((o) => o.labelKey) ?? [])
      ])
  )
  const connectionResult = normalized && matches(SERVER_SEARCH_KEYS)
  const locate = (field: SettingField): void => {
    navigate(() => setActiveCategory(field.category))
    if (ADVANCED.has(field.id)) setAdvanced(true)
    setHighlight(field.id)
  }
  const renderField = (field: SettingField): React.JSX.Element => {
    const value = settingValue(draft, field.id),
      id = `setting-${field.id}`
    const numberError = invalid[field.id]
    const help = settingHelp(field.id, draft.language) || (field.hint ? t(field.hint) : '')
    const unit = settingUnit(field.id)
    const defaultValue = settingValue(DEFAULT_SETTINGS, field.id)
    const defaultLabel = field.options?.find(
      (option) => option.value === String(defaultValue)
    )?.labelKey
    const resetValue = defaultLabel
      ? t(defaultLabel)
      : typeof defaultValue === 'boolean'
        ? defaultValue
          ? label('开启', 'On')
          : label('关闭', 'Off')
        : `${defaultValue}${unit}`
    const modified = value !== defaultValue
    const updateNumber = (): void => {
      if (!(field.id in numeric)) return
      const raw = numeric[field.id]!,
        value = Number(raw)
      if (
        !raw.trim() ||
        !Number.isFinite(value) ||
        value < field.min! ||
        value > field.max! ||
        (!field.step && !Number.isInteger(value))
      ) {
        setInvalid((previous) => ({
          ...previous,
          [field.id]: t('settings.numberError', {
            min: field.min!,
            max: field.max!,
            kind: t(field.step ? 'settings.number' : 'settings.integer')
          })
        }))
        return
      }
      setInvalid((previous) => {
        const next = { ...previous }
        delete next[field.id]
        return next
      })
      setNumeric((previous) => {
        const next = { ...previous }
        delete next[field.id]
        return next
      })
      change(field.id, value)
    }
    return (
      <div
        key={field.id}
        data-modified={modified}
        className={`setting-row ${field.type === 'checkbox' ? 'setting-toggle' : ''} ${highlight === field.id ? 'setting-highlight' : ''}`}
      >
        <div className="setting-copy">
          <label htmlFor={id}>{t(field.label)}</label>
          {help && <p id={`${id}-help`}>{help}</p>}
          {numberError && (
            <p className="setting-error" id={`${id}-error`} role="alert">
              {numberError}
            </p>
          )}
        </div>
        <div className="setting-control">
          {['interfaceFont', 'replyFont', 'terminal.font', 'code.font'].includes(field.id) ? (
            <FontPicker
              id={id}
              label={t(field.label)}
              language={draft.language}
              value={String(value)}
              terminal={field.id === 'terminal.font' || field.id === 'code.font'}
              fonts={fontCatalog.fonts}
              loading={fontCatalog.request !== fontRequest}
              error={fontCatalog.error}
              options={field.options ?? []}
              onChange={(next) => change(field.id, next)}
              onRefresh={() => setFontRequest((n) => n + 1)}
            />
          ) : ['theme', 'appearance.density', 'appearance.accent'].includes(field.id) ? (
            <div
              className={`settings-segment ${field.id === 'appearance.accent' ? 'settings-accent' : ''}`}
              role="group"
              aria-label={t(field.label)}
            >
              {field.options!.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={value === option.value}
                  title={t(option.labelKey)}
                  aria-label={t(option.labelKey)}
                  data-accent={field.id === 'appearance.accent' ? option.value : undefined}
                  onClick={() => change(field.id, option.value)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          ) : field.type === 'checkbox' ? (
            <input
              id={id}
              type="checkbox"
              role="switch"
              aria-describedby={help ? `${id}-help` : undefined}
              checked={value === true}
              onChange={(event) => change(field.id, event.target.checked)}
            />
          ) : field.type === 'number' ? (
            <div className="setting-number">
              <input
                id={id}
                type="number"
                disabled={
                  field.id === 'conversation.maxWidth' && draft.conversation.widthMode !== 'limited'
                }
                min={field.min}
                max={field.max}
                step={field.step ?? 1}
                value={numeric[field.id] ?? String(value)}
                aria-invalid={!!numberError}
                aria-describedby={`${id}-help${numberError ? ` ${id}-error` : ''}`}
                title={`${field.min}–${field.max}${unit ? ' ' + unit : ''}`}
                onChange={(event) =>
                  setNumeric((previous) => ({ ...previous, [field.id]: event.target.value }))
                }
                onBlur={updateNumber}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    updateNumber()
                  }
                }}
              />
              {unit && <span className="setting-unit">{unit}</span>}
            </div>
          ) : (
            <select
              id={id}
              value={String(value)}
              aria-describedby={help ? `${id}-help` : undefined}
              onChange={(event) => change(field.id, event.target.value)}
            >
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          )}
          <button
            className="setting-reset icon-button"
            type="button"
            disabled={!modified && !(field.id in numeric)}
            aria-label={label(`恢复默认值：${t(field.label)}`, `Reset ${t(field.label)}`)}
            title={label(`恢复默认值：${resetValue}`, `Reset to ${resetValue}`)}
            onClick={() => {
              setNumeric((previous) => {
                const next = { ...previous }
                delete next[field.id]
                return next
              })
              setInvalid((previous) => {
                const next = { ...previous }
                delete next[field.id]
                return next
              })
              change(field.id, defaultValue)
            }}
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
    )
  }
  const profileEditor =
    editingProfile && profile ? (
      <ProfileEditor
        embedded
        navigationRef={navigationRef}
        onCancelNavigation={() => {
          pendingNavigation.current = null
        }}
        profile={profile}
        onClose={leaveEditor}
        onSave={async (updated) => {
          await chain.current.catch(() => undefined)
          const next = {
            ...savedRef.current,
            profiles: savedRef.current.profiles.map((item) =>
              item.id === updated.id ? updated : item
            )
          }
          await onSave(next)
          savedRef.current = next
          const merged = { ...draftRef.current, profiles: next.profiles }
          draftRef.current = merged
          setDraft(merged)
        }}
      />
    ) : null
  const category = CATEGORIES.find((c) => c.id === activeCategory)!
  const fields = SETTINGS_FIELDS.filter((field) => field.category === activeCategory)
  return (
    <Modal
      className="settings-modal"
      label={t('settings.title')}
      onClose={editingProfile || sshConfigOpen ? () => navigationRef.current?.() : close}
      dismissible={!saving}
    >
      <div className="settings-layout">
        <aside className="settings-nav">
          <h2>{t('settings.title')}</h2>
          <div className="settings-search" role="search">
            <Search size={15} />
            <input
              ref={search}
              type="search"
              aria-label={t('settings.search')}
              placeholder={t('settings.searchHint')}
              value={query}
              onChange={(event) => {
                const value = event.target.value
                navigate(() => setSearch(value))
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  setResultIndex((i) =>
                    Math.max(
                      0,
                      Math.min(
                        results.length + (connectionResult ? 1 : 0) - 1,
                        i + (event.key === 'ArrowDown' ? 1 : -1)
                      )
                    )
                  )
                }
                if (event.key === 'Enter' && resultIndex === results.length && connectionResult) {
                  event.preventDefault()
                  setActiveCategory('connection')
                }
                if (event.key === 'Enter' && results[resultIndex]) {
                  event.preventDefault()
                  locate(results[resultIndex])
                }
                if (event.key === 'Escape' && query) {
                  event.preventDefault()
                  event.stopPropagation()
                  setSearch('')
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="icon-button"
                aria-label={t('settings.clearSearch')}
                onClick={() => setSearch('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {normalized ? (
            <div className="settings-search-results">
              <small role="status">
                {t('settings.searchResults', {
                  count: results.length + (connectionResult ? 1 : 0)
                })}
              </small>
              {results.map((field, i) => (
                <button
                  key={field.id}
                  className={i === resultIndex ? 'active' : ''}
                  onClick={() => locate(field)}
                >
                  {t(field.label)}
                  <small>
                    {t(CATEGORIES.find((c) => c.id === field.category)!.label)}
                    {ADVANCED.has(field.id) ? ` · ${label('高级', 'Advanced')}` : ''}
                  </small>
                </button>
              ))}
              {connectionResult && (
                <button
                  className={resultIndex === results.length ? 'active' : ''}
                  onClick={() => navigate(() => setActiveCategory('connection'))}
                >
                  {t('settings.categoryConnection')}
                </button>
              )}
              {!results.length && !connectionResult && <p>{t('settings.noResults')}</p>}
            </div>
          ) : (
            <nav aria-label={t('settings.categories')}>
              {CATEGORIES.map(({ id, label: key, icon: Icon }, i) => (
                <div key={id}>
                  {[0, 2, 5].includes(i) && (
                    <small className="settings-nav-group">
                      {i === 0
                        ? label('应用', 'Application')
                        : i === 2
                          ? label('工作区', 'Workspace')
                          : label('连接', 'Connections')}
                    </small>
                  )}
                  <button
                    type="button"
                    className="settings-nav-button"
                    aria-pressed={activeCategory === id}
                    onClick={() =>
                      navigate(() => {
                        setActiveCategory(id)
                        setAdvanced(false)
                      })
                    }
                  >
                    <Icon size={16} />
                    <span>{t(key)}</span>
                  </button>
                </div>
              ))}
            </nav>
          )}
        </aside>
        <section className="settings-main">
          {profileEditor ||
            (sshConfigOpen ? (
              <SshConfigDialog
                embedded
                navigationRef={navigationRef}
                onCancelNavigation={() => {
                  pendingNavigation.current = null
                }}
                onClose={leaveEditor}
                onSaved={() => undefined}
              />
            ) : (
              <>
                <header className="settings-content-heading">
                  <h3>{t(category.label)}</h3>
                  <button
                    className="icon-button"
                    aria-label={t('common.close')}
                    disabled={saving}
                    onClick={close}
                  >
                    <X size={18} />
                  </button>
                </header>
                <div
                  className="settings-panel"
                  ref={panel}
                  id="settings-panel"
                  role="region"
                  aria-label={t(category.label)}
                  onScroll={(event) => {
                    positions.current[activeCategory] = event.currentTarget.scrollTop
                    try {
                      localStorage.setItem(
                        VISIT_KEY,
                        JSON.stringify({ category: activeCategory, positions: positions.current })
                      )
                    } catch {
                      /* optional UI state */
                    }
                  }}
                >
                  <p className="settings-scope">{t(category.description)}</p>
                  {(activeCategory === 'appearance'
                    ? APPEARANCE_SECTIONS
                    : [...new Set(fields.map((field) => field.section))]
                  ).map((section) => {
                    const sectionFields = fields.filter(
                      (field) => field.section === section && !ADVANCED.has(field.id)
                    )
                    if (!sectionFields.length) return null
                    return (
                      <section className="settings-field-section" key={section}>
                        <h4>{t(`settings.section.${section}`)}</h4>
                        <div className="settings-card">
                          {sectionFields
                            .sort((a, b) =>
                              section === 'theme'
                                ? Number(a.id !== 'theme') - Number(b.id !== 'theme')
                                : 0
                            )
                            .map(renderField)}
                        </div>
                      </section>
                    )
                  })}
                  {fields.some((field) => ADVANCED.has(field.id)) && (
                    <details
                      className="settings-advanced"
                      open={advanced}
                      onToggle={(event) => setAdvanced(event.currentTarget.open)}
                    >
                      <summary>{label('高级', 'Advanced')}</summary>
                      {advanced && (
                        <div className="settings-card">
                          {fields.filter((field) => ADVANCED.has(field.id)).map(renderField)}
                        </div>
                      )}
                    </details>
                  )}
                  {activeCategory === 'connection' && (
                    <div className="settings-server">
                      {!profile && <p className="settings-help">{t('library.emptyBody')}</p>}
                      {profile && (
                        <>
                          <div className="settings-server-selector">
                            <label htmlFor="settings-server-profile">{t('settings.profile')}</label>
                            <select
                              id="settings-server-profile"
                              aria-describedby="settings-server-selection-hint"
                              value={profile.id}
                              onChange={(event) => setProfileId(event.target.value)}
                            >
                              {draft.profiles.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <p className="settings-help" id="settings-server-selection-hint">
                            {t('settings.profileSelectionHint')}
                          </p>
                          <dl className="settings-profile-summary">
                            <dt>{t('settings.host')}</dt>
                            <dd>{profile.sshHost ?? profile.host}</dd>
                            <dt>{t('settings.defaultCwd')}</dt>
                            <dd>{profile.defaultCwd}</dd>
                          </dl>
                          <button
                            ref={editorButton}
                            className="secondary-button"
                            onClick={() => setEditingProfile(true)}
                          >
                            <Pencil size={14} />
                            {t('settings.editProfile')}
                          </button>
                        </>
                      )}
                      <div className="settings-ssh-file">
                        <h4>OpenSSH</h4>
                        <p className="settings-help">{t('settings.sshFileHint')}</p>
                        <div className="ssh-actions">
                          <button
                            ref={sshButton}
                            className="secondary-button"
                            onClick={() => setSshConfigOpen(true)}
                          >
                            <FileText size={14} />
                            {t('settings.editSshConfig')}
                          </button>
                          <button
                            className="secondary-button"
                            title={t('settings.revealHint')}
                            disabled={revealing}
                            onClick={() => void revealConfig()}
                          >
                            <FolderOpen size={14} />
                            {t('settings.reveal')}
                          </button>
                        </div>
                        {revealError && (
                          <p className="error-banner" role="alert">
                            {revealError}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {pendingChange && (
                  <div className="settings-confirm" role="alert">
                    <p>
                      {label(
                        '减少历史条数会清理超出上限的输入历史，是否应用？',
                        'Reducing this limit removes older input history. Apply?'
                      )}
                    </p>
                    <button
                      className="secondary-button"
                      onClick={() => setPendingChange(undefined)}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => {
                        const next = pendingChange.reduce(
                          (value, field) => updateSetting(value, field.id, field.value),
                          draftRef.current
                        )
                        setPendingChange(undefined)
                        void enqueue(next, true).catch(() => undefined)
                      }}
                    >
                      {label('应用并清理', 'Apply and prune')}
                    </button>
                  </div>
                )}
                {saveError && (
                  <div className="settings-save-error" role="alert">
                    <p>{saveError}</p>
                    <button onClick={() => void enqueue(draftRef.current).catch(() => undefined)}>
                      {label('重试保存', 'Retry save')}
                    </button>
                    <button
                      onClick={() => {
                        draftRef.current = savedRef.current
                        setDraft(savedRef.current)
                        onPreview?.(savedRef.current)
                        setSaveError('')
                      }}
                    >
                      {label('恢复已保存设置', 'Restore saved preferences')}
                    </button>
                  </div>
                )}
                <footer className="settings-footer">
                  <small role="status">
                    {saving
                      ? t('settings.saving')
                      : saveError
                        ? label('预览尚未保存', 'Preview not saved')
                        : t('settings.savedState')}
                  </small>
                  {activeCategory !== 'connection' && (
                    <button
                      className="quiet-button"
                      onClick={() => apply(resetSettingsCategory(draftRef.current, activeCategory))}
                    >
                      <RotateCcw size={13} />
                      {t('settings.resetCategory')}
                    </button>
                  )}
                  <button className="secondary-button" disabled={saving} onClick={close}>
                    {t('common.close')}
                  </button>
                </footer>
              </>
            ))}
        </section>
      </div>
    </Modal>
  )
}
