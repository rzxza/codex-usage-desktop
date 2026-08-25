import { Card, CardContent } from "@/components/ui/card";
import type { ServerCreditAnalyticsResponse } from "@/lib/api";
import { formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type ServerUsageCardProps = {
  analytics: ServerCreditAnalyticsResponse | null;
  error: string | null;
  isLoading?: boolean;
};

export function ServerUsageCard({ analytics, error, isLoading }: ServerUsageCardProps) {
  const { t } = useTranslation();

  // Stale-while-revalidate: only show the skeleton before first data;
  // background refreshes keep values on screen.
  if (isLoading && !analytics) {
    return (
      <Card className="rounded-lg">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">{t("server_usage.loading")}</p>
        </CardContent>
      </Card>
    );
  }

  if (!analytics) {
    return (
      <Card className="rounded-lg border-border/70">
        <CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground">{t("server_usage.unavailable")}</p>
          {error ? <p className="mt-1 text-xs text-muted-foreground">{error}</p> : null}
        </CardContent>
      </Card>
    );
  }

  const statusLabel = t(`server_usage.status_${analytics.status}`, { defaultValue: analytics.status });
  const calibrationLabel = t(`server_usage.cal_${analytics.calibration.status}`, {
    defaultValue: analytics.calibration.status,
  });

  const formatCredits = (value: number | null | undefined): string => {
    if (value === null || value === undefined) {
      return t("server_usage.na");
    }
    return `≈ ${formatNumber(value)}`;
  };

  const today = analytics.today;

  return (
    <Card className="rounded-lg border-border/80 bg-surface">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              {t("server_usage.title")}
            </p>
            <p className="text-xs text-muted-foreground">{t("server_usage.derived_label")}</p>
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border",
              analytics.status === "ready" && "bg-success/10 border-success/25 text-success",
              analytics.status === "partial" && "bg-warning/10 border-warning/25 text-warning",
              analytics.status === "pending" && "bg-muted/50 border-border/40 text-muted-foreground",
              analytics.status === "invalid" && "bg-error/10 border-error/25 text-error",
            )}
          >
            {statusLabel}
          </span>
        </div>

        {isLoading && analytics ? (
          <p className="text-[11px] text-muted-foreground">{t("server_usage.refreshing")}</p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
            {t("server_usage.stale_banner")}
          </p>
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("server_usage.today")}
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">
              {formatCredits(today?.credits)}
            </p>
            {today?.isPending ? (
              <p className="mt-1 text-[11px] font-medium text-warning">{t("server_usage.pending")}</p>
            ) : today?.isPartial ? (
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">{t("server_usage.partial")}</p>
            ) : null}
          </div>

          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("server_usage.last_7_days")}
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">
              {formatCredits(analytics.last7Days.credits)}
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("server_usage.last_30_days")}
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">
              {formatCredits(analytics.last30Days.credits)}
            </p>
          </div>
        </div>

        {analytics.models.length > 0 ? (
          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("server_usage.models")}
            </p>
            <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
              {analytics.models.map((model) => (
                <div
                  key={model.model}
                  className={cn(
                    "h-full",
                    model.model === "gpt-5.6-sol" && "bg-indigo-500",
                    model.model === "gpt-5.6-terra" && "bg-sky-500",
                    model.model === "gpt-5.6-luna" && "bg-teal-500",
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, model.percent))}%` }}
                  title={`${model.model}: ${formatNumber(model.percent)}%`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {analytics.models.map((model) => (
                <span key={model.model} className="text-[11px] text-muted-foreground">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-current" />
                  {model.model} · {formatNumber(model.percent)}%
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
          <span>
            {t("server_usage.calibration")}:{" "}
            <span className="font-medium text-foreground">{calibrationLabel}</span>
          </span>
          {analytics.calibration.k !== null ? (
            <span>
              {t("server_usage.k")}: <span className="font-mono">{formatNumber(analytics.calibration.k)}</span>
            </span>
          ) : null}
          <span>
            {t("server_usage.samples")}: <span className="font-mono">{analytics.calibration.sampleCount}</span>
          </span>
          {analytics.calibration.deviation !== null ? (
            <span>
              {t("server_usage.deviation")}:{" "}
              <span className="font-mono">{formatNumber(analytics.calibration.deviation)}%</span>
            </span>
          ) : null}
          <span className="ml-auto">
            {t("server_usage.updated")}:{" "}
            <span className="font-mono">{new Date(analytics.fetchedAt).toLocaleTimeString()}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}