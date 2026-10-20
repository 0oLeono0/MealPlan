import { Rational, ZERO } from './rational';
import { UNITS } from './quantity';
import type { Unit } from './quantity';

/** Integer display ticks, never a replacement for the original Rational. */
export function roundHalfAwayFromZero(value: Rational, places: number): bigint {
  if (!Number.isSafeInteger(places) || places < 0) throw new Error('INVALID_DISPLAY_PRECISION');
  const magnitude = (value.n < 0n ? -value.n : value.n) * 10n ** BigInt(places);
  const rounded = magnitude / value.d + (2n * (magnitude % value.d) >= value.d ? 1n : 0n);
  return value.n < 0n ? -rounded : rounded;
}

export function formatDecimal(value: Rational, places: number, trimZeros = false): string {
  const ticks = roundHalfAwayFromZero(value, places);
  const digits = (ticks < 0n ? -ticks : ticks).toString().padStart(places + 1, '0');
  const whole = places === 0 ? digits : digits.slice(0, -places);
  let fraction = places === 0 ? '' : digits.slice(-places);
  if (trimZeros) fraction = fraction.replace(/0+$/u, '');
  const grouped = whole.replace(/\B(?=(?:[0-9]{3})+(?![0-9]))/gu, ' ');
  return `${ticks < 0n ? '−' : ''}${grouped}${fraction === '' ? '' : `,${fraction}`}`;
}

export function formatQuantity(value: Rational, unit: Unit): string {
  const { precision, label } = UNITS[unit];
  const step = Rational.of(1n, 10n ** BigInt(precision));
  if (value.n > 0n && value.compare(step) < 0) return `< ${formatDecimal(step, precision)} ${label}`;
  return `${formatDecimal(value, precision, true)} ${label}`;
}

export function formatMoney(value: Rational): string { return `${formatDecimal(value, 2)} ₽`; }
export function formatEnergy(value: Rational): string { return `${formatDecimal(value, 0)} ккал`; }
export function formatMacronutrient(value: Rational): string { return `${formatDecimal(value, 1)} г`; }

/** Presentation of already calculated monetary rows; no purchasing/cost policy here. */
export function formatMoneySum(values: readonly Rational[]): {
  rows: string[]; total: string; explanation: string | null;
} {
  const exact = values.reduce((sum, value) => sum.add(value), ZERO);
  const displayedTicks = values.reduce((sum, value) => sum + roundHalfAwayFromZero(value, 2), 0n);
  return {
    rows: values.map(formatMoney), total: formatMoney(exact),
    explanation: displayedTicks === roundHalfAwayFromZero(exact, 2)
      ? null : 'Итог рассчитан до округления строк',
  };
}
