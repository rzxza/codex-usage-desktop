import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { RefreshCcw, ExternalLink, GripHorizontal, Minus, Contrast } from "lucide-react";
import {
  fetchCodexLimits,
  fetchServerCreditAnalytics,
  type CodexLimitWindow,
  type CodexLimitsResponse,
  type ServerCreditAnalyticsResponse,
} from "@/lib/api";
import { formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const LIMITS_REFRESH_MS = 60_000;
const ANALYTICS_REFRESH_MS = 5 * 60_000;
const STALE_AFTER_MS = 15 * 60_000;
const OPACITY_KEY = "compact_surface_opacity";
const OPACITY_PRESETS = [1, 0.9, 0.8, 0.7] as const;

type FeedFreshness = "loading" | "live" | "stale" | "offline";
export type OverallFeedState = "live" | "loading" | "stale" | "degraded" | "offline";

const FEED_SEVERITY: Record<FeedFreshness, number> = { live: 0, loading: 1, stale: 2, offline: 3 };

export function overallFeedState(quota: FeedFreshness, analytics: FeedFreshness): OverallFeedState {
  if (quota === "offline" && analytics === "offline") return "offline";
  if (quota === "offline" || analytics === "offline") return "degraded";
  const worst = FEED_SEVERITY[quota] >= FEED_SEVERITY[analytics] ? quota : analytics;
  return worst as OverallFeedState;
}

function feedFreshness(error: string | null, updatedAt: number | null, now: number): FeedFreshness {
  if (updatedAt === null) return error ? "offline" : "loading";
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

function oneDecimal(value: number): string {
  return value.toFixed(1);
}

function formatCreditValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `≈${formatNumber(value)}`;
}

function Sparkline({ points }: { points: Array<{ date: string; credits: number }> }) {
  if (points.length === 0) return null;
  const width = 120;
  const height = 28;
  const max = Math.max(...points.map((p) => p.credits), 0);
  const min = Math.min(...points.map((p) => p.credits), 0);
  const range = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = height - ((p.credits - min) / range) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-label="7 day sparkline">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function loadOpacity(): number {
  try {
    const raw = Number(localStorage.getItem(OPACITY_KEY));
    return OPACITY_PRESETS.includes(raw as (typeof OPACITY_PRESETS)[number]) ? raw : 0.94;
  } catch (_) {
    return 0.94;
  }
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
  const [surfaceOpacity, setSurfaceOpacity] = useState(loadOpacity);
  const [opacityOpen, setOpacityOpen] = useState(false);

  useEffect(() => {
    const current = getCurrentWindow();

    const alwaysOnTop = (() => {
      try {
        return localStorage.getItem("compact_always_on_top") !== "0";
      } catch (_) {
        return true;
      }
    })();
    if (!alwaysOnTop) void current.setAlwaysOnTop(false);

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

  const loadAnalytics = async (forceRefresh = false) => {
    try {
      const data = await fetchServerCreditAnalytics(forceRefresh);
      setAnalytics(data);
      const parsed = Date.parse(data.fetchedAt);
      setAnalyticsUpdatedAt(Number.isFinite(parsed) ? parsed : Date.now());
      setAnalyticsError(null);
    } catch (err) {
      setAnalyticsError(String(err));
    }
  };

  const refreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([loadLimits(), loadAnalytics(true)]);
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

  const hideCompact = async () => {
    try {
      await getCurrentWindow().hide();
    } catch (err) {
      console.warn("Failed to hide compact window", err);
    }
  };

  const startDrag = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    void getCurrentWindow().startDragging();
  };

  const setOpacity = (value: number) => {
    setSurfaceOpacity(value);
    try {
      localStorage.setItem(OPACITY_KEY, String(value));
    } catch (_) {
      // Ignore storage errors.
    }
  };

  const primaryQuota = useMemo<CodexLimitWindow | null>(() => {
    const list = [limits?.session, limits?.weekly].filter((w): w is CodexLimitWindow => !!w);
    if (list.length === 0) return null;
    return list.reduce((a, b) => ((a.windowMinutes ?? 0) >= (b.windowMinutes ?? 0) ? a : b));
  }, [limits]);

  const quotaLabel = primaryQuota?.windowMinutes === 10080 ? t("compact.weekly") : t("compact.current_quota");
  const resetCardCount = limits?.resetCreditsAvailableCount ?? limits?.resetCredits?.length ?? 0;
  const error = limitsError ?? analyticsError;

  const last7 = analytics?.last7CompleteDays;
  const previous7 = analytics?.previous7CompleteDays;
  const last30 = analytics?.last30CompleteDays;
  const latestDay = analytics?.latestCompleteDay;
  const latestDate = analytics?.latestCompleteDate ? analytics.latestCompleteDate.slice(5) : "";
  const modelPercent = (model: string) =>
    last7?.models.find((entry) => entry.model === model)?.percent ?? 0;

  const quotaState = feedFreshness(limitsError, limitsUpdatedAt, now);
  const analyticsState = feedFreshness(analyticsError, analyticsUpdatedAt, now);
  const overall = overallFeedState(quotaState, analyticsState);

  return (
    <div
      className="flex h-screen select-none flex-col overflow-hidden bg-background text-foreground"
      style={{ ["--compact-surface-alpha" as string]: surfaceOpacity } as React.CSSProperties}
    >
      <header
        data-tauri-drag-region
        className="flex items-center gap-2 border-b border-border/60 bg-surface px-3 py-2"
      >
        <button
          type="button"
          onMouseDown={startDrag}
          className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
          aria-label={t("compact.drag")}
        >
          <GripHorizontal className="h-4 w-4" />
        </button>
        <span className="text-xs font-semibold tracking-wide">{t("compact.title")}</span>
        {limits?.membershipLevel ? (
          <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {limits.membershipLevel}
          </span>
        ) : null}
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
        {error ? (
          <span className="ml-2 truncate text-[10px] text-warning" title={error}>
            {t("compact.error_short")}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpacityOpen(!opacityOpen)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              aria-label={t("compact.opacity")}
            >
              <Contrast className="h-3.5 w-3.5" />
            </button>
            {opacityOpen ? (
              <div className="absolute right-0 top-full z-50 mt-1 flex gap-1 rounded-lg border border-border bg-surface p-1 shadow-card">
                {OPACITY_PRESETS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setOpacity(value)}
                    className={cn(
                      "rounded px-2 py-1 text-[10px] font-medium",
                      surfaceOpacity === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {Math.round(value * 100)}%
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void hideCompact()}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-label={t("compact.hide")}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
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
        <div className="rounded-lg border border-border/60 bg-surface p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{quotaLabel}</p>
            {resetCardCount > 0 ? (
              <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-px text-[10px] font-semibold text-primary">
                {t("compact.reset_cards", { count: resetCardCount })}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-end justify-between">
            <p className="font-mono text-xl font-bold tabular-nums">
              {primaryQuota ? `${Math.round(primaryQuota.remainingPercent)}%` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {primaryQuota ? `${formatCountdown(primaryQuota.resetsAt, now, t)}` : t("compact.unavailable")}
            </p>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
            <div
              className={cn("h-full rounded-full", (primaryQuota?.remainingPercent ?? 0) < 20 ? "bg-warning/80" : "bg-indigo-500")}
              style={{ width: `${Math.max(0, Math.min(100, primaryQuota?.remainingPercent ?? 0))}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border/60 bg-surface p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("compact.latest_complete_day")}
            </p>
            <p className="mt-1 font-mono text-sm font-bold tabular-nums">{latestDate || "—"}</p>
            <p className="text-xs font-bold tabular-nums">{formatCreditValue(latestDay?.credits)}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-surface p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("compact.last7_complete")}
            </p>
            <p className="mt-1 font-mono text-sm font-bold tabular-nums">{formatCreditValue(last7?.credits)}</p>
            {last7 && !last7.completeness.isComplete ? (
              <p className="text-[10px] text-warning">{t("compact.incomplete")}</p>
            ) : null}
          </div>
          <div className="rounded-lg border border-border/60 bg-surface p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("compact.last30_complete")}
            </p>
            <p className="mt-1 font-mono text-sm font-bold tabular-nums">{formatCreditValue(last30?.credits)}</p>
            {last30 && !last30.completeness.isComplete ? (
              <p className="text-[10px] text-warning">{t("compact.incomplete")}</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("compact.seven_day_trend")}</p>
            {analytics?.sevenDayDeltaPercent !== null && analytics?.sevenDayDeltaPercent !== undefined ? (
              <span className={cn("text-[11px] font-bold tabular-nums", analytics.sevenDayDeltaPercent >= 0 ? "text-success" : "text-error")}>
                {analytics.sevenDayDeltaPercent >= 0 ? "+" : ""}
                {oneDecimal(analytics.sevenDayDeltaPercent)}%
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <Sparkline points={analytics?.sevenDaySeries ?? []} />
            {last7 && last7.models.length > 0 ? (
              <span className="text-[10px] text-muted-foreground">
                {t("compact.model_split")}: S {oneDecimal(modelPercent("gpt-5.6-sol"))} · L {oneDecimal(modelPercent("gpt-5.6-luna"))} · T {oneDecimal(modelPercent("gpt-5.6-terra"))}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">{t("compact.unavailable")}</span>
            )}
          </div>
          {last7 && last7.models.length > 0 ? (
            <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, modelPercent("gpt-5.6-sol"))}%` }} />
              <div className="h-full bg-teal-500" style={{ width: `${Math.min(100, modelPercent("gpt-5.6-luna"))}%` }} />
              <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, modelPercent("gpt-5.6-terra"))}%` }} />
            </div>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-border/50 px-0.5 pt-2 text-[10px] text-muted-foreground">
          <span>
            {t("compact.calibration_short")} {analytics?.calibration.status === "excellent" ? t("compact.cal_excellent") : analytics?.calibration.status}
            {analytics && analytics.calibration.k !== null ? ` · K${analytics.calibration.k.toFixed(2)}` : ""}
            {analytics && analytics.calibration.sampleCount ? ` · ${analytics.calibration.sampleCount}${t("compact.samples_short")}` : ""}
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