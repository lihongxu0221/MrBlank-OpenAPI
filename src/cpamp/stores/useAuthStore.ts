/**
 * MrBlank adapter for cpa-manager-plus (MIT, © 2026 Seakee) stores/useAuthStore.ts.
 *
 * In CPAMP this store owns the CPA Management Key login. In MrBlank the browser never
 * holds the management key: the admin is authenticated by the MrBlank session and every
 * request goes through the BFF whitelist proxy (/api/admin/cpa-mgmt/*), which injects
 * the key server-side. Only the fields read by the AI providers page are provided.
 */

import { create } from 'zustand';
import type { ConnectionStatus } from '@/types';

interface AuthStoreState {
  isAuthenticated: boolean;
  apiBase: string;
  managementKey: string;
  serverVersion: string | null;
  serverCommit: string | null;
  serverBuildDate: string | null;
  supportsPlugin: boolean;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  updateServerVersion: (
    version: string | null,
    buildDate?: string | null,
    commit?: string | null
  ) => void;
  setConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
}

export const CPAMP_BFF_API_BASE = '/api/admin/cpa-mgmt';

export const useAuthStore = create<AuthStoreState>()((set) => ({
  isAuthenticated: true,
  apiBase: CPAMP_BFF_API_BASE,
  // Never populated in the browser; kept for scope hashing parity with CPAMP.
  managementKey: '',
  serverVersion: null,
  serverCommit: null,
  serverBuildDate: null,
  supportsPlugin: false,
  connectionStatus: 'connected',
  connectionError: null,
  updateServerVersion: (version, buildDate, commit) =>
    set((state) => ({
      serverVersion: version ?? state.serverVersion,
      serverBuildDate: buildDate ?? state.serverBuildDate,
      serverCommit: commit ?? state.serverCommit,
    })),
  setConnectionStatus: (status, error = null) =>
    set({ connectionStatus: status, connectionError: error }),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('server-version-update', ((e: CustomEvent) => {
    const detail = e.detail || {};
    useAuthStore
      .getState()
      .updateServerVersion(detail.version || null, detail.buildDate || null, detail.commit || null);
  }) as EventListener);
}
