import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { RefreshCcw, ExternalLink, GripHorizontal } from "lucide-react";
import {
  fetchCodexLimits,
  fetchServerCreditAnalytics,
  type CodexLimitsResponse,
  type ServerCreditAnalyticsResponse,
} from "@/lib/api";
import { formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const LIMITS_REFRESH_MS = 60_000;
const ANALYTICS_REFRESH_MS = 5 * 60_000;
// A feed that has not succeeded for this long is flagged stale; the last good
// values stay on screen (design doc v0.2 section 4).
const STALE_AFTER_MS = 15 * 60_000;

type FeedFreshness = "loading" | "live" | "stale" | "offline";

// Review rules: a failed attempt marks a previously-successful feed stale
// immediately; 15min without success is only the age-based stale warning.
// No data + no settled attempt = loading; no data + failure = offline.
export type OverallFeedState = "live" | "loading" | "stale" | "degraded" | "offline";

// Per-feed states never include "degraded"; it only emerges from the merge.
const FEED_SEVERITY: Record<FeedFreshness, number> = { live: 0, loading: 1, stale: 2, offline: 3 };

/** Merge per-feed states; severity ordering guarantees offline+working can
 * never collapse back to LIVE. */
export function overallFeedState(quota: FeedFreshness, analytics: FeedFreshness): OverallFeedState {
  if (quota === "offline" && analytics === "offline") return "offline";
  if (quota === "offline" || analytics === "offline") return "degraded";
  const worst = FEED_SEVERITY[quota] >= FEED_SEVERITY[analytics] ? quota : analytics;
  return worst as OverallFeedState;
}

function feedFreshness(error: string | null, updatedAt: number | null, now: number): FeedFreshness {
  if (updatedAt === null) {
    return error ? "offline" : "loading";
  }
  if (error) return "stale";
  return now - updatedAt > STALE_AFTER_MS ? "stale" : "live";
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function formatCountdown(resetsAt: string | null, now: number, t: (key: string, opts?: any) => string): string {
  if (!resetsAt) return t("compact.na");
  const resetTime = new Date(resetsAt).getTime();
  if (!Number.isFinite(resetTime)) return t("compact.na");
  const diffMs = resetTime - now;
  if (diffMs <= 0) return t("compact.soon");
  const totalSeconds = Math.ceil(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatCreditValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `≈${formatNumber(value)}`;
}

export function CompactMonitor() {
  const { t } = useTranslation();
  const now = useNow(1000);
  const [limits, setLimits] = useState<CodexLimitsResponse | null>(null);
  const [analytics, setAnalytics] = useState<ServerCreditAnalyticsResponse | null>(null);
  const [limitsUpdatedAt, setLimitsUpdatedAt] = useState<number | null>(null);
  const [analyticsUpdatedAt, setAnalyticsUpdatedAt] = useState<number | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const current = getCurrentWindow();

    // Apply persisted compact preferences (settings page writes these flags).
    const autoStart = (() => {
      try {
        return localStorage.getItem("compact_autostart") === "1";
      } catch (_) {
        return false;
      }
    })();
    const alwaysOnTop = (() => {
      try {
        return localStorage.getItem("compact_always_on_top") !== "0";
      } catch (_) {
        return true;
      }
    })();
    if (!alwaysOnTop) void current.setAlwaysOnTop(false);
    if (autoStart) void current.show();

    let disposed = false;
    let unlistenSettings: (() => void) | null = null;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("compact-settings-changed", () => {
        try {
          void current.setAlwaysOnTop(localStorage.getItem("compact_always_on_top") !== "0");
        } catch (_) {
          // Ignore storage errors.
        }
      }),
    ).then((cleanup) => {
      if (disposed) cleanup();
      else unlistenSettings = cleanup;
    });

    const saved = localStorage.getItem("compact_window_position");
    if (saved) {
      void (async () => {
        try {
          const { x, y } = JSON.parse(saved) as { x: number; y: number };
          // Only restore when the point lies inside a currently connected
          // display; otherwise keep the configured centered position.
          const monitors = await availableMonitors();
          const onScreen = monitors.some(
            (monitor) =>
              x >= monitor.position.x &&
              y >= monitor.position.y &&
              x < monitor.position.x + monitor.size.width &&
              y < monitor.position.y + monitor.size.height,
          );
          if (!onScreen) return;
          await current.setPosition(new PhysicalPosition(x, y));
        } catch (_) {
          // Ignore malformed saved position.
        }
      })();
    }
    let unlisten: (() => void) | null = null;
    void current.onMoved((event) => {
      try {
        localStorage.setItem("compact_window_position", JSON.stringify(event.payload));
      } catch (_) {
        // Ignore storage errors.
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
      unlistenSettings?.();
    };
  }, []);

  const loadLimits = async () => {
    try {
      const data = await fetchCodexLimits();
      setLimits(data);
      setLimitsUpdatedAt(Date.now());
      setLimitsError(null);
    } catch (err) {
      setLimitsError(String(err));
    }
  };

  const loadAnalytics = async () => {
    try {
      const data = await fetchServerCreditAnalytics();
      setAnalytics(data);
      setAnalyticsUpdatedAt(Date.now());
      setAnalyticsError(null);
    } catch (err) {
      setAnalyticsError(String(err));
    }
  };

  // Quota refreshes every minute; server analytics only every 5 minutes so the
  // WHAM daily endpoints are not hammered by the compact window.
  const refreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([loadLimits(), loadAnalytics()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshAll();
    const limitsTimer = window.setInterval(() => void loadLimits(), LIMITS_REFRESH_MS);
    const analyticsTimer = window.setInterval(() => void loadAnalytics(), ANALYTICS_REFRESH_MS);
    return () => {
      window.clearInterval(limitsTimer);
      window.clearInterval(analyticsTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDashboard = async () => {
    try {
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch (err) {
      console.warn("Failed to open main window", err);
    }
  };

  const session = limits?.session ?? null;
  const weekly = limits?.weekly ?? null;

  const error = limitsError ?? analyticsError;
  const today = analytics?.today;
  // Model split must reflect the same window as the headline figure above it,
  // which is Today — not the full 30-day aggregate.
  const modelPercent = (model: string) =>
    analytics?.today?.models.find((entry) => entry.model === model)?.percent ?? 0;
  const todayHasModels = (analytics?.today?.models?.length ?? 0) > 0;

  return (
    <div className="flex h-screen select-none flex-col overflow-hidden bg-background text-foreground">
      <header
        data-tauri-drag-region
        className="flex items-center gap-2 border-b border-border/60 bg-surface px-3 py-2"
      >
        <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground/60" data-tauri-drag-region />
        <span className="text-xs font-semibold tracking-wide" data-tauri-drag-region>
          {t("compact.title")}
        </span>
        {(() => {
          const quotaState = feedFreshness(limitsError, limitsUpdatedAt, now);
          const analyticsState = feedFreshness(analyticsError, analyticsUpdatedAt, now);
          // One feed fully offline while the other still works is DEGRADED,
          // never LIVE - the pill must not contradict a visible Sync Error.
          const overall = overallFeedState(quotaState, analyticsState);
          return (
            <span
              className={cn(
                "ml-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider",
                overall === "live" && "border-success/30 bg-success/10 text-success",
                overall === "stale" && "border-warning/30 bg-warning/10 text-warning",
                overall === "degraded" && "border-orange-500/30 bg-orange-500/10 text-orange-500",
                overall === "offline" && "border-error/30 bg-error/10 text-error",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full bg-current", overall === "live" && isRefreshing && "animate-pulse")} />
              {t(`compact.${overall}`)}
            </span>
          );
        })()}
        {error ? (
          <span className="ml-2 truncate text-[10px] text-warning" title={error}>
            {t("compact.error_short")}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={isRefreshing}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            aria-label={t("compact.refresh")}
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => void openDashboard()}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-label={t("compact.open_dashboard")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border/60 bg-surface p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("compact.five_hour")}
            </p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums">
              {session ? `${Math.round(session.remainingPercent)}%` : "—"}
            </p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
              <div
                className={cn("h-full rounded-full", (session?.remainingPercent ?? 0) < 20 ? "bg-error/80" : "bg-indigo-500")}
                style={{ width: `${Math.max(0, Math.min(100, session?.remainingPercent ?? 0))}%` }}
              />
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {session ? `${formatCountdown(session.resetsAt, now, t)}` : t("compact.unavailable")}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-surface p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("compact.weekly")}
            </p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums">
              {weekly ? `${Math.round(weekly.remainingPercent)}%` : "—"}
            </p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
              <div
                className={cn("h-full rounded-full", (weekly?.remainingPercent ?? 0) < 20 ? "bg-warning/80" : "bg-teal-500")}
                style={{ width: `${Math.max(0, Math.min(100, weekly?.remainingPercent ?? 0))}%` }}
              />
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {weekly ? `${formatCountdown(weekly.resetsAt, now, t)}` : t("compact.unavailable")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border/60 bg-surface p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("compact.today_credits")}
            </p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums">
              {formatCreditValue(today?.credits)}
            </p>
            {analyticsError && !analytics ? (
              <p className="mt-0.5 text-[10px] text-warning">{t("compact.unavailable")}</p>
            ) : today?.isPending ? (
              <p className="mt-0.5 text-[10px] text-warning">{t("compact.pending")}</p>
            ) : today?.isPartial ? (
              <p className="mt-0.5 text-[10px] text-muted-foreground">{t("compact.partial")}</p>
            ) : null}
          </div>
          <div className="rounded-lg border border-border/60 bg-surface p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("compact.seven_day_credits")}
            </p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums">
              {formatCreditValue(analytics?.last7Days.credits)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {analyticsError && !analytics
                ? t("compact.unavailable")
                : analytics?.status === "invalid"
                  ? t("compact.calibration_invalid")
                  : today?.isPending
                    ? t("compact.pending")
                    : " "}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("compact.model_split")}
            </p>
            {todayHasModels ? (
              <span className="text-[10px] text-muted-foreground">
                S {formatNumber(modelPercent("gpt-5.6-sol"))} · L {formatNumber(modelPercent("gpt-5.6-luna"))} · T {formatNumber(modelPercent("gpt-5.6-terra"))}
              </span>
            ) : null}
          </div>
          {todayHasModels ? (
            <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, modelPercent("gpt-5.6-sol"))}%` }} />
              <div className="h-full bg-teal-500" style={{ width: `${Math.min(100, modelPercent("gpt-5.6-luna"))}%` }} />
              <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, modelPercent("gpt-5.6-terra"))}%` }} />
            </div>
          ) : (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {today?.isPending || analytics?.status === "pending"
                ? t("compact.pending")
                : t("compact.unavailable")}
            </p>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-border/50 px-0.5 pt-2 text-[10px] text-muted-foreground">
          <span>
            {t("compact.quota_updated")}:{" "}
            {limitsUpdatedAt ? new Date(limitsUpdatedAt).toLocaleTimeString() : "—"}
          </span>
          <span>
            {t("compact.analytics_updated")}:{" "}
            {analyticsUpdatedAt ? new Date(analyticsUpdatedAt).toLocaleTimeString() : "—"}
          </span>
        </div>
      </main>
    </div>
  );
}