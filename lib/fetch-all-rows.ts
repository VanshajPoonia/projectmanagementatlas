// PostgREST cuts every response at db-max-rows (1000 on Supabase) without an error.
// Any read that can outgrow that has to page, or the newest rows quietly vanish.
export const MAX_ROWS_PER_REQUEST = 1000

type PageError = { message: string; code?: string }
type Page<T> = { data: T[] | null; error: PageError | null }

// `fetchPage` must build a fresh query with a stable order, or pages can skip or repeat rows.
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = MAX_ROWS_PER_REQUEST,
): Promise<Page<T>> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) return { data: rows, error: null }
  }
}
