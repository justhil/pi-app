import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCommon from '../locales/zh/common.json'
import zhTimeline from '../locales/zh/timeline.json'
import zhReview from '../locales/zh/review.json'
import zhSettings from '../locales/zh/settings.json'
import zhComposer from '../locales/zh/composer.json'
import zhContext from '../locales/zh/context.json'
import zhAdapters from '../locales/zh/adapters.json'
import zhRun from '../locales/zh/run.json'
import zhExtension from '../locales/zh/extension.json'
import zhFiles from '../locales/zh/files.json'
import zhUpdate from '../locales/zh/update.json'
import enCommon from '../locales/en/common.json'
import enTimeline from '../locales/en/timeline.json'
import enReview from '../locales/en/review.json'
import enSettings from '../locales/en/settings.json'
import enComposer from '../locales/en/composer.json'
import enContext from '../locales/en/context.json'
import enAdapters from '../locales/en/adapters.json'
import enRun from '../locales/en/run.json'
import enExtension from '../locales/en/extension.json'
import enFiles from '../locales/en/files.json'
import enUpdate from '../locales/en/update.json'
import { ipcClient } from './ipc-client'

type AppLanguage = 'zh' | 'en'

function detectInitialLanguage(): AppLanguage {
  const systemLanguage = (navigator.language || 'en').toLowerCase()
  return systemLanguage.startsWith('zh') ? 'zh' : 'en'
}

function normalizeAppLanguage(language: unknown, fallbackLanguage: AppLanguage): AppLanguage {
  const normalizedLanguage = String(language ?? '').toLowerCase()
  if (normalizedLanguage.startsWith('zh')) return 'zh'
  if (normalizedLanguage.startsWith('en')) return 'en'
  return fallbackLanguage
}

function applyDocumentLanguage(language: AppLanguage): void {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
}

const i18nInitialization = i18n.use(initReactI18next).init({
  resources: {
    zh: {
      common: zhCommon,
      timeline: zhTimeline,
      review: zhReview,
      settings: zhSettings,
      composer: zhComposer,
      context: zhContext,
      adapters: zhAdapters,
      run: zhRun,
      extension: zhExtension,
      files: zhFiles,
      update: zhUpdate,
    },
    en: {
      common: enCommon,
      timeline: enTimeline,
      review: enReview,
      settings: enSettings,
      composer: enComposer,
      context: enContext,
      adapters: enAdapters,
      run: enRun,
      extension: enExtension,
      files: enFiles,
      update: enUpdate,
    },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
})

i18n.on('languageChanged', (language) => {
  applyDocumentLanguage(normalizeAppLanguage(language, detectInitialLanguage()))
})

export async function hydrateLanguageFromSettings(): Promise<AppLanguage> {
  const settingsResponsePromise = ipcClient
    .invoke('settings.get', { key: 'language' })
    .catch(() => ({ settings: {} }))

  const [, settingsResponse] = await Promise.all([i18nInitialization, settingsResponsePromise])
  const currentLanguage = normalizeAppLanguage(
    i18n.resolvedLanguage || i18n.language,
    detectInitialLanguage(),
  )
  const savedLanguage = normalizeAppLanguage(
    settingsResponse?.settings?.language,
    currentLanguage,
  )

  if (currentLanguage !== savedLanguage) await i18n.changeLanguage(savedLanguage)
  applyDocumentLanguage(savedLanguage)
  return savedLanguage
}

export default i18n
