import { describe, expect, it } from 'vitest';
import { NUTRIENTS } from './nutrition';
import type { Nutrients } from './nutrition';
import type { EntityRef, Quantity } from './quantity';
import type { CalculatedMoney } from './money';
import { checkRecipeEligibility } from './eligibility';
import { Rational } from './rational';
import { baseline, decimal, eligibility, exact, get, load, read, run } from '../../checks/S1-13/domain-projection';

// These expectations are written ONLY by independent.py (Python Fraction).
type Contribution = { slot: string; order: number; recipeRef: EntityRef; ingredientId: string;
  source: string; scaled: string; C: string; stockUsed: string | null };
type ExpectedLine = { basisRef: EntityRef; stateRef: EntityRef; productRef: EntityRef; estimateRef: EntityRef;
  R: string; S: string | null; used: string | null; deficit: string | null; leftover: string | null;
  C: string; A0: string; A1: string | null; packageContent: string; packagePrice: string;
  packagesWithoutStock: number; packages: number | null; purchased: string | null; purchaseSurplus: string | null;
  contributions: Contribution[] };
type Expected = { id: string; outcome: string; budgetStatus: string;
  slots: { slot: string; recipeRef: EntityRef; factor: string; whole: Nutrients<string>;
    perPerson: Nutrients<string>; totalMinutes: string; C: string }[];
  dayWhole: Nutrients<string>; dayPerPerson: Nutrients<string>;
  goals: Nutrients<{ actual: string; goal: string; min: string; max: string; status: string }>;
  lines: ExpectedLine[]; money: Record<'C' | 'A0' | 'A1' | 'E' | 'T' | 'O' | 'K', string | null> };
type Oracle = { catalogVersion: string; scenarios: Expected[];
  incompatibilityProof: { recipeRef: EntityRef; proteinPerPerson: string }[];
  H3TimeUnknown: { recipeRef: EntityRef; factor: string }[];
  unknownStockWitnesses: { stockG: string; T: string; O: string; budgetStatus: string }[] };
function available<T>(value: { kind: 'available'; value: T } | { kind: 'unavailable' }): T {
  expect(value.kind).toBe('available');
  if (value.kind !== 'available') throw new Error('Expected available');
  return value.value;
}
function number(value: Rational, expected: string | null): void {
  expect(expected).not.toBeNull();
  expect(value).toEqual(exact(expected!));
}
function money(value: CalculatedMoney, expected: string | null): void {
  if (expected === null) expect(value.kind).toBe('unavailable');
  else number(available(value), expected);
}
function amount(value: CalculatedMoney<Quantity>, expected: string | null): void {
  if (expected === null) expect(value.kind).toBe('unavailable');
  else number(available(value).value, expected);
}

describe('S1-13 real frozen catalog / independent Fraction oracle', () => {
  const fixture = load();
  const oracle = read<Oracle>('expected.json');

  for (const scenario of fixture.inputs.scenarios) {
    it(`${scenario.id}: scales, nutrition, provenance, stock, packages, all money and hard checks`, () => {
      const expected = oracle.scenarios.find(x => x.id === scenario.id)!;
      const result = run(fixture, scenario);
      expect(oracle.catalogVersion).toBe(fixture.catalog.catalogVersion);
      expect(result.eligibility).toHaveLength(4);
      for (const [index, wanted] of expected.slots.entries()) {
        const scaled = result.scaled[index]!, slot = result.slots[index]!, check = result.eligibility[index]!;
        expect(scaled.baseline.source.recipeRef).toEqual(wanted.recipeRef);
        number(scaled.factor, wanted.factor);
        expect(check.eligible).toBe(true);
        expect([check.data.kind, check.time.kind, check.mealType.kind, check.assessment.kind])
          .toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed']);
        expect(check.selectedDiets).toEqual(['no_fish']);
        expect(check.dietAssessments.find(d => d.diet === 'no_fish')!.status).toBe('confirmed');
        number(check.time.totalMinutes!, wanted.totalMinutes);
        expect(check.requiredGoodsRequirements).toHaveLength(scaled.ingredients.length);
        expect(check.requiredGoodsRequirements.every(g => g.diet === 'no_fish' && g.kind === 'composition')).toBe(true);
        for (const metric of NUTRIENTS) {
          number(scaled.nutrition[metric], wanted.whole[metric]);
          number(available(slot.wholeNutrition[metric]), wanted.whole[metric]);
          number(available(slot.perPersonNutrition[metric]), wanted.perPerson[metric]);
        }
        money(result.money.slots.find(s => s.slotId === wanted.slot)!.ingredientCostC, wanted.C);
      }
      for (const metric of NUTRIENTS) {
        number(available(result.day.wholeNutrition[metric]), expected.dayWhole[metric]);
        number(available(result.day.perPersonNutrition[metric]), expected.dayPerPerson[metric]);
        const comparison = result.comparisons[metric], wanted = expected.goals[metric];
        expect(comparison.kind).toBe(wanted.status);
        number(comparison.range!.min, wanted.min);
        number(comparison.range!.max, wanted.max);
      }
      expect(result.demand.lines).toHaveLength(expected.lines.length);
      expect(result.stock.lines).toHaveLength(expected.lines.length);
      expect(result.money.lines).toHaveLength(expected.lines.length);
      for (const wanted of expected.lines) {
        const d = result.demand.lines.find(l => l.required.basis.ref.id === wanted.basisRef.id)!;
        const s = result.stock.lines.find(l => l.key === d.key)!;
        const m = result.money.lines.find(l => l.demand.key === d.key)!;
        expect(d.required.basis.ref).toEqual(wanted.basisRef);
        expect(d.required.basis.productRef).toEqual(wanted.productRef);
        expect(d.required.basis.stateRef).toEqual(wanted.stateRef);
        number(d.required.value, wanted.R);
        amount(s.stockTotal, wanted.S);
        amount(s.usedTotal, wanted.used);
        amount(s.deficit, wanted.deficit);
        amount(s.leftover, wanted.leftover);
        expect(d.contributions).toHaveLength(wanted.contributions.length);
        for (const contribution of wanted.contributions) {
          const actual = d.contributions.find(c => c.slotId === contribution.slot && c.ingredientId === contribution.ingredientId)!;
          expect(actual.recipeRef).toEqual(contribution.recipeRef);
          expect(actual.order).toBe(contribution.order);
          number(actual.source.value, contribution.source);
          number(actual.wholeRecipe.value, contribution.source); // all accepted source inputs are whole B
          number(actual.scaled.value, contribution.scaled);
          number(actual.quantity.value, contribution.scaled);
          number(actual.normalizationFactor, '1');
          const cost = m.contributions.find(c => c.contribution.slotId === contribution.slot
            && c.contribution.ingredientId === contribution.ingredientId)!;
          money(cost.ingredientCost, contribution.C);
          if (contribution.stockUsed !== null) {
            const allocated = s.slots.find(c => c.slotId === contribution.slot)!.contributions
              .find(c => c.contribution.ingredientId === contribution.ingredientId)!;
            number(allocated.aKnown.value, contribution.stockUsed);
          }
        }
        money(m.ingredientCost, wanted.C);
        const a0 = available(m.withoutStockAcquisition);
        number(a0.amountRub, wanted.A0);
        expect(a0.estimateRef).toEqual(wanted.estimateRef);
        expect(a0.saleKind).toBe('indivisible');
        if (a0.saleKind === 'indivisible') expect(a0.packageCount).toBe(String(wanted.packagesWithoutStock));
        if (wanted.A1 === null) {
          expect(m.acquisition.kind).toBe('unavailable');
          if (m.acquisition.kind === 'unavailable') {
            expect(m.acquisition.reasons.map(r => r.code)).toContain('STOCK_QUANTITY_REQUIRED');
          }
        } else {
          const acquisition = available(m.acquisition);
          expect(acquisition.estimateRef).toEqual(wanted.estimateRef);
          number(acquisition.requestedQuantity.value, wanted.deficit);
          number(acquisition.purchasedQuantity.value, wanted.purchased);
          number(acquisition.amountRub, wanted.A1);
          number(acquisition.purchasedQuantity.value.sub(acquisition.requestedQuantity.value), wanted.purchaseSurplus);
          expect(acquisition.saleKind).toBe('indivisible');
          if (acquisition.saleKind === 'indivisible') {
            expect(acquisition.packageCount).toBe(String(wanted.packages));
            number(acquisition.packageContent.value, wanted.packageContent);
          }
        }
      }
      for (const key of ['C', 'A0', 'A1', 'E', 'T', 'O'] as const) money(result.money.money[key], expected.money[key]);
      number(result.money.money.K, expected.money.K);
      expect(result.money.money.budgetAssessment.kind).toBe(expected.budgetStatus);
      expect(result.money.basis.versions.priceSetRef).toEqual(fixture.inputs.priceSetRef);
      expect(result.money.basis.prices.setDigest).toBe(fixture.inputs.priceSetDigest);
      const full = result.eligibility.every(e => e.eligible)
        && NUTRIENTS.every(k => result.comparisons[k].kind === 'confirmed')
        && result.money.money.budgetAssessment.kind === 'confirmed';
      expect(full).toBe(expected.outcome === 'feasible');
    });
  }

  it('second run changes exact money by one mozzarella package; stock is allocated once across repeats', () => {
    const first = run(fixture, fixture.inputs.scenarios[0]!), next = run(fixture, fixture.inputs.scenarios[1]!);
    number(available(first.money.money.T), '2235');
    number(available(next.money.money.T), '2076');
    number(available(first.money.money.T).sub(available(next.money.money.T)), '159');
    const allocations = (r: typeof first, suffix: string) => r.stock.lines.find(l => l.required.basis.ref.id.endsWith(suffix))!
      .slots.map(s => s.aKnown.value);
    expect(allocations(first, 'mozzarella-g')).toEqual(['100', '0'].map(exact));
    expect(allocations(next, 'mozzarella-g')).toEqual(['150', '50'].map(exact));
    expect(allocations(first, 'milk-g')).toEqual(['200', '180'].map(exact));
    expect(first.demand).toEqual(next.demand);
    expect(first.day).toEqual(next.day);
  });

  it('protein=0 is globally incompatible: both approved breakfasts alone exceed the whole daily upper bound', () => {
    const breakfast = fixture.catalog.recipes.filter(r => r.mealTypes.includes('breakfast'));
    expect(breakfast.map(r => r.id).sort()).toEqual(oracle.incompatibilityProof.map(p => p.recipeRef.id).sort());
    for (const proof of oracle.incompatibilityProof) {
      const b = baseline(fixture.catalog, get(fixture.catalog.recipes, proof.recipeRef));
      const protein = b.nutrition.proteinG.div(b.baseServings);
      number(protein, proof.proteinPerPerson);
      expect(protein.compare(decimal('0'))).toBe(1);
    }
    for (const recipe of fixture.catalog.recipes) {
      expect(NUTRIENTS.every(k => baseline(fixture.catalog, recipe).nutrition[k].n >= 0n)).toBe(true);
    }
  });

  it('H=3 has no time evidence for any recipe; it cannot prove absence of a solution', () => {
    expect(oracle.H3TimeUnknown).toHaveLength(fixture.catalog.recipes.length);
    for (const gap of oracle.H3TimeUnknown) {
      const recipe = get(fixture.catalog.recipes, gap.recipeRef);
      const factor = decimal('3').div(decimal(recipe.baseServings));
      number(factor, gap.factor);
      expect(recipe.timeEvidence.some(t => factor.compare(decimal(t.scaleRange.min)) >= 0
        && factor.compare(decimal(t.scaleRange.max)) <= 0)).toBe(false);
    }
    for (const menu of fixture.inputs.menu) {
      const result = checkRecipeEligibility(eligibility(fixture, menu.recipeRef, menu.slot, 3));
      expect(result.eligible).toBe(false);
      expect(result.time.kind).toBe('unconfirmed');
      expect(result.time.reasons.map(r => r.code)).toEqual(['SOURCE_MISSING']);
    }
  });

  it('unknown stock affects budget eligibility: two possible quantities give opposite budget outcomes', () => {
    for (const witness of oracle.unknownStockWitnesses) {
      const result = run(fixture, { ...fixture.inputs.scenarios[3]!, mozzarellaStockG: witness.stockG });
      money(result.money.money.T, witness.T);
      money(result.money.money.O, witness.O);
      expect(result.money.money.budgetAssessment.kind).toBe(witness.budgetStatus);
    }
    const unknown = run(fixture, fixture.inputs.scenarios[3]!);
    money(unknown.money.money.C, '297773969/193500');
    money(unknown.money.money.A0, '2498');
    number(unknown.money.money.K, '1917');
    expect(unknown.money.money.budgetAssessment.kind).toBe('unconfirmed');
  });

  it('missing process evidence stays unknown, while a stricter 15-minute request proves the curd time violation', () => {
    const menu = fixture.inputs.menu[3]!, input = eligibility(fixture, menu.recipeRef, menu.slot);
    const noProcess = checkRecipeEligibility({ ...input, recipe: { ...input.recipe, processEvidenceRefs: [] } });
    expect(noProcess.dietAssessments.find(d => d.diet === 'no_fish')!.status).toBe('unknown');
    expect(noProcess.eligible).toBe(false);
    const tooShort = checkRecipeEligibility({ ...input, cookLimit: { maxMinutes: decimal('15') } });
    expect(tooShort.time.kind).toBe('violated');
    expect(tooShort.time.reasons.map(r => r.code)).toEqual(['TIME_LIMIT_EXCEEDED']);
  });

  it('repeated runs preserve inputs, fixture and stock; saved DietAssessment statuses are not inputs to the projection', () => {
    const before = JSON.stringify(fixture);
    const first = run(fixture, fixture.inputs.scenarios[0]!);
    run(fixture, fixture.inputs.scenarios[1]!);
    expect(run(fixture, fixture.inputs.scenarios[0]!)).toEqual(first);
    expect(JSON.stringify(fixture)).toBe(before);
    // The typed view excludes old DietAssessmentDTO entirely. Remove the raw field too.
    const withoutAssessments = JSON.parse(before, (key: string, value: unknown) => key === 'dietAssessments' ? undefined : value) as typeof fixture;
    expect(run(withoutAssessments, withoutAssessments.inputs.scenarios[0]!).eligibility).toEqual(first.eligibility);
  });
});
