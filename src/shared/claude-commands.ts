/** Local suggestions only. Execution always belongs to the remote Claude TUI. */
export const CLAUDE_COMMANDS = [
  ['model', '切换模型', 'Switch model'],
  ['resume', '恢复历史对话', 'Resume a conversation'],
  ['rewind', '回到检查点', 'Rewind to a checkpoint'],
  ['clear', '开始新的对话', 'Start a fresh conversation'],
  ['compact', '压缩上下文，可附加说明', 'Compact context with optional instructions'],
  ['context', '查看上下文占用', 'Inspect context usage'],
  ['cost', '查看会话用量', 'View session usage'],
  ['permissions', '管理工具权限', 'Manage tool permissions'],
  ['status', '查看 Claude 状态', 'View Claude status'],
  ['help', '查看原生命令帮助', 'View native help'],
  ['config', '调整 Claude 设置', 'Configure Claude'],
  ['memory', '管理记忆指令', 'Manage memory instructions'],
  ['mcp', '管理 MCP 连接', 'Manage MCP connections']
] as const

export function parseClaudeCommand(text: string): string | undefined {
  // A whole single-line command, not paths, quoted examples or multiline prose.
  return /^\/([a-zA-Z][\w:-]*)(?:[ \t]+[^\r\n]*)?$/.exec(text.trim())?.[1]?.toLowerCase()
}

export function commandSuggestions(text: string) {
  const match = /^\/([\w:-]*)$/.exec(text)
  return match ? CLAUDE_COMMANDS.filter(([name]) => name.startsWith(match[1]!.toLowerCase())) : []
}

export function changesConversation(command: string): boolean {
  // Custom commands may themselves switch conversations: require a live binding
  // when returning from every native interaction, not a guessed newest file.
  return (
    !!command &&
    ![
      'model',
      'context',
      'cost',
      'permissions',
      'status',
      'help',
      'config',
      'memory',
      'mcp'
    ].includes(command)
  )
}
