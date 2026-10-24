// Ссылка с учётом base (на GitHub Pages сайт живёт в /<имя-репо>/).
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.replace(/^\//, '');
  return `${base}/${clean}`;
}
