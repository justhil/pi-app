import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCommon from '../locales/zh/common.json'
import zhTimeline from '../locales/zh/timeline.json'
import zhReview from '../locales/zh/review.json'
import zhSettings from '../locales/zh/settings.json'
import enCommon from '../locales/en/common.json'
import enTimeline from '../locales/en/timeline.json'
import enReview from '../locales/en/review.json'
import enSettings from '../locales/en/settings.json'

i18n.use(initReactI18next).init({
  resources: {
    zh: {
      common: zhCommon,
      timeline: zhTimeline,
      review: zhReview,
      settings: zhSettings,
    },
    en: {
      common: enCommon,
      timeline: enTimeline,
      review: enReview,
      settings: enSettings,
    },
  },
  lng: 'zh',
  fallbackLng: 'zh',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
