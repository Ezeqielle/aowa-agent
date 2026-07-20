// Token persistence in the main process (a small JSON file in userData).
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface State {
  token?: string
}

const file = () => join(app.getPath('userData'), 'agent.json')

function read(): State {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as State) : {}
  } catch {
    return {}
  }
}
function write(s: State): void {
  writeFileSync(file(), JSON.stringify(s))
}

export const loadToken = (): string | null => read().token ?? null
export const saveToken = (t: string): void => write({ ...read(), token: t })
export const clearToken = (): void => {
  const s = read()
  delete s.token
  write(s)
}
