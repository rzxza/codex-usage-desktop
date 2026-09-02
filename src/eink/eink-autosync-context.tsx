import React, { createContext, useContext } from "react";
import type {
  CodexLimitsResponse,
  CodexResetSignalResponse,
  ServerCreditAnalyticsResponse,
} from "@/lib/api";
import { useEinkAutoSync, type UseEinkAutoSyncResult } from "./use-eink-autosync";

const EinkAutoSyncContext = createContext<UseEinkAutoSyncResult | null>(null);

export type EinkAutoSyncProviderProps = {
  limits: CodexLimitsResponse | null;
  analytics: ServerCreditAnalyticsResponse | null;
  resetSignal: CodexResetSignalResponse | null;
  children: React.ReactNode;
};

export function EinkAutoSyncProvider({
  limits,
  analytics,
  resetSignal,
  children,
}: EinkAutoSyncProviderProps) {
  const autosync = useEinkAutoSync({ limits, analytics, resetSignal });

  return (
    <EinkAutoSyncContext.Provider value={autosync}>
      {children}
    </EinkAutoSyncContext.Provider>
  );
}

export function useEinkAutoSyncContext(): UseEinkAutoSyncResult {
  const context = useContext(EinkAutoSyncContext);
  if (!context) {
    throw new Error(
      "useEinkAutoSyncContext must be used within an EinkAutoSyncProvider",
    );
  }
  return context;
}
