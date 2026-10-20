import { dialog, nativeImage, type BrowserWindow } from 'electron'
import { stat, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type {
  AppLanguage,
  Profile,
  SessionTarget,
  UploadResult,
  UploadProgress
} from '../shared/contracts'
import { translate } from '../shared/i18n'
import { runProcess } from './process-runner'
import { scpArgsFor, SshClient } from './ssh-client'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

function safeFilename(filename: string): string {
  const sanitized = filename
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 180)
  return sanitized || 'upload.bin'
}

export class UploadManager {
  constructor(
    private readonly window: () => BrowserWindow | undefined,
    private readonly ssh: SshClient,
    private readonly progress?: (target: SessionTarget, progress: UploadProgress) => void
  ) {}

  async chooseAndUpload(
    profile: Profile,
    target: SessionTarget,
    language: AppLanguage
  ): Promise<UploadResult> {
    const owner = this.window()
    const selection = await dialog.showOpenDialog(owner!, {
      title: translate(language, 'main.chooseUpload'),
      properties: ['openFile']
    })
    const localPath = selection.filePaths[0]
    if (selection.canceled || !localPath) return { canceled: true }

    return this.uploadFile(profile, target, language, localPath)
  }

  async uploadImage(
    profile: Profile,
    target: SessionTarget,
    language: AppLanguage,
    dataUrl: unknown
  ): Promise<UploadResult> {
    if (
      typeof dataUrl !== 'string' ||
      dataUrl.length > 140 * 1024 * 1024 ||
      !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)
    )
      throw new Error('Invalid clipboard image')
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) throw new Error('Invalid clipboard image')
    const png = image.toPNG()
    if (png.length > MAX_UPLOAD_BYTES) throw new Error(translate(language, 'upload.tooLarge'))
    const directory = await mkdtemp(join(tmpdir(), 'clb-image-'))
    try {
      const localPath = join(directory, `clipboard-${randomUUID()}.png`)
      await writeFile(localPath, png)
      const result = await this.uploadFile(profile, target, language, localPath)
      return { ...result, localPath: undefined }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  private async uploadFile(
    profile: Profile,
    target: SessionTarget,
    language: AppLanguage,
    localPath: string
  ): Promise<UploadResult> {
    const info = { filename: basename(localPath), bytes: 0, startedAt: Date.now() }
    const update = (stage: UploadProgress['stage']): void =>
      this.progress?.(target, { ...info, stage })
    try {
      const metadata = await stat(localPath)
      info.bytes = metadata.size
      update('preparing')
      if (!metadata.isFile()) throw new Error(translate(language, 'upload.regular'))
      if (metadata.size > MAX_UPLOAD_BYTES) throw new Error(translate(language, 'upload.tooLarge'))
      const filename = `${Date.now()}-${safeFilename(basename(localPath))}`
      const relativeDirectory = `.local/share/claude-local-bridge/uploads/${target.sessionName}`
      const remoteDirectory = `~/${relativeDirectory}`
      const mkdirTarget = `"$HOME/${relativeDirectory}"`
      const mkdir = await this.ssh.run(
        profile,
        `mkdir -p ${mkdirTarget} && chmod 700 ${mkdirTarget}`
      )
      if (mkdir.exitCode !== 0)
        throw new Error(mkdir.stderr.trim() || translate(language, 'upload.directoryFailed'))

      update('transferring')
      const upload = await runProcess(
        this.ssh.scpPath,
        scpArgsFor(profile, localPath, `${remoteDirectory}/${filename}`),
        { timeoutMs: 120000 }
      )
      if (upload.exitCode !== 0)
        throw new Error(upload.stderr.trim() || translate(language, 'upload.failed'))

      update('resolving')
      const home = await this.ssh.run(profile, 'printf \'%s\' "$HOME"')
      if (home.exitCode !== 0 || !home.stdout.trim().startsWith('/')) {
        throw new Error(translate(language, 'upload.pathFailed'))
      }

      update('complete')
      return {
        canceled: false,
        localPath,
        remotePath: `${home.stdout.trim()}/${relativeDirectory}/${filename}`,
        bytes: metadata.size
      }
    } catch (error) {
      update('failed')
      throw error
    }
  }
}
