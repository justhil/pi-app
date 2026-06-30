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

function detectInitialLanguage(): 'zh' | 'en' {
  const sys = (navigator.language || 'en').toLowerCase()
  return sys.startsWith('zh') ? 'zh' : 'en'
}

i18n.use(initReactI18next).init({
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
    },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
