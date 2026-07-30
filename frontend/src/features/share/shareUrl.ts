/**
 * Public links go through the managed-function unfurl entry point in
 * production so social crawlers receive real HTML metadata. The function
 * immediately hands human visitors to the cinematic `/s/:token` page.
 * Vite development keeps the direct SPA route because the managed function
 * is not part of the ordinary `npm run dev` server.
 */
export function publicSharePath(token: string): string {
  const safeToken = encodeURIComponent(token);
  return import.meta.env.DEV ? `/s/${safeToken}` : `/api/share/${safeToken}`;
}

export function publicShareUrl(token: string, origin: string): string {
  return new URL(publicSharePath(token), origin).toString();
}
