# Baseline verification

Date: 2026-08-21  
Repository: `rzxza/codex-usage-desktop`  
Branch: `monitor`  
Upstream baseline: `main @ d7132dc79bd8b808c00309c8f9c9eed37b9a09a5`

## Environment

- Windows 10/11 x64 host
- Node.js `v24.13.0`
- pnpm `11.19.0`
- Rust `1.98.0` and Cargo `1.98.0`, installed under `D:\Projects\Rust`.
- MSVC Build Tools under `D:\Projects\VSBuildTools`; Windows SDK linker libraries under `D:\Windows Kits\10`.

## Commands and results

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | Lockfile policy passed; 328 packages installed. |
| `pnpm typecheck` | PASS | `tsc --noEmit` exit code 0. |
| `pnpm test` | PASS | Release-script tests: 7/7 passed. Vitest: 9 files and 103 tests passed. |
| `cd src-tauri && cargo test` | PASS | 99 tests passed; 0 failed. |
| `pnpm tauri dev --no-watch` | PASS | Vite listened at `127.0.0.1:5173`; the native `target\debug\codex-usage-desktop.exe` launch was reached. The smoke processes and port were then stopped. |

## Gate decision

**P0 passed.** The complete baseline required by the implementation design is available. P1 may begin, subject to the documented scope and stage gates.

## Notes

- The fork design is preserved at `docs/server-credit-monitor-plan.md` for isolated execution agents.
- This record describes the upstream code baseline plus documentation-only additions on `monitor`; no product source code was modified during P0.
