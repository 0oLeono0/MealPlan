import { ONE, Rational } from './rational';
import { validateQuantity } from './quantity';
import type { EntityRef, Quantity } from './quantity';
import type { ExactRange } from './conversion';

export type RecipeNutrition = Readonly<{ kcal: Rational; proteinG: Rational; fatG: Rational; carbsG: Rational }>;
export type ScaleIngredient = Readonly<{ ingredientId: string; quantity: Quantity }>;
export type CookingTimeEvidence = Readonly<{
  ref: EntityRef; totalMinutes: Rational; scaleRange: ExactRange;
  conditions: string; sourceRefs: readonly EntityRef[];
}>;
/** Numerical projection of an already resolved source, not a full catalog RecipeDTO. */
export type RecipeScaleSource = Readonly<{
  recipeRef: EntityRef; baseServings: Rational; baseServingsEvidenceRefs: readonly EntityRef[];
  portionMeaning: string; inputBasis: 'whole_recipe' | 'per_serving';
  ingredients: readonly ScaleIngredient[]; nutrition: RecipeNutrition;
  timeEvidence: readonly CookingTimeEvidence[];
}>;

function copyRef(ref: EntityRef): EntityRef { return Object.freeze({ ...ref }); }
function copyRefs(refs: readonly EntityRef[]): readonly EntityRef[] { return Object.freeze(refs.map(copyRef)); }
function copyIngredient(ingredient: ScaleIngredient): ScaleIngredient {
  const b = ingredient.quantity.basis;
  return Object.freeze({ ingredientId: ingredient.ingredientId, quantity: Object.freeze({
    value: ingredient.quantity.value,
    basis: Object.freeze({ ...b, ref: copyRef(b.ref), productRef: copyRef(b.productRef), stateRef: copyRef(b.stateRef) }),
  }) });
}
function multiplyNutrition(n: RecipeNutrition, factor: Rational): RecipeNutrition {
  return Object.freeze({ kcal: n.kcal.mul(factor), proteinG: n.proteinG.mul(factor),
    fatG: n.fatG.mul(factor), carbsG: n.carbsG.mul(factor) });
}
function multiplyIngredients(ingredients: readonly ScaleIngredient[], factor: Rational): readonly ScaleIngredient[] {
  return Object.freeze(ingredients.map(i => Object.freeze({ ...i,
    quantity: Object.freeze({ value: i.quantity.value.mul(factor), basis: i.quantity.basis }),
  })));
}

/** Always normalized once to the WHOLE original B, preserving the source and its own B. */
export class RecipeBaseline {
  readonly source: RecipeScaleSource;
  readonly normalizationFactor: Rational;
  readonly ingredients: readonly ScaleIngredient[];
  readonly nutrition: RecipeNutrition;

  private constructor(source: RecipeScaleSource) {
    if (source.baseServings.n <= 0n || !source.baseServings.isFiniteDecimal()
      || source.baseServingsEvidenceRefs.length === 0 || source.portionMeaning.trim() === '') {
      throw new Error('BASE_SERVINGS_UNCONFIRMED');
    }
    if (source.inputBasis !== 'whole_recipe' && source.inputBasis !== 'per_serving') throw new Error('INVALID_INPUT_BASIS');
    if (source.ingredients.length === 0 || new Set(source.ingredients.map(i => i.ingredientId)).size !== source.ingredients.length
      || source.ingredients.some(i => i.ingredientId === ''
        || validateQuantity(i.quantity.value, i.quantity.basis.unit, 'ingredient').kind !== 'valid')) {
      throw new Error('INVALID_SOURCE_INGREDIENT');
    }
    if (Object.values(source.nutrition).some(value => value.n < 0n)) throw new Error('INVALID_SOURCE_NUTRITION');
    if (source.timeEvidence.some(t => t.totalMinutes.n <= 0n
      || t.scaleRange.min.n <= 0n || t.scaleRange.min.compare(t.scaleRange.max) > 0)) {
      throw new Error('INVALID_TIME_EVIDENCE');
    }
    this.source = Object.freeze({ ...source, recipeRef: copyRef(source.recipeRef),
      baseServingsEvidenceRefs: copyRefs(source.baseServingsEvidenceRefs),
      ingredients: Object.freeze(source.ingredients.map(copyIngredient)), nutrition: Object.freeze({ ...source.nutrition }),
      timeEvidence: Object.freeze(source.timeEvidence.map(t => Object.freeze({ ...t, ref: copyRef(t.ref),
        scaleRange: Object.freeze({ ...t.scaleRange }), sourceRefs: copyRefs(t.sourceRefs),
      }))),
    });
    this.normalizationFactor = source.inputBasis === 'per_serving' ? source.baseServings : ONE;
    this.ingredients = multiplyIngredients(this.source.ingredients, this.normalizationFactor);
    this.nutrition = multiplyNutrition(this.source.nutrition, this.normalizationFactor);
    Object.freeze(this);
  }

  static fromSource(source: RecipeScaleSource): RecipeBaseline { return new RecipeBaseline(source); }
  get baseServings(): Rational { return this.source.baseServings; }
}

export type ScaledRecipe = Readonly<{
  baseline: RecipeBaseline; people: number; multiplier: Rational; portions: Rational; factor: Rational;
  ingredients: readonly ScaleIngredient[]; nutrition: RecipeNutrition;
  // Kept for a subsequent applicability check. No arithmetic scaling of duration.
  timeEvidence: readonly CookingTimeEvidence[];
}>;

export function scaleRecipe(baseline: RecipeBaseline, people: number, multiplier: Rational = ONE): ScaledRecipe {
  if (!(baseline instanceof RecipeBaseline)) throw new Error('RECIPE_BASELINE_REQUIRED');
  if (!Number.isInteger(people) || people < 1 || people > 10) throw new Error('PEOPLE_OUT_OF_RANGE');
  if (![Rational.of(1n, 2n), ONE, Rational.of(2n)].some(m => m.equals(multiplier))) {
    throw new Error('MULTIPLIER_UNSUPPORTED');
  }
  const portions = Rational.of(BigInt(people)).mul(multiplier);
  const factor = portions.div(baseline.baseServings);
  return Object.freeze({ baseline, people, multiplier, portions, factor,
    ingredients: multiplyIngredients(baseline.ingredients, factor),
    nutrition: multiplyNutrition(baseline.nutrition, factor), timeEvidence: baseline.source.timeEvidence,
  });
}
