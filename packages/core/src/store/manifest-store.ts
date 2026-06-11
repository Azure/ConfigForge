// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { create } from "zustand";
import type { OscManifest, HealthStatus } from "../types";

interface ManifestStore {
  manifests: OscManifest[];
  currentManifest: OscManifest | null;
  healthStatus: HealthStatus | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchManifests: () => Promise<void>;
  fetchHealth: () => Promise<void>;
  setCurrentManifest: (manifest: OscManifest | null) => void;
  registerManifest: (name: string, content: string) => Promise<void>;
  removeManifest: (name: string) => Promise<void>;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const useManifestStore = create<ManifestStore>((set, get) => ({
  manifests: [],
  currentManifest: null,
  healthStatus: null,
  isLoading: false,
  error: null,

  fetchManifests: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiFetch<OscManifest[]>("/api/manifests");
      const list = Array.isArray(data) ? data : [data];
      set({ manifests: list, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch manifests",
        isLoading: false,
      });
    }
  },

  fetchHealth: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiFetch<HealthStatus>("/api/health");
      set({ healthStatus: data, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch health status",
        isLoading: false,
      });
    }
  },

  setCurrentManifest: (manifest) => {
    set({ currentManifest: manifest });
  },

  registerManifest: async (name, content) => {
    set({ isLoading: true, error: null });
    try {
      await apiFetch<OscManifest>("/api/manifests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      await get().fetchManifests();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to register manifest",
        isLoading: false,
      });
    }
  },

  removeManifest: async (name) => {
    set({ isLoading: true, error: null });
    try {
      await apiFetch<null>(`/api/manifests/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      const current = get().currentManifest;
      if (current?.Name === name) {
        set({ currentManifest: null });
      }
      await get().fetchManifests();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to remove manifest",
        isLoading: false,
      });
    }
  },
}));
