import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  CodexLimitsResponse,
  CodexResetSignalResponse,
  ServerCreditAnalyticsResponse,
} from "@/lib/api";
import { buildEinkSnapshot } from "@/eink/snapshot";
import { snapshotToDataUrl, snapshotToPngBytes } from "@/eink/renderer";
import { useEinkAutoSync } from "@/eink/use-eink-autosync";
import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

type EinkPanelProps = {
  limits: CodexLimitsResponse | null;
  analytics: ServerCreditAnalyticsResponse | null;
  resetSignal: CodexResetSignalResponse | null;
};

export function EinkPanel({ limits, analytics, resetSignal }: EinkPanelProps) {
  const { t } = useTranslation();
  const {
    settings,
    state,
    previewUrl,
    isPushing,
    fileSinkPath,
    updateSettings,
    triggerManualPush,
  } = useEinkAutoSync({ limits, analytics, resetSignal });

  const [status, setStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const snapshot = useMemo(
    () => buildEinkSnapshot(limits, analytics, resetSignal),
    [limits, analytics, resetSignal],
  );

  const handlePushNow = async () => {
    try {
      const res = await triggerManualPush();
      if (res) {
        setStatus(`推送成功 (${res.disposition}${res.detail ? `: ${res.detail}` : ""})`);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "推送失败");
    }
  };

  const handlePreview = () => {
    setStatus(t("eink.preview_ready"));
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const bytes = await snapshotToPngBytes(snapshot);

      let chosenPath: string | null = null;
      try {
        chosenPath = await save({
          defaultPath: "codex-eink-400x300.png",
          filters: [{ name: "PNG Image", extensions: ["png"] }],
        });
      } catch (dialogErr) {
        console.warn("Save dialog skipped, using default path", dialogErr);
      }

      if (chosenPath === null && typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        setStatus("已取消导出");
        return;
      }

      const savedPath = await invoke<string>("export_eink_png", {
        bytes,
        targetPath: chosenPath || null,
      });

      setStatus(`${t("eink.export_ready")} (${savedPath})`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("eink.export_failed"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="rounded-lg">
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">{t("eink.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("eink.subtitle")}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => updateSettings((s) => ({ ...s, enabled: e.target.checked }))}
              className="rounded"
            />
            <span className="font-medium">启用 E-Ink 同步服务</span>
          </label>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.autoPush}
              disabled={!settings.enabled}
              onChange={(e) => updateSettings((s) => ({ ...s, autoPush: e.target.checked }))}
              className="rounded"
            />
            <span className={settings.enabled ? "font-medium" : "text-muted-foreground"}>
              自动定时推送
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground block">传输通道 (Sink / Transport)</label>
            <select
              value={settings.transportKind}
              onChange={(e) => updateSettings((s) => ({ ...s, transportKind: e.target.value as any }))}
              className="w-full text-xs rounded border border-border bg-background px-2 py-1"
            >
              <option value="file">本地文件 Sink (latest.png)</option>
              <option value="manual">手动导出 (签变时光)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground block">刷新间隔 (Interval)</label>
            <select
              value={settings.refreshIntervalMinutes}
              onChange={(e) => updateSettings((s) => ({ ...s, refreshIntervalMinutes: Number(e.target.value) }))}
              className="w-full text-xs rounded border border-border bg-background px-2 py-1"
            >
              <option value={10}>10 分钟</option>
              <option value={15}>15 分钟 (推荐)</option>
              <option value={30}>30 分钟</option>
              <option value={60}>60 分钟</option>
            </select>
          </div>
        </div>

        <div className="p-2 rounded bg-muted/40 text-[11px] space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">同步状态:</span>
            <span className="font-mono font-medium">{state.status.toUpperCase()}</span>
          </div>
          {fileSinkPath ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sink 路径:</span>
              <span className="font-mono break-all">{fileSinkPath}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={isPushing}
            onClick={() => void handlePushNow()}
          >
            {isPushing ? "推送中..." : "立即推送"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isExporting}
            onClick={() => void handleExport()}
          >
            {isExporting ? "导出中..." : t("eink.export_png")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={handlePreview}>
            {t("eink.preview")}
          </Button>
        </div>

        {previewUrl ? (
          <div className="pt-2">
            <img
              src={previewUrl}
              width={400}
              height={300}
              alt="E-Ink preview"
              className="rounded border border-border bg-white shadow-sm"
            />
          </div>
        ) : null}
        {status ? (
          <p className="text-xs font-mono text-muted-foreground break-all bg-muted/30 p-2 rounded border border-border/50">
            {status}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
