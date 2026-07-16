// Token persistence. Overwolf app windows share the same origin, so localStorage
// is readable across the background and settings windows. (For a production build
// consider overwolf.io for a file-backed store that survives cache clears.)
import { TOKEN_KEY } from './config'

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function loadToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function isPaired(): boolean {
  return !!loadToken()
}
