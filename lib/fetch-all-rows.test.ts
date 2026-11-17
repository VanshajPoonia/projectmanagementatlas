import { describe, it, expect, vi } from 'vitest'
import { fetchAllRows } from './fetch-all-rows'

function pagesOver(rows: number[]) {
  return vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }))
}

describe('fetchAllRows', () => {
  it('keeps reading past the first page', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i)
    const fetchPage = pagesOver(rows)
    const result = await fetchAllRows(fetchPage)
    expect(result.data).toEqual(rows)
    expect(fetchPage.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('asks once more when the last page is exactly full', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => i)
    const fetchPage = pagesOver(rows)
    const result = await fetchAllRows(fetchPage, 2)
    expect(result.data).toEqual(rows)
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('stops on an error and returns no partial rows', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ data: [1, 2], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    const result = await fetchAllRows(fetchPage, 2)
    expect(result).toEqual({ data: null, error: { message: 'permission denied' } })
  })
})
