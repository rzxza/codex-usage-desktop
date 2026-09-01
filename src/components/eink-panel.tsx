import { useMemo, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  CodexLimitsResponse,
  CodexResetSignalResponse,
  ServerCreditAnalyticsResponse,
} from "@/lib/api";
import { buildEinkSnapshot } from "@/eink/snapshot";
import { snapshotToDataUrl, snapshotToPngBytes } from "@/eink/renderer";
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
  const [manualPreviewUrl, setManualPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const snapshot = useMemo(
    () => buildEinkSnapshot(limits, analytics, resetSignal),
    [limits, analytics, resetSignal],
  );

  const livePreviewUrl = useMemo(() => {
    try {
      return snapshotToDataUrl(snapshot);
    } catch (err) {
      console.warn("Failed to generate live preview dataUrl", err);
      return null;
    }
  }, [snapshot]);

  const activePreviewUrl = manualPreviewUrl ?? livePreviewUrl;

  const handlePreview = () => {
    try {
      const dataUrl = snapshotToDataUrl(snapshot);
      setManualPreviewUrl(dataUrl);
      setStatus(t("eink.preview_ready", { defaultValue: "预览已刷新" }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("eink.preview_failed", { defaultValue: "预览生成失败" }));
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const dataUrl = snapshotToDataUrl(snapshot);
      setManualPreviewUrl(dataUrl);

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

      setStatus(`${t("eink.export_ready", { defaultValue: "PNG 已导出" })} (${savedPath})`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("eink.export_failed", { defaultValue: "PNG 导出失败" }));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="rounded-lg">
      <CardContent className="p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">{t("eink.title", { defaultValue: "E-Ink 墨水屏输出" })}</h3>
          <p className="text-xs text-muted-foreground">{t("eink.subtitle", { defaultValue: "支持 4.2 寸 400x300 三色（黑/白/红）墨水屏" })}</p>
        </div>

        {/* Telemetry and Device info area */}
        <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-2.5 text-xs">
          <div>
            <span className="text-muted-foreground block text-[10px]">设备架构 / Device</span>
            <span className="font-medium">PP_da14585_4.2</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">电量 / Battery</span>
            <span className="font-medium text-muted-foreground">
              {snapshot.batteryPercent != null ? `${snapshot.batteryPercent}%` : "-- (未接入)"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">温度 / Temp</span>
            <span className="font-medium text-muted-foreground">
              {snapshot.temperatureC != null ? `${snapshot.temperatureC}°C` : "-- (未接入)"}
            </span>
          </div>
        </div>

        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("eink.manual_note", { defaultValue: "自动发送尚未启用；请使用“签变时光 -> 图片上传”。" })}
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" size="sm" onClick={handlePreview}>
            {t("eink.preview", { defaultValue: "刷新预览" })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isExporting}
            onClick={() => void handleExport()}
          >
            {isExporting ? "导出中..." : t("eink.export_png", { defaultValue: "导出墨水屏图片" })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={true}
            title="直接 BLE 发送开发中（当前请使用导出 PNG + 签变时光上传）"
          >
            直接 BLE 发送 (开发中)
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground/50 ml-auto cursor-not-allowed" title="待 Direct BLE 验证通过后启用">
            <input
              type="checkbox"
              disabled={true}
              checked={false}
              className="rounded opacity-40 cursor-not-allowed"
            />
            自动同步 (开发中)
          </label>
        </div>

        {activePreviewUrl ? (
          <div className="pt-2 space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground flex items-center justify-between">
              <span>实时画面预览 (400x300 Tri-Color)</span>
              <span className="text-[10px] text-muted-foreground/70">黑 / 白 / 红 3-Color Raster</span>
            </div>
            <div className="inline-block rounded-md border border-border bg-white p-1 shadow-sm">
              <img
                src={activePreviewUrl}
                width={400}
                height={300}
                alt="E-Ink preview"
                className="block rounded bg-white"
                style={{ imageRendering: "pixelated", width: "400px", height: "300px" }}
              />
            </div>
          </div>
        ) : (
          <div className="p-4 text-center text-xs text-muted-foreground border border-dashed rounded-md">
            正在生成墨水屏画面预览...
          </div>
        )}

        {status ? (
          <p className="text-xs font-mono text-muted-foreground break-all bg-muted/30 p-2 rounded border border-border/50">
            {status}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
