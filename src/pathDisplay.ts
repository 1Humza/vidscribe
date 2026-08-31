/** Keep path labels useful without exposing the machine-specific leading folders. */
export function displayPath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const prefix = normalized.startsWith('/') ? '/' : '';
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) return path;
  return `${prefix}…/${parts.slice(2).join('/')}`;
}
