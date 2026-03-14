export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at < 0) return '••••••'
  const local = email.slice(0, at)
  const domain = email.slice(at)
  const visible = local.length <= 2 ? 1 : 2
  return local.slice(0, visible) + '•'.repeat(Math.min(local.length - visible, 5)) + domain
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return '••••'
  const prefix = phone.slice(0, 4)
  const suffix = phone.slice(-2)
  return prefix + '••••' + suffix
}

export function maskId(id: string): string {
  if (!id || id.length <= 3) return '•••••'
  return '•'.repeat(Math.max(id.length - 3, 4)) + id.slice(-3)
}
