import { URL_SCHEME } from './config'

// extractPairCode pulls the code out of an `aowa://pair?code=XXXX` deep link.
// Used by the main process when the OS routes the custom-scheme URL to the app.
export function extractPairCode(rawUrl: string): string | null {
  if (!rawUrl || !rawUrl.startsWith(`${URL_SCHEME}://`)) return null
  try {
    const u = new URL(rawUrl.replace(`${URL_SCHEME}://`, 'https://'))
    if (u.host !== 'pair' && !u.pathname.replace(/\//g, '').startsWith('pair')) return null
    const code = u.searchParams.get('code')
    return code && code.trim() ? code.trim() : null
  } catch {
    return null
  }
}
