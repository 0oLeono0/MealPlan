import { describe, expect, it } from 'vitest';
import { Rational as R } from './rational';
import { RecipeBaseline, scaleRecipe } from './recipeScale';
import type { RecipeScaleSource } from './recipeScale';
import { formatQuantity } from './presentation';

function source(baseServings = R.of(3n)): RecipeScaleSource {
  const sourceRef = { id: 'S1-CHECKS-v1', recordVersion: '1' };
  return { recipeRef: { id: 'E', recordVersion: '1' }, baseServings,
    baseServingsEvidenceRefs: [sourceRef], portionMeaning: 'One third of the whole salad', inputBasis: 'whole_recipe',
    ingredients: [450n, 150n].map((n, index) => ({ ingredientId: `ingredient-${index}`, quantity: {
      value: R.of(n), basis: { ref: { id: `basis-${index}`, recordVersion: '1' },
        productRef: { id: `product-${index}`, recordVersion: '1' },
        stateRef: { id: `state-${index}`, recordVersion: '1' }, dimension: 'mass', unit: 'g', definition: 'raw edible part' },
    } })),
    nutrition: { kcal: R.of(225n, 2n), proteinG: R.of(57n, 10n), fatG: R.of(21n, 20n), carbsG: R.of(399n, 20n) },
    timeEvidence: [{ ref: { id: 'time-E', recordVersion: '1' }, totalMinutes: R.of(10n),
      scaleRange: { min: R.of(3n, 10n), max: R.of(17n, 5n), minInclusive: true, maxInclusive: true },
      conditions: 'S1-CHECKS-v1 conditions', sourceRefs: [sourceRef] }],
  };
}

describe('F01–F04: scale from the immutable original B', () => {
  it('F01: retains k=1/3, q0, N0, B, sources and time without rounding', () => {
    const baseline = RecipeBaseline.fromSource(source());
    const scaled = scaleRecipe(baseline, 1);
    expect(scaled.factor).toEqual({ n: 1n, d: 3n });
    expect(scaled.ingredients.map(i => i.quantity.value)).toEqual([{ n: 150n, d: 1n }, { n: 50n, d: 1n }]);
    expect(scaled.nutrition).toEqual({ kcal: { n: 75n, d: 2n }, proteinG: { n: 19n, d: 10n },
      fatG: { n: 7n, d: 20n }, carbsG: { n: 133n, d: 20n } });
    expect(baseline.baseServings).toEqual({ n: 3n, d: 1n });
    expect(baseline.ingredients.map(i => i.quantity.value)).toEqual([{ n: 450n, d: 1n }, { n: 150n, d: 1n }]);
    expect(baseline.nutrition.kcal).toEqual({ n: 225n, d: 2n });
    expect(scaled.timeEvidence[0]?.totalMinutes).toEqual({ n: 10n, d: 1n });
    expect(scaled.timeEvidence).toBe(baseline.source.timeEvidence);
    expect(scaled.factor.mul(R.of(3n))).toEqual({ n: 1n, d: 1n });
  });

  it.each([
    [R.of(3n), 90n, 1n, 2n, 3n], [R.of(4n), 120n, 1n, 1n, 2n], [R.of(3n, 2n), 45n, 1n, 4n, 3n],
  ])('F02: normalizes a source per serving once with B=%s', (b, q0n, q0d, kn, kd) => {
    const template = source(b);
    const original: RecipeScaleSource = { ...template, inputBasis: 'per_serving',
      ingredients: [{ ...template.ingredients[0]!, quantity: { ...template.ingredients[0]!.quantity, value: R.of(30n) } }],
      nutrition: { kcal: R.of(12n), proteinG: R.of(3n, 5n), fatG: R.of(3n, 10n), carbsG: R.of(3n, 2n) },
    };
    const baseline = RecipeBaseline.fromSource(original);
    expect(baseline.ingredients[0]?.quantity.value).toEqual({ n: q0n, d: q0d });
    expect(baseline.baseServings).toEqual(b);
    expect(baseline.source.ingredients[0]?.quantity.value).toEqual({ n: 30n, d: 1n });
    for (let repeat = 0; repeat < 3; repeat++) {
      const scaled = scaleRecipe(baseline, 2);
      expect(scaled.factor).toEqual({ n: kn, d: kd });
      expect(scaled.ingredients[0]?.quantity.value).toEqual({ n: 60n, d: 1n });
      expect(scaled.nutrition).toEqual({ kcal: { n: 24n, d: 1n }, proteinG: { n: 6n, d: 5n },
        fatG: { n: 3n, d: 5n }, carbsG: { n: 3n, d: 1n } });
      expect(scaled.nutrition.proteinG.div(R.of(2n))).toEqual({ n: 3n, d: 5n });
    }
  });

  it('uses absolute M, always beginning with q0 rather than the previous preview', () => {
    const baseline = RecipeBaseline.fromSource(source());
    for (const m of [R.of(2n), R.of(2n), R.of(1n, 2n), R.of(1n), R.of(2n), R.of(1n)]) {
      const result = scaleRecipe(baseline, 2, m);
      const expected = m.n === 2n ? 600n : m.d === 2n ? 150n : 300n;
      expect(result.ingredients[0]?.quantity.value).toEqual({ n: expected, d: 1n });
      expect(result.timeEvidence[0]?.totalMinutes).toEqual({ n: 10n, d: 1n });
    }
    expect(baseline.ingredients[0]?.quantity.value).toEqual({ n: 450n, d: 1n });
  });

  it('F04: a valid 0.001 g source scales to 1/2000 g, below the input step', () => {
    const original = source(R.of(2n));
    const baseline = RecipeBaseline.fromSource({ ...original, ingredients: [{ ...original.ingredients[0]!,
      quantity: { ...original.ingredients[0]!.quantity, value: R.of(1n, 1000n) } }] });
    const scaled = scaleRecipe(baseline, 1);
    expect(scaled.ingredients[0]?.quantity.value).toEqual({ n: 1n, d: 2000n });
    expect(formatQuantity(scaled.ingredients[0]!.quantity.value, 'g')).toBe('< 0,001 г');
  });

  it('accepts high precision confirmed finite B independently of quantity step', () => {
    const baseline = RecipeBaseline.fromSource(source(R.of(1000001n, 1000000n)));
    expect(scaleRecipe(baseline, 1).factor).toEqual({ n: 1000000n, d: 1000001n });
  });

  it('snapshots the source so later caller edits cannot change q0, B or references', () => {
    const original = source();
    const baseline = RecipeBaseline.fromSource(original);
    expect(baseline.source).not.toBe(original);
    expect(baseline.source.ingredients[0]?.quantity.basis.ref).not.toBe(original.ingredients[0]?.quantity.basis.ref);
    expect(Object.isFrozen(baseline.source.ingredients[0]?.quantity.basis.ref)).toBe(true);
    expect(Object.isFrozen(baseline)).toBe(true);
    Object.assign(original, { baseServings: R.of(10n) });
    Object.assign(original.ingredients[0]!.quantity, { value: R.of(999n) });
    Object.assign(original.ingredients[0]!.quantity.basis.ref, { id: 'changed-outside' });
    expect(() => Object.assign(baseline, { ingredients: [] })).toThrow();
    expect(scaleRecipe(baseline, 2).ingredients[0]?.quantity.value).toEqual({ n: 300n, d: 1n });
    expect(baseline.baseServings).toEqual({ n: 3n, d: 1n });
    expect(baseline.ingredients[0]?.quantity.basis.ref.id).toBe('basis-0');
  });

  it('rejects unconfirmed, non-positive or non-finite-decimal B', () => {
    for (const b of [R.of(0n), R.of(-1n), R.of(1n, 3n)]) {
      expect(() => RecipeBaseline.fromSource(source(b))).toThrow('BASE_SERVINGS_UNCONFIRMED');
    }
    expect(() => RecipeBaseline.fromSource({ ...source(), baseServingsEvidenceRefs: [] })).toThrow('BASE_SERVINGS_UNCONFIRMED');
  });

  it('rejects invalid source quantities rather than rounding them during normalization', () => {
    const original = source();
    expect(() => RecipeBaseline.fromSource({ ...original, ingredients: [{ ...original.ingredients[0]!,
      quantity: { ...original.ingredients[0]!.quantity, value: R.of(1n, 2000n) } }] })).toThrow('INVALID_SOURCE_INGREDIENT');
  });

  it('rejects unsupported people and multiplier values', () => {
    const baseline = RecipeBaseline.fromSource(source());
    for (const h of [0, -1, 11, 1.5, NaN, Infinity]) expect(() => scaleRecipe(baseline, h)).toThrow('PEOPLE_OUT_OF_RANGE');
    for (const m of [R.of(0n), R.of(-1n), R.of(3n, 2n)]) expect(() => scaleRecipe(baseline, 2, m)).toThrow('MULTIPLIER_UNSUPPORTED');
    expect(scaleRecipe(baseline, 10).factor).toEqual({ n: 10n, d: 3n });
  });
});
