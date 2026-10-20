import { describe, expect, it } from 'vitest';
import { Rational as R } from './rational';
import { formatDecimal, formatEnergy, formatMacronutrient, formatMoney, formatMoneySum,
  formatQuantity, roundHalfAwayFromZero } from './presentation';

describe('R01: half away from zero, representation only', () => {
  it.each([
    [67n, 200n, 2, 34n, '0,34'], [-67n, 200n, 2, -34n, '−0,34'],
    [201n, 2n, 0, 101n, '101'], [5n, 4n, 1, 13n, '1,3'],
    [-1n, 250n, 2, 0n, '0,00'], [-1n, 200n, 2, -1n, '−0,01'],
    [-334999n, 1000000n, 2, -33n, '−0,33'], [-335001n, 1000000n, 2, -34n, '−0,34'],
  ])('rounds %s/%s at %s places', (n, d, places, ticks, text) => {
    const value = R.of(n, d);
    expect(roundHalfAwayFromZero(value, places)).toBe(ticks);
    expect(formatDecimal(value, places)).toBe(text);
    expect(value).toEqual({ n, d });
  });

  it('formats the S0-04 units and Russian grouping, including very large sums', () => {
    expect(formatMoney(R.of(67n, 200n))).toBe('0,34 ₽');
    expect(formatMoney(R.of(-67n, 200n))).toBe('−0,34 ₽');
    expect(formatEnergy(R.of(201n, 2n))).toBe('101 ккал');
    expect(formatMacronutrient(R.of(5n, 4n))).toBe('1,3 г');
    expect(formatMacronutrient(R.of(0n))).toBe('0,0 г');
    expect(formatQuantity(R.of(1000n), 'g')).toBe('1 000 г');
    expect(formatQuantity(R.of(1n, 2n), 'pcs')).toBe('0,5 шт');
    expect(formatQuantity(R.of(1n, 1000000n), 'kg')).toBe('0,000001 кг');
    expect(formatMoney(R.of(9007199254740993001n, 1000n))).toBe('9 007 199 254 740 993,00 ₽');
    expect(formatMoney(R.of(1n, 1000000n))).toBe('0,00 ₽');
    expect(formatEnergy(R.of(1n, 1000000n))).toBe('0 ккал');
  });

  it('F04: every positive quantity below the screen step uses <, even when nearest rounding would round up', () => {
    expect(formatQuantity(R.of(1n, 2000n), 'g')).toBe('< 0,001 г');
    expect(formatQuantity(R.of(1n, 2000000n), 'kg')).toBe('< 0,000001 кг');
    expect(formatQuantity(R.of(9n, 10000n), 'ml')).toBe('< 0,001 мл');
    expect(formatQuantity(R.of(1n, 2000000n), 'l')).toBe('< 0,000001 л');
    expect(formatQuantity(R.of(1n, 3000n), 'pcs')).toBe('< 0,001 шт');
    expect(formatQuantity(R.of(1n, 1000n), 'g')).toBe('0,001 г');
    expect(formatQuantity(R.of(0n), 'g')).toBe('0 г');
    const twoTinyRows = R.of(3n, 5000n).add(R.of(3n, 5000n));
    expect(twoTinyRows).toEqual({ n: 3n, d: 2500n });
    expect(formatQuantity(twoTinyRows, 'g')).toBe('0,001 г');
  });

  it('keeps a negative underlying value even when the screen has no negative zero', () => {
    const remainder = R.of(-1n, 250n);
    expect(formatMoney(remainder)).toBe('0,00 ₽');
    expect(remainder.compare(R.of(0n))).toBe(-1);
    expect(R.of(125001n, 250n).compare(R.of(500n))).toBe(1);
    expect(formatMoney(R.of(125001n, 250n))).toBe('500,00 ₽');
  });

  it('rejects invalid display precision instead of silently truncating it', () => {
    for (const places of [-1, 1.5, Infinity, NaN]) {
      expect(() => roundHalfAwayFromZero(R.of(1n), places)).toThrow('INVALID_DISPLAY_PRECISION');
    }
  });
});

describe('R02: totals use the exact original rows', () => {
  it('R02-2 and R02-X: 0.34 + 0.34 on screen has a 0.67 total, with an explanation', () => {
    const rows = [R.of(67n, 200n), R.of(67n, 200n)];
    const sum = rows[0]!.add(rows[1]!);
    expect(sum).toEqual({ n: 67n, d: 100n });
    expect(formatMoneySum(rows)).toEqual({ rows: ['0,34 ₽', '0,34 ₽'], total: '0,67 ₽',
      explanation: 'Итог рассчитан до округления строк' });
    const wrong = R.of(670001n, 1000000n);
    expect(wrong.sub(sum)).toEqual({ n: 1n, d: 1000000n });
    expect(wrong.equals(sum)).toBe(false);
    expect(formatMoney(wrong)).toBe('0,67 ₽');
    expect(formatMoney(R.of(500n).sub(sum))).toBe('499,33 ₽');
  });

  it('R02-3: sums to exactly 1.005, displays 1.01 and preserves 498.995 remainder', () => {
    const row = R.of(67n, 200n);
    const sum = row.add(row).add(row);
    expect(sum).toEqual({ n: 201n, d: 200n });
    expect(formatMoneySum([row, row, row])).toEqual({ rows: ['0,34 ₽', '0,34 ₽', '0,34 ₽'],
      total: '1,01 ₽', explanation: 'Итог рассчитан до округления строк' });
    const remainder = R.of(500n).sub(sum);
    expect(remainder).toEqual({ n: 99799n, d: 200n });
    expect(formatMoney(remainder)).toBe('499,00 ₽');
  });

  it('needs no discrepancy explanation when the rounded rows and rounded total agree', () => {
    expect(formatMoneySum([R.of(1n), R.of(2n)])).toEqual({ rows: ['1,00 ₽', '2,00 ₽'], total: '3,00 ₽', explanation: null });
  });
});
