import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../../src/renderer/src/components/Composer'
import { useAppStore } from '../../src/renderer/src/store'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

const target = { profileId: 'mas', sessionName: 'claude-test' }

describe('composer terminal-style keyboard controls', () => {
  const writeControl = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    localStorage.clear()
    writeControl.mockClear()
    useAppStore.setState({
      settings: structuredClone(DEFAULT_SETTINGS),
      claudeModes: {},
      statuses: {},
      directControl: false,
      timelines: {},
      nativeCommands: {},
      composerBusy: {},
      composerFeedback: {},
      toast: undefined
    })
    vi.stubGlobal('claudeBridge', {
      prompts: {
        send: vi.fn().mockResolvedValue({ accepted: true }),
        command: vi.fn().mockResolvedValue(undefined),
        interrupt: vi.fn().mockResolvedValue(undefined)
      },
      terminal: { writeControl },
      uploads: { chooseAndUpload: vi.fn() }
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function renderComposer(): HTMLElement {
    const { container } = render(<Composer target={target} connected readOnly={false} />)
    const composer = container.querySelector<HTMLElement>('.cm-content')
    if (!composer) throw new Error('Composer editor was not created')
    composer.focus()
    return composer
  }

  it('preserves failed drafts and lets the user dismiss the warning or start a fresh attempt', async () => {
    localStorage.setItem('clb:draft:mas:claude-test', 'keep this unsent draft')
    vi.mocked(window.claudeBridge.prompts.send).mockRejectedValueOnce(new Error('unconfirmed'))
    const composer = renderComposer()
    fireEvent.click(document.querySelector('.send-button')!)
    await waitFor(() => expect(document.querySelector('.composer-feedback.error')).not.toBeNull())
    expect(composer).toHaveTextContent('keep this unsent draft')
    expect(localStorage.getItem('clb:history:mas:claude-test')).toBeNull()
    fireEvent.click(document.querySelector('.composer-feedback button')!)
    expect(document.querySelector('.composer-feedback')).toBeNull()
    fireEvent.click(document.querySelector('.send-button')!)
    await waitFor(() => expect(composer.querySelector('.cm-placeholder')).not.toBeNull())
    expect(document.querySelector('.composer-feedback.error')).toBeNull()
  })

  it('accepts a transcript receipt even when the send request rejects afterward', async () => {
    localStorage.setItem('clb:draft:mas:claude-test', 'received already')
    vi.mocked(window.claudeBridge.prompts.send).mockImplementationOnce(async () => {
      useAppStore
        .getState()
        .addTimelineEvent(target, {
          id: 'receipt-before-error',
          kind: 'user',
          text: 'received already'
        })
      throw new Error('late transport error')
    })
    const composer = renderComposer()
    fireEvent.click(document.querySelector('.send-button')!)
    await waitFor(() => expect(composer.querySelector('.cm-placeholder')).not.toBeNull())
    expect(document.querySelector('.composer-feedback.error')).toBeNull()
    expect(useAppStore.getState().timelines['mas:claude-test']).toHaveLength(1)
    expect(useAppStore.getState().timelines['mas:claude-test']![0]?.localDelivery).toBe('sent')
  })

  it('pastes an image as an attachment, waits for upload, then sends its path once', async () => {
    const { useImageAttachments } = await import('../../src/renderer/src/image-attachments')
    useImageAttachments.setState({ drafts: {} })
    let finish!: (result: { canceled: boolean; remotePath: string }) => void
    window.claudeBridge.uploads.image = vi.fn(
      () =>
        new Promise<{ canceled: boolean; remotePath: string }>((resolve) => {
          finish = resolve
        })
    )
    const composer = renderComposer()
    const file = new File(['png'], 'clipboard.png', { type: 'image/png' })
    fireEvent.paste(composer, {
      clipboardData: { items: [{ type: file.type, getAsFile: () => file }] }
    })
    await waitFor(() => expect(window.claudeBridge.uploads.image).toHaveBeenCalled())
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/png;base64,')
    )
    expect(document.querySelector('.send-button')).toBeDisabled()
    await act(async () =>
      finish({
        canceled: false,
        remotePath: '/home/test/.local/share/claude-local-bridge/uploads/test/1-clipboard.png'
      })
    )
    fireEvent.click(document.querySelector('.send-button')!)
    await waitFor(() =>
      expect(window.claudeBridge.prompts.send).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '/home/test/.local/share/claude-local-bridge/uploads/test/1-clipboard.png'
        })
      )
    )
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull())
    expect(window.claudeBridge.prompts.send).toHaveBeenCalledTimes(1)
    useImageAttachments.setState({ drafts: {} })
  })

  it('keeps a failed image removable and blocks sending until it is removed', async () => {
    const { useImageAttachments } = await import('../../src/renderer/src/image-attachments')
    useImageAttachments.setState({ drafts: {} })
    window.claudeBridge.uploads.image = vi.fn().mockRejectedValue(new Error('network failed'))
    const composer = renderComposer()
    const file = new File(['png'], 'clipboard.png', { type: 'image/png' })
    fireEvent.paste(composer, {
      clipboardData: { items: [{ type: file.type, getAsFile: () => file }] }
    })
    await waitFor(() => expect(screen.getByText('上传失败，请移除后重贴')).toBeVisible())
    expect(document.querySelector('.send-button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '移除图片' }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(window.claudeBridge.prompts.send).not.toHaveBeenCalled()
    useImageAttachments.setState({ drafts: {} })
  })

  it('keeps an in-flight image attached to its original session after switching', async () => {
    const { useImageAttachments } = await import('../../src/renderer/src/image-attachments')
    useImageAttachments.setState({ drafts: {} })
    let finish!: (value: { canceled: boolean; remotePath: string }) => void
    window.claudeBridge.uploads.image = vi.fn(
      () =>
        new Promise<{ canceled: boolean; remotePath: string }>((resolve) => {
          finish = resolve
        })
    )
    const { container, rerender } = render(<Composer target={target} connected readOnly={false} />)
    const file = new File(['png'], 'clipboard.png', { type: 'image/png' })
    fireEvent.paste(container.querySelector('.cm-content')!, {
      clipboardData: { items: [{ type: file.type, getAsFile: () => file }] }
    })
    await waitFor(() => expect(window.claudeBridge.uploads.image).toHaveBeenCalled())
    rerender(<Composer target={{ ...target, sessionName: 'another' }} connected readOnly={false} />)
    await act(async () => finish({ canceled: false, remotePath: '/tmp/original.png' }))
    expect(screen.queryByRole('img')).toBeNull()
    rerender(<Composer target={target} connected readOnly={false} />)
    expect(screen.getByRole('img')).toBeVisible()
    expect(document.querySelector('.send-button')).toBeEnabled()
    useImageAttachments.setState({ drafts: {} })
  })

  it('completes slash commands without sending, then uses the native command channel', async () => {
    localStorage.setItem('clb:draft:mas:claude-test', '/mo')
    const composer = renderComposer()
    expect(screen.getByRole('listbox')).toBeVisible()
    fireEvent.keyDown(composer, { key: 'Tab' })
    expect(composer).toHaveTextContent('/model')
    expect(window.claudeBridge.prompts.command).not.toHaveBeenCalled()
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })
    await waitFor(() =>
      expect(window.claudeBridge.prompts.command).toHaveBeenCalledWith({
        ...target,
        text: '/model '
      })
    )
    expect(window.claudeBridge.prompts.send).not.toHaveBeenCalled()
    expect(useAppStore.getState().timelines['mas:claude-test']).toBeUndefined()
  })

  it('opens rewind on two idle Esc presses', async () => {
    const composer = renderComposer()
    fireEvent.keyDown(composer, { key: 'Escape' })
    expect(window.claudeBridge.prompts.command).not.toHaveBeenCalled()
    fireEvent.keyDown(composer, { key: 'Escape' })
    await waitFor(() =>
      expect(window.claudeBridge.prompts.command).toHaveBeenCalledWith({
        ...target,
        text: '/rewind'
      })
    )
  })

  it('never turns stopping generation or editing a draft into a rewind', async () => {
    localStorage.setItem('clb:draft:mas:claude-test', 'keep this draft')
    const composer = renderComposer()
    fireEvent.keyDown(composer, { key: 'Escape' })
    fireEvent.keyDown(composer, { key: 'Escape' })
    expect(composer).toHaveTextContent('keep this draft')
    expect(window.claudeBridge.prompts.command).not.toHaveBeenCalled()
    act(() =>
      useAppStore.setState({
        statuses: {
          'mas:claude-test': {
            ...target,
            state: 'attached',
            readOnly: false,
            promptState: 'ready',
            generating: true,
            attempt: 0,
            changedAt: Date.now()
          }
        }
      })
    )
    fireEvent.keyDown(composer, { key: 'Escape' })
    fireEvent.keyDown(composer, { key: 'Escape' })
    await waitFor(() => expect(window.claudeBridge.prompts.interrupt).toHaveBeenCalledTimes(1))
    expect(window.claudeBridge.prompts.command).not.toHaveBeenCalled()
    expect(composer).toHaveTextContent('keep this draft')
  })

  it('retains a rejected native command and does not create a chat bubble', async () => {
    localStorage.setItem('clb:draft:mas:claude-test', '/model')
    vi.mocked(window.claudeBridge.prompts.command).mockRejectedValueOnce(new Error('Not ready'))
    const composer = renderComposer()
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(useAppStore.getState().toast?.body).toBe('Not ready'))
    expect(composer).toHaveTextContent('/model')
    expect(useAppStore.getState().nativeCommands).toEqual({})
    expect(window.claudeBridge.prompts.send).not.toHaveBeenCalled()
  })

  it('shows the latest reply model beside send and isolates it by server and session', () => {
    const { container, rerender } = render(<Composer target={target} connected readOnly={false} />)
    const badge = () => container.querySelector('.composer-model')!
    expect(badge()).toHaveTextContent('未知')
    act(() => {
      useAppStore
        .getState()
        .addTimelineEvent(target, { id: 'reply', kind: 'assistant', model: 'model-a' })
      useAppStore
        .getState()
        .addTimelineEvent(target, { id: 'next', kind: 'assistant', model: 'model-b' })
      useAppStore.getState().addTimelineEvent(target, { id: 'error', kind: 'error' })
    })
    expect(badge()).toHaveTextContent('model-b')
    expect(badge().nextElementSibling).toHaveClass('send-button')
    rerender(<Composer target={{ ...target, profileId: 'other' }} connected readOnly={false} />)
    expect(badge()).toHaveTextContent('未知')
    rerender(<Composer target={target} connected readOnly={false} />)
    expect(badge()).toHaveTextContent('model-b')
    act(() => useAppStore.getState().resetTimeline(target))
    expect(badge()).toHaveTextContent('未知')
  })

  it('uses Up and Down to browse local prompt history and restores the draft', () => {
    localStorage.setItem('clb:draft:mas:claude-test', 'unfinished draft')
    localStorage.setItem(
      'clb:history:mas:claude-test',
      JSON.stringify(['newest command', 'older command'])
    )
    const composer = renderComposer()

    fireEvent.keyDown(composer, { key: 'ArrowUp', code: 'ArrowUp' })
    expect(composer).toHaveTextContent('newest command')

    fireEvent.keyDown(composer, { key: 'ArrowUp', code: 'ArrowUp' })
    expect(composer).toHaveTextContent('older command')

    fireEvent.keyDown(composer, { key: 'ArrowDown', code: 'ArrowDown' })
    expect(composer).toHaveTextContent('newest command')

    fireEvent.keyDown(composer, { key: 'ArrowDown', code: 'ArrowDown' })
    expect(composer).toHaveTextContent('unfinished draft')
  })

  it('sends Shift+Tab to Claude as a permission-mode switch', async () => {
    localStorage.setItem('clb:draft:mas:claude-test', 'keep the draft')
    const composer = renderComposer()
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    composer.dispatchEvent(event)

    await waitFor(() =>
      expect(writeControl).toHaveBeenCalledExactlyOnceWith({ ...target, control: 'shiftTab' })
    )
    expect(event.defaultPrevented).toBe(true)
    expect(composer).toHaveFocus()
    expect(composer).toHaveTextContent('keep the draft')
    expect(window.claudeBridge.prompts.send).not.toHaveBeenCalled()
  })

  it('preserves Shift+Tab navigation on the mode button while displaying the live mode', async () => {
    renderComposer()
    act(() =>
      useAppStore.setState({
        claudeModes: { 'mas:claude-test': 'default' },
        statuses: {
          'mas:claude-test': {
            ...target,
            state: 'attached',
            readOnly: false,
            attempt: 0,
            changedAt: 1,
            permissionMode: 'plan'
          }
        }
      })
    )
    const button = screen.getByRole('button', { name: /模式：计划/ })
    button.focus()
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    button.dispatchEvent(event)
    expect(writeControl).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it.each([
    { active: false, connected: true, readOnly: false },
    { active: true, connected: false, readOnly: false },
    { active: true, connected: true, readOnly: true }
  ])('does not switch from an inactive, disconnected, or read-only composer: %j', (props) => {
    const { container } = render(<Composer target={target} {...props} />)
    fireEvent.keyDown(container.querySelector('.cm-content')!, { key: 'Tab', shiftKey: true })
    expect(writeControl).not.toHaveBeenCalled()
  })

  it('preserves other inputs, dialogs, IME composition, and direct terminal input', () => {
    renderComposer()
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    input.remove()
    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    document.body.append(dialog)
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })
    dialog.remove()
    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    document.body.append(terminal)
    act(() => useAppStore.setState({ directControl: true }))
    fireEvent.keyDown(terminal, { key: 'Tab', shiftKey: true })
    terminal.remove()
    for (const extra of [
      { isComposing: true },
      { keyCode: 229 },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true }
    ]) {
      fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true, ...extra })
    }
    expect(writeControl).not.toHaveBeenCalled()
  })

  it('applies history shortcuts and wrapping without recreating the editor or losing the draft', () => {
    localStorage.setItem('clb:draft:mas:claude-test', 'draft')
    localStorage.setItem('clb:history:mas:claude-test', JSON.stringify(['previous']))
    const composer = renderComposer()
    const view = composer.closest('.cm-editor')
    act(() =>
      useAppStore.setState({
        settings: {
          ...structuredClone(DEFAULT_SETTINGS),
          composer: {
            ...DEFAULT_SETTINGS.composer,
            historyNavigation: 'alt-arrows',
            lineWrapping: false,
            fontSize: 20
          }
        }
      })
    )
    expect(composer.closest('.cm-editor')).toBe(view)
    expect(composer).not.toHaveClass('cm-lineWrapping')
    fireEvent.keyDown(composer, { key: 'ArrowUp', code: 'ArrowUp' })
    expect(composer).toHaveTextContent('draft')
    fireEvent.keyDown(composer, { key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    expect(composer).toHaveTextContent('previous')
    fireEvent.keyDown(composer, { key: 'ArrowDown', code: 'ArrowDown', altKey: true })
    expect(composer).toHaveTextContent('draft')
    act(() =>
      useAppStore.setState({
        settings: {
          ...structuredClone(DEFAULT_SETTINGS),
          composer: { ...DEFAULT_SETTINGS.composer, historyNavigation: 'off' }
        }
      })
    )
    fireEvent.keyDown(composer, { key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    expect(composer).toHaveTextContent('draft')
  })

  it('disables retained history at zero and still sends messages', async () => {
    localStorage.setItem('clb:draft:mas:claude-test', 'send me')
    localStorage.setItem('clb:history:mas:claude-test', JSON.stringify(['old']))
    useAppStore.setState({
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        composer: { ...DEFAULT_SETTINGS.composer, historyLimit: 0 }
      }
    })
    const composer = renderComposer()
    fireEvent.keyDown(composer, { key: 'ArrowUp', code: 'ArrowUp' })
    expect(composer).toHaveTextContent('send me')
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', ctrlKey: true })
    await waitFor(() =>
      expect(window.claudeBridge.prompts.send).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'send me' })
      )
    )
    expect(localStorage.getItem('clb:history:mas:claude-test')).toBeNull()
  })

  it('lets the IME confirm candidates without submitting or canceling its native key event', () => {
    localStorage.setItem('clb:draft:mas:claude-test', '中文草稿')
    const composer = renderComposer()
    for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...options
      })
      expect(composer.dispatchEvent(event)).toBe(true)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(window.claudeBridge.prompts.send).not.toHaveBeenCalled()
    expect(composer).toHaveTextContent('中文草稿')
  })

  it('preserves the draft and blocks buttons and shortcuts during remote confirmation', () => {
    localStorage.setItem('clb:draft:mas:claude-test', 'keep this draft')
    const { container } = render(
      <Composer target={target} connected readOnly={false} promptBlocked />
    )
    const editor = container.querySelector<HTMLElement>('.cm-content')!
    expect(container.querySelector('.send-button')).toBeDisabled()
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 'Tab', code: 'Tab', shiftKey: true })
    expect(window.claudeBridge.prompts.send).not.toHaveBeenCalled()
    expect(writeControl).not.toHaveBeenCalled()
    expect(editor).toHaveTextContent('keep this draft')
    expect(localStorage.getItem('clb:draft:mas:claude-test')).toBe('keep this draft')
  })
})
