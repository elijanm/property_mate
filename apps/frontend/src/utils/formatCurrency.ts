export function formatCurrency(amount: number, currency = 'KES'): string {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(amount)
}
