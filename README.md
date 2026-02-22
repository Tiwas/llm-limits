# LLM Limits

A floating desktop monitor for AI quota usage (Codex/OpenAI, Claude, Gemini), built with Electron + React + TypeScript.

## Features

- Always-on-top compact monitor window
- Session/period quota toggle in the monitor
- Reset timestamp display with configurable:
  - 12H / 24H time
  - `DD.MM.YYYY` / `MM.DD.YYYY` date order
  - `.` or `/` date separator
- Settings auto-open on first run (or when provider config is missing)
- Optional auto-start on OS login
- Window position memory + snap-to-edge placements

## Tech Stack

- Electron
- React + TypeScript
- Tailwind CSS
- electron-store (local settings persistence)

## Prerequisites

- Node.js 20+
- npm
- Windows recommended for packaging (`.exe`)

## Install

```bash
npm install
```

## Run in Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

Build output is generated in `out/`.

## Create Windows Installer (`.exe`)

```bash
npm run dist
```

Installer/artifacts are generated in `dist/` (for example NSIS installer and `win-unpacked`).

## Configuration

Open **Settings** from the app context menu/tray.

Available settings include:

- Provider credentials/configuration
  - Codex/OpenAI
  - Claude (API or web-login integration)
  - Gemini
- Update frequency (minutes)
- Time format (24H/12H)
- Date format + separator
- Auto-start on OS login
- Debug logging

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch
3. Make your changes with clear commit messages
4. Open a pull request with a short description and test notes

Please use Issues for bug reports and feature requests.
