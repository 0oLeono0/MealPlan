import { describe, expect, it } from 'vitest';
import { Rational as R } from './rational';
import { RecipeBaseline, scaleRecipe } from './recipeScale';
import { formatEnergy, formatMacronutrient } from './presentation';
import { calculateSlotNutrition, calculateDayNutrition, compareDayNutrition, parseNutritionGoal, NUTRIENTS } from './nutrition';
import type { MissingNutrition, Nutrient, Nutrients, NutritionGoal, NutritionValue } from './nutrition';

const r = (n: bigint, d = 1n) => R.of(n, d);
const base = { kcal: r(390n), proteinG: r(8n), fatG: r(1n), carbsG: r(87n) };
const goals: Nutrients<NutritionGoal> = {
  kcal: { kind: 'valid', value: base.kcal }, proteinG: { kind: 'valid', value: base.proteinG },
  fatG: { kind: 'valid', value: base.fatG }, carbsG: { kind: 'valid', value: base.carbsG },
};
const unknown: MissingNutrition = { kind: 'unknown', reasons: [{ code: 'SOURCE_MISSING',
  path: '/recipes/example/nutrition', entityRefs: [{ id: 'example', recordVersion: '1' }],
  sourceRefs: [], details: { explanation: 'No source for this nutrient' } }] };
function values(n: Nutrients<NutritionValue>): unknown[] {
  return NUTRIENTS.map(key => n[key].kind === 'available' ? n[key].value : n[key].kind);
}
function dayFor(metric: Nutrient, person: R | MissingNutrition) {
  return calculateDayNutrition(2, [calculateSlotNutrition({ people: 2, nutrition: {
    kcal: r(780n), proteinG: r(16n), fatG: r(2n), carbsG: r(174n),
    [metric]: person instanceof R ? person.mul(r(2n)) : person,
  } })]);
}

describe('E02: whole original B → scaled slot → person → daily occurrences', () => {
  function baseline(b = r(3n), inputBasis: 'whole_recipe' | 'per_serving' = 'whole_recipe') {
    return RecipeBaseline.fromSource({ recipeRef: { id: 'salad', recordVersion: '1' }, baseServings: b,
      baseServingsEvidenceRefs: [{ id: 'E01', recordVersion: '1' }], portionMeaning: 'one original portion', inputBasis,
      ingredients: [{ ingredientId: 'tomato', quantity: { value: r(450n), basis: {
        ref: { id: 'g', recordVersion: '1' }, productRef: { id: 'tomato', recordVersion: '1' },
        stateRef: { id: 'raw', recordVersion: '1' }, dimension: 'mass', unit: 'g', definition: 'raw edible g',
      } } }], timeEvidence: [],
      nutrition: { kcal: r(225n, 2n), proteinG: r(57n, 10n), fatG: r(21n, 20n), carbsG: r(399n, 20n) },
    });
  }

  it('matches the independent E02-S/P/D/G tables, counting the same recipe four times', () => {
    const source = baseline();
    const scaled = scaleRecipe(source, 2);
    const slot = calculateSlotNutrition(scaled);
    expect(values(slot.wholeNutrition)).toEqual([r(75n), r(19n, 5n), r(7n, 10n), r(133n, 10n)]);
    expect(values(slot.perPersonNutrition)).toEqual([r(75n, 2n), r(19n, 10n), r(7n, 20n), r(133n, 20n)]);
    const day = calculateDayNutrition(2, [slot, slot, null, slot, slot]);
    expect(values(day.wholeNutrition)).toEqual([r(300n), r(76n, 5n), r(14n, 5n), r(266n, 5n)]);
    expect(values(day.perPersonNutrition)).toEqual([r(150n), r(38n, 5n), r(7n, 5n), r(133n, 5n)]);
    const result = compareDayNutrition(day, { kcal: { kind: 'valid', value: r(150n) },
      proteinG: { kind: 'valid', value: r(38n, 5n) }, fatG: { kind: 'valid', value: r(7n, 5n) },
      carbsG: { kind: 'valid', value: r(133n, 5n) } });
    expect(NUTRIENTS.map(key => result[key].kind)).toEqual(Array(4).fill('confirmed'));
    expect(NUTRIENTS.map(key => [result[key].range?.min, result[key].range?.max])).toEqual([
      [r(135n), r(165n)], [r(171n, 25n), r(209n, 25n)], [r(63n, 50n), r(77n, 50n)],
      [r(1197n, 50n), r(1463n, 50n)],
    ]);
    expect(calculateDayNutrition(2, [slot, slot, null, slot, slot])).toEqual(day);
    expect(source.nutrition.kcal).toEqual(r(225n, 2n));
  });

  it.each([
    [1, r(3n), r(1n), r(75n, 2n), r(75n, 2n)],
    [4, r(3n), r(1n), r(150n), r(75n, 2n)],
    [2, r(4n), r(2n), r(225n, 2n), r(225n, 4n)],
    [2, r(3n, 2n), r(1n, 2n), r(75n), r(75n, 2n)],
  ])('keeps exact bases for H=%s B=%s M=%s', (h, b, m, total, person) => {
    const slot = calculateSlotNutrition(scaleRecipe(baseline(b), h, m));
    expect(slot.wholeNutrition.kcal).toEqual({ kind: 'available', value: total });
    expect(slot.perPersonNutrition.kcal).toEqual({ kind: 'available', value: person });
    expect(calculateDayNutrition(h, [slot]).perPersonNutrition).toEqual(slot.perPersonNutrition);
  });

  it('accepts per-serving normalization from S1-07 without applying B or H/B twice', () => {
    const slot = calculateSlotNutrition(scaleRecipe(baseline(r(4n), 'per_serving'), 2));
    expect(slot.wholeNutrition.kcal).toEqual({ kind: 'available', value: r(225n) });
    expect(slot.perPersonNutrition.kcal).toEqual({ kind: 'available', value: r(225n, 2n) });
  });

  it('empty slots and an empty day contribute exact zeros', () => {
    for (const slots of [[], [null, null]]) {
      expect(values(calculateDayNutrition(3, slots).perPersonNutrition)).toEqual([r(0n), r(0n), r(0n), r(0n)]);
    }
  });

  it('rejects inconsistent people counts and invalid slot values', () => {
    const slot = calculateSlotNutrition(scaleRecipe(baseline(), 2));
    expect(() => calculateDayNutrition(3, [slot])).toThrow('SLOT_PEOPLE_OR_BASIS_MISMATCH');
    for (const people of [0, 11, 1.5, NaN, Infinity]) {
      expect(() => calculateDayNutrition(people, [])).toThrow('PEOPLE_OUT_OF_RANGE');
      expect(() => calculateSlotNutrition({ people, nutrition: base })).toThrow('PEOPLE_OUT_OF_RANGE');
    }
    expect(() => calculateSlotNutrition({ people: 2, nutrition: { ...base, fatG: r(-1n) } })).toThrow('INVALID_NUTRITION');
  });
});

// Expected numbers below are transcribed from S1_CHECKS N01, not generated with production formulas.
const boundaries: [Nutrient, R, R, R, R][] = [
  ['kcal', r(351n), r(429n), r(350999n, 1000n), r(429001n, 1000n)],
  ['proteinG', r(36n, 5n), r(44n, 5n), r(7199n, 1000n), r(8801n, 1000n)],
  ['fatG', r(9n, 10n), r(11n, 10n), r(899n, 1000n), r(1101n, 1000n)],
  ['carbsG', r(783n, 10n), r(957n, 10n), r(78299n, 1000n), r(95701n, 1000n)],
];
describe('N01: 16 independent boundary comparisons before rounding', () => {
  for (const [metric, low, high, below, above] of boundaries) {
    it.each([
      [low, 'confirmed', 'within'], [high, 'confirmed', 'within'],
      [below, 'violated', 'below'], [above, 'violated', 'above'],
    ] as const)(`${metric}: %s → %s`, (person, kind, position) => {
      const result = compareDayNutrition(dayFor(metric, person), goals);
      expect(result[metric]).toMatchObject({ kind, position, range: { min: low, max: high } });
      for (const key of NUTRIENTS.filter(key => key !== metric)) expect(result[key].kind).toBe('confirmed');
      if (kind === 'violated') expect(result[metric]).toMatchObject({ code: 'NUTRITION_OUT_OF_RANGE' });
      const format = metric === 'kcal' ? formatEnergy : formatMacronutrient;
      expect(format(below)).toBe(format(low));
      expect(format(above)).toBe(format(high));
    });
  }
});

describe('N02: zero, unknown nutrient and absent goal stay distinct', () => {
  for (const metric of ['proteinG', 'fatG', 'carbsG'] as const) {
    it.each([[r(0n), 'confirmed'], [r(1n, 1000n), 'violated']] as const)(`${metric}: zero goal %s → %s`, (amount, kind) => {
      const result = compareDayNutrition(dayFor(metric, amount), { ...goals, [metric]: { kind: 'valid', value: r(0n) } });
      expect(result[metric]).toMatchObject({ kind, range: { min: r(0n), max: r(0n) } });
      expect(formatMacronutrient(amount)).toBe('0,0 г');
      expect(result[metric]).not.toHaveProperty('percent');
    });
  }
  it.each(NUTRIENTS)('%s unknown poisons only its daily sum and retains source reasons', metric => {
    const missingSlot = calculateSlotNutrition({ people: 2, nutrition: { ...base, [metric]: unknown } });
    const knownSlot = calculateSlotNutrition({ people: 2, nutrition: base });
    const day = calculateDayNutrition(2, [knownSlot, missingSlot, null]);
    const result = compareDayNutrition(day, goals);
    expect(day.wholeNutrition[metric]).toEqual({ kind: 'unavailable', reasons: unknown.reasons });
    expect(day.perPersonNutrition[metric]).toEqual(day.wholeNutrition[metric]);
    expect(result[metric]).toMatchObject({ kind: 'unconfirmed', causes: ['nutrition_unavailable'] });
    for (const key of NUTRIENTS.filter(key => key !== metric)) {
      expect(day.perPersonNutrition[key]).toEqual({ kind: 'available', value: base[key] });
      expect(result[key].kind).toBe('confirmed');
    }
  });
  it.each(['empty', 'invalid', 'unknown', 'technical_error'] as const)('%s goal preserves known menu nutrition', kind => {
    const goal: NutritionGoal = kind === 'technical_error' ? { kind, reason: 'RESOURCE_EXHAUSTED' } : { kind };
    const day = dayFor('kcal', base.kcal);
    for (const metric of NUTRIENTS) {
      const result = compareDayNutrition(day, { ...goals, [metric]: goal });
      expect(result[metric]).toMatchObject({ kind: 'unconfirmed', range: null, causes: [`goal_${kind}`] });
      expect(result[metric].actual).toEqual({ kind: 'available', value: base[metric] });
    }
  });
  it('retains both unknown nutrition and missing target causes', () => {
    expect(compareDayNutrition(dayFor('fatG', unknown), { ...goals, fatG: { kind: 'empty' } }).fatG)
      .toMatchObject({ kind: 'unconfirmed', causes: ['nutrition_unavailable', 'goal_empty'], range: null });
  });
  it('validates restored typed goals too: kcal zero, negative macros, nondecimal target', () => {
    for (const [metric, value] of [['kcal', r(0n)], ['fatG', r(-1n)], ['proteinG', r(1n, 3n)]] as const) {
      expect(compareDayNutrition(dayFor(metric, r(1n)), { ...goals, [metric]: { kind: 'valid', value } })[metric])
        .toMatchObject({ kind: 'unconfirmed', goal: { kind: 'invalid' }, range: null });
    }
  });
});

describe('manual target parsing: S0-08 domain validation', () => {
  it.each(['NaN', 'Infinity', '1e3', '+1', '-0', '-1', '1 000', '1 г', '1,2.3', '.1', '1.'])('rejects %s', raw => {
    for (const metric of NUTRIENTS) expect(parseNutritionGoal(metric, raw).kind).toBe('invalid');
  });
  it('keeps empty distinct, allows exact zero macros and positive arbitrary precision kcal', () => {
    for (const metric of NUTRIENTS) expect(parseNutritionGoal(metric, '  ').kind).toBe('empty');
    expect(parseNutritionGoal('kcal', '0').kind).toBe('invalid');
    for (const metric of ['proteinG', 'fatG', 'carbsG'] as const) {
      expect(parseNutritionGoal(metric, '0')).toEqual({ kind: 'valid', value: r(0n) });
    }
    expect(parseNutritionGoal('kcal', ' 0,00000000000000000001 ')).toEqual({ kind: 'valid', value: r(1n, 100000000000000000000n) });
    expect(parseNutritionGoal('fatG', '1.2300')).toEqual({ kind: 'valid', value: r(123n, 100n) });
  });
});
