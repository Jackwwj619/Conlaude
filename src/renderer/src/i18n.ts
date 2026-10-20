import { useCallback } from 'react'
import type { AppLanguage } from '../../shared/contracts'
import { translate } from '../../shared/i18n'
import { useAppStore } from './store'

export function useI18n(): {
  language: AppLanguage
  t: (key: string, variables?: Record<string, string | number>) => string
} {
  const language = useAppStore((state) => state.settings?.language ?? 'zh-CN')
  const t = useCallback(
    (key: string, variables?: Record<string, string | number>) =>
      translate(language, key, variables),
    [language]
  )
  return { language, t }
}
