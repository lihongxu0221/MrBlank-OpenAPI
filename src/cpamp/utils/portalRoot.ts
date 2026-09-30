/**
 * MrBlank adaptation helper (not part of cpa-manager-plus).
 *
 * CPAMP portals drawers / modals / dropdowns / tooltips / notifications into
 * document.body. In MrBlank all CPAMP global styles are scoped under `.cpamp-scope`
 * (so they cannot leak into the rest of the site), therefore portals must render into
 * a body-level host that carries the same scope + theme root as the page.
 */
import { getTheme, subscribePrefs } from '../../lib/prefs';

let host: HTMLDivElement | null = null;
let root: HTMLDivElement | null = null;

const syncTheme = () => {
  if (root) root.dataset.theme = getTheme() === 'light' ? 'white' : 'dark';
};

export function getCpampPortalRoot(): HTMLElement {
  if (typeof document === 'undefined' || !document.body || !document.createElement) {
    // Non-DOM environments (unit tests with a mocked createPortal): mirror CPAMP's
    // document.body reference semantics as closely as possible.
    return (typeof document !== 'undefined' ? document.body : undefined) as unknown as HTMLElement;
  }
  if (root && host && document.body.contains(host)) return root;
  host = document.createElement('div');
  host.className = 'cpamp-scope cpamp-portal-host';
  root = document.createElement('div');
  root.className = 'cpamp-theme-root cpamp-portal-root';
  host.appendChild(root);
  document.body.appendChild(host);
  syncTheme();
  return root;
}

if (typeof window !== 'undefined') {
  subscribePrefs(syncTheme);
}
