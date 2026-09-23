# Shared Web Host Implementation Plan

[中文版本](2026-09-23-upstream-web-host_zh.md)

**Goal:** Align PureTerm Desktop with the updated upstream thin Web wrapper without changing SSH/SFTP product behavior.

**Architecture:** Share Web Host composition between ordinary Node Web and the Desktop child. Serve Desktop assets through a local custom scheme, authenticate the common WebSocket in the main process, and retain private IPC for lifecycle/platform capabilities.

**Tech Stack:** TypeScript, Node.js >=24, npm workspaces, Electron, Cordis, ssh2, xterm.js.

**Spec:** [design](../specs/2026-09-23-upstream-web-host-design.md).

## Constraints and review focus

Use PowerShell and UTF-8. Preserve the four shared packages, unique root lockfile, credential policies and random loopback ports. Never use real user SSH data in tests. Check: credentials cannot reach foreign windows; stale bootstrap cannot reopen disposed clients; renderer loss releases quiet and pending sessions; accepted storage mutations drain on shutdown; asset paths work outside the checkout cwd. Existing untracked design screenshots are unrelated and remain untouched.

## Tasks

- [x] Fast-forward the clean reference checkout to `00102833dfaee1da9f48a3a8eae9d34005a75218`; create PureTerm branch `refactor/upstream-web-host`.
- [x] Add `packages/transport/src/web-host.ts`, its public export and shared assembly tests. Adapt `apps/web/src/server.ts` to it. Add distinct Desktop bearer authentication and an attached-browser access switch to `carrier-http.ts`; retain existing token/cookie tests.
- [x] Change Desktop `runtime/host-process.ts` and `host/entry.ts` to return `{pid,url,desktopToken}` after shared Web Host startup. Remove business dispatcher/event proxying; migrate process tests and parent-loss fixture to real WS requests.
- [x] Add protocol bootstrap types and minimal preload. Change UI transport to await bootstrap only in Desktop and use WS in both modes. Test failed bootstrap, disposal during bootstrap, delayed replies and byte preservation.
- [x] Add `runtime/web-document.ts` for safe custom-scheme resources and request-authorization policy; register/install it in Electron app. Load the scheme before Host readiness, bind bootstrap/readiness to the owned main frame, and remove the SSH IPC carrier.
- [x] Update real Electron boot/SSH/SFTP/Keychain/crash/browser tests and diagnostic probes. Keep source and packaged paths exercised independently.
- [x] Update bilingual current docs, AGENTS, upstream baseline and CHANGELOG; regenerate UI changelog. Run build, focused tests, `npm run verify`, `npm run verify:electron`, `npm run release:check`, Markdown links and `git diff --check`; run isolated Windows packaging acceptance if staging changes require it.
- [x] Review the full diff for security, lifecycle and compatibility; fix verified issues and report only fresh verification results. Leave the implementation reviewable on the local branch.

## Verification completed on 2026-09-23

- `npm run verify` passed: 130 unit tests plus Node SSH/SFTP, carrier and lifecycle smoke suites.
- `npm run verify:electron` passed: custom-scheme Desktop, foreign-window rejection, encrypted Keychain, attached browser, renderer crash, updater, standalone browser and Client lifecycle.
- A separate real Electron boot with `SSH_CORDIS_NO_WEB_CARRIER=1` reached Desktop readiness.
- `npm run dist:desktop -- --win --x64` and `npm run verify:package:windows` passed. The isolated installation exercised SSH/SFTP and encrypted credentials outside the workspace, stopped its Host, and was explicitly uninstalled.
- UI changelog/version generation and `npm run release:check` passed. Local Markdown targets and `git diff --check` were checked.
- Independent review found and fixed authorization when Electron cannot identify the request frame. Missing, stale and foreign frames cannot receive the Desktop credential. No further confirmed regression was found.

These results cover this Windows environment. The optional hidden-window boot screenshot could not capture a display surface; functional readiness passed. macOS/Linux runtime and GUI mouse/keyboard acceptance were not run. No commit, push or release publication was performed.
