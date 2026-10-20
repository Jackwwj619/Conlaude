import { BrandLogo } from './BrandLogo'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  ChevronRight,
  Cpu,
  FileText,
  Search,
  Wrench,
  X
} from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type { TimelineEvent } from '../../../shared/contracts'
import { onWorkspaceCommand } from '../app-commands'
import { useI18n } from '../i18n'
import { useEscapeKey } from '../use-escape-key'
import { useAppStore } from '../store'
import { DEFAULT_SETTINGS } from '../../../shared/defaults'
import '../conversation-settings.css'
import { CodeBlock, MarkdownContent } from './MarkdownContent'
import { CopyButton } from './CopyButton'
import { ConversationOutline } from './ConversationOutline'
import { renderedPlainText } from '../plain-text'
import { findSearchRanges } from '../search-ranges'
import { describeTool } from '../tool-presentation'
import {
  eventKey,
  hasVisibleTimelineContent,
  pairToolEvents,
  searchableEvent
} from '../conversation-model'
import {
  formatTurnDuration,
  presentTurn,
  splitConversationTurns,
  type ConversationTurn
} from '../conversation-turns'
import '../turn-response.css'
import {
  capturePosition,
  readPosition,
  restorePosition,
  savePosition,
  type ReadingPosition
} from '../reading-position'

interface Props {
  events: TimelineEvent[]
  connected: boolean
  active?: boolean
  sessionKey?: string
}

interface EventItem {
  type: 'event'
  event: TimelineEvent
}

interface ActivityItem {
  type: 'activity'
  id: string
  events: TimelineEvent[]
}

type DisplayItem = EventItem | ActivityItem | { type: 'turn'; id: string; turn: ConversationTurn }

export function isActivityEvent(event: TimelineEvent): boolean {
  if (event.kind === 'error') return false
  if (
    event.kind === 'tool-use' ||
    event.kind === 'tool-result' ||
    event.kind === 'status' ||
    event.kind === 'system' ||
    event.kind === 'unknown'
  ) {
    return true
  }

  return (
    (event.kind === 'assistant' && (event.isFinal === false || !event.text)) ||
    (event.kind === 'user' && !event.text)
  )
}

export function groupTimelineEvents(events: TimelineEvent[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let activityEvents: TimelineEvent[] = []

  const flushActivity = (): void => {
    if (!activityEvents.length) return
    items.push({
      type: 'activity',
      id: `activity-${activityEvents[0]!.id}`,
      events: activityEvents
    })
    activityEvents = []
  }

  for (const event of events) {
    if (isActivityEvent(event)) {
      activityEvents.push(event)
      continue
    }
    flushActivity()
    items.push({ type: 'event', event })
  }
  flushActivity()
  return items
}

const expandedItems = new Map<string, boolean>()
function useDisclosure(
  key: string,
  initial: boolean,
  force = false
): [boolean, (value: boolean) => void] {
  const cache = !key.startsWith(':')
  const [open, setOpen] = useState(() => (cache ? expandedItems.get(key) : undefined) ?? initial)
  const previousDefault = useRef(initial)
  useEffect(() => {
    if (previousDefault.current !== initial) {
      previousDefault.current = initial
      setOpen(initial)
      if (cache) expandedItems.set(key, initial)
    }
  }, [initial, key, cache])
  return [
    force || open,
    (value) => {
      setOpen(value)
      if (cache) expandedItems.set(key, value)
      if (expandedItems.size > 2000) expandedItems.delete(expandedItems.keys().next().value!)
    }
  ]
}
function ToolCard({
  event,
  scope = '',
  forced = false
}: {
  event: TimelineEvent
  scope?: string
  forced?: boolean
}): React.JSX.Element {
  const { t, language } = useI18n()
  const [open, setOpen] = useDisclosure(`${scope}:tool:${eventKey(event)}`, !!event.isError, forced)
  const [full, setFull] = useState(false)
  const description = describeTool(event)
  const result =
    event.toolResult == null
      ? ''
      : typeof event.toolResult === 'string'
        ? event.toolResult
        : JSON.stringify(event.toolResult, null, 2)
  const output = event.kind === 'tool-result' ? description.content : result
  const lines = output.split('\n')
  const preview = full || forced ? output : lines.slice(0, 80).join('\n')
  return (
    <article className={`tool-card ${event.isError ? 'error' : ''}`}>
      <button className="tool-card-header" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Wrench size={15} />
        <span className="tool-card-summary">
          <span className="tool-card-label">
            {event.isError ? t('work.toolError') : t(description.label)}
          </span>
          {description.detail && (
            <code className="tool-summary-detail" title={description.detail}>
              {description.detail}
            </code>
          )}
        </span>
        <ChevronDown size={14} className={open ? 'rotated' : ''} />
      </button>
      {open && (
        <div className="tool-card-content">
          {event.kind === 'tool-use' && description.content && (
            <>
              <small>{language === 'zh-CN' ? '参数' : 'Input'}</small>
              <CodeBlock code={description.content} language={description.language} />
            </>
          )}
          {output ? (
            <>
              <small>{language === 'zh-CN' ? '结果' : 'Result'}</small>
              <CodeBlock
                code={preview}
                language={typeof event.toolResult === 'string' ? '' : 'json'}
              />
              {lines.length > 80 && !full && !forced && (
                <button className="quiet-button" onClick={() => setFull(true)}>
                  {language === 'zh-CN'
                    ? `展开其余 ${lines.length - 80} 行`
                    : `Show ${lines.length - 80} more lines`}
                </button>
              )}
              <CopyButton
                text={output}
                label={language === 'zh-CN' ? '复制完整结果' : 'Copy full result'}
              />
            </>
          ) : event.kind === 'tool-use' && !event.toolResultId ? (
            <small>{language === 'zh-CN' ? '等待结果' : 'Waiting for result'}</small>
          ) : (
            <p className="muted">{t('render.noOutput')}</p>
          )}
        </div>
      )}
    </article>
  )
}

function StatusCard({ event }: { event: TimelineEvent }): React.JSX.Element {
  const { language, t } = useI18n()
  const showTimestamps = useAppStore((state) => state.settings?.conversation.showTimestamps ?? true)
  const isProblem = event.kind === 'unknown'
  const label =
    event.kind === 'system'
      ? t('timeline.system')
      : isProblem
        ? t('timeline.unknown')
        : event.activityType === 'thinking'
          ? t('timeline.thinking')
          : event.kind === 'assistant' || event.activityType === 'progress'
            ? t('timeline.progress')
            : t('timeline.statusUpdate')

  return (
    <article className={`activity-status ${isProblem ? 'problem' : ''}`}>
      <div className="activity-status-icon">
        {isProblem ? <CircleAlert size={14} /> : <Cpu size={14} />}
      </div>
      <div className="activity-status-body">
        <div className="activity-status-meta">
          <span>{label}</span>
          {showTimestamps && event.timestamp && (
            <time>{new Date(event.timestamp).toLocaleTimeString(language)}</time>
          )}
        </div>
        {event.text && event.text.trim().toLocaleLowerCase() !== label.toLocaleLowerCase() ? (
          <MarkdownContent text={event.text} />
        ) : isProblem ? (
          <span className="muted">
            {t('timeline.unrecognized', { type: event.rawType ?? 'unknown' })}
          </span>
        ) : null}
      </div>
    </article>
  )
}

function ActivityGroup({
  events,
  scope,
  forced
}: {
  events: TimelineEvent[]
  scope: string
  forced: boolean
}): React.JSX.Element {
  const { t, language } = useI18n()
  const expandActivity = useAppStore(
    (state) => state.settings?.conversation.expandActivity ?? false
  )
  const [open, setOpen] = useDisclosure(
    `${scope}:activity:${eventKey(events[0]!)}`,
    expandActivity,
    forced
  )
  const counts = new Map<string, number>()
  for (const event of events)
    if (event.kind === 'tool-use') {
      const name = t(describeTool(event).label)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  const tools = events.filter((event) => event.kind === 'tool-use').length
  const failures = events.filter((event) => event.isError).length
  return (
    <details
      className="activity-group"
      open={open}
      onToggle={(event) => {
        if (!forced) setOpen(event.currentTarget.open)
      }}
    >
      <summary className="activity-group-header" aria-label={t('timeline.activity')}>
        <Cpu size={15} />
        <span className="activity-group-copy">
          <span>
            {[...counts]
              .map(([name, count]) => `${name} · ${count}${language === 'zh-CN' ? ' 项' : ''}`)
              .join(' · ') || `${t('timeline.statusUpdate')} · ${events.length}`}
            {failures > 0 && (
              <span className="activity-errors">
                {' '}
                · {failures} {language === 'zh-CN' ? '项失败' : 'failed'}
              </span>
            )}
          </span>
        </span>
        <ChevronDown size={14} className="activity-group-chevron" />
      </summary>
      {open && (
        <div className="activity-group-content">
          <p className="activity-expanded-count">
            {t('work.process', { tools, updates: events.length - tools })}
          </p>
          {events.map((event) =>
            event.kind === 'tool-use' || event.kind === 'tool-result' ? (
              <ToolCard event={event} key={eventKey(event)} scope={scope} forced={forced} />
            ) : (
              <StatusCard event={event} key={eventKey(event)} />
            )
          )}
        </div>
      )}
    </details>
  )
}

const MessageCard = memo(function MessageCard({
  event
}: {
  event: TimelineEvent
}): React.JSX.Element {
  const { language, t } = useI18n()
  const showTimestamps = useAppStore((state) => state.settings?.conversation.showTimestamps ?? true)
  const isUser = event.kind === 'user'
  const isProblem = event.kind === 'error' || event.kind === 'unknown'
  const body = useRef<HTMLDivElement>(null)

  return (
    <article className={`message ${isUser ? 'user' : 'assistant'} ${isProblem ? 'problem' : ''}`}>
      <div className="message-body" ref={body}>
        {event.text ? (
          isUser ? (
            <div className="user-message-text">{event.text}</div>
          ) : (
            <MarkdownContent text={event.text} />
          )
        ) : (
          <p className="muted">
            {isProblem
              ? t('timeline.unrecognized', { type: event.rawType ?? 'unknown' })
              : t('timeline.statusUpdate')}
          </p>
        )}
        <div className="message-footer">
          {showTimestamps && event.timestamp && (
            <time>{new Date(event.timestamp).toLocaleTimeString(language)}</time>
          )}
          {!isUser && event.text && (
            <>
              <CopyButton
                iconOnly
                className="message-copy"
                text={event.text}
                label={
                  language === 'zh-CN'
                    ? '复制回复（Markdown 原文）'
                    : 'Copy reply (Markdown source)'
                }
              />
              <CopyButton
                iconOnly
                className="message-copy"
                icon={<FileText size={14} />}
                text={() => {
                  const content = body.current?.querySelector('.markdown-content')
                  return content ? renderedPlainText(content) : (event.text ?? '')
                }}
                label={language === 'zh-CN' ? '复制纯文本' : 'Copy plain text'}
              />
            </>
          )}
        </div>
        {isUser && event.id.startsWith('local-') && event.localDelivery !== 'failed' && (
          <span className="message-delivery">
            {event.localDelivery === 'sending' ? t('composer.sending') : t('work.recordPending')}
          </span>
        )}
      </div>
    </article>
  )
})

function ResponseProblem({ event }: { event: TimelineEvent }): React.JSX.Element {
  const { language } = useI18n()
  const zh = language === 'zh-CN'
  const code = event.responseError?.code
  const notSent = event.rawType === 'local-send'
  const retrying = event.responseError?.retrying
  const reason =
    code === '429' || code === 'rate_limit_error'
      ? zh
        ? '请求频率或额度受限。'
        : 'The request was rate limited or exceeded the available quota.'
      : ['401', '403', 'authentication_error', 'permission_error'].includes(code ?? '')
        ? zh
          ? '服务端拒绝了认证或权限，请检查远端 Claude 的登录和权限。'
          : 'Authentication or permission was rejected. Check the remote Claude credentials.'
        : /^5\d\d$/.test(code ?? '') || code === 'overloaded_error'
          ? zh
            ? '服务暂时无法正常返回回复。'
            : 'The service could not return a response.'
          : zh
            ? '本轮未能正常获得回复，具体原因见错误详情。'
            : 'This turn could not return a response. See the error details.'
  return (
    <div className="response-problem" role="status">
      <div className="response-problem-heading">
        <CircleAlert size={16} aria-hidden="true" />
        <strong>
          {notSent
            ? zh
              ? '消息未发送'
              : 'Message not sent'
            : retrying
              ? zh
                ? '服务请求异常，正在重试'
                : 'Request error · retrying'
              : zh
                ? '回复未完成'
                : 'Response failed'}
        </strong>
        {code && <code>{code}</code>}
      </div>
      <p>
        {notSent
          ? zh
            ? '发送未成功，输入框中的草稿已保留。'
            : 'Sending failed. Your draft remains in the composer.'
          : reason}{' '}
        {retrying
          ? zh
            ? '远端 Claude 正在自动重试，可继续等待。'
            : 'Remote Claude is retrying automatically.'
          : zh
            ? '可查看终端确认原因后重新发送。'
            : 'Check the terminal before sending again.'}
      </p>
      {event.responseError?.retryAfterMs !== undefined && (
        <p>
          {zh ? '下次重试约 ' : 'Next retry in about '}
          {Math.max(1, Math.ceil(event.responseError.retryAfterMs / 1000))}
          {zh ? ' 秒' : ' seconds'}
          {event.responseError.attempt
            ? ` · ${zh ? '第' : 'Attempt '}${event.responseError.attempt}${zh ? '次' : ''}`
            : ''}
        </p>
      )}
      <div className="response-problem-actions">
        <button
          className="quiet-button"
          onClick={() => useAppStore.getState().setWorkspaceMode('split')}
        >
          {zh ? '查看终端' : 'View terminal'}
        </button>
        {event.text && <CopyButton text={event.text} label={zh ? '复制错误' : 'Copy error'} />}
      </div>
      {event.text && (
        <details className="response-error-detail">
          <summary>{zh ? '错误详情' : 'Error details'}</summary>
          <pre>{event.text}</pre>
        </details>
      )}
    </div>
  )
}

const TurnResponse = memo(
  function TurnResponse({
    turn,
    scope,
    forced,
    latest
  }: {
    turn: ConversationTurn
    scope: string
    forced: boolean
    latest: boolean
  }): React.JSX.Element {
    const { language, t } = useI18n()
    const zh = language === 'zh-CN'
    const status = useAppStore((state) => (latest ? state.statuses[scope] : undefined))
    const expandActivity = useAppStore(
      (state) => state.settings?.conversation.expandActivity ?? false
    )
    const presentation = presentTurn(
      turn,
      latest && turn.prompt.turnStartedAt !== undefined && status?.generating === true
    )
    const { replies, activity, problem, completed, failed, stopped, local, startedAt, endedAt } =
      presentation
    const [open, setOpen] = useDisclosure(
      `${scope}:turn:${turn.id}`,
      completed ? (local ? false : expandActivity) : true,
      forced || !completed
    )
    const live = latest && local && !completed && !failed && !stopped
    const [now, setNow] = useState(Date.now)
    useEffect(() => {
      if (!live) return
      const timer = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(timer)
    }, [live])
    const failureEnd = turn.prompt.localDelivery === 'failed' ? turn.prompt.receivedAt : endedAt
    const elapsed =
      startedAt !== undefined && (failureEnd !== undefined || live)
        ? Math.max(0, (failureEnd ?? now) - startedAt)
        : undefined
    const duration = elapsed !== undefined ? formatTurnDuration(elapsed) : undefined
    const disconnected = live && status && status.state !== 'attached'
    const label = stopped
      ? zh
        ? '已停止'
        : 'Stopped after'
      : completed
        ? zh
          ? duration
            ? '耗时'
            : '已完成'
          : duration
            ? 'Worked for'
            : 'Completed'
        : failed
          ? zh
            ? '未完成'
            : 'Failed after'
          : problem?.responseError?.retrying
            ? zh
              ? '正在重试'
              : 'Retrying'
            : disconnected
              ? zh
                ? '连接中断'
                : 'Connection interrupted'
              : live
                ? zh
                  ? '正在处理'
                  : 'Working'
                : zh
                  ? '执行过程'
                  : 'Activity'
    const eventContent = (event: TimelineEvent): React.JSX.Element => (
      <div
        key={eventKey(event)}
        data-timeline-id={eventKey(event)}
        data-turn-id={turn.id}
        data-event-ids={JSON.stringify([eventKey(event)])}
      >
        {event.kind === 'tool-use' || event.kind === 'tool-result' ? (
          <ToolCard event={event} scope={scope} forced={forced} />
        ) : event.kind === 'error' ? (
          <ResponseProblem event={event} />
        ) : event.kind === 'assistant' && event.isFinal !== false ? (
          <MessageCard event={event} />
        ) : (
          <StatusCard event={event} />
        )}
      </div>
    )
    return (
      <div
        className={`turn-response${forced ? ' timeline-match' : ''}`}
        data-turn-state={
          completed
            ? 'completed'
            : failed
              ? 'failed'
              : stopped
                ? 'stopped'
                : live
                  ? 'working'
                  : 'history'
        }
      >
        <details
          className="activity-group turn-activity"
          open={open}
          onToggle={(event) => {
            if (!completed) {
              event.currentTarget.open = true
              return
            }
            if (!forced) setOpen(event.currentTarget.open)
          }}
        >
          <summary
            className="activity-group-header turn-summary"
            aria-label={t('timeline.activity')}
            onClick={(event) => {
              if (!completed) event.preventDefault()
            }}
            aria-description={`${label} ${duration ?? ''}`}
            title={
              local
                ? zh
                  ? '从点击发送到收到最终回复，包括等待和重试'
                  : 'From Send to the final response, including waiting and retries'
                : zh
                  ? '根据远端记录的时间计算；旧记录缺少时间时不估算'
                  : 'Calculated from remote timestamps; unavailable timings are not estimated'
            }
          >
            <span>
              {label}
              {duration ? ` ${duration}` : ''}
            </span>
            <ChevronRight size={14} className="turn-chevron" aria-hidden="true" />
            {activity.some((event) => event.isError) && (
              <span className="turn-issue-count activity-errors">
                {activity.filter((event) => event.isError).length} {zh ? '项失败' : 'failed'}
              </span>
            )}
          </summary>
          {open && (
            <div className="activity-group-content turn-activity-content">
              {activity.map(eventContent)}
              {!activity.length && (
                <p className="turn-empty-activity">
                  {live
                    ? zh
                      ? '消息已提交，等待远端返回过程或回复。'
                      : 'Message submitted. Waiting for remote output.'
                    : zh
                      ? '此轮没有额外的过程记录。'
                      : 'No additional activity was recorded for this turn.'}
                </p>
              )}
              {local && startedAt !== undefined && (
                <p className="turn-timing-detail">
                  {zh ? '发送于 ' : 'Sent at '}
                  {new Date(startedAt).toLocaleTimeString(language)}
                  {endedAt !== undefined
                    ? ` · ${zh ? (completed ? '收到回复于 ' : '结束于 ') : completed ? 'Response received at ' : 'Ended at '}${new Date(endedAt).toLocaleTimeString(language)}`
                    : ''}
                </p>
              )}
            </div>
          )}
        </details>
        {turn.prompt.localDelivery === 'failed' && !completed && (
          <ResponseProblem
            event={{
              id: `${turn.id}-send-error`,
              kind: 'error',
              rawType: 'local-send',
              text: turn.prompt.sendError
            }}
          />
        )}
        {problem && eventContent(problem)}
        {live && !problem && (disconnected || (elapsed ?? 0) >= 30000) && (
          <div className="response-waiting" role="status">
            <span>
              {disconnected
                ? zh
                  ? '连接中断，尚未确认最终结果。重连后继续接收回复。'
                  : 'Connection interrupted. The final result is not confirmed; output will resume after reconnection.'
                : zh
                  ? '仍在等待最终回复，可查看终端了解远端状态。'
                  : 'Still waiting for the final response. Check the terminal for remote activity.'}
            </span>
            <button
              className="quiet-button"
              onClick={() => useAppStore.getState().setWorkspaceMode('split')}
            >
              {zh ? '查看终端' : 'View terminal'}
            </button>
          </div>
        )}
        {replies.map(eventContent)}
      </div>
    )
  },
  (previous, next) =>
    previous.scope === next.scope &&
    previous.forced === next.forced &&
    previous.latest === next.latest &&
    previous.turn.prompt === next.turn.prompt &&
    previous.turn.events.length === next.turn.events.length &&
    previous.turn.events.every((event, index) => event === next.turn.events[index])
)

export function Timeline({
  events,
  connected,
  active = true,
  sessionKey
}: Props): React.JSX.Element {
  const { t, language } = useI18n()
  const conversation = useAppStore(
    (state) => state.settings?.conversation ?? DEFAULT_SETTINGS.conversation
  )
  const generating = useAppStore(
    (state) =>
      !!sessionKey &&
      state.statuses[sessionKey]?.state === 'attached' &&
      state.statuses[sessionKey]?.generating === true
  )
  const manualFollow = useRef(false)
  const autoScroll = conversation.autoScroll
  const timeline = useRef<HTMLElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [outlineJump, setOutlineJump] = useState(0)
  const [savedPosition] = useState(() => readPosition(sessionKey))
  const position = useRef<ReadingPosition | undefined>(savedPosition)
  const restoring = useRef(!!savedPosition && !savedPosition.follow)
  const searchPosition = useRef<ReadingPosition | undefined>(undefined)
  const follow = useRef(savedPosition?.follow ?? true)
  const initialized = useRef(false)
  const previousCount = useRef(events.length)
  const [unread, setUnread] = useState(savedPosition?.unread ?? false)
  const [matchIndex, setMatchIndex] = useState(0)
  const [searchHits, setSearchHits] = useState<{ element: HTMLElement; range?: Range }[]>([])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const pairedEvents = useMemo(
    () => pairToolEvents(events).filter(hasVisibleTimelineContent),
    [events]
  )
  const matching = useMemo(
    () =>
      normalizedQuery
        ? pairedEvents.filter((event) => searchableEvent(event).includes(normalizedQuery))
        : [],
    [pairedEvents, normalizedQuery]
  )
  const matchIds = useMemo(() => new Set(matching.map(eventKey)), [matching])
  const { leading, turns } = useMemo(() => splitConversationTurns(pairedEvents), [pairedEvents])
  const displayItems = useMemo(() => {
    const items: (DisplayItem & { turnId: string })[] = []
    for (const item of groupTimelineEvents(leading)) items.push({ ...item, turnId: 'history' })
    for (const turn of turns) {
      items.push({ type: 'event', event: turn.prompt, turnId: turn.id })
      items.push({ type: 'turn', id: `turn-${turn.id}`, turn, turnId: turn.id })
    }
    return items
  }, [leading, turns])
  const hasEvents = pairedEvents.length > 0
  const remember = useCallback((): void => {
    const element = timeline.current
    if (!element || normalizedQuery || restoring.current) return
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 24
    follow.current = atBottom
    if (!atBottom) manualFollow.current = false
    position.current = capturePosition(element, atBottom, !atBottom && unread)
    savePosition(sessionKey, position.current)
    if (atBottom) setUnread(false)
    setIsAtBottom(atBottom)
  }, [sessionKey, normalizedQuery, unread])
  const openSearch = useCallback((): void => {
    const element = timeline.current
    if (!searchOpen && element) {
      // A scroll event may still be queued when the user presses Ctrl+F.
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 24
      searchPosition.current = capturePosition(element, atBottom, unread)
      position.current = searchPosition.current
      follow.current = atBottom
    }
    setSearchOpen(true)
  }, [searchOpen, unread])
  const closeSearch = useCallback((): void => {
    setSearchOpen(false)
    setQuery('')
    setMatchIndex(0)
    if (searchPosition.current) {
      position.current = searchPosition.current
      follow.current = searchPosition.current.follow
      manualFollow.current = false
      setIsAtBottom(searchPosition.current.follow)
    }
  }, [])
  useEscapeKey(closeSearch, searchOpen)
  const jumpToLatest = useCallback((): void => {
    const element = timeline.current
    if (!element) return
    follow.current = true
    manualFollow.current = true
    setUnread(false)
    element.scrollTo({
      top: element.scrollHeight,
      behavior: 'auto'
    })
  }, [])
  const jumpToTurn = useCallback(
    (id: string): void => {
      const element = timeline.current
      const prompt = element?.querySelector<HTMLElement>(`[data-outline-turn="${CSS.escape(id)}"]`)
      if (!element || !prompt) return
      manualFollow.current = false
      follow.current = false
      restoring.current = true
      // Save the target before resize observers or incoming output can restore the old anchor.
      const target: ReadingPosition = {
        top: element.scrollTop,
        follow: false,
        anchorId: id,
        offset: 0
      }
      position.current = target
      searchPosition.current = undefined
      setSearchOpen(false)
      setQuery('')
      setMatchIndex(0)
      restorePosition(element, target)
      target.top = element.scrollTop
      savePosition(sessionKey, target)
      // Re-align after offscreen content has materialized; queued scroll events
      // must not replace this target with Chromium's temporary estimated position.
      setOutlineJump((request) => request + 1)
      setIsAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight <= 24)
    },
    [sessionKey]
  )
  useLayoutEffect(() => {
    const element = timeline.current
    if (!element || !active || !hasEvents || !restoring.current) return
    // Chromium initially gives contained offscreen content its estimated height.
    // Keep the saved anchor until a paint has materialized the visible content;
    // otherwise a temporarily clamped scrollTop replaces it with zero.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (position.current) restorePosition(element, position.current)
        restoring.current = false
        position.current = capturePosition(element, follow.current, unread)
        savePosition(sessionKey, position.current)
        setIsAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight <= 24)
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [active, hasEvents, sessionKey, unread, outlineJump])
  useLayoutEffect(() => {
    const element = timeline.current
    if (!element || !active || !events.length || normalizedQuery) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      if ((autoScroll || manualFollow.current) && follow.current)
        element.scrollTop = element.scrollHeight
      else if (position.current) restorePosition(element, position.current)
    }
    if (
      initialized.current &&
      events.length > previousCount.current &&
      !((autoScroll || manualFollow.current) && follow.current)
    )
      setUnread(true)
    initialized.current = true
    previousCount.current = events.length
    if (restoring.current) return
    position.current = capturePosition(element, follow.current, unread)
    savePosition(sessionKey, position.current)
    setIsAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight <= 24)
  }, [events, active, normalizedQuery, autoScroll, sessionKey, unread])
  useEffect(() => {
    const element = timeline.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // Mirror Chromium's actual gutter, including fractional system/app scaling.
      const area = element.closest<HTMLElement>('.conversation-area')
      area?.style.setProperty(
        '--reading-scrollbar-space',
        `${Math.max(0, element.getBoundingClientRect().width - element.clientWidth)}px`
      )
      if (!active || normalizedQuery || !window.getSelection()?.isCollapsed) return
      if ((autoScroll || manualFollow.current) && follow.current)
        element.scrollTop = element.scrollHeight
      else if (position.current) restorePosition(element, position.current)
      if (restoring.current) return
      position.current = capturePosition(element, follow.current, unread)
      savePosition(sessionKey, position.current)
      setIsAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight <= 24)
    })
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [active, normalizedQuery, autoScroll, hasEvents, sessionKey, unread])
  useLayoutEffect(() => {
    return () => {
      // Scroll/resize handlers already track the live position. During unmount,
      // containment or a hidden parent can report zero geometry and erase it.
      if (position.current) savePosition(sessionKey, position.current, true)
    }
  }, [sessionKey])
  useEffect(() => {
    const persist = (): void => {
      if (position.current) savePosition(sessionKey, position.current, true)
    }
    window.addEventListener('beforeunload', persist)
    return () => window.removeEventListener('beforeunload', persist)
  }, [sessionKey])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !active ||
        !events.length ||
        document.querySelector('[aria-modal="true"]') ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.key.toLowerCase() !== 'f' ||
        (event.target instanceof Element &&
          event.target.closest('.xterm') &&
          useAppStore.getState().directControl)
      )
        return
      event.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [events.length, active, openSearch])
  useEffect(
    () =>
      onWorkspaceCommand((command) => {
        if (!active || !events.length || document.querySelector('[aria-modal="true"]')) return
        if (command === 'latest') jumpToLatest()
        if (command === 'find-conversation') openSearch()
      }),
    [active, events.length, jumpToLatest, openSearch]
  )
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus()
  }, [searchOpen])
  useLayoutEffect(() => {
    const hits: { element: HTMLElement; range?: Range }[] = []
    if (normalizedQuery && timeline.current) {
      for (const element of timeline.current.querySelectorAll<HTMLElement>('[data-event-ids]')) {
        if (
          !(JSON.parse(element.dataset.eventIds ?? '[]') as string[]).some((id) => matchIds.has(id))
        )
          continue
        const ranges = findSearchRanges(element, normalizedQuery)
        if (ranges.length) hits.push(...ranges.map((range) => ({ element, range })))
        else if (
          (JSON.parse(element.dataset.eventIds ?? '[]') as string[]).some((id) => matchIds.has(id))
        )
          hits.push({ element })
      }
    }
    // Ranges can only be measured after Markdown and tool disclosures commit to the DOM.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchHits(hits)
  }, [normalizedQuery, matchIds, displayItems])
  useLayoutEffect(() => {
    const hit = searchHits[Math.min(matchIndex, searchHits.length - 1)]
    if (!hit || !timeline.current) return
    const bounds = hit.range?.getBoundingClientRect?.()
    if (bounds?.height) {
      timeline.current.scrollTop +=
        bounds.top -
        timeline.current.getBoundingClientRect().top -
        timeline.current.clientHeight / 2
    } else hit.element.scrollIntoView?.({ block: 'center' })
  }, [searchHits, matchIndex])
  useEffect(() => {
    if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return
    const ranges = searchHits.flatMap((hit) => (hit.range ? [hit.range] : []))
    CSS.highlights.set('conversation-search', new Highlight(...ranges))
    const current = searchHits[Math.min(matchIndex, searchHits.length - 1)]?.range
    CSS.highlights.set('conversation-search-current', new Highlight(...(current ? [current] : [])))
    return () => {
      CSS.highlights.delete('conversation-search')
      CSS.highlights.delete('conversation-search-current')
    }
  }, [searchHits, matchIndex])
  return (
    <div
      className={`timeline-shell codex-content${turns.length ? ' has-conversation-outline' : ''}`}
      style={
        {
          '--reply-font-size': `${conversation.fontSize}px`,
          '--reply-line-height': conversation.lineHeight
        } as CSSProperties
      }
    >
      <section
        className={`timeline ${events.length === 0 ? 'empty-state' : ''}`}
        ref={timeline}
        onScroll={remember}
      >
        {events.length === 0 ? (
          <>
            <BrandLogo className="empty-conversation-logo" />
            <h2>{connected ? t('timeline.connectedTitle') : t('timeline.disconnectedTitle')}</h2>
            <p>{connected ? t('timeline.connectedBody') : t('timeline.disconnectedBody')}</p>
          </>
        ) : (
          <div className="timeline-inner">
            {searchOpen && (
              <div className="timeline-search" role="search">
                <Search size={14} />
                <input
                  ref={searchInput}
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setMatchIndex(0)
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.nativeEvent.isComposing &&
                      searchHits.length
                    ) {
                      event.preventDefault()
                      setMatchIndex(
                        (index) =>
                          (index + (event.shiftKey ? searchHits.length - 1 : 1)) % searchHits.length
                      )
                    }
                  }}
                  placeholder={t('timeline.search')}
                  aria-label={t('timeline.search')}
                />
                <span>
                  {searchHits.length ? Math.min(matchIndex + 1, searchHits.length) : 0}/
                  {searchHits.length}
                </span>
                <button
                  disabled={!searchHits.length}
                  onClick={() =>
                    setMatchIndex((index) => (index + searchHits.length - 1) % searchHits.length)
                  }
                  aria-label={language === 'zh-CN' ? '上一个匹配' : 'Previous match'}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  disabled={!searchHits.length}
                  onClick={() => setMatchIndex((index) => (index + 1) % searchHits.length)}
                  aria-label={language === 'zh-CN' ? '下一个匹配' : 'Next match'}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  onClick={closeSearch}
                  aria-label={t('timeline.closeSearch')}
                  title={t('timeline.closeSearch')}
                >
                  <X size={13} />
                </button>
              </div>
            )}
            {displayItems.map((item) => {
              if (item.type === 'turn')
                return (
                  <TurnResponse
                    key={item.id}
                    turn={item.turn}
                    scope={sessionKey ?? ''}
                    latest={item === displayItems.at(-1)}
                    forced={item.turn.events.some((event) => matchIds.has(eventKey(event)))}
                  />
                )
              const id = item.type === 'activity' ? item.id : eventKey(item.event)
              const ids =
                item.type === 'activity' ? item.events.map(eventKey) : [eventKey(item.event)]
              const forced = ids.some((key) => matchIds.has(key))
              return (
                <div
                  key={id}
                  data-timeline-id={id}
                  data-turn-id={item.turnId}
                  data-outline-turn={
                    item.type === 'event' && item.event.kind === 'user' ? item.turnId : undefined
                  }
                  data-event-ids={JSON.stringify(ids)}
                  className={forced ? 'timeline-match' : ''}
                >
                  {item.type === 'activity' ? (
                    <ActivityGroup events={item.events} scope={sessionKey ?? ''} forced={forced} />
                  ) : item.event.kind === 'tool-use' || item.event.kind === 'tool-result' ? (
                    <ToolCard event={item.event} scope={sessionKey} forced={forced} />
                  ) : item.event.kind === 'error' ? (
                    <ResponseProblem event={item.event} />
                  ) : (
                    <MessageCard event={item.event} />
                  )}
                </div>
              )
            })}
            {normalizedQuery && !searchHits.length && (
              <div className="no-search-results">{t('timeline.noResults')}</div>
            )}
          </div>
        )}
      </section>
      {active && turns.length > 0 && (
        <ConversationOutline
          key={sessionKey}
          turns={turns}
          timeline={timeline}
          onNavigate={jumpToTurn}
        />
      )}
      {events.length > 0 && !isAtBottom && (
        <button
          className="timeline-jump-to-latest"
          onClick={jumpToLatest}
          aria-label={t('timeline.jumpToLatest')}
          title={
            generating
              ? language === 'zh-CN'
                ? '正在生成内容'
                : 'Generating response'
              : t('timeline.jumpToLatest')
          }
          data-generating={generating}
        >
          {generating ? (
            <span className="generating-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <ArrowDown size={20} aria-hidden="true" />
          )}
          <span className="sr-only">
            {unread ? `${t('work.newMessages')} · ` : ''}
            {t('timeline.jumpToLatest')}
          </span>
        </button>
      )}
    </div>
  )
}
