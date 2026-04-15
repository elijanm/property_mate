import client from './client'
import type { PartsCatalogItem } from '@/types/framework'

export async function listPartsCatalog(params?: { search?: string; category?: string }): Promise<PartsCatalogItem[]> {
  try {
    const res = await client.get<PartsCatalogItem[]>('/parts-catalog', { params })
    return res.data
  } catch {
    return []
  }
}

export async function createPartsCatalogItem(data: {
  part_name: string
  part_number?: string
  category?: string
  unit?: string
  unit_cost?: number
  notes?: string
}): Promise<PartsCatalogItem> {
  const res = await client.post<PartsCatalogItem>('/parts-catalog', data)
  return res.data
}

export async function bulkImportParts(items: Array<{
  part_name: string
  part_number?: string
  category?: string
  unit?: string
  unit_cost?: number
  notes?: string
}>): Promise<PartsCatalogItem[]> {
  const res = await client.post<PartsCatalogItem[]>('/parts-catalog/bulk', { items })
  return res.data
}

export async function uploadPartsCatalogCsv(file: File): Promise<PartsCatalogItem[]> {
  const form = new FormData()
  form.append('file', file)
  const res = await client.post<PartsCatalogItem[]>('/parts-catalog/upload-csv', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function updatePartsCatalogItem(
  itemId: string,
  data: Partial<{ part_name: string; part_number: string; category: string; unit: string; unit_cost: number; notes: string }>
): Promise<PartsCatalogItem> {
  const res = await client.patch<PartsCatalogItem>(`/parts-catalog/${itemId}`, data)
  return res.data
}

export async function deletePartsCatalogItem(itemId: string): Promise<void> {
  await client.delete(`/parts-catalog/${itemId}`)
}
