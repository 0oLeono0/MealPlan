import { Rational, gcd } from '../domain/rational';
import { matchesEntire } from '../domain/numberInput';

export type RationalDTO = Readonly<{ n: string; d: string }>;
export type RationalDecodeResult =
  | { kind: 'valid'; value: Rational }
  | { kind: 'invalid'; reason: 'INVALID_RATIONAL_DTO' }
  | { kind: 'technical_error'; reason: 'RESOURCE_EXHAUSTED' };

export function encodeRational(value: Rational): RationalDTO {
  return { n: value.n.toString(), d: value.d.toString() };
}

/** Never repair an external fraction: non-reduced and non-canonical DTOs are invalid. */
export function decodeRational(input: unknown): RationalDecodeResult {
  const invalid = { kind: 'invalid', reason: 'INVALID_RATIONAL_DTO' } as const;
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes('n') || !keys.includes('d')
      || !('n' in input) || !('d' in input) || typeof input.n !== 'string' || typeof input.d !== 'string'
      || !matchesEntire(/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/u, input.n)
      || !matchesEntire(/^[1-9][0-9]*$/u, input.d)) return invalid;
    const n = BigInt(input.n);
    const d = BigInt(input.d);
    if (gcd(n, d) !== 1n) return invalid;
    return { kind: 'valid', value: Rational.of(n, d) };
  } catch (error) {
    if (error instanceof RangeError) return { kind: 'technical_error', reason: 'RESOURCE_EXHAUSTED' };
    throw error;
  }
}
