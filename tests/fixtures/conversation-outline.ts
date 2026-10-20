import './file-workspace'
import { targetKey, useAppStore } from '../../src/renderer/src/store'
import type { TimelineEvent } from '../../src/shared/contracts'

// Reuse the isolated real-app fixture; all native and remote calls remain mocked.
const makeEvents = (count: number): TimelineEvent[] =>
  Array.from({ length: count }, (_, index) => [
    {
      id: `prompt-${index}`,
      kind: 'user' as const,
      text: `第 ${index + 1} 轮：梳理对话导航的设计与交互细节，让长对话更容易阅读。`
    },
    {
      id: `progress-${index}`,
      kind: 'assistant' as const,
      isFinal: false,
      text: '这是一段执行过程，不应替代正式回答。'
    },
    {
      id: `reply-${index}`,
      kind: 'assistant' as const,
      isFinal: true,
      text: `第 ${index + 1} 轮回答：左侧短线帮助你快速找到之前讨论的内容。悬浮时可以预览提问与回答，点击后回到对应位置。\n\n## 设计细节\n\n默认状态保持安静，只有正在阅读的位置使用更深的颜色。\n\n${'阅读历史消息时，新的回答不会打断当前位置。\n\n'.repeat(5)}`
    }
  ]).flat()

Object.assign(window, {
  outlineFixture: {
    seed(count = 24) {
      const selected = useAppStore.getState().selected!
      useAppStore.setState({ timelines: { [targetKey(selected)]: makeEvents(count) } })
    },
    append() {
      const state = useAppStore.getState()
      const key = targetKey(state.selected!)
      const events = state.timelines[key]!
      useAppStore.setState({
        timelines: {
          [key]: [
            ...events,
            {
              id: 'incoming',
              kind: 'assistant',
              isFinal: true,
              text: '新到达的回答，不改变阅读位置。'
            }
          ]
        }
      })
    },
    pending() {
      const state = useAppStore.getState()
      const key = targetKey(state.selected!)
      useAppStore.setState({
        timelines: {
          [key]: [
            ...state.timelines[key]!,
            { id: 'pending', kind: 'user', text: '尚未收到回答的问题' }
          ]
        }
      })
    },
    fail() {
      const state = useAppStore.getState()
      const key = targetKey(state.selected!)
      useAppStore.setState({
        timelines: {
          [key]: [
            ...state.timelines[key]!,
            { id: 'local-failed', kind: 'user', text: '未发送的草稿', localDelivery: 'failed' }
          ]
        }
      })
    }
  }
})
