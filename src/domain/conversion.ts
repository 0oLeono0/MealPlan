import { UNITS, convertUnit, sameRef } from './quantity';
import type { EntityRef, Quantity, QuantityBasis } from './quantity';
import type { Rational } from './rational';

export type ExactRange = Readonly<{
  min: Rational; max: Rational; minInclusive: boolean; maxInclusive: boolean;
}>;

export function inExactRange(value: Rational, range: ExactRange): boolean {
  const low = value.compare(range.min);
  const high = value.compare(range.max);
  return range.min.compare(range.max) <= 0
    && (low > 0 || (low === 0 && range.minInclusive))
    && (high < 0 || (high === 0 && range.maxInclusive));
}

/** Resolved domain projection of ConversionDTO, with an exact factor. */
export type Conversion = Readonly<{
  ref: EntityRef; from: QuantityBasis; to: QuantityBasis; factor: Rational;
  method: string; sourceRefs: readonly EntityRef[]; checkedOn: string; checkedBy: string;
  applicability: Readonly<{ conditions: string; fromRange: ExactRange | null }>;
}>;

/** A caller must confirm the conditions AND the chosen direction with evidence.
 * Inverse use is explicit, never inferred from the existence of a forward coefficient.
 * Range is always measured on the conversion's original `from` basis, even in reverse.
 */
export type ConversionStep = Readonly<{
  conversion: Conversion; direction: 'forward' | 'reverse';
  confirmation: Readonly<{ kind: 'confirmed'; evidenceRefs: readonly EntityRef[] }>
    | Readonly<{ kind: 'unconfirmed' }>;
}>;

export type ConversionReason = Readonly<{
  code: 'CONVERSION_MISSING' | 'STOCK_STATE_INCOMPATIBLE'; path: string;
  entityRefs: readonly EntityRef[]; sourceRefs: readonly EntityRef[];
  details: Readonly<{
    fromBasisRef: EntityRef; toBasisRef: EntityRef; fromStateRef: EntityRef; toStateRef: EntityRef;
    explanation: string;
  }>;
}>;
export type ConversionResult =
  | { kind: 'available'; value: Quantity; original: Quantity; steps: readonly ConversionStep[] }
  | { kind: 'unavailable'; original: Quantity; reasons: readonly [ConversionReason] };

function validBasis(basis: QuantityBasis): boolean {
  return UNITS[basis.unit].dimension === basis.dimension && basis.definition.trim() !== '';
}

function equivalent(a: QuantityBasis, b: QuantityBasis): boolean {
  return validBasis(a) && validBasis(b) && sameRef(a.productRef, b.productRef)
    && sameRef(a.stateRef, b.stateRef) && a.dimension === b.dimension
    && (a.dimension !== 'count' || sameRef(a.ref, b.ref));
}

function onBasis(quantity: Quantity, target: QuantityBasis): Quantity | null {
  if (!equivalent(quantity.basis, target)) return null;
  return { value: convertUnit(quantity.value, quantity.basis.unit, target.unit), basis: target };
}

/** Uses one selected, checked chain. No path search, implicit inversion or density defaults. */
export function convertQuantity(original: Quantity, target: QuantityBasis,
  steps: readonly ConversionStep[] = []): ConversionResult {
  function unavailable(explanation: string): ConversionResult {
    return { kind: 'unavailable', original, reasons: [{
      code: sameRef(original.basis.stateRef, target.stateRef) ? 'CONVERSION_MISSING' : 'STOCK_STATE_INCOMPATIBLE',
      path: '/quantity', entityRefs: [original.basis.ref, target.ref], sourceRefs: [],
      details: { fromBasisRef: original.basis.ref, toBasisRef: target.ref,
        fromStateRef: original.basis.stateRef, toStateRef: target.stateRef, explanation },
    }] };
  }
  if (!validBasis(original.basis) || !validBasis(target)) return unavailable('Invalid quantity basis');
  let current = original;
  for (const step of steps) {
    const c = step.conversion;
    if (step.confirmation.kind !== 'confirmed' || step.confirmation.evidenceRefs.length === 0
      || c.sourceRefs.length === 0 || c.factor.n <= 0n || c.method.trim() === ''
      || c.checkedOn.trim() === '' || c.checkedBy.trim() === '' || c.applicability.conditions.trim() === ''
      || !sameRef(c.from.productRef, c.to.productRef) || !validBasis(c.from) || !validBasis(c.to)) {
      return unavailable('Conversion or its direction/conditions lack applicable confirmation');
    }
    const from = step.direction === 'forward' ? c.from : c.to;
    const to = step.direction === 'forward' ? c.to : c.from;
    // The coefficient names exact bases; automatic unit equivalence cannot substitute another piece definition.
    if (!sameRef(current.basis.ref, from.ref) || !sameRef(current.basis.productRef, from.productRef)
      || !sameRef(current.basis.stateRef, from.stateRef) || current.basis.unit !== from.unit) {
      return unavailable('Conversion has a different input basis, product, state or direction');
    }
    const output = step.direction === 'forward' ? current.value.mul(c.factor) : current.value.div(c.factor);
    const fromValue = step.direction === 'forward' ? current.value : output;
    if (c.applicability.fromRange !== null && !inExactRange(fromValue, c.applicability.fromRange)) {
      return unavailable('Quantity is outside the confirmed conversion range');
    }
    current = { value: output, basis: to };
  }
  const value = onBasis(current, target);
  if (value === null) return unavailable('No confirmed conversion chain to the requested basis');
  return { kind: 'available', value, original, steps: [...steps] };
}

/** Normalize units to a resolved base-unit basis, keeping the original in the result. */
export function normalizeQuantity(original: Quantity, baseBasis: QuantityBasis): ConversionResult {
  if (baseBasis.unit !== UNITS[original.basis.unit].baseUnit) {
    throw new Error('EXPECTED_BASE_UNIT_BASIS');
  }
  return convertQuantity(original, baseBasis);
}
