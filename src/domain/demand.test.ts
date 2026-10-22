import { describe, expect, it } from 'vitest';
import { Rational as R } from './rational';
import { UNITS } from './quantity';
import type { QuantityBasis, Unit } from './quantity';
import type { ConversionStep } from './conversion';
import { RecipeBaseline, scaleRecipe } from './recipeScale';
import { aggregateDemand, demandKey } from './demand';
import type { DemandMenu, DemandSlot } from './demand';

const ref = (id: string, recordVersion = '1') => ({ id, recordVersion });
function basis(unit: Unit = 'g', product = 'rice', state = 'raw', version = '1'): QuantityBasis {
  return { ref: ref(`${product}-${state}-${unit}`, version), productRef: ref(product, version),
    stateRef: ref(`${product}-${state}`, version), unit, dimension: UNITS[unit].dimension, definition: 'edible product' };
}
function baseline(items: readonly [bigint, QuantityBasis][], b = R.of(1n), perServing = false, recipeId = 'recipe') {
  return RecipeBaseline.fromSource({ recipeRef: ref(recipeId), baseServings: b,
    baseServingsEvidenceRefs: [ref('source')], portionMeaning: 'one serving',
    inputBasis: perServing ? 'per_serving' : 'whole_recipe',
    ingredients: items.map(([n, basis], i) => ({ ingredientId: `i${i}`, quantity: { value: R.of(n), basis } })),
    nutrition: { kcal: R.of(0n), proteinG: R.of(0n), fatG: R.of(0n), carbsG: R.of(0n) }, timeEvidence: [],
  });
}
function slot(items: readonly [bigint, QuantityBasis][], slotId = 'slot', order = 0): DemandSlot {
  return { kind: 'baseline', slotId, order, baseline: baseline(items), people: 1,
    resolutions: items.map(([, b], i) => ({ ingredientId: `i${i}`,
      nativeBasis: { ...b, unit: UNITS[b.unit].baseUnit,
        ref: b.unit === 'pcs' ? b.ref : ref(`${b.stateRef.id}-${UNITS[b.unit].baseUnit}`, b.ref.recordVersion) },
    })),
  };
}
const menu = (...slots: DemandSlot[]): DemandMenu => ({ planId: 'plan', variantId: 'variant', slots });
const totals = (m: DemandMenu) => aggregateDemand(m).lines.map(l => l.required.value);
function step(from: QuantityBasis, to: QuantityBasis, n = 50n): ConversionStep {
  return { conversion: { ref: ref('conversion'), from, to, factor: R.of(n), method: 'measured',
    sourceRefs: [ref('source')], checkedOn: '2026-10-20', checkedBy: 'reviewer',
    applicability: { conditions: 'this product and direction', fromRange: null } },
  direction: 'forward', confirmation: { kind: 'confirmed', evidenceRefs: [ref('evidence')] } };
}

describe('exact menu demand R', () => {
  it('sums one product in different dishes and preserves each origin', () => {
    const a = slot([[200n, basis()]], 'breakfast', 0);
    const b = { ...slot([[350n, basis()]], 'lunch', 1), baseline: baseline([[350n, basis()]], R.of(1n), false, 'other') };
    const result = aggregateDemand(menu(a, b));
    expect(result.lines[0]?.required.value).toEqual(R.of(550n));
    expect(result.lines[0]?.contributions.map(c => [c.slotId, c.ingredientId, c.recipeRef.id, c.scaled.value]))
      .toEqual([['breakfast', 'i0', 'recipe', R.of(200n)], ['lunch', 'i0', 'other', R.of(350n)]]);
  });

  it.each([['g', 'kg'], ['ml', 'l']] as const)('U01: normalizes %s + %s exactly', (small, large) => {
    const input = slot([[500n, basis(small)], [1n, basis(large)]]);
    if (input.kind !== 'baseline') throw new Error('baseline');
    // U01 independent inputs 500 + 0.5*1000 = 1000, scaled H/B = 1/2.
    const scaled = scaleRecipe(baseline([[1000n, basis(small)], [1n, basis(large)]], R.of(2n)), 1);
    const result = aggregateDemand(menu({ ...input, kind: 'scaled', recipe: scaled }));
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.required.value).toEqual(R.of(1000n));
    expect(result.lines[0]?.required.basis.unit).toBe(small);
    expect(result.lines[0]?.contributions[1]?.scaled.basis.unit).toBe(large);
    expect(result.lines[0]?.contributions[1]?.scaled.value).toEqual(R.of(1n, 2n));
  });

  it('keeps products with identical labels and distinct reference versions separate', () => {
    expect(totals(menu(slot([[10n, basis('g', 'one')], [20n, basis('g', 'two')]])))).toEqual([R.of(10n), R.of(20n)]);
    expect(aggregateDemand(menu(slot([[10n, basis()], [20n, basis('g', 'rice', 'raw', '2')]]))).lines).toHaveLength(2);
  });

  it('U02: never sums raw and cooked without a selected transition', () => {
    const result = aggregateDemand(menu(slot([[700n, basis()], [200n, basis('g', 'rice', 'cooked')]])));
    expect(result.lines).toHaveLength(2);
    expect(result.lines.map(l => l.required.value)).toEqual([R.of(200n), R.of(700n)]);
  });

  it('U03: same state with mass and volume remains two known quantities', () => {
    expect(totals(menu(slot([[200n, basis()], [100n, basis('ml')]])))).toEqual([R.of(200n), R.of(100n)]);
  });

  it('U04: preserves concrete pieces without a coefficient; distinct piece definitions stay separate', () => {
    const pcs = basis('pcs');
    const different = { ...pcs, ref: ref('another-piece'), definition: 'another piece' };
    const result = aggregateDemand(menu(slot([[100n, basis()], [1n, pcs], [2n, different]])));
    expect(result.lines).toHaveLength(3);
    expect(result.lines.map(l => l.required.value)).toEqual([R.of(2n), R.of(100n), R.of(1n)]);
  });

  it.each(['confirmed', 'unconfirmed'] as const)('U04: explicitly %s 50 g/pcs', confirmation => {
    const from = basis('pcs');
    const s = slot([[100n, basis()], [1n, from]]);
    const target = s.resolutions[0]!.nativeBasis;
    const selected: ConversionStep = { ...step(from, target), confirmation: confirmation === 'confirmed'
      ? { kind: 'confirmed', evidenceRefs: [ref('evidence')] } : { kind: 'unconfirmed' } };
    const result = aggregateDemand(menu({ ...s, resolutions: [s.resolutions[0]!,
      { ...s.resolutions[1]!, translation: { target, steps: [selected] } }] }));
    if (confirmation === 'confirmed') {
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.required.value).toEqual(R.of(150n));
      expect(result.lines[0]?.contributions[1]?.conversions).toEqual([selected]);
      expect(result.lines[0]?.contributions[1]?.source.value).toEqual(R.of(1n));
    } else {
      expect(result.lines.map(l => l.required.value)).toEqual([R.of(100n), R.of(1n)]);
      const rejected = result.lines.flatMap(l => l.contributions).find(c => c.rejectedTranslation);
      expect(rejected?.conversions).toEqual([]);
      expect(rejected?.rejectedTranslation?.steps).toEqual([selected]);
      expect(rejected?.rejectedTranslation?.reasons[0]?.code).toBe('CONVERSION_MISSING');
    }
  });

  it('uses a selected state chain, rejects wrong direction/range and never searches another path', () => {
    const from = basis();
    const to = basis('g', 'rice', 'cooked');
    const s = slot([[100n, from], [200n, to]]);
    const target = s.resolutions[1]!.nativeBasis;
    const selected = [step(from, to, 3n)];
    const calculate = (steps: readonly ConversionStep[]) => aggregateDemand(menu({ ...s,
      resolutions: [{ ...s.resolutions[0]!, translation: { target, steps } }, s.resolutions[1]!] }));
    expect(calculate(selected).lines[0]?.required.value).toEqual(R.of(500n));
    for (const steps of [[], [{ ...selected[0]!, direction: 'reverse' as const }],
      [{ ...selected[0]!, conversion: { ...selected[0]!.conversion, applicability: { conditions: 'range',
        fromRange: { min: R.of(1n), max: R.of(99n), minInclusive: true, maxInclusive: true } } } }]]) {
      const result = calculate(steps);
      expect(result.lines).toHaveLength(2);
      expect(result.lines.map(l => l.required.value)).toEqual([R.of(200n), R.of(100n)]);
      expect(result.lines.flatMap(l => l.contributions).find(c => c.rejectedTranslation)?.rejectedTranslation?.reasons[0]?.code)
        .toBe('STOCK_STATE_INCOMPATIBLE');
    }
  });

  it('E03: repeat recipe in four slots yields 1200/400 g with four separate origins', () => {
    const b = baseline([[450n, basis('g', 'tomato')], [150n, basis('g', 'cucumber')]], R.of(3n));
    const slots = [0, 1, 2, 3].map(order => ({ ...slot([[1n, basis('g', 'tomato')], [1n, basis('g', 'cucumber')]], `s${order}`, order),
      kind: 'baseline' as const, baseline: b, people: 2 }));
    const result = aggregateDemand(menu(...slots));
    expect(result.lines.map(l => l.required.value)).toEqual([R.of(400n), R.of(1200n)]);
    expect(result.lines.map(l => l.contributions.length)).toEqual([4, 4]);
    expect(result.lines[1]?.contributions.map(c => c.slotId)).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('distinguishes baseline/scaled and retains per-serving source, B normalization and exact thirds', () => {
    const s = slot([[30n, basis()]]);
    const b = baseline([[30n, basis()]], R.of(3n), true);
    const scaled = scaleRecipe(b, 2);
    const original = aggregateDemand(menu({ ...s, kind: 'baseline', baseline: b, people: 2 }));
    expect(original).toEqual(aggregateDemand(menu({ ...s, kind: 'scaled', recipe: scaled })));
    const c = original.lines[0]!.contributions[0]!;
    expect([c.source.value, c.wholeRecipe.value, c.scaled.value, c.factor, c.normalizationFactor])
      .toEqual([R.of(30n), R.of(90n), R.of(60n), R.of(2n, 3n), R.of(3n)]);
    const thirds = aggregateDemand(menu({ ...s, kind: 'baseline', baseline: baseline([[1n, basis()]], R.of(3n)), people: 1 }));
    expect(thirds.lines[0]?.required.value).toEqual(R.of(1n, 3n));
  });

  it('replaces the result, is repeatable, detached, and does not mutate the input', () => {
    const s = slot([[200n, basis()]]);
    const m = menu(s);
    const before = structuredClone(m);
    const first = aggregateDemand(m);
    expect(aggregateDemand(m)).toEqual(first);
    expect(structuredClone(m)).toEqual(before);
    expect(totals({ ...menu(slot([[50n, basis()]])), variantId: 'new' })).toEqual([R.of(50n)]);
    expect(first.lines[0]?.required.value).toEqual(R.of(200n));
    expect(first.lines[0]?.contributions[0]?.native.basis).not.toBe(s.resolutions[0]?.nativeBasis);
    expect(Object.isFrozen(first.lines[0]?.contributions[0]?.native.basis.ref)).toBe(true);
    expect(aggregateDemand(menu()).lines).toEqual([]);
  });

  it('rejects duplicate slots, slot orders, ingredients and resolutions', () => {
    const a = slot([[10n, basis()]]);
    expect(() => aggregateDemand(menu(a, a))).toThrow('DEMAND_SLOT');
    expect(() => aggregateDemand(menu(a, { ...a, slotId: 'other' }))).toThrow('DEMAND_SLOT');
    expect(() => aggregateDemand(menu({ ...a, resolutions: [...a.resolutions, ...a.resolutions] }))).toThrow('DEMAND_INGREDIENT');
    expect(() => aggregateDemand(menu({ ...a, resolutions: [] }))).toThrow('DEMAND_INGREDIENT');
    if (a.kind !== 'baseline') throw new Error('baseline');
    const scaled = scaleRecipe(a.baseline, 1);
    expect(() => aggregateDemand(menu({ ...a, kind: 'scaled', recipe: { ...scaled,
      ingredients: [...scaled.ingredients, ...scaled.ingredients] } }))).toThrow('DEMAND_INGREDIENT');
  });

  it('rejects incompatible native bases and conflicting definitions of one versioned basis', () => {
    const s = slot([[100n, basis()]]);
    expect(() => aggregateDemand(menu({ ...s, resolutions: [{ ingredientId: 'i0', nativeBasis: basis('ml') }] })))
      .toThrow('EXPECTED_BASE_UNIT_BASIS');
    const conflicting = { ...s.resolutions[0]!.nativeBasis, definition: 'different meaning' };
    expect(() => aggregateDemand(menu(s, { ...s, slotId: 'other', order: 1,
      resolutions: [{ ingredientId: 'i0', nativeBasis: conflicting }] }))).toThrow('CONFLICTING_DEMAND_BASIS');
  });

  it('has reproducible UTF-16 line/ingredient order and explicit slot order', () => {
    const a = slot([[10n, basis('g', 'z')], [20n, basis('g', 'a')]], 'last', 2);
    const b = slot([[30n, basis('g', 'a')]], 'first', 0);
    const expected = aggregateDemand(menu(a, b));
    expect(aggregateDemand(menu(b, a))).toEqual(expected);
    expect(expected.lines[0]?.contributions.map(c => c.slotId)).toEqual(['first', 'last']);
    expect(expected.lines.map(l => l.key)).toEqual(expected.lines.map(l => demandKey(l.required.basis)).sort());
    expect(demandKey(basis('g', 'ab'))).not.toBe(demandKey(basis('g', 'a')));
  });

  it('preserves an entire selected chain and refuses another product or version', () => {
    const from = basis('pcs');
    const grams = basis();
    const ml = basis('ml');
    const s = slot([[2n, from], [100n, ml]]);
    const steps = [step(from, grams), step(grams, ml, 2n)];
    const calculate = (selected: readonly ConversionStep[]) => aggregateDemand(menu({ ...s, resolutions: [
      { ...s.resolutions[0]!, translation: { target: ml, steps: selected } }, s.resolutions[1]!,
    ] }));
    const result = calculate(steps);
    expect(result.lines[0]?.required.value).toEqual(R.of(300n));
    expect(result.lines[0]?.contributions[0]?.conversions).toEqual(steps);
    expect(Object.isFrozen(result.lines[0]?.contributions[0]?.conversions[0]?.confirmation)).toBe(true);
    for (const wrong of [basis('ml', 'other'), basis('ml', 'rice', 'raw', '2')]) {
      const rejected = calculate([step(from, wrong)]);
      expect(rejected.lines).toHaveLength(2);
      expect(rejected.lines.flatMap(l => l.contributions).find(c => c.rejectedTranslation)?.quantity.value).toEqual(R.of(2n));
    }
  });

  it('sorts ingredients of one line without conflating separate ingredient IDs', () => {
    const s = slot([[10n, basis()], [20n, basis()]]);
    if (s.kind !== 'baseline') throw new Error('baseline');
    const scaled = scaleRecipe(s.baseline, 1);
    const result = aggregateDemand(menu({ ...s, kind: 'scaled', recipe: { ...scaled,
      ingredients: [...scaled.ingredients].reverse() }, resolutions: [...s.resolutions].reverse() }));
    expect(result.lines[0]?.required.value).toEqual(R.of(30n));
    expect(result.lines[0]?.contributions.map(c => c.ingredientId)).toEqual(['i0', 'i1']);
  });
});
