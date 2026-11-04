import { expect, it } from 'vitest';
import { cartTotal, convertedCents, formatCents, formatShopping, parseCents, type Item } from './shopping';
const item = (price: string, quantity = '1'): Item => ({ id: price, name: '', price, quantity });
it('totals quantities and updates after edits and removal', () => {
  expect(cartTotal([item('1280', '2'), item('500')])).toBe(3060n);
  expect(cartTotal([item('1280', '3')])).toBe(3840n);
  expect(cartTotal([])).toBe(0n);
});
it('does not present partial totals as final while an item is invalid', () => {
  for (const bad of [item(''), item('12.50'), item('500', '0'), item('500', '')]) expect(cartTotal([item('100'), bad])).toBeUndefined();
});
it('deducts the converted total from a budget with exact cents', () => {
  const cost = convertedCents(3060n, '0.40')!;
  expect(cost).toBe(122400n);
  expect(formatCents(parseCents('1500')! - cost, '₱')).toBe('₱276.00');
  expect(formatCents(parseCents('1000')! - cost, '₱')).toBe('−₱224.00');
  expect(convertedCents(1280n, '0.0063055360')).toBe(807n);
  expect(convertedCents(1280n, '0')).toBeUndefined();
  expect(parseCents('-1')).toBeUndefined();
});

it('exports item details, exact total and over-budget balance', () => {
  const text = formatShopping({ items: [{ ...item('1280', '2'), name: 'Lunch\nset' }], budgets: { PHP: '1000', USD: '' } }, 'PHP', '0.40');
  expect(text).toContain('1. Lunch set');
  expect(text).toContain('2 × ¥1,280 = ¥2,560 (₱1,024.00)');
  expect(text).toContain('TOTAL: ¥2,560 / ₱1,024.00');
  expect(text).toContain('OVER BUDGET: ₱24.00');
  expect(formatShopping({ items: [item('')], budgets: { PHP: '', USD: '' } }, 'PHP', '0.40')).toBeUndefined();
});
