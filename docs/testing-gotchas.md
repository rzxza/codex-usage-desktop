# Testing Gotchas (Vitest 4 + Testing Library)

Hard-won lessons from the v0.2 round. Follow these when writing timer- or
freshness-related frontend tests.

## 1. Fake timers do not fake `Date` by default

`vi.useFakeTimers()` in Vitest 4 does **not** replace `Date`. Any freshness
logic comparing `Date.now() - lastSuccessAt` will keep seeing the real clock
and never go stale inside an advanced fake timeline.

Also, when `Date` *is* faked, the fake clock starts at the epoch unless told
otherwise, so a "last success" recorded before installing fake timers ends up
"in the future".

**Workaround** — fake Date explicitly and align the start time:

```ts
vi.useFakeTimers({
  now: new Date(),
  toFake: ["Date", "setInterval", "setTimeout", "clearInterval", "clearTimeout"],
});
```

Install fake timers **before `render()`**, otherwise components mount with
real intervals that the fake clock cannot advance.

## 2. Never use `waitFor` while fake timers are active

Testing Library's `waitFor` polls via `setTimeout`; under fake timers those
timeouts never fire, so the assertion hangs until the real test timeout even
when the DOM already has the expected content.

**Workaround** — after advancing the clock with
`await act(async () => { await vi.advanceTimersByTimeAsync(ms); })`, assert
synchronously:

```ts
expect(document.body.textContent).toMatch(/STALE/i);
```

## 3. `formatNumber` rounds to integers

`formatNumber(90.8)` renders `91` (Intl grouping also inserts thousands
separators: `10571` -> `10,571`). Assert against rounded/grouped strings, or
query with functional matchers over exact text content.

## 4. Boundary-exact timer assertions

`setInterval(fn, ms)` fires at exact multiples of `ms` from scheduling.
Advancing by exactly the interval duration fires it once; advancing one
millisecond less does not. Prefer pairs like
`advanceTimersByTimeAsync(59_999)` → expect no call → `advanceTimersByTimeAsync(1)`
→ expect exactly one call. This catches both early-fire and missed-boundary
bugs that "advance a big chunk and count totals" hides.
