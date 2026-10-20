import { Rational } from './rational';

export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'pcs';
export type Dimension = 'mass' | 'volume' | 'count';
export type EntityRef = Readonly<{ id: string; recordVersion: string }>;

export const UNITS: Readonly<Record<Unit, Readonly<{
  dimension: Dimension; baseUnit: Unit; toBase: Rational; precision: number; label: string;
}>>> = Object.freeze({
  g: { dimension: 'mass', baseUnit: 'g', toBase: Rational.of(1n), precision: 3, label: 'г' },
  kg: { dimension: 'mass', baseUnit: 'g', toBase: Rational.of(1000n), precision: 6, label: 'кг' },
  ml: { dimension: 'volume', baseUnit: 'ml', toBase: Rational.of(1n), precision: 3, label: 'мл' },
  l: { dimension: 'volume', baseUnit: 'ml', toBase: Rational.of(1000n), precision: 6, label: 'л' },
  pcs: { dimension: 'count', baseUnit: 'pcs', toBase: Rational.of(1n), precision: 3, label: 'шт' },
});
Object.values(UNITS).forEach(Object.freeze);

export function isUnit(unit: unknown): unit is Unit {
  return typeof unit === 'string' && Object.prototype.hasOwnProperty.call(UNITS, unit);
}

export type QuantityValidation =
  | { kind: 'valid'; value: Rational; unit: Unit }
  | { kind: 'invalid'; reason: 'UNIT_UNSUPPORTED' | 'QUANTITY_SIGN' | 'QUANTITY_STEP' };

/** Apply to input only; computed quantities may be smaller than, or not multiples of, this step. */
export function validateQuantity(value: Rational, unit: unknown, usage: 'ingredient' | 'stock'): QuantityValidation {
  if (!isUnit(unit)) return { kind: 'invalid', reason: 'UNIT_UNSUPPORTED' };
  if (value.n < 0n || (usage === 'ingredient' && value.n === 0n)) {
    return { kind: 'invalid', reason: 'QUANTITY_SIGN' };
  }
  const step = Rational.of(1n, 10n ** BigInt(UNITS[unit].precision));
  if (!value.isMultipleOf(step)) return { kind: 'invalid', reason: 'QUANTITY_STEP' };
  return { kind: 'valid', value, unit };
}

/** No identity/state inference here: use convertQuantity for physical quantities. */
export function convertUnit(value: Rational, from: Unit, to: Unit): Rational {
  if (UNITS[from].dimension !== UNITS[to].dimension) throw new Error('CONVERSION_REQUIRES_EVIDENCE');
  return value.mul(UNITS[from].toBase).div(UNITS[to].toBase);
}

export type QuantityBasis = Readonly<{
  ref: EntityRef; productRef: EntityRef; stateRef: EntityRef;
  dimension: Dimension; unit: Unit; definition: string;
}>;
export type Quantity = Readonly<{ value: Rational; basis: QuantityBasis }>;

export function sameRef(a: EntityRef, b: EntityRef): boolean {
  return a.id === b.id && a.recordVersion === b.recordVersion;
}
