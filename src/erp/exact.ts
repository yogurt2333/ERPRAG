// Lean ERP values are independent of the read-only price-audit context.
export interface Rational { numerator: string; denominator: string }
export function ratio(n: bigint, d = 1n): Rational {
  if (d <= 0n) throw new Error('Invalid denominator');
  let a = n < 0n ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  return { numerator: String(n / a), denominator: String(d / a) };
}
export const zero = (): Rational => ratio(0n);
export const negate = (a: Rational): Rational => ratio(-BigInt(a.numerator), BigInt(a.denominator));
export const subtract = (a: Rational, b: Rational): Rational => add(a, negate(b));
export const multiply = (a: Rational, b: Rational): Rational =>
  ratio(BigInt(a.numerator) * BigInt(b.numerator), BigInt(a.denominator) * BigInt(b.denominator));
export const compare = (a: Rational, b: Rational): number => {
  const n = BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
  return n < 0n ? -1 : n > 0n ? 1 : 0;
};
export function add(a: Rational, b: Rational): Rational {
  return ratio(BigInt(a.numerator) * BigInt(b.denominator) + BigInt(b.numerator) * BigInt(a.denominator),
    BigInt(a.denominator) * BigInt(b.denominator));
}
export function divide(a: Rational, b: Rational): Rational {
  return ratio(BigInt(a.numerator) * BigInt(b.denominator), BigInt(a.denominator) * BigInt(b.numerator));
}
export function decimal(value: string): Rational {
  const [whole, tail = ''] = value.split('.');
  return ratio(BigInt(whole! + tail), 10n ** BigInt(tail.length));
}
