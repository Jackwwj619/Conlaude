import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { useAppStore } from '../../src/renderer/src/store'
import type { TimelineEvent } from '../../src/shared/contracts'
import {
  groupTimelineEvents,
  isActivityEvent,
  Timeline
} from '../../src/renderer/src/components/Timeline'

const events: TimelineEvent[] = [
  { id: 'user-1', kind: 'user', text: '检查项目' },
  { id: 'progress-1', kind: 'assistant', isFinal: false, text: '我先查看文件。' },
  { id: 'tool-1', kind: 'tool-use', toolName: 'Read', toolInput: { path: '/tmp/a' } },
  { id: 'result-1', kind: 'tool-result', toolResult: 'ok' },
  { id: 'final-1', kind: 'assistant', isFinal: true, text: '检查完成。' }
]

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
)

beforeEach(() => useAppStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) }))

afterEach(() => {
  cleanup()
  for (const [property, descriptor] of [
    ['scrollHeight', originalScrollHeight],
    ['clientHeight', originalClientHeight],
    ['scrollTop', originalScrollTop],
    ['scrollTo', originalScrollTo],
    ['scrollIntoView', originalScrollIntoView]
  ] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, property, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, property)
  }
})

describe('timeline activity folding', () => {
  it('keeps activity open until a nonempty final response is rendered, then collapses it', async () => {
    const pending: TimelineEvent[] = [
      { id: 'local-wait', kind: 'user', text: 'wait', turnStartedAt: Date.now() },
      { id: 'progress-wait', kind: 'assistant', isFinal: false, text: 'Still working' }
    ]
    const { container, rerender } = render(<Timeline connected events={pending} />)
    expect(container.querySelector('.turn-activity')).toHaveAttribute('open')
    fireEvent.click(screen.getByLabelText('执行详情'))
    expect(container.querySelector('.turn-activity')).toHaveAttribute('open')
    rerender(
      <Timeline
        connected={false}
        events={[...pending, { id: 'empty-final', kind: 'assistant', isFinal: true, text: '  ' }]}
      />
    )
    expect(container.querySelector('.turn-activity')).toHaveAttribute('open')
    rerender(
      <Timeline
        connected
        events={[
          ...pending,
          { id: 'real-final', kind: 'assistant', isFinal: true, text: 'Finished response' }
        ]}
      />
    )
    expect(screen.getByText('Finished response')).toBeVisible()
    await waitFor(() =>
      expect(container.querySelector('.turn-activity')).not.toHaveAttribute('open')
    )
    fireEvent.click(screen.getByLabelText('执行详情'))
    await waitFor(() => expect(container.querySelector('.turn-activity')).toHaveAttribute('open'))
  })

  it('does not leave an unsent draft or a false failure turn in chat history', () => {
    const { container } = render(
      <Timeline
        connected
        events={[
          ...events,
          {
            id: 'local-failed',
            kind: 'user',
            text: 'Keep only in composer',
            localDelivery: 'failed',
            sendError: 'unconfirmed'
          }
        ]}
      />
    )
    expect(screen.queryByText('Keep only in composer')).toBeNull()
    expect(container.querySelector('.response-problem')).toBeNull()
    expect(container.querySelectorAll('.turn-response')).toHaveLength(1)
  })
  it('omits metadata-only activity in the display and search without hiding errors or empty tool results', async () => {
    const metadata: TimelineEvent = {
      id: 'metadata',
      kind: 'status',
      permissionMode: 'plan',
      model: 'reported-model',
      rawType: 'metadata-only-record'
    }
    const { container, rerender } = render(<Timeline events={[metadata]} connected />)
    expect(container.querySelector('.activity-group')).toBeNull()
    rerender(
      <Timeline
        connected
        events={[
          metadata,
          { id: 'prompt', kind: 'user', text: '检查项目' },
          { ...metadata, id: 'in-turn', text: ' \n ' },
          { id: 'empty-result', kind: 'tool-result', toolResult: '' },
          { id: 'unknown', kind: 'unknown', rawType: 'new-record' },
          { id: 'error', kind: 'error' }
        ]}
      />
    )
    fireEvent.click(screen.getByLabelText('执行详情'))
    await screen.findByText('未知事件')
    expect(container.querySelectorAll('.activity-status')).toHaveLength(1)
    expect(screen.getByText('未知事件')).toBeVisible()
    expect(container.querySelector('.tool-card')).not.toBeNull()
    expect(container.querySelector('.response-problem')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', ctrlKey: true })
    fireEvent.change(await screen.findByRole('searchbox'), {
      target: { value: 'metadata-only-record' }
    })
    expect(screen.getByText('没有匹配的消息')).toBeVisible()
  })

  it('labels explicit thinking and intermediate replies while keeping final replies separate', async () => {
    const { container } = render(
      <Timeline
        connected
        events={[
          { id: 'prompt', kind: 'user', text: '检查项目' },
          { id: 'thinking', kind: 'status', activityType: 'thinking', text: '先梳理依赖。' },
          { id: 'progress', kind: 'assistant', isFinal: false, text: '开始检查文件。' },
          { id: 'final', kind: 'assistant', isFinal: true, text: '已完成检查。' }
        ]}
      />
    )
    expect(container.querySelector('.turn-activity')).not.toHaveAttribute('open')
    expect(screen.getByText('已完成检查。')).toBeVisible()
    fireEvent.click(screen.getByLabelText('执行详情'))
    expect(await screen.findByText('思考过程')).toBeVisible()
    expect(screen.getByText('执行进展')).toBeVisible()
    expect(container.querySelector('.turn-activity-content .message')).toBeNull()
    expect(container.querySelector('.turn-activity-content .message-copy')).toBeNull()
    expect(screen.getAllByRole('button', { name: '复制回复（Markdown 原文）' })).toHaveLength(1)
  })

  it('updates timestamps and activity expansion from preferences and keeps manual toggles', () => {
    const timestamped = events.map((event) => ({ ...event, timestamp: '2026-10-04T04:00:00Z' }))
    const { container, rerender } = render(<Timeline events={timestamped} connected />)
    expect(container.querySelector('time')).not.toBeNull()
    act(() =>
      useAppStore.setState({
        settings: {
          ...structuredClone(DEFAULT_SETTINGS),
          conversation: {
            ...DEFAULT_SETTINGS.conversation,
            showTimestamps: false,
            expandActivity: true
          }
        }
      })
    )
    expect(container.querySelector('time')).toBeNull()
    const group = container.querySelector('details')!
    expect(group).toHaveAttribute('open')
    group.open = false
    rerender(
      <Timeline
        events={[...timestamped, { id: 'extra', kind: 'assistant', text: 'new' }]}
        connected
      />
    )
    expect(group).not.toHaveAttribute('open')
  })

  it('follows new content only when enabled and the reader is at the bottom', () => {
    let height = 500
    let top = 0
    Object.defineProperties(HTMLElement.prototype, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => 200 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = Math.min(height - 200, value)
        }
      }
    })
    useAppStore.setState({
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        conversation: { ...DEFAULT_SETTINGS.conversation, autoScroll: true }
      }
    })
    const { container, rerender } = render(<Timeline events={events.slice(0, 1)} connected />)
    expect(top).toBe(300)
    height = 800
    rerender(<Timeline events={events} connected />)
    expect(top).toBe(600)
    top = 100
    fireEvent.scroll(container.querySelector('.timeline')!)
    height = 1200
    rerender(
      <Timeline events={[...events, { id: 'extra', kind: 'assistant', text: 'new' }]} connected />
    )
    expect(top).toBe(100)
  })
  it('groups intermediate updates and tools while leaving the final Claude reply visible', () => {
    const items = groupTimelineEvents(events)
    expect(items.map((item) => item.type)).toEqual(['event', 'activity', 'event'])
    expect(isActivityEvent(events[1]!)).toBe(true)
    expect(isActivityEvent(events[4]!)).toBe(false)

    render(<Timeline events={events} connected />)

    expect(screen.getByText('检查完成。')).toBeVisible()
    const group = screen.getByLabelText('执行详情').closest('details')
    expect(group).not.toBeNull()
    expect(group).not.toHaveAttribute('open')
  })

  it('never scrolls on new events and supplies a user-controlled jump button', async () => {
    let currentTop = 0
    const scrollTo = vi.fn()
    const scrollIntoView = vi.fn()
    Object.defineProperties(HTMLElement.prototype, {
      scrollHeight: { configurable: true, get: () => 1000 },
      clientHeight: { configurable: true, get: () => 200 },
      scrollTop: {
        configurable: true,
        get: () => currentTop,
        set: (value: number) => {
          currentTop = Math.min(value, 800)
        }
      },
      scrollTo: { configurable: true, value: scrollTo },
      scrollIntoView: { configurable: true, value: scrollIntoView }
    })

    const { rerender } = render(<Timeline events={events.slice(0, 1)} connected />)
    rerender(<Timeline events={events} connected />)

    const button = await screen.findByRole('button', { name: '跳至最新' })
    expect(scrollIntoView).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' }))
  })

  it('opens conversation search only with Ctrl+F and closes it with Escape', async () => {
    render(<Timeline events={events} connected />)

    expect(screen.queryByRole('searchbox', { name: '搜索当前对话' })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', ctrlKey: true })
    const input = await screen.findByRole('searchbox', { name: '搜索当前对话' })
    expect(input).toHaveFocus()

    fireEvent.change(input, { target: { value: 'does not exist' } })
    expect(screen.getByText('没有匹配的消息')).toBeVisible()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('searchbox', { name: '搜索当前对话' })).not.toBeInTheDocument()
    expect(screen.queryByText('没有匹配的消息')).not.toBeInTheDocument()
  })

  it('renders GFM tables in a scrollable semantic table container', () => {
    render(
      <Timeline
        connected
        events={[
          {
            id: 'table-1',
            kind: 'assistant',
            isFinal: true,
            text: '| Role | Model |\n| --- | --- |\n| probe | gpt-5 |'
          }
        ]}
      />
    )

    const table = screen.getByRole('table')
    expect(table.closest('.markdown-table-scroll')).not.toBeNull()
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2)
    expect(within(table).getAllByRole('cell')).toHaveLength(2)
  })
})
