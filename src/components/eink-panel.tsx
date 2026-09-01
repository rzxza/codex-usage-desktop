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

  return (
    <Card className="rounded-lg">
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">{t("eink.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("eink.subtitle")}</p>

        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("eink.manual_note")}
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
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
