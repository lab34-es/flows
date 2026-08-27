/// <reference types="vite/client" />

// Vite's `?worker` suffix imports resolve to a Worker constructor. The
// reference above declares them, along with the other asset query suffixes
// (?url, ?raw, ?inline) and import.meta.env.

// The package version, injected at build time by `define` in vite.config.ts
// so the UI can show which release it is without asking the API.
declare const __APP_VERSION__: string
