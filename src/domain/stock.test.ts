import { describe, expect, it } from 'vitest';
import { Rational as R, ZERO } from './rational';
import { UNITS } from './quantity';
import type { Quantity, QuantityBasis, Unit } from './quantity';
import { RecipeBaseline, scaleRecipe } from './recipeScale';
import { aggregateDemand } from './demand';
import type { MenuDemand } from './demand';
import type { ConversionStep } from './conversion';
import { calculateStock } from './stock';
import type { StockCalculated, StockEntry, StockGroup, StockSource, StockTranslation } from './stock';

const ref = (id: string, recordVersion = '1') => ({ id, recordVersion });
function basis(unit: Unit = 'g', product = 'rice', state = 'raw', version = '1'): QuantityBasis {
  return { ref: ref(`${product}-${state}-${unit}`, version), productRef: ref(product, version),
    stateRef: ref(`${product}-${state}`, version), unit, dimension: UNITS[unit].dimension, definition: 'edible product' };
}
const grams = basis();
const quantity = (n: bigint, b = grams, denominator = 1n): Quantity => ({ value: R.of(n, denominator), basis: b });
function recipe(items: readonly Quantity[], servings = 1n) {
  return RecipeBaseline.fromSource({ recipeRef: ref('recipe'), baseServings: R.of(servings),
    baseServingsEvidenceRefs: [ref('recipe-source')], portionMeaning: 'one serving', inputBasis: 'whole_recipe',
    ingredients: items.map((quantity, i) => ({ ingredientId: `i${i}`, quantity })),
    nutrition: { kcal: ZERO, proteinG: ZERO, fatG: ZERO, carbsG: ZERO }, timeEvidence: [] });
}
function demandFor(...items: readonly Quantity[][]): MenuDemand {
  return aggregateDemand({ planId: 'plan', variantId: 'A', slots: items.map((items, order) => ({
    kind: 'baseline', baseline: recipe(items), people: 1, slotId: `s${order}`, order,
    resolutions: items.map((q, i) => ({ ingredientId: `i${i}`, nativeBasis: q.basis })),
  })) });
}
const known = (id: string, n: bigint, b = grams, urgent = false): StockEntry => ({
  stockEntryId: id, urgent, quantity: { kind: 'known', value: quantity(n, b) },
});
const unknown = (id = 'unknown', hint?: QuantityBasis, urgent = false): StockEntry => ({
  stockEntryId: id, urgent, quantity: { kind: 'unknown',
    reasons: [{ code: 'STOCK_QUANTITY_REQUIRED', explanation: 'User left quantity blank' }],
    ...(hint ? { unitHint: hint } : {}) },
});
const group = (id: string, entries: readonly StockEntry[], b: QuantityBasis | null = grams): StockGroup => ({
  stockGroupId: id, groupVersion: '1', productRef: b?.productRef ?? grams.productRef,
  stateRef: b?.stateRef ?? grams.stateRef, basis: b, entries,
});
const sourceFor = (...groups: StockGroup[]): StockSource => ({ mode: 'selected',
  selectedGroupIds: groups.map(g => g.stockGroupId), groups: groups.map(group => ({ kind: 'present', group })) });
const none: StockSource = { mode: 'none', selectedGroupIds: [], groups: [] };
const value = (v: StockCalculated) => {
  expect(v.kind).toBe('available');
  if (v.kind !== 'available') throw new Error('expected available');
  return v.value.value;
};
function step(from: QuantityBasis, to: QuantityBasis, factor = R.of(50n)): ConversionStep {
  return { conversion: { ref: ref('coefficient'), from, to, factor, method: 'measured for this product',
    sourceRefs: [ref('measurement')], checkedOn: '2026-10-22', checkedBy: 'reviewer',
    applicability: { conditions: 'this product, state and direction', fromRange: null } }, direction: 'forward',
    confirmation: { kind: 'confirmed', evidenceRefs: [ref('applicability-evidence')] } };
}
const first = (demand: MenuDemand, source: StockSource, translations: readonly StockTranslation[] = []) =>
  calculateStock(demand, source, translations).lines[0]!;
const translated = (demand: MenuDemand, id: string, steps: readonly ConversionStep[]): StockTranslation => ({
  stockEntryId: id, demandKey: demand.lines[0]!.key, steps,
});

describe('exact stock coverage of aggregated demand', () => {
  it.each(['0', '1', '900719925474099312345678901234567890'])(
    'S1-R10: accepts canonical groupVersion %s and preserves it without numeric coercion', groupVersion => {
      const demand = demandFor([quantity(700n)]);
      const source = sourceFor({ ...group('g', [known('e', 200n)]), groupVersion });
      const result = calculateStock(demand, source);
      const line = result.lines[0]!;
      expect([value(line.usedTotal), value(line.deficit), value(line.leftover)])
        .toEqual([R.of(200n), R.of(500n), ZERO]);
      const saved = result.source.groups[0];
      expect(saved?.kind === 'present' && saved.group.groupVersion).toBe(groupVersion);
      expect(source.groups[0]?.kind === 'present' && source.groups[0].group.groupVersion).toBe(groupVersion);
    });

  it.each(['00', '01', '-1', '1.0', '', '+1', ' 0', '0 ', '0\n'])(
    'S1-R10: rejects noncanonical groupVersion %j', groupVersion => {
      const source = sourceFor({ ...group('g', [known('e', 200n)]), groupVersion });
      expect(() => calculateStock(demandFor([quantity(700n)]), source)).toThrow('INVALID_STOCK_GROUP_VERSION');
    });

  it('S1-R10: catalog recordVersion still requires a positive integer', () => {
    const invalidBasis = basis('g', 'rice', 'raw', '0');
    const source = sourceFor(group('g', [known('e', 200n, invalidBasis)], invalidBasis));
    expect(() => calculateStock(demandFor([quantity(700n)]), source)).toThrow('INVALID_STOCK_REFERENCE');
  });

  it.each([
    ['S01-Z', 0n, 0n, 700n, 0n], ['S01-P', 200n, 200n, 500n, 0n],
    ['S01-E', 700n, 700n, 0n, 0n], ['S01-X', 1000n, 700n, 0n, 300n],
  ])('%s: u/d/leftover and three independent repeats', (_id, stock, used, deficit, leftover) => {
    const demand = demandFor([quantity(700n)]);
    const source = sourceFor(group('g', [known('e', stock)]));
    for (let repeat = 0; repeat < 4; repeat++) {
      const result = first(demand, source);
      expect([value(result.stockTotal), value(result.usedTotal), value(result.deficit), value(result.leftover)])
        .toEqual([R.of(stock), R.of(used), R.of(deficit), R.of(leftover)]);
      expect(result.usedKnown.value.add(value(result.deficit))).toEqual(R.of(700n));
      expect(value(result.usedTotal).add(value(result.leftover))).toEqual(R.of(stock));
    }
    expect(source.groups[0]?.kind === 'present' && source.groups[0].group.entries[0]).toEqual(known('e', stock));
  });

  it('E03: S1-09 scaled contributions are consumed once and coverage follows all four slots', () => {
    const tomato = basis('g', 'tomato');
    const cucumber = basis('g', 'cucumber');
    const baseline = recipe([quantity(450n, tomato), quantity(150n, cucumber)], 3n);
    const scaled = scaleRecipe(baseline, 2);
    const demand = aggregateDemand({ planId: 'E03', variantId: 'A', slots: [0, 1, 2, 3].map(order => ({
      kind: 'scaled', recipe: scaled, slotId: `s${order}`, order,
      resolutions: [{ ingredientId: 'i0', nativeBasis: tomato }, { ingredientId: 'i1', nativeBasis: cucumber }],
    })) });
    const result = calculateStock(demand, sourceFor(group('tomato', [known('t', 500n, tomato)], tomato),
      group('cucumber', [known('c', 100n, cucumber)], cucumber)));
    const t = result.lines.find(l => l.required.basis.productRef.id === 'tomato')!;
    const c = result.lines.find(l => l.required.basis.productRef.id === 'cucumber')!;
    expect([t.required.value, t.usedKnown.value, value(t.deficit), value(t.leftover)])
      .toEqual([R.of(1200n), R.of(500n), R.of(700n), ZERO]);
    expect([c.required.value, c.usedKnown.value, value(c.deficit), value(c.leftover)])
      .toEqual([R.of(400n), R.of(100n), R.of(300n), ZERO]);
    expect(t.slots.map(s => s.aKnown.value)).toEqual([R.of(300n), R.of(200n), ZERO, ZERO]);
    expect(t.slots.map(s => s.uncoveredKnown.value)).toEqual([ZERO, R.of(100n), R.of(300n), R.of(300n)]);
    expect(c.slots.map(s => s.aKnown.value)).toEqual([R.of(100n), ZERO, ZERO, ZERO]);
    expect(c.slots.map(s => s.uncoveredKnown.value)).toEqual([ZERO, R.of(100n), R.of(100n), R.of(100n)]);
    expect(t.contributions).toEqual(demand.lines.find(l => l.key === t.key)?.contributions);
    expect(t.slots[0]?.contributions[0]?.contribution.factor).toEqual(R.of(2n, 3n));
  });

  it.each([['g', 'kg'], ['ml', 'l']] as const)('U01: combines distinct physical %s/%s entries once', (small, large) => {
    const b = basis(small);
    const big = basis(large);
    const half: StockEntry = { stockEntryId: 'half', urgent: false,
      quantity: { kind: 'known', value: quantity(1n, big, 2n) } };
    const result = first(demandFor([quantity(1200n, b)]), sourceFor(group('g', [known('small', 500n, b), half], b)));
    expect(result.knownStock.value).toEqual(R.of(1000n));
    expect(value(result.deficit)).toEqual(R.of(200n));
    expect(result.sourceEntryIds).toEqual(['half', 'small']);
    expect(result.knownEntries[0]?.original.basis.unit).toBe(large);
  });

  it('U02: cooked stock remains known with a state refusal; unknown cooked stock does not block raw rice', () => {
    const cooked = basis('g', 'rice', 'cooked');
    const result = first(demandFor([quantity(700n)]), sourceFor(group('cooked',
      [known('c', 200n, cooked), unknown('u')], cooked)));
    expect(value(result.deficit)).toEqual(R.of(700n));
    expect(result.unknownEntryIds).toEqual([]);
    expect(result.incompatibleEntries[0]?.original.value).toEqual(R.of(200n));
    expect(result.incompatibleEntries[0]?.reasons[0]?.code).toBe('STOCK_STATE_INCOMPATIBLE');
  });

  it('U03: mass and volume without density have independent known S/u/d/leftover', () => {
    const ml = basis('ml');
    const result = calculateStock(demandFor([quantity(200n), quantity(100n, ml)]), sourceFor(
      group('mass', [known('mass', 50n)]), group('volume', [known('volume', 40n, ml)], ml)));
    expect(result.lines.map(l => [l.knownStock.value, value(l.usedTotal), value(l.deficit), value(l.leftover)]))
      .toEqual([[R.of(50n), R.of(50n), R.of(150n), ZERO], [R.of(40n), R.of(40n), R.of(60n), ZERO]]);
    expect(result.lines.flatMap(l => l.sourceEntryIds)).toEqual(['mass', 'volume']);
    expect(result.lines.every(l => l.incompatibleEntries[0]?.reasons[0]?.code === 'CONVERSION_MISSING')).toBe(true);
  });

  it('U04: a known piece is excluded without evidence and covers exactly 50 g with a confirmed coefficient', () => {
    const pcs = basis('pcs');
    const demand = demandFor([quantity(100n)]);
    const source = sourceFor(group('pieces', [known('piece', 1n, pcs)], pcs));
    const no = first(demand, source);
    expect(value(no.deficit)).toEqual(R.of(100n));
    expect(no.unknownEntryIds).toEqual([]);
    expect(no.incompatibleEntries[0]?.original).toEqual(quantity(1n, pcs));
    expect(no.incompatibleEntries[0]?.reasons[0]?.code).toBe('CONVERSION_MISSING');
    const yes = first(demand, source, [translated(demand, 'piece', [step(pcs, grams)])]);
    expect([yes.knownStock.value, value(yes.usedTotal), value(yes.deficit)]).toEqual([R.of(50n), R.of(50n), R.of(50n)]);
    expect(yes.knownEntries[0]?.steps[0]?.conversion.sourceRefs).toEqual([ref('measurement')]);
  });

  it.each(['hint', 'no hint', 'incompatible hint'] as const)('S02-U: unknown with %s does not acquire a number or unit', hint => {
    const hintBasis = hint === 'hint' ? grams : hint === 'incompatible hint' ? basis('pcs') : undefined;
    const source = sourceFor(group('g', [unknown('u', hintBasis)], hintBasis ?? null));
    const result = first(demandFor([quantity(300n)]), source);
    expect(result.knownStock.value).toEqual(ZERO);
    expect(result.usedKnown.value).toEqual(ZERO);
    for (const v of [result.stockTotal, result.usedTotal, result.deficit, result.leftover]) {
      expect(v.kind).toBe('unavailable');
      if (v.kind === 'unavailable') expect(v.reasons[0].code).toBe('STOCK_QUANTITY_REQUIRED');
    }
    expect(result.unknownEntryIds).toEqual(['u']);
    expect(source.groups[0]?.kind === 'present' && source.groups[0].group.entries[0]?.quantity.kind).toBe('unknown');
  });

  it('S02-M: known coverage is distributed but uncoveredKnown is not a final deficit', () => {
    const demand = demandFor([quantity(50n)], [quantity(250n)]);
    const result = first(demand, sourceFor(group('g', [known('k', 100n), unknown('u'), unknown('u2')])));
    expect(result.usedKnown.value).toEqual(R.of(100n));
    expect(result.slots.map(s => s.aKnown.value)).toEqual([R.of(50n), R.of(50n)]);
    expect(result.slots.map(s => s.uncoveredKnown.value)).toEqual([ZERO, R.of(200n)]);
    expect(result.deficit.kind).toBe('unavailable');
    if (result.deficit.kind === 'unavailable') {
      expect(result.deficit.reasons[0].sourceEntryIds).toEqual(['u', 'u2']);
      expect(result.deficit.reasons[0].details.knownStock.value).toEqual(R.of(100n));
      expect(result.deficit.reasons[0].details.required.value).toEqual(R.of(300n));
    }
  });

  it('zero and a known incompatible piece do not resolve an additional unknown of the same state', () => {
    const pcs = basis('pcs');
    const result = first(demandFor([quantity(300n)]), sourceFor(
      group('g', [known('zero', 0n), unknown('u')]), group('pcs', [known('piece', 1n, pcs)], pcs)));
    expect(result.usedKnown.value).toEqual(ZERO);
    expect(result.deficit.kind).toBe('unavailable');
    expect(result.unknownEntryIds).toEqual(['u']);
    expect(result.incompatibleEntries[0]?.original).toEqual(quantity(1n, pcs));
  });

  it.each([300n, 350n])('S02-K: known %s + unknown gives final u=300/d=0 but no total S/leftover', stock => {
    const result = first(demandFor([quantity(300n)]), sourceFor(group('g', [known('k', stock), unknown('u')])));
    expect(value(result.usedTotal)).toEqual(R.of(300n));
    expect(value(result.deficit)).toEqual(ZERO);
    expect(result.knownLeftover.value).toEqual(R.of(stock - 300n));
    expect(result.stockTotal.kind).toBe('unavailable');
    expect(result.leftover.kind).toBe('unavailable');
    expect(result.unknownEntryIds).toEqual(['u']);
  });

  it.each([100n, 300n, 0n])('S02 clarification: known %s replaces unknown and yields final results', stock => {
    const result = first(demandFor([quantity(300n)]), sourceFor(group('g', [known('clarified', stock)])));
    expect(value(result.deficit)).toEqual(R.of(300n - stock));
    expect(value(result.leftover)).toEqual(ZERO);
  });

  it('S02-O: unknown other product/state/version leaves this need and independent product X available', () => {
    const x = basis('pcs', 'X');
    const cooked = basis('g', 'rice', 'cooked');
    const version2 = basis('g', 'rice', 'raw', '2');
    const result = calculateStock(demandFor([quantity(300n), quantity(1n, x)]), sourceFor(
      group('known', [known('k', 100n)]), group('other-product', [unknown('x')], basis('g', 'other')),
      group('other-state', [unknown('cooked')], cooked), group('other-version', [unknown('v2')], version2)));
    const rice = result.lines.find(l => l.required.basis.productRef.id === 'rice')!;
    const other = result.lines.find(l => l.required.basis.productRef.id === 'X')!;
    expect(value(rice.deficit)).toEqual(R.of(200n));
    expect(value(other.deficit)).toEqual(R.of(1n));
    expect(result.lines.every(l => l.unknownEntryIds.length === 0)).toBe(true);
    expect(result.source.groups).toHaveLength(4);
  });

  it('S02-N: none gives u=0/d=R and excluded leftover without reading common stock', () => {
    const common = sourceFor(group('g', [known('k', 100n), unknown('u')]));
    const result = first(demandFor([quantity(300n)]), none);
    expect(value(result.usedTotal)).toEqual(ZERO);
    expect(value(result.deficit)).toEqual(R.of(300n));
    expect(result.sourceEntryIds).toEqual([]);
    expect(result.leftover.kind).toBe('unavailable');
    if (result.leftover.kind === 'unavailable') expect(result.leftover.reasons[0].code).toBe('STOCK_SOURCE_EXCLUDED');
    expect(common.groups[0]?.kind === 'present' && common.groups[0].group.entries).toEqual([known('k', 100n), unknown('u')]);
    expect(() => calculateStock(demandFor([quantity(300n)]), { ...common, mode: 'none' })).toThrow('INVALID_STOCK_SOURCE');
  });

  it('only selected groups participate; selected known absence does not revive old quantities', () => {
    const demand = demandFor([quantity(700n)]);
    const common = [group('chosen', [known('k', 200n)]), group('excluded', [known('excluded', 999n), unknown('u')])];
    expect(value(first(demand, sourceFor(common[0]!)).deficit)).toEqual(R.of(500n));
    const absent: StockSource = { mode: 'selected', selectedGroupIds: ['chosen'], groups: [{ kind: 'absent', stockGroupId: 'chosen' }] };
    expect(value(first(demand, absent).deficit)).toEqual(R.of(700n));
    expect(() => calculateStock(demand, { ...sourceFor(...common), selectedGroupIds: ['chosen'] }))
      .toThrow('UNSELECTED_OR_DUPLICATE_STOCK_GROUP');
    expect(() => calculateStock(demand, { ...absent, groups: [] })).toThrow('STOCK_GROUP_PRESENCE_REQUIRED');
  });

  it('B19-S02: a fresh replacement demand uses original S, not the old projected leftover', () => {
    const source = sourceFor(group('g', [known('k', 500n)]));
    const before = first(demandFor([quantity(300n)], [quantity(400n)]), source);
    expect(before.slots.map(s => s.aKnown.value)).toEqual([R.of(300n), R.of(200n)]);
    expect(value(before.deficit)).toEqual(R.of(200n));
    const after = first(demandFor([quantity(400n)]), source);
    expect(value(after.usedTotal)).toEqual(R.of(400n));
    expect(value(after.deficit)).toEqual(ZERO);
    expect(value(after.leftover)).toEqual(R.of(100n));
    expect(value(before.deficit)).toEqual(R.of(200n));
  });

  it('combines all contributions inside a slot before allocating in global day/slot order', () => {
    const demand = demandFor([quantity(100n), quantity(200n)], [quantity(400n)], [quantity(50n)]);
    const shuffled = { ...demand, lines: demand.lines.map(l => ({ ...l, contributions: [...l.contributions].reverse() })) };
    const result = first(shuffled, sourceFor(group('g', [known('k', 500n)])));
    expect(result.slots.map(s => [s.slotId, s.required.value, s.aKnown.value]))
      .toEqual([['s0', R.of(300n), R.of(300n)], ['s1', R.of(400n), R.of(200n)], ['s2', R.of(50n), ZERO]]);
    expect(result.slots[0]?.contributions.map(c => c.aKnown.value)).toEqual([R.of(100n), R.of(200n)]);
    expect(result.slots.flatMap(s => s.contributions).map(c => c.contribution.ingredientId)).toEqual(['i0', 'i1', 'i0', 'i0']);
  });

  it('preserves exact fractions below display/input steps without scaling R again', () => {
    const baseline = recipe([quantity(1n)], 3n);
    const scaled = scaleRecipe(baseline, 1);
    const demand = aggregateDemand({ planId: 'p', variantId: 'v', slots: [{ kind: 'scaled', recipe: scaled,
      slotId: 's', order: 0, resolutions: [{ ingredientId: 'i0', nativeBasis: grams }] }] });
    const entry: StockEntry = { ...known('k', 0n), quantity: { kind: 'known', value: quantity(1n, grams, 1000n) } };
    const result = first(demand, sourceFor(group('g', [entry])));
    expect(result.required.value).toEqual(R.of(1n, 3n));
    expect(value(result.deficit)).toEqual(R.of(997n, 3000n));
  });

  it('rejects duplicated physical entries even across groups, units or alternative chains', () => {
    const demand = demandFor([quantity(700n)]);
    expect(() => calculateStock(demand, sourceFor(group('g', [known('same', 200n), known('same', 200n)]))))
      .toThrow('DUPLICATE_OR_INVALID_STOCK_ENTRY');
    expect(() => calculateStock(demand, sourceFor(group('g', [known('same', 200n)]),
      group('other', [known('same', 1n, basis('kg'))])))).toThrow('DUPLICATE_OR_INVALID_STOCK_ENTRY');
    const route = translated(demand, 'k', []);
    expect(() => calculateStock(demand, sourceFor(group('g', [known('k', 200n)])), [route, route]))
      .toThrow('INVALID_STOCK_TRANSLATION');
  });

  it('merges selected compatible groups; permutations and a unit change of the same entry do not add stock', () => {
    const demand = demandFor([quantity(1200n)]);
    const g1 = group('g1', [known('a', 500n)]);
    const g2 = group('g2', [known('b', 500n)]);
    const result = calculateStock(demand, sourceFor(g1, g2));
    expect(result.lines[0]?.knownStock.value).toEqual(R.of(1000n));
    expect(calculateStock(demand, sourceFor(g2, g1)).lines).toEqual(result.lines);
    const inKg: StockEntry = { stockEntryId: 'b', urgent: false,
      quantity: { kind: 'known', value: quantity(1n, basis('kg'), 2n) } };
    const changedUnit = first(demand, sourceFor(g1, group('g2', [inKg])));
    expect(changedUnit.knownStock.value).toEqual(R.of(1000n));
    expect(changedUnit.sourceEntryIds).toEqual(['a', 'b']);
  });

  it('does not let a translation hide or rescale stock that is already compatible', () => {
    const demand = demandFor([quantity(700n)]);
    const source = sourceFor(group('g', [known('k', 200n)]));
    const redundant = { ...step(grams, grams), confirmation: { kind: 'unconfirmed' as const } };
    expect(() => calculateStock(demand, source, [translated(demand, 'k', [redundant])]))
      .toThrow('REDUNDANT_STOCK_TRANSLATION');
  });

  it.each(['unconfirmed', 'reverse', 'range', 'other-product', 'missing-source'] as const)(
    'rejects %s conversion, preserving the known original and refusal chain', mode => {
      const pcs = basis('pcs');
      const demand = demandFor([quantity(100n)]);
      const good = step(pcs, grams);
      const selected: ConversionStep = mode === 'unconfirmed' ? { ...good, confirmation: { kind: 'unconfirmed' } }
        : mode === 'reverse' ? { ...good, direction: 'reverse' }
        : mode === 'range' ? { ...good, conversion: { ...good.conversion, applicability: { conditions: 'range',
          fromRange: { min: R.of(2n), max: R.of(3n), minInclusive: true, maxInclusive: true } } } }
        : mode === 'other-product' ? step(basis('pcs', 'other'), basis('g', 'other'))
        : { ...good, conversion: { ...good.conversion, sourceRefs: [] } };
      const result = first(demand, sourceFor(group('g', [known('k', 1n, pcs)], pcs)), [translated(demand, 'k', [selected])]);
      expect(value(result.deficit)).toEqual(R.of(100n));
      expect(result.unknownEntryIds).toEqual([]);
      expect(result.incompatibleEntries[0]?.original).toEqual(quantity(1n, pcs));
      expect(result.incompatibleEntries[0]?.attemptedSteps).toEqual([selected]);
      expect(result.incompatibleEntries[0]?.reasons[0]?.details.explanation).toBeTruthy();
    });

  it('uses one multi-step chain once and rejects an entry convertible to two demand targets', () => {
    const pcs = basis('pcs');
    const ml = basis('ml');
    const demand = demandFor([quantity(300n, ml)]);
    const source = sourceFor(group('g', [known('k', 2n, pcs)], pcs));
    const chain = [step(pcs, grams), step(grams, ml, R.of(2n))];
    const result = first(demand, source, [translated(demand, 'k', chain)]);
    expect(result.knownStock.value).toEqual(R.of(200n));
    expect(value(result.deficit)).toEqual(R.of(100n));
    expect(result.sourceEntryIds).toEqual(['k']);
    const two = demandFor([quantity(100n), quantity(100n, ml)]);
    expect(() => calculateStock(two, source, two.lines.map(l => ({ stockEntryId: 'k', demandKey: l.key,
      steps: l.required.basis.unit === 'g' ? [step(pcs, grams)] : chain })))).toThrow('AMBIGUOUS_STOCK_TARGET');
  });

  it('state transition requires a confirmed chain; equal labels never establish identity', () => {
    const cooked = basis('g', 'rice', 'cooked');
    const demand = demandFor([quantity(700n, cooked)]);
    const result = first(demand, sourceFor(group('g', [known('k', 200n)])),
      [translated(demand, 'k', [step(grams, cooked, R.of(3n))])]);
    expect(value(result.deficit)).toEqual(R.of(100n));
    const other = basis('g', 'other');
    expect(value(first(demand, sourceFor(group('g', [known('k', 999n, other)], other))).deficit)).toEqual(R.of(700n));
  });

  it('each alternative independently uses original S; urgent flags do not change arithmetic', () => {
    const demand = demandFor([quantity(700n)]);
    const source = sourceFor(group('g', [known('k', 500n, grams, true)]));
    const a = first(demand, source);
    const b = first({ ...demand, variantId: 'B' }, source);
    expect(value(a.deficit)).toEqual(R.of(200n));
    expect(value(b.deficit)).toEqual(R.of(200n));
    const zero = first(demand, sourceFor(group('g', [known('zero', 0n, grams, true)])));
    expect(value(zero.usedTotal)).toEqual(ZERO);
    const u = first(demand, sourceFor(group('g', [unknown('u', undefined, true)])));
    expect(u.usedKnown.value).toEqual(ZERO);
    expect(u.usedTotal.kind).toBe('unavailable');
    expect(first(demand, sourceFor(group('g', [known('k', 500n)]))).usedKnown).toEqual(a.usedKnown);
  });

  it('does not mutate inputs, retains unrelated unknowns and returns a detached deeply frozen result', () => {
    const demand = demandFor([quantity(700n)]);
    const entry = known('k', 200n);
    const mutableBasis = { ...grams, productRef: { ...grams.productRef } };
    const groupInput = { ...group('g', [entry]), basis: mutableBasis };
    const source = sourceFor(groupInput, group('other', [unknown('unrelated')], basis('g', 'other')));
    const before = structuredClone({ demand, source });
    const result = calculateStock(demand, source);
    expect(structuredClone({ demand, source })).toEqual(before);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(result.lines[0]?.slots[0]?.contributions[0]?.contribution.source.basis)).toBe(true);
    expect(Object.isFrozen(result.source.groups)).toBe(true);
    mutableBasis.productRef.id = 'changed-after-call';
    expect(result.source.groups[0]?.kind === 'present' && result.source.groups[0].group.basis?.productRef.id).toBe('rice');
    expect(result.lines[0]?.required.basis.productRef.id).toBe('rice');
  });

  it('rejects invalid amounts, reference collisions and altered demand totals rather than computing a plausible number', () => {
    const demand = demandFor([quantity(700n)]);
    expect(() => calculateStock(demand, sourceFor(group('g', [known('negative', -1n)])))).toThrow('INVALID_STOCK_QUANTITY');
    const substep: StockEntry = { stockEntryId: 'substep', urgent: false,
      quantity: { kind: 'known', value: quantity(1n, grams, 10000n) } };
    expect(() => calculateStock(demand, sourceFor(group('g', [substep])))).toThrow('INVALID_STOCK_QUANTITY');
    const conflict = { ...grams, definition: 'conflicting identity' };
    expect(() => calculateStock(demand, sourceFor(group('g', [known('k', 1n, conflict)])))).toThrow('CONFLICTING_STOCK_BASIS');
    expect(() => calculateStock({ ...demand, lines: [{ ...demand.lines[0]!, required: quantity(701n) }] }, none))
      .toThrow('STOCK_DEMAND_TOTAL_MISMATCH');
    expect(calculateStock({ planId: 'p', variantId: 'v', lines: [] }, sourceFor(group('g', [unknown('u')]))).lines).toEqual([]);
  });
});
