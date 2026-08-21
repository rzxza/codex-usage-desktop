# Baseline verification

Date: 2026-08-21  
Repository: `rzxza/codex-usage-desktop`  
Branch: `monitor`  
Upstream baseline: `main @ d7132dc79bd8b808c00309c8f9c9eed37b9a09a5`

## Environment

- Windows 10/11 x64 host
- Node.js `v24.13.0`
- pnpm `11.19.0`
- Rust/Cargo: unavailable. `rustc` and `cargo` are not on `PATH`; `C:\Users\23198\.cargo\bin` does not exist.

## Commands and results

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | Lockfile policy passed; 328 packages installed. |
| `pnpm typecheck` | PASS | `tsc --noEmit` exit code 0. |
| `pnpm test` | BLOCKED | 3/7 release-script tests passed and 4/7 failed because `scripts/release.cjs` invokes Cargo to update `src-tauri/Cargo.lock`; Cargo is unavailable. The chained `vitest run` step did not execute. |
| `cd src-tauri && cargo test` | NOT RUN | Cargo unavailable. |
| `pnpm tauri dev` | NOT RUN | Rust toolchain unavailable; starting UI would not produce a valid Tauri baseline. |

## Gate decision

**P0 is blocked.** The implementation design requires the complete baseline to pass before P1. Do not start P1 code changes until a Rust toolchain is available and the failing release tests, Cargo tests, and Tauri development launch have been rerun.

## Notes

- The fork design is preserved at `docs/server-credit-monitor-plan.md` for isolated execution agents.
- This record describes the upstream code baseline plus documentation-only additions on `monitor`; no product source code was modified.
