// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Deploy + revert + CLI-gate flow for the ManifestEditor page.
 *
 * Extracted from `index.tsx` in Phase B.2 of the page-split refactor.
 * Owns the deploy job lifecycle (including the v0.1.14 cancel-on-unmount
 * effect, which is the single most regression-prone piece of the page).
 * Returns handlers the JSX consumes verbatim.
 *
 * Cross-hook coupling: this hook needs three callbacks from
 * `useManifestEditorState` (or from any outer state container):
 *   - `setStatus`: write the post-deploy compliance snapshot
 *   - `setError`: surface a page-level error banner
 *   - `fetchData`: refresh manifest + status after a revert
 *
 * These are passed in as args rather than imported because the
 * coupling is bi-directional and we want it explicit, not hidden via
 * a context provider.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OscManifestStatus, OscResource } from "@configforge/core/types";
import type { DeployProgressEvent } from "@configforge/core/handlers/deploy";
import { cfs } from "../../../lib/cfs";
import { BASELINE_CATALOG } from "../../../data/baseline-catalog";

export interface DeployResult {
  success: boolean;
  message: string;
  warning?: string;
  data?: {
    Name: string;
    Deployed: boolean;
    DeployError: string | null;
    Hostname: string;
    Timestamp: string;
    TotalResources: number;
    Compliant: number;
    NonCompliant: number;
    Indeterminate?: number;
    Errors: number;
    Resources: { name: string; type: string; status: string; reason: string }[];
    AuditIncomplete?: boolean;
  };
}

export type DetectedPlatform = "windows" | "linux" | "mixed" | "cross-platform";

export interface UseDeployFlowParams {
  manifestName: string;
  /** Whether the OSConfig CLI is installed. From `useCliPresence`. */
  presenceInstalled: boolean;
  /** Detected platform of the manifest. Used to short-circuit deploys
   * of mixed-platform manifests at the renderer (server still
   * re-validates against the host platform). */
  detectedPlatform: DetectedPlatform;
  /** Registration revision that the resulting compliance cache belongs to. */
  registrationRevision?: string | null;
  setStatus: (status: OscManifestStatus | null) => void;
  setError: (error: string | null) => void;
  fetchData: () => Promise<void>;
}

export interface DeployFlow {
  // ── State ─────────────────────────────────────────────────────
  deploying: boolean;
  deployProgress: DeployProgressEvent | null;
  deployResult: DeployResult | null;
  setDeployResult: (result: DeployResult | null) => void;
  deployMenuOpen: boolean;
  setDeployMenuOpen: (open: boolean) => void;
  reverting: boolean;
  cliGateFeature: string | null;
  setCliGateFeature: (feature: string | null) => void;
  /** Live jobId of the in-flight deploy. Read by the unmount-cleanup
   * effect inside the hook; exposed so tests can assert it. */
  deployJobIdRef: React.MutableRefObject<string | null>;

  // ── Handlers ──────────────────────────────────────────────────
  handleDeploy: (mode: "audit" | "enforce") => Promise<void>;
  handleRevert: () => Promise<void>;
}

export function useDeployFlow(params: UseDeployFlowParams): DeployFlow {
  const {
    manifestName,
    presenceInstalled,
    detectedPlatform,
    registrationRevision,
    setStatus,
    setError,
    fetchData,
  } = params;
  const { t } = useTranslation("manifest-editor");

  const [deploying, setDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState<DeployProgressEvent | null>(null);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [deployMenuOpen, setDeployMenuOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  // v0.2.0 BYO-CLI gate: opens the install-required dialog from the
  // Deploy/Audit dropdown. Carries the bolded feature label
  // ("Deploy"|"Audit").
  const [cliGateFeature, setCliGateFeature] = useState<string | null>(null);
  // v0.1.14: track the current deploy's jobId so we can cancel it on
  // unmount / navigate-away. Without this, navigating away from the
  // editor mid-deploy left the deploy running on the server; the
  // user would later see a "Deploy succeeded" toast (via the global
  // event bus) for a deploy they'd intentionally walked away from.
  const deployJobIdRef = useRef<string | null>(null);

  // v0.1.14: cancel in-flight deploy on unmount / navigate-away.
  // cfs.deploy.cancel() is a best-effort call — for `audit` mode it
  // aborts the in-process check; for `enforce` it only aborts BEFORE
  // the apply CLI is invoked (after that the apply runs to
  // completion server-side, but the renderer is no longer expecting
  // a result). Without this cleanup, a deploy that the user thought
  // they walked away from would still surface its result later.
  useEffect(() => {
    return () => {
      const jobId = deployJobIdRef.current;
      if (jobId) {
        deployJobIdRef.current = null;
        void cfs.deploy.cancel(jobId).catch(() => {
          /* best-effort */
        });
      }
    };
  }, []);

  const handleDeploy = useCallback(
    async (mode: "audit" | "enforce") => {
      // v0.2.0, bring-your-own-CLI gate. Refuse before the confirm
      // dialog so the user gets a clean install path.
      if (!presenceInstalled) {
        setCliGateFeature(mode === "audit" ? t("features.audit") : t("features.deploy"));
        return;
      }
      // Only block mixed manifests client-side. Cross-OS checks are done
      // server-side where the actual host platform is known reliably.
      if (detectedPlatform === "mixed") {
        setDeployResult({
          success: false,
          message: t("deploy.mixedPlatform"),
        });
        return;
      }

      const modeLabel =
        mode === "audit" ? t("deploy.mode.audit") : t("deploy.mode.enforce");
      if (!confirm(t("deploy.confirm", { name: manifestName, mode: modeLabel }))) return;

      // Enforce writes real changes to OS-level security policy
      // (registry, audit, user-rights, account-lockout, etc). A stray
      // Enter key on the first dialog must not be able to push a
      // machine into a broken policy state, so we gate enforce
      // behind a second, more explicit risk acknowledgement.
      if (mode === "enforce") {
        const riskMessage = t("deploy.enforceRiskConfirm");
        if (!confirm(riskMessage)) return;
      }

      setDeploying(true);
      setDeployResult(null);
      setError(null);
      try {
        // Check if this manifest matches a built-in scenario
        // Match by id, name, or slugified name
        const slugify = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const nameSlug = slugify(manifestName);
        const catalogEntry = BASELINE_CATALOG.find(
          (b) =>
            b.id === manifestName ||
            b.name === manifestName ||
            b.scenarioName === manifestName ||
            slugify(b.name) === nameSlug ||
            slugify(b.id) === nameSlug,
        );
        const payload: {
          name: string;
          mode: "audit" | "enforce";
          scenarioName?: string;
          platform?: string;
          jobId: string;
        } = {
          name: manifestName,
          mode,
          jobId:
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
        if (catalogEntry?.scenarioName) {
          payload.scenarioName = catalogEntry.scenarioName;
          payload.platform = catalogEntry.platform;
        }
        // v0.1.14: stash the jobId so the unmount-cleanup effect can
        // cancel this deploy if the user navigates away mid-run.
        deployJobIdRef.current = payload.jobId;

        const json = await cfs.deploy.run(payload, (event) => setDeployProgress(event));
        setDeployResult({
          success: true,
          message: json.message,
          warning: json.warning,
          data: json.data,
        });

        if (json.data?.Resources && Array.isArray(json.data.Resources)) {
          const deployResources: OscResource[] = json.data.Resources.map(
            (r: { name: string; type: string; status: string; reason: string }) => ({
              name: r.name,
              type: r.type,
              properties: {},
              compliance: {
                status: r.status,
                reason: r.reason ?? "",
              },
            }),
          );
          const statusData = {
            name: manifestName,
            revision: registrationRevision ?? null,
            resources: deployResources,
          };
          setStatus(statusData);
          // v0.1.14: sessionStorage quota guard. The compliance cache
          // can be ~80 KB per baseline (360-resource WS2025 manifest);
          // multiple baselines × multiple tabs can hit the 5 MB
          // quota. On QuotaExceededError we evict the oldest
          // `configforge-compliance-*` entries until the write
          // succeeds (or we've cleared everything and given up). The
          // cache is non-critical — losing it just means the next
          // load refetches from disk.
          const cacheKey = `configforge-compliance-${manifestName}`;
          const cacheValue = JSON.stringify(statusData);
          const tryWrite = (): boolean => {
            try {
              sessionStorage.setItem(cacheKey, cacheValue);
              return true;
            } catch (err) {
              const name = (err as { name?: string } | null)?.name;
              return !(name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED");
            }
          };
          if (!tryWrite()) {
            const others: string[] = [];
            for (let i = 0; i < sessionStorage.length; i++) {
              const k = sessionStorage.key(i);
              if (k && k.startsWith("configforge-compliance-") && k !== cacheKey) others.push(k);
            }
            for (const k of others) {
              sessionStorage.removeItem(k);
              if (tryWrite()) break;
            }
          }
        }
      } catch (err) {
        setDeployResult({
          success: false,
          message: err instanceof Error ? err.message : t("errors.deployFailed"),
        });
      } finally {
        setDeploying(false);
        setDeployProgress(null);
        deployJobIdRef.current = null;
      }
    },
    [manifestName, presenceInstalled, detectedPlatform, setStatus, setError, t],
  );

  const handleRevert = useCallback(async () => {
    if (
      !confirm(
        t("actions.revertConfirm", { name: manifestName }),
      )
    )
      return;
    setReverting(true);
    setDeployResult(null);
    setError(null);
    try {
      const json = await cfs.revert.apply({ name: manifestName });
      setDeployResult({
        success: true,
        message: (json as { message?: string }).message ?? t("messages.reverted"),
      });
      // Refresh manifest + status from disk so the page reflects the
      // post-revert state.
      void fetchData();
    } catch (err) {
      setDeployResult({
        success: false,
        message: err instanceof Error ? err.message : t("errors.revertFailed"),
      });
    } finally {
      setReverting(false);
    }
  }, [manifestName, setError, fetchData, t]);

  return useMemo<DeployFlow>(
    () => ({
      deploying,
      deployProgress,
      deployResult,
      setDeployResult,
      deployMenuOpen,
      setDeployMenuOpen,
      reverting,
      cliGateFeature,
      setCliGateFeature,
      deployJobIdRef,
      handleDeploy,
      handleRevert,
    }),
    [
      deploying,
      deployProgress,
      deployResult,
      deployMenuOpen,
      reverting,
      cliGateFeature,
      handleDeploy,
      handleRevert,
      t,
    ],
  );
}
