import { describe, expect, it } from 'vitest';
import { Rational as R } from './rational';
import { convertUnit, isUnit, validateQuantity } from './quantity';
import type { QuantityBasis, Unit } from './quantity';
import { convertQuantity, normalizeQuantity } from './conversion';
import type { Conversion, ConversionStep } from './conversion';

function basis(unit: Unit, state = 'raw', product = 'rice', definition = 'edible'): QuantityBasis {
  return { ref: { id: `basis-${product}-${state}-${unit}-${definition}`, recordVersion: '1' },
    productRef: { id: product, recordVersion: '1' }, stateRef: { id: `${product}-${state}`, recordVersion: '1' },
    dimension: unit === 'pcs' ? 'count' : unit === 'g' || unit === 'kg' ? 'mass' : 'volume', unit, definition };
}
const g = basis('g');
const kg = basis('kg');
const ml = basis('ml');
const l = basis('l');
const pcs = basis('pcs');
const evidence = [{ id: 'measurement', recordVersion: '1' }];

function conversion(from: QuantityBasis, to: QuantityBasis, factor: R): Conversion {
  return { ref: { id: `conversion-${from.unit}-${to.unit}`, recordVersion: '1' }, from, to, factor,
    method: 'Confirmed measurement for these bases and state', sourceRefs: evidence,
    checkedOn: '2026-10-14', checkedBy: 'S1-CHECKS-v1',
    applicability: { conditions: 'Specified edible part and product state', fromRange: null } };
}
function step(c: Conversion, direction: 'forward' | 'reverse' = 'forward'): ConversionStep {
  return { conversion: c, direction, confirmation: { kind: 'confirmed', evidenceRefs: evidence } };
}

describe('quantity input constraints', () => {
  it.each([
    [R.of(0n), 'g', 'ingredient', 'QUANTITY_SIGN'], [R.of(-1n), 'g', 'stock', 'QUANTITY_SIGN'],
    [R.of(1n, 2000n), 'g', 'ingredient', 'QUANTITY_STEP'],
    [R.of(1n, 2000n), 'pcs', 'stock', 'QUANTITY_STEP'],
    [R.of(1n, 10000000n), 'kg', 'stock', 'QUANTITY_STEP'],
    [R.of(1n), 'oz', 'stock', 'UNIT_UNSUPPORTED'], [R.of(1n), undefined, 'ingredient', 'UNIT_UNSUPPORTED'],
    [R.of(1n), '__proto__', 'stock', 'UNIT_UNSUPPORTED'],
  ] as const)('rejects %s %s for %s', (value, unit, usage, reason) => {
    expect(validateQuantity(value, unit, usage)).toEqual({ kind: 'invalid', reason });
  });

  it.each([
    [R.of(0n), 'g', 'stock'], [R.of(1n, 1000n), 'g', 'ingredient'],
    [R.of(1n, 1000000n), 'kg', 'ingredient'], [R.of(1n, 1000000n), 'l', 'ingredient'],
    [R.of(1n, 2n), 'pcs', 'stock'], [R.of(9007199254740993000000000000000000n), 'ml', 'stock'],
  ] as const)('accepts a valid exact amount %s %s', (value, unit, usage) => {
    expect(validateQuantity(value, unit, usage)).toEqual({ kind: 'valid', value, unit });
  });

  it('accepts only the five units', () => {
    expect(['g', 'kg', 'ml', 'l', 'pcs'].every(isUnit)).toBe(true);
    expect(isUnit('constructor')).toBe(false);
    expect(isUnit(null)).toBe(false);
  });
});

describe('exact units and evidence-bound conversion (F03, U01–U04)', () => {
  it.each([[g, kg], [ml, l]] as const)('U01: normalizes 0.5 large units and preserves the source', (small, large) => {
    const original = { value: R.of(1n, 2n), basis: large };
    const normalized = normalizeQuantity(original, small);
    expect(normalized.kind).toBe('available');
    if (normalized.kind !== 'available') throw new Error('Expected exact normalization');
    expect(normalized.original).toBe(original);
    expect(normalized.value.value).toEqual({ n: 500n, d: 1n });
    // Numerical projection only: combining physical entries belongs to S1-09.
    const sum = normalized.value.value.add(R.of(500n));
    expect(sum).toEqual({ n: 1000n, d: 1n });
    expect(convertUnit(sum, small.unit, large.unit)).toEqual({ n: 1n, d: 1n });
    expect(original.value).toEqual({ n: 1n, d: 2n });
  });

  it('F03: a confirmed 3 g/piece returns exactly from one third, without display feedback', () => {
    const c = conversion(pcs, g, R.of(3n));
    const original = { value: R.of(1n), basis: g };
    const third = convertQuantity(original, pcs, [step(c, 'reverse')]);
    if (third.kind !== 'available') throw new Error('Expected confirmed reverse conversion');
    expect(third.value.value).toEqual({ n: 1n, d: 3n });
    const back = convertQuantity(third.value, g, [step(c)]);
    if (back.kind !== 'available') throw new Error('Expected forward conversion');
    expect(back.value.value).toEqual({ n: 1n, d: 1n });
    expect(third.value.value.compare(R.of(333n, 1000n))).toBe(1);
  });

  it('U04: one piece stays separate without mass evidence; confirmed 50 g/piece converts exactly', () => {
    const original = { value: R.of(1n), basis: pcs };
    const missing = convertQuantity(original, g);
    expect(missing.kind).toBe('unavailable');
    if (missing.kind !== 'unavailable') throw new Error('Expected refusal');
    expect(missing.original).toBe(original);
    expect(missing.reasons[0].code).toBe('CONVERSION_MISSING');
    expect(missing.reasons[0].details.fromBasisRef).toEqual(pcs.ref);
    const available = convertQuantity(original, g, [step(conversion(pcs, g, R.of(50n)))]);
    if (available.kind !== 'available') throw new Error('Expected conversion');
    expect(available.value.value).toEqual({ n: 50n, d: 1n });
  });

  it('U02/U03: no implicit change of state or mass/volume equivalence', () => {
    const cooked = { value: R.of(200n), basis: basis('g', 'cooked') };
    const mismatch = convertQuantity(cooked, g);
    expect(mismatch.kind).toBe('unavailable');
    if (mismatch.kind !== 'unavailable') throw new Error('Expected state refusal');
    expect(mismatch.reasons[0].code).toBe('STOCK_STATE_INCOMPATIBLE');
    expect(mismatch.original).toBe(cooked);
    expect(convertQuantity({ value: R.of(100n), basis: ml }, g).kind).toBe('unavailable');
    expect(() => convertUnit(R.of(100n), 'ml', 'g')).toThrow('CONVERSION_REQUIRES_EVIDENCE');
  });

  it('checks the precise product, state, basis version and piece definition', () => {
    const c = conversion(pcs, g, R.of(50n));
    for (const source of [basis('pcs', 'raw', 'egg'), basis('pcs', 'cooked'), basis('pcs', 'raw', 'rice', 'large'),
      { ...pcs, ref: { ...pcs.ref, recordVersion: '2' } },
      { ...pcs, productRef: { ...pcs.productRef, recordVersion: '2' } }]) {
      expect(convertQuantity({ value: R.of(1n), basis: source }, g, [step(c)]).kind).toBe('unavailable');
    }
    expect(convertQuantity({ value: R.of(1n), basis: pcs }, basis('pcs', 'raw', 'rice', 'large')).kind).toBe('unavailable');
    expect(convertQuantity({ value: R.of(1n), basis: g }, basis('g', 'raw', 'egg')).kind).toBe('unavailable');
  });

  it('refuses unconfirmed, directionally wrong, invalid and unsupported coefficients', () => {
    const c = conversion(pcs, g, R.of(50n));
    const original = { value: R.of(1n), basis: pcs };
    const bad: ConversionStep[] = [
      { ...step(c), confirmation: { kind: 'unconfirmed' } },
      { ...step(c), confirmation: { kind: 'confirmed', evidenceRefs: [] } },
      step(c, 'reverse'), step({ ...c, factor: R.of(0n) }), step({ ...c, factor: R.of(-1n) }),
      step({ ...c, sourceRefs: [] }), step({ ...c, method: '' }), step({ ...c, checkedOn: '' }),
      step({ ...c, to: basis('g', 'raw', 'egg') }),
    ];
    for (const invalid of bad) {
      const result = convertQuantity(original, g, [invalid]);
      expect(result.kind).toBe('unavailable');
      expect(result.original).toBe(original);
    }
    // A forward record does not authorize an implicit inverse.
    expect(convertQuantity({ value: R.of(50n), basis: g }, pcs, [step(c)]).kind).toBe('unavailable');
  });

  it('checks confirmed range bounds exactly in the original coefficient direction', () => {
    const c = { ...conversion(pcs, g, R.of(3n)), applicability: { conditions: 'Measured range',
      fromRange: { min: R.of(1n, 3n), max: R.of(2n), minInclusive: true, maxInclusive: false } } };
    expect(convertQuantity({ value: R.of(1n), basis: g }, pcs, [step(c, 'reverse')]).kind).toBe('available');
    expect(convertQuantity({ value: R.of(6n), basis: g }, pcs, [step(c, 'reverse')]).kind).toBe('unavailable');
    expect(convertQuantity({ value: R.of(999999n, 1000000n), basis: g }, pcs, [step(c, 'reverse')]).kind).toBe('unavailable');
  });

  it('uses a selected chain once and preserves all conversion evidence', () => {
    const steps = [step(conversion(pcs, g, R.of(50n))), step(conversion(g, ml, R.of(5n, 4n)))];
    const original = { value: R.of(1n), basis: pcs };
    const result = convertQuantity(original, ml, steps);
    if (result.kind !== 'available') throw new Error('Expected chain');
    expect(result.value.value).toEqual({ n: 125n, d: 2n });
    expect(result.steps).toEqual(steps);
    expect(result.original).toBe(original);
    expect(original.value).toEqual({ n: 1n, d: 1n });
  });

  it('keeps the source precision of a density without applying the quantity input step', () => {
    const ordinary = convertQuantity({ value: R.of(200n), basis: ml }, g,
      [step(conversion(ml, g, R.of(4n, 5n)))]);
    if (ordinary.kind !== 'available') throw new Error('Expected density conversion');
    expect(ordinary.value.value).toEqual({ n: 160n, d: 1n });
    const precise = convertQuantity({ value: R.of(200n), basis: ml }, g,
      [step(conversion(ml, g, R.of(8000000001n, 10000000000n)))]);
    if (precise.kind !== 'available') throw new Error('Expected precise density conversion');
    expect(precise.value.value).toEqual({ n: 8000000001n, d: 50000000n });
  });

  it('requires a method for a confirmed state change and does not infer its inverse', () => {
    const cooked = basis('g', 'cooked');
    const c = conversion(g, cooked, R.of(3n));
    const original = { value: R.of(100n), basis: g };
    const result = convertQuantity(original, cooked, [step(c)]);
    if (result.kind !== 'available') throw new Error('Expected explicit state conversion');
    expect(result.value.value).toEqual({ n: 300n, d: 1n });
    expect(convertQuantity(result.value, g).kind).toBe('unavailable');
    expect(convertQuantity(original, cooked, [step({ ...c, method: '' })]).kind).toBe('unavailable');
  });
});
