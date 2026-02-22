# Codebase Map

## Dependencies
- **Runtime:** `electron`, `react`, `react-dom`, `recharts`, `electron-store`, `lucide-react`, `framer-motion`, `clsx`, `tailwind-merge`, `date-fns`
- **Dev:** `electron-vite`, `vite`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`

## Module Overview

### src/main
- **Purpose:** Electron main process. Handles window creation, system tray, and IPC communication.
- **Key files:** `index.ts` (entry point), `store.ts` (persistence).

### src/preload
- **Purpose:** Preload scripts to expose safe APIs to the renderer.
- **Key files:** `index.ts`.

### src/renderer
- **Purpose:** React frontend application.
- **Key files:** `src/main.tsx`, `src/App.tsx`.
- **Components:** `src/components/MonitorWidget.tsx`, `src/components/SettingsPanel.tsx`.

## Functionality Index
- **Window Management:** `src/main/index.ts`
- **Data Polling:** `src/main/services/` (Planned)
- **UI Rendering:** `src/renderer/App.tsx`
