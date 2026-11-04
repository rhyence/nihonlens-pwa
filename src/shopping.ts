import { convert } from './vision';

export type Item = { id: string; name: string; price: string; quantity: string };
export type Shopping = { items: Item[]; budgets: { PHP: string; USD: string } };
export const shoppingKey = 'nihonlens-shopping-v1';
export function emptyShopping(): Shopping { return { items: [], budgets: { PHP: '', USD: '' } }; }
export function loadShopping(): Shopping {
  try {
    const value = JSON.parse(localStorage.getItem(shoppingKey) ?? 'null');
    if (!value || !Array.isArray(value.items)) return emptyShopping();
    const ids = new Set<string>();
    const items = value.items.filter((item: Item) => {
      if (!item || typeof item.id !== 'string' || ids.has(item.id) || typeof item.name !== 'string' ||
          typeof item.price !== 'string' || item.price.length > 12 ||
          typeof item.quantity !== 'string' || item.quantity.length > 4) return false;
      ids.add(item.id);
      return true;
    }).slice(0, 200).map((item: Item) => ({ ...item, name: item.name.slice(0, 80) }));
    const budget = (code: 'PHP' | 'USD') => typeof value.budgets?.[code] === 'string' && value.budgets[code].length <= 15 ? value.budgets[code] : '';
    return { items, budgets: { PHP: budget('PHP'), USD: budget('USD') } };
  } catch { return emptyShopping(); }
}
export function itemTotal(item: Item): bigint | undefined {
  if (!/^\d{1,12}$/.test(item.price) || !/^\d{1,4}$/.test(item.quantity) || BigInt(item.quantity) < 1n) return;
  return BigInt(item.price) * BigInt(item.quantity);
}
export function cartTotal(items: Item[]): bigint | undefined {
  let total = 0n;
  for (const item of items) {
    const amount = itemTotal(item);
    if (amount === undefined) return;
    total += amount;
  }
  return total;
}
export function parseCents(amount: string): bigint | undefined {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) return;
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole + fraction.padEnd(2, '0'));
}
export function convertedCents(amount: bigint, rate: string): bigint | undefined {
  if (!(Number(rate) > 0)) return;
  const formatted = convert(amount, rate, '');
  return formatted ? BigInt(formatted.replace(/[ ,\.]/g, '')) : undefined;
}
export function formatCents(cents: bigint, symbol: string) {
  const absolute = cents < 0n ? -cents : cents;
  return (cents < 0n ? '−' : '') + symbol + (absolute / 100n).toLocaleString('en-US') + '.' + String(absolute % 100n).padStart(2, '0');
}

export function formatShopping(shopping: Shopping, currency: 'PHP' | 'USD', rate: string): string | undefined {
  const yenTotal = cartTotal(shopping.items);
  const cents = yenTotal === undefined ? undefined : convertedCents(yenTotal, rate);
  const budgetText = shopping.budgets[currency];
  const budget = parseCents(budgetText);
  if (yenTotal === undefined || cents === undefined || (budgetText && budget === undefined)) return;
  const symbol = currency === 'PHP' ? '₱' : 'US$';
  const lines = ['NIHONLENS — SHOPPING LIST', `Currency: ${currency} | Rate: ¥1 = ${symbol}${rate}`, ''];
  shopping.items.forEach((item, index) => {
    const total = itemTotal(item)!;
    lines.push(`${index + 1}. ${item.name.replace(/\s+/g, ' ').trim() || 'Unnamed item'}`,
      `   ${item.quantity} × ¥${BigInt(item.price).toLocaleString('en-US')} = ¥${total.toLocaleString('en-US')} (${formatCents(convertedCents(total, rate)!, symbol)})`);
  });
  if (!shopping.items.length) lines.push('No items yet.');
  lines.push('', `TOTAL: ¥${yenTotal.toLocaleString('en-US')} / ${formatCents(cents, symbol)}`);
  if (budget !== undefined) {
    const remaining = budget - cents;
    lines.push(`BUDGET: ${formatCents(budget, symbol)}`, `${remaining < 0n ? 'OVER BUDGET' : 'REMAINING'}: ${formatCents(remaining < 0n ? -remaining : remaining, symbol)}`);
  }
  lines.push('', 'Estimate at your saved exchange rate. Total rounded after conversion.');
  return lines.join('\n');
}
