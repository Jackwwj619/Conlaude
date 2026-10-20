import { create } from 'zustand'

export interface ImageAttachment {
  id: string
  preview: string
  remotePath?: string
  error?: string
}
export const useImageAttachments = create<{
  drafts: Record<string, ImageAttachment[]>
  update: (key: string, transform: (images: ImageAttachment[]) => ImageAttachment[]) => void
}>((set) => ({
  drafts: {},
  update: (key, transform) =>
    set((state) => ({ drafts: { ...state.drafts, [key]: transform(state.drafts[key] ?? []) } }))
}))
export const EMPTY_IMAGES: ImageAttachment[] = []
