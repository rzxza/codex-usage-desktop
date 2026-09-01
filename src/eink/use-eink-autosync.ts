import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CodexLimitsResponse,
  CodexResetSignalResponse,
  ServerCreditAnalyticsResponse,
} from "@/lib/api";
import { buildEinkSnapshot, hashEinkPixels } from "./snapshot";
import { renderEinkMatrix, snapshotToDataUrl, snapshotToPngBytes } from "./renderer";
import {
  evaluateAutoSyncDecision,
  createInitialEinkSyncState,
} from "./autosync";
import type {
  EinkPushResult,
  EinkSettings,
  EinkSyncState,
} from "./types";
import {
  loadEinkSettings,
  loadEinkSyncBaseline,
  saveEinkSettings,
  saveEinkSyncBaseline,
  getTargetKey,
} from "./settings";
import { getEinkTransport } from "./transport";

export type UseEinkAutoSyncProps = {
  limits: CodexLimitsResponse | null;
  analytics: ServerCreditAnalyticsResponse | null;
  resetSignal: CodexResetSignalResponse | null;
};

export type UseEinkAutoSyncResult = {
  settings: EinkSettings;
  state: EinkSyncState;
  previewUrl: string | null;
  isPushing: boolean;
  fileSinkPath: string | null;
  updateSettings: (updater: (prev: EinkSettings) => EinkSettings) => void;
  triggerManualPush: () => Promise<EinkPushResult | null>;
  refreshPreview: () => void;
};

export function useEinkAutoSync({
  limits,
  analytics,
  resetSignal,
}: UseEinkAutoSyncProps): UseEinkAutoSyncResult {
  const [settings, setSettings] = useState<EinkSettings>(() => loadEinkSettings());
  const [state, setState] = useState<EinkSyncState>(() => {
    const baseline = loadEinkSyncBaseline();
    return createInitialEinkSyncState(baseline);
  });
  const [fileSinkPath, setFileSinkPath] = useState<string | null>(null);
  const [manualPreviewVersion, setManualPreviewVersion] = useState(0);

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<EinkPushResult | null> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const transport = useMemo(() => getEinkTransport(settings.transportKind), [settings.transportKind]);

  // Load default file sink path
  useEffect(() => {
    if (settings.transportKind === "file") {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<string>("eink_get_file_sink_path"))
        .then((path) => setFileSinkPath(path))
        .catch(() => setFileSinkPath(null));
    }
  }, [settings.transportKind]);

  const snapshot = useMemo(
    () => buildEinkSnapshot(limits, analytics, resetSignal),
    [limits, analytics, resetSignal],
  );

  const { matrix, pixelsHash } = useMemo(() => {
    try {
      const mat = renderEinkMatrix(snapshot);
      const hash = hashEinkPixels(mat);
      return { matrix: mat, pixelsHash: hash };
    } catch (err) {
      console.warn("Failed to render eink matrix:", err);
      return { matrix: null, pixelsHash: null };
    }
  }, [snapshot]);

  const previewUrl = useMemo(() => {
    void manualPreviewVersion;
    try {
      return snapshotToDataUrl(snapshot);
    } catch {
      return null;
    }
  }, [snapshot, manualPreviewVersion]);

  const refreshPreview = useCallback(() => {
    setManualPreviewVersion((v) => v + 1);
  }, []);

  const updateSettings = useCallback((updater: (prev: EinkSettings) => EinkSettings) => {
    setSettings((prev) => {
      const next = updater(prev);
      saveEinkSettings(next);
      return next;
    });
  }, []);

  const executePush = useCallback(
    async (isManual = false): Promise<EinkPushResult | null> => {
      if (inFlightRef.current) {
        return inFlightRef.current;
      }

      const activeSettings = settingsRef.current;
      const activeTransport = getEinkTransport(activeSettings.transportKind);
      const targetDeviceId = activeSettings.deviceId || "default";

      if (!activeTransport.capabilities.supportsAutoPush && !isManual) {
        return null;
      }

      setState((prev: EinkSyncState) => ({
        ...prev,
        status: "uploading",
        lastAttemptAt: Date.now(),
      }));

      const pushPromise = (async () => {
        try {
          const imageBytes = await snapshotToPngBytes(snapshot);
          const result = await activeTransport.uploadImage(targetDeviceId, new Uint8Array(imageBytes));

          const now = Date.now();
          const targetKey = getTargetKey(activeSettings.transportKind, activeSettings.deviceId);

          setState((prev: EinkSyncState) => {
            const nextState: EinkSyncState = {
              ...prev,
              status: "success",
              lastSuccessHash: pixelsHash,
              lastSuccessAt: now,
              lastSuccessTargetKey: targetKey,
              lastError: null,
              pendingHash: null,
              pendingTargetKey: null,
              nextPushAt: null,
              consecutiveFailures: 0,
            };
            saveEinkSyncBaseline({
              lastSuccessHash: pixelsHash || "",
              lastSuccessAt: now,
              lastSuccessTargetKey: targetKey,
            });
            return nextState;
          });

          if (result.disposition === "written" && result.detail) {
            setFileSinkPath(result.detail);
          }

          return result;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          setState((prev: EinkSyncState) => {
            const nextFailures = prev.consecutiveFailures + 1;
            return {
              ...prev,
              status: "error",
              lastError: errMsg,
              consecutiveFailures: nextFailures,
            };
          });
          return null;
        } finally {
          inFlightRef.current = null;
        }
      })();

      inFlightRef.current = pushPromise;
      return pushPromise;
    },
    [snapshot, pixelsHash],
  );

  const triggerManualPush = useCallback(async () => {
    return executePush(true);
  }, [executePush]);

  // Evaluate Decision on state / snapshot / settings change
  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const now = Date.now();
    const decision = evaluateAutoSyncDecision({
      snapshot,
      pixelsHash,
      settings,
      capabilities: transport.capabilities,
      state: stateRef.current,
      now,
    });

    if (decision.nextState.status !== stateRef.current.status ||
        decision.nextState.nextPushAt !== stateRef.current.nextPushAt ||
        decision.nextState.pendingHash !== stateRef.current.pendingHash) {
      setState(decision.nextState);
    }

    if (decision.action === "push") {
      void executePush(false);
    } else if (decision.action === "schedule_due" && decision.delayMs !== undefined) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void executePush(false);
      }, decision.delayMs);
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [snapshot, pixelsHash, settings, transport, executePush]);

  return {
    settings,
    state,
    previewUrl,
    isPushing: state.status === "uploading",
    fileSinkPath,
    updateSettings,
    triggerManualPush,
    refreshPreview,
  };
}
