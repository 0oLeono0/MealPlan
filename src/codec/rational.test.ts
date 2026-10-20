import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeRational, encodeRational } from './rational';
import { Rational } from '../domain/rational';

afterEach(() => vi.restoreAllMocks());

describe('RationalDTO numerical exchange boundary', () => {
  it.each([
    ['0', '1'], ['1', '3'], ['-67', '200'], ['9007199254740993000000000000000001', '7'],
  ])('round trips %s/%s through JSON without BigInt hooks', (n, d) => {
    const decoded = decodeRational(JSON.parse(JSON.stringify({ n, d })));
    expect(decoded.kind).toBe('valid');
    if (decoded.kind !== 'valid') throw new Error('Expected valid DTO');
    expect(decoded.value).toEqual({ n: BigInt(n), d: BigInt(d) });
    expect(encodeRational(decoded.value)).toEqual({ n, d });
  });

  it('encodes the normalized internal operation result', () => {
    expect(encodeRational(Rational.of(2n, -6n))).toEqual({ n: '-1', d: '3' });
    expect(encodeRational(Rational.of(0n, 10n))).toEqual({ n: '0', d: '1' });
  });

  it.each([
    null, undefined, [], {}, { kind: 'unknown', reasons: ['QUANTITY_NOT_SPECIFIED'] },
    '1/3', { n: '1' }, { n: 1, d: 3 }, { n: 1n, d: 3n },
    { n: '2', d: '6' }, { n: '-0', d: '1' }, { n: '0', d: '2' }, { n: '1', d: '-3' },
    { n: '1', d: '0' }, { n: '01', d: '3' }, { n: '1', d: '03' }, { n: '+1', d: '3' },
    { n: '1\n', d: '3' }, { n: '1', d: '3\n' }, { n: '1e3', d: '1' }, { n: '0.5', d: '1' },
    { n: '1', d: '3', value: 0 }, { n: '1', d: '3', [Symbol('extra')]: true },
  ])('rejects malformed or non-canonical DTO %#', input => {
    expect(decodeRational(input)).toEqual({ kind: 'invalid', reason: 'INVALID_RATIONAL_DTO' });
  });

  it('does not treat a resource failure as corrupt input', () => {
    vi.spyOn(globalThis, 'BigInt').mockImplementationOnce(() => { throw new RangeError('BigInt capacity'); });
    expect(decodeRational({ n: '1', d: '3' })).toEqual({ kind: 'technical_error', reason: 'RESOURCE_EXHAUSTED' });
  });
});
