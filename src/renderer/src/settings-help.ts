import type { AppLanguage } from '../../shared/contracts'
import type { SettingPath } from './settings-fields'

// Explain scope and consequences, rather than repeating a setting's name.
const HELP: Partial<Record<SettingPath, readonly [string, string]>> = {
  theme: [
    '选择浅色、深色，或随 Windows 自动切换。',
    'Use light or dark colors, or follow Windows.'
  ],
  language: [
    '更改菜单、按钮和设置的显示语言，立即生效。',
    'Change the language of menus, buttons and settings immediately.'
  ],
  interfaceFont: [
    '用于菜单、侧栏和设置。不会改变回复、代码或终端的字体。',
    'Used for menus, navigation and settings. Reply, code and terminal fonts are independent.'
  ],
  replyFont: [
    '用于对话中的消息正文。代码块使用下方的代码字体。',
    'Used for message text. Code blocks use the separate code font below.'
  ],
  'code.font': [
    '用于回复中的代码块和行内代码，建议使用等宽字体。',
    'Used for code blocks and inline code in replies. A monospaced font is recommended.'
  ],
  'code.fontSize': [
    '调整回复中代码的大小，不影响正文或终端。',
    'Resize code in replies without changing message text or the terminal.'
  ],
  'code.lineHeight': [
    '代码行之间的距离，数值是字号的倍数。',
    'Spacing between code lines, as a multiple of the font size.'
  ],
  'appearance.density': [
    '调整侧栏列表和按钮的间距。紧凑模式可显示更多会话。',
    'Adjust spacing in sidebar lists and buttons. Compact fits more sessions.'
  ],
  'appearance.fontSize': [
    '用于菜单和设置文字。侧栏、回复、代码与终端可分别调整。',
    'Size of menus and settings text. Sidebar, replies, code and terminal have separate sizes.'
  ],
  'appearance.accent': [
    '用于选中项、按钮和键盘焦点，不改变消息正文颜色。',
    'Used for selections, buttons and keyboard focus, without recoloring message text.'
  ],
  'appearance.cornerRadius': [
    '调整按钮、列表选中背景和输入框的圆角。0 表示直角。',
    'Round buttons, selected rows and input boxes. Use 0 for square corners.'
  ],
  'appearance.motion': [
    '减少动画会关闭文件夹展开、面板切换等过渡效果。',
    'Reduce motion disables folder and panel transitions.'
  ],
  'appearance.contentPadding': [
    '对话内容与窗口边缘的最小距离。居中阅读时还受阅读宽度限制。',
    'Minimum space at the sides of the conversation. Centered reading also applies the reading width limit.'
  ],
  'appearance.sidebarFontSize': [
    '调整服务器、文件夹和会话名称的文字大小。',
    'Size of server, folder and conversation names in the sidebar.'
  ],
  'appearance.showServerAddress': [
    '在服务器名称下增加一行连接地址。关闭后仍可悬停查看。',
    'Add a connection address below each server name. It remains available on hover when hidden.'
  ],
  'appearance.showSessionCount': [
    '在服务器右侧显示已发现的会话数。“—”表示尚未加载。',
    'Show discovered sessions beside each server. A dash means the list has not been loaded.'
  ],
  'appearance.headerServer': [
    '选择对话标题左侧显示连接别名、服务器名称，或隐藏该信息。',
    'Show a connection alias or server name before the conversation title, or hide it.'
  ],
  'appearance.showConnectionStatus': [
    '在顶部右侧用图标显示连接状态，悬停查看详情。发送和生成进度显示在输入框上方。',
    'Show a connection icon at the top right; hover for details. Delivery and generation progress appear above the composer.'
  ],
  'appearance.showViewLabels': [
    '为“文件、终端”按钮显示名称。小窗口自动只显示图标。',
    'Label the files and terminal buttons. Small windows use icons only.'
  ],
  'appearance.messageSpacing': [
    '调整相邻消息之间的距离，不影响正文行距。',
    'Adjust the space between messages without changing line height.'
  ],
  'appearance.composerMaxHeight': [
    '输入框随文字行数长高，达到此高度后内部滚动。小窗口会自动降低上限。',
    'The input grows with your text, then scrolls at this height. Small windows use a lower cap.'
  ],
  'conversation.widthMode': [
    '居中阅读适合长段落；铺满可用空间适合宽表格和代码。',
    'Centered reading suits long paragraphs. Full width gives tables and code more space.'
  ],
  'conversation.maxWidth': [
    '限制对话正文和输入框的最大宽度；仅在限制阅读宽度时生效。',
    'Maximum width of the conversation and composer when reading width is limited.'
  ],
  'conversation.fontSize': [
    '调整对话中消息正文的大小。',
    'Resize message text in the conversation.'
  ],
  'conversation.lineHeight': [
    '正文每行的高度，数值是字号的倍数。例如 1.75 表示 1.75 倍行高。',
    'Height of each text line as a multiple of font size. For example, 1.75 means 1.75 times the font size.'
  ],
  'conversation.showTimestamps': [
    '在每条消息下方显示发送或生成时间。',
    'Show the send or generation time below each message.'
  ],
  'conversation.expandActivity': [
    '默认展开文件读取、命令执行等工具调用的详情。',
    'Expand details of tool activity such as file reads and commands by default.'
  ],
  'conversation.autoScroll': [
    '新回复到达时跟随底部；向上阅读旧消息时自动暂停。',
    'Follow new replies while at the bottom. Pause when you scroll up to read earlier messages.'
  ],
  'composer.sendShortcut': [
    '选择发送消息的按键。使用 Enter 发送时，Shift+Enter 换行。',
    'Choose how to send. With Enter to send, Shift+Enter inserts a new line.'
  ],
  'composer.fontSize': [
    '只调整本地输入框中的文字大小。',
    'Resize text in the local message input only.'
  ],
  'composer.lineWrapping': [
    '长行自动折到下一行；关闭后可横向滚动。',
    'Wrap long lines. When off, scroll horizontally instead.'
  ],
  'composer.historyNavigation': [
    '在输入内容的开头或末尾，用快捷键找回此会话已发送的消息。',
    'Recall sent messages at the start or end of the input with these keys.'
  ],
  'composer.historyLimit': [
    '每个会话保存的已发送输入条数。0 为不保存；减少时会先确认清理。',
    'Sent inputs kept per conversation. Use 0 to disable. Reductions ask before pruning.'
  ],
  'composer.maxCharacters': [
    '超过上限时保留草稿并提示，不会截断或发送部分内容。',
    'Oversized messages stay in the draft. No content is truncated or partially sent.'
  ],
  'terminal.font': [
    '只用于真实终端。建议选择等宽字体以保持命令输出对齐。',
    'Used only in the real terminal. Choose monospace to align command output.'
  ],
  'terminal.fontSize': ['调整真实终端中的文字大小。', 'Resize text in the real terminal.'],
  'terminal.lineHeight': [
    '终端每行的高度，数值是字号的倍数。',
    'Terminal line height as a multiple of font size.'
  ],
  'terminal.cursorStyle': [
    '改变真实终端中输入光标的外形。',
    'Choose the shape of the input cursor in the real terminal.'
  ],
  'terminal.cursorBlink': [
    '让真实终端中的输入光标闪烁。',
    'Blink the input cursor in the real terminal.'
  ],
  'terminal.scrollback': [
    '可向上回看的终端输出行数。较大的值会占用更多内存。',
    'Terminal output lines kept for scrolling back. Larger values use more memory.'
  ],
  closeToTray: [
    '点击窗口关闭按钮时隐藏到系统托盘，保持远端连接。',
    'Hide in the system tray when closing the window and keep connections alive.'
  ],
  startMinimizedToTray: [
    '下次启动时进入系统托盘，不自动显示主窗口。',
    'On the next launch, start in the system tray without opening the main window.'
  ],
  notifications: [
    '窗口在后台时，提醒你回复已完成、需要确认或连接失败。',
    'Notify you of completed replies, confirmations or connection failures while the app is in the background.'
  ],
  confirmExternalLinks: [
    '在系统浏览器中打开外部链接前，先显示确认提示。',
    'Ask before opening external links in your system browser.'
  ]
}

export function settingHelp(path: SettingPath, language: AppLanguage): string {
  return HELP[path]?.[language === 'zh-CN' ? 0 : 1] ?? ''
}

export function settingUnit(path: SettingPath): string {
  if (
    /fontSize/i.test(path) ||
    [
      'conversation.maxWidth',
      'appearance.cornerRadius',
      'appearance.contentPadding',
      'appearance.messageSpacing',
      'appearance.composerMaxHeight'
    ].includes(path)
  )
    return 'px'
  if (path.includes('lineHeight')) return '×'
  return ''
}
