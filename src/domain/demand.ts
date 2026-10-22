import { Rational, ZERO } from './rational';
import { UNITS, isUnit } from './quantity';
import type { EntityRef, Quantity, QuantityBasis } from './quantity';
import { convertQuantity, normalizeQuantity } from './conversion';
import type { ConversionReason, ConversionStep } from './conversion';
import { scaleRecipe } from './recipeScale';
import type { RecipeBaseline, ScaledRecipe } from './recipeScale';

/** One explicit resolution per ingredient; no catalog/path search inside aggregation. */
export type DemandResolution = Readonly<{
  ingredientId: string;
  // Resolved g/ml/concrete-pcs basis for the original product/state/dimension.
  nativeBasis: QuantityBasis;
  // Optional selected destination, independent of prices and stocks.
  translation?: Readonly<{ target: QuantityBasis; steps: readonly ConversionStep[] }>;
}>;
export type DemandSlot = Readonly<{
  slotId: string; order: number; resolutions: readonly DemandResolution[];
}> & (
  | Readonly<{ kind: 'baseline'; baseline: RecipeBaseline; people: number; multiplier?: Rational }>
  | Readonly<{ kind: 'scaled'; recipe: ScaledRecipe }>
);
export type DemandMenu = Readonly<{
  planId: string; variantId: string; slots: readonly DemandSlot[];
}>;
export type DemandContribution = Readonly<{
  slotId: string; order: number; ingredientId: string; recipeRef: EntityRef;
  people: number; multiplier: Rational; factor: Rational; normalizationFactor: Rational;
  source: Quantity; wholeRecipe: Quantity; scaled: Quantity;
  native: Quantity; quantity: Quantity; conversions: readonly ConversionStep[];
  rejectedTranslation: Readonly<{
    target: QuantityBasis; steps: readonly ConversionStep[]; reasons: readonly ConversionReason[];
  }> | null;
}>;
export type DemandLine = Readonly<{
  key: string; required: Quantity; contributions: readonly DemandContribution[];
}>;
export type MenuDemand = Readonly<{
  planId: string; variantId: string; lines: readonly DemandLine[];
}>;

/** Immutable detached snapshots; Rational instances are already immutable. */
function snapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof Rational) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)]))) as T;
}
function refKey(ref: EntityRef): readonly string[] { return [ref.id, ref.recordVersion]; }
/** Internal grouping key, NOT a DemandLineDTO ID. All reference versions participate. */
export function demandKey(basis: QuantityBasis): string {
  return JSON.stringify([refKey(basis.productRef), refKey(basis.stateRef), refKey(basis.ref)]);
}
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Pure replacement calculation from a resolved menu. Never accepts a previous demand.
 * Lines: UTF-16 order of demandKey. Contributions: slot.order, then ingredientId (UTF-16).
 * Failed optional translations retain the known native demand, with the failure attached.
 */
export function aggregateDemand(menu: DemandMenu): MenuDemand {
  if (!menu.planId || !menu.variantId) throw new Error('DEMAND_MENU_ID_REQUIRED');
  const slots = [...menu.slots].sort((a, b) => a.order - b.order);
  if (new Set(slots.map(s => s.slotId)).size !== slots.length
    || new Set(slots.map(s => s.order)).size !== slots.length
    || slots.some(s => !s.slotId || !Number.isSafeInteger(s.order) || s.order < 0)) {
    throw new Error('DUPLICATE_OR_INVALID_DEMAND_SLOT');
  }
  const bases = new Map<string, string>();
  const states = new Map<string, string>();
  function checkBasis(b: QuantityBasis): void {
    for (const ref of [b.ref, b.productRef, b.stateRef]) {
      if (!ref.id || !/^[1-9]\d*$/.test(ref.recordVersion)) throw new Error('INVALID_DEMAND_REFERENCE');
    }
    if (!isUnit(b.unit) || UNITS[b.unit].dimension !== b.dimension || !b.definition.trim()) {
      throw new Error('INVALID_DEMAND_BASIS');
    }
    const key = JSON.stringify(refKey(b.ref));
    const identity = JSON.stringify([refKey(b.productRef), refKey(b.stateRef), b.dimension, b.unit, b.definition]);
    if (bases.has(key) && bases.get(key) !== identity) throw new Error('CONFLICTING_DEMAND_BASIS');
    bases.set(key, identity);
    const state = JSON.stringify(refKey(b.stateRef));
    const product = JSON.stringify(refKey(b.productRef));
    if (states.has(state) && states.get(state) !== product) throw new Error('CONFLICTING_DEMAND_STATE');
    states.set(state, product);
  }
  const lines = new Map<string, { required: Quantity; contributions: DemandContribution[] }>();
  for (const slot of slots) {
    const recipe = slot.kind === 'baseline' ? scaleRecipe(slot.baseline, slot.people, slot.multiplier) : slot.recipe;
    const resolutions = new Map(slot.resolutions.map(r => [r.ingredientId, r]));
    if (resolutions.size !== slot.resolutions.length || resolutions.size !== recipe.ingredients.length
      || new Set(recipe.ingredients.map(i => i.ingredientId)).size !== recipe.ingredients.length) {
      throw new Error('DUPLICATE_OR_MISSING_DEMAND_INGREDIENT');
    }
    for (const ingredient of [...recipe.ingredients].sort((a, b) => compareText(a.ingredientId, b.ingredientId))) {
      const resolution = resolutions.get(ingredient.ingredientId);
      const source = recipe.baseline.source.ingredients.find(i => i.ingredientId === ingredient.ingredientId);
      const whole = recipe.baseline.ingredients.find(i => i.ingredientId === ingredient.ingredientId);
      if (!ingredient.ingredientId || !resolution || !source || !whole) throw new Error('DEMAND_INGREDIENT_REQUIRED');
      if (ingredient.quantity.value.n <= 0n) throw new Error('INVALID_DEMAND_QUANTITY');
      checkBasis(ingredient.quantity.basis);
      checkBasis(resolution.nativeBasis);
      const native = normalizeQuantity(ingredient.quantity, resolution.nativeBasis);
      if (native.kind !== 'available') throw new Error('DEMAND_NATIVE_BASIS_INCOMPATIBLE');
      const translation = resolution.translation;
      if (translation) {
        checkBasis(translation.target);
        if (translation.target.unit !== UNITS[translation.target.unit].baseUnit) throw new Error('EXPECTED_BASE_UNIT_BASIS');
        for (const step of translation.steps) { checkBasis(step.conversion.from); checkBasis(step.conversion.to); }
      }
      // Translation starts at the actual scaled ingredient, matching exact coefficient bases.
      const converted = translation ? convertQuantity(ingredient.quantity, translation.target, translation.steps) : native;
      const quantity = converted.kind === 'available' ? converted.value : native.value;
      const contribution: DemandContribution = {
        slotId: slot.slotId, order: slot.order, ingredientId: ingredient.ingredientId,
        recipeRef: recipe.baseline.source.recipeRef, people: recipe.people, multiplier: recipe.multiplier,
        factor: recipe.factor, normalizationFactor: recipe.baseline.normalizationFactor,
        source: source.quantity, wholeRecipe: whole.quantity, scaled: ingredient.quantity, native: native.value,
        quantity, conversions: converted.kind === 'available' ? converted.steps : [],
        rejectedTranslation: converted.kind === 'unavailable' && translation
          ? { ...translation, reasons: converted.reasons } : null,
      };
      const key = demandKey(quantity.basis);
      const line = lines.get(key) ?? { required: { value: ZERO, basis: quantity.basis }, contributions: [] };
      line.required = { value: line.required.value.add(quantity.value), basis: quantity.basis };
      line.contributions.push(contribution);
      lines.set(key, line);
    }
  }
  return snapshot({ planId: menu.planId, variantId: menu.variantId,
    lines: [...lines].sort(([a], [b]) => compareText(a, b)).map(([key, line]) => ({ key, ...line })),
  });
}
