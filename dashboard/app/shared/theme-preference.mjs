export const THEME_VALUES = Object.freeze(['system', 'light', 'dark']);

export function parseThemePreference(value) {
  return THEME_VALUES.includes(value) ? value : 'system';
}

export function effectiveTheme(preference, prefersDark = false) {
  const selected = parseThemePreference(preference);
  return selected === 'system' ? (prefersDark ? 'dark' : 'light') : selected;
}

export function applyThemePreference(preference, { documentRef = document, storage = globalThis.localStorage } = {}) {
  const selected = parseThemePreference(preference);
  documentRef.documentElement?.setAttribute('data-theme', selected);
  try { storage?.setItem?.('meridianos-ui-theme', selected); } catch { /* browser storage can be unavailable */ }
  return selected;
}
