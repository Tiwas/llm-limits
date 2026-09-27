# Codebase Map

## Dependencies
- **Runtime:** `electron`, `react`, `react-dom`, `recharts`, `electron-store`, `lucide-react`, `framer-motion`, `clsx`, `tailwind-merge`, `date-fns`
- **Dev:** `electron-vite`, `vite`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`
- **System:** Windows OpenSSH client and the `devserver` SSH alias for remote Codex account status and login.

## Module Overview

### src/main
- **Purpose:** Electron main process. Handles window creation, system tray, and IPC communication.
- **Key files:** `index.ts` (entry point), `store.ts` (persistence).
- **Services:**
  - `services/usage.ts` — Windows Claude/Codex usage and local Codex warmup.
  - `services/codex_remote.ts` — isolated account A/B status and device-code login through the Codex app-server on `devserver`.
  - `services/gcloud.ts` — Windows gcloud/Gemini usage fallback.
- **Depends on:** Electron, `electron-store`, Node child processes, and the fixed `devserver` SSH alias.

### src/preload
- **Purpose:** Preload scripts to expose safe APIs to the renderer.
- **Key files:** `index.ts`.
- **Exports:** Settings, provider login, Codex account reauthentication, usage events, and window controls through `window.api`.

### src/renderer
- **Purpose:** React frontend application.
- **Key files:** `src/main.tsx`, `src/App.tsx`.
- **Exports:** Monitor and settings UI rendered by `App.tsx`.
- **Depends on:** React, Lucide icons, provider SVG assets, and the preload API.

## Functionality Index
- **Window Management:** `src/main/index.ts`
- **Data Polling:** `src/main/index.ts`, `src/main/services/usage.ts`, `src/main/services/gcloud.ts`
- **Devserver Codex Accounts:** `src/main/services/codex_remote.ts`, `pollUsage()` in `src/main/index.ts`
- **Codex Reauthentication:** `beginDevserverCodexLogin()` in `src/main/services/codex_remote.ts`, IPC handlers in `src/main/index.ts`, settings controls in `src/renderer/src/App.tsx`
- **Reset-credit Badges:** account normalization in `src/main/services/codex_remote.ts`, monitor rendering in `src/renderer/src/App.tsx`
- **UI Rendering:** `src/renderer/src/App.tsx`
