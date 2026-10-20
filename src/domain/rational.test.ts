import { describe, expect, it } from 'vitest';
import { Rational as R } from './rational';

describe('Rational invariants and arithmetic', () => {
  it.each([
    [2n, 6n, 1n, 3n], [-2n, -6n, 1n, 3n], [2n, -6n, -1n, 3n], [0n, -123n, 0n, 1n],
  ])('normalizes %s/%s', (n, d, expectedN, expectedD) => {
    expect(R.of(n, d)).toEqual({ n: expectedN, d: expectedD });
    expect(Object.isFrozen(R.of(n, d))).toBe(true);
  });

  it('does not lose integers beyond binary floating point precision', () => {
    const a = R.of(9007199254740993n);
    expect(a.add(R.of(2n))).toEqual({ n: 9007199254740995n, d: 1n });
    expect(a.mul(a)).toEqual({ n: 81129638414606699710187514626049n, d: 1n });
    expect(a.compare(R.of(9007199254740992n))).toBe(1);
  });

  it('adds, subtracts, multiplies and divides reduced pairs without rounding', () => {
    const a = R.of(7n, 12n);
    const b = R.of(5n, 18n);
    expect(a.add(b)).toEqual({ n: 31n, d: 36n });
    expect(a.sub(b)).toEqual({ n: 11n, d: 36n });
    expect(a.mul(b)).toEqual({ n: 35n, d: 216n });
    expect(a.div(b)).toEqual({ n: 21n, d: 10n });
    expect(a.neg().abs()).toEqual({ n: 7n, d: 12n });
    expect(a.compare(b)).toBe(1);
    expect(b.compare(a)).toBe(-1);
    expect(a.compare(R.of(14n, 24n))).toBe(0);
    expect(a.equals(R.of(14n, 24n))).toBe(true);
    expect(a.equals(b)).toBe(false);
    expect(a.sub(a)).toEqual({ n: 0n, d: 1n });
  });

  it('retains a third through exact division and cancellation', () => {
    const third = R.of(1n).div(R.of(3n));
    expect(third).toEqual({ n: 1n, d: 3n });
    expect(third.mul(R.of(3n))).toEqual({ n: 1n, d: 1n });
    expect(R.of(0n).mul(third)).toEqual({ n: 0n, d: 1n });
  });

  it.each([
    [7n, 3n, 2n, 2n, 3n], [-7n, 3n, -2n, -3n, -2n],
    [6n, 3n, 2n, 2n, 2n], [-6n, 3n, -2n, -2n, -2n], [0n, 1n, 0n, 0n, 0n],
  ])('integer operations on %s/%s', (n, d, trunc, floor, ceil) => {
    const r = R.of(n, d);
    expect(r.trunc()).toBe(trunc);
    expect(r.floor()).toBe(floor);
    expect(r.ceil()).toBe(ceil);
  });

  it('checks exact steps, integer values and finite decimal denominators', () => {
    expect(R.of(1n, 2n).isMultipleOf(R.of(1n, 1000n))).toBe(true);
    expect(R.of(1n, 2000n).isMultipleOf(R.of(1n, 1000n))).toBe(false);
    expect(R.of(3n, 2n).isInteger()).toBe(false);
    expect(R.of(6n, 2n).isInteger()).toBe(true);
    expect(R.of(3n, 40n).isFiniteDecimal()).toBe(true);
    expect(R.of(1n, 3n).isFiniteDecimal()).toBe(false);
  });

  it('rejects zero divisors and invalid steps', () => {
    expect(() => R.of(1n, 0n)).toThrow('DIVISION_BY_ZERO');
    expect(() => R.of(1n).div(R.of(0n))).toThrow('DIVISION_BY_ZERO');
    expect(() => R.of(1n).isMultipleOf(R.of(0n))).toThrow('STEP_MUST_BE_POSITIVE');
    expect(() => R.of(1n).isMultipleOf(R.of(-1n))).toThrow('STEP_MUST_BE_POSITIVE');
  });
});
