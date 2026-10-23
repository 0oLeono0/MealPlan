import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ONE, Rational as R } from './rational';
import { parseDecimalText } from './numberInput';
import { sameRef } from './quantity';
import type { EntityRef } from './quantity';
import { checkRecipeEligibility, DIETS, REQUIRED_DATA_CHECKS } from './eligibility';
import type { Diet, DietFactEvidence, DietStatus, EligibilityIngredient, EligibilityRecipe, EligibilitySource,
  IngredientFact, RecipeEligibilityInput, RecipeEligibility, RequiredDataCheckId } from './eligibility';

// All fixtures below are synthetic projections of the documented DT20 facts.
// In particular the positive IFANCA branches are invented test documents, NOT real certificates.
const ref = (id: string, recordVersion = '1'): EntityRef => ({ id, recordVersion });
const recipeRef = ref('synthetic-recipe'), processRef = ref('synthetic-process');
const source = ref('synthetic-source'), manufacturer = ref('synthetic-manufacturer'), issuer = ref('synthetic-issuer');
function decimal(text: string): R {
  const result = parseDecimalText(text);
  if (result.kind !== 'valid') throw new Error('test decimal');
  return result.value;
}
const identity: IngredientFact = { kind: 'identity', category: 'fresh_fruit_vegetable', noAdditives: true };
function composition(components: Extract<IngredientFact, { kind: 'composition' }>['components'] = {}, complete = true): IngredientFact {
  return { kind: 'composition', complete, components: { fish: 'absent', gluten: 'absent', milk: 'absent',
    lactose: 'unknown', non_vegetarian: 'absent', haram: 'absent', ...components } };
}
const claim = (diet: 'gluten_free' | 'lactose_free' | 'vegetarian'): IngredientFact => ({
  kind: 'manufacturer_claim', diet, assertion: 'supports',
});
function request(products: readonly (readonly IngredientFact[])[] = [[identity]]): RecipeEligibilityInput {
  const sources: EligibilitySource[] = [
    [source, 'recipe_source'], [manufacturer, 'manufacturer'], [issuer, 'certificate_issuer'],
  ].map(([r, kind]) => ({ ref: r as EntityRef, kind: kind as EligibilitySource['kind'],
    fragment: 'Synthetic saved evidence, not a real product or certificate', checkedOn: '2026-10-01', checkedBy: 'test reviewer' }));
  const evidence: DietFactEvidence[] = [];
  const ingredients: EligibilityIngredient[] = products.map((facts, i) => {
    const ingredient: EligibilityIngredient = { kind: 'ingredient', ingredientId: `i${i}`, productRef: ref(`product-${i}`),
      stateRef: ref(`state-${i}`), compositionRef: ref(`composition-${i}`), facility: 'synthetic-facility',
      evidenceRefs: facts.map((_f, j) => ref(`fact-${i}-${j}`)) };
    facts.forEach((fact, j) => evidence.push({ ref: ingredient.evidenceRefs[j]!, policyVersion: 'DIET-v1',
      scope: { kind: 'ingredient', productRef: ingredient.productRef, stateRef: ingredient.stateRef, compositionRef: ingredient.compositionRef },
      fact, checkedOn: '2026-10-01', checkedBy: 'test reviewer', warnings: [],
      sourceRefs: [fact.kind === 'manufacturer_claim' ? manufacturer : source] }));
    return ingredient;
  });
  const processes: DietFactEvidence[] = DIETS.map(diet => ({ ref: ref(`process-${diet}`), policyVersion: 'DIET-v1',
    scope: { kind: 'process', recipeRef, processRef }, fact: { kind: 'process', diet, outcome: 'confirmed',
      explanation: 'Synthetic full process: no additional ingredients, all required conditions met',
      applicability: { scaleRange: null, conditionsConfirmed: true } },
    checkedOn: '2026-10-01', checkedBy: 'test reviewer', sourceRefs: [source], warnings: [] }));
  const recipe: EligibilityRecipe = { recipeRef, processRef, baseServings: ONE, ingredients,
    processEvidenceRefs: processes.map(e => e.ref), mealTypes: ['snack'], mealTypeRecipeRef: recipeRef, mealTypeEvidenceRefs: [source],
    timeEvidence: [{ ref: ref('synthetic-time'), recipeRef, processRef, totalMinutes: R.of(10n),
      scaleRange: { min: ONE, max: ONE, minInclusive: true, maxInclusive: true }, conditions: 'original volume',
      method: 'synthetic full time including waiting', includesWaiting: true, conditionsConfirmed: true,
      checkedOn: '2026-10-01', checkedBy: 'test reviewer', sourceRefs: [source] }],
    review: { ref: ref('synthetic-review'), recipeRef, policyVersion: 'D06-price-v2',
      decision: 'accepted_with_placeholder', checkedOn: '2026-10-01', checkedBy: 'test reviewer',
      checks: REQUIRED_DATA_CHECKS.map(checkId => ({ checkId, outcome: checkId === 'D06-16' ? 'not_applicable' : 'passed',
        sourceRefs: [source], explanation: 'Synthetic reviewed mandatory data' })) }, imageKind: 'placeholder', warnings: [] };
  return { recipe, sources, evidence: [...evidence, ...processes], dietPolicyVersion: 'DIET-v1',
    evaluationDate: '2026-10-23', requestedMealType: 'snack', people: 1, selectedDiets: [], cookLimit: { maxMinutes: R.of(15n) } };
}
function withRecipe(a: RecipeEligibilityInput, changes: Partial<EligibilityRecipe>): RecipeEligibilityInput {
  return { ...a, recipe: { ...a.recipe, ...changes } };
}
function addFact(a: RecipeEligibilityInput, fact: IngredientFact, i = 0): RecipeEligibilityInput {
  const ingredient = a.recipe.ingredients[i]!;
  const r = ref(`added-${a.evidence.length}`);
  const e: DietFactEvidence = { ref: r, scope: ingredient, fact, policyVersion: 'DIET-v1', checkedOn: '2026-10-01',
    checkedBy: 'test reviewer', sourceRefs: [fact.kind === 'manufacturer_claim' ? manufacturer : source], warnings: [] };
  return { ...withRecipe(a, { ingredients: a.recipe.ingredients.map((x, j) => j === i
    ? { ...x, evidenceRefs: [...x.evidenceRefs, r] } : x) }), evidence: [...a.evidence, e] };
}
function result(a: RecipeEligibilityInput, diets: readonly Diet[] = a.selectedDiets): RecipeEligibility {
  return checkRecipeEligibility({ ...a, selectedDiets: diets });
}
function status(a: RecipeEligibilityInput, diet: Diet): DietStatus {
  return result(a, [diet]).dietAssessments.find(d => d.diet === diet)!.status;
}
function codes(r: RecipeEligibility): string[] { return r.assessment.reasons.map(x => x.code); }
const fruit = () => request([[identity], [identity]]);
const crackers = () => request([[identity], [composition(), claim('gluten_free')]]);
const lactoseFreeMilk = () => request([[identity], [composition({ milk: 'present' }), claim('lactose_free')]]);
const fishSauce = () => request([[identity], [composition({ fish: 'present', non_vegetarian: 'present' })]]);
const lactoseMix = () => request([[identity], [composition({ milk: 'present', lactose: 'present' }),
  { kind: 'trace', substance: 'gluten', warning: 'Documented possible gluten traces' }]]);
const porkGelatin = () => request([[{ kind: 'identity', category: 'water', noAdditives: true }],
  [composition({ haram: 'present', non_vegetarian: 'present' })]]);
const unknownEnzyme = () => request([[identity], [composition({ milk: 'present', non_vegetarian: 'unknown' })]]);
const unknownSoup = () => request([[identity], [composition({ fish: 'unknown' }, false)]]);
const rye = () => request([[identity], [composition({ gluten: 'present' })]]);

describe('DIET-v1 / all 21 documented DT20 scenarios', () => {
  it.each([
    ['DT20-F-P', fruit, 'no_fish', 'confirmed'], ['DT20-F-N', fishSauce, 'no_fish', 'violated'],
    ['DT20-F-U', unknownSoup, 'no_fish', 'unknown'], ['DT20-G-P', crackers, 'gluten_free', 'confirmed'],
    ['DT20-G-N', rye, 'gluten_free', 'violated'], ['DT20-G-U', lactoseFreeMilk, 'gluten_free', 'unknown'],
    ['DT20-L-P', lactoseFreeMilk, 'lactose_free', 'confirmed'], ['DT20-L-N', lactoseMix, 'lactose_free', 'violated'],
    ['DT20-L-U', unknownEnzyme, 'lactose_free', 'unknown'], ['DT20-V-P', fruit, 'vegetarian', 'confirmed'],
    ['DT20-V-N', porkGelatin, 'vegetarian', 'violated'], ['DT20-V-U', unknownEnzyme, 'vegetarian', 'unknown'],
    ['DT20-H-P', fruit, 'halal', 'confirmed'], ['DT20-H-N', porkGelatin, 'halal', 'violated'],
    ['DT20-H-U', lactoseFreeMilk, 'halal', 'unknown'],
  ] as const)('%s', (_id, build, diet, expected) => {
    const r = result(build(), [diet]);
    const a = r.dietAssessments.find(a => a.diet === diet)!;
    expect(a.status).toBe(expected);
    expect(r.eligible).toBe(expected === 'confirmed');
    expect(r.assessment.kind).toBe(expected === 'unknown' ? 'unconfirmed' : expected);
    expect(r.dietAssessments.map(a => a.diet)).toEqual(DIETS);
    if (expected !== 'confirmed') expect(a.reasons.length).toBeGreaterThan(0);
  });
  it('DT20-X01: each selected filter is confirmed separately', () => {
    const r = result(fruit(), ['no_fish', 'vegetarian']);
    expect(r.eligible).toBe(true);
    expect(r.requiredGoodsRequirements.map(x => x.diet)).toEqual(['no_fish', 'no_fish', 'vegetarian', 'vegetarian']);
  });
  it('DT20-X02: one confirmed filter cannot compensate another unknown', () => {
    const a = lactoseFreeMilk();
    expect(result(a, ['lactose_free']).eligible).toBe(true);
    expect(result(a, ['lactose_free', 'gluten_free']).assessment.kind).toBe('unconfirmed');
  });
  it('DT20-X03: replacement by rye loses the old claim and has a proved violation', () => {
    expect(status(crackers(), 'gluten_free')).toBe('confirmed');
    expect(status(rye(), 'gluten_free')).toBe('violated');
  });
  it('DT20-X04: losing the evidence binding is unknown; dangling references are corrupt', () => {
    const a = lactoseFreeMilk(), milk = a.recipe.ingredients[1]!;
    const lost = withRecipe(a, { ingredients: [a.recipe.ingredients[0]!, { ...milk, evidenceRefs: [] }] });
    expect(status(lost, 'lactose_free')).toBe('unknown');
    expect(() => result({ ...a, evidence: a.evidence.filter(e => !sameRef(e.ref, milk.evidenceRefs[1]!)) }))
      .toThrow('ELIGIBILITY_REFERENCE_MISSING');
  });
  it('DT20-X05: gluten traces block positivity without inventing gluten content', () => {
    const r = result(lactoseMix(), ['gluten_free']);
    expect(r.dietAssessments.find(a => a.diet === 'gluten_free')!.status).toBe('unknown');
    expect(r.warnings).toContain('Documented possible gluten traces');
  });
  it('DT20-X06: explicit gluten-free claim plus gluten warning is unknown', () => {
    const a = addFact(crackers(), { kind: 'trace', substance: 'gluten', warning: 'Synthetic counterexample; not a statement by Schär' }, 1);
    expect(status(a, 'gluten_free')).toBe('unknown');
    expect(result(a).warnings).toContain('Synthetic counterexample; not a statement by Schär');
  });
});

describe('diet completeness, conflicts, scopes and purchase requirements', () => {
  it('unselected unknowns remain explicit and do not forbid the recipe', () => {
    const r = result(lactoseFreeMilk());
    expect(r.eligible).toBe(true);
    expect(r.dietAssessments.find(a => a.diet === 'halal')!.status).toBe('unknown');
    expect(result(fishSauce()).eligible).toBe(true);
    expect(result(fruit(), DIETS).eligible).toBe(true);
  });
  it('a proved violation wins over unrelated missing facts and process unknown', () => {
    let a = request([[composition({ fish: 'present' }, false)], []]);
    a = withRecipe(a, { processEvidenceRefs: [] });
    expect(result(a, ['no_fish', 'halal']).assessment.kind).toBe('violated');
    expect(status(a, 'no_fish')).toBe('violated');
  });
  it('no_fish permits seafood, vegetarian excludes it; lacto-ovo permits eggs/milk/honey', () => {
    const seafood = request([[composition({ fish: 'absent', non_vegetarian: 'present' })]]);
    expect(status(seafood, 'no_fish')).toBe('confirmed');
    expect(status(seafood, 'vegetarian')).toBe('violated');
    expect(status(request([[composition({ milk: 'present', non_vegetarian: 'absent' })]]), 'vegetarian')).toBe('confirmed');
  });
  it('fish traces warn but are not intentional fish; milk traces are not added lactose', () => {
    let a = request([[composition()]]);
    a = addFact(a, { kind: 'trace', substance: 'fish', warning: 'May contain fish; not allergy safety' });
    a = addFact(a, { kind: 'trace', substance: 'milk', warning: 'May contain milk proteins' });
    expect(result(a, ['no_fish', 'lactose_free']).eligible).toBe(true);
    expect(result(a).warnings).toContain('May contain fish; not allergy safety');
  });
  it('lactose-free does not mean free of milk protein and low-lactose is insufficient', () => {
    const r = result(lactoseFreeMilk(), ['lactose_free']);
    expect(r.eligible).toBe(true);
    expect(r.requiredGoodsRequirements.find(x => x.ingredientId === 'i1')!.kind).toBe('lactose_free_claim');
    expect(status(request([[composition({ milk: 'present' })]]), 'lactose_free')).toBe('unknown');
  });
  it('fresh whole plants outside fresh fruit/vegetables still require a gluten-free claim', () => {
    const a = request([[{ kind: 'identity', category: 'fresh_whole_plant', noAdditives: true }]]);
    expect(status(a, 'halal')).toBe('confirmed');
    expect(status(a, 'gluten_free')).toBe('unknown');
  });
  it('named gluten absence on a processed product does not replace manufacturer claim', () => {
    expect(status(request([[composition({ gluten: 'absent' })]]), 'gluten_free')).toBe('unknown');
    expect(status(request([[claim('gluten_free')]]), 'gluten_free')).toBe('unknown');
  });
  it('identity with additives cannot use the fresh whole-product exemption', () => {
    expect(status(request([[{ ...identity, noAdditives: false } as IngredientFact]]), 'halal')).toBe('unknown');
  });
  it.each(['productRef', 'stateRef', 'compositionRef'] as const)('changed %s invalidates prior evidence', field => {
    const a = fruit(), first = a.recipe.ingredients[0]!;
    const changed = withRecipe(a, { ingredients: [{ ...first, [field]: ref(first[field].id, '2') }, a.recipe.ingredients[1]!] });
    expect(status(changed, 'no_fish')).toBe('unknown');
    expect(codes(result(changed, ['no_fish']))).toContain('DIET_UNCONFIRMED');
  });
  it('changed process invalidates process evidence and full time', () => {
    const r = result(withRecipe(fruit(), { processRef: ref('synthetic-process', '2') }), ['no_fish']);
    expect(r.dietAssessments[0]!.process.status).toBe('unknown');
    expect(r.time.kind).toBe('unconfirmed');
  });
  it('new recipe version does not inherit old process or meal-type confirmation', () => {
    const r = result(withRecipe(fruit(), { recipeRef: ref('synthetic-recipe', '2') }), ['no_fish']);
    expect(r.dietAssessments[0]!.status).toBe('unknown');
    expect(r.mealType.kind).toBe('unconfirmed');
    expect(r.data.kind).toBe('unconfirmed');
  });
  it('unresolved composition facts and conflicting manufacturer claims are unknown', () => {
    const a = addFact(crackers(), { kind: 'manufacturer_claim', diet: 'gluten_free', assertion: 'contradicts' }, 1);
    expect(status(a, 'gluten_free')).toBe('unknown');
    expect(codes(result(a, ['gluten_free']))).toContain('EVIDENCE_CONFLICT');
    const b = addFact(request([[composition({ fish: 'present' })]]), composition({ fish: 'absent' }));
    expect(status(b, 'no_fish')).toBe('unknown');
  });
  it('explicit unresolved conflict blocks positivity; independent proven violation still wins', () => {
    const conflict: IngredientFact = { kind: 'conflict', diets: ['vegetarian'], explanation: 'Synthetic disputed origin' };
    expect(status(addFact(fruit(), conflict), 'vegetarian')).toBe('unknown');
    expect(status(addFact(porkGelatin(), conflict, 0), 'vegetarian')).toBe('violated');
  });
  it.each(['gluten_free', 'lactose_free', 'vegetarian'] as const)('conflicting %s statements cannot hide behind inferred identity', diet => {
    const a = addFact(fruit(), { kind: 'manufacturer_claim', diet, assertion: 'contradicts' });
    expect(status(a, diet)).toBe('unknown');
    expect(codes(result(a, [diet]))).toContain('EVIDENCE_CONFLICT');
  });
  it('process violation excludes, but incompatible applicable process claims remain unknown', () => {
    const a = fruit(), p = a.evidence.find(e => e.fact.kind === 'process' && e.fact.diet === 'no_fish')!;
    const negative: DietFactEvidence = { ...p, ref: ref('negative-process'), scope: { kind: 'process', recipeRef, processRef },
      fact: { kind: 'process', diet: 'no_fish',
      outcome: 'violated', explanation: 'Documented fish broth added in process',
      applicability: { scaleRange: null, conditionsConfirmed: true } } };
    const b = { ...withRecipe(a, { processEvidenceRefs: [...a.recipe.processEvidenceRefs, negative.ref] }), evidence: [...a.evidence, negative] };
    expect(status(b, 'no_fish')).toBe('unknown');
    const c = withRecipe(b, { processEvidenceRefs: b.recipe.processEvidenceRefs.filter(r => !sameRef(r, p.ref)) });
    expect(status(c, 'no_fish')).toBe('violated');
    expect(codes(result(c, ['no_fish']))).toContain('DIET_VIOLATION');
  });
  it('a title/tag or a retailer copying a positive claim is not a manufacturer statement', () => {
    const a = lactoseFreeMilk();
    const b = { ...a, sources: a.sources.map(s => sameRef(s.ref, manufacturer) ? { ...s, kind: 'retailer' as const } : s) };
    expect(status(b, 'lactose_free')).toBe('unknown');
  });
  it('preserves warnings, exact goods and supporting references in selected purchase requirements', () => {
    const a = lactoseFreeMilk(), r = result(a, ['lactose_free']);
    const required = r.requiredGoodsRequirements.find(x => x.ingredientId === 'i1')!;
    expect(required).toMatchObject({ productRef: ref('product-1'), stateRef: ref('state-1'),
      compositionRef: ref('composition-1'), kind: 'lactose_free_claim', evidenceRefs: a.recipe.ingredients[1]!.evidenceRefs });
  });
});

function certificate(): Extract<IngredientFact, { kind: 'certificate' }> {
  return { kind: 'certificate', number: 'SYNTHETIC-ONLY-001', issuer: 'IFANCA', validFrom: '2026-10-01',
    validThrough: '2026-10-23', coveredGoods: [ref('product-0')], facility: 'synthetic-facility', processRef,
    processConditionsConfirmed: true, verification: { kind: 'confirmed_by_issuer', sourceRef: issuer, checkedOn: '2026-10-01' } };
}
describe('synthetic IFANCA certificate applicability, not real certificates', () => {
  it('inclusive validity, exact goods/facility, issuer verification and process are required', () => {
    const a = addFact(request([[composition()]]), certificate());
    expect(status(a, 'halal')).toBe('confirmed');
    expect(status({ ...a, evaluationDate: '2026-10-01' }, 'halal')).toBe('confirmed');
    const expired = result({ ...a, evaluationDate: '2026-10-24' }, ['halal']);
    expect(expired.assessment.kind).toBe('unconfirmed');
    expect(codes(expired)).toContain('CERTIFICATE_EXPIRED');
    expect(expired.assessment.reasons.find(r => r.code === 'CERTIFICATE_EXPIRED')!.details)
      .toMatchObject({ evaluationDate: '2026-10-24', validThrough: '2026-10-23' });
    expect(expired.requiredGoodsRequirements[0]!.certificateRefs).toEqual([]);
    const requirement = result(a, ['halal']).requiredGoodsRequirements[0]!;
    expect(requirement.facility).toBe('synthetic-facility'); expect(requirement.certificateRefs).toHaveLength(1);
    expect(a.evidence.find(e => e.fact.kind === 'certificate')!.fact).toEqual(certificate());
  });
  it.each([
    ['unaccepted issuer', { issuer: 'OTHER' }], ['logo without verification', { verification: { kind: 'unconfirmed' } }],
    ['empty number', { number: '' }], ['future start', { validFrom: '2026-10-24', validThrough: '2026-11-01' }],
    ['different goods', { coveredGoods: [ref('different')] }], ['different goods version', { coveredGoods: [ref('product-0', '2')] }],
    ['different facility', { facility: 'other-facility' }], ['different process', { processRef: ref('synthetic-process', '2') }],
    ['unmet processing conditions', { processConditionsConfirmed: false }],
    ['future verification', { verification: { kind: 'confirmed_by_issuer', sourceRef: issuer, checkedOn: '2026-10-24' } }],
  ] as const)('%s cannot establish halal', (_name, changes) => {
    const cert = { ...certificate(), ...changes } as Extract<IngredientFact, { kind: 'certificate' }>;
    expect(status(addFact(request([[composition()]]), cert), 'halal')).toBe('unknown');
  });
  it('verification must be a saved issuer source; no-pork alone cannot establish halal', () => {
    const a = addFact(request([[composition()]]), certificate());
    const b = { ...a, sources: a.sources.map(s => sameRef(s.ref, issuer) ? { ...s, kind: 'manufacturer' as const } : s) };
    expect(status(b, 'halal')).toBe('unknown');
    expect(status(request([[composition({ haram: 'absent' })]]), 'halal')).toBe('unknown');
    expect(status(addFact(request([[composition({ haram: 'present' })]]), certificate()), 'halal')).toBe('violated');
  });
  it('keeps all considered certificates but passes only valid ones to purchasing', () => {
    let a = addFact(request([[composition()]]), { ...certificate(), validThrough: '2026-10-22' });
    a = addFact(a, certificate());
    const r = result(a, ['halal']);
    expect(r.eligible).toBe(true);
    const requirement = r.requiredGoodsRequirements[0]!;
    expect(requirement.certificateRefs).toEqual([a.evidence[a.evidence.length - 1]!.ref]);
    expect(r.basis.evidence.filter(e => e.fact.kind === 'certificate')).toHaveLength(2);
  });
});

describe('full time, exact scale ranges and meal types', () => {
  it('requested type must belong to the confirmed subset; no automatic expansion', () => {
    const a = fruit();
    expect(result(a).mealType.kind).toBe('confirmed');
    for (const requestedMealType of ['breakfast', 'lunch', 'dinner'] as const) {
      const r = result({ ...a, requestedMealType });
      expect(r.mealType.kind).toBe('violated'); expect(r.eligible).toBe(false);
    }
    expect(result(withRecipe(a, { mealTypeEvidenceRefs: [] })).mealType.kind).toBe('unconfirmed');
    expect(result(withRecipe(a, { mealTypes: [] })).mealType.kind).toBe('unconfirmed');
  });
  it.each([['15', 'confirmed'], ['15.001', 'violated']] as const)('full time %s with limit 15', (minutes, expected) => {
    const a = fruit();
    const r = result(withRecipe(a, { timeEvidence: a.recipe.timeEvidence.map(t => ({ ...t, totalMinutes: decimal(minutes) })) }));
    expect(r.time.kind).toBe(expected); expect(r.time.totalMinutes).toEqual(decimal(minutes));
  });
  it('any removes only the numerical limit, not full-time knowledge or applicability', () => {
    const a = { ...fruit(), cookLimit: 'any' as const };
    const unlimited = withRecipe(a, { timeEvidence: a.recipe.timeEvidence.map(t => ({ ...t, totalMinutes: R.of(1000n) })) });
    expect(result(unlimited).eligible).toBe(true);
    expect(result(withRecipe(a, { timeEvidence: [] })).time.kind).toBe('unconfirmed');
    expect(result({ ...a, people: 2 }).time.kind).toBe('unconfirmed');
  });
  it.each(['includesWaiting', 'conditionsConfirmed'] as const)('missing %s cannot confirm full time', field => {
    const a = fruit();
    const b = withRecipe(a, { timeEvidence: a.recipe.timeEvidence.map(t => ({ ...t, [field]: false })) });
    expect(result({ ...b, cookLimit: 'any' }).time.kind).toBe('unconfirmed');
  });
  it('k=H*M/B is exact, duration is not multiplied, ranges respect open/closed ends', () => {
    const a = fruit(), time = a.recipe.timeEvidence[0]!;
    const scaled = withRecipe({ ...a, people: 2, multiplier: R.of(1n, 2n) }, { baseServings: R.of(3n),
      timeEvidence: [{ ...time, scaleRange: { min: R.of(1n, 3n), max: R.of(2n, 3n), minInclusive: true, maxInclusive: false } }] });
    expect(result(scaled).time).toMatchObject({ factor: R.of(1n, 3n), totalMinutes: R.of(10n), kind: 'confirmed' });
    expect(result({ ...scaled, people: 4 }).time.kind).toBe('unconfirmed');
    const closed = withRecipe(scaled, { timeEvidence: scaled.recipe.timeEvidence.map(t => ({ ...t,
      scaleRange: { ...t.scaleRange, maxInclusive: true } })) });
    expect(result({ ...closed, people: 4 }).time.kind).toBe('confirmed');
    const open = withRecipe(scaled, { timeEvidence: scaled.recipe.timeEvidence.map(t => ({ ...t,
      scaleRange: { ...t.scaleRange, minInclusive: false } })) });
    expect(result(open).time.kind).toBe('unconfirmed');
  });
  it('conflicting applicable estimates cannot choose the convenient duration, even with any', () => {
    const a = fruit(), t = a.recipe.timeEvidence[0]!;
    const b = withRecipe(a, { timeEvidence: [t, { ...t, ref: ref('other-time'), totalMinutes: R.of(20n) }] });
    for (const cookLimit of [a.cookLimit, 'any'] as const) {
      const r = result({ ...b, cookLimit });
      expect(r.time.kind).toBe('unconfirmed'); expect(r.time.totalMinutes).toBeNull();
      expect(codes(r)).toContain('EVIDENCE_CONFLICT');
      expect(r.time.applicableEvidenceRefs).toHaveLength(2);
    }
    expect(result(withRecipe(a, { timeEvidence: [t, { ...t, ref: ref('same-time') }] })).time.kind).toBe('confirmed');
  });
  it('non-overlapping ranges do not conflict and future evidence is not applicable', () => {
    const a = fruit(), t = a.recipe.timeEvidence[0]!;
    const b = withRecipe(a, { timeEvidence: [t, { ...t, ref: ref('other-scale'), totalMinutes: R.of(20n),
      scaleRange: { ...t.scaleRange, min: R.of(2n), max: R.of(2n) } }] });
    expect(result(b).time.kind).toBe('confirmed');
    expect(result(withRecipe(a, { timeEvidence: [{ ...t, checkedOn: '2026-10-24' }] })).time.kind).toBe('unconfirmed');
  });
  it('process conditions and its scale range are also checked for the requested k', () => {
    const a = fruit();
    const b: RecipeEligibilityInput = { ...a, evidence: a.evidence.map(e => e.fact.kind === 'process'
      ? { ...e, scope: { kind: 'process', recipeRef, processRef }, fact: { ...e.fact,
        applicability: { conditionsConfirmed: true, scaleRange: { min: ONE, max: ONE, minInclusive: true, maxInclusive: true } } } } : e) };
    expect(status(b, 'no_fish')).toBe('confirmed');
    expect(status({ ...b, people: 2 }, 'no_fish')).toBe('unknown');
    const c: RecipeEligibilityInput = { ...b, evidence: b.evidence.map(e => e.fact.kind === 'process'
      ? { ...e, scope: { kind: 'process', recipeRef, processRef }, fact: { ...e.fact,
        applicability: { ...e.fact.applicability, conditionsConfirmed: false } } } : e) };
    expect(status(c, 'no_fish')).toBe('unknown');
  });
});

describe('required data, boundary errors and pure deterministic snapshots', () => {
  it.each(REQUIRED_DATA_CHECKS)('missing %s is unconfirmed', checkId => {
    const a = fruit();
    const r = result(withRecipe(a, { review: { ...a.recipe.review, checks: a.recipe.review.checks.filter(c => c.checkId !== checkId) } }));
    expect(r.data.kind).toBe('unconfirmed'); expect(r.eligible).toBe(false);
    expect(r.data.reasons.some(r => r.path.endsWith(checkId))).toBe(true);
  });
  it('S1 placeholder is allowed with its accepted review; missing image is incomplete', () => {
    const a = fruit();
    expect(result(a).data.kind).toBe('confirmed');
    expect(result(withRecipe(a, { imageKind: 'missing' })).data.kind).toBe('unconfirmed');
    expect(result(withRecipe(a, { review: { ...a.recipe.review, decision: 'accepted' } })).data.kind).toBe('unconfirmed');
    expect(result(withRecipe(a, { review: { ...a.recipe.review, decision: 'waiting_rule' } })).data.kind).toBe('unconfirmed');
    expect(result(withRecipe(a, { imageKind: 'photo', review: { ...a.recipe.review, decision: 'accepted' } })).data.kind).toBe('confirmed');
  });
  it('unknown own B and missing ingredients cannot be rescued by a saved passed review', () => {
    const a = fruit();
    const r = result(withRecipe(a, { baseServings: null, ingredients: [] }));
    expect(r.data.kind).toBe('unconfirmed'); expect(r.time.factor).toBeNull();
    for (const assessment of r.dietAssessments) { expect(assessment.status).toBe('unknown'); expect(assessment.reasons.length).toBeGreaterThan(0); }
  });
  it('empty capture / future evidence / absent reviewer do not establish a fact', () => {
    const a = fruit();
    for (const changes of [{ fragment: '' }, { checkedOn: '2026-10-24' }, { checkedBy: '' }]) {
      const b = { ...a, sources: a.sources.map(s => sameRef(s.ref, source) ? { ...s, ...changes } : s) };
      expect(result(b, ['no_fish']).eligible).toBe(false);
      expect(status(b, 'no_fish')).toBe('unknown');
    }
  });
  it('future and unreviewed diet evidence does not inherit an old positive status', () => {
    const a = fruit();
    for (const changes of [{ checkedOn: '2026-10-24' }, { checkedBy: '' }]) {
      const b = { ...a, evidence: a.evidence.map(e => e.scope.kind === 'ingredient' ? { ...e, ...changes } : e) };
      expect(status(b, 'no_fish')).toBe('unknown');
    }
  });
  it('does not mutate/freeze caller inputs; repeats are equal and output is detached/frozen', () => {
    const a = fruit(), before = structuredClone(a), r = result(a, ['no_fish']);
    for (let i = 0; i < 3; i++) expect(result(a, ['no_fish'])).toEqual(r);
    expect(structuredClone(a)).toEqual(before);
    expect(Object.isFrozen(a.recipe)).toBe(false); expect(Object.isFrozen(a.evidence[0]!.fact)).toBe(false);
    expect(r.basis.recipe).not.toBe(a.recipe); expect(Object.isFrozen(r.basis.evidence[0]!.fact)).toBe(true);
    expect(Object.isFrozen(r.dietAssessments[0]!.ingredientAssessments)).toBe(true);
    // There is deliberately no price, stock, dislike or variety argument that could create a hard veto.
    expect(result({ ...a, evaluationDate: '2026-11-23' }, ['no_fish']).dietAssessments[0]!.status).toBe('confirmed');
  });
  it.each([
    ['duplicate evidence', (a: RecipeEligibilityInput) => ({ ...a, evidence: [...a.evidence, a.evidence[0]!] })],
    ['duplicate source', (a: RecipeEligibilityInput) => ({ ...a, sources: [...a.sources, a.sources[0]!] })],
    ['unresolved source', (a: RecipeEligibilityInput) => ({ ...a, sources: [] })],
    ['wrong evidence version', (a: RecipeEligibilityInput) => withRecipe(a, { ingredients: a.recipe.ingredients.map(i => ({ ...i, evidenceRefs: [ref(i.evidenceRefs[0]!.id, '2')] })) })],
    ['duplicate ingredient', (a: RecipeEligibilityInput) => withRecipe(a, { ingredients: [a.recipe.ingredients[0]!, a.recipe.ingredients[0]!] })],
    ['duplicate meal type', (a: RecipeEligibilityInput) => withRecipe(a, { mealTypes: ['snack', 'snack'] })],
    ['duplicate data check', (a: RecipeEligibilityInput) => withRecipe(a, { review: { ...a.recipe.review, checks: [...a.recipe.review.checks, a.recipe.review.checks[0]!] } })],
    ['wrong date', (a: RecipeEligibilityInput) => ({ ...a, evaluationDate: '2026-02-30' })],
    ['date trailing newline', (a: RecipeEligibilityInput) => ({ ...a, evaluationDate: '2026-10-23\n' })],
    ['zero version', (a: RecipeEligibilityInput) => withRecipe(a, { recipeRef: ref('r', '0') })],
    ['invalid H', (a: RecipeEligibilityInput) => ({ ...a, people: 0 })],
    ['invalid M', (a: RecipeEligibilityInput) => ({ ...a, multiplier: R.of(3n) })],
    ['duplicate selected diet', (a: RecipeEligibilityInput) => ({ ...a, selectedDiets: ['halal', 'halal'] as const })],
    ['zero B', (a: RecipeEligibilityInput) => withRecipe(a, { baseServings: R.of(0n) })],
    ['zero time', (a: RecipeEligibilityInput) => withRecipe(a, { timeEvidence: a.recipe.timeEvidence.map(t => ({ ...t, totalMinutes: R.of(0n) })) })],
    ['reversed scale range', (a: RecipeEligibilityInput) => withRecipe(a, { timeEvidence: a.recipe.timeEvidence.map(t => ({ ...t,
      scaleRange: { ...t.scaleRange, min: R.of(2n), max: ONE } })) })],
  ] as const)('%s is a technical input failure', (_name, change) => {
    expect(() => result(change(fruit()))).toThrow(/ELIGIBILITY_/);
  });
});

describe('published S1-05 record: explicit test-only semantic projection', () => {
  it('only snack and k=1; no_fish/vegetarian confirmed; GF/LF/halal unknown', () => {
    // The adapter must perform these editorial semantic resolutions. No regex or word search in fragments.
    type RawEvidence = { id: string; recordVersion: string; diet: Diet; subjectRefs: EntityRef[];
      kind: string; sourceRefs: EntityRef[]; checkedOn: string; checkedBy: string };
    type RawRecipe = { id: string; recordVersion: string; baseServings: string; reviewRef: EntityRef;
      ingredients: { ingredientId: string; stateRef: EntityRef }[];
      mealTypes: EligibilityRecipe['mealTypes']; mealTypeEvidenceRefs: EntityRef[];
      timeEvidence: { totalMinutes: string; scaleRange: { min: string; max: string; minInclusive: boolean;
        maxInclusive: boolean; conditions: string }; sourceRefs: EntityRef[]; method: string }[];
      dietAssessments: { diet: Diet; warnings: string[]; status: string }[]; image: { kind: 'placeholder' } };
    type Catalog = { recipes: RawRecipe[]; sources: { id: string; recordVersion: string; kind: EligibilitySource['kind'];
      capturedEvidence: { fragment: string }; checkedOn: string; checkedBy: string }[];
      states: { id: string; recordVersion: string; productRef: EntityRef }[]; dietEvidence: RawEvidence[];
      reviews: { id: string; recordVersion: string; recipeRef: EntityRef; decision: EligibilityRecipe['review']['decision'];
        checkedOn: string; checkedBy: string; checks: { checkId: string; outcome: 'passed' | 'not_applicable';
          evidenceRefs: EntityRef[]; remarks: string }[] }[] };
    const c = JSON.parse(readFileSync(new URL('../../public/catalog/catalog-s1-reference-20261019-r1/snapshot.json', import.meta.url), 'utf8')) as Catalog;
    const raw = c.recipes.find(r => r.id === 'recipe-greek-yogurt-blueberry-walnut')!;
    const rr = ref(raw.id, raw.recordVersion), pr = rr; // Exact immutable recipe version also identifies its steps.
    const review = c.reviews.find(r => sameRef(r, raw.reviewRef))!;
    const sources: EligibilitySource[] = c.sources.map(s => ({ ref: ref(s.id, s.recordVersion), kind: s.kind,
      fragment: s.capturedEvidence.fragment, checkedOn: s.checkedOn, checkedBy: s.checkedBy }));
    const ingredients: EligibilityIngredient[] = raw.ingredients.map(i => {
      const state = c.states.find(s => sameRef(s, i.stateRef))!;
      return { ...i, kind: 'ingredient', productRef: state.productRef, compositionRef: state.productRef, facility: null,
        evidenceRefs: c.dietEvidence.filter(e => e.subjectRefs.some(r => sameRef(r, i.stateRef))).map(e => ref(e.id, e.recordVersion)) };
    });
    const evidence: DietFactEvidence[] = c.dietEvidence.filter(e => e.subjectRefs.some(r => sameRef(r, rr)
      || ingredients.some(i => sameRef(i.stateRef, r)))).map(e => {
      const common = { ref: ref(e.id, e.recordVersion), policyVersion: 'DIET-v1' as const,
        checkedOn: e.checkedOn, checkedBy: e.checkedBy, sourceRefs: e.sourceRefs, warnings: [] };
      const i = ingredients.find(i => e.subjectRefs.some(r => sameRef(r, i.stateRef)));
      if (!i) return { ...common, scope: { kind: 'process' as const, recipeRef: rr, processRef: pr },
        fact: { kind: 'process' as const, diet: e.diet, outcome: 'confirmed' as const,
          explanation: 'DATA_SOURCES §5: cold assembly without added forbidden ingredients',
          applicability: { scaleRange: { min: ONE, max: ONE, minInclusive: true, maxInclusive: true }, conditionsConfirmed: true } } };
      const blueberry = i.ingredientId === 'ingredient-s105-blueberry';
      const yogurt = i.ingredientId === 'ingredient-s105-yogurt';
      // Explicit facts from DATA_SOURCES §5 and retained S1-05 sources, independent of saved statuses.
      const fact: IngredientFact = blueberry ? identity : { kind: 'composition', complete: true, components:
        e.diet === 'no_fish' ? { fish: 'absent' } : e.diet === 'vegetarian' ? { non_vegetarian: 'absent' }
          : e.diet === 'lactose_free' ? { milk: yogurt ? 'present' : 'absent', lactose: 'unknown' }
            : e.diet === 'gluten_free' ? { gluten: 'unknown' } : { haram: 'unknown' } };
      return { ...common, scope: i, fact };
    });
    const recipe: EligibilityRecipe = { recipeRef: rr, processRef: pr, baseServings: decimal(raw.baseServings), ingredients,
      processEvidenceRefs: evidence.filter(e => e.fact.kind === 'process').map(e => e.ref),
      mealTypes: raw.mealTypes, mealTypeRecipeRef: rr, mealTypeEvidenceRefs: raw.mealTypeEvidenceRefs,
      timeEvidence: raw.timeEvidence.map((t, i) => ({ ...t, ref: ref(`${rr.id}/time/${i}`, rr.recordVersion),
        recipeRef: rr, processRef: pr, totalMinutes: decimal(t.totalMinutes), scaleRange: { ...t.scaleRange,
          min: decimal(t.scaleRange.min), max: decimal(t.scaleRange.max) }, conditions: t.scaleRange.conditions,
        includesWaiting: true, conditionsConfirmed: true, checkedOn: review.checkedOn, checkedBy: review.checkedBy })),
      review: { ref: raw.reviewRef, recipeRef: review.recipeRef, policyVersion: 'D06-price-v2', decision: review.decision,
        checkedOn: review.checkedOn, checkedBy: review.checkedBy, checks: review.checks
          .filter(x => REQUIRED_DATA_CHECKS.includes(x.checkId as RequiredDataCheckId))
          .map(x => ({ checkId: x.checkId as RequiredDataCheckId, outcome: x.outcome, sourceRefs: x.evidenceRefs, explanation: x.remarks })) },
      imageKind: raw.image.kind, warnings: raw.dietAssessments.flatMap(a => a.warnings) };
    const a: RecipeEligibilityInput = { recipe, sources, evidence, dietPolicyVersion: 'DIET-v1', evaluationDate: '2026-10-23',
      requestedMealType: 'snack', people: 1, selectedDiets: ['no_fish', 'vegetarian'], cookLimit: { maxMinutes: R.of(15n) } };
    const r = result(a, a.selectedDiets);
    expect(r.eligible).toBe(true);
    expect(r.dietAssessments.map(x => [x.diet, x.status])).toEqual([
      ['no_fish', 'confirmed'], ['gluten_free', 'unknown'], ['lactose_free', 'unknown'], ['vegetarian', 'confirmed'], ['halal', 'unknown'],
    ]);
    expect(r.time).toMatchObject({ kind: 'confirmed', factor: ONE, totalMinutes: R.of(10n) });
    expect(result({ ...a, requestedMealType: 'breakfast' }).mealType.kind).toBe('violated');
    expect(result({ ...a, people: 2 }).time.kind).toBe('unconfirmed');
    for (const diet of ['gluten_free', 'lactose_free', 'halal'] as const) expect(result(a, [diet]).eligible).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(result({ ...a, evaluationDate: '2026-11-23' }, ['no_fish', 'vegetarian']).dietAssessments.map(d => d.status))
      .toEqual(r.dietAssessments.map(d => d.status));
  });
});
