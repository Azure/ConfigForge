// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.


import { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import {
  DocumentRegular,
  PhoneRegular,
  ArrowLeftRegular,
  ShieldRegular,
  ServerRegular,
  WindowConsoleRegular,
  HardDriveRegular,
  PeopleRegular,
  DesktopRegular,
  SettingsRegular,
  DeveloperBoardRegular,
  DatabaseRegular,
  LayerRegular,
} from "@fluentui/react-icons";
import { type Platform } from "@configforge/core/platform";
import { WindowsLogo } from "./WindowsLogo";

interface ResourceDefinition {
  name: string;
  type: string;
  properties: Record<string, unknown>;
  compliance?: { equals: unknown };
}

interface ResourceTypeOption {
  type: string;
  label: string;
  description: string;
  icon: typeof DocumentRegular;
  platform: 'windows' | 'linux' | 'cross-platform';
}

const ALL_RESOURCE_TYPES: ResourceTypeOption[] = [
  // Windows-only
  {
    type: "Microsoft.Windows/Registry",
    label: "Registry",
    description: "Manage Windows registry keys and values",
    icon: DatabaseRegular,
    platform: "windows",
  },
  {
    type: "Microsoft.Windows/CSP",
    label: "CSP (MDM)",
    description: "Configure via OMA-URI / Configuration Service Provider",
    icon: PhoneRegular,
    platform: "windows",
  },
  {
    type: "Microsoft.Windows/AccountPolicy",
    label: "Account Policy",
    description: "Configure password and lockout policies",
    icon: ShieldRegular,
    platform: "windows",
  },
  {
    type: "Microsoft.Windows/AuditPolicy",
    label: "Audit Policy",
    description: "Configure security audit subcategory policies",
    icon: DesktopRegular,
    platform: "windows",
  },
  {
    type: "Microsoft.Windows/UserRightsAssignment",
    label: "User Rights",
    description: "Manage user rights and privilege assignments",
    icon: PeopleRegular,
    platform: "windows",
  },
  // Linux-only
  {
    type: "Linux/FilePermission",
    label: "File Permission",
    description: "Manage file ownership and permission modes",
    icon: ShieldRegular,
    platform: "linux",
  },
  {
    type: "Linux/KernelModule",
    label: "Kernel Module",
    description: "Control kernel module loading state",
    icon: DeveloperBoardRegular,
    platform: "linux",
  },
  {
    type: "Linux/User",
    label: "User",
    description: "Manage Linux user accounts and group IDs",
    icon: PeopleRegular,
    platform: "linux",
  },
  // Cross-platform
  {
    type: "Microsoft.OSConfig/File",
    label: "File",
    description: "Manage file content and existence",
    icon: DocumentRegular,
    platform: "cross-platform",
  },
  {
    type: "Microsoft.OSConfig/FileLine",
    label: "File Line",
    description: "Find and replace lines in config files",
    icon: SettingsRegular,
    platform: "cross-platform",
  },
  {
    type: "Microsoft.OSConfig/DeviceInfo",
    label: "Device Info",
    description: "Query device information and metadata",
    icon: ServerRegular,
    platform: "cross-platform",
  },
  {
    type: "Microsoft.OSConfig/Firmware",
    label: "Firmware",
    description: "Check firmware configuration and status",
    icon: HardDriveRegular,
    platform: "cross-platform",
  },
  {
    type: "Microsoft.OSConfig/Group",
    label: "Group",
    description: "Group multiple settings together",
    icon: LayerRegular,
    platform: "cross-platform",
  },
  {
    type: "Microsoft.OSConfig/Test",
    label: "Test",
    description: "Run test assertions on device state",
    icon: WindowConsoleRegular,
    platform: "cross-platform",
  },
];

  // Remove read-only and complex resource types that need special handling
  const EXCLUDED_TYPES = new Set([
    'Microsoft.OSConfig/DeviceInfo',  // Read-only, no settable properties
    'Microsoft.OSConfig/Firmware',     // Read-only, no settable properties  
    'Microsoft.OSConfig/Test',         // Complex: requires nested resource + schema
  ]);

const PLATFORM_BADGE_STYLES: Record<string, string> = {
  windows:
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  linux:
    "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  "cross-platform":
    "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700/30 dark:text-slate-400 dark:border-slate-600",
};

const PLATFORM_BADGE_LABEL: Record<string, string> = {
  windows: "Windows",
  linux: "🐧 Linux",
  "cross-platform": "⚙️ Cross-platform",
};

interface ResourcePickerProps {
  onSelect: (resource: ResourceDefinition) => void;
  platform?: Platform;
  /**
   * When provided, the picker boots in EDIT mode:
   * - skips the type-selection grid (auto-picks the matching type)
   * - pre-populates all per-type form fields from the resource's
   *   properties + compliance.equals
   * - adds a top-level "Resource Name" rename field
   * - changes the submit button label to "Save changes"
   * - on submit, MERGES form values into `initialResource` so any
   *   properties the form doesn't know about (custom valueType,
   *   security descriptors, nested arrays for Group, etc.) pass
   *   through unchanged.
   * - skips integer coercion when the original value was a string
   *   ("Administrators" stays a string)
   */
  initialResource?: ResourceDefinition;
  /**
   * Optional Cancel handler. When provided (typically by the edit
   * dialog), a Cancel button is rendered alongside Submit. Add-mode
   * callers can leave this undefined.
   */
  onCancel?: () => void;
}

export function ResourcePicker({ onSelect, platform, initialResource, onCancel }: ResourcePickerProps) {
  const isEdit = initialResource !== undefined;
  const [selected, setSelected] = useState<ResourceTypeOption | null>(null);
  // v0.3.0 (#13): search box above the type grid. Once the OSConfig
  // type registry grows (currently 14) this is the difference between
  // 2 scrolls and 0 scrolls to find the right card.
  const [typeSearch, setTypeSearch] = useState("");

  // Edit-mode only: the resource's top-level name. Editable so the
  // user can rename in place. In add mode the name is derived from
  // type-specific fields (e.g. regName for Registry).
  const [editName, setEditName] = useState("");

  // YAML fallback editor — used in edit mode for resource types without
  // a per-field form (Microsoft.OSConfig/Test, Microsoft.OSConfig/Group,
  // or any unrecognized type). Test wrappers in particular contain nested
  // resources + schema oneOf clauses that would be unwieldy in a flat form.
  const [yamlEditText, setYamlEditText] = useState("");
  const [yamlEditError, setYamlEditError] = useState<string | null>(null);

  // Types that have a dedicated per-field form. Anything outside this set
  // (including Microsoft.OSConfig/Test, Microsoft.OSConfig/Group, and
  // exotic / unrecognized types) routes to the YAML fallback in edit mode.
  const TYPES_WITH_FORM = useMemo(
    () =>
      new Set<string>([
        "Microsoft.Windows/Registry",
        "Microsoft.Windows/CSP",
        "Microsoft.Windows/AccountPolicy",
        "Microsoft.Windows/AuditPolicy",
        "Microsoft.Windows/UserRightsAssignment",
        "Linux/FilePermission",
        "Linux/KernelModule",
        "Linux/User",
        "Microsoft.OSConfig/File",
        "Microsoft.OSConfig/FileLine",
      ]),
    [],
  );

  // Form state — Registry
  const [regPath, setRegPath] = useState("HKLM:\\SOFTWARE\\");
  const [regName, setRegName] = useState("");
  const [regExpected, setRegExpected] = useState("");
  const [regEnforce, setRegEnforce] = useState("");

  // Form state — CSP
  const [cspUri, setCspUri] = useState("");
  const [cspExpected, setCspExpected] = useState("");
  const [cspEnforce, setCspEnforce] = useState("");

  // Form state — AccountPolicy
  const [apName, setApName] = useState("");
  const [apExpected, setApExpected] = useState("");

  // Form state — AuditPolicy
  const [auditSubcategory, setAuditSubcategory] = useState("");
  const [auditExpected, setAuditExpected] = useState("");

  // Form state — UserRightsAssignment
  const [uraName, setUraName] = useState("");
  const [uraExpected, setUraExpected] = useState("");

  // Form state — Linux/FilePermission
  const [fpPath, setFpPath] = useState("");
  const [fpOwner, setFpOwner] = useState("");
  const [fpGroup, setFpGroup] = useState("");
  const [fpMode, setFpMode] = useState("");

  // Form state — Linux/KernelModule
  const [kmName, setKmName] = useState("");
  const [kmLoaded, setKmLoaded] = useState(false);

  // Form state — Linux/User
  const [luName, setLuName] = useState("");
  const [luGid, setLuGid] = useState("");

  // Form state — File (cross-platform)
  const [filePath, setFilePath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileExists, setFileExists] = useState(true);

  // Form state — FileLine (cross-platform)
  const [flPath, setFlPath] = useState("");
  const [flFind, setFlFind] = useState("");
  const [flReplace, setFlReplace] = useState("");
  const [flAppend, setFlAppend] = useState(false);
  const [flIgnoreCase, setFlIgnoreCase] = useState(false);

  const reset = () => {
    setSelected(null);
    setRegPath("HKLM:\\SOFTWARE\\");
    setRegName("");
    setRegExpected("");
    setRegEnforce("");
    setCspUri("");
    setCspExpected("");
    setCspEnforce("");
    setApName("");
    setApExpected("");
    setAuditSubcategory("");
    setAuditExpected("");
    setUraName("");
    setUraExpected("");
    setFpPath("");
    setFpOwner("");
    setFpGroup("");
    setFpMode("");
    setKmName("");
    setKmLoaded(false);
    setLuName("");
    setLuGid("");
    setFilePath("");
    setFileContent("");
    setFileExists(true);
    setFlPath("");
    setFlFind("");
    setFlReplace("");
    setFlAppend(false);
    setFlIgnoreCase(false);
  };

  // Capture Test-wrapper context so we can rebuild it on submit. When
  // editing `Microsoft.OSConfig/Test`, we unwrap to the inner resource
  // for the form, then re-wrap on submit preserving the original schema.
  const [testWrapperOriginal, setTestWrapperOriginal] = useState<ResourceDefinition | null>(null);

  // Edit-mode bootstrap: when `initialResource` arrives, find the matching
  // type option, seed all form fields from the resource's properties +
  // compliance, and skip the type-selection grid by pre-setting `selected`.
  //
  // Special handling for two structural cases:
  //   - Microsoft.OSConfig/Test wrappers: unwrap properties.resource and
  //     edit the inner resource (Registry/CSP/etc.). The Test schema is
  //     preserved verbatim and rewrapped on submit.
  //   - Resource types without a per-field form (Group, exotic): seed
  //     the YAML fallback editor with the full resource as YAML.
  useEffect(() => {
    if (!initialResource) return;

    // ── Test wrapper: unwrap to inner resource ──────────────────────
    let effective: ResourceDefinition = initialResource;
    if (initialResource.type === "Microsoft.OSConfig/Test") {
      const outerProps = (initialResource.properties ?? {}) as Record<string, unknown>;
      const inner = outerProps.resource as Record<string, unknown> | undefined;
      if (inner && typeof inner === "object" && typeof inner.type === "string") {
        effective = {
          name: initialResource.name,
          type: inner.type,
          properties: (inner.properties as Record<string, unknown>) ?? {},
          compliance: initialResource.compliance,
        };
        setTestWrapperOriginal(initialResource);
      } else {
        setTestWrapperOriginal(null);
      }
    } else {
      setTestWrapperOriginal(null);
    }

    const match = ALL_RESOURCE_TYPES.find((rt) => rt.type === effective.type) ?? null;
    setSelected(match);
    setEditName(initialResource.name ?? "");

    // For unmatched types OR types without a dedicated form (Group, Test
    // with non-standard inner), seed the YAML fallback. The form will
    // route to it via the render branches below.
    const hasForm = match !== null && TYPES_WITH_FORM.has(effective.type);
    if (!hasForm) {
      try {
        setYamlEditText(
          yaml.dump(initialResource, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: false,
          }),
        );
        setYamlEditError(null);
      } catch {
        setYamlEditText("");
      }
    }

    const props = (effective.properties ?? {}) as Record<string, unknown>;
    const expected = effective.compliance?.equals;
    const expectedStr = expected === undefined || expected === null ? "" : String(expected);

    const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
    const bool = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

    switch (effective.type) {
      case "Microsoft.Windows/Registry":
        setRegPath(str(props.keyPath) || "HKLM:\\SOFTWARE\\");
        setRegName(str(props.valueName));
        setRegExpected(expectedStr);
        setRegEnforce(str(props.value));
        break;
      case "Microsoft.Windows/CSP":
        setCspUri(str(props.path));
        setCspExpected(expectedStr);
        setCspEnforce(str(props.value));
        break;
      case "Microsoft.Windows/AccountPolicy":
        setApName(str(props.name));
        setApExpected(expectedStr);
        break;
      case "Microsoft.Windows/AuditPolicy":
        setAuditSubcategory(str(props.subcategory));
        setAuditExpected(expectedStr);
        break;
      case "Microsoft.Windows/UserRightsAssignment":
        setUraName(str(props.name));
        setUraExpected(expectedStr);
        break;
      case "Linux/FilePermission":
        setFpPath(str(props.path));
        setFpOwner(str(props.owner));
        setFpGroup(str(props.group));
        setFpMode(str(props.mode));
        break;
      case "Linux/KernelModule":
        setKmName(str(props.name));
        setKmLoaded(bool(props.loaded));
        break;
      case "Linux/User":
        setLuName(str(props.name));
        setLuGid(str(props.gid));
        break;
      case "Microsoft.OSConfig/File":
        setFilePath(str(props.path));
        setFileContent(str(props.content));
        setFileExists(props.exists === undefined ? true : bool(props.exists));
        break;
      case "Microsoft.OSConfig/FileLine":
        setFlPath(str(props.path));
        setFlFind(str(props.find));
        setFlReplace(str(props.replace));
        setFlAppend(bool(props.append));
        setFlIgnoreCase(bool(props.ignoreCase));
        break;
      default:
        break;
    }
  }, [initialResource]);

  /**
   * In edit mode, coerce a form-input string back to the same JS type
   * as the original value. Avoids the add-flow's `parseInt(...) || s`
   * trick mangling string values like "Administrators".
   */
  const coerceLikeOriginal = (formValue: string, original: unknown): unknown => {
    if (typeof original === "number") {
      const n = Number(formValue);
      return Number.isFinite(n) ? n : formValue;
    }
    if (typeof original === "boolean") {
      return formValue === "true" || formValue === "1";
    }
    return formValue;
  };

  const handleSubmit = () => {
    if (!selected) return;

    let resource: ResourceDefinition;

    // ── EDIT MODE ──────────────────────────────────────────────────
    // Merge form values into the original resource. Preserves any
    // properties the form doesn't know about (custom valueType,
    // security descriptors, nested arrays for Group, etc.).
    //
    // Special handling for Microsoft.OSConfig/Test wrappers: we
    // unwrap to the inner resource at bootstrap and edit that. On
    // submit, the inner resource is rebuilt from form values and
    // then re-wrapped into the original Test envelope (preserving
    // `properties.schema` verbatim).
    if (isEdit && initialResource) {
      const baseName = (editName || initialResource.name || "Resource").trim() || "Resource";
      // Effective source = inner resource if Test-wrapped, else the
      // outer initialResource. Edit-form fields target the effective
      // resource's properties + compliance.
      const isTest = testWrapperOriginal !== null;
      const effectiveSource: ResourceDefinition = isTest
        ? {
            name: baseName,
            type: selected.type,
            properties: (((initialResource.properties ?? {}) as Record<string, unknown>).resource as
              | Record<string, unknown>
              | undefined) ? ((((initialResource.properties ?? {}) as Record<string, unknown>).resource as Record<string, unknown>).properties as Record<string, unknown>) ?? {} : {},
            compliance: initialResource.compliance,
          }
        : initialResource;
      const origProps = (effectiveSource.properties ?? {}) as Record<string, unknown>;
      let mergedProps: Record<string, unknown> = { ...origProps };
      let compliance = effectiveSource.compliance;

      switch (selected.type) {
        case "Microsoft.Windows/Registry":
          mergedProps = {
            ...mergedProps,
            keyPath: regPath,
            valueName: regName,
            ...(regEnforce !== "" ? { value: coerceLikeOriginal(regEnforce, origProps.value) } : {}),
          };
          compliance = regExpected !== "" ? { equals: coerceLikeOriginal(regExpected, effectiveSource.compliance?.equals) } : undefined;
          break;
        case "Microsoft.Windows/CSP":
          mergedProps = {
            ...mergedProps,
            path: cspUri,
            ...(cspEnforce !== "" ? { value: coerceLikeOriginal(cspEnforce, origProps.value) } : {}),
          };
          compliance = cspExpected !== "" ? { equals: coerceLikeOriginal(cspExpected, effectiveSource.compliance?.equals) } : undefined;
          break;
        case "Microsoft.Windows/AccountPolicy":
          mergedProps = { ...mergedProps, name: apName };
          compliance = apExpected !== "" ? { equals: coerceLikeOriginal(apExpected, effectiveSource.compliance?.equals) } : undefined;
          break;
        case "Microsoft.Windows/AuditPolicy":
          mergedProps = { ...mergedProps, subcategory: auditSubcategory };
          compliance = auditExpected !== "" ? { equals: coerceLikeOriginal(auditExpected, effectiveSource.compliance?.equals) } : undefined;
          break;
        case "Microsoft.Windows/UserRightsAssignment":
          mergedProps = { ...mergedProps, name: uraName };
          compliance = uraExpected !== "" ? { equals: coerceLikeOriginal(uraExpected, effectiveSource.compliance?.equals) } : undefined;
          break;
        case "Linux/FilePermission":
          mergedProps = {
            ...mergedProps,
            path: fpPath,
            ...(fpOwner ? { owner: fpOwner } : {}),
            ...(fpGroup ? { group: fpGroup } : {}),
            ...(fpMode ? { mode: fpMode } : {}),
          };
          break;
        case "Linux/KernelModule":
          mergedProps = { ...mergedProps, name: kmName, loaded: kmLoaded };
          break;
        case "Linux/User":
          mergedProps = {
            ...mergedProps,
            name: luName,
            ...(luGid !== "" ? { gid: coerceLikeOriginal(luGid, origProps.gid) } : {}),
          };
          break;
        case "Microsoft.OSConfig/File":
          mergedProps = {
            ...mergedProps,
            path: filePath,
            ...(fileContent ? { content: fileContent } : {}),
            exists: fileExists,
          };
          break;
        case "Microsoft.OSConfig/FileLine":
          mergedProps = {
            ...mergedProps,
            path: flPath,
            find: flFind,
            ...(flReplace ? { replace: flReplace } : {}),
            append: flAppend,
            ignoreCase: flIgnoreCase,
          };
          break;
        default:
          // Unknown type — keep properties as-is
          break;
      }

      if (isTest) {
        // Re-wrap into Microsoft.OSConfig/Test, preserving schema.
        const outerProps = ((initialResource.properties ?? {}) as Record<string, unknown>);
        const innerOrig = (outerProps.resource ?? {}) as Record<string, unknown>;
        const rebuiltInner: Record<string, unknown> = {
          ...innerOrig,
          type: selected.type,
          properties: mergedProps,
        };
        if (compliance !== undefined) {
          (rebuiltInner as { compliance?: unknown }).compliance = compliance;
        } else {
          delete (rebuiltInner as { compliance?: unknown }).compliance;
        }
        const rebuiltOuter: ResourceDefinition = {
          ...initialResource,
          name: baseName,
          type: "Microsoft.OSConfig/Test",
          properties: { ...outerProps, resource: rebuiltInner },
        };
        onSelect(rebuiltOuter);
        return;
      }

      const merged: ResourceDefinition = {
        ...initialResource,
        name: baseName,
        type: initialResource.type,
        properties: mergedProps,
      };
      if (compliance !== undefined) {
        merged.compliance = compliance;
      } else {
        delete (merged as { compliance?: unknown }).compliance;
      }
      onSelect(merged);
      return;
    }

    // ── ADD MODE ───────────────────────────────────────────────────
    switch (selected.type) {
      case "Microsoft.Windows/Registry":
        resource = {
          name: regName || "RegistrySetting",
          type: selected.type,
          properties: {
            keyPath: regPath,
            valueName: regName,
            valueType: "Dword",
            ...(regEnforce ? { value: parseInt(regEnforce as string, 10) || regEnforce } : {}),
          },
          ...(regExpected ? { compliance: { equals: regExpected } } : {}),
        };
        break;
      case "Microsoft.Windows/CSP":
        resource = {
          name: cspUri.split("/").pop() || "CSPSetting",
          type: selected.type,
          properties: {
            path: cspUri,
            type: "integer",
            ...(cspEnforce ? { value: parseInt(cspEnforce as string, 10) || cspEnforce } : {}),
          },
          ...(cspExpected ? { compliance: { equals: cspExpected } } : {}),
        };
        break;
      case "Microsoft.Windows/AccountPolicy":
        resource = {
          name: apName || "AccountPolicySetting",
          type: selected.type,
          properties: { name: apName },
          ...(apExpected ? { compliance: { equals: apExpected } } : {}),
        };
        break;
      case "Microsoft.Windows/AuditPolicy":
        resource = {
          name: auditSubcategory || "AuditPolicySetting",
          type: selected.type,
          properties: { subcategory: auditSubcategory },
          ...(auditExpected ? { compliance: { equals: auditExpected } } : {}),
        };
        break;
      case "Microsoft.Windows/UserRightsAssignment":
        resource = {
          name: uraName || "UserRightsSetting",
          type: selected.type,
          properties: { name: uraName },
          ...(uraExpected ? { compliance: { equals: uraExpected } } : {}),
        };
        break;
      case "Linux/FilePermission":
        resource = {
          name: fpPath.split("/").pop() || "FilePermission",
          type: selected.type,
          properties: {
            path: fpPath,
            ...(fpOwner ? { owner: fpOwner } : {}),
            ...(fpGroup ? { group: fpGroup } : {}),
            ...(fpMode ? { mode: fpMode } : {}),
          },
        };
        break;
      case "Linux/KernelModule":
        resource = {
          name: kmName || "KernelModule",
          type: selected.type,
          properties: { name: kmName, loaded: kmLoaded },
        };
        break;
      case "Linux/User":
        resource = {
          name: luName || "LinuxUser",
          type: selected.type,
          properties: {
            name: luName,
            ...(luGid ? { gid: parseInt(luGid, 10) || luGid } : {}),
          },
        };
        break;
      case "Microsoft.OSConfig/File":
        resource = {
          name: filePath.split("/").pop() || "FileSetting",
          type: selected.type,
          properties: {
            path: filePath,
            ...(fileContent ? { content: fileContent } : {}),
            exists: fileExists,
          },
        };
        break;
      case "Microsoft.OSConfig/FileLine":
        resource = {
          name: flFind || "FileLineSetting",
          type: selected.type,
          properties: {
            path: flPath,
            find: flFind,
            ...(flReplace ? { replace: flReplace } : {}),
            append: flAppend,
            ignoreCase: flIgnoreCase,
          },
        };
        break;
      case "Microsoft.OSConfig/Group":
        resource = {
          name: selected.label || "ResourceGroup",
          type: selected.type,
          properties: {
            resources: [],
          },
        };
        break;
      default:
        // Should not happen since excluded types are filtered out
        resource = {
          name: selected.label,
          type: selected.type,
          properties: {},
        };
        break;
    }

    onSelect(resource);
    reset();
  };

  // Filter resource types based on platform and exclude read-only/complex types
  const visibleTypes = ALL_RESOURCE_TYPES.filter((rt) => {
    if (EXCLUDED_TYPES.has(rt.type)) return false;
    if (!platform) return true;
    if (rt.platform === "cross-platform") return true;
    return rt.platform === platform;
  }).filter((rt) => {
    // v0.3.0 (#13): case-insensitive match against type identifier
    // and human-readable label so the user can find either way.
    if (!typeSearch.trim()) return true;
    const q = typeSearch.trim().toLowerCase();
    return (
      rt.type.toLowerCase().includes(q) ||
      (rt.label?.toLowerCase().includes(q) ?? false) ||
      (rt.description?.toLowerCase().includes(q) ?? false)
    );
  });

  // ── Edit-mode header (Resource Name field + context line) ──────────────
  // Declared HERE (before yamlFallbackPanel and the per-type form renders)
  // so the closure inside yamlFallbackPanel can read it without hitting
  // a TDZ ReferenceError when the early-return calls it.
  const editHeader = isEdit ? (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
      <div className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300">
        Editing setting
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Setting Name (display)</span>
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="MyRegistrySetting"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
      </label>
    </div>
  ) : null;

  // Submit handler for the YAML fallback editor (Microsoft.OSConfig/Test,
  // Group, and unrecognized types). Parses the YAML, validates that the
  // top-level is an object with name + type, then emits the full resource.
  const submitYamlEdit = () => {
    let parsed: unknown;
    try {
      parsed = yaml.load(yamlEditText);
    } catch (err) {
      setYamlEditError(err instanceof Error ? err.message : "Invalid YAML");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setYamlEditError("Resource must be a YAML object (key/value at top level).");
      return;
    }
    const obj = parsed as Record<string, unknown>;
    const name = obj.name ?? obj.Name;
    if (!name || typeof name !== "string" || !name.trim()) {
      setYamlEditError("Resource must have a non-empty `name`.");
      return;
    }
    const type = obj.type ?? obj.Type;
    if (!type || typeof type !== "string" || !type.trim()) {
      setYamlEditError("Resource must have a non-empty `type`.");
      return;
    }
    setYamlEditError(null);
    onSelect(obj as unknown as ResourceDefinition);
  };

  const yamlFallbackPanel = (typeLabel: string) => (
    <div className="space-y-3">
      {editHeader}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-200">{typeLabel}</h3>
        <p className="text-xs text-slate-400">
          This setting type doesn&apos;t have a per-field form. Edit the full setting
          as YAML below — including nested properties, schema, or wrapped inner
          settings. Required fields: <code>name</code>, <code>type</code>.
        </p>
      </div>
      <textarea
        value={yamlEditText}
        onChange={(e) => setYamlEditText(e.target.value)}
        rows={16}
        spellCheck={false}
        className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      />
      {yamlEditError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
          {yamlEditError}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        )}
        <button
          onClick={submitYamlEdit}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          {isEdit ? "Save changes" : "Add Setting"}
        </button>
      </div>
    </div>
  );

  // ── Type selection cards (add mode only) ────────────────────────────────
  if (!selected) {
    // Edit mode with no matching type option = type isn't in ALL_RESOURCE_TYPES.
    // Render the YAML fallback editor so the user can still edit the resource.
    if (isEdit && initialResource) {
      return yamlFallbackPanel(`Edit ${initialResource.type}`);
    }
    return (
      <div className="space-y-3">
        <input
          type="search"
          value={typeSearch}
          onChange={(e) => setTypeSearch(e.target.value)}
          placeholder="Search setting types…"
          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleTypes.length === 0 && (
            <div className="col-span-full py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No setting types match &ldquo;{typeSearch}&rdquo;.
            </div>
          )}
          {visibleTypes.map((rt) => {
          const Icon = rt.icon;
          return (
            <button
              key={rt.type}
              onClick={() => setSelected(rt)}
              className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800"
            >
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                  <Icon size={20} />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                    {rt.label}
                  </span>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${PLATFORM_BADGE_STYLES[rt.platform]}`}>
                  {rt.platform === "windows" && <WindowsLogo className="h-3 w-3" />}
                  {PLATFORM_BADGE_LABEL[rt.platform]}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">{rt.description}</p>
              <code className="mt-1 break-all text-[11px] text-slate-500 dark:text-slate-500">{rt.type}</code>
            </button>
          );
        })}
        </div>
      </div>
    );
  }

  // Edit mode + type doesn't have a per-field form (Group, exotic types):
  // render the YAML fallback so the user can still edit the resource.
  // Test wrappers were already unwrapped in bootstrap so they take the
  // inner type's per-field form below.
  if (isEdit && !TYPES_WITH_FORM.has(selected.type)) {
    return yamlFallbackPanel(`Edit ${initialResource?.type ?? selected.label}`);
  }

  // In add mode this is "Back" → return to type grid.
  // In edit mode it's hidden (selection is locked to the original type),
  // a Cancel button is rendered by the submit row instead.
  const backButton = isEdit ? null : (
    <button
      onClick={reset}
      className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
    >
      <ArrowLeftRegular size={14} /> Back
    </button>
  );

  const inputClass =
    "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";

  const submitButton = (disabled: boolean) => (
    <div className="flex justify-end gap-2">
      {isEdit && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      )}
      <button
        onClick={handleSubmit}
        disabled={disabled}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
      >
        {isEdit ? "Save changes" : "Add Setting"}
      </button>
    </div>
  );

  // ── Registry form ──────────────────────────────────────────────────────
  if (selected.type === "Microsoft.Windows/Registry") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">Registry Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Registry Path</span>
          <input type="text" value={regPath} onChange={(e) => setRegPath(e.target.value)} placeholder="HKLM:\SOFTWARE\..." className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Value Name</span>
          <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="ValueName" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Expected Value (compliance)</span>
          <input type="text" value={regExpected} onChange={(e) => setRegExpected(e.target.value)} placeholder="0" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Enforcement Value</span>
          <input type="text" value={regEnforce} onChange={(e) => setRegEnforce(e.target.value)} placeholder="0" className={inputClass} />
        </label>
        {submitButton(!regPath || !regName)}
      </div>
    );
  }

  // ── CSP form ───────────────────────────────────────────────────────────
  if (selected.type === "Microsoft.Windows/CSP") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">CSP Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">OMA-URI Path</span>
          <input type="text" value={cspUri} onChange={(e) => setCspUri(e.target.value)} placeholder="./Device/Vendor/MSFT/..." className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Expected Value (compliance)</span>
          <input type="text" value={cspExpected} onChange={(e) => setCspExpected(e.target.value)} placeholder="1" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Enforcement Value</span>
          <input type="text" value={cspEnforce} onChange={(e) => setCspEnforce(e.target.value)} placeholder="1" className={inputClass} />
        </label>
        {submitButton(!cspUri)}
      </div>
    );
  }

  // ── AccountPolicy form ────────────────────────────────────────────────
  if (selected.type === "Microsoft.Windows/AccountPolicy") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">Account Policy Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Policy Name</span>
          <input type="text" value={apName} onChange={(e) => setApName(e.target.value)} placeholder="MinimumPasswordLength" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Expected Value (compliance)</span>
          <input type="text" value={apExpected} onChange={(e) => setApExpected(e.target.value)} placeholder="14" className={inputClass} />
        </label>
        {submitButton(!apName)}
      </div>
    );
  }

  // ── AuditPolicy form ──────────────────────────────────────────────────
  if (selected.type === "Microsoft.Windows/AuditPolicy") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">Audit Policy Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Subcategory</span>
          <input type="text" value={auditSubcategory} onChange={(e) => setAuditSubcategory(e.target.value)} placeholder="Logon" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Expected Value (compliance)</span>
          <input type="text" value={auditExpected} onChange={(e) => setAuditExpected(e.target.value)} placeholder="Success and Failure" className={inputClass} />
        </label>
        {submitButton(!auditSubcategory)}
      </div>
    );
  }

  // ── UserRightsAssignment form ─────────────────────────────────────────
  if (selected.type === "Microsoft.Windows/UserRightsAssignment") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">User Rights Assignment Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Right Name</span>
          <input type="text" value={uraName} onChange={(e) => setUraName(e.target.value)} placeholder="SeRemoteInteractiveLogonRight" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Expected Value (compliance)</span>
          <input type="text" value={uraExpected} onChange={(e) => setUraExpected(e.target.value)} placeholder="Administrators" className={inputClass} />
        </label>
        {submitButton(!uraName)}
      </div>
    );
  }

  // ── FilePermission form (Linux) ───────────────────────────────────────
  if (selected.type === "Linux/FilePermission") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">File Permission Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Path</span>
          <input type="text" value={fpPath} onChange={(e) => setFpPath(e.target.value)} placeholder="/etc/ssh/sshd_config" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Owner</span>
          <input type="text" value={fpOwner} onChange={(e) => setFpOwner(e.target.value)} placeholder="root" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Group</span>
          <input type="text" value={fpGroup} onChange={(e) => setFpGroup(e.target.value)} placeholder="root" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Mode</span>
          <input type="text" value={fpMode} onChange={(e) => setFpMode(e.target.value)} placeholder="0600" className={inputClass} />
        </label>
        {submitButton(!fpPath)}
      </div>
    );
  }

  // ── KernelModule form (Linux) ─────────────────────────────────────────
  if (selected.type === "Linux/KernelModule") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">Kernel Module Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Module Name</span>
          <input type="text" value={kmName} onChange={(e) => setKmName(e.target.value)} placeholder="usb-storage" className={inputClass} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={kmLoaded} onChange={(e) => setKmLoaded(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-blue-500" />
          <span className="text-xs text-slate-400">Loaded</span>
        </label>
        {submitButton(!kmName)}
      </div>
    );
  }

  // ── User form (Linux) ─────────────────────────────────────────────────
  if (selected.type === "Linux/User") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">User Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Username</span>
          <input type="text" value={luName} onChange={(e) => setLuName(e.target.value)} placeholder="sshd" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">GID</span>
          <input type="text" value={luGid} onChange={(e) => setLuGid(e.target.value)} placeholder="65534" className={inputClass} />
        </label>
        {submitButton(!luName)}
      </div>
    );
  }

  // ── File form (cross-platform) ────────────────────────────────────────
  if (selected.type === "Microsoft.OSConfig/File") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">File Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Path</span>
          <input type="text" value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="/etc/motd" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Content</span>
          <textarea value={fileContent} onChange={(e) => setFileContent(e.target.value)} placeholder="File content..." rows={3} className={inputClass} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={fileExists} onChange={(e) => setFileExists(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-blue-500" />
          <span className="text-xs text-slate-400">File should exist</span>
        </label>
        {submitButton(!filePath)}
      </div>
    );
  }

  // ── FileLine form (cross-platform) ────────────────────────────────────
  if (selected.type === "Microsoft.OSConfig/FileLine") {
    return (
      <div className="space-y-4">
        {backButton}        {editHeader}
        <h3 className="text-sm font-semibold text-slate-200">File Line Setting</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Path</span>
          <input type="text" value={flPath} onChange={(e) => setFlPath(e.target.value)} placeholder="/etc/sysctl.conf" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Find</span>
          <input type="text" value={flFind} onChange={(e) => setFlFind(e.target.value)} placeholder="net.ipv4.ip_forward" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Replace</span>
          <input type="text" value={flReplace} onChange={(e) => setFlReplace(e.target.value)} placeholder="net.ipv4.ip_forward = 0" className={inputClass} />
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={flAppend} onChange={(e) => setFlAppend(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-blue-500" />
            <span className="text-xs text-slate-400">Append if not found</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={flIgnoreCase} onChange={(e) => setFlIgnoreCase(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-blue-500" />
            <span className="text-xs text-slate-400">Ignore case</span>
          </label>
        </div>
        {submitButton(!flPath || !flFind)}
      </div>
    );
  }

  // ── Generic fallback form ─────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {backButton}
      {editHeader}
      <h3 className="text-sm font-semibold text-slate-200">{selected.label} Setting</h3>
      <p className="text-xs text-slate-400">This setting type does not have a custom form. It will be added with an empty properties block.</p>
      {submitButton(false)}
    </div>
  );
}
