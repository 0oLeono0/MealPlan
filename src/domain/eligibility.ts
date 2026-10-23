import { ONE, Rational } from './rational';
import { matchesEntire } from './numberInput';
import { inExactRange } from './conversion';
import { sameRef } from './quantity';
import type { EntityRef } from './quantity';
import type { CookingTimeEvidence } from './recipeScale';
import type { ExactRange } from './conversion';

export const DIETS = ['no_fish', 'gluten_free', 'lactose_free', 'vegetarian', 'halal'] as const;
export type Diet = typeof DIETS[number];
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = typeof MEAL_TYPES[number];
/** D06-11/12/13 are evaluated below, not accepted from a saved outcome. */
export const REQUIRED_DATA_CHECKS = ['D06-01', 'D06-02', 'D06-03', 'D06-04', 'D06-05',
  'D06-06', 'D06-07', 'D06-08', 'D06-09', 'D06-10', 'D06-14', 'D06-15', 'D06-16'] as const;
export type RequiredDataCheckId = typeof REQUIRED_DATA_CHECKS[number];
export type EligibilityReason = Readonly<{
  code: 'SOURCE_MISSING' | 'COMPOSITION_UNCONFIRMED' | 'EVIDENCE_CONFLICT' | 'DIET_UNCONFIRMED'
    | 'DIET_VIOLATION' | 'CERTIFICATE_EXPIRED' | 'TIME_LIMIT_EXCEEDED' | 'NO_RECIPES_FOR_SLOT';
  path: string; entityRefs: readonly EntityRef[]; sourceRefs: readonly EntityRef[];
  details: Readonly<{ explanation: string; evaluationDate: string; validThrough?: string;
    actual?: Rational; maxMinutes?: Rational }>;
}>;
export type EligibilityCheck = Readonly<{
  kind: 'confirmed' | 'violated' | 'unconfirmed'; reasons: readonly EligibilityReason[];
}>;
export type DietStatus = 'confirmed' | 'violated' | 'unknown';
export type EligibilitySource = Readonly<{
  ref: EntityRef; kind: 'manufacturer' | 'retailer' | 'recipe_source' | 'measurement'
    | 'certificate_issuer' | 'nutrition_reference' | 'own_asset';
  fragment: string; checkedOn: string; checkedBy: string;
}>;
export type IngredientScope = Readonly<{
  kind: 'ingredient'; productRef: EntityRef; stateRef: EntityRef; compositionRef: EntityRef;
}>;
export type ProcessScope = Readonly<{ kind: 'process'; recipeRef: EntityRef; processRef: EntityRef }>;
export type EligibilityIngredient = IngredientScope & Readonly<{
  ingredientId: string; facility: string | null; evidenceRefs: readonly EntityRef[];
}>;
export type Presence = 'present' | 'absent' | 'unknown';
export type CompositionProperty = 'fish' | 'gluten' | 'milk' | 'lactose' | 'non_vegetarian' | 'haram';
/** These are reviewed semantic facts, NEVER keywords extracted from claim/fragment text. */
export type IngredientFact =
  | Readonly<{ kind: 'identity'; category: 'fresh_fruit_vegetable' | 'fresh_whole_plant' | 'water' | 'salt'; noAdditives: boolean }>
  | Readonly<{ kind: 'composition'; complete: boolean; components: Readonly<Partial<Record<CompositionProperty, Presence>>> }>
  | Readonly<{ kind: 'manufacturer_claim'; diet: 'gluten_free' | 'lactose_free' | 'vegetarian'; assertion: 'supports' | 'contradicts' }>
  | Readonly<{ kind: 'trace'; substance: 'fish' | 'gluten' | 'milk'; warning: string }>
  | Readonly<{ kind: 'conflict'; diets: readonly Diet[]; explanation: string }>
  | Readonly<{ kind: 'certificate'; number: string; issuer: string; validFrom: string; validThrough: string;
    coveredGoods: readonly EntityRef[]; facility: string; processRef: EntityRef; processConditionsConfirmed: boolean;
    verification: Readonly<{ kind: 'confirmed_by_issuer'; sourceRef: EntityRef; checkedOn: string }>
      | Readonly<{ kind: 'unconfirmed' }> }>;
export type DietFactEvidence = Readonly<{
  ref: EntityRef; policyVersion: 'DIET-v1'; sourceRefs: readonly EntityRef[];
  checkedOn: string; checkedBy: string; warnings: readonly string[];
}> & (
  | Readonly<{ scope: IngredientScope; fact: IngredientFact }>
  | Readonly<{ scope: ProcessScope; fact: Readonly<{ kind: 'process'; diet: Diet;
    outcome: DietStatus; explanation: string;
    applicability: Readonly<{ scaleRange: ExactRange | null; conditionsConfirmed: boolean }> }> }>
);
export type RequiredDataCheck = Readonly<{
  checkId: RequiredDataCheckId; outcome: 'passed' | 'failed' | 'unknown' | 'not_applicable';
  sourceRefs: readonly EntityRef[]; explanation: string;
}>;
export type EligibilityTimeEvidence = CookingTimeEvidence & Readonly<{
  recipeRef: EntityRef; processRef: EntityRef; method: string;
  includesWaiting: boolean; conditionsConfirmed: boolean; checkedOn: string; checkedBy: string;
}>;
export type EligibilityRecipe = Readonly<{
  recipeRef: EntityRef; processRef: EntityRef; baseServings: Rational | null;
  ingredients: readonly EligibilityIngredient[]; processEvidenceRefs: readonly EntityRef[];
  mealTypes: readonly MealType[]; mealTypeRecipeRef: EntityRef; mealTypeEvidenceRefs: readonly EntityRef[];
  timeEvidence: readonly EligibilityTimeEvidence[];
  review: Readonly<{ ref: EntityRef; recipeRef: EntityRef; policyVersion: 'D06-price-v2';
    decision: 'accepted' | 'accepted_with_placeholder' | 'rejected' | 'waiting_rule';
    checkedOn: string; checkedBy: string; checks: readonly RequiredDataCheck[] }>;
  imageKind: 'photo' | 'placeholder' | 'missing'; warnings: readonly string[];
}>;
export type RecipeEligibilityInput = Readonly<{
  recipe: EligibilityRecipe; sources: readonly EligibilitySource[]; evidence: readonly DietFactEvidence[];
  dietPolicyVersion: 'DIET-v1'; evaluationDate: string; requestedMealType: MealType;
  people: number; multiplier?: Rational; selectedDiets: readonly Diet[];
  cookLimit: 'any' | Readonly<{ maxMinutes: Rational }>;
}>;
export type GoodsRequirement = Readonly<{
  diet: Diet; ingredientId: string; productRef: EntityRef; stateRef: EntityRef; compositionRef: EntityRef;
  kind: 'identity' | 'composition' | 'gluten_free_claim' | 'lactose_free_claim' | 'vegetarian_origin' | 'ifanca_certificate';
  facility: string | null; certificateRefs: readonly EntityRef[]; evidenceRefs: readonly EntityRef[];
}>;
export type SubjectDietAssessment = Readonly<{
  status: DietStatus; evidenceRefs: readonly EntityRef[]; applicableEvidenceRefs: readonly EntityRef[];
  reasons: readonly EligibilityReason[]; warnings: readonly string[];
}>;
export type RecipeDietAssessment = SubjectDietAssessment & Readonly<{
  diet: Diet; policyVersion: 'DIET-v1'; subjectRef: EntityRef;
  ingredientAssessments: readonly (SubjectDietAssessment & Readonly<{ ingredientId: string; subjectRef: EntityRef }>)[];
  process: SubjectDietAssessment; requiredGoodsRequirements: readonly GoodsRequirement[];
}>;
export type RecipeEligibility = Readonly<{
  recipeRef: EntityRef; evaluationDate: string; selectedDiets: readonly Diet[];
  basis: RecipeEligibilityInput;
  data: EligibilityCheck; mealType: EligibilityCheck;
  time: EligibilityCheck & Readonly<{ factor: Rational | null; totalMinutes: Rational | null;
    applicableEvidenceRefs: readonly EntityRef[] }>;
  dietAssessments: readonly RecipeDietAssessment[]; assessment: EligibilityCheck; eligible: boolean;
  warnings: readonly string[]; requiredGoodsRequirements: readonly GoodsRequirement[];
}>;

function key(r: EntityRef): string { return JSON.stringify([r.id, r.recordVersion]); }
function snapshot<T>(v: T): T {
  if (v === null || typeof v !== 'object' || v instanceof Rational) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snapshot(x)]))) as T;
}
function uniqueRefs(refs: readonly EntityRef[]): EntityRef[] {
  return [...new Map(refs.map(r => [key(r), r])).values()];
}
function combineStatuses(statuses: readonly DietStatus[]): DietStatus {
  return statuses.includes('violated') ? 'violated' : statuses.includes('unknown') ? 'unknown' : 'confirmed';
}

/** Pure single-recipe hard checks. No catalog/path search, money, nutrition or preference ranking. */
export function checkRecipeEligibility(input: RecipeEligibilityInput): RecipeEligibility {
  const { recipe, evaluationDate, sources, evidence } = input;
  function invalid(): never { throw new Error('ELIGIBILITY_PAYLOAD_INVALID'); }
  function checkRef(r: EntityRef): void {
    if (!r.id || !matchesEntire(/^[1-9]\d*$/, r.recordVersion)) invalid();
  }
  function checkDate(s: string): void {
    if (!matchesEntire(/^\d{4}-\d{2}-\d{2}$/, s) || !Number.isFinite(Date.parse(`${s}T00:00:00Z`))
      || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) invalid();
  }
  function index<T extends { ref: EntityRef }>(items: readonly T[]): Map<string, T> {
    const map = new Map<string, T>();
    for (const item of items) {
      checkRef(item.ref);
      if (map.has(key(item.ref))) invalid();
      map.set(key(item.ref), item);
    }
    return map;
  }
  function resolve<T>(map: Map<string, T>, r: EntityRef): T {
    checkRef(r);
    const v = map.get(key(r));
    if (!v) throw new Error('ELIGIBILITY_REFERENCE_MISSING');
    return v;
  }
  if (input.dietPolicyVersion !== 'DIET-v1' || recipe.review.policyVersion !== 'D06-price-v2') {
    throw new Error('ELIGIBILITY_VERSION_UNSUPPORTED');
  }
  checkDate(evaluationDate);
  [recipe.recipeRef, recipe.processRef, recipe.mealTypeRecipeRef, recipe.review.ref, recipe.review.recipeRef].forEach(checkRef);
  checkDate(recipe.review.checkedOn);
  if (!MEAL_TYPES.includes(input.requestedMealType) || !Number.isInteger(input.people) || input.people < 1 || input.people > 10
    || new Set(input.selectedDiets).size !== input.selectedDiets.length || input.selectedDiets.some(d => !DIETS.includes(d))
    || new Set(recipe.mealTypes).size !== recipe.mealTypes.length || recipe.mealTypes.some(m => !MEAL_TYPES.includes(m))) invalid();
  const multiplier = input.multiplier ?? ONE;
  if (![Rational.of(1n, 2n), ONE, Rational.of(2n)].some(m => m.equals(multiplier))
    || (input.cookLimit !== 'any' && input.cookLimit.maxMinutes.n <= 0n)) invalid();
  if (recipe.baseServings && (recipe.baseServings.n <= 0n || !recipe.baseServings.isFiniteDecimal())) invalid();
  const sourceMap = index(sources), evidenceMap = index(evidence);
  for (const s of sources) checkDate(s.checkedOn);
  function checkSources(refs: readonly EntityRef[]): void { refs.forEach(r => resolve(sourceMap, r)); }
  function usableSources(refs: readonly EntityRef[]): boolean {
    return refs.length > 0 && refs.every(r => {
      const s = resolve(sourceMap, r);
      return !!s.fragment.trim() && !!s.checkedBy.trim() && s.checkedOn <= evaluationDate;
    });
  }
  for (const e of evidence) {
    if (e.policyVersion !== 'DIET-v1') throw new Error('ELIGIBILITY_VERSION_UNSUPPORTED');
    checkDate(e.checkedOn); checkSources(e.sourceRefs);
    if (e.scope.kind === 'ingredient') {
      [e.scope.productRef, e.scope.stateRef, e.scope.compositionRef].forEach(checkRef);
    } else { checkRef(e.scope.recipeRef); checkRef(e.scope.processRef); }
    const f = e.fact;
    if ((e.scope.kind === 'process') !== (f.kind === 'process')) invalid();
    if (f.kind === 'process' && f.applicability.scaleRange) {
      const range = f.applicability.scaleRange;
      if (range.min.n <= 0n || range.min.compare(range.max) > 0) invalid();
    }
    if (f.kind === 'certificate') {
      checkDate(f.validFrom); checkDate(f.validThrough); checkRef(f.processRef); f.coveredGoods.forEach(checkRef);
      if (f.validFrom > f.validThrough) invalid();
      if (f.verification.kind === 'confirmed_by_issuer') {
        checkDate(f.verification.checkedOn); resolve(sourceMap, f.verification.sourceRef);
      }
    }
  }
  const ids = new Set<string>();
  for (const i of recipe.ingredients) {
    [i.productRef, i.stateRef, i.compositionRef].forEach(checkRef);
    if (!i.ingredientId || ids.has(i.ingredientId)) invalid();
    ids.add(i.ingredientId); i.evidenceRefs.forEach(r => resolve(evidenceMap, r));
  }
  recipe.processEvidenceRefs.forEach(r => resolve(evidenceMap, r)); checkSources(recipe.mealTypeEvidenceRefs);
  const checks = new Map<RequiredDataCheckId, RequiredDataCheck>();
  for (const c of recipe.review.checks) {
    if (!REQUIRED_DATA_CHECKS.includes(c.checkId) || checks.has(c.checkId)) invalid();
    checkSources(c.sourceRefs); checks.set(c.checkId, c);
  }
  const timeIds = new Set<string>();
  for (const t of recipe.timeEvidence) {
    [t.ref, t.recipeRef, t.processRef].forEach(checkRef); checkSources(t.sourceRefs); checkDate(t.checkedOn);
    if (timeIds.has(key(t.ref)) || t.totalMinutes.n <= 0n || t.scaleRange.min.n <= 0n
      || t.scaleRange.min.compare(t.scaleRange.max) > 0) invalid();
    timeIds.add(key(t.ref));
  }
  function reason(code: EligibilityReason['code'], path: string, explanation: string,
    entityRefs: readonly EntityRef[] = [recipe.recipeRef], sourceRefs: readonly EntityRef[] = [],
    validThrough?: string): EligibilityReason {
    return { code, path, entityRefs, sourceRefs, details: { explanation, evaluationDate,
      ...(validThrough === undefined ? {} : { validThrough }) } };
  }
  function check(kind: EligibilityCheck['kind'], reasons: readonly EligibilityReason[] = []): EligibilityCheck {
    return { kind, reasons };
  }
  const dataReasons: EligibilityReason[] = [];
  const reviewApplicable = sameRef(recipe.review.recipeRef, recipe.recipeRef) && !!recipe.review.checkedBy.trim()
    && recipe.review.checkedOn <= evaluationDate
    && ['accepted', 'accepted_with_placeholder'].includes(recipe.review.decision);
  for (const id of REQUIRED_DATA_CHECKS) {
    const c = checks.get(id);
    if (!reviewApplicable || !c || !usableSources(c.sourceRefs)
      || !(c.outcome === 'passed' || (id === 'D06-16' && c.outcome === 'not_applicable'))) {
      dataReasons.push(reason('SOURCE_MISSING', `/review/checks/${id}`,
        c?.explanation || 'Required data has no applicable verified basis', [recipe.recipeRef, recipe.review.ref], c?.sourceRefs));
    }
  }
  if (!recipe.ingredients.length || !recipe.baseServings) dataReasons.push(reason('COMPOSITION_UNCONFIRMED', '/recipe',
    'Ingredients and the recipe’s own B must be known'));
  if (recipe.imageKind === 'missing' || (recipe.imageKind === 'placeholder' && recipe.review.decision !== 'accepted_with_placeholder')) {
    dataReasons.push(reason('SOURCE_MISSING', '/recipe/image', 'Image or accepted S1 placeholder has no verified basis'));
  }
  const data = check(dataReasons.length ? 'unconfirmed' : 'confirmed', dataReasons);
  const mealType = !recipe.mealTypes.length || !sameRef(recipe.mealTypeRecipeRef, recipe.recipeRef) || !usableSources(recipe.mealTypeEvidenceRefs)
    ? check('unconfirmed', [reason('SOURCE_MISSING', '/recipe/mealTypes', 'Meal types lack applicable confirmation',
      [recipe.recipeRef], recipe.mealTypeEvidenceRefs)])
    : recipe.mealTypes.includes(input.requestedMealType) ? check('confirmed')
      : check('violated', [reason('NO_RECIPES_FOR_SLOT', '/recipe/mealTypes', `Recipe is not approved for ${input.requestedMealType}`)]);

  const factor = recipe.baseServings ? Rational.of(BigInt(input.people)).mul(multiplier).div(recipe.baseServings) : null;
  const times = recipe.timeEvidence.filter(t => factor && inExactRange(factor, t.scaleRange)
    && sameRef(t.recipeRef, recipe.recipeRef) && sameRef(t.processRef, recipe.processRef)
    && t.includesWaiting && t.conditionsConfirmed && !!t.conditions.trim() && !!t.method.trim()
    && !!t.checkedBy.trim() && t.checkedOn <= evaluationDate && usableSources(t.sourceRefs));
  const conflict = times.some(t => !t.totalMinutes.equals(times[0]!.totalMinutes));
  const totalMinutes = times.length && !conflict ? times[0]!.totalMinutes : null;
  const timeCheck = !totalMinutes ? check('unconfirmed', [reason(conflict ? 'EVIDENCE_CONFLICT' : 'SOURCE_MISSING',
    '/recipe/timeEvidence', conflict ? 'Applicable total time estimates conflict' : 'No confirmed full time for this scale and process',
    [recipe.recipeRef, ...times.map(t => t.ref)], times.flatMap(t => t.sourceRefs))])
    : input.cookLimit !== 'any' && totalMinutes.compare(input.cookLimit.maxMinutes) > 0
      ? check('violated', [{ ...reason('TIME_LIMIT_EXCEEDED', '/recipe/timeEvidence', 'Full time exceeds the selected limit',
        [recipe.recipeRef, ...times.map(t => t.ref)], times.flatMap(t => t.sourceRefs)), details: {
          explanation: 'Full time exceeds the selected limit', evaluationDate, actual: totalMinutes, maxMinutes: input.cookLimit.maxMinutes,
        } }]) : check('confirmed');

  function subjectAssessment(refs: readonly EntityRef[], matches: (e: DietFactEvidence) => boolean,
    diet: Diet, path: string): { usable: DietFactEvidence[]; reasons: EligibilityReason[]; warnings: string[] } {
    const selected = refs.map(r => resolve(evidenceMap, r));
    const usable = selected.filter(e => matches(e) && e.checkedOn <= evaluationDate && !!e.checkedBy.trim() && usableSources(e.sourceRefs)
      && (e.fact.kind !== 'manufacturer_claim' || e.sourceRefs.some(r => resolve(sourceMap, r).kind === 'manufacturer')));
    const reasons = selected.filter(e => !usable.includes(e)).map(e => reason('DIET_UNCONFIRMED', path,
      'Evidence does not apply to the exact subject/version or lacks a checked source', [e.ref], e.sourceRefs));
    if (!usable.length) reasons.push(reason('DIET_UNCONFIRMED', path, `No applicable ${diet} evidence`));
    return { usable, reasons, warnings: selected.flatMap(e => [...e.warnings,
      ...(e.fact.kind === 'trace' ? [e.fact.warning] : [])]) };
  }
  const dietAssessments: RecipeDietAssessment[] = DIETS.map(diet => {
    const requirements: GoodsRequirement[] = [];
    const ingredientAssessments = recipe.ingredients.map(i => {
      const path = `/ingredients/${i.ingredientId.replace(/~/g, '~0').replace(/\//g, '~1')}/diets/${diet}`;
      const s = subjectAssessment(i.evidenceRefs, e => e.scope.kind === 'ingredient'
        && sameRef(e.scope.productRef, i.productRef) && sameRef(e.scope.stateRef, i.stateRef)
        && sameRef(e.scope.compositionRef, i.compositionRef), diet, path);
      const reasons = s.reasons;
      const items = s.usable;
      const compositions = items.filter(e => e.fact.kind === 'composition');
      const identities = items.filter(e => e.fact.kind === 'identity' && e.fact.noAdditives);
      const identity = identities.length > 0;
      const gfIdentity = identities.some(e => e.fact.kind === 'identity' && e.fact.category !== 'fresh_whole_plant');
      const complete = compositions.some(e => e.fact.kind === 'composition' && e.fact.complete) || identity;
      let conflicted = false;
      function conflictReason(explanation: string): void {
        conflicted = true;
        reasons.push(reason('EVIDENCE_CONFLICT', path, explanation, items.map(e => e.ref), items.flatMap(e => e.sourceRefs)));
      }
      function presence(property: CompositionProperty): Presence {
        const values = compositions.flatMap(e => e.fact.kind === 'composition' && e.fact.components[property]
          ? [e.fact.components[property]!] : []);
        if (values.includes('present') && values.includes('absent')) {
          conflictReason(`Conflicting composition fact: ${property}`); return 'unknown';
        }
        // Unknown in another source must not erase a demonstrated ingredient.
        return values.includes('present') ? 'present' : values.includes('unknown') ? 'unknown'
          : values.includes('absent') ? 'absent' : 'unknown';
      }
      function claim(d: 'gluten_free' | 'lactose_free' | 'vegetarian'): { supports: boolean; contradicts: boolean } {
        const claims = items.filter(e => e.fact.kind === 'manufacturer_claim' && e.fact.diet === d
          && e.sourceRefs.some(r => resolve(sourceMap, r).kind === 'manufacturer'));
        const positive = claims.some(e => e.fact.kind === 'manufacturer_claim' && e.fact.assertion === 'supports');
        const contradicts = claims.some(e => e.fact.kind === 'manufacturer_claim' && e.fact.assertion === 'contradicts');
        if (positive && contradicts) conflictReason(`Conflicting manufacturer claims: ${d}`);
        return { supports: positive && !contradicts, contradicts };
      }
      const explicitConflicts = items.filter(e => e.fact.kind === 'conflict' && e.fact.diets.includes(diet));
      if (explicitConflicts.length) conflictReason(explicitConflicts.map(e => e.fact.kind === 'conflict' ? e.fact.explanation : '').join('; '));
      let violation = false, positive = false;
      let certificateRefs: EntityRef[] = [];
      let requirement: GoodsRequirement['kind'] = 'composition';
      if (diet === 'no_fish') {
        const fish = presence('fish'); violation = fish === 'present'; positive = identity || (complete && fish === 'absent');
      } else if (diet === 'gluten_free') {
        const gluten = presence('gluten'); violation = gluten === 'present';
        const gfClaim = claim('gluten_free');
        positive = complete && (gfIdentity || gfClaim.supports);
        if (positive && gfClaim.contradicts) conflictReason('Manufacturer contradicts the inferred gluten-free identity');
        requirement = gfIdentity ? 'identity' : 'gluten_free_claim';
        if (items.some(e => e.fact.kind === 'trace' && e.fact.substance === 'gluten')) {
          positive = false;
          reasons.push(reason('DIET_UNCONFIRMED', path, 'Possible gluten traces block positive status under DIET-v1',
            items.map(e => e.ref), items.flatMap(e => e.sourceRefs)));
        }
      } else if (diet === 'lactose_free') {
        const lactose = presence('lactose'), milk = presence('milk');
        const lfClaim = claim('lactose_free');
        violation = lactose === 'present'; positive = complete && (identity || milk === 'absent' || lfClaim.supports);
        if (positive && lfClaim.contradicts) conflictReason('Manufacturer contradicts the inferred lactose-free composition');
        requirement = identity ? 'identity' : milk === 'absent' ? 'composition' : 'lactose_free_claim';
      } else if (diet === 'vegetarian') {
        const excluded = presence('non_vegetarian'); violation = excluded === 'present';
        const vegClaim = claim('vegetarian');
        positive = complete && (identity || excluded === 'absent' || vegClaim.supports);
        if (positive && vegClaim.contradicts) conflictReason('Manufacturer contradicts the inferred vegetarian composition');
        requirement = identity ? 'identity' : 'vegetarian_origin';
      } else {
        const haram = presence('haram'); violation = haram === 'present';
        requirement = identity ? 'identity' : 'ifanca_certificate';
        certificateRefs = items.filter(e => {
          const f = e.fact;
          if (f.kind !== 'certificate') return false;
          if (f.validThrough < evaluationDate) reasons.push(reason('CERTIFICATE_EXPIRED', path,
            'Certificate is outside its inclusive validity', [e.ref], e.sourceRefs, f.validThrough));
          return f.issuer === 'IFANCA' && !!f.number.trim() && f.validFrom <= evaluationDate && evaluationDate <= f.validThrough
            && f.coveredGoods.some(r => sameRef(r, i.productRef)) && !!f.facility.trim() && f.facility === i.facility
            && sameRef(f.processRef, recipe.processRef) && f.processConditionsConfirmed
            && f.verification.kind === 'confirmed_by_issuer' && f.verification.checkedOn <= evaluationDate
            && resolve(sourceMap, f.verification.sourceRef).kind === 'certificate_issuer'
            && usableSources([f.verification.sourceRef]);
        }).map(e => e.ref);
        positive = complete && (identity || certificateRefs.length > 0);
      }
      // Conflicted facts cannot establish positive compliance. A separate proven violation still wins.
      const status: DietStatus = violation ? 'violated' : positive && !conflicted ? 'confirmed' : 'unknown';
      if (status === 'violated') reasons.push(reason('DIET_VIOLATION', path, `Demonstrated excluded component for ${diet}`,
        items.map(e => e.ref), items.flatMap(e => e.sourceRefs)));
      if (status === 'unknown') reasons.push(reason(complete ? 'DIET_UNCONFIRMED' : 'COMPOSITION_UNCONFIRMED', path,
        `Required ${diet} composition, origin, claim or certificate is not confirmed`, items.map(e => e.ref), items.flatMap(e => e.sourceRefs)));
      requirements.push({ diet, ingredientId: i.ingredientId, productRef: i.productRef, stateRef: i.stateRef,
        compositionRef: i.compositionRef, kind: identity && diet === 'no_fish' ? 'identity' : requirement,
        facility: i.facility, certificateRefs,
        evidenceRefs: i.evidenceRefs });
      return { ingredientId: i.ingredientId, subjectRef: i.stateRef, status, evidenceRefs: i.evidenceRefs,
        applicableEvidenceRefs: items.filter(e => e.fact.kind !== 'certificate' || certificateRefs.some(r => sameRef(r, e.ref)))
          .map(e => e.ref), reasons, warnings: s.warnings };
    });
    const path = `/process/diets/${diet}`;
    const processItems = recipe.processEvidenceRefs.map(r => resolve(evidenceMap, r))
      .filter(e => e.fact.kind === 'process' && e.fact.diet === diet);
    const p = subjectAssessment(processItems.map(e => e.ref), e => e.scope.kind === 'process'
      && sameRef(e.scope.recipeRef, recipe.recipeRef) && sameRef(e.scope.processRef, recipe.processRef)
      && e.fact.kind === 'process' && e.fact.applicability.conditionsConfirmed
      && (e.fact.applicability.scaleRange === null || (factor !== null && inExactRange(factor, e.fact.applicability.scaleRange))), diet, path);
    const processReasons = p.reasons;
    const outcomes = p.usable.flatMap(e => e.fact.kind === 'process' ? [e.fact.outcome] : []);
    const processConflict = outcomes.includes('confirmed') && outcomes.includes('violated');
    const processStatus = processConflict ? 'unknown' : outcomes.includes('violated') ? 'violated'
      : outcomes.length && outcomes.every(o => o === 'confirmed') ? 'confirmed' : 'unknown';
    if (processStatus !== 'confirmed') processReasons.push(reason(processConflict ? 'EVIDENCE_CONFLICT'
      : processStatus === 'violated' ? 'DIET_VIOLATION' : 'DIET_UNCONFIRMED', path,
    processConflict ? 'Applicable process facts conflict' : processItems.map(e => e.fact.kind === 'process'
      ? e.fact.explanation : '').join('; ') || 'Recipe process is not confirmed compatible',
    processItems.map(e => e.ref), processItems.flatMap(e => e.sourceRefs)));
    const process: SubjectDietAssessment = { status: processStatus, evidenceRefs: processItems.map(e => e.ref),
      applicableEvidenceRefs: p.usable.map(e => e.ref), reasons: processReasons, warnings: p.warnings };
    const subjects = [...ingredientAssessments, process];
    const status = recipe.ingredients.length ? combineStatuses(subjects.map(a => a.status)) : 'unknown';
    const reasons = subjects.flatMap(a => a.reasons);
    if (!recipe.ingredients.length) reasons.push(reason('COMPOSITION_UNCONFIRMED', '/ingredients', 'Recipe has no resolved ingredients'));
    return { diet, policyVersion: 'DIET-v1', subjectRef: recipe.recipeRef, status, ingredientAssessments, process,
      evidenceRefs: uniqueRefs(subjects.flatMap(a => a.evidenceRefs)),
      applicableEvidenceRefs: uniqueRefs(subjects.flatMap(a => a.applicableEvidenceRefs)),
      reasons, warnings: [...new Set(subjects.flatMap(a => a.warnings))],
      requiredGoodsRequirements: requirements };
  });
  const selected = dietAssessments.filter(a => input.selectedDiets.includes(a.diet));
  const hardChecks = [data, mealType, timeCheck, ...selected.map(a => check(a.status === 'unknown' ? 'unconfirmed' : a.status, a.reasons))];
  const assessment = check(hardChecks.some(c => c.kind === 'violated') ? 'violated'
    : hardChecks.some(c => c.kind === 'unconfirmed') ? 'unconfirmed' : 'confirmed', hardChecks.flatMap(c => c.reasons));
  return snapshot({ recipeRef: recipe.recipeRef, evaluationDate, selectedDiets: input.selectedDiets, basis: input,
    data, mealType, time: { ...timeCheck, factor, totalMinutes, applicableEvidenceRefs: times.map(t => t.ref) },
    dietAssessments, assessment, eligible: assessment.kind === 'confirmed',
    warnings: [...new Set([...recipe.warnings, ...dietAssessments.flatMap(a => a.warnings)])],
    requiredGoodsRequirements: selected.flatMap(a => a.requiredGoodsRequirements) });
}
