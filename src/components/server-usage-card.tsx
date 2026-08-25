import { Card, CardContent } from "@/components/ui/card";
import type { ServerCreditAnalyticsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type ServerUsageCardProps = {
  analytics: ServerCreditAnalyticsResponse | null;
  error: string | null;
  isLoading?: boolean;
};

export function ServerUsageCard({ analytics, error, isLoading }: ServerUsageCardProps) {
  const { t } = useTranslation();

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
    const rounded = Math.round(value);
    return `≈ ${rounded.toLocaleString()}`;
  };

  const last7 = analytics.last7CompleteDays;
  const last30 = analytics.last30CompleteDays;
  const last7Display = last7.credits ?? last7.knownCredits ?? null;
  const last30Display = last30.credits ?? last30.knownCredits ?? null;
  const models = last30.models;

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
              {t("server_usage.latest_complete_day")}
            </p>
            <p className="text-[11px] font-medium text-muted-foreground">
              {analytics.latestCompleteDate ?? "—"}
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">
              {formatCredits(analytics.latestCompleteDay?.credits)}
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("server_usage.last_7_complete")}
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">
              {last7Display !== null ? formatCredits(last7Display) : t("server_usage.no_data")}
            </p>
            {last7.completeness.isComplete ? (
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                {last7.completeness.completeDays}/{last7.completeness.expectedDays} {t("server_usage.day_short")} {t("server_usage.complete_short")}
              </p>
            ) : (
              <div className="mt-1 text-[11px] font-medium leading-tight text-warning">
                {last7.knownCredits !== null && last7.knownCredits !== undefined
                  ? `${t("server_usage.known")} `
                  : ""}
                {last7.completeness.completeDays}/{last7.completeness.expectedDays} {t("server_usage.day_short")}
                {last7.completeness.missingDates.length > 0
                  ? ` · ${t("server_usage.missing")}: ${last7.completeness.missingDates.join(", ")}`
                  : ""}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("server_usage.last_30_complete")}
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">
              {last30Display !== null ? formatCredits(last30Display) : t("server_usage.no_data")}
            </p>
            {last30.completeness.isComplete ? (
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                {last30.completeness.completeDays}/{last30.completeness.expectedDays} {t("server_usage.day_short")} {t("server_usage.complete_short")}
              </p>
            ) : (
              <div className="mt-1 text-[11px] font-medium leading-tight text-warning">
                {last30.knownCredits !== null && last30.knownCredits !== undefined
                  ? `${t("server_usage.known")} `
                  : ""}
                {last30.completeness.completeDays}/{last30.completeness.expectedDays} {t("server_usage.day_short")}
                {last30.completeness.missingDates.length > 0
                  ? ` · ${t("server_usage.missing")}: ${last30.completeness.missingDates.join(", ")}`
                  : ""}
              </div>
            )}
          </div>
        </div>

        {models.length > 0 ? (
          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("server_usage.models")}
            </p>
            <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
              {models.map((model) => (
                <div
                  key={model.model}
                  className={cn(
                    "h-full",
                    model.model === "gpt-5.6-sol" && "bg-indigo-500",
                    model.model === "gpt-5.6-terra" && "bg-sky-500",
                    model.model === "gpt-5.6-luna" && "bg-teal-500",
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, model.percent))}%` }}
                  title={`${model.model}: ${model.percent.toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {models.map((model) => (
                <span key={model.model} className="text-[11px] text-muted-foreground">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-current" />
                  {model.model} · {model.percent.toFixed(1)}%
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
              {t("server_usage.k")}: <span className="font-mono">{analytics.calibration.k.toFixed(4)}</span>
            </span>
          ) : null}
          <span>
            {t("server_usage.samples")}: <span className="font-mono">{analytics.calibration.sampleCount}</span>
          </span>
          {analytics.calibration.deviation !== null ? (
            <span>
              {t("server_usage.deviation")}:{" "}
              <span className="font-mono">{analytics.calibration.deviation.toFixed(2)}%</span>
            </span>
          ) : null}
          <span>
            {t("server_usage.latest_complete_date")}: <span className="font-mono">{analytics.latestCompleteDate ?? "—"}</span>
          </span>
          <span className="ml-auto">
            {t("server_usage.updated")}:{" "}
            <span className="font-mono">{new Date(analytics.fetchedAt).toLocaleTimeString()}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}