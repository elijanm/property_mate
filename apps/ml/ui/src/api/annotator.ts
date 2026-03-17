import client from './annotatorClient'
import type {
  AnnotatorProfile,
  AnnotatorStats,
  AnnotatorTask,
  RewardSummary,
  RewardRedemption,
  PlatformRewardRate,
} from '@/types/annotator'

export const annotatorApi = {
  getProfile: () =>
    client.get<AnnotatorProfile>('/annotator/profile').then((r) => r.data),

  updateProfile: (data: Partial<AnnotatorProfile>) =>
    client.patch<AnnotatorProfile>('/annotator/profile', data).then((r) => r.data),

  getStats: () =>
    client.get<AnnotatorStats>('/annotator/stats').then((r) => r.data),

  getTasks: () =>
    client
      .get<{ items: AnnotatorTask[] }>('/annotator/tasks')
      .then((r) => r.data),

  getMyTasks: () =>
    client
      .get<{ items: AnnotatorTask[] }>('/annotator/tasks/mine')
      .then((r) => r.data),

  joinTask: (datasetId: string) =>
    client
      .post<{ token: string; collector_id: string }>(
        `/annotator/tasks/${datasetId}/join`
      )
      .then((r) => r.data),

  getRewards: () =>
    client.get<RewardSummary>('/annotator/rewards').then((r) => r.data),

  redeemRewards: (points: number, phone_number: string) =>
    client
      .post<RewardRedemption>('/annotator/rewards/redeem', { points, phone_number })
      .then((r) => r.data),

  getRedemptions: () =>
    client
      .get<{ items: RewardRedemption[] }>('/annotator/redemptions')
      .then((r) => r.data),

  register: (email: string, password: string, full_name: string, referral_code?: string) =>
    client
      .post('/annotator/register', { email, password, full_name, referral_code })
      .then((r) => r.data),

  getRewardRate: () =>
    client.get<PlatformRewardRate>('/annotator/reward-rate').then(r => r.data),

  submitKyc: (formData: FormData) =>
    client.post('/annotator/kyc/submit', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
}
