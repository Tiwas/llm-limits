# Project Documentation

## Architecture

LLM Limits is an Electron application with three runtime layers:

- `src/main/` owns provider polling, remote processes, persistence, window lifecycle, tray integration, and IPC handlers.
- `src/preload/` exposes a narrow `window.api` bridge to the renderer.
- `src/renderer/` renders the floating quota monitor and settings UI with React.

Provider credentials remain in their source environment. The renderer receives normalized status and quota data, not raw authentication files.

## Codex Account A/B Flow

`src/main/services/codex_remote.ts` starts an isolated Codex app-server through the Windows OpenSSH client for each fixed `devserver` profile. Account A uses `~/.codex-account-a`; account B uses `~/.codex-account-b`.

Each background poll performs:

1. `account/read` with `refreshToken: false` to read non-secret identity metadata.
2. `account/rateLimits/read`, retaining only the reset-credit `availableCount` and discarding any detail rows.
3. Normalization of the shorter and longer rate-limit windows into session and period display fields.
4. Immediate closure of the SSH/app-server session.

The status path never reads `auth.json`, changes the shared Codex auth link, stops Codex processes, or consumes a reset credit.

## Codex Reauthentication

Settings can start `account/login/start` with the `chatgptDeviceCode` mode for account A or B. The app-server returns a verification URL and one-time code. Only trusted HTTPS OpenAI or ChatGPT URLs can be opened by the main process.

The isolated app-server writes successful authentication back to the selected remote account directory. The UI listens for `account/login/completed`, reports success or failure, and refreshes quota data after success.

## Claude and Other Providers

Claude continues to use the existing Windows Electron session and stored Windows configuration. Gemini continues to use its API-key or Windows gcloud path. The original local Windows Codex source remains available when devserver monitoring is disabled.

## Security Boundaries

- SSH arguments and remote account paths are fixed constants; renderer input cannot select arbitrary commands or paths.
- Remote JSON is parsed as untrusted protocol data and non-JSON output is ignored.
- Authentication URLs are restricted to HTTPS OpenAI and ChatGPT domains.
- Tokens and authentication-file contents are never logged or sent to the renderer.
- Reset-credit counts are read-only; the application does not call the reset-credit consumption method.
