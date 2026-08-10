// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

interface OscResource {
  name: string;
  type: string;
  properties?: {
    value?: unknown;
    expression?: string;
    template?: string;
    resource?: {
      type?: string;
      properties?: Record<string, unknown>;
    };
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.resolve(HERE, "../../../../public/_baselines");
const LEGACY_PROFILES = [
  ["ws2016-domain-controller.osc.yaml", 13],
  ["ws2016-domain-member.osc.yaml", 13],
  ["ws2016-workgroup-member.osc.yaml", 9],
  ["ws2019-domain-controller.osc.yaml", 13],
  ["ws2019-domain-member.osc.yaml", 13],
  ["ws2019-workgroup-member.osc.yaml", 9],
] as const;
const WINDOWS_PROFILES = [
  ...LEGACY_PROFILES.map(([file]) => file),
  "ws2022-domain-controller.osc.yaml",
  "ws2022-domain-member.osc.yaml",
  "ws2022-workgroup-member.osc.yaml",
  "ws2025-domain-controller.osc.yaml",
  "ws2025-member-server.osc.yaml",
  "ws2025-workgroup-member.osc.yaml",
];
const INFORMATIONAL_TEMPLATE =
  "The value {value} is informational for this control.";
const FIREWALL_DEFAULT_EXPRESSION =
  "((((value == 1)) || ((value == null))))";
const FIREWALL_DEFAULT_TEMPLATE =
  "The value {value} must be one of 1, (not set).";

function readResources(file: string): OscResource[] {
  const document = yaml.load(
    readFileSync(path.join(BASELINE_DIR, file), "utf8"),
  ) as { resources?: OscResource[] };
  return document.resources ?? [];
}

function findResource(resources: OscResource[], name: string): OscResource {
  const resource = resources.find((candidate) => candidate.name === name);
  expect(resource, name).toBeDefined();
  return resource!;
}

describe("Windows baseline enforceability", () => {
  it.each(WINDOWS_PROFILES)(
    "%s has no direct AccountPolicy or null-valued direct resources",
    (file) => {
      const resources = readResources(file);
      expect(
        resources.filter(
          (resource) => resource.type === "Microsoft.Windows/AccountPolicy",
        ),
      ).toEqual([]);
      expect(
        resources.filter(
          (resource) =>
            resource.type !== "Microsoft.OSConfig/Test" &&
            resource.type !== "Microsoft.OSConfig/Group" &&
            resource.properties !== undefined &&
            Object.hasOwn(resource.properties, "value") &&
            resource.properties.value === null,
        ),
      ).toEqual([]);
    },
  );

  it.each(LEGACY_PROFILES)(
    "%s wraps all %i account-policy controls as Tests",
    (file, expectedCount) => {
      const resources = readResources(file);
      const accountPolicyTests = resources.filter(
        (resource) =>
          resource.type === "Microsoft.OSConfig/Test" &&
          resource.properties?.resource?.type ===
            "Microsoft.Windows/AccountPolicy",
      );
      expect(accountPolicyTests).toHaveLength(expectedCount);
    },
  );

  it.each([
    "ws2022-domain-controller.osc.yaml",
    "ws2022-domain-member.osc.yaml",
  ])("%s accepts the effective default firewall inbound action", (file) => {
    const resources = readResources(file);
    for (const name of [
      "FirewallDomainProfileInboundConnection",
      "FirewallPrivateProfileInboundConnection",
      "FirewallPublicProfileInboundConnection",
    ]) {
      const resource = findResource(resources, name);
      expect(resource.properties?.expression).toBe(
        FIREWALL_DEFAULT_EXPRESSION,
      );
      expect(resource.properties?.template).toBe(FIREWALL_DEFAULT_TEMPLATE);
    }
  });

  it.each([
    "ws2025-domain-controller.osc.yaml",
    "ws2025-member-server.osc.yaml",
  ])("%s treats role-managed NTP client state as informational", (file) => {
    const resource = findResource(readResources(file), "EnabledNTPClient");
    expect(resource.properties?.expression).toBe("true");
    expect(resource.properties?.template).toBe(INFORMATIONAL_TEMPLATE);
  });
});
