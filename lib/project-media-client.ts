// Browser side of Projects media in Cloudflare R2: ask the route for links, then talk to R2 directly.

async function call<T>(body: unknown): Promise<T> {
  const res = await fetch('/api/marketing-projects/media', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `The file service said ${res.status}.`)
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

/** Uploads straight to R2, reporting bytes sent so a big video shows real progress. */
export async function uploadMedia(key: string, body: Blob, contentType: string, onProgress?: (fraction: number) => void): Promise<void> {
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
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The upload was refused (${xhr.status}).`)))
    xhr.onerror = () => reject(new Error('The upload could not reach the file service. Check the connection and try again.'))
    xhr.send(body)
  })
}

export async function removeMedia(keys: string[]): Promise<{ failed: string[] }> {
  if (!keys.length) return { failed: [] }
  const { failed } = await call<{ removed: number; failed: string[] }>({ action: 'remove', keys })
  return { failed }
}
