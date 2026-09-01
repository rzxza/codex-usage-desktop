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
import { ManualExportTransport } from "@/eink/transport";
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [autoSync, setAutoSync] = useState(false);

  const snapshot = useMemo(
    () => buildEinkSnapshot(limits, analytics, resetSignal),
    [limits, analytics, resetSignal],
  );

  const handlePreview = () => {
    try {
      const dataUrl = snapshotToDataUrl(snapshot);
      setPreviewUrl(dataUrl);
      setStatus(t("eink.preview_ready"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("eink.preview_failed"));
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const dataUrl = snapshotToDataUrl(snapshot);
      setPreviewUrl(dataUrl);

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

  const handleSendToDevice = async () => {
    try {
      const transport = new ManualExportTransport();
      const devices = await transport.discover();
      const dev = devices[0];
      setStatus(`已准备好图像，请在“签变时光”客户端打开设备 (${dev.name}) 进行图片上传`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "发送失败");
    }
  };

  return (
    <Card className="rounded-lg">
      <CardContent className="p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">{t("eink.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("eink.subtitle")}</p>
        </div>

        {/* Telemetry and Device info area */}
        <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-2.5 text-xs">
          <div>
            <span className="text-muted-foreground block text-[10px]">设备模式 / Device</span>
            <span className="font-medium">PP_da14585_4.2</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">电量 / Battery</span>
            <span className="font-medium text-muted-foreground">{snapshot.batteryPercent != null ? `${snapshot.batteryPercent}%` : "--"}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">温度 / Temp</span>
            <span className="font-medium text-muted-foreground">{snapshot.temperatureC != null ? `${snapshot.temperatureC}°C` : "--"}</span>
          </div>
        </div>

        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("eink.manual_note")}
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" size="sm" onClick={handlePreview}>
            {t("eink.preview")}
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
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void handleSendToDevice()}
          >
            发送至设备 (Send)
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto cursor-pointer">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
              className="rounded"
            />
            自动同步 (Auto Sync)
          </label>
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
