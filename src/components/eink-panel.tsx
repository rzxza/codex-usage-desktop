import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  CodexLimitsResponse,
  CodexResetSignalResponse,
  ServerCreditAnalyticsResponse,
} from "@/lib/api";
import { buildEinkSnapshot } from "@/eink/snapshot";
import { snapshotToPngBlob } from "@/eink/renderer";
import { MockEinkTransport } from "@/eink/transport";
import { useTranslation } from "react-i18next";

type EinkPanelProps = {
  limits: CodexLimitsResponse | null;
  analytics: ServerCreditAnalyticsResponse | null;
  resetSignal: CodexResetSignalResponse | null;
};

export function EinkPanel({ limits, analytics, resetSignal }: EinkPanelProps) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => localStorage.getItem("eink_enabled") === "1");
  const [autoPush, setAutoPush] = useState(() => localStorage.getItem("eink_auto_push") === "1");
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [deviceId, setDeviceId] = useState("manual-export");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const snapshot = useMemo(
    () => buildEinkSnapshot(limits, analytics, resetSignal),
    [limits, analytics, resetSignal],
  );

  const updateEnabled = (value: boolean) => {
    setEnabled(value);
    try {
      localStorage.setItem("eink_enabled", value ? "1" : "0");
    } catch (_) {
      // Ignore storage errors
    }
  };

  const updateAutoPush = (value: boolean) => {
    setAutoPush(value);
    try {
      localStorage.setItem("eink_auto_push", value ? "1" : "0");
    } catch (_) {
      // Ignore storage errors
    }
  };

  const generatePng = async (): Promise<Blob> => {
    const blob = await snapshotToPngBlob(snapshot);
    return blob;
  };

  const handlePreview = async () => {
    try {
      const blob = await generatePng();
      const url = URL.createObjectURL(blob);
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

  const handlePushNow = async () => {
    if (deviceId === "mock-4p2") {
      try {
        const blob = await generatePng();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const transport = new MockEinkTransport();
        await transport.uploadImage(deviceId, bytes);
        setStatus(t("eink.push_ok"));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t("eink.push_failed"));
      }
    } else {
      setStatus(t("eink.push_manual_hint"));
    }
  };

  return (
    <Card className="rounded-lg">
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">{t("eink.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("eink.subtitle")}</p>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => updateEnabled(e.target.checked)} />
          {t("eink.enabled")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoPush} onChange={(e) => updateAutoPush(e.target.checked)} />
          {t("eink.auto_push")}
        </label>
        <label className="block text-sm">
          {t("eink.refresh_interval")}
          <select
            className="ml-2 rounded border px-2 py-1 text-sm"
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
          >
            <option value={10}>10 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
          </select>
        </label>
        <label className="block text-sm">
          {t("eink.device")}
          <select
            className="ml-2 rounded border px-2 py-1 text-sm"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            <option value="manual-export">{t("eink.device_manual")}</option>
            <option value="mock-4p2">Mock 4.2&quot; DA14585</option>
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void handlePreview()}>
            {t("eink.preview")}
          </Button>
          <Button type="button" size="sm" onClick={() => void handleExport()}>
            {t("eink.export_png")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void handlePushNow()}>
            {t("eink.push_now")}
          </Button>
        </div>

        {previewUrl ? (
          <img
            src={previewUrl}
            width={400}
            height={300}
            alt="E-Ink preview"
            className="rounded border border-border bg-white"
          />
        ) : null}
        {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
      </CardContent>
    </Card>
  );
}