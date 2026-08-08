// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import {
  dumpLosslessYaml,
  parseLosslessJson,
  parseLosslessYaml,
  stringifyLosslessJson,
} from './lossless';

describe('lossless manifest serialization', () => {
  it('keeps adjacent unsafe YAML integers distinct', () => {
    const first = parseLosslessYaml('value: 18446744073709551615') as { value: unknown };
    const second = parseLosslessYaml('value: 18446744073709551614') as { value: unknown };

    expect(first.value).toBe(18446744073709551615n);
    expect(second.value).toBe(18446744073709551614n);
    expect(first.value).not.toBe(second.value);
  });

  it('dumps unsafe YAML integers without rounding', () => {
    expect(dumpLosslessYaml({ value: 18446744073709551615n })).toContain(
      '18446744073709551615',
    );
  });

  it('keeps adjacent unsafe JSON integer tokens distinct', () => {
    const parsed = parseLosslessJson(
      '{"desired":18446744073709551615,"actual":18446744073709551614}',
    ) as { desired: unknown; actual: unknown };

    expect(parsed.desired).toBe(18446744073709551615n);
    expect(parsed.actual).toBe(18446744073709551614n);
  });

  it('stringifies bigints as exact JSON integer tokens', () => {
    const serialized = stringifyLosslessJson({ value: 18446744073709551615n });

    expect(serialized).toBe('{"value":18446744073709551615}');
    expect(parseLosslessJson(serialized!)).toEqual({ value: 18446744073709551615n });
  });

  it('renders nested bigint values without throwing or rounding', () => {
    const document = {
      outer: {
        values: [1, { qword: 18446744073709551615n }],
      },
    };

    const serialized = stringifyLosslessJson(document, 2);

    expect(serialized).toContain('"qword": 18446744073709551615');
    expect(parseLosslessJson(serialized!)).toEqual(document);
  });

  it('serializes shared aliases as values rather than circular placeholders', () => {
    const shared = { value: 18446744073709551615n };
    const serialized = stringifyLosslessJson({ first: shared, second: shared });

    expect(parseLosslessJson(serialized!)).toEqual({
      first: { value: 18446744073709551615n },
      second: { value: 18446744073709551615n },
    });
  });

  it('renders true cycles safely while preserving exact bigint values', () => {
    const cyclic: { value: bigint; self?: unknown } = {
      value: 18446744073709551615n,
    };
    cyclic.self = cyclic;

    const serialized = stringifyLosslessJson(cyclic);

    expect(serialized).toBe(
      '{"value":18446744073709551615,"self":"[Circular]"}',
    );
  });

  it('preserves marker-like strings and keys alongside bigints', () => {
    const oldMarker = '\u0000CONFIGFORGE_BIGINT_0';
    const markerLikeKey = '\u0000CONFIGFORGE_BIGINT_1';
    const document = {
      [markerLikeKey]: oldMarker,
      literal: oldMarker,
      qword: 18446744073709551615n,
    };

    const serialized = stringifyLosslessJson(document);

    expect(parseLosslessJson(serialized!)).toEqual(document);
  });

  it('avoids marker strings introduced by toJSON transformations', () => {
    const markerLike = '\u0000CONFIGFORGE_BIGINT_0';
    const document = {
      toJSON: () => ({
        literal: markerLike,
        qword: 18446744073709551615n,
      }),
    };

    const serialized = stringifyLosslessJson(document);

    expect(parseLosslessJson(serialized!)).toEqual({
      literal: markerLike,
      qword: 18446744073709551615n,
    });
  });

  it('skips many colliding marker candidates without changing literal data', () => {
    const baseMarker = '\u0000CONFIGFORGE_BIGINT_';
    const literals = [
      `${baseMarker}0`,
      ...Array.from({ length: 128 }, (_value, index) => `${baseMarker}${index + 1}_0`),
    ];
    const document = {
      literals,
      qwords: Array.from(
        { length: 256 },
        (_value, index) => 18446744073709551615n - BigInt(index),
      ),
    };

    const serialized = stringifyLosslessJson(document);

    expect(parseLosslessJson(serialized!)).toEqual(document);
  });

  it('does not revive a raw JSON string equal to the old fixed marker', () => {
    const oldMarker = '\u0000CONFIGFORGE_BIGINT_0';
    const source =
      '{"literal":"\\u0000CONFIGFORGE_BIGINT_0","qword":18446744073709551615}';

    expect(parseLosslessJson(source)).toEqual({
      literal: oldMarker,
      qword: 18446744073709551615n,
    });
  });

  it('does not revive a marker assembled from JSON unicode escapes', () => {
    const source =
      '{"literal":"\\u0000CONFIGFORGE_\\u0042IGINT_18446744073709551615",' +
      '"qword":18446744073709551615}';

    expect(parseLosslessJson(source)).toEqual({
      literal: '\u0000CONFIGFORGE_BIGINT_18446744073709551615',
      qword: 18446744073709551615n,
    });
  });
});
