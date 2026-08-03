// Foreground-window watcher (Windows). GEP doesn't reliably report Warframe's
// focus, so we ask the OS which window is in front and tell the caller whether
// it's Warframe. Used to show the top bar only while Warframe is focused (#60),
// so it never covers the desktop/browser when you alt-tab out.
//
// A single long-lived PowerShell loop prints the foreground process name every
// ~700ms (Add-Type is compiled once, not per poll). No native dependency.
import { spawn, type ChildProcess } from 'node:child_process'

const SCRIPT = [
  "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;",
  'public class FG{',
  '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h,out int p);',
  "}';",
  'while($true){',
  '  $p=0; [void][FG]::GetWindowThreadProcessId([FG]::GetForegroundWindow(),[ref]$p);',
  "  $n=''; try{ $n=(Get-Process -Id $p -ErrorAction Stop).ProcessName }catch{};",
  '  Write-Output $n; Start-Sleep -Milliseconds 700',
  '}',
].join('')

let proc: ChildProcess | null = null

export function startForegroundWatch(onChange: (isWarframe: boolean) => void): void {
  if (process.platform !== 'win32' || proc) return
  try {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { windowsHide: true })
    let last: boolean | null = null
    proc.stdout?.on('data', (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        const name = line.trim()
        if (!name) continue
        const isWf = /warframe/i.test(name)
        if (isWf !== last) {
          last = isWf
          onChange(isWf)
        }
      }
    })
    proc.on('error', (e) => console.error('[AOWA-FOCUS] powershell failed', e))
    proc.on('exit', () => (proc = null))
  } catch (e) {
    console.error('[AOWA-FOCUS] start failed', e)
  }
}

export function stopForegroundWatch(): void {
  proc?.kill()
  proc = null
}
