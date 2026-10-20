export function fileError(reason: unknown, zh: boolean): string {
  const message = (reason instanceof Error ? reason.message : String(reason)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  )
  const messages: Record<string, [string, string]> = {
    CONFLICT: [
      '远端文件已变化。你的修改已保留，请复制需要的内容后重新读取。',
      'The remote file changed. Your edits are preserved. Copy anything you need before reloading.'
    ],
    IMAGE_TOO_LARGE: [
      '图片超过 20 MB，无法预览。可以下载后打开。',
      'This image exceeds 20 MB. Download it to open locally.'
    ],
    TOO_LARGE: [
      '文本超过 1 MB，无法在线编辑。可以下载后打开。',
      'This text exceeds 1 MB. Download it to open locally.'
    ],
    NOT_TEXT: [
      '此文件无法预览，可以下载后打开。',
      'This file cannot be previewed. Download it to open locally.'
    ],
    SYMLINK: [
      '请通过实际文件路径打开符号链接。',
      'Open the actual file path for this symbolic link.'
    ],
    READ_ONLY: ['当前文件或会话为只读，无法保存。', 'This file or session is read-only.'],
    PERMISSION: ['没有访问此路径的权限。', 'Permission denied for this path.'],
    NOT_FOUND: ['路径不存在，可能已被移动或删除。', 'The path no longer exists.'],
    NOT_DIRECTORY: ['请输入文件夹路径。', 'Enter a directory path.'],
    INVALID_PATH: [
      '请输入绝对路径或以 ~/ 开头的路径。',
      'Enter an absolute path or a path starting with ~/.'
    ],
    IO_ERROR: [
      '文件操作失败，请检查连接后重试。',
      'File operation failed. Check the connection and retry.'
    ]
  }
  return messages[message]?.[zh ? 0 : 1] ?? message
}
