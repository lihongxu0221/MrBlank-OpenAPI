/**
 * MrBlank adapter for cpa-manager-plus (MIT, © 2026 Seakee) stores/useThemeStore.ts.
 * The resolved theme follows the MrBlank site theme (html[data-theme]).
 */

import { create } from 'zustand';
import { getTheme, subscribePrefs } from '../../lib/prefs';

type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  resolvedTheme: ResolvedTheme;
}

const readTheme = (): ResolvedTheme => {
  if (typeof document === 'undefined') return 'light';
  return getTheme() === 'light' ? 'light' : 'dark';
};

export const useThemeStore = create<ThemeState>()(() => ({
  resolvedTheme: readTheme(),
}));

if (typeof window !== 'undefined') {
  subscribePrefs(() => useThemeStore.setState({ resolvedTheme: readTheme() }));
}
