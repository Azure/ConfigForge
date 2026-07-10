// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Core load + edit + format-tab state for the ManifestEditor page.
 *
 * Extracted from `index.tsx` in Phase A.3 of the v0.2.x page-split
 * refactor. This hook owns all the state that the data-fetch flow
 * (`fetchData`) needs to read/write: load lifecycle, edit lifecycle,
 * and the format-tab cache. Other concerns — deploy, docs modal, etc.
 * — live in their own hooks because they don't share state with
 * fetchData.
 *
 * No behaviour change vs. the pre-refactor inline state — same set of
 * declarations, same effect bodies, same race-condition guards. Phase
 * B adds unit tests on top of this hook before any visual extraction
 * starts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OscManifest, OscManifestStatus } from "@configforge/core/types";
import { cfs } from "../../../lib/cfs";
import type { FormatTab } from "../helpers";

export interface ManifestEditorState {
  // ── Load lifecycle ─────────────────────────────────────────────
  manifest: OscManifest | null;
  setManifest: React.Dispatch<React.SetStateAction<OscManifest | null>>;
  status: OscManifestStatus | null;
  setStatus: React.Dispatch<React.SetStateAction<OscManifestStatus | null>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  /** Mirror of `manifestName` for in-flight-fetch race-guard. Read by
   * fetchData and any other async flow that needs "did the URL change
   * while I was awaiting?". */
  manifestNameRef: React.MutableRefObject<string>;
  /** Re-fetch the manifest / yaml / status triple. Honours the
   * fetchToken race-guard so rapid URL switches don't show stale data. */
  fetchData: () => Promise<void>;

  // ── Edit lifecycle ─────────────────────────────────────────────
  editing: boolean;
  setEditing: React.Dispatch<React.SetStateAction<boolean>>;
  beginEditing: () => void;
  cancelEditing: () => void;
  editedContent: string;
  setEditedContent: React.Dispatch<React.SetStateAction<string>>;
  savedContent: string;
  setSavedContent: React.Dispatch<React.SetStateAction<string>>;
  editView: "editor" | "visual";
  setEditView: React.Dispatch<React.SetStateAction<"editor" | "visual">>;
  saving: boolean;
  setSaving: React.Dispatch<React.SetStateAction<boolean>>;

  // ── Format tabs ────────────────────────────────────────────────
  activeFormat: FormatTab;
  setActiveFormat: React.Dispatch<React.SetStateAction<FormatTab>>;
  formatLoading: boolean;
  setFormatLoading: React.Dispatch<React.SetStateAction<boolean>>;
  formatCache: React.MutableRefObject<Partial<Record<FormatTab, string>>>;
  fetchFormatContent: (format: FormatTab) => Promise<string>;
  handleFormatChange: (format: FormatTab) => Promise<void>;

  // ── Derived ────────────────────────────────────────────────────
  isEditable: boolean;
  isReadOnly: boolean;
  currentDisplayContent: string;
  hasUnsavedChanges: boolean;
}

export function useManifestEditorState(manifestName: string): ManifestEditorState {
  const { t } = useTranslation("manifest-editor");

  // ── Load lifecycle ─────────────────────────────────────────────
  const [manifest, setManifest] = useState<OscManifest | null>(null);
  const [status, setStatus] = useState<OscManifestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Edit lifecycle ─────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [editBaselineContent, setEditBaselineContent] = useState("");
  // v0.1.13 fix — track the YAML content as it was when the user
  // last hit Save (or as it was loaded from disk). Compared against
  // `editedContent` to compute a `hasUnsavedChanges` flag that
  // gates the navigation blocker in the page and lets us be smarter
  // about confirming nav-aways. Previously the editor had no notion
  // of "dirty" — clicking the Sidebar mid-edit silently discarded
  // the in-progress YAML without prompting.
  const [savedContent, setSavedContent] = useState<string>("");
  const [editView, setEditView] = useState<"editor" | "visual">("editor");
  const [saving, setSaving] = useState(false);

  // ── Format tabs ────────────────────────────────────────────────
  const [activeFormat, setActiveFormat] = useState<FormatTab>("yaml");
  const [formatLoading, setFormatLoading] = useState(false);
  const formatCache = useRef<Partial<Record<FormatTab, string>>>({});
  const latestFormatRequestRef = useRef<FormatTab | null>(null);
  const fetchGenerationRef = useRef(0);

  // Mirror of manifestName for in-flight fetch comparison. Kept as a
  // ref so the comparison in fetchData reads the *latest* URL value,
  // not the one captured in the original closure (which would always
  // equal the fetchToken and defeat the guard).
  const manifestNameRef = useRef(manifestName);
  useEffect(() => {
    manifestNameRef.current = manifestName;
    // Route changes must immediately detach the editor from the previous
    // manifest. If the new load fails, keeping the previous YAML visible
    // would let Save register manifest A's content under manifest B's name.
    fetchGenerationRef.current += 1;
    latestFormatRequestRef.current = null;
    formatCache.current = {};
    setManifest(null);
    setStatus(null);
    setError(null);
    setEditing(false);
    setEditedContent("");
    setSavedContent("");
    setEditBaselineContent("");
    setEditView("editor");
    setActiveFormat("yaml");
    setFormatLoading(false);
    setLoading(true);
  }, [manifestName]);

  const fetchFormatContent = useCallback(
    async (format: FormatTab): Promise<string> => {
      try {
        if (format === "yaml") {
          const artifact = await cfs.exportChannel.get({ name: manifestName, format: "yaml" });
          return typeof artifact.body === "string"
            ? artifact.body
            : new TextDecoder().decode(artifact.body);
        }
        if (format === "json") {
          const artifact = await cfs.exportChannel.get({ name: manifestName, format: "json" });
          return typeof artifact.body === "string"
            ? artifact.body
            : new TextDecoder().decode(artifact.body);
        }
        const artifact = await cfs.exportChannel.get({ name: manifestName, format: "mof" });
        return typeof artifact.body === "string"
          ? artifact.body
          : new TextDecoder().decode(artifact.body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("errors.unknown");
        if (format === "json") {
          throw new Error(t("formatErrors.jsonLoadFailed", { message: msg }));
        }
        throw new Error(
          t("formatErrors.formatLoadFailed", { format: format.toUpperCase(), message: msg }),
        );
      }
    },
    [manifestName, t],
  );

  const fetchData = useCallback(async () => {
    // A Save started on manifest A may resolve after navigation to B and
    // invoke the A-bound refresh callback. It must not invalidate B's active
    // generation or clear B's editor state.
    if (manifestName !== manifestNameRef.current) return;

    const fetchGeneration = ++fetchGenerationRef.current;
    const fetchToken = manifestName;
    const isCurrent = () =>
      fetchGeneration === fetchGenerationRef.current &&
      fetchToken === manifestNameRef.current;

    setLoading(true);
    setError(null);
    try {
      // perf W2 / C5: previously this called `cfs.manifests.list({})`
      // and threw away N-1 entries — for a 50-manifest / 326-resource
      // tenant that's ~5-10 MB serialized for one display. The new
      // `cfs.manifests.get(name)` channel returns just this manifest
      // with its Resources, no list traversal needed.
      const [getRes, yamlRes, statusRes] = await Promise.allSettled([
        cfs.manifests.get(manifestName),
        cfs.exportChannel.get({ name: manifestName, format: "yaml" }).then((a) =>
          typeof a.body === "string" ? a.body : new TextDecoder().decode(a.body),
        ),
        cfs.manifests.status(manifestName),
      ]);

      // After awaiting: if the URL has navigated to a different
      // manifest in the meantime, drop everything from this stale
      // fetch — the new fetch is the source of truth.
      if (!isCurrent()) return;

      // v0.1.11 fix — log rejected branches. Previously the
      // statusRes-rejected case fell through to a sessionStorage
      // fallback that masked the original IPC error; if both the
      // handler AND the cache failed, the compliance table rendered
      // empty with no diagnostic anywhere.
      if (getRes.status === "rejected") {
        // eslint-disable-next-line no-console
        console.error("[ManifestEditor] cfs.manifests.get failed:", getRes.reason);
      }
      if (yamlRes.status === "rejected") {
        // eslint-disable-next-line no-console
        console.error("[ManifestEditor] cfs.exportChannel.get(yaml) failed:", yamlRes.reason);
        const message =
          yamlRes.reason instanceof Error
            ? yamlRes.reason.message
            : t("errors.loadManifestFailed");
        setError(message);
      }
      if (statusRes.status === "rejected") {
        // eslint-disable-next-line no-console
        console.error("[ManifestEditor] cfs.manifests.status failed:", statusRes.reason);
      }

      if (getRes.status === "fulfilled") {
        const entry = (getRes.value as { data?: unknown }).data;
        if (entry && typeof entry === "object") {
          // The shape returned by getManifest matches the OscManifest
          // contract one-for-one (Name, DisplayName, Source, Resources,
          // Platform, …) so we can plug it straight into the existing
          // setManifest() consumer without reshaping.
          setManifest(entry as OscManifest);
        }
      }

      if (yamlRes.status === "fulfilled" && typeof yamlRes.value === "string") {
        formatCache.current = { yaml: yamlRes.value };
        setEditedContent(yamlRes.value);
        // Seed the "saved" baseline so the unsaved-changes guard
        // doesn't fire just because we loaded fresh content.
        setSavedContent(yamlRes.value);
        setEditBaselineContent(yamlRes.value);
      }

      if (statusRes.status === "fulfilled") {
        const data = (statusRes.value as { data?: unknown }).data;
        if (data) setStatus(data as OscManifestStatus);
        else {
          try {
            const cached = sessionStorage.getItem(`configforge-compliance-${manifestName}`);
            if (cached) setStatus(JSON.parse(cached));
          } catch {
            /* ignore */
          }
        }
      } else {
        try {
          const cached = sessionStorage.getItem(`configforge-compliance-${manifestName}`);
          if (cached) setStatus(JSON.parse(cached));
        } catch {
          /* ignore */
        }
      }

      setActiveFormat("yaml");
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : t("errors.loadManifestFailed"));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [manifestName, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFormatChange = useCallback(
    async (format: FormatTab) => {
      if (format === activeFormat) return;
      // An edit session owns exactly one representation. Switching to a
      // server-derived format while editing would show the last persisted
      // version and allow Save to discard the current buffer.
      if (editing) return;

      latestFormatRequestRef.current = format;

      const cached = formatCache.current[format];
      if (cached !== undefined) {
        setActiveFormat(format);
        setEditedContent(cached);
        setEditBaselineContent(cached);
        return;
      }

      setFormatLoading(true);
      try {
        const content = await fetchFormatContent(format);
        // Cache the content regardless of whether the user is still
        // looking at this tab — a future switch back will pick it up
        // from cache. Only update the visible editedContent if the
        // user hasn't moved on.
        formatCache.current[format] = content;
        if (latestFormatRequestRef.current === format) {
          setActiveFormat(format);
          setEditedContent(content);
          setEditBaselineContent(content);
        }
      } catch (err) {
        if (latestFormatRequestRef.current === format) {
          setError(err instanceof Error ? err.message : t("errors.loadFormatFailed", { format: format.toUpperCase() }));
        }
      } finally {
        if (latestFormatRequestRef.current === format) {
          setFormatLoading(false);
        }
      }
    },
    [activeFormat, editing, fetchFormatContent, t],
  );

  const beginEditing = useCallback(() => {
    setEditBaselineContent(editedContent);
    setEditing(true);
  }, [editedContent]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditedContent(editBaselineContent);
    formatCache.current[activeFormat] = editBaselineContent;
    setEditView("editor");
    setError(null);
  }, [activeFormat, editBaselineContent]);

  // ── Derived values ─────────────────────────────────────────────
  // MOF is always read-only; editing only allowed in YAML and JSON
  const isEditable =
    activeFormat !== "mof" && formatCache.current[activeFormat] !== undefined;
  const isReadOnly = !editing || !isEditable;
  const currentDisplayContent = formatCache.current[activeFormat] ?? "";
  const hasUnsavedChanges =
    editing && editedContent !== "" && editedContent !== editBaselineContent;

  // Phase D.1 — memoise the return so consumers don't re-render
  // when state they don't read changes. Every setter from useState
  // is referentially stable across renders by React contract, so the
  // dep list only needs the *values* and the *callback functions* the
  // hook defines.
  return useMemo<ManifestEditorState>(
    () => ({
      // Load lifecycle
      manifest,
      setManifest,
      status,
      setStatus,
      loading,
      setLoading,
      error,
      setError,
      manifestNameRef,
      fetchData,

      // Edit lifecycle
      editing,
      setEditing,
      beginEditing,
      cancelEditing,
      editedContent,
      setEditedContent,
      savedContent,
      setSavedContent,
      editView,
      setEditView,
      saving,
      setSaving,

      // Format tabs
      activeFormat,
      setActiveFormat,
      formatLoading,
      setFormatLoading,
      formatCache,
      fetchFormatContent,
      handleFormatChange,

      // Derived
      isEditable,
      isReadOnly,
      currentDisplayContent,
      hasUnsavedChanges,
    }),
    [
      manifest,
      status,
      loading,
      error,
      editing,
      beginEditing,
      cancelEditing,
      editedContent,
      savedContent,
      editView,
      saving,
      activeFormat,
      formatLoading,
      fetchData,
      fetchFormatContent,
      handleFormatChange,
      isEditable,
      isReadOnly,
      currentDisplayContent,
      hasUnsavedChanges,
    ],
  );
}
