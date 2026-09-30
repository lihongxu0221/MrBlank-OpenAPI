/**
 * Zustand Stores 统一导出
 *
 * Ported from cpa-manager-plus (MIT, © 2026 Seakee) apps/web/src/stores/index.ts @ v1.14.1.
 * MrBlank adaptation: only the stores used by the AI providers page. useAuthStore and
 * useThemeStore are thin adapters onto the MrBlank admin session / theme prefs.
 */

export { useNotificationStore } from './useNotificationStore';
export { useThemeStore } from './useThemeStore';
export { useAuthStore } from './useAuthStore';
export { useConfigStore } from './useConfigStore';
