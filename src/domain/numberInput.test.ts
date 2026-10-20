import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDecimalText, parseUserNumber } from './numberInput';
import { validateQuantity } from './quantity';

afterEach(() => vi.restoreAllMocks());

describe('number parsing separate from quantity restrictions', () => {
  it.each([
    ['0,335', 67n, 200n], ['0.335', 67n, 200n], [' +000,5000 ', 1n, 2n],
    ['-0.000', 0n, 1n], ['-1,25', -5n, 4n], ['9007199254740993.001', 9007199254740993001n, 1000n],
  ])('parses user %s exactly while keeping the raw input', (raw, n, d) => {
    expect(parseUserNumber(raw)).toEqual({ kind: 'valid', raw, value: { n, d } });
  });

  it.each(['', ' ', '\t\n'])('keeps %j empty, rather than zero', raw => {
    expect(parseUserNumber(raw)).toEqual({ kind: 'empty', raw });
  });

  it.each(['NaN', 'Infinity', '-Infinity', '1e3', '1,2.3', '1,2,3', '1 000', '1/3', '.', '- ', 'нет', '.5', '5.'])('rejects invalid user input %j', raw => {
    expect(parseUserNumber(raw)).toEqual({ kind: 'invalid', raw, reason: 'INVALID_NUMBER' });
  });

  it.each(['-0', '+1', '01', '0.5000', '1.0', '0,335', ' 1', '1\n', '1e3', '', '0.0'])('rejects non-canonical DecimalText %j', raw => {
    expect(parseDecimalText(raw).kind).toBe('invalid');
  });

  it.each([['0', 0n, 1n], ['-0.005', -1n, 200n], ['12.01', 1201n, 100n], ['-12', -12n, 1n]])('accepts canonical %s', (raw, n, d) => {
    expect(parseDecimalText(raw)).toEqual({ kind: 'valid', raw, value: { n, d } });
  });

  it('keeps price, coefficient and nutrition precision without imposing a quantity step', () => {
    const raw = '0.000000000000000000000000000001';
    const result = parseDecimalText(raw);
    expect(result).toEqual({ kind: 'valid', raw, value: { n: 1n, d: 1000000000000000000000000000000n } });
    if (result.kind !== 'valid') throw new Error('Expected valid number');
    expect(validateQuantity(result.value, 'g', 'ingredient')).toEqual({ kind: 'invalid', reason: 'QUANTITY_STEP' });
  });

  it('has no artificial input digit limit or truncation', () => {
    const whole = '9'.repeat(4096);
    const fraction = `0.${'0'.repeat(2047)}1`;
    const big = parseDecimalText(whole);
    const small = parseDecimalText(fraction);
    if (big.kind !== 'valid' || small.kind !== 'valid') throw new Error('Expected valid numbers');
    expect(big.value.n.toString()).toBe(whole);
    expect(big.value.d).toBe(1n);
    expect(small.value.n).toBe(1n);
    expect(small.value.d.toString()).toBe(`1${'0'.repeat(2048)}`);
  });

  it('reports an engine resource refusal separately, preserving raw text', () => {
    vi.spyOn(globalThis, 'BigInt').mockImplementationOnce(() => { throw new RangeError('BigInt capacity'); });
    expect(parseUserNumber(' 0,335 ')).toEqual({ kind: 'technical_error', raw: ' 0,335 ', reason: 'RESOURCE_EXHAUSTED' });
  });

  it('classifies resource exhaustion during syntax checking as technical too', () => {
    vi.spyOn(RegExp.prototype, 'exec').mockImplementationOnce(() => { throw new RangeError('RegExp capacity'); });
    const result = parseDecimalText('0.335');
    expect(result).toEqual({ kind: 'technical_error', raw: '0.335', reason: 'RESOURCE_EXHAUSTED' });
  });
});
