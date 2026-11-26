// Browser side of Projects media in Cloudflare R2: ask the route for links, then talk to R2 directly.

const UPLOAD_TRIES = 3

/** A failure worth another go: the connection dropped, or the service had a bad moment. */
class TransientError extends Error {}

async function call<T>(body: unknown, route = '/api/marketing-projects/media'): Promise<T> {
  let res: Response
  try {
    res = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new TransientError('The file service could not be reached. Check the connection and try again.')
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    const message = json.error ?? `The file service said ${res.status}.`
    throw res.status >= 500 || res.status === 429 ? new TransientError(message) : new Error(message)
  }
  return json
}

/** Signed download links, keyed by the R2 key. */
export async function signMedia(keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {}
  const out: Record<string, string> = {}
  // The route takes 200 at a time.
  for (let i = 0; i < keys.length; i += 200) {
    const { urls } = await call<{ urls: Record<string, string> }>({ action: 'sign', keys: keys.slice(i, i + 200) })
    Object.assign(out, urls)
  }
  return out
}

async function uploadOnce(key: string, body: Blob, contentType: string, onProgress?: (fraction: number) => void): Promise<void> {
  const { urls } = await call<{ urls: Record<string, string> }>({ action: 'upload', items: [{ key, contentType }] })
  const url = urls[key]
  if (!url) throw new Error('The file service gave no upload link.')
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new (xhr.status >= 500 ? TransientError : Error)(`The upload was refused (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new TransientError('The upload could not reach the file service. Check the connection and try again.'))
    xhr.send(body)
  })
}

/** Waits a little longer each time, and until the phone is back online. */
async function waitToRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, attempt * 3000))
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await new Promise((resolve) => window.addEventListener('online', resolve, { once: true }))
  }
}

/** Uploads straight to R2, reporting bytes sent so a big video shows real progress. A dropped connection gets two more tries. */
export async function uploadMedia(key: string, body: Blob, contentType: string, onProgress?: (fraction: number) => void): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await uploadOnce(key, body, contentType, onProgress)
    } catch (e) {
      if (!(e instanceof TransientError) || attempt >= UPLOAD_TRIES) throw e
      await waitToRetry(attempt)
    }
  }
}

export async function removeMedia(keys: string[]): Promise<{ failed: string[] }> {
  if (!keys.length) return { failed: [] }
  const { failed } = await call<{ removed: number; failed: string[] }>({ action: 'remove', keys })
  return { failed }
}
