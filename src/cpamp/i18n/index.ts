/**
 * i18next 国际化配置
 *
 * Ported from cpa-manager-plus (MIT, © 2026 Seakee) apps/web/src/i18n/index.ts @ v1.14.1.
 * MrBlank adaptation: only zh-CN + en resources (subset of namespaces used by the
 * AI providers page), and the active language follows the MrBlank site language.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';
import { getLanguage, subscribeLanguage } from '../../i18n';

const resolveSiteLanguage = () => (getLanguage() === 'en' ? 'en' : 'zh-CN');

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  lng: resolveSiteLanguage(),
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false, // React 已经转义
  },
  react: {
    useSuspense: false,
  },
});

subscribeLanguage(() => {
  const next = resolveSiteLanguage();
  if (i18n.language !== next) void i18n.changeLanguage(next);
});

export default i18n;
