import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rational as R, ZERO, ONE } from './rational';
import { parseDecimalText } from './numberInput';
import { UNITS } from './quantity';
import type { EntityRef, Quantity, QuantityBasis, Unit } from './quantity';
import { RecipeBaseline } from './recipeScale';
import { aggregateDemand } from './demand';
import { calculateStock } from './stock';
import type { StockCalculation, StockEntry, StockSource } from './stock';
import type { ConversionStep } from './conversion';
import { calculateMoney, moneyLineId } from './money';
import type { Acquisition, CalculatedMoney, MoneyCalculation, MoneyCalculationInput,
  ReferencePriceEstimate, ReferencePriceSelection, ReferencePriceSet } from './money';
import { formatMoney, formatMoneySum } from './presentation';

const ref = (id: string, recordVersion = '1'): EntityRef => ({ id, recordVersion });
function decimal(s: string): R {
  const v = parseDecimalText(s);
  if (v.kind !== 'valid') throw new Error('test decimal');
  return v.value;
}
function basis(product = 'rice', unit: Unit = 'g'): QuantityBasis {
  return { ref: ref(`${product}-${unit}`), productRef: ref(product), stateRef: ref(`${product}-state`),
    dimension: UNITS[unit].dimension, unit, definition: 'edible product' };
}
const rice = basis(), x = basis('X', 'pcs');
const q = (s: string, b = rice): Quantity => ({ value: decimal(s), basis: b });
const none: StockSource = { mode: 'none', selectedGroupIds: [], groups: [] };
const known = (id: string, quantity: Quantity): StockEntry => ({ stockEntryId: id, urgent: false,
  quantity: { kind: 'known', value: quantity } });
const unknown = (id: string): StockEntry => ({ stockEntryId: id, urgent: false,
  quantity: { kind: 'unknown', reasons: [{ code: 'STOCK_QUANTITY_REQUIRED', explanation: 'Not entered' }] } });
function source(b: QuantityBasis, entries: readonly StockEntry[]): StockSource {
  return { mode: 'selected', selectedGroupIds: ['group'], groups: [{ kind: 'present', group: {
    stockGroupId: 'group', groupVersion: '0', productRef: b.productRef, stateRef: b.stateRef, basis: b, entries,
  } }] };
}
function stockFor(slots: readonly (readonly Quantity[])[], stockSource = none): StockCalculation {
  const demand = aggregateDemand({ planId: 'plan', variantId: 'A', slots: slots.map((items, order) => ({
    kind: 'baseline', slotId: `s${order}`, order, people: 1,
    baseline: RecipeBaseline.fromSource({ recipeRef: ref('recipe'), baseServings: ONE,
      baseServingsEvidenceRefs: [ref('source')], portionMeaning: 'one serving', inputBasis: 'whole_recipe',
      ingredients: items.map((quantity, i) => ({ ingredientId: `i${i}`, quantity })),
      nutrition: { kcal: ZERO, proteinG: ZERO, fatG: ZERO, carbsG: ZERO }, timeEvidence: [] }),
    resolutions: items.map((quantity, i) => ({ ingredientId: `i${i}`, nativeBasis: quantity.basis })),
  })) });
  return calculateStock(demand, stockSource);
}
function estimate(b = rice, p = '100', v = '1000', packaged = false): ReferencePriceEstimate {
  return { ref: ref(`estimate-${b.ref.id}`), productRef: b.productRef, stateRef: b.stateRef,
    currency: 'RUB', amountRub: decimal(p), priceBasis: q(v, b),
    referenceSale: packaged ? { kind: 'indivisible', packageContent: q(v, b), label: 'pack', sourceRefs: [ref('source')] }
      : { kind: 'by_quantity' }, assessedOn: '2026-10-03', checkedOn: '2026-10-04',
    observations: [{ ref: ref(`observation-${b.ref.id}`), observedOn: '2026-10-01', checkedOn: '2026-10-02' }],
    zeroPriceEvidenceRefs: [] };
}
function selection(e: ReferencePriceEstimate, b = e.priceBasis.basis, steps: readonly ConversionStep[] = []): ReferencePriceSelection {
  return { key: { stateRef: b.stateRef, basisRef: b.ref }, basis: b, steps,
    resolution: { kind: 'available', estimateRef: e.ref } };
}
function prices(...estimates: ReferencePriceEstimate[]): ReferencePriceSet {
  return { ref: ref('price-set'), catalogVersion: 'catalog-1', pricePolicyVersion: 'reference-price-v1',
    currency: 'RUB', setDigest: 'upstream-validated-digest', assessedOn: '2026-10-05',
    checkedOn: '2026-10-06', publishedOn: '2026-10-09', estimates, selections: estimates.map(e => selection(e)) };
}
function input(stock: StockCalculation, set = prices(estimate())): MoneyCalculationInput {
  return { stock, prices: set, budgetRub: R.of(500n), evaluationDate: '2026-10-20', timeZone: 'Europe/Moscow',
    versions: { catalogVersion: set.catalogVersion, priceSetRef: set.ref, pricePolicyVersion: set.pricePolicyVersion } };
}
function value<T>(v: CalculatedMoney<T>): T {
  expect(v.kind).toBe('available');
  if (v.kind !== 'available') throw new Error('expected available');
  return v.value;
}
function checkMoney(result: MoneyCalculation, expected: readonly string[]): void {
  expect(['C', 'A0', 'A1', 'E', 'T', 'O'].map(k => value(result.money[k as 'C'])))
    .toEqual(expected.map(decimal));
  expect(result.money.K).toEqual(value(result.money.T));
  expect(result.money.unresolvedLineIds).toEqual([]);
}
function acquisition(result: MoneyCalculation, b = rice): Acquisition {
  return value(result.lines.find(l => l.priceSelectionRef.basisRef.id === b.ref.id)!.acquisition);
}
function codes(v: CalculatedMoney<unknown>): string[] {
  expect(v.kind).toBe('unavailable');
  return v.kind === 'unavailable' ? v.reasons.map(r => r.code) : [];
}
function conversion(from: QuantityBasis, to: QuantityBasis, factor = R.of(50n)): ConversionStep {
  return { conversion: { ref: ref('conversion'), from, to, factor, method: 'measured',
    sourceRefs: [ref('source')], checkedOn: '2026-10-02', checkedBy: 'reviewer',
    applicability: { conditions: 'this product and direction', fromRange: null } }, direction: 'forward',
    confirmation: { kind: 'confirmed', evidenceRefs: [ref('confirmation')] } };
}

describe('PRICE-01 independent numeric references', () => {
  it('RP-E03/E04: full ingredient use, aggregate acquisitions and slot explanation', () => {
    const tomato = basis('tomato'), cucumber = basis('cucumber');
    const selected: StockSource = { mode: 'selected', selectedGroupIds: ['t', 'c'], groups: [
      ['t', tomato, '500'], ['c', cucumber, '100'],
    ].map(([id, b, n]) => {
      const bb = b as QuantityBasis;
      return { kind: 'present', group: { stockGroupId: id as string, groupVersion: '1',
        productRef: bb.productRef, stateRef: bb.stateRef, basis: bb, entries: [known(id as string, q(n as string, bb))] } };
    }) };
    const stock = stockFor(Array.from({ length: 4 }, () => [q('300', tomato), q('100', cucumber)]), selected);
    const request = input(stock, prices(estimate(tomato, '67.5', '300', true), estimate(cucumber, '40', '250', true)));
    const before = structuredClone(request);
    const result = calculateMoney(request);
    checkMoney(result, ['334', '350', '282.5', '67.5', '282.5', '217.5']);
    expect(result.slots.map(s => value(s.ingredientCostC))).toEqual(Array.from({ length: 4 }, () => decimal('83.5')));
    expect(result.slots[0]!.contributions.map(c => value(c.ingredientCost))).toEqual([decimal('67.5'), decimal('16')]);
    const t = acquisition(result, tomato), c = acquisition(result, cucumber);
    expect(t).toMatchObject({ packageCount: '3', requestedQuantity: q('700', tomato), purchasedQuantity: q('900', tomato) });
    expect(c).toMatchObject({ packageCount: '2', requestedQuantity: q('300', cucumber), purchasedQuantity: q('500', cucumber) });
    expect(result.money.budgetAssessment.kind).toBe('confirmed');
    for (let i = 0; i < 3; i++) expect(calculateMoney(request)).toEqual(result);
    expect(structuredClone(request)).toEqual(before);
    expect(Object.isFrozen(request)).toBe(false);
    expect(Object.isFrozen(request.prices)).toBe(false);
    expect(Object.isFrozen(request.prices.estimates[0])).toBe(false);
    expect(Object.isFrozen(result.basis.prices.estimates[0])).toBe(true);
    expect(Object.isFrozen(result.lines[0]!.demand)).toBe(true);
    expect(result.lines[0]!.demand).not.toBe(stock.lines[0]);
    const changed = { ...selected, groups: selected.groups.map(g => g.kind === 'present' && g.group.stockGroupId === 't'
      ? { ...g, group: { ...g.group, groupVersion: '2', entries: [known('t', q('600', tomato))] } } : g) };
    checkMoney(calculateMoney(input(stockFor(Array.from({ length: 4 }, () => [q('300', tomato), q('100', cucumber)]), changed),
      request.prices)), ['334', '350', '215', '135', '215', '285']);
    checkMoney(calculateMoney({ ...request, stock: stockFor(Array.from({ length: 4 }, () => [q('300', tomato), q('100', cucumber)])) }),
      ['334', '350', '350', '0', '350', '150']);
  });

  it.each([
    ['U', null, true, null, '490', 'unconfirmed'], ['M', '100', true, null, '490', 'unconfirmed'],
    ['100', '100', false, '510', '510', 'violated'], ['300', '300', false, '490', '490', 'confirmed'],
    ['K', '350', true, '490', '490', 'confirmed'], ['N', null, false, '520', '520', 'violated'],
  ] as const)('RP-S02-%s: stock uncertainty is local to dependent amounts', (_id, n, unk, total, K, status) => {
    const entries = [...(n ? [known('known', q(n))] : []), ...(unk ? [unknown('unknown')] : [])];
    const stock = stockFor([[q('300'), q('1', x)]], entries.length ? source(rice, entries) : none);
    const result = calculateMoney(input(stock, prices(estimate(), estimate(x, '490', '1'))));
    expect([value(result.money.C), value(result.money.A0)]).toEqual([R.of(520n), R.of(520n)]);
    expect(result.money.K).toEqual(decimal(K));
    expect(result.money.budgetAssessment.kind).toBe(status);
    if (total === null) {
      for (const k of ['A1', 'E', 'T', 'O'] as const) expect(codes(result.money[k])).toContain('STOCK_QUANTITY_REQUIRED');
      expect(result.money.unresolvedLineIds).toEqual([moneyLineId('shopping', 'plan', 'A', selection(estimate()).key)]);
      expect(result.lines.find(l => l.priceSelectionRef.basisRef.id === rice.ref.id)!.acquisition.kind).toBe('unavailable');
    } else {
      checkMoney(result, ['520', '520', total, decimal('520').sub(decimal(total)).n.toString(), total,
        decimal('500').sub(decimal(total)).n.toString()]);
      if (_id === 'K') {
        const line = result.lines.find(l => l.priceSelectionRef.basisRef.id === rice.ref.id)!;
        expect(line.demand.leftover.kind).toBe('unavailable');
        expect(line.demand.knownLeftover.value).toEqual(R.of(50n));
        expect(acquisition(result)).toMatchObject({ amountRub: ZERO, purchasedQuantity: q('0') });
      }
    }
  });

  it('RP-S02-O: unrelated unknown does not affect money', () => {
    const other = basis('other');
    const s = source(other, [unknown('other')]);
    const riceSource = source(rice, [known('rice', q('100'))]);
    const selected: StockSource = { mode: 'selected', selectedGroupIds: ['group', 'other'],
      groups: [...riceSource.groups, ...s.groups.map(g => g.kind === 'present'
        ? { ...g, group: { ...g.group, stockGroupId: 'other' } } : g)] };
    checkMoney(calculateMoney(input(stockFor([[q('300'), q('1', x)]], selected), prices(estimate(), estimate(x, '490', '1')))),
      ['520', '520', '510', '10', '510', '-10']);
  });

  it('RP-P01: one package after merging slots and deducting stock', () => {
    const result = calculateMoney(input(stockFor([[q('300')], [q('400')]], source(rice, [known('s', q('500'))])),
      prices(estimate(rice, '60', '400', true))));
    checkMoney(result, ['105', '120', '60', '60', '60', '440']);
    expect(acquisition(result)).toMatchObject({ packageCount: '1', purchasedQuantity: q('400') });
  });

  it('RP-C18: four products and slots match all independent monetary totals', () => {
    const carrot = basis('carrot'), water = basis('water', 'ml'), oil = basis('oil', 'ml');
    const records = [estimate(rice, '125.5', '500', true), estimate(carrot, '80.15', '1000'),
      estimate(water, '30.35', '1000', true), estimate(oil, '150.25', '250', true)];
    const items = [rice, carrot, water, oil];
    const selected: StockSource = { mode: 'selected', selectedGroupIds: ['g0', 'g1', 'g2', 'g3'],
      groups: items.map((b, i) => ({ kind: 'present', group: { stockGroupId: `g${i}`, groupVersion: '1',
        productRef: b.productRef, stateRef: b.stateRef, basis: b,
        entries: [known(`e${i}`, q(['200', '125', '300', '0'][i]!, b))] } })) };
    const slots = [['100', '100', '300', '20'], ['200', '100', '400', '20'],
      ['150', '100', '400', '20'], ['0', '200', '100', '10']]
      .map(row => row.flatMap((n, i) => n === '0' ? [] : [q(n, items[i]!)]));
    const result = calculateMoney(input(stockFor(slots, selected), prices(...records)));
    checkMoney(result, ['231.515', '376.525', '336.15625', '40.36875', '336.15625', '163.84375']);
    expect(result.slots.map(s => value(s.ingredientCostC)))
      .toEqual(['54.24', '82.375', '69.825', '25.075'].map(decimal));
    expect(items.map(b => acquisition(result, b).amountRub))
      .toEqual(['125.5', '30.05625', '30.35', '150.25'].map(decimal));
    expect(items.map(b => acquisition(result, b).purchasedQuantity.value)).toEqual(['500', '375', '1000', '250'].map(decimal));
  });

  it.each([
    ['245', '147.245', '150.25', '349.75', '1'], ['250', '150.25', '150.25', '349.75', '1'],
    ['250.001', '150.250601', '300.5', '199.5', '2'], ['265', '159.265', '300.5', '199.5', '2'],
  ])('RP-P02: x=%s before package ceil', (quantity, C, T, O, count) => {
    const oil = basis('oil', 'ml');
    const result = calculateMoney(input(stockFor([[q(quantity, oil)]]), prices(estimate(oil, '150.25', '250', true))));
    checkMoney(result, [C, T, T, '0', T, O]);
    expect(acquisition(result, oil)).toMatchObject({ packageCount: count });
  });

  it.each(['2026-10-13', '2026-10-20', '2026-11-10', '2026-11-11'])(
    'RP-OLD/COND/100: date %s does not expire an accepted dated estimate', evaluationDate => {
      const yogurt = basis('yogurt');
      const request = { ...input(stockFor([[q('100', yogurt)]]), prices(estimate(yogurt, '90', '300', true))), evaluationDate };
      const result = calculateMoney(request);
      checkMoney(result, ['30', '90', '90', '0', '90', '410']);
      expect(result.basis.prices).toEqual(request.prices);
      expect(acquisition(result, yogurt)).toMatchObject({ packageCount: '1', purchasedQuantity: q('300', yogurt) });
    });

  it.each(['missing', 'withdrawn'] as const)('RP-M/W/M0/W0: %s blocks even F(0)', kind => {
    for (const stockAmount of ['0', '100']) {
      const yogurt = basis('yogurt');
      const set = prices(estimate(yogurt, '90', '300', true), estimate(x, '40', '1'));
      const original = set.selections[0]!;
      const resolution: ReferencePriceSelection['resolution'] = kind === 'missing'
        ? { kind, missingFields: ['referenceSale.packageContent'], reasons: [{ code: 'PRICE_BASIS_MISSING', explanation: 'No package evidence' }] }
        : { kind, estimateRef: set.estimates[0]!.ref, withdrawnOn: '2026-10-05', withdrawnBy: 'reviewer',
          decisionRef: ref('withdrawal'), evidenceRefs: [ref('evidence')],
          reasons: [{ code: 'PRICE_BASIS_MISSING', explanation: 'Wrong edible package' }] };
      const updated = { ...set, selections: [{ ...original, resolution }, set.selections[1]!] };
      const result = calculateMoney(input(stockFor([[q('100', yogurt), q('1', x)]],
        source(yogurt, [known('s', q(stockAmount, yogurt))])), updated));
      for (const field of ['C', 'A0', 'A1', 'E', 'T', 'O'] as const) {
        expect(codes(result.money[field])).toEqual([kind === 'missing' ? 'PRICE_ESTIMATE_MISSING' : 'PRICE_ESTIMATE_WITHDRAWN']);
      }
      expect(result.money.K).toEqual(R.of(40n));
      expect(result.money.unresolvedLineIds).toHaveLength(1);
      expect(new Set(result.money.unresolvedLineIds).size).toBe(1);
      expect(result.money.budgetAssessment.kind).toBe('unconfirmed');
      if (result.money.T.kind === 'unavailable') {
        expect(result.money.T.reasons[0]).toMatchObject({ details: { priceSetRef: set.ref, key: original.key,
          ...(kind === 'missing' ? { missingFields: ['referenceSale.packageContent'] }
            : { estimateRef: set.estimates[0]!.ref, withdrawnOn: '2026-10-05', withdrawalReason: 'Wrong edible package' }) } });
        if (kind === 'withdrawn') expect(result.money.T.reasons[0].code === 'PRICE_ESTIMATE_WITHDRAWN'
          && result.money.T.reasons[0].entityRefs).toContainEqual(ref('withdrawal'));
      }
      const independent = result.lines.find(l => l.priceSelectionRef.basisRef.id === x.ref.id)!;
      expect(value(independent.acquisition).amountRub).toEqual(R.of(40n));
    }
  });

  it.each([
    ['499.996', '0.004', 'confirmed'], ['500', '0', 'confirmed'],
    ['500.004', '-0.004', 'violated'], ['500.005', '-0.005', 'violated'],
  ])('RP-B-E/R: exact T=%s, independent of display', (p, O, status) => {
    const result = calculateMoney(input(stockFor([[q('1', x)]]), prices(estimate(x, p, '1'))));
    checkMoney(result, [p, p, p, '0', p, O]);
    expect(result.money.budgetAssessment.kind).toBe(status);
    if (p === '500.004') {
      expect(formatMoney(value(result.money.T))).toBe('500,00 ₽');
      expect(formatMoney(value(result.money.O))).toBe('0,00 ₽');
      expect(result.money.budgetAssessment).toMatchObject({ code: 'BUDGET_EXCEEDED', excessRub: R.of(1n, 250n) });
    }
  });

  it('RP-R02: sums exact lines, never displayed cents', () => {
    const y = basis('Y', 'pcs'), z = basis('Z', 'pcs');
    const result = calculateMoney(input(stockFor([[q('1', x), q('1', y), q('1', z)]]),
      prices(estimate(x, '0.335', '1'), estimate(y, '0.335', '1'), estimate(z, '0.335', '1'))));
    checkMoney(result, ['1.005', '1.005', '1.005', '0', '1.005', '498.995']);
    expect(formatMoneySum(result.lines.map(l => value(l.acquisition).amountRub)))
      .toEqual({ rows: ['0,34 ₽', '0,34 ₽', '0,34 ₽'], total: '1,01 ₽', explanation: 'Итог рассчитан до округления строк' });
  });
});

describe('price conversion and partial dependencies', () => {
  it('explicit g selection resolves a per-kg estimate', () => {
    const e = estimate(basis('rice', 'kg'), '100', '1');
    const set = { ...prices(e), selections: [selection(e, rice)] };
    const result = calculateMoney(input(stockFor([[q('700')]], source(rice, [known('s', q('200'))])), set));
    checkMoney(result, ['70', '70', '50', '20', '50', '450']);
    expect(acquisition(result).requestedQuantity).toEqual(q('0.5', e.priceBasis.basis));
  });

  it('confirmed piece→g chain is shared by C, A0 and A1', () => {
    const pcs = basis('rice', 'pcs'), e = estimate();
    const set = { ...prices(e), selections: [selection(e, pcs, [conversion(pcs, rice)])] };
    const result = calculateMoney(input(stockFor([[q('2', pcs)]], source(pcs, [known('s', q('1', pcs))])), set));
    checkMoney(result, ['10', '10', '5', '5', '5', '495']);
  });

  it('reverse direction is explicit and fractional pieces are not rounded to whole pieces', () => {
    const pcs = basis('rice', 'pcs'), e = estimate(pcs, '20', '1');
    const step = { ...conversion(pcs, rice), direction: 'reverse' as const };
    const set = { ...prices(e), selections: [selection(e, rice, [step])] };
    const result = calculateMoney(input(stockFor([[q('25')]]), set));
    checkMoney(result, ['10', '10', '10', '0', '10', '490']);
    expect(acquisition(result).purchasedQuantity).toEqual(q('0.5', pcs));
  });

  it('confirmed two-step chain may cross states, preserving each coefficient', () => {
    const pcs = basis('rice', 'pcs'), ml = basis('rice', 'ml');
    const cooked = { ...rice, ref: ref('cooked-g'), stateRef: ref('rice-cooked') };
    const e = estimate(cooked, '100', '1000');
    const a = conversion(pcs, ml, R.of(100n));
    const b = { ...conversion(ml, cooked, R.of(2n)), conversion: {
      ...conversion(ml, cooked, R.of(2n)).conversion, ref: ref('second-conversion'),
    } };
    const set = { ...prices(e), selections: [selection(e, pcs, [a, b])] };
    const result = calculateMoney(input(stockFor([[q('2', pcs)]]), set));
    checkMoney(result, ['40', '40', '40', '0', '40', '460']);
    expect(result.basis.prices.selections[0]!.steps).toEqual([a, b]);
  });

  it.each(['absent', 'unconfirmed', 'range'] as const)('unavailable conversion: %s', mode => {
    const pcs = basis('rice', 'pcs'), e = estimate();
    let step = conversion(pcs, rice);
    if (mode === 'unconfirmed') step = { ...step, confirmation: { kind: 'unconfirmed' } };
    if (mode === 'range') step = { ...step, conversion: { ...step.conversion, applicability: {
      conditions: 'bounded', fromRange: { min: R.of(3n), max: R.of(4n), minInclusive: true, maxInclusive: true },
    } } };
    const set = { ...prices(e), selections: [selection(e, pcs, mode === 'absent' ? [] : [step])] };
    const result = calculateMoney(input(stockFor([[q('2', pcs)]]), set));
    expect(codes(result.money.C)).toEqual(['CONVERSION_MISSING']);
    expect(codes(result.money.T)).toEqual(['CONVERSION_MISSING']);
    expect(result.money.K).toEqual(ZERO);
    expect(result.money.budgetAssessment.kind).toBe('unconfirmed');
  });

  it('range limits are checked separately for ingredient use, R and d', () => {
    const pcs = basis('rice', 'pcs'), e = estimate();
    const step = conversion(pcs, rice);
    const bounded: ConversionStep = { ...step, conversion: { ...step.conversion, applicability: {
      conditions: 'only two or more', fromRange: { min: R.of(2n), max: R.of(10n), minInclusive: true, maxInclusive: true },
    } } };
    const set = { ...prices(e), selections: [selection(e, pcs, [bounded])] };
    const result = calculateMoney(input(stockFor([[q('2', pcs)]], source(pcs, [known('s', q('1', pcs))])), set));
    expect([value(result.money.C), value(result.money.A0)]).toEqual([R.of(10n), R.of(10n)]);
    expect(codes(result.money.T)).toEqual(['CONVERSION_MISSING']);
  });

  it('an absent required price translation between states is CONVERSION_MISSING', () => {
    const cooked = { ...rice, ref: ref('cooked-g'), stateRef: ref('rice-cooked') };
    const e = estimate(cooked);
    const result = calculateMoney(input(stockFor([[q('100')]]), { ...prices(e), selections: [selection(e, rice)] }));
    expect(codes(result.money.C)).toEqual(['CONVERSION_MISSING']);
    expect(codes(result.money.T)).toEqual(['CONVERSION_MISSING']);
  });

  it('mixed unknown stock + missing price preserves both independent causes and unique rows', () => {
    const set = prices(estimate(), estimate(x, '40', '1'));
    const missing: ReferencePriceSelection = { ...set.selections[1]!, resolution: { kind: 'missing',
      missingFields: ['amountRub'], reasons: [{ code: 'SOURCE_MISSING', explanation: 'No amount' }] } };
    const result = calculateMoney(input(stockFor([[q('300'), q('1', x)]], source(rice, [unknown('s')])),
      { ...set, selections: [set.selections[0]!, missing] }));
    expect(codes(result.money.C)).toEqual(['PRICE_ESTIMATE_MISSING']);
    expect(codes(result.money.A0)).toEqual(['PRICE_ESTIMATE_MISSING']);
    expect(codes(result.money.T).sort()).toEqual(['PRICE_ESTIMATE_MISSING', 'STOCK_QUANTITY_REQUIRED']);
    expect(result.money.K).toEqual(ZERO);
    expect(result.money.unresolvedLineIds).toHaveLength(2);
  });

  it('fully covered packaged demand gives zero packages with complete price evidence', () => {
    const result = calculateMoney(input(stockFor([[q('100')]], source(rice, [known('s', q('150')), unknown('u')])),
      prices(estimate(rice, '90', '300', true))));
    checkMoney(result, ['30', '90', '0', '90', '0', '500']);
    expect(acquisition(result)).toMatchObject({ packageCount: '0', purchasedQuantity: q('0') });
  });

  it('large package counts stay integer strings beyond Number precision', () => {
    const result = calculateMoney(input(stockFor([[q('9007199254740993')]]), prices(estimate(rice, '1', '1', true))));
    expect(acquisition(result)).toMatchObject({ packageCount: '9007199254740993', amountRub: R.of(9007199254740993n) });
  });

  it('missing price and unknown deficit on the same row retain both causes', () => {
    const set = prices(estimate());
    const selection = { ...set.selections[0]!, resolution: { kind: 'missing' as const,
      missingFields: ['amountRub'] as const, reasons: [{ code: 'SOURCE_MISSING', explanation: 'Unknown price' }] as const } };
    const result = calculateMoney(input(stockFor([[q('300')]], source(rice, [unknown('u')])),
      { ...set, selections: [selection] }));
    expect(codes(result.money.A0)).toEqual(['PRICE_ESTIMATE_MISSING']);
    expect(codes(result.money.T).sort()).toEqual(['PRICE_ESTIMATE_MISSING', 'STOCK_QUANTITY_REQUIRED']);
    expect(result.money.unresolvedLineIds).toHaveLength(1);
  });

  it('even K above the limit does not replace an incomplete T assessment', () => {
    const result = calculateMoney(input(stockFor([[q('300'), q('1', x)]], source(rice, [unknown('u')])),
      prices(estimate(), estimate(x, '600', '1'))));
    expect(result.money.K).toEqual(R.of(600n));
    expect(result.money.budgetAssessment.kind).toBe('unconfirmed');
    expect(result.money.T.kind).toBe('unavailable');
  });

  it('IDs and monetary results survive reordering of lines and catalog selections', () => {
    const stock = stockFor([[q('300'), q('1', x)]]);
    const a = input(stock, prices(estimate(), estimate(x, '40', '1')));
    const b = { ...a, stock: { ...stock, lines: [...stock.lines].reverse() },
      prices: { ...a.prices, estimates: [...a.prices.estimates].reverse(), selections: [...a.prices.selections].reverse() } };
    expect(calculateMoney(a).lines).toEqual(calculateMoney(b).lines);
    expect(calculateMoney(a).money).toEqual(calculateMoney(b).money);
  });
});

describe('invalid graphs are not business incompleteness', () => {
  const request = () => input(stockFor([[q('100')]]));
  it.each([
    ['duplicate selection', (a: MoneyCalculationInput) => ({ ...a, prices: { ...a.prices, selections: [...a.prices.selections, a.prices.selections[0]!] } })],
    ['duplicate estimate', (a: MoneyCalculationInput) => ({ ...a, prices: { ...a.prices, estimates: [...a.prices.estimates, a.prices.estimates[0]!] } })],
    ['wrong set version', (a: MoneyCalculationInput) => ({ ...a, versions: { ...a.versions, priceSetRef: ref('price-set', '2') } })],
    ['foreign catalog', (a: MoneyCalculationInput) => ({ ...a, versions: { ...a.versions, catalogVersion: 'other' } })],
    ['omitted key', (a: MoneyCalculationInput) => ({ ...a, prices: { ...a.prices, selections: [] } })],
    ['unresolved estimate', (a: MoneyCalculationInput) => ({ ...a, prices: { ...a.prices, estimates: [] } })],
    ['zero price without evidence', (a: MoneyCalculationInput) => ({ ...a, prices: { ...a.prices, estimates: [{ ...a.prices.estimates[0]!, amountRub: ZERO }] } })],
    ['negative price', (a: MoneyCalculationInput) => ({ ...a, prices: { ...a.prices, estimates: [{ ...a.prices.estimates[0]!, amountRub: R.of(-1n) }] } })],
    ['zero denominator quantity', (a: MoneyCalculationInput) => ({ ...a, prices: { ...a.prices, estimates: [{ ...a.prices.estimates[0]!, priceBasis: q('0') }] } })],
    ['noncanonical recordVersion', (a: MoneyCalculationInput) => ({ ...a, prices: { ...a.prices, ref: ref('price-set', '0') } })],
    ['recordVersion with trailing newline', (a: MoneyCalculationInput) => ({ ...a, prices: { ...a.prices, ref: ref('price-set', '1\n') } })],
    ['future publication', (a: MoneyCalculationInput) => ({ ...a, evaluationDate: '2026-10-08' })],
    ['invalid calendar date', (a: MoneyCalculationInput) => ({ ...a, evaluationDate: '2026-02-30' })],
    ['duplicate demand', (a: MoneyCalculationInput) => ({ ...a, stock: { ...a.stock, lines: [...a.stock.lines, a.stock.lines[0]!] } })],
  ] as const)('%s throws', (_name, change) => {
    expect(() => calculateMoney(change(request()))).toThrow(/MONEY_/);
  });

  it('package content must exactly match the priced content', () => {
    const e = estimate(rice, '90', '300', true);
    const broken = { ...e, referenceSale: { kind: 'indivisible' as const, packageContent: q('301'), label: 'pack', sourceRefs: [ref('s')] } };
    expect(() => calculateMoney(input(stockFor([[q('100')]]), prices(broken)))).toThrow('MONEY_PAYLOAD_INVALID');
  });

  it('foreign estimate version is a broken reference, never a missing price fallback', () => {
    const a = request(), s = a.prices.selections[0]!;
    expect(() => calculateMoney({ ...a, prices: { ...a.prices, selections: [{ ...s,
      resolution: { kind: 'available', estimateRef: ref(a.prices.estimates[0]!.ref.id, '2') } }] } })).toThrow('MONEY_REFERENCE_MISSING');
  });

  it('a named conversion with the wrong input is corruption', () => {
    const pcs = basis('rice', 'pcs'), other = basis('rice', 'ml'), e = estimate();
    const set = { ...prices(e), selections: [selection(e, pcs, [conversion(other, rice)])] };
    expect(() => calculateMoney(input(stockFor([[q('2', pcs)]]), set))).toThrow('MONEY_PAYLOAD_INVALID');
  });

  it('conflicting basis definition cannot hide behind a valid key', () => {
    const a = request();
    const s = a.prices.selections[0]!;
    expect(() => calculateMoney({ ...a, prices: { ...a.prices, selections: [{ ...s,
      basis: { ...s.basis, definition: 'a different edible part' } }] } })).toThrow('MONEY_PAYLOAD_INVALID');
  });

  it('a foreign state version is corruption, not a missing physical conversion', () => {
    const a = request(), original = a.prices.estimates[0]!;
    const foreign = { ...original, stateRef: ref(rice.stateRef.id, '2'), priceBasis: {
      ...original.priceBasis, basis: { ...rice, ref: ref('foreign-g'), stateRef: ref(rice.stateRef.id, '2') },
    } };
    expect(() => calculateMoney({ ...a, prices: { ...a.prices, estimates: [foreign] } })).toThrow('MONEY_PAYLOAD_INVALID');
  });

  it('unknown price does not excuse a broken retained conversion reference', () => {
    const a = request(), s = a.prices.selections[0]!;
    const missing: ReferencePriceSelection = { ...s, steps: [conversion(basis('rice', 'ml'), rice)],
      resolution: { kind: 'missing', missingFields: ['amountRub'],
        reasons: [{ code: 'SOURCE_MISSING', explanation: 'No estimate' }] } };
    expect(() => calculateMoney({ ...a, prices: { ...a.prices, selections: [missing] } })).toThrow('MONEY_PAYLOAD_INVALID');
  });

  it('supported zero with explicit evidence is an actual price', () => {
    const e = { ...estimate(), amountRub: ZERO, zeroPriceEvidenceRefs: [ref('free-price-evidence')] };
    checkMoney(calculateMoney(input(stockFor([[q('100')]]), prices(e))), ['0', '0', '0', '0', '0', '500']);
  });

  it('empty demand and namespaced IDs remain deterministic', () => {
    checkMoney(calculateMoney(input(stockFor([]))), ['0', '0', '0', '0', '0', '500']);
    const key = selection(estimate()).key;
    expect(moneyLineId('shopping', 'a/b', 'c', key)).not.toBe(moneyLineId('shopping', 'a', 'b/c', key));
    expect(moneyLineId('shopping', 'p', 'v', key)).not.toBe(moneyLineId('demand', 'p', 'v', key));
  });
});

describe('published S1 reference catalog integration', () => {
  it('projects the actual published shape and calculates all 29 selected records', () => {
    // Test-only bridge, deliberately not a production codec/catalog adapter.
    type InputQuantity = { decimal: string; basisRef: EntityRef };
    type Catalog = {
      catalogVersion: string; publishedOn: string;
      states: { id: string; recordVersion: string; productRef: EntityRef }[];
      quantityBases: (Omit<QuantityBasis, 'ref' | 'productRef'> & EntityRef)[];
      priceObservations: (EntityRef & { observedOn: string; checkedOn: string })[];
      referencePriceEstimates: (EntityRef & Omit<ReferencePriceEstimate, 'ref' | 'amountRub' | 'priceBasis' | 'referenceSale' | 'observations' | 'zeroPriceEvidenceRefs'> & {
        amountRub: { n: string; d: string }; priceBasis: InputQuantity;
        referenceSale: { kind: 'by_quantity' } | { kind: 'indivisible'; packageContent: InputQuantity; label: string; sourceRefs: EntityRef[] };
        provenance: { observationRefs: EntityRef[] };
      })[];
      priceSet: EntityRef & Omit<ReferencePriceSet, 'ref' | 'catalogVersion' | 'publishedOn' | 'estimates' | 'selections'> & {
        selections: { key: ReferencePriceSelection['key']; resolution: ReferencePriceSelection['resolution']; conversionRefs: EntityRef[] }[];
      };
    };
    const catalog = JSON.parse(readFileSync(new URL('../../public/catalog/catalog-s1-reference-20261019-r1/snapshot.json', import.meta.url), 'utf8')) as Catalog;
    const same = (a: EntityRef, b: EntityRef) => a.id === b.id && a.recordVersion === b.recordVersion;
    const resolveBasis = (r: EntityRef): QuantityBasis => {
      const b = catalog.quantityBases.find(b => same(b, r))!;
      return { ref: r, stateRef: b.stateRef, productRef: catalog.states.find(s => same(s, b.stateRef))!.productRef,
        unit: b.unit, dimension: b.dimension, definition: b.definition };
    };
    const resolveQ = (a: InputQuantity): Quantity => ({ value: decimal(a.decimal), basis: resolveBasis(a.basisRef) });
    const estimates = catalog.referencePriceEstimates.map(e => ({ ...e, ref: ref(e.id, e.recordVersion),
      amountRub: R.of(BigInt(e.amountRub.n), BigInt(e.amountRub.d)), priceBasis: resolveQ(e.priceBasis),
      referenceSale: e.referenceSale.kind === 'by_quantity' ? e.referenceSale
        : { ...e.referenceSale, packageContent: resolveQ(e.referenceSale.packageContent) },
      zeroPriceEvidenceRefs: [], observations: e.provenance.observationRefs.map(r => {
        const o = catalog.priceObservations.find(o => same(o, r))!;
        return { ref: r, observedOn: o.observedOn, checkedOn: o.checkedOn };
      }),
    }));
    const set: ReferencePriceSet = { ...catalog.priceSet, ref: ref(catalog.priceSet.id, catalog.priceSet.recordVersion),
      catalogVersion: catalog.catalogVersion, publishedOn: catalog.publishedOn, estimates,
      selections: catalog.priceSet.selections.map(s => {
        expect(s.resolution.kind).toBe('available'); expect(s.conversionRefs).toEqual([]);
        return { ...s, basis: resolveBasis(s.key.basisRef), steps: [] };
      }) };
    expect(set.selections).toHaveLength(29);
    const stock = stockFor([set.selections.map(s => q('1', s.basis))]);
    const result = calculateMoney(input(stock, set));
    expect(result.lines).toHaveLength(29);
    expect(result.money.T.kind).toBe('available');
    expect(result.money.unresolvedLineIds).toEqual([]);
    for (const line of result.lines) {
      const est = estimates.find(e => same(e.ref, value(line.acquisition).estimateRef))!;
      const purchase = value(line.acquisition);
      expect(purchase.requestedQuantity.value).toEqual(ONE);
      expect(purchase.amountRub).toEqual(est.referenceSale.kind === 'indivisible'
        ? est.amountRub : est.amountRub.div(est.priceBasis.value));
    }
    expect(result.basis.prices.ref).toEqual(ref('price-set-s106-reference'));
  });
});
