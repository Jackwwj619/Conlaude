import { z } from 'zod'
import { SessionTargetSchema } from './contracts'

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_TEXT_BYTES = 1024 * 1024
export const FileRequestSchema = SessionTargetSchema.extend({
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes('\0'))
})
// Browsing a server does not require an existing tmux session.
export const DirectoryRequestSchema = FileRequestSchema.extend({
  sessionName: SessionTargetSchema.shape.sessionName.optional()
})
export const SaveFileRequestSchema = FileRequestSchema.extend({
  content: z.string().max(MAX_TEXT_BYTES),
  version: z.string().regex(/^[a-f0-9]{64}$/)
})
export type FileRequest = z.infer<typeof FileRequestSchema>
export type DirectoryRequest = z.infer<typeof DirectoryRequestSchema>
export type SaveFileRequest = z.infer<typeof SaveFileRequestSchema>
export interface RemoteFileEntry {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink' | 'other'
  size: number
  modified: number
}
export interface RemoteDirectory {
  path: string
  parent: string
  entries: RemoteFileEntry[]
  truncated: boolean
}
export interface RemoteTextFile {
  kind?: 'text'
  path: string
  content: string
  version: string
  writable: boolean
  lineEnding: 'LF' | 'CRLF' | 'mixed'
}
export interface RemoteImageFile {
  kind: 'image'
  path: string
  version: string
  writable: false
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  bytes: number
  dataUrl: string
}
export type RemoteFile = RemoteTextFile | RemoteImageFile
export interface RemoteFilesApi {
  download: (request: FileRequest) => Promise<{ canceled: boolean; path?: string }>
  list: (request: DirectoryRequest) => Promise<RemoteDirectory>
  read: (request: FileRequest) => Promise<RemoteFile>
  save: (request: SaveFileRequest) => Promise<RemoteTextFile>
}
