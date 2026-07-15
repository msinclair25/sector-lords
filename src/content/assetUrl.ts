/**
 * Portable public-asset URLs for root host (sectorlords.com) and subpath hosts (itch.io).
 * Vite `base` is `/` for deploy and `./` for itch builds.
 */
export function assetUrl(path: string): string {
  const cleaned = (path || '').replace(/^\//, '');
  const base =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL != null
      ? String(import.meta.env.BASE_URL)
      : '/';
  return `${base}${cleaned}`;
}

/** Rewrite absolute /assets/ urls inside inlined CSS for itch subpath hosting. */
export function rewriteCssAssetUrls(css: string): string {
  const base =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL != null
      ? String(import.meta.env.BASE_URL)
      : '/';
  return css
    .replace(/url\(\s*"\/assets\//g, `url("${base}assets/`)
    .replace(/url\(\s*'\/assets\//g, `url('${base}assets/`)
    .replace(/url\(\s*\/assets\//g, `url(${base}assets/`);
}
