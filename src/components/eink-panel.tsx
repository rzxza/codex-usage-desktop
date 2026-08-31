import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  CodexLimitsResponse,
  CodexResetSignalResponse,
  ServerCreditAnalyticsResponse,
} from "@/lib/api";
import { buildEinkSnapshot } from "@/eink/snapshot";
import { snapshotToPngBlob } from "@/eink/renderer";
import { useTranslation } from "react-i18next";

type EinkPanelProps = {
  limits: CodexLimitsResponse | null;
  analytics: ServerCreditAnalyticsResponse | null;
  resetSignal: CodexResetSignalResponse | null;
};

export function EinkPanel({ limits, analytics, resetSignal }: EinkPanelProps) {
  const { t } = useTranslation();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const snapshot = useMemo(
    () => buildEinkSnapshot(limits, analytics, resetSignal),
    [limits, analytics, resetSignal],
  );

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  const generatePng = async (): Promise<Blob> => {
    const blob = await snapshotToPngBlob(snapshot);
    return blob;
  };

  const handlePreview = async () => {
    try {
      const blob = await generatePng();
      const url = URL.createObjectURL(blob);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setStatus(t("eink.preview_ready"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("eink.preview_failed"));
    }
  };

  const handleExport = async () => {
    try {
      const blob = await generatePng();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "codex-eink-400x300.png";
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(t("eink.export_ready"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("eink.export_failed"));
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
          <Button type="button" size="sm" onClick={() => void handlePreview()}>
            {t("eink.preview")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleExport()}>
            {t("eink.export_png")}
          </Button>
        </div>

        {previewUrl ? (
          <div className="pt-2">
            <img
              src={previewUrl}
              width={400}
              height={300}
              alt="E-Ink preview"
              className="rounded border border-border bg-white"
            />
          </div>
        ) : null}
        {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
      </CardContent>
    </Card>
  );
}
