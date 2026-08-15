export function operationalPollingInterval(value, fallback = 10_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.round(parsed) : fallback;
}

export function operationalStatusPresentation({ offline = false, killSwitch = false } = {}) {
  if (offline) return { state: 'offline', color: '#e34948', label: 'offline' };
  if (killSwitch) return { state: 'halted', color: '#e34948', label: 'kill switch enabled' };
  return { state: 'ready', color: '#0ca30c', label: 'operational' };
}

export function operationalTaskStateLabel(value) {
  return String(value ?? 'unknown').replaceAll('_', ' ');
}

export function operationalRunOutcomeLabel(value) {
  return String(value ?? 'unknown').replaceAll('_', ' ');
}

export function operationalPointColumns(points, timestampField = 'at', valueField = 'value') {
  const ordered = [...(points ?? [])]
    .map((point) => ({ timestamp: Date.parse(point[timestampField]), value: point[valueField] }))
    .filter((point) => !Number.isNaN(point.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  return [ordered.map((point) => point.timestamp / 1000), ordered.map((point) => point.value)];
}
