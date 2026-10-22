import { Rational, ZERO } from './rational';
import { sameRef, UNITS, isUnit, validateQuantity } from './quantity';
import type { EntityRef, Quantity, QuantityBasis } from './quantity';
import { convertQuantity } from './conversion';
import type { ConversionReason, ConversionStep } from './conversion';
import { demandKey } from './demand';
import type { DemandContribution, DemandLine, MenuDemand } from './demand';

export type StockEntry = Readonly<{
  stockEntryId: string; urgent: boolean;
  quantity: Readonly<{ kind: 'known'; value: Quantity }>
    | Readonly<{ kind: 'unknown'; reasons: readonly [StockUnknownReason, ...StockUnknownReason[]];
      unitHint?: QuantityBasis }>;
}>;
export type StockUnknownReason = Readonly<{ code: string; explanation: string }>;
export type StockGroup = Readonly<{
  stockGroupId: string; groupVersion: string; productRef: EntityRef; stateRef: EntityRef;
  basis: QuantityBasis | null; entries: readonly StockEntry[];
}>;
/** Only the explicitly authorized frozen groups, never the entire common pantry. */
export type StockSource = Readonly<{
  mode: 'none' | 'selected'; selectedGroupIds: readonly string[];
  groups: readonly (Readonly<{ kind: 'present'; group: StockGroup }>
    | Readonly<{ kind: 'absent'; stockGroupId: string }>)[];
}>;
/** One selected chain for an entry/target pair. No path search or implicit inverse. */
export type StockTranslation = Readonly<{
  stockEntryId: string; demandKey: string; steps: readonly ConversionStep[];
}>;
export type StockReason = Readonly<{
  code: 'STOCK_QUANTITY_REQUIRED' | 'STOCK_SOURCE_EXCLUDED'; path: string;
  sourceEntryIds: readonly string[];
  details: Readonly<{ required: Quantity; knownStock: Quantity; explanation: string }>;
}>;
export type StockCalculated = Readonly<{ kind: 'available'; value: Quantity }>
  | Readonly<{ kind: 'unavailable'; reasons: readonly [StockReason, ...StockReason[]] }>;
export type StockCoverage = Readonly<{
  slotId: string; order: number; required: Quantity; aKnown: Quantity; uncoveredKnown: Quantity;
  contributions: readonly Readonly<{ contribution: DemandContribution; aKnown: Quantity }>[];
}>;
export type StockDemandLine = DemandLine & Readonly<{
  sourceEntryIds: readonly string[]; unknownEntryIds: readonly string[];
  knownEntries: readonly Readonly<{ stockGroupId: string; stockEntryId: string;
    original: Quantity; quantity: Quantity; steps: readonly ConversionStep[] }>[];
  incompatibleEntries: readonly Readonly<{ stockGroupId: string; stockEntryId: string;
    original: Quantity; attemptedSteps: readonly ConversionStep[]; reasons: readonly ConversionReason[] }>[];
  knownStock: Quantity; usedKnown: Quantity; knownLeftover: Quantity;
  stockTotal: StockCalculated; usedTotal: StockCalculated; deficit: StockCalculated; leftover: StockCalculated;
  slots: readonly StockCoverage[];
}>;
export type StockCalculation = Readonly<{
  planId: string; variantId: string; source: StockSource; lines: readonly StockDemandLine[];
}>;

function snapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof Rational) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)]))) as T;
}
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function min(a: Rational, b: Rational): Rational { return a.compare(b) <= 0 ? a : b; }
function on(value: Rational, basis: QuantityBasis): Quantity { return { value, basis }; }
function available(value: Quantity): StockCalculated { return { kind: 'available', value }; }

/** Consumes S1-09 R and contributions without recipe scaling. Every entry has at most
 * one successful target across the variant; ambiguous resolutions fail, never double S.
 * Output is detached/frozen. Repeats and alternatives start from the same input source.
 */
export function calculateStock(demand: MenuDemand, source: StockSource,
  translations: readonly StockTranslation[] = []): StockCalculation {
  const basisDefinitions = new Map<string, string>();
  const stateProducts = new Map<string, string>();
  function checkRef(ref: EntityRef): void {
    if (!ref.id || !/^[1-9]\d*$/.test(ref.recordVersion)) throw new Error('INVALID_STOCK_REFERENCE');
  }
  function checkBasis(b: QuantityBasis): void {
    [b.ref, b.productRef, b.stateRef].forEach(checkRef);
    if (!isUnit(b.unit) || UNITS[b.unit].dimension !== b.dimension || !b.definition.trim()) {
      throw new Error('INVALID_STOCK_BASIS');
    }
    const key = JSON.stringify([b.ref.id, b.ref.recordVersion]);
    const definition = JSON.stringify([b.productRef.id, b.productRef.recordVersion,
      b.stateRef.id, b.stateRef.recordVersion, b.unit, b.dimension, b.definition]);
    if (basisDefinitions.has(key) && basisDefinitions.get(key) !== definition) throw new Error('CONFLICTING_STOCK_BASIS');
    basisDefinitions.set(key, definition);
    checkState(b.productRef, b.stateRef);
  }
  function checkState(product: EntityRef, state: EntityRef): void {
    checkRef(product); checkRef(state);
    const key = JSON.stringify([state.id, state.recordVersion]);
    const identity = JSON.stringify([product.id, product.recordVersion]);
    if (stateProducts.has(key) && stateProducts.get(key) !== identity) throw new Error('CONFLICTING_STOCK_STATE');
    stateProducts.set(key, identity);
  }
  const lineMap = new Map<string, DemandLine>();
  const slotOrders = new Map<string, number>();
  const orderSlots = new Map<number, string>();
  const ingredientIds = new Set<string>();
  if (!demand.planId || !demand.variantId) throw new Error('DEMAND_MENU_ID_REQUIRED');
  for (const line of demand.lines) {
    checkBasis(line.required.basis);
    if (line.key !== demandKey(line.required.basis) || lineMap.has(line.key)
      || line.required.value.n <= 0n || line.required.basis.unit !== UNITS[line.required.basis.unit].baseUnit) {
      throw new Error('INVALID_STOCK_DEMAND_LINE');
    }
    let total = ZERO;
    for (const c of line.contributions) {
      checkBasis(c.quantity.basis);
      const id = JSON.stringify([c.slotId, c.ingredientId]);
      if (!c.slotId || !c.ingredientId || ingredientIds.has(id) || !Number.isSafeInteger(c.order) || c.order < 0
        || (slotOrders.has(c.slotId) && slotOrders.get(c.slotId) !== c.order)
        || (orderSlots.has(c.order) && orderSlots.get(c.order) !== c.slotId)
        || demandKey(c.quantity.basis) !== line.key || c.quantity.basis.unit !== line.required.basis.unit
        || c.quantity.value.n <= 0n) throw new Error('INVALID_STOCK_DEMAND_CONTRIBUTION');
      ingredientIds.add(id); slotOrders.set(c.slotId, c.order); orderSlots.set(c.order, c.slotId);
      total = total.add(c.quantity.value);
    }
    if (!total.equals(line.required.value)) throw new Error('STOCK_DEMAND_TOTAL_MISMATCH');
    lineMap.set(line.key, line);
  }
  const selected = new Set(source.selectedGroupIds);
  if ((source.mode !== 'none' && source.mode !== 'selected')
    || selected.size !== source.selectedGroupIds.length || source.selectedGroupIds.some(id => !id)
    || (source.mode === 'none' && (selected.size !== 0 || source.groups.length !== 0))
    || (source.mode === 'selected' && selected.size === 0)) throw new Error('INVALID_STOCK_SOURCE');
  const entries = new Map<string, { group: StockGroup; entry: StockEntry }>();
  const groups = new Set<string>();
  for (const item of source.groups) {
    const id = item.kind === 'present' ? item.group.stockGroupId : item.stockGroupId;
    if (!selected.has(id) || groups.has(id)) throw new Error('UNSELECTED_OR_DUPLICATE_STOCK_GROUP');
    groups.add(id);
    if (item.kind === 'absent') continue;
    const g = item.group;
    checkState(g.productRef, g.stateRef);
    if (!/^(0|[1-9]\d*)$/.test(g.groupVersion)) throw new Error('INVALID_STOCK_GROUP_VERSION');
    if (g.basis) {
      checkBasis(g.basis);
      if (!sameRef(g.basis.productRef, g.productRef) || !sameRef(g.basis.stateRef, g.stateRef)) {
        throw new Error('STOCK_GROUP_BASIS_MISMATCH');
      }
    }
    for (const entry of g.entries) {
      if (!entry.stockEntryId || entries.has(entry.stockEntryId)) throw new Error('DUPLICATE_OR_INVALID_STOCK_ENTRY');
      const q = entry.quantity;
      const b = q.kind === 'known' ? q.value.basis : q.unitHint;
      if (b) {
        checkBasis(b);
        if (!sameRef(b.productRef, g.productRef) || !sameRef(b.stateRef, g.stateRef)) {
          throw new Error('STOCK_ENTRY_STATE_MISMATCH');
        }
        // Validate group metadata without assigning a synthetic number to an unknown hint.
        if (!g.basis || b.dimension !== g.basis.dimension
          || (b.dimension === 'count' && !sameRef(b.ref, g.basis.ref))) {
          throw new Error('STOCK_ENTRY_GROUP_BASIS_MISMATCH');
        }
      }
      if (q.kind === 'known' && validateQuantity(q.value.value, q.value.basis.unit, 'stock').kind !== 'valid') {
        throw new Error('INVALID_STOCK_QUANTITY');
      }
      if (q.kind === 'unknown' && (q.reasons.length === 0 || q.reasons.some(r => !r.code || !r.explanation.trim()))) {
        throw new Error('STOCK_UNKNOWN_REASON_REQUIRED');
      }
      entries.set(entry.stockEntryId, { group: g, entry });
    }
  }
  if (groups.size !== selected.size) throw new Error('STOCK_GROUP_PRESENCE_REQUIRED');
  const routes = new Map<string, readonly ConversionStep[]>();
  for (const route of translations) {
    const id = JSON.stringify([route.stockEntryId, route.demandKey]);
    const entry = entries.get(route.stockEntryId);
    const line = lineMap.get(route.demandKey);
    if (routes.has(id) || entry?.entry.quantity.kind !== 'known' || !line
      || !sameRef(entry.group.productRef, line.required.basis.productRef)) throw new Error('INVALID_STOCK_TRANSLATION');
    for (const step of route.steps) { checkBasis(step.conversion.from); checkBasis(step.conversion.to); }
    routes.set(id, route.steps);
  }
  const matched = new Set<string>();
  const sortedEntries = [...entries.values()].sort((a, b) => compareText(a.entry.stockEntryId, b.entry.stockEntryId));
  const lines = [...demand.lines].sort((a, b) => compareText(a.key, b.key)).map(line => {
    const basis = line.required.basis;
    const knownEntries: StockDemandLine['knownEntries'][number][] = [];
    const incompatibleEntries: StockDemandLine['incompatibleEntries'][number][] = [];
    const unknownEntryIds: string[] = [];
    let stock = ZERO;
    for (const { group, entry } of sortedEntries) {
      if (!sameRef(group.productRef, basis.productRef)) continue;
      const q = entry.quantity;
      if (q.kind === 'unknown') {
        // A hint is intent, not evidence that unknown stock is numerically incompatible.
        if (sameRef(group.stateRef, basis.stateRef)) unknownEntryIds.push(entry.stockEntryId);
        continue;
      }
      const steps = routes.get(JSON.stringify([entry.stockEntryId, line.key])) ?? [];
      const direct = convertQuantity(q.value, basis);
      // A selected chain must not hide or rescale already compatible stock.
      if (direct.kind === 'available' && steps.length > 0) throw new Error('REDUNDANT_STOCK_TRANSLATION');
      const result = direct.kind === 'available' ? direct : convertQuantity(q.value, basis, steps);
      if (result.kind === 'unavailable') {
        incompatibleEntries.push({ stockGroupId: group.stockGroupId, stockEntryId: entry.stockEntryId,
          original: q.value, attemptedSteps: steps, reasons: result.reasons });
      } else {
        if (matched.has(entry.stockEntryId)) throw new Error('AMBIGUOUS_STOCK_TARGET');
        matched.add(entry.stockEntryId);
        stock = stock.add(result.value.value);
        knownEntries.push({ stockGroupId: group.stockGroupId, stockEntryId: entry.stockEntryId,
          original: q.value, quantity: result.value, steps: result.steps });
      }
    }
    const knownStock = on(stock, basis);
    const used = min(stock, line.required.value);
    const usedKnown = on(used, basis);
    const knownLeftover = on(stock.sub(used), basis);
    const reason: StockReason = { code: 'STOCK_QUANTITY_REQUIRED', path: `/demand/${line.key}`,
      sourceEntryIds: unknownEntryIds, details: { required: line.required, knownStock,
        explanation: 'Selected stock contains entries of this product/state with unknown quantity' } };
    const unknown: StockCalculated = { kind: 'unavailable', reasons: [reason] };
    const hasUnknown = unknownEntryIds.length > 0;
    const isCovered = stock.compare(line.required.value) >= 0;
    const slots: StockCoverage[] = [];
    let remaining = used;
    const slotContributions = new Map<string, DemandContribution[]>();
    for (const c of [...line.contributions].sort((a, b) => a.order - b.order || compareText(a.ingredientId, b.ingredientId))) {
      const list = slotContributions.get(c.slotId) ?? [];
      list.push(c); slotContributions.set(c.slotId, list);
    }
    for (const [slotId, contributions] of slotContributions) {
      const required = contributions.reduce((sum, c) => sum.add(c.quantity.value), ZERO);
      const a = min(remaining, required);
      remaining = remaining.sub(a);
      let forIngredients = a;
      const covered = contributions.map(contribution => {
        const aKnown = min(forIngredients, contribution.quantity.value);
        forIngredients = forIngredients.sub(aKnown);
        return { contribution, aKnown: on(aKnown, basis) };
      });
      slots.push({ slotId, order: slotOrders.get(slotId)!, required: on(required, basis),
        aKnown: on(a, basis), uncoveredKnown: on(required.sub(a), basis), contributions: covered });
    }
    const leftover: StockCalculated = source.mode === 'none'
      ? { kind: 'unavailable', reasons: [{ ...reason, code: 'STOCK_SOURCE_EXCLUDED',
        details: { ...reason.details, explanation: 'Common stock is excluded; its remainder is not projected' } }] }
      : hasUnknown ? unknown : available(knownLeftover);
    return { ...line, knownStock, usedKnown, knownLeftover, knownEntries, incompatibleEntries, unknownEntryIds,
      sourceEntryIds: [...knownEntries.map(e => e.stockEntryId), ...unknownEntryIds].sort(compareText),
      stockTotal: hasUnknown ? unknown : available(knownStock),
      usedTotal: hasUnknown && !isCovered ? unknown : available(usedKnown),
      deficit: hasUnknown && !isCovered ? unknown : available(on(line.required.value.sub(used), basis)),
      leftover, slots };
  });
  return snapshot({ planId: demand.planId, variantId: demand.variantId, source, lines });
}
