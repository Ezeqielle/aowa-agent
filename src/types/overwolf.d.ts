// Minimal ambient declarations for the subset of the Overwolf API this agent
// uses. This keeps the scaffold typecheckable without a network install. For
// full, accurate typings replace this file with the official package:
//   npm i -D @overwolf/types   (and add "@overwolf/types" to tsconfig `types`)
//
// Docs: https://dev.overwolf.com/ow-native/reference/

declare namespace overwolf {
  interface Result {
    success: boolean
    error?: string
  }

  namespace games {
    interface RunningGameInfo {
      isRunning: boolean
      id: number
      classId: number
      title?: string
    }
    function getRunningGameInfo(cb: (info: RunningGameInfo | null) => void): void

    namespace events {
      interface InfoUpdate {
        feature: string
        info: Record<string, unknown>
      }
      interface SetRequiredFeaturesResult extends Result {
        supportedFeatures?: string[]
      }
      function setRequiredFeatures(
        features: string[],
        cb: (result: SetRequiredFeaturesResult) => void,
      ): void
      function getInfo(cb: (result: Result & { res?: Record<string, unknown> }) => void): void

      const onInfoUpdates2: {
        addListener(cb: (update: InfoUpdate) => void): void
        removeListener(cb: (update: InfoUpdate) => void): void
      }
      const onNewEvents: {
        addListener(cb: (events: { events: Array<{ name: string; data: string }> }) => void): void
      }
    }
  }

  namespace extensions {
    interface AppLaunchTriggeredEvent {
      origin: string // e.g. "urlscheme", "gamelaunchevent", "dock"
      parameter?: string // the full URL, e.g. "aowa://pair?code=XXXX"
    }
    const onAppLaunchTriggered: {
      addListener(cb: (event: AppLaunchTriggeredEvent) => void): void
    }
  }

  namespace utils {
    function openUrlInDefaultBrowser(url: string, cb?: (result: Result) => void): void
  }

  namespace windows {
    interface Window {
      id: string
      name: string
    }
    function obtainDeclaredWindow(name: string, cb: (result: Result & { window?: Window }) => void): void
    function restore(name: string, cb?: (result: Result) => void): void
    function close(name: string, cb?: (result: Result) => void): void
    function getMainWindow(): globalThis.Window & typeof globalThis
  }
}
