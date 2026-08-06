// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { parseOscYaml } from "@configforge/core/import-export";
import { validateManifestSchema, validateManifestPlatform } from "@configforge/core/platform";
import { BASELINE_CATALOG } from "./baseline-catalog";
import manifestSchema from "./osc-manifest-schema.json";

/**
 * Regression coverage for the WS2022 standalone-baseline repair.
 *
 * The three bundled Windows Server 2022 baselines shipped in their original
 * generated form: every audit-policy / user-rights / account-policy control
 * was addressed through `Microsoft.Windows/CSP` at `./Vendor/MSFT/Policy/
 * Result/...`, which cannot be read on a standalone (non-MDM) machine, so
 * ~30% of each profile came back unread. WS2025 was already repaired this
 * way in PRs #82/#93; this suite locks in the same shape for WS2022.
 *
 * Everything asserted here is derived from committed evidence:
 *   - `scripts/ws2022-baseline-repair/conversion-report.json` records the
 *     pre-repair source of every rule (produced by the deterministic
 *     converter from `173177e:public/_baselines/ws2022-*.osc.yaml`).
 *   - `scripts/ws2022-baseline-repair/csp-provider-map.json` records the
 *     reviewed WS2025 CSP-path -> dedicated-provider mappings.
 * CI checks out shallow, so the tests read the committed report rather than
 * shelling out to `git show`.
 */

interface OscResource {
  name: string;
  type: string;
  properties?: {
    resource?: { type?: string; properties?: Record<string, unknown> };
    expression?: string;
    template?: string;
    schema?: unknown;
    resources?: OscResource[];
  };
}

interface ProfileReport {
  profile: string;
  sourceRules: number;
  outputRules: number;
  sourceCsp: number;
  convertedCsp: number;
  residualCsp: string[];
  keyPathNormalized: number;
  providerCounts: Record<string, number>;
  expansions: { name: string; into: string[] }[];
  registryShapeRepairs: { name: string; valueType: string }[];
  assertionRestatements: { name: string; from: unknown; to: string; reason?: string }[];
  assertionDowngrades: { name: string }[];
  valueChanges: { name: string; from: unknown; to: unknown }[];
  conversions: { name: string; cspPath: string; to: string; evidence: string[] }[];
  sourceRuleNames: string[];
  sourceValues: Record<string, unknown>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.resolve(HERE, "../../../../public/_baselines");
const REPAIR_DIR = path.resolve(HERE, "../../../../scripts/ws2022-baseline-repair");

const CONVERSION_REPORT = JSON.parse(
  readFileSync(path.join(REPAIR_DIR, "conversion-report.json"), "utf8"),
) as { profiles: ProfileReport[] };

const CSP_PROVIDER_MAP = new Map(
  (
    JSON.parse(readFileSync(path.join(REPAIR_DIR, "csp-provider-map.json"), "utf8")) as {
      entries: { cspPath: string; target: { type: string }; evidence: string[] }[];
    }
  ).entries.map((entry) => [entry.cspPath, entry] as const),
);

const TEST_TYPE = "Microsoft.OSConfig/Test";
const REGISTRY = "Microsoft.Windows/Registry";
const AUDIT = "Microsoft.Windows/AuditPolicy";
const USER_RIGHTS = "Microsoft.Windows/UserRightsAssignment";
const ACCOUNT = "Microsoft.Windows/AccountPolicy";
const CSP = "Microsoft.Windows/CSP";

/**
 * User rights whose WS2022 source demanded "empty string or not set". The
 * `UserRightsAssignment` provider reads back a principal list, so the assertion
 * is restated over that list instead of being downgraded to informational.
 */
const UNASSIGNED_EXPRESSION = "value == null || value.size() == 0";
const UNASSIGNED_BASE = [
  "UserRightsAccessCredentialManagerAsTrustedCaller",
  "UserRightsActAsPartOfTheOperatingSystem",
  "UserRightsCreatePermanentSharedObjects",
  "UserRightsCreateToken",
  "UserRightsLockMemory",
  "UserRightsModifyObjectLabel",
] as const;

/**
 * Minimal CEL harness for the restored assertion. `||` short-circuits the way
 * CEL does, so `size()` is never applied to an unset value; any atom outside the
 * grammar throws rather than being silently approximated.
 */
function evalUnassigned(expression: string, value: unknown): boolean {
  return expression
    .split("||")
    .map((part) => part.trim())
    .some((atom) => {
      if (atom === "value == null") return value === null || value === undefined;
      const sized = /^value\.size\(\) == (\d+)$/.exec(atom);
      if (sized) {
        if (!Array.isArray(value)) throw new Error(`size() applied to ${String(value)}`);
        return value.length === Number(sized[1]);
      }
      throw new Error(`unsupported CEL atom for this harness: ${atom}`);
    });
}

/** Exact post-repair shape, asserted per profile. */
const EXPECTED = [
  {
    file: "ws2022-domain-member.osc.yaml",
    catalogId: "ws2022-domain-member",
    sourceRules: 257,
    outputRules: 259,
    sourceCsp: 73,
    providers: { [REGISTRY]: 184, [AUDIT]: 26, [USER_RIGHTS]: 36, [ACCOUNT]: 13 },
    unassignedUserRights: [...UNASSIGNED_BASE, "UserRightsEnableDelegation"],
  },
  {
    file: "ws2022-domain-controller.osc.yaml",
    catalogId: "ws2022-domain-controller",
    sourceRules: 242,
    outputRules: 244,
    sourceCsp: 71,
    providers: { [REGISTRY]: 171, [AUDIT]: 32, [USER_RIGHTS]: 28, [ACCOUNT]: 13 },
    // A domain controller delegates through AD, so `UserRightsEnableDelegation`
    // is not one of the controls the DC profile pins to "unassigned".
    unassignedUserRights: [...UNASSIGNED_BASE],
  },
  {
    file: "ws2022-workgroup-member.osc.yaml",
    catalogId: "ws2022-workgroup-member",
    sourceRules: 202 - 2,
    outputRules: 202,
    sourceCsp: 71,
    providers: { [REGISTRY]: 129, [AUDIT]: 26, [USER_RIGHTS]: 36, [ACCOUNT]: 11 },
    unassignedUserRights: [...UNASSIGNED_BASE, "UserRightsEnableDelegation"],
  },
] as const;

interface EnumSchema<T> {
  enum: T[];
}

interface NamedProviderSchema {
  properties: {
    properties: {
      properties: {
        name: EnumSchema<string>;
      };
    };
  };
}

interface AuditPolicySchema {
  properties: {
    properties: {
      properties: {
        value: EnumSchema<number>;
      };
    };
  };
}

interface RegistrySchema {
  properties: {
    properties: {
      allOf: Array<{
        oneOf?: Array<{
          properties?: {
            valueType?: EnumSchema<string>;
          };
        }>;
      }>;
    };
  };
}

interface ManifestSchema {
  $defs: {
    userrights: NamedProviderSchema;
    accpol: NamedProviderSchema;
    auditpol: AuditPolicySchema;
    registry: RegistrySchema;
  };
}

// Enum/pattern sources of truth, read straight out of the manifest schema so
// the assertions track the schema rather than a hand-copied list.
const schemaDefs = (manifestSchema as unknown as ManifestSchema).$defs;
const URA_NAMES: string[] = schemaDefs.userrights.properties.properties.properties.name.enum;
const ACCOUNT_POLICY_NAMES: string[] = schemaDefs.accpol.properties.properties.properties.name.enum;
const AUDIT_VALUES: number[] = schemaDefs.auditpol.properties.properties.properties.value.enum;
const REGISTRY_VALUE_TYPES: string[] = schemaDefs.registry.properties.properties.allOf
  .flatMap((clause) => clause.oneOf ?? [])
  .flatMap((variant) => variant.properties?.valueType?.enum ?? []);
const AUDIT_SUBCATEGORY_PATTERN = /^\{0CCE[0-9A-F]{4}-69AE-11D9-BED3-505054503030\}$/;
const HIVE_PATTERN = /^(?:HKLM|HKCU|HKCR|HKU|HKCC|HKEY_[A-Z_]+):\\/;

function loadRaw(file: string): string {
  return readFileSync(path.join(BASELINE_DIR, file), "utf8");
}

function flatten(resources: OscResource[]): OscResource[] {
  const out: OscResource[] = [];
  for (const resource of resources) {
    if (resource.properties?.resources) {
      out.push(...flatten(resource.properties.resources));
    } else {
      out.push(resource);
    }
  }
  return out;
}

function loadRules(file: string): OscResource[] {
  const document = yaml.load(loadRaw(file)) as { resources?: OscResource[] };
  return flatten(document.resources ?? []);
}

function reportFor(file: string): ProfileReport {
  const report = CONVERSION_REPORT.profiles.find((p) => p.profile === file);
  if (!report) throw new Error(`no conversion report entry for ${file}`);
  return report;
}

describe.each(EXPECTED)("WS2022 baseline — $file", (expected) => {
  const rules = loadRules(expected.file);
  const report = reportFor(expected.file);
  const byName = new Map(rules.map((r) => [r.name, r]));

  describe("parses and validates", () => {
    it("parses as an OSConfig manifest", () => {
      const parsed = parseOscYaml(loadRaw(expected.file));
      expect(parsed.resources.length).toBeGreaterThan(0);
    });

    it("passes ConfigForge manifest schema validation with zero errors", () => {
      const parsed = parseOscYaml(loadRaw(expected.file));
      expect(validateManifestSchema(parsed)).toEqual([]);
    });

    it("passes ConfigForge windows platform validation with zero errors", () => {
      const parsed = parseOscYaml(loadRaw(expected.file));
      expect(validateManifestPlatform(parsed.resources, "windows")).toEqual([]);
    });
  });

  describe("rule and provider counts", () => {
    it("has the exact post-repair rule count", () => {
      expect(rules.length).toBe(expected.outputRules);
      expect(report.outputRules).toBe(expected.outputRules);
    });

    it("has the exact per-provider rule counts", () => {
      const counts: Record<string, number> = {};
      for (const rule of rules) {
        const type = rule.properties?.resource?.type ?? "<none>";
        counts[type] = (counts[type] ?? 0) + 1;
      }
      expect(counts).toEqual(expected.providers);
    });

    it("agrees with the committed conversion report", () => {
      expect(report.sourceRules).toBe(expected.sourceRules);
      expect(report.sourceCsp).toBe(expected.sourceCsp);
      expect(report.convertedCsp).toBe(expected.sourceCsp);
      expect(Object.keys(report.sourceRuleNames).length).toBe(expected.sourceRules);
    });
  });

  describe("source-to-output logical rule parity", () => {
    it("carries every source rule forward by name", () => {
      const missing = report.sourceRuleNames.filter((name) => !byName.has(name));
      expect(missing).toEqual([]);
    });

    it("reconciles the rule-count delta entirely through documented expansions", () => {
      const extra = report.expansions.reduce((sum, e) => sum + e.into.length - 1, 0);
      expect(expected.sourceRules + extra).toBe(expected.outputRules);
      expect(extra).toBe(2);
    });

    it("expands the composite lockout policy into three AccountPolicy rules", () => {
      expect(report.expansions).toHaveLength(1);
      const [expansion] = report.expansions;
      expect(expansion.name).toBe("AccountLockoutPolicy");
      expect(expansion.into).toEqual([
        "AccountLockoutPolicy",
        "AccountLockoutPolicy_LockoutThreshold",
        "AccountLockoutPolicy_LockoutReset",
      ]);
      for (const name of expansion.into) {
        expect(byName.get(name)?.properties?.resource?.type).toBe(ACCOUNT);
      }
    });

    it("introduces no rules that are neither a source rule nor an expansion product", () => {
      const known = new Set(report.sourceRuleNames);
      for (const expansion of report.expansions) {
        for (const name of expansion.into) known.add(name);
      }
      expect(rules.filter((r) => !known.has(r.name)).map((r) => r.name)).toEqual([]);
    });

    it("has no duplicate rule names", () => {
      expect(byName.size).toBe(rules.length);
    });
  });

  describe("no Policy/Result CSP remains", () => {
    it("contains no Microsoft.Windows/CSP resources at all", () => {
      expect(rules.filter((r) => r.properties?.resource?.type === CSP).map((r) => r.name)).toEqual(
        [],
      );
      expect(report.residualCsp).toEqual([]);
    });

    it("contains no ./Vendor/MSFT/Policy/Result addressing anywhere in the file", () => {
      expect(loadRaw(expected.file)).not.toContain("/Policy/Result/");
    });

    it("routes every converted CSP path through a reviewed WS2025 mapping", () => {
      for (const conversion of report.conversions) {
        const mapping = CSP_PROVIDER_MAP.get(conversion.cspPath);
        expect(mapping, `unmapped CSP path ${conversion.cspPath}`).toBeDefined();
        expect(mapping!.target.type).toBe(conversion.to);
        expect(mapping!.evidence.length).toBeGreaterThan(0);
      }
      expect(report.conversions).toHaveLength(expected.sourceCsp);
    });

    it("only converts to the four dedicated providers", () => {
      const targets = new Set(report.conversions.map((c) => c.to));
      expect([...targets].sort()).toEqual([ACCOUNT, AUDIT, USER_RIGHTS].sort());
    });
  });

  describe("no malformed provider payloads", () => {
    it("wraps every rule in a Microsoft.OSConfig/Test with a CEL expression", () => {
      for (const rule of rules) {
        expect(rule.type, rule.name).toBe(TEST_TYPE);
        expect(rule.properties?.schema, rule.name).toBeUndefined();
        expect(typeof rule.properties?.expression, rule.name).toBe("string");
        expect(rule.properties?.expression?.length, rule.name).toBeGreaterThan(0);
        expect(typeof rule.properties?.template, rule.name).toBe("string");
        expect(rule.properties?.template, rule.name).toContain("{value}");
      }
    });

    it("emits well-formed Registry payloads", () => {
      for (const rule of rules.filter((r) => r.properties?.resource?.type === REGISTRY)) {
        const props = rule.properties!.resource!.properties as Record<string, unknown>;
        expect(props.keyPath, rule.name).toMatch(HIVE_PATTERN);
        expect(REGISTRY_VALUE_TYPES, rule.name).toContain(props.valueType as string);
        expect(typeof props.valueName, rule.name).toBe("string");
        // A handful of controls are read-only/informational upstream and carry
        // no desired value; the provider still needs a well-formed address.
        if (!("value" in props)) continue;
        if (props.valueType === "REG_DWORD" || props.valueType === "REG_QWORD") {
          expect(typeof props.value, rule.name).toBe("number");
        } else if (props.valueType === "REG_MULTI_SZ") {
          expect(Array.isArray(props.value), rule.name).toBe(true);
        } else if (props.valueType === "REG_SZ" || props.valueType === "REG_EXPAND_SZ") {
          expect(typeof props.value, rule.name).toBe("string");
        }
      }
    });

    it("emits well-formed UserRightsAssignment payloads", () => {
      for (const rule of rules.filter((r) => r.properties?.resource?.type === USER_RIGHTS)) {
        const props = rule.properties!.resource!.properties as Record<string, unknown>;
        expect(props.name, rule.name).toMatch(/^Se[A-Za-z]+$/);
        expect(URA_NAMES, rule.name).toContain(props.name as string);
        expect(Array.isArray(props.value), rule.name).toBe(true);
        for (const principal of props.value as unknown[]) {
          expect(typeof principal, rule.name).toBe("string");
        }
      }
    });

    it("emits well-formed AuditPolicy payloads", () => {
      for (const rule of rules.filter((r) => r.properties?.resource?.type === AUDIT)) {
        const props = rule.properties!.resource!.properties as Record<string, unknown>;
        expect(props.subcategory, rule.name).toMatch(AUDIT_SUBCATEGORY_PATTERN);
        expect(AUDIT_VALUES, rule.name).toContain(props.value as number);
      }
    });

    it("emits well-formed AccountPolicy payloads", () => {
      for (const rule of rules.filter((r) => r.properties?.resource?.type === ACCOUNT)) {
        const props = rule.properties!.resource!.properties as Record<string, unknown>;
        expect(ACCOUNT_POLICY_NAMES, rule.name).toContain(props.name as string);
        if ("value" in props) {
          expect(["number", "boolean", "string"], rule.name).toContain(typeof props.value);
        }
      }
    });

    it("leaves no colon-less registry hive prefixes behind", () => {
      const registry = rules.filter((r) => r.properties?.resource?.type === REGISTRY);
      expect(registry.length).toBe(report.keyPathNormalized);
      expect(
        registry
          .map((r) => (r.properties!.resource!.properties as Record<string, unknown>).keyPath)
          .filter((keyPath) => !HIVE_PATTERN.test(String(keyPath))),
      ).toEqual([]);
    });
  });

  describe("desired values are preserved", () => {
    it("changes no desired value outside the documented provider-contract reshapes", () => {
      const documented = new Set(report.valueChanges.map((change) => change.name));
      const unexpected: string[] = [];
      for (const [name, sourceValue] of Object.entries(report.sourceValues)) {
        if (documented.has(name)) continue;
        const props = byName.get(name)?.properties?.resource?.properties ?? {};
        if (!("value" in props)) continue;
        if (JSON.stringify(props.value) !== JSON.stringify(sourceValue)) unexpected.push(name);
      }
      expect(unexpected).toEqual([]);
    });

    it("documents every reshape with a provider-mandated justification", () => {
      const reshapeNames = new Set([
        ...report.registryShapeRepairs.map((r) => r.name),
        ...report.expansions.flatMap((e) => e.into),
        ...report.expansions.map((e) => e.name),
      ]);
      for (const change of report.valueChanges) {
        const target = byName.get(change.name)?.properties?.resource?.type;
        const isUserRightsListReshape = target === USER_RIGHTS && change.from === "";
        const isAccountPolicyBoolean = target === ACCOUNT && typeof change.to === "boolean";
        expect(
          isUserRightsListReshape || isAccountPolicyBoolean || reshapeNames.has(change.name),
          `${change.name}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`,
        ).toBe(true);
      }
    });

    it("keeps every numeric Registry desired value byte-identical", () => {
      for (const rule of rules.filter((r) => r.properties?.resource?.type === REGISTRY)) {
        const source = report.sourceValues[rule.name];
        if (typeof source !== "number") continue;
        expect((rule.properties!.resource!.properties as Record<string, unknown>).value, rule.name)
          .toBe(source);
      }
    });
  });

  describe("residual unread risk is declared, not hidden", () => {
    it("asserts 'unassigned' on every user right whose source demanded it", () => {
      const restated = rules.filter(
        (r) =>
          r.properties?.resource?.type === USER_RIGHTS &&
          r.properties?.expression === UNASSIGNED_EXPRESSION,
      );
      expect(restated.map((r) => r.name).sort()).toEqual(
        [...expected.unassignedUserRights].sort(),
      );
      expect(restated.length).toBe(expected.unassignedUserRights.length);
      for (const rule of restated) {
        expect(rule.properties?.resource?.properties?.value, rule.name).toEqual([]);
        expect(rule.properties?.template, rule.name).toBe(
          "The value {value} must be unassigned (no principals).",
        );
        expect(rule.properties?.template, rule.name).not.toContain("informational");
      }
    });

    it("passes the restored assertion on an empty list and fails it on any principal", () => {
      for (const rule of rules.filter(
        (r) => r.properties?.expression === UNASSIGNED_EXPRESSION,
      )) {
        expect(evalUnassigned(rule.properties!.expression!, null), rule.name).toBe(true);
        expect(evalUnassigned(rule.properties!.expression!, []), rule.name).toBe(true);
        expect(
          evalUnassigned(rule.properties!.expression!, ["*S-1-5-32-544"]),
          rule.name,
        ).toBe(false);
      }
    });

    it("reconciles the restatements with the conversion report", () => {
      const reported = report.assertionRestatements.map((item) => item.name).sort();
      expect(reported).toEqual([...expected.unassignedUserRights].sort());
      for (const item of report.assertionRestatements) {
        expect(item.to, item.name).toBe(UNASSIGNED_EXPRESSION);
        expect(byName.get(item.name)?.properties?.expression, item.name).toBe(
          UNASSIGNED_EXPRESSION,
        );
      }
    });

    it("leaves every other UserRightsAssignment rule explicitly informational", () => {
      const restated = new Set(expected.unassignedUserRights as readonly string[]);
      for (const rule of rules.filter((r) => r.properties?.resource?.type === USER_RIGHTS)) {
        if (restated.has(rule.name!)) continue;
        expect(rule.properties?.expression, rule.name).toBe("true");
        expect(rule.properties?.template, rule.name).toContain("informational");
      }
    });

    it("carries no remaining assertion downgrade", () => {
      expect(report.assertionDowngrades).toEqual([]);
    });

    it("never leaves a rule without a readable assertion or template", () => {
      for (const rule of rules) {
        expect(rule.properties?.expression, rule.name).toBeTruthy();
        expect(rule.properties?.template, rule.name).toBeTruthy();
      }
    });
  });

  describe("catalog metadata", () => {
    const entry = BASELINE_CATALOG.find((b) => b.id === expected.catalogId);

    it("reports the corrected resource count", () => {
      expect(entry?.resourceCount).toBe(expected.outputRules);
    });

    it("drops the upstream githubUrl (local manifest no longer matches upstream)", () => {
      expect(entry?.githubUrl).toBeUndefined();
    });

    it("keeps manifestUrl and scenarioName untouched", () => {
      expect(entry?.manifestUrl).toBe(`/_baselines/${expected.file}`);
      expect(entry?.scenarioName).toBe(
        `SecurityBaseline/Server/2022/${
          {
            "ws2022-domain-member": "MemberServer",
            "ws2022-domain-controller": "DomainController",
            "ws2022-workgroup-member": "WorkgroupMember",
          }[expected.catalogId]
        }`,
      );
    });
  });
});

describe("WS2022 representative rules", () => {
  const member = new Map(
    loadRules("ws2022-domain-member.osc.yaml").map((r) => [r.name, r] as const),
  );

  it("Registry: ICMP redirect hardening keeps its WS2022 value on a colon hive", () => {
    const rule = member.get("AllowICMPRedirectsToOverrideOSPFGeneratedRoutes");
    expect(rule?.properties?.resource?.type).toBe(REGISTRY);
    expect(rule?.properties?.resource?.properties).toEqual({
      keyPath: "HKEY_LOCAL_MACHINE:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters",
      valueName: "EnableICMPRedirect",
      valueType: "REG_DWORD",
      value: 0,
    });
    expect(rule?.properties?.expression).toBe("((((value == 0)) || ((value == null))))");
    expect(rule?.properties?.schema).toBeUndefined();
  });

  it("AuditPolicy: AuditCredentialValidation uses an exact subcategory GUID", () => {
    const rule = member.get("AuditCredentialValidation");
    expect(rule?.properties?.resource?.type).toBe(AUDIT);
    expect(rule?.properties?.resource?.properties).toEqual({
      subcategory: "{0CCE923F-69AE-11D9-BED3-505054503030}",
      value: 3,
    });
  });

  it("UserRightsAssignment: UserRightsDenyAccessFromNetwork uses an exact Se* right name", () => {
    const rule = member.get("UserRightsDenyAccessFromNetwork");
    expect(rule?.properties?.resource?.type).toBe(USER_RIGHTS);
    expect(rule?.properties?.resource?.properties).toEqual({
      name: "SeDenyNetworkLogonRight",
      value: ["*S-1-5-32-546"],
    });
  });

  it("AccountPolicy: minimum password length uses an exact policy name and the WS2022 value", () => {
    const rule = member.get("DeviceLockMinDevicePasswordLength");
    expect(rule?.properties?.resource?.type).toBe(ACCOUNT);
    expect(rule?.properties?.resource?.properties).toEqual({
      name: "MinimumPasswordLength",
      value: 14,
    });
    expect(rule?.properties?.expression).toBe("(value != null && value >= 14)");
  });

  it("AccountPolicy: the composite lockout CSP expands into three separate policies", () => {
    expect(member.get("AccountLockoutPolicy")?.properties?.resource?.properties).toEqual({
      name: "LockoutDuration",
      value: 15,
    });
    expect(
      member.get("AccountLockoutPolicy_LockoutThreshold")?.properties?.resource?.properties,
    ).toEqual({ name: "LockoutThreshold", value: 3 });
    expect(
      member.get("AccountLockoutPolicy_LockoutReset")?.properties?.resource?.properties,
    ).toEqual({ name: "LockoutReset", value: 15 });
  });
});
