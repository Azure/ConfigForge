// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import yaml, { type DumpOptions } from 'js-yaml';

// Renderer code imports this module directly. Keep it browser-safe: no
// node:crypto, node:buffer, or filesystem dependencies.
export const YAML_INTEGER_PATTERN =
  /^[+-]?(?:[0-9]+|0b[01]+|0o[0-7]+|0x[0-9a-fA-F]+)$/;

function constructLosslessInteger(source: string): number | bigint {
  const negative = source.startsWith('-');
  const unsigned = source.startsWith('-') || source.startsWith('+') ? source.slice(1) : source;
  const integer = BigInt(unsigned) * (negative ? -1n : 1n);
  return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(integer)
    : integer;
}

const LOSSLESS_INTEGER_TYPE = new yaml.Type('tag:yaml.org,2002:int', {
  kind: 'scalar',
  resolve: (value: unknown) => typeof value === 'string' && YAML_INTEGER_PATTERN.test(value),
  construct: (value: string) => constructLosslessInteger(value),
  predicate: (value: unknown) =>
    typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value)),
  represent: (value: unknown) => String(value),
});

export const LOSSLESS_MANIFEST_SCHEMA = yaml.DEFAULT_SCHEMA.extend({
  implicit: [LOSSLESS_INTEGER_TYPE],
});

export function parseLosslessYaml(source: string): unknown {
  return yaml.load(source, { schema: LOSSLESS_MANIFEST_SCHEMA });
}

export function dumpLosslessYaml(document: unknown, options: DumpOptions = {}): string {
  return yaml.dump(document, {
    ...options,
    schema: LOSSLESS_MANIFEST_SCHEMA,
  });
}

const BIGINT_JSON_MARKER_STEM = 'CONFIGFORGE_BIGINT_';
const JSON_NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const MAX_STRINGIFY_MARKER_ATTEMPTS = 32;

function markerForIndex(index: number): string {
  return index === 0
    ? `\u0000${BIGINT_JSON_MARKER_STEM}`
    : `\u0000${BIGINT_JSON_MARKER_STEM}${index}_`;
}

function parseCanonicalArrayIndex(source: string): number | null {
  if (!/^(?:0|[1-9][0-9]*)$/.test(source)) return null;
  const index = Number(source);
  return Number.isSafeInteger(index) ? index : null;
}

function forEachDecodedJsonString(
  source: string,
  callback: (value: string) => void,
): void {
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '"') continue;
    const start = index;
    let escaped = false;
    for (index += 1; index < source.length; index += 1) {
      const character = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character !== '"') continue;
      try {
        const value = JSON.parse(source.slice(start, index + 1)) as unknown;
        if (typeof value === 'string') callback(value);
      } catch {
        // The full JSON parse below owns syntax errors. This scan only
        // selects a collision-free placeholder for otherwise-valid input.
      }
      break;
    }
  }
}

function selectParseMarker(source: string): string {
  let baseMarkerBlocked = false;
  const blockedIndexes = new Set<number>();
  forEachDecodedJsonString(source, (candidate) => {
    if (!candidate.startsWith(markerForIndex(0))) return;
    baseMarkerBlocked = true;

    const suffix = candidate.slice(markerForIndex(0).length);
    const separator = suffix.indexOf('_');
    if (separator <= 0) return;
    const markerIndex = parseCanonicalArrayIndex(suffix.slice(0, separator));
    if (markerIndex !== null && markerIndex > 0) blockedIndexes.add(markerIndex);
  });

  if (!baseMarkerBlocked) return markerForIndex(0);
  for (let index = 1; ; index += 1) {
    if (!blockedIndexes.has(index)) return markerForIndex(index);
  }
}

function collectBlockedStringifyMarkers(
  observedStrings: ReadonlySet<string>,
  bigintCount: number,
): Set<number> {
  const blockedIndexes = new Set<number>();
  const baseMarker = markerForIndex(0);

  for (const candidate of observedStrings) {
    if (!candidate.startsWith(baseMarker)) continue;
    const suffix = candidate.slice(baseMarker.length);

    const baseValueIndex = parseCanonicalArrayIndex(suffix);
    if (baseValueIndex !== null && baseValueIndex < bigintCount) {
      blockedIndexes.add(0);
      continue;
    }

    const separator = suffix.indexOf('_');
    if (separator <= 0) continue;
    const markerIndex = parseCanonicalArrayIndex(suffix.slice(0, separator));
    const valueIndex = parseCanonicalArrayIndex(suffix.slice(separator + 1));
    if (
      markerIndex !== null &&
      markerIndex > 0 &&
      valueIndex !== null &&
      valueIndex < bigintCount
    ) {
      blockedIndexes.add(markerIndex);
    }
  }

  return blockedIndexes;
}

function replaceBigintPlaceholders(
  serialized: string,
  marker: string,
  bigintValues: readonly string[],
): string | null {
  const encodedMarkerPrefix = JSON.stringify(marker).slice(0, -1);
  const occurrenceCounts = new Array<number>(bigintValues.length).fill(0);
  const chunks: string[] = [];
  let copiedThrough = 0;
  let searchFrom = 0;

  while (searchFrom < serialized.length) {
    const markerStart = serialized.indexOf(encodedMarkerPrefix, searchFrom);
    if (markerStart === -1) break;

    const indexStart = markerStart + encodedMarkerPrefix.length;
    let indexEnd = indexStart;
    while (
      indexEnd < serialized.length &&
      serialized[indexEnd] >= '0' &&
      serialized[indexEnd] <= '9'
    ) {
      indexEnd += 1;
    }

    const indexText = serialized.slice(indexStart, indexEnd);
    const valueIndex =
      serialized[indexEnd] === '"' ? parseCanonicalArrayIndex(indexText) : null;
    if (valueIndex === null || valueIndex >= bigintValues.length) {
      searchFrom = indexStart;
      continue;
    }

    occurrenceCounts[valueIndex] += 1;
    chunks.push(serialized.slice(copiedThrough, markerStart), bigintValues[valueIndex]);
    copiedThrough = indexEnd + 1;
    searchFrom = copiedThrough;
  }

  if (occurrenceCounts.some((count) => count !== 1)) return null;
  chunks.push(serialized.slice(copiedThrough));
  return chunks.join('');
}

/**
 * JSON.stringify-compatible serializer that emits bigint values as exact JSON
 * integer tokens instead of rounding them or throwing.
 */
export function stringifyLosslessJson(value: unknown, space?: string | number): string | undefined {
  let markerIndex = 0;
  for (let attempt = 0; attempt < MAX_STRINGIFY_MARKER_ATTEMPTS; attempt += 1) {
    const marker = markerForIndex(markerIndex);
    const bigintValues: string[] = [];
    const observedStrings = new Set<string>();
    const serialized = JSON.stringify(
      value,
      (key, nestedValue: unknown) => {
        if (key) observedStrings.add(key);
        if (typeof nestedValue === 'bigint') {
          const index = bigintValues.push(nestedValue.toString()) - 1;
          return `${marker}${index}`;
        }
        if (typeof nestedValue === 'string') observedStrings.add(nestedValue);
        return nestedValue;
      },
      space,
    );
    if (serialized === undefined || bigintValues.length === 0) return serialized;

    const output = replaceBigintPlaceholders(serialized, marker, bigintValues);
    if (output !== null) return output;

    // A literal string or key can equal a placeholder, including one created
    // by toJSON(). Skip all markers observed in this final JSON shape rather
    // than rescanning the full payload once per candidate.
    const blockedIndexes = collectBlockedStringifyMarkers(
      observedStrings,
      bigintValues.length,
    );
    blockedIndexes.add(markerIndex);
    markerIndex = 0;
    while (blockedIndexes.has(markerIndex)) markerIndex += 1;
  }

  throw new TypeError('Unable to select a collision-free bigint JSON marker');
}

function maskUnsafeJsonIntegers(source: string, marker: string): string {
  let masked = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      masked += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      masked += character;
      continue;
    }

    if (character === '-' || (character >= '0' && character <= '9')) {
      JSON_NUMBER_PATTERN.lastIndex = index;
      const match = JSON_NUMBER_PATTERN.exec(source)?.[0];
      if (match) {
        if (!/[.eE]/.test(match)) {
          const integer = BigInt(match);
          if (
            integer < BigInt(Number.MIN_SAFE_INTEGER) ||
            integer > BigInt(Number.MAX_SAFE_INTEGER)
          ) {
            masked += JSON.stringify(`${marker}${match}`);
            index += match.length - 1;
            continue;
          }
        }
        masked += match;
        index += match.length - 1;
        continue;
      }
    }
    masked += character;
  }
  return masked;
}

/**
 * Parse JSON without rounding integer tokens outside JavaScript's safe range.
 */
export function parseLosslessJson(source: string): unknown {
  const marker = selectParseMarker(source);
  return JSON.parse(maskUnsafeJsonIntegers(source, marker), (_key, value: unknown) => {
    if (typeof value === 'string' && value.startsWith(marker)) {
      const integer = value.slice(marker.length);
      if (YAML_INTEGER_PATTERN.test(integer)) return BigInt(integer);
    }
    return value;
  });
}
