/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AOWA_API_BASE?: string
  readonly VITE_DEBUG_GEP?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
