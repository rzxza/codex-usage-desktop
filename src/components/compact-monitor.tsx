import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { RefreshCcw, ExternalLink, GripHorizontal, Minus, Contrast, Pin, PinOff } from "lucide-react";
import {
  fetchCodexLimits,
  fetchServerCreditAnalytics,
  type CodexLimitsResponse,
  type CompleteCreditWindow,
  type IncompleteDayDiagnostic,
  type ServerCreditAnalyticsResponse,
} from "@/lib/api";
import { formatNumber } from "@/lib/formatters";
import { primaryQuotaLabel, selectPrimaryQuota } from "@/lib/quota";
import { modelTone } from "@/lib/model-analytics";
import { cn } from "@/lib/utils";

const LIMITS_REFRESH_MS = 60_000;
const ANALYTICS_REFRESH_MS = 5 * 60_000;
const STALE_AFTER_MS = 15 * 60_000;
const OPACITY_KEY = "compact_surface_opacity";
const OPACITY_PRESETS = [1, 0.9, 0.8, 0.7, 0.5] as const;
const DEFAULT_SURFACE_OPACITY = 0.9;
const MIN_OPACITY = 0.4;
const MAX_OPACITY = 1.0;

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

function incompleteDayText(d: IncompleteDayDiagnostic, t: (key: string, options?: any) => string) {
  const reasons = d.reasons.map((reason) => t(`compact.reason_${reason}`)).join(", ");
  const details = [...d.unsupportedModels, ...d.unsupportedSpeeds].join(", ");
  return `${d.date}: ${reasons}${details ? ` (${details})` : ""}`;
}

function WindowStatus({
  window,
  t,
}: {
  window: CompleteCreditWindow;
  t: (key: string, options?: any) => string;
}) {
  const { completeDays, expectedDays, incompleteDays, isComplete } = window.completeness;
  if (isComplete) {
    return (
      <p className="mt-1 text-[10px] text-muted-foreground">
        {completeDays}/{expectedDays} {t("compact.day_short")} {t("compact.complete_short")}
      </p>
    );
  }
  const title =
    incompleteDays.length > 0
      ? incompleteDays.map((d) => incompleteDayText(d, t)).join("; ")
      : undefined;
  return (
    <p
      className="mt-1 text-[10px] leading-tight text-warning"
      title={title}
    >
      {completeDays}/{expectedDays} {t("compact.day_short")} ⚠
    </p>
  );
}

function Sparkline({ points }: { points: Array<{ date: string; credits: number | null }> }) {
  const known = points.filter((p): p is { date: string; credits: number } => p.credits !== null);
  if (known.length === 0) return null;
  const width = 120;
  const height = 28;
  const max = Math.max(...known.map((p) => p.credits), 0);
  const min = Math.min(...known.map((p) => p.credits), 0);
  const range = max - min || 1;
  const step = width / 6; // fixed 7 calendar slots
  const segments: string[] = [];
  let current: string[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point.credits === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
    } else {
      const x = i * step;
      const y = height - ((point.credits - min) / range) * (height - 6) - 3;
      current.push(`${current.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  if (current.length > 1) segments.push(current.join(" "));

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-label="7 day sparkline">
      <defs>
        <linearGradient id="sparkline-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.0" />
        </linearGradient>
      </defs>
      {segments.map((d, index) => {
        // Create an area polygon path for each continuous segment
        const areaPath = `${d} L${width},${height} L0,${height} Z`;
        return (
          <g key={index}>
            <path d={areaPath} fill="url(#sparkline-area-grad)" stroke="none" />
            <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
      {points.map((point, i) => {
        const x = i * step;
        if (point.credits === null) {
          return (
            <circle
              key={point.date}
              cx={x.toFixed(1)}
              cy={height / 2}
              r={2}
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.4"
            >
              <title>{`${point.date}: —`}</title>
            </circle>
          );
        }
        const y = height - ((point.credits - min) / range) * (height - 6) - 3;
        return (
          <circle
            key={point.date}
            cx={x.toFixed(1)}
            cy={y.toFixed(1)}
            r={2.5}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1"
            className="transition-transform hover:scale-150"
          >
            <title>{`${point.date}: ${formatCreditValue(point.credits)}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

function loadOpacity(): number {
  try {
    const raw = Number(localStorage.getItem(OPACITY_KEY));
    if (Number.isFinite(raw) && raw >= MIN_OPACITY && raw <= MAX_OPACITY) {
      return Math.round(raw * 100) / 100;
    }
    return DEFAULT_SURFACE_OPACITY;
  } catch (_) {
    return DEFAULT_SURFACE_OPACITY;
  }
}

function getModelShortLabel(model: string): string {
  const parts = model.split("-");
  const last = parts[parts.length - 1];
  if (last && last.length > 0) {
    return last.charAt(0).toUpperCase();
  }
  return model.charAt(0).toUpperCase();
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
  const [alwaysOnTop, setAlwaysOnTop] = useState(() => {
    try {
      return localStorage.getItem("compact_always_on_top") !== "0";
    } catch (_) {
      return true;
    }
  });

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
          const nextVal = localStorage.getItem("compact_always_on_top") !== "0";
          setAlwaysOnTop(nextVal);
          void current.setAlwaysOnTop(nextVal);
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        void refreshAll();
      } else if (e.key === "Escape") {
        e.preventDefault();
        void hideCompact();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [refreshAll]);

  const toggleAlwaysOnTop = async () => {
    const nextVal = !alwaysOnTop;
    setAlwaysOnTop(nextVal);
    try {
      localStorage.setItem("compact_always_on_top", nextVal ? "1" : "0");
      await getCurrentWindow().setAlwaysOnTop(nextVal);
    } catch (err) {
      console.warn("Failed to toggle always on top", err);
    }
  };

  const setOpacity = (value: number) => {
    setSurfaceOpacity(value);
    try {
      localStorage.setItem(OPACITY_KEY, String(value));
    } catch (_) {
      // Ignore storage errors.
    }
  };

  const primaryQuota = selectPrimaryQuota(limits);

  const quotaLabel = primaryQuotaLabel(t);
  const resetCardCount = limits?.resetCreditsAvailableCount ?? limits?.resetCredits?.length ?? 0;
  const error = limitsError ?? analyticsError;

  const last7 = analytics?.last7CompleteDays;
  const previous7 = analytics?.previous7CompleteDays;
  const last30 = analytics?.last30CompleteDays;
  const last7Display = last7 ? (last7.credits ?? last7.knownCredits ?? null) : null;
  const last30Display = last30 ? (last30.credits ?? last30.knownCredits ?? null) : null;
  const latestDay = analytics?.latestCompleteDay;
  const latestDate = analytics?.latestCompleteDate ? analytics.latestCompleteDate.slice(5) : "";
  const last7Models =
    last7?.knownModels && last7.knownModels.length > 0 ? last7.knownModels : (last7?.models ?? []);
  const modelSplitSuffix =
    last7 && !last7.completeness.isComplete && last7Models.length > 0
      ? ` (${t("compact.known")} ${last7.completeness.completeDays}/${last7.completeness.expectedDays} ${t("compact.day_short")})`
      : "";
  const showCalibrationDetails = analytics
    ? analytics.calibration.status === "warning" || analytics.calibration.status === "invalid"
    : false;

  const quotaState = feedFreshness(limitsError, limitsUpdatedAt, now);
  const analyticsState = feedFreshness(analyticsError, analyticsUpdatedAt, now);
  const overall = overallFeedState(quotaState, analyticsState);

  return (
    <div
      className="compact-root flex h-screen select-none flex-col overflow-hidden bg-background text-foreground"
      style={{ ["--compact-surface-alpha" as string]: surfaceOpacity } as React.CSSProperties}
    >
      <header
        data-tauri-drag-region
        onMouseDown={startDrag}
        className="flex items-center gap-2 border-b border-border/60 bg-surface px-3 py-2 cursor-grab active:cursor-grabbing"
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
          title={
            limitsError || analyticsError
              ? `Quota: ${limitsError || "ok"} | Analytics: ${analyticsError || "ok"}`
              : undefined
          }
        >
          <span className={cn("h-1.5 w-1.5 rounded-full bg-current", overall === "live" && isRefreshing && "animate-pulse")} />
          {t(`compact.${overall}`)}
        </span>
        {error ? (
          <span className="ml-2 truncate text-[10px] text-warning" title={error}>
            {t("compact.error_short")}
          </span>
        ) : null}
        <div
          className="ml-auto flex items-center gap-1"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void toggleAlwaysOnTop()}
            className={cn(
              "rounded-md p-1 transition-colors",
              alwaysOnTop
                ? "text-primary hover:bg-muted/60"
                : "text-muted-foreground/60 hover:bg-muted/60 hover:text-foreground",
            )}
            title={alwaysOnTop ? t("compact.unpin") : t("compact.pin")}
            aria-label={alwaysOnTop ? t("compact.unpin") : t("compact.pin")}
          >
            {alwaysOnTop ? <Pin className="h-3.5 w-3.5 fill-current" /> : <PinOff className="h-3.5 w-3.5" />}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpacityOpen(!opacityOpen)}
              className={cn(
                "rounded-md p-1 transition-colors",
                opacityOpen ? "bg-muted/80 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
              aria-label={t("compact.opacity")}
            >
              <Contrast className="h-3.5 w-3.5" />
            </button>
            {opacityOpen ? (
              <div className="compact-glass-panel absolute right-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-border/80 p-2.5 shadow-2xl">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-foreground/80">{t("compact.opacity")}</span>
                  <span className="font-mono text-xs font-bold text-primary">{Math.round(surfaceOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={MIN_OPACITY}
                  max={MAX_OPACITY}
                  step={0.05}
                  value={surfaceOpacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-muted/80 accent-primary"
                />
                <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2">
                  {OPACITY_PRESETS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setOpacity(value)}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                        Math.abs(surfaceOpacity - value) < 0.01
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      {Math.round(value * 100)}%
                    </button>
                  ))}
                </div>
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

      <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
        <div className="compact-card rounded-xl border border-white/10 p-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/90">{quotaLabel}</span>
            {resetCardCount > 0 ? (
              <span className="rounded-full bg-primary/15 border border-primary/30 px-2 py-0.5 text-[9px] font-bold text-primary tracking-wide">
                {t("compact.reset_cards", { count: resetCardCount })}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-extrabold tracking-tight tabular-nums text-foreground">
              {primaryQuota ? `${Math.round(primaryQuota.remainingPercent)}%` : "—"}
            </span>
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
              {primaryQuota ? `${formatCountdown(primaryQuota.resetsAt, now, t)}` : t("compact.unavailable")}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted/50 p-[1px]">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                (primaryQuota?.remainingPercent ?? 0) < 20
                  ? "bg-gradient-to-r from-amber-500 to-rose-500"
                  : "bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500",
              )}
              style={{ width: `${Math.max(0, Math.min(100, primaryQuota?.remainingPercent ?? 0))}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="compact-card flex flex-col justify-between rounded-xl border border-white/10 p-2 shadow-sm">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80">
              {t("compact.latest_complete_day")}
            </span>
            <div className="mt-1">
              <p className="font-mono text-[11px] font-medium text-muted-foreground">{latestDate || "—"}</p>
              <p className="font-mono text-sm font-bold tabular-nums text-foreground">{formatCreditValue(latestDay?.credits)}</p>
            </div>
          </div>
          <div className="compact-card flex flex-col justify-between rounded-xl border border-white/10 p-2 shadow-sm">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80">
              {t("compact.last7_complete")}
            </span>
            <div className="mt-1">
              <p className="font-mono text-sm font-bold tabular-nums text-foreground">
                {last7Display !== null ? formatCreditValue(last7Display) : t("compact.no_data")}
              </p>
              {last7 ? <WindowStatus window={last7} t={t} /> : null}
            </div>
          </div>
          <div className="compact-card flex flex-col justify-between rounded-xl border border-white/10 p-2 shadow-sm">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80">
              {t("compact.last30_complete")}
            </span>
            <div className="mt-1">
              <p className="font-mono text-sm font-bold tabular-nums text-foreground">
                {last30Display !== null ? formatCreditValue(last30Display) : t("compact.no_data")}
              </p>
              {last30 ? <WindowStatus window={last30} t={t} /> : null}
            </div>
          </div>
        </div>

        <div className="compact-card rounded-xl border border-white/10 p-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/90">{t("compact.seven_day_trend")}</span>
            {analytics?.sevenDayDeltaPercent !== null &&
              analytics?.sevenDayDeltaPercent !== undefined &&
              last7?.completeness.isComplete &&
              previous7?.completeness.isComplete ? (
              <span className={cn("text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-muted/40", analytics.sevenDayDeltaPercent >= 0 ? "text-success" : "text-error")}>
                {t("compact.vs_prev_7d")}{" "}
                {analytics.sevenDayDeltaPercent >= 0 ? "+" : ""}
                {oneDecimal(analytics.sevenDayDeltaPercent)}%
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {analytics?.sevenDaySeries?.some((point) => point.credits !== null) ? (
              <Sparkline points={analytics?.sevenDaySeries ?? []} />
            ) : (
              <span className="text-[10px] text-muted-foreground">—</span>
            )}
            {last7Models.length > 0 ? (
              <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[200px]" title={last7Models.map((m) => `${m.model}: ${oneDecimal(m.percent)}%`).join(" · ")}>
                {t("compact.model_split")}{modelSplitSuffix}:{" "}
                {last7Models.map((entry) => `${getModelShortLabel(entry.model)} ${oneDecimal(entry.percent)}`).join(" · ")}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">{t("compact.unavailable")}</span>
            )}
          </div>
          {last7Models.length > 0 ? (
            <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
              {last7Models.map((entry) => {
                const tone = modelTone(entry.model);
                return (
                  <div
                    key={entry.model}
                    className={cn("h-full", tone.className)}
                    style={{ width: `${Math.max(0, Math.min(100, entry.percent))}%` }}
                    title={`${entry.model}: ${oneDecimal(entry.percent)}%`}
                  />
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-border/30 px-1 pt-1.5 text-[9px] text-muted-foreground/80">
          <span className="truncate">
            {t("compact.calibration_short")} {analytics?.calibration.status === "excellent" ? t("compact.cal_excellent") : analytics?.calibration.status}
            {analytics && showCalibrationDetails && analytics.calibration.k !== null ? ` · K${analytics.calibration.k.toFixed(2)}` : ""}
            {analytics && showCalibrationDetails && analytics.calibration.sampleCount ? ` · ${analytics.calibration.sampleCount}${t("compact.samples_short")}` : ""}
          </span>
          <span className="shrink-0">
            {t("compact.analytics_updated")}:{" "}
            {analyticsUpdatedAt ? new Date(analyticsUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "—"}
          </span>
        </div>
      </main>
    </div>
  );
}