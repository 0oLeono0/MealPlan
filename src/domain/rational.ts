/** Exact, immutable and reduced n/d. Decimal display is deliberately separate. */
export class Rational {
  private constructor(public readonly n: bigint, public readonly d: bigint) {
    Object.freeze(this);
  }

  static of(n: bigint, d: bigint = 1n): Rational {
    if (d === 0n) throw new Error('DIVISION_BY_ZERO');
    if (n === 0n) return new Rational(0n, 1n);
    if (d < 0n) { n = -n; d = -d; }
    const divisor = gcd(n, d);
    return new Rational(n / divisor, d / divisor);
  }

  add(other: Rational): Rational {
    const divisor = gcd(this.d, other.d);
    return Rational.of(this.n * (other.d / divisor) + other.n * (this.d / divisor),
      this.d * (other.d / divisor));
  }

  sub(other: Rational): Rational { return this.add(other.neg()); }

  mul(other: Rational): Rational {
    const a = gcd(this.n, other.d);
    const b = gcd(other.n, this.d);
    return Rational.of((this.n / a) * (other.n / b), (this.d / b) * (other.d / a));
  }

  div(other: Rational): Rational {
    if (other.n === 0n) throw new Error('DIVISION_BY_ZERO');
    return this.mul(Rational.of(other.d, other.n));
  }

  neg(): Rational { return Rational.of(-this.n, this.d); }
  abs(): Rational { return this.n < 0n ? this.neg() : this; }
  compare(other: Rational): -1 | 0 | 1 {
    const left = this.n * other.d;
    const right = other.n * this.d;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  equals(other: Rational): boolean { return this.n === other.n && this.d === other.d; }
  isInteger(): boolean { return this.d === 1n; }
  trunc(): bigint { return this.n / this.d; }
  floor(): bigint { return this.trunc() - (this.n < 0n && this.n % this.d !== 0n ? 1n : 0n); }
  ceil(): bigint { return this.trunc() + (this.n > 0n && this.n % this.d !== 0n ? 1n : 0n); }
  isMultipleOf(step: Rational): boolean {
    if (step.n <= 0n) throw new Error('STEP_MUST_BE_POSITIVE');
    return this.div(step).isInteger();
  }
  isFiniteDecimal(): boolean {
    let denominator = this.d;
    for (const factor of [2n, 5n]) while (denominator % factor === 0n) denominator /= factor;
    return denominator === 1n;
  }
}

export function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export const ZERO = Rational.of(0n);
export const ONE = Rational.of(1n);
