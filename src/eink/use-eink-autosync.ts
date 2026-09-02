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
  handlePushOutcome,
} from "./autosync";
import type {
  EinkPushResult,
  EinkSettings,
  EinkSnapshot,
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
  triggerManualPush: (force?: boolean) => Promise<EinkPushResult | null>;
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

  const transport = useMemo(
    () => getEinkTransport(settings.transportKind),
    [settings.transportKind],
  );

  // Load default file sink path
  useEffect(() => {
    if (settings.transportKind === "file") {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke<string>("eink_get_file_sink_path", {
            targetPath: settings.customSinkPath || settings.deviceId || null,
          }),
        )
        .then((path) => setFileSinkPath(path))
        .catch(() => setFileSinkPath(null));
    }
  }, [settings.transportKind, settings.customSinkPath, settings.deviceId]);

  const snapshot = useMemo(
    () => buildEinkSnapshot(limits, analytics, resetSignal),
    [limits, analytics, resetSignal],
  );

  const snapshotRef = useRef<EinkSnapshot>(snapshot);
  snapshotRef.current = snapshot;

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

  const pixelsHashRef = useRef<string | null>(pixelsHash);
  pixelsHashRef.current = pixelsHash;

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

  const schedulePushTimer = useCallback((delayMs: number, action: () => void) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      action();
    }, Math.max(0, delayMs));
  }, []);

  const executePush = useCallback(
    async (isManual = false): Promise<EinkPushResult | null> => {
      if (inFlightRef.current) {
        return inFlightRef.current;
      }

      const activeSettings = settingsRef.current;
      const activeTransport = getEinkTransport(activeSettings.transportKind);
      const targetDeviceId =
        activeSettings.customSinkPath || activeSettings.deviceId || "default";

      if (!activeTransport.capabilities.supportsAutoPush && !isManual) {
        return null;
      }

      setState((prev: EinkSyncState) => ({
        ...prev,
        status: "uploading",
        lastAttemptAt: Date.now(),
      }));

      const pushPromise = (async () => {
        const currentSnapshot = snapshotRef.current;
        const currentHash = pixelsHashRef.current || "";
        const targetKey = getTargetKey(
          activeSettings.transportKind,
          activeSettings.deviceId,
          activeSettings.customSinkPath,
        );

        try {
          const imageBytes = await snapshotToPngBytes(currentSnapshot);
          const result = await activeTransport.uploadImage(
            targetDeviceId,
            new Uint8Array(imageBytes),
          );

          const now = Date.now();
          const nextState = handlePushOutcome(
            stateRef.current,
            {
              success: true,
              hash: currentHash,
              targetKey,
              result,
            },
            now,
          );

          saveEinkSyncBaseline({
            lastSuccessHash: currentHash,
            lastSuccessAt: now,
            lastSuccessTargetKey: targetKey,
          });

          setState(nextState);

          if (result.disposition === "written" && result.detail) {
            setFileSinkPath(result.detail);
          }

          return result;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const now = Date.now();
          const nextState = handlePushOutcome(
            stateRef.current,
            {
              success: false,
              hash: currentHash,
              targetKey,
              error: errMsg,
            },
            now,
          );

          setState(nextState);

          // Schedule automatic retry if nextPushAt is configured
          if (nextState.nextPushAt !== null) {
            const delay = nextState.nextPushAt - now;
            schedulePushTimer(delay, () => {
              void executePush(false);
            });
          }

          if (isManual) {
            throw err;
          }
          return null;
        } finally {
          inFlightRef.current = null;
        }
      })();

      inFlightRef.current = pushPromise;
      return pushPromise;
    },
    [schedulePushTimer],
  );

  const triggerManualPush = useCallback(
    async (force = true) => {
      return executePush(force);
    },
    [executePush],
  );

  // Evaluate Decision on state / snapshot / settings change
  useEffect(() => {
    const now = Date.now();
    const decision = evaluateAutoSyncDecision({
      snapshot,
      pixelsHash,
      settings,
      capabilities: transport.capabilities,
      state: stateRef.current,
      now,
    });

    if (
      decision.nextState.status !== stateRef.current.status ||
      decision.nextState.nextPushAt !== stateRef.current.nextPushAt ||
      decision.nextState.pendingHash !== stateRef.current.pendingHash
    ) {
      setState(decision.nextState);
    }

    if (decision.action === "push") {
      void executePush(false);
    } else if (
      decision.action === "schedule_due" &&
      decision.delayMs !== undefined
    ) {
      schedulePushTimer(decision.delayMs, () => {
        void executePush(false);
      });
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [snapshot, pixelsHash, settings, transport, executePush, schedulePushTimer]);

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
