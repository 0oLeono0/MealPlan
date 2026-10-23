import { Rational, ZERO } from './rational';
import { matchesEntire } from './numberInput';
import { isUnit, sameRef, UNITS } from './quantity';
import type { EntityRef, Quantity, QuantityBasis } from './quantity';
import { convertQuantity } from './conversion';
import type { ConversionReason, ConversionStep } from './conversion';
import { demandKey } from './demand';
import type { DemandContribution } from './demand';
import type { StockCalculation, StockDemandLine, StockReason } from './stock';

export type PriceKey = Readonly<{ stateRef: EntityRef; basisRef: EntityRef }>;
export type PriceExplanation = Readonly<{ code: string; explanation: string }>;
/** Resolved numeric projection, not a catalog DTO or a live store offer. */
export type ReferencePriceEstimate = Readonly<{
  ref: EntityRef; productRef: EntityRef; stateRef: EntityRef; currency: 'RUB';
  amountRub: Rational; priceBasis: Quantity;
  referenceSale: Readonly<{ kind: 'by_quantity' }>
    | Readonly<{ kind: 'indivisible'; packageContent: Quantity; label: string; sourceRefs: readonly EntityRef[] }>;
  assessedOn: string; checkedOn: string;
  observations: readonly Readonly<{ ref: EntityRef; observedOn: string; checkedOn: string }>[];
  zeroPriceEvidenceRefs: readonly EntityRef[];
}>;
export type ReferencePriceSelection = Readonly<{
  key: PriceKey; basis: QuantityBasis; steps: readonly ConversionStep[];
  resolution: Readonly<{ kind: 'available'; estimateRef: EntityRef }>
    | Readonly<{ kind: 'missing'; missingFields: readonly [string, ...string[]];
      reasons: readonly [PriceExplanation, ...PriceExplanation[]] }>
    | Readonly<{ kind: 'withdrawn'; estimateRef: EntityRef; withdrawnOn: string; withdrawnBy: string;
      evidenceRefs: readonly EntityRef[]; decisionRef: EntityRef;
      reasons: readonly [PriceExplanation, ...PriceExplanation[]] }>;
}>;
export type ReferencePriceSet = Readonly<{
  ref: EntityRef; catalogVersion: string; pricePolicyVersion: 'reference-price-v1'; currency: 'RUB';
  setDigest: string; assessedOn: string; checkedOn: string; publishedOn: string;
  selections: readonly ReferencePriceSelection[]; estimates: readonly ReferencePriceEstimate[];
}>;
export type PriceReason = Readonly<{
  code: 'PRICE_ESTIMATE_MISSING' | 'PRICE_ESTIMATE_WITHDRAWN'; path: string;
  entityRefs: readonly EntityRef[]; sourceRefs: readonly EntityRef[];
  details: Readonly<{ priceSetRef: EntityRef; key: PriceKey }> & (
    | Readonly<{ missingFields: readonly string[]; explanations: readonly PriceExplanation[] }>
    | Readonly<{ estimateRef: EntityRef; withdrawnOn: string; withdrawalReason: string }>
  );
}>;
export type MoneyReason = PriceReason | StockReason | ConversionReason;
export type CalculatedMoney<T = Rational> = Readonly<{ kind: 'available'; value: T }>
  | Readonly<{ kind: 'unavailable'; reasons: readonly [MoneyReason, ...MoneyReason[]] }>;
export type Acquisition = Readonly<{
  requestedQuantity: Quantity; purchasedQuantity: Quantity; amountRub: Rational; estimateRef: EntityRef;
}> & (Readonly<{ saleKind: 'by_quantity' }>
  | Readonly<{ saleKind: 'indivisible'; packageCount: string; packageContent: Quantity }>);
export type IngredientCost = Readonly<{
  demandLineId: string; priceSelectionRef: PriceKey; contribution: DemandContribution;
  ingredientCost: CalculatedMoney;
}>;
export type ShoppingMoneyLine = Readonly<{
  shoppingLineId: string; demandLineId: string; demand: StockDemandLine; priceSelectionRef: PriceKey;
  ingredientCost: CalculatedMoney; contributions: readonly IngredientCost[];
  withoutStockAcquisition: CalculatedMoney<Acquisition>; acquisition: CalculatedMoney<Acquisition>;
}>;
export type BudgetAssessment = Readonly<{ actual: CalculatedMoney; budgetRub: Rational }> & (
  | Readonly<{ kind: 'confirmed' }>
  | Readonly<{ kind: 'violated'; code: 'BUDGET_EXCEEDED'; excessRub: Rational }>
  | Readonly<{ kind: 'unconfirmed'; reasons: readonly [MoneyReason, ...MoneyReason[]] }>
);
export type MoneyCalculationInput = Readonly<{
  stock: StockCalculation; prices: ReferencePriceSet;
  versions: Readonly<{ catalogVersion: string; priceSetRef: EntityRef; pricePolicyVersion: 'reference-price-v1' }>;
  evaluationDate: string; timeZone: string; budgetRub: Rational;
}>;
export type MoneyCalculation = Readonly<{
  planId: string; variantId: string;
  basis: Omit<MoneyCalculationInput, 'stock' | 'budgetRub'>;
  lines: readonly ShoppingMoneyLine[];
  slots: readonly Readonly<{ slotId: string; order: number; ingredientCostC: CalculatedMoney;
    contributions: readonly IngredientCost[] }>[];
  money: Readonly<{ C: CalculatedMoney; A0: CalculatedMoney; A1: CalculatedMoney;
    E: CalculatedMoney; T: CalculatedMoney; O: CalculatedMoney; K: Rational;
    unresolvedLineIds: readonly string[]; budgetRub: Rational; budgetAssessment: BudgetAssessment }>;
}>;

function snapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof Rational) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)]))) as T;
}
function available<T>(value: T): CalculatedMoney<T> { return { kind: 'available', value }; }
function unavailable<T>(reasons: readonly MoneyReason[]): CalculatedMoney<T> {
  // The same missing price may affect C, A0 and A1; retain it once, including its line path.
  const unique = [...new Map(reasons.map(r => [JSON.stringify(r, (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v), r])).values()];
  const [first, ...rest] = unique;
  if (!first) throw new Error('MONEY_REASON_REQUIRED');
  return { kind: 'unavailable', reasons: [first, ...rest] };
}
function sum(values: readonly CalculatedMoney[]): CalculatedMoney {
  const reasons = values.flatMap(v => v.kind === 'unavailable' ? v.reasons : []);
  return reasons.length ? unavailable(reasons)
    : available(values.reduce((a, v) => v.kind === 'available' ? a.add(v.value) : a, ZERO));
}
function difference(a: CalculatedMoney, b: CalculatedMoney): CalculatedMoney {
  return a.kind === 'available' && b.kind === 'available' ? available(a.value.sub(b.value))
    : unavailable([...(a.kind === 'unavailable' ? a.reasons : []), ...(b.kind === 'unavailable' ? b.reasons : [])]);
}
function amount(a: CalculatedMoney<Acquisition>): CalculatedMoney {
  return a.kind === 'available' ? available(a.value.amountRub) : a;
}
function refKey(r: EntityRef): string { return JSON.stringify([r.id, r.recordVersion]); }
function priceKey(k: PriceKey): string { return JSON.stringify([refKey(k.stateRef), refKey(k.basisRef)]); }
function keyFor(b: QuantityBasis): PriceKey { return { stateRef: b.stateRef, basisRef: b.ref }; }
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** CanonicalJSON-v1 array of strings; versions belong to the calculation basis, not runtime IDs. */
export function moneyLineId(namespace: 'demand' | 'shopping', planId: string, variantId: string,
  key: PriceKey): string {
  return `${namespace}:${JSON.stringify([planId, variantId, key.stateRef.id, key.basisRef.id])}`;
}

/** No scaling, stock allocation, clock, store lookup or catalog choice occurs here. */
export function calculateMoney(input: MoneyCalculationInput): MoneyCalculation {
  const { stock, prices, versions, budgetRub, evaluationDate, timeZone } = input;
  function invalid(): never { throw new Error('MONEY_PAYLOAD_INVALID'); }
  function checkRef(r: EntityRef): void {
    if (!r.id || !matchesEntire(/^[1-9]\d*$/, r.recordVersion)) invalid();
  }
  function checkDate(s: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(`${s}T00:00:00Z`))
      || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) invalid();
  }
  checkRef(prices.ref); checkRef(versions.priceSetRef); checkDate(evaluationDate);
  [prices.assessedOn, prices.checkedOn, prices.publishedOn].forEach(checkDate);
  if (prices.pricePolicyVersion !== 'reference-price-v1' || versions.pricePolicyVersion !== prices.pricePolicyVersion) {
    throw new Error('MONEY_VERSION_UNSUPPORTED');
  }
  if (!sameRef(prices.ref, versions.priceSetRef) || prices.catalogVersion !== versions.catalogVersion) {
    throw new Error('MONEY_PRICE_SET_MISMATCH');
  }
  if (!stock.planId || !stock.variantId || !prices.catalogVersion || !prices.setDigest || !timeZone
    || prices.currency !== 'RUB' || budgetRub.n < 0n || prices.assessedOn > prices.checkedOn
    || prices.checkedOn > prices.publishedOn || prices.publishedOn > evaluationDate) invalid();

  const bases = new Map<string, string>();
  const states = new Map<string, string>();
  function checkBasis(b: QuantityBasis): void {
    [b.ref, b.productRef, b.stateRef].forEach(checkRef);
    if (!isUnit(b.unit) || b.dimension !== UNITS[b.unit].dimension || !b.definition.trim()) invalid();
    const id = refKey(b.ref);
    const body = JSON.stringify([refKey(b.productRef), refKey(b.stateRef), b.dimension, b.unit, b.definition]);
    if (bases.has(id) && bases.get(id) !== body) invalid();
    bases.set(id, body);
    const state = refKey(b.stateRef), product = refKey(b.productRef);
    if (states.has(state) && states.get(state) !== product) invalid();
    states.set(state, product);
  }
  const estimates = new Map<string, ReferencePriceEstimate>();
  for (const e of prices.estimates) {
    [e.ref, e.productRef, e.stateRef, ...e.zeroPriceEvidenceRefs].forEach(checkRef);
    checkBasis(e.priceBasis.basis); checkDate(e.assessedOn); checkDate(e.checkedOn);
    if (estimates.has(refKey(e.ref)) || e.currency !== 'RUB' || e.amountRub.n < 0n
      || (e.amountRub.n === 0n && e.zeroPriceEvidenceRefs.length === 0) || e.priceBasis.value.n <= 0n
      || !sameRef(e.productRef, e.priceBasis.basis.productRef) || !sameRef(e.stateRef, e.priceBasis.basis.stateRef)
      || e.assessedOn > e.checkedOn || e.checkedOn > prices.checkedOn || e.assessedOn > prices.assessedOn
      || e.observations.length === 0) invalid();
    for (const o of e.observations) {
      checkRef(o.ref); checkDate(o.observedOn); checkDate(o.checkedOn);
      if (o.observedOn > e.assessedOn || o.observedOn > o.checkedOn || o.checkedOn > e.checkedOn) invalid();
    }
    if (e.referenceSale.kind === 'indivisible') {
      const sale = e.referenceSale;
      checkBasis(sale.packageContent.basis); sale.sourceRefs.forEach(checkRef);
      if (!sale.label.trim() || !sale.sourceRefs.length || !sameRef(sale.packageContent.basis.ref, e.priceBasis.basis.ref)
        || !sale.packageContent.value.equals(e.priceBasis.value)) invalid();
    } else if (e.referenceSale.kind !== 'by_quantity') invalid();
    estimates.set(refKey(e.ref), e);
  }
  const selections = new Map<string, ReferencePriceSelection>();
  const conversions = new Map<string, string>();
  for (const s of prices.selections) {
    checkRef(s.key.stateRef); checkRef(s.key.basisRef); checkBasis(s.basis);
    if (priceKey(s.key) !== priceKey(keyFor(s.basis)) || selections.has(priceKey(s.key))) invalid();
    const resolution = s.resolution;
    if (resolution.kind === 'missing') {
      if (!resolution.missingFields.length || resolution.missingFields.some(f => !f.trim())) invalid();
    } else {
      checkRef(resolution.estimateRef);
      const e = estimates.get(refKey(resolution.estimateRef));
      if (!e) throw new Error('MONEY_REFERENCE_MISSING');
      if (!sameRef(e.productRef, s.basis.productRef)) invalid();
      if ((e.stateRef.id === s.key.stateRef.id && !sameRef(e.stateRef, s.key.stateRef))
        || (e.priceBasis.basis.ref.id === s.key.basisRef.id && !sameRef(e.priceBasis.basis.ref, s.key.basisRef))) invalid();
      if (resolution.kind === 'withdrawn') {
        checkDate(resolution.withdrawnOn); checkRef(resolution.decisionRef); resolution.evidenceRefs.forEach(checkRef);
        if (resolution.withdrawnOn > prices.checkedOn || !resolution.withdrawnBy.trim() || !resolution.evidenceRefs.length) invalid();
      } else if (resolution.kind !== 'available') invalid();
    }
    // Every named link must connect exactly, including links retained by a missing selection.
    // An absent physical translation or unconfirmed applicability is business incompleteness.
    let current = s.basis;
    for (const step of s.steps) {
      const c = step.conversion;
      checkRef(c.ref); checkBasis(c.from); checkBasis(c.to);
      [...c.sourceRefs, ...(step.confirmation.kind === 'confirmed' ? step.confirmation.evidenceRefs : [])].forEach(checkRef);
      const range = c.applicability.fromRange;
      const body = JSON.stringify([refKey(c.from.ref), refKey(c.to.ref), c.factor.n.toString(), c.factor.d.toString(),
        c.method, c.sourceRefs.map(refKey), c.checkedOn, c.checkedBy, c.applicability.conditions,
        range && [range.min.n.toString(), range.min.d.toString(), range.max.n.toString(), range.max.d.toString(),
          range.minInclusive, range.maxInclusive]]);
      if (conversions.has(refKey(c.ref)) && conversions.get(refKey(c.ref)) !== body) invalid();
      conversions.set(refKey(c.ref), body);
      if (step.direction !== 'forward' && step.direction !== 'reverse') invalid();
      const from = step.direction === 'forward' ? c.from : c.to;
      const to = step.direction === 'forward' ? c.to : c.from;
      if (!sameRef(current.ref, from.ref) || !sameRef(s.basis.productRef, to.productRef) || c.factor.n <= 0n) invalid();
      current = to;
    }
    if (resolution.kind !== 'missing' && s.steps.length
      && !sameRef(current.ref, estimates.get(refKey(resolution.estimateRef))!.priceBasis.basis.ref)) invalid();
    if (resolution.kind !== 'available'
      && (!resolution.reasons.length || resolution.reasons.some(r => !r.code || !r.explanation.trim()))) invalid();
    selections.set(priceKey(s.key), s);
  }

  const ids = new Set<string>();
  const slotOrders = new Map<string, number>();
  const orderSlots = new Map<number, string>();
  const ingredients = new Set<string>();
  const lines: ShoppingMoneyLine[] = [...stock.lines].sort((a, b) => compareText(a.key, b.key)).map(line => {
    checkBasis(line.required.basis);
    const key = keyFor(line.required.basis);
    const demandLineId = moneyLineId('demand', stock.planId, stock.variantId, key);
    const shoppingLineId = moneyLineId('shopping', stock.planId, stock.variantId, key);
    if (ids.has(demandLineId) || line.key !== demandKey(line.required.basis) || line.required.value.n <= 0n) invalid();
    ids.add(demandLineId);
    const selection = selections.get(priceKey(key));
    if (!selection) throw new Error('MONEY_REFERENCE_MISSING');
    // Detect conflicting demand/price basis definitions even when their IDs match.
    if (!sameRef(selection.basis.productRef, line.required.basis.productRef)) invalid();
    if (line.deficit.kind === 'available') {
      checkBasis(line.deficit.value.basis);
      if (demandKey(line.deficit.value.basis) !== line.key || line.deficit.value.basis.unit !== line.required.basis.unit
        || line.deficit.value.value.n < 0n || line.deficit.value.value.compare(line.required.value) > 0) invalid();
    } else if (!line.deficit.reasons.length) invalid();

    const r = selection.resolution;
    const priceReasons: MoneyReason[] = [];
    if (r.kind === 'missing') priceReasons.push({ code: 'PRICE_ESTIMATE_MISSING', path: `/shopping/${shoppingLineId}`,
      entityRefs: [prices.ref, key.stateRef, key.basisRef], sourceRefs: [],
      details: { priceSetRef: prices.ref, key, missingFields: r.missingFields, explanations: r.reasons } });
    if (r.kind === 'withdrawn') priceReasons.push({ code: 'PRICE_ESTIMATE_WITHDRAWN', path: `/shopping/${shoppingLineId}`,
      entityRefs: [prices.ref, r.estimateRef, r.decisionRef], sourceRefs: r.evidenceRefs,
      details: { priceSetRef: prices.ref, key, estimateRef: r.estimateRef, withdrawnOn: r.withdrawnOn,
        withdrawalReason: r.reasons.map(reason => reason.explanation).join('; ') } });
    const estimate = r.kind === 'available' ? estimates.get(refKey(r.estimateRef))! : null;
    function converted(q: Quantity): CalculatedMoney<Quantity> {
      if (!estimate) return unavailable(priceReasons);
      const result = convertQuantity(q, estimate.priceBasis.basis, selection!.steps);
      return result.kind === 'available' ? available(result.value)
        : unavailable(result.reasons.map(reason => ({ ...reason, code: 'CONVERSION_MISSING' as const,
          path: `/shopping/${shoppingLineId}` })));
    }
    function cost(q: Quantity): CalculatedMoney {
      const result = converted(q);
      return result.kind === 'unavailable' ? result
        : available(result.value.value.div(estimate!.priceBasis.value).mul(estimate!.amountRub));
    }
    function acquire(q: Quantity): CalculatedMoney<Acquisition> {
      const result = converted(q);
      if (result.kind === 'unavailable') return result;
      const e = estimate!, requestedQuantity = result.value;
      if (e.referenceSale.kind === 'by_quantity') return available({ saleKind: 'by_quantity',
        requestedQuantity, purchasedQuantity: requestedQuantity, estimateRef: e.ref,
        amountRub: requestedQuantity.value.div(e.priceBasis.value).mul(e.amountRub) });
      const count = requestedQuantity.value.div(e.priceBasis.value).ceil();
      return available({ saleKind: 'indivisible', requestedQuantity, estimateRef: e.ref,
        purchasedQuantity: { value: e.priceBasis.value.mul(Rational.of(count)), basis: e.priceBasis.basis },
        packageCount: count.toString(), packageContent: e.referenceSale.packageContent,
        amountRub: e.amountRub.mul(Rational.of(count)) });
    }
    let total = ZERO;
    const contributions = line.contributions.map(c => {
      checkBasis(c.quantity.basis);
      const id = JSON.stringify([c.slotId, c.ingredientId]);
      if (!c.slotId || !c.ingredientId || ingredients.has(id) || !Number.isSafeInteger(c.order) || c.order < 0
        || (slotOrders.has(c.slotId) && slotOrders.get(c.slotId) !== c.order)
        || (orderSlots.has(c.order) && orderSlots.get(c.order) !== c.slotId)
        || demandKey(c.quantity.basis) !== line.key || c.quantity.basis.unit !== line.required.basis.unit
        || c.quantity.value.n <= 0n) invalid();
      ingredients.add(id); slotOrders.set(c.slotId, c.order); orderSlots.set(c.order, c.slotId);
      total = total.add(c.quantity.value);
      return { demandLineId, priceSelectionRef: key, contribution: c, ingredientCost: cost(c.quantity) };
    });
    if (!total.equals(line.required.value)) invalid();
    const acquisition = line.deficit.kind === 'available' ? acquire(line.deficit.value)
      : unavailable<Acquisition>([...priceReasons, ...line.deficit.reasons]);
    return { shoppingLineId, demandLineId, demand: line, priceSelectionRef: key, contributions,
      ingredientCost: sum(contributions.map(c => c.ingredientCost)),
      withoutStockAcquisition: acquire(line.required), acquisition };
  });
  const C = sum(lines.map(l => l.ingredientCost));
  const A0 = sum(lines.map(l => amount(l.withoutStockAcquisition)));
  const A1 = sum(lines.map(l => amount(l.acquisition)));
  const T = A1, E = difference(A0, A1), O = difference(available(budgetRub), T);
  const K = lines.reduce((s, l) => l.acquisition.kind === 'available' ? s.add(l.acquisition.value.amountRub) : s, ZERO);
  const budgetAssessment: BudgetAssessment = T.kind === 'unavailable'
    ? { kind: 'unconfirmed', actual: T, budgetRub, reasons: T.reasons }
    : T.value.compare(budgetRub) <= 0 ? { kind: 'confirmed', actual: T, budgetRub }
      : { kind: 'violated', actual: T, budgetRub, code: 'BUDGET_EXCEEDED', excessRub: T.value.sub(budgetRub) };
  const slots = [...slotOrders].sort((a, b) => a[1] - b[1]).map(([slotId, order]) => {
    const contributions = lines.flatMap(l => l.contributions).filter(c => c.contribution.slotId === slotId)
      .sort((a, b) => compareText(a.contribution.ingredientId, b.contribution.ingredientId));
    return { slotId, order, contributions, ingredientCostC: sum(contributions.map(c => c.ingredientCost)) };
  });
  return snapshot({ planId: stock.planId, variantId: stock.variantId,
    basis: { prices, versions, evaluationDate, timeZone }, lines, slots,
    money: { C, A0, A1, E, T, O, K, budgetRub, budgetAssessment,
      unresolvedLineIds: lines.filter(l => l.acquisition.kind === 'unavailable').map(l => l.shoppingLineId) } });
}
