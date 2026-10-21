import { Rational, ZERO } from './rational';
import { parseUserNumber } from './numberInput';
import { inExactRange } from './conversion';
import type { ExactRange } from './conversion';
import type { EntityRef } from './quantity';
import type { ScaledRecipe } from './recipeScale';

export const NUTRIENTS = ['kcal', 'proteinG', 'fatG', 'carbsG'] as const;
export type Nutrient = typeof NUTRIENTS[number];
export type Nutrients<T> = Readonly<Record<Nutrient, T>>;

/** Domain projection of source reasons; the catalog codec resolves references separately. */
export type NutritionDataReason = Readonly<{
  code: 'SOURCE_MISSING' | 'REFERENCE_MISSING' | 'COMPOSITION_UNCONFIRMED' | 'EVIDENCE_CONFLICT';
  path: string; entityRefs: readonly EntityRef[]; sourceRefs: readonly EntityRef[];
  details: Readonly<{ explanation: string }>;
}>;
export type MissingNutrition = Readonly<{
  kind: 'unknown'; reasons: readonly [NutritionDataReason, ...NutritionDataReason[]];
}>;
export type NutritionValue =
  | Readonly<{ kind: 'available'; value: Rational }>
  | Readonly<{ kind: 'unavailable'; reasons: readonly [NutritionDataReason, ...NutritionDataReason[]] }>;

function mapNutrients<T>(fn: (metric: Nutrient) => T): Nutrients<T> {
  return Object.freeze({ kcal: fn('kcal'), proteinG: fn('proteinG'), fatG: fn('fatG'), carbsG: fn('carbsG') });
}
function validatePeople(people: number): void {
  if (!Number.isInteger(people) || people < 1 || people > 10) throw new Error('PEOPLE_OUT_OF_RANGE');
}
function available(value: Rational): NutritionValue {
  if (value.n < 0n) throw new Error('INVALID_NUTRITION');
  return Object.freeze({ kind: 'available', value });
}
function divide(values: Nutrients<NutritionValue>, people: number): Nutrients<NutritionValue> {
  const divisor = Rational.of(BigInt(people));
  return mapNutrients(metric => {
    const value = values[metric];
    return value.kind === 'available' ? available(value.value.div(divisor)) : value;
  });
}
export type SlotNutrition = Readonly<{
  basis: 'slot_all_people'; people: number;
  wholeNutrition: Nutrients<NutritionValue>; perPersonNutrition: Nutrients<NutritionValue>;
}>;

/** Input N_s has ALREADY been scaled by H*M/B, as in ScaledRecipe.nutrition.
 * An unresolved existing dish can supply unknown fields on that same slot basis.
 * Never pass N⁰ here: normalize/scale it through RecipeBaseline/scaleRecipe first.
 */
export function calculateSlotNutrition(scaled: Pick<ScaledRecipe, 'people'> & Readonly<{
  nutrition: Nutrients<Rational | MissingNutrition>;
}>): SlotNutrition {
  validatePeople(scaled.people);
  const wholeNutrition = mapNutrients(metric => {
    const value = scaled.nutrition[metric];
    if (value instanceof Rational) return available(value);
    if (value.reasons.length === 0) throw new Error('NUTRITION_REASON_REQUIRED');
    return Object.freeze({ kind: 'unavailable' as const, reasons: value.reasons });
  });
  return Object.freeze({ basis: 'slot_all_people', people: scaled.people, wholeNutrition,
    perPersonNutrition: divide(wholeNutrition, scaled.people) });
}

export type DayNutrition = Readonly<{
  basis: 'day_all_people'; people: number;
  wholeNutrition: Nutrients<NutritionValue>; perPersonNutrition: Nutrients<NutritionValue>;
}>;

/** Every array entry is a planned occurrence, including repeat recipes; null is an empty slot.
 * H is explicit even for an empty day. No recipe-ID deduplication and no extra scale factor.
 */
export function calculateDayNutrition(people: number, slots: readonly (SlotNutrition | null)[]): DayNutrition {
  validatePeople(people);
  if (slots.some(slot => slot !== null && (slot.basis !== 'slot_all_people' || slot.people !== people))) {
    throw new Error('SLOT_PEOPLE_OR_BASIS_MISMATCH');
  }
  const wholeNutrition = mapNutrients(metric => {
    let sum = ZERO;
    const reasons: NutritionDataReason[] = [];
    for (const slot of slots) {
      if (slot === null) continue;
      const value = slot.wholeNutrition[metric];
      if (value.kind === 'unavailable') reasons.push(...value.reasons);
      else sum = sum.add(value.value);
    }
    const [first, ...rest] = reasons;
    return first === undefined ? available(sum)
      : Object.freeze({ kind: 'unavailable' as const, reasons: [first, ...rest] as const });
  });
  return Object.freeze({ basis: 'day_all_people', people, wholeNutrition,
    perPersonNutrition: divide(wholeNutrition, people) });
}

export type NutritionGoal =
  | Readonly<{ kind: 'valid'; value: Rational }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{ kind: 'technical_error'; reason: 'RESOURCE_EXHAUSTED' }>;

function validGoal(metric: Nutrient, value: Rational): boolean {
  return value.isFiniteDecimal() && (metric === 'kcal' ? value.n > 0n : value.n >= 0n);
}

/** S0-08 target grammar is narrower than the general S1-07 number parser: no leading +. */
export function parseNutritionGoal(metric: Nutrient, raw: string): NutritionGoal {
  const parsed = parseUserNumber(raw);
  if (parsed.kind === 'technical_error') return parsed;
  if (parsed.kind === 'empty') return { kind: 'empty' };
  if (parsed.kind === 'invalid' || raw.trim().startsWith('+') || raw.trim().startsWith('-')
    || !validGoal(metric, parsed.value)) return { kind: 'invalid' };
  return { kind: 'valid', value: parsed.value };
}

export type NutritionComparison = Readonly<{
  actual: NutritionValue; goal: NutritionGoal; range: ExactRange | null;
}> & (
  | Readonly<{ kind: 'confirmed'; position: 'within' }>
  | Readonly<{ kind: 'violated'; code: 'NUTRITION_OUT_OF_RANGE'; position: 'below' | 'above' }>
  | Readonly<{ kind: 'unconfirmed'; causes: readonly ('nutrition_unavailable' | 'goal_empty'
      | 'goal_invalid' | 'goal_unknown' | 'goal_technical_error')[] }>
);

/** Only daily per-person amounts are compared. No meal allocation, direction adjustment,
 * calorie reconstruction, display rounding, percent division or source-CMP tolerance.
 */
export function compareDayNutrition(day: DayNutrition, goals: Nutrients<NutritionGoal>): Nutrients<NutritionComparison> {
  return mapNutrients(metric => {
    const actual = day.perPersonNutrition[metric];
    const input = goals[metric];
    const goal: NutritionGoal = input.kind === 'valid' && !validGoal(metric, input.value)
      ? { kind: 'invalid' } : input;
    const range: ExactRange | null = goal.kind === 'valid' ? Object.freeze({
      min: goal.value.mul(Rational.of(9n, 10n)), max: goal.value.mul(Rational.of(11n, 10n)),
      minInclusive: true, maxInclusive: true,
    }) : null;
    const common = { actual, goal, range };
    if (actual.kind === 'unavailable' || range === null) {
      const causes: ('nutrition_unavailable' | 'goal_empty' | 'goal_invalid' | 'goal_unknown' | 'goal_technical_error')[] = [];
      if (actual.kind === 'unavailable') causes.push('nutrition_unavailable');
      if (goal.kind !== 'valid') causes.push(`goal_${goal.kind}`);
      return Object.freeze({ ...common, kind: 'unconfirmed' as const, causes: Object.freeze(causes) });
    }
    if (inExactRange(actual.value, range)) return Object.freeze({ ...common, kind: 'confirmed' as const, position: 'within' as const });
    return Object.freeze({ ...common, kind: 'violated' as const, code: 'NUTRITION_OUT_OF_RANGE' as const,
      position: actual.value.compare(range.min) < 0 ? 'below' as const : 'above' as const });
  });
}
