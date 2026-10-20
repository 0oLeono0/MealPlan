import { Rational } from './rational';

export type NumberParseResult =
  | { kind: 'valid'; raw: string; value: Rational }
  | { kind: 'empty'; raw: string }
  | { kind: 'invalid'; raw: string; reason: 'INVALID_NUMBER' | 'NON_CANONICAL_DECIMAL' }
  | { kind: 'technical_error'; raw: string; reason: 'RESOURCE_EXHAUSTED' };

// Full match matters: JavaScript's $ by itself also matches before a final newline.
export function matchesEntire(pattern: RegExp, text: string): boolean {
  return pattern.exec(text)?.[0] === text;
}

function decimalToRational(text: string): Rational {
  const negative = text.startsWith('-');
  const unsigned = text.replace(/^[+-]/u, '');
  const [whole = '', fraction = ''] = unsigned.split('.');
  const numerator = BigInt(whole + fraction);
  return Rational.of(negative ? -numerator : numerator, 10n ** BigInt(fraction.length));
}

function parseNumber(raw: string, source: 'user' | 'catalog'): NumberParseResult {
  try {
    if (source === 'catalog') {
      if (!matchesEntire(/^(?:0|-?[1-9][0-9]*|-?(?:0|[1-9][0-9]*)\.[0-9]*[1-9])$/u, raw)) {
        return { kind: 'invalid', raw, reason: 'NON_CANONICAL_DECIMAL' };
      }
      return { kind: 'valid', raw, value: decimalToRational(raw) };
    }
    const text = raw.trim();
    if (text === '') return { kind: 'empty', raw };
    if (!matchesEntire(/^[+-]?[0-9]+(?:[.,][0-9]+)?$/u, text)) {
      return { kind: 'invalid', raw, reason: 'INVALID_NUMBER' };
    }
    return { kind: 'valid', raw, value: decimalToRational(text.replace(',', '.')) };
  } catch (error) {
    // Engine regexp/string/BigInt capacity is a technical failure, not invalid syntax.
    if (error instanceof RangeError) return { kind: 'technical_error', raw, reason: 'RESOURCE_EXHAUSTED' };
    throw error;
  }
}

/** Raw text stays verbatim; whitespace around a user entry and a leading + are accepted. */
export function parseUserNumber(raw: string): NumberParseResult {
  return parseNumber(raw, 'user');
}

/** Catalog boundary: canonical DecimalText, not the permissive user syntax. */
export function parseDecimalText(raw: string): NumberParseResult {
  return parseNumber(raw, 'catalog');
}
