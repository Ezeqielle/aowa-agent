// Overlay hotkey model, shared by the overlay package (Overwolf) and the
// desktop globalShortcut fallback.
//
// `code` is a W3C KeyboardEvent.code (e.g. 'KeyA', 'F8', 'Backquote') — the
// physical key, independent of keyboard layout. The Overwolf hotkeys API takes
// this string directly; Electron's globalShortcut needs an accelerator, which
// toAccelerator() derives.

export interface HotkeyBinding {
  code: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
}

export const DEFAULT_HOTKEY: HotkeyBinding = { code: 'KeyA', alt: true, shift: true }

const NAMED: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: '⌫',
  Delete: 'Del',
}

function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return 'Num' + code.slice(6)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return NAMED[code] ?? code
}

// "Alt + Shift + A" — for display in the GUI.
export function hotkeyLabel(h: HotkeyBinding): string {
  const parts: string[] = []
  if (h.ctrl) parts.push('Ctrl')
  if (h.alt) parts.push('Alt')
  if (h.shift) parts.push('Shift')
  if (h.meta) parts.push('Win')
  parts.push(keyName(h.code))
  return parts.join(' + ')
}

function acceleratorKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  const map: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Space: 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    Delete: 'Delete',
  }
  return map[code] ?? null
}

// Electron accelerator, e.g. "Alt+Shift+A". Null when the key has no accelerator
// mapping — the Overwolf overlay hotkey still works from the raw `code`.
export function toAccelerator(h: HotkeyBinding): string | null {
  const key = acceleratorKey(h.code)
  if (!key) return null
  const mods: string[] = []
  if (h.ctrl) mods.push('Control')
  if (h.alt) mods.push('Alt')
  if (h.shift) mods.push('Shift')
  if (h.meta) mods.push('Super')
  return [...mods, key].join('+')
}
