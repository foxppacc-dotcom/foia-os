import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import commonEn from './resources/en/common.json';
import sidebarEn from './resources/en/sidebar.json';
import topbarEn from './resources/en/topbar.json';
import casesEn from './resources/en/cases.json';
import caseDetailEn from './resources/en/caseDetail.json';
import inboxEn from './resources/en/inbox.json';

import commonAr from './resources/ar/common.json';
import sidebarAr from './resources/ar/sidebar.json';
import topbarAr from './resources/ar/topbar.json';
import casesAr from './resources/ar/cases.json';
import caseDetailAr from './resources/ar/caseDetail.json';
import inboxAr from './resources/ar/inbox.json';

export const LANG_KEY = 'foia_lang';

// Phase-1 namespaces only -- a component in a page not yet migrated simply
// never calls useTranslation() at all, so it keeps rendering its own
// hardcoded Arabic text regardless of the active language (safe, consistent
// RTL fallback rather than a half-translated page). Later phases add more
// namespace pairs here without touching any of these.
i18n.use(initReactI18next).init({
  resources: {
    en: { common: commonEn, sidebar: sidebarEn, topbar: topbarEn, cases: casesEn, caseDetail: caseDetailEn, inbox: inboxEn },
    ar: { common: commonAr, sidebar: sidebarAr, topbar: topbarAr, cases: casesAr, caseDetail: caseDetailAr, inbox: inboxAr },
  },
  lng: (() => { try { return localStorage.getItem(LANG_KEY) || 'ar'; } catch { return 'ar'; } })(),
  fallbackLng: 'ar',
  ns: ['common', 'sidebar', 'topbar', 'cases', 'caseDetail', 'inbox'],
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes
  returnEmptyString: false,
});

export default i18n;
