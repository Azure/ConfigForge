// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { BASELINE_CATALOG } from "./baseline-catalog";

interface BaselineResource {
  name: string;
  type: string;
  properties?: {
    resource?: {
      type?: string;
      properties?: Record<string, unknown>;
    };
    expression?: string;
    schema?: unknown;
  };
}

const BASELINE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../public/_baselines",
);

function loadBaseline(filename: string): BaselineResource[] {
  const document = yaml.load(readFileSync(path.join(BASELINE_DIR, filename), "utf8")) as {
    resources?: BaselineResource[];
  };
  return document.resources ?? [];
}

/**
 * Regression coverage for the WS2025 standalone-baseline fix.
 *
 * The failing CSP resources in the three WS2025 `.osc.yaml` baselines were
 * converted to dedicated providers, which changed their resource counts and
 * made the upstream `microsoft/osconfig` `githubUrl` values inaccurate (the
 * local manifests no longer match what's published there). This suite locks
 * in the corrected counts and confirms no "Source" link is rendered for
 * these three baselines, while leaving every other catalog entry untouched.
 */
describe("BASELINE_CATALOG — WS2025 standalone-provider fix", () => {
  const ws2025MemberServer = BASELINE_CATALOG.find((b) => b.id === "ws2025-member-server");
  const ws2025DomainController = BASELINE_CATALOG.find((b) => b.id === "ws2025-domain-controller");
  const ws2025WorkgroupMember = BASELINE_CATALOG.find((b) => b.id === "ws2025-workgroup-member");

  it("reports the corrected resource count for ws2025-member-server (320)", () => {
    expect(ws2025MemberServer?.resourceCount).toBe(320);
  });

  it("reports the corrected resource count for ws2025-domain-controller (321)", () => {
    expect(ws2025DomainController?.resourceCount).toBe(321);
  });

  it("reports the corrected resource count for ws2025-workgroup-member (296)", () => {
    expect(ws2025WorkgroupMember?.resourceCount).toBe(296);
  });

  it("has no githubUrl for ws2025-member-server (no Source button)", () => {
    expect(ws2025MemberServer?.githubUrl).toBeUndefined();
  });

  it("has no githubUrl for ws2025-domain-controller (no Source button)", () => {
    expect(ws2025DomainController?.githubUrl).toBeUndefined();
  });

  it("has no githubUrl for ws2025-workgroup-member (no Source button)", () => {
    expect(ws2025WorkgroupMember?.githubUrl).toBeUndefined();
  });

  it("leaves manifestUrl and scenarioName untouched for the three WS2025 baselines", () => {
    expect(ws2025MemberServer?.manifestUrl).toBe("/_baselines/ws2025-member-server.osc.yaml");
    expect(ws2025MemberServer?.scenarioName).toBe("SecurityBaseline/WS2025/MemberServer");

    expect(ws2025DomainController?.manifestUrl).toBe(
      "/_baselines/ws2025-domain-controller.osc.yaml",
    );
    expect(ws2025DomainController?.scenarioName).toBe("SecurityBaseline/WS2025/DomainController");

    expect(ws2025WorkgroupMember?.manifestUrl).toBe("/_baselines/ws2025-workgroup-member.osc.yaml");
    expect(ws2025WorkgroupMember?.scenarioName).toBe("SecurityBaseline/WS2025/WorkgroupMember");
  });

  it("positive control: an untouched baseline still has its githubUrl (Source button preserved)", () => {
    // ws2025-secured-core is a sibling WS2025 baseline that is NOT part of
    // this fix — its upstream link must still render a Source button.
    const securedCore = BASELINE_CATALOG.find((b) => b.id === "ws2025-secured-core");
    expect(securedCore?.githubUrl).toBe(
      "https://github.com/microsoft/osconfig/blob/main/security/ws2025/secured_core.osc.yaml",
    );
  });
});

describe("WS2025 full-overlay invariants", () => {
  const profiles = [
    ["ws2025-member-server.osc.yaml", 320],
    ["ws2025-domain-controller.osc.yaml", 321],
    ["ws2025-workgroup-member.osc.yaml", 296],
  ] as const;

  it.each(profiles)("preserves every resource in %s", (filename, count) => {
    const resources = loadBaseline(filename);
    expect(resources).toHaveLength(count);
    expect(new Set(resources.map((resource) => resource.name)).size).toBe(count);

    const cspPaths: string[] = [];
    for (const wrapper of resources) {
      expect(wrapper.type).toBe("Microsoft.OSConfig/Test");
      expect(wrapper.properties?.schema).toBeUndefined();
      expect(wrapper.properties?.expression).toEqual(expect.any(String));

      const inner = wrapper.properties?.resource;
      if (inner?.type === "Microsoft.Windows/Registry") {
        expect(inner.properties?.valueType).toMatch(/^REG_/);
        expect(inner.properties?.keyPath).toMatch(/^(?:HKLM|HKCU|HKCR|HKU|HKCC|HKEY_[A-Z_]+):\\/i);
      }
      if (inner?.type === "Microsoft.Windows/CSP") {
        cspPaths.push(String(inner.properties?.path ?? ""));
      }
    }

    expect(cspPaths).toHaveLength(5);
    expect(cspPaths.every((cspPath) => cspPath.includes("/Policy/Config/"))).toBe(true);
    expect(cspPaths.some((cspPath) => cspPath.includes("/Policy/Result/"))).toBe(false);
  });

  it("keeps the reviewed CSP-to-provider repairs", () => {
    const resources = loadBaseline("ws2025-workgroup-member.osc.yaml");
    const byName = new Map(resources.map((resource) => [resource.name, resource]));
    const dedicated = [
      "AuditBackupAndRestorePrivilege",
      "DmaGuardDeviceEnumerationPolicy",
      "DeviceGuardRequirePlatformSecurityFeatures",
      "RecoveryConsoleAllowFloppyCopyAndAllDrives",
      "SmartCardRemovalBehavior",
    ];

    for (const name of dedicated) {
      expect(byName.get(name)?.properties?.resource?.type).toBe("Microsoft.Windows/Registry");
    }
    expect(
      byName.get("AuditBackupAndRestorePrivilege")?.properties?.resource?.properties,
    ).toMatchObject({
      keyPath: "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa",
      valueName: "FullPrivilegeAuditing",
      valueType: "REG_BINARY",
      value: "AA==",
    });
  });
});
