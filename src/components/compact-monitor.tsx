import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const current = getCurrentWindow();
    const saved = localStorage.getItem("compact_window_position");
    if (saved) {
      try {
        const { x, y } = JSON.parse(saved) as { x: number; y: number };
        void current.setPosition(new PhysicalPosition(x, y));
      } catch (_) {
        // Ignore malformed saved position.
      }
    }
    let unlisten: (() => void) | null = null;
    void current.onMoved((event) => {
      try {
        localStorage.setItem("compact_window_position", JSON.stringify(event.payload));
      } catch (_) {
        // Ignore storage errors.
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const [limitsResult, analyticsResult] = await Promise.allSettled([
        fetchCodexLimits(),
        fetchServerCreditAnalytics(),
      ]);

      if (limitsResult.status === "fulfilled") {
        setLimits(limitsResult.value);
        setLimitsUpdatedAt(Date.now());
      }
      if (analyticsResult.status === "fulfilled") {
        setAnalytics(analyticsResult.value);
        setAnalyticsUpdatedAt(Date.now());
      }
      const firstError =
        limitsResult.status === "rejected"
          ? limitsResult.reason
          : analyticsResult.status === "rejected"
            ? analyticsResult.reason
            : null;
      setError(firstError ? String(firstError) : null);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
    const limitsTimer = window.setInterval(() => void loadData(), LIMITS_REFRESH_MS);
    const analyticsTimer = window.setInterval(() => void loadData(), ANALYTICS_REFRESH_MS);
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

  const today = analytics?.today;
  const modelPercent = (model: string) =>
    analytics?.models.find((entry) => entry.model === model)?.percent ?? 0;

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
        {error ? (
          <span className="ml-2 truncate text-[10px] text-warning" title={error}>
            {t("compact.error_short")}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void loadData()}
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
            {today?.isPending ? (
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
              {analytics?.status === "invalid" ? t("compact.calibration_invalid") : " "}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("compact.model_split")}
            </p>
            <span className="text-[10px] text-muted-foreground">
              S {formatNumber(modelPercent("gpt-5.6-sol"))} · L {formatNumber(modelPercent("gpt-5.6-luna"))} · T {formatNumber(modelPercent("gpt-5.6-terra"))}
            </span>
          </div>
          <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
            <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, modelPercent("gpt-5.6-sol"))}%` }} />
            <div className="h-full bg-teal-500" style={{ width: `${Math.min(100, modelPercent("gpt-5.6-luna"))}%` }} />
            <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, modelPercent("gpt-5.6-terra"))}%` }} />
          </div>
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