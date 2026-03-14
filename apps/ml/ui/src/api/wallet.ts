import client from './client'
import type { Wallet, WalletTransaction, LocalQuota } from '@/types/wallet'

export const walletApi = {
  get: () =>
    client.get<Wallet>('/wallet').then(r => r.data),

  transactions: (page = 1) =>
    client
      .get<{ items: WalletTransaction[]; total: number }>('/wallet/transactions', {
        params: { page },
      })
      .then(r => r.data),

  initializeTopup: (amountKes: number, callbackUrl: string) =>
    client
      .post<{ authorization_url: string; reference: string }>('/wallet/topup/initialize', {
        amount: amountKes,
        callback_url: callbackUrl,
      })
      .then(r => r.data),

  verifyTopup: (reference: string) =>
    client.post<Wallet>('/wallet/topup/verify', { reference }).then(r => r.data),

  getLocalQuota: () =>
    client.get<LocalQuota>('/wallet/local-quota').then(r => r.data),

  purchaseLocalHours: (hours: number) =>
    client.post<Wallet>('/wallet/local-quota/purchase', { hours }).then(r => r.data),
}
