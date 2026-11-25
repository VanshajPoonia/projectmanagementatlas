// Cloudflare R2 over its S3 API, signed by hand with AWS Signature V4 so no SDK is needed.
// Server only: it reads the R2 secret. Browsers get short-lived presigned URLs and never the key.

import { createHash, createHmac } from 'node:crypto'

export interface R2Config {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/** Null when the four settings are not all present, so a route can say "not set up" cleanly. */
export function r2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env
  if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null
  return { accountId: R2_ACCOUNT_ID, bucket: R2_BUCKET, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
}

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding, which is what Signature V4 wants (encodeURIComponent leaves `!*'()`). */
const encode = (s: string) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const encodePath = (path: string) => path.split('/').map(encode).join('/')

const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '')

export interface PresignInput {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD'
  host: string
  /** Starts with a slash, not yet encoded. */
  path: string
  region: string
  service: string
  accessKeyId: string
  secretAccessKey: string
  expiresSeconds: number
  now?: Date
}

/** A presigned URL that carries its own signature in the query string and signs only the host. */
export function presignUrl(input: PresignInput): string {
  const amzDate = stamp(input.now ?? new Date())
  const day = amzDate.slice(0, 8)
  const scope = `${day}/${input.region}/${input.service}/aws4_request`
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k])}`)
    .join('&')
  const canonicalPath = encodePath(input.path)
  const canonicalRequest = [input.method, canonicalPath, canonicalQuery, `host:${input.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const kDate = hmac(`AWS4${input.secretAccessKey}`, day)
  const kSigning = hmac(hmac(hmac(kDate, input.region), input.service), 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex')
  return `https://${input.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

function objectUrl(config: R2Config, method: PresignInput['method'], key: string, expiresSeconds: number): string {
  return presignUrl({
    method,
    host: `${config.accountId}.r2.cloudflarestorage.com`,
    path: `/${config.bucket}/${key}`,
    region: 'auto',
    service: 's3',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresSeconds,
  })
}

export const presignGet = (config: R2Config, key: string, expiresSeconds = 3600) => objectUrl(config, 'GET', key, expiresSeconds)
export const presignPut = (config: R2Config, key: string, expiresSeconds = 900) => objectUrl(config, 'PUT', key, expiresSeconds)

/** Deletes one object. A missing object is not an error, which is what S3 and R2 both say. */
export async function deleteObject(config: R2Config, key: string): Promise<void> {
  const res = await fetch(objectUrl(config, 'DELETE', key, 60), { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`R2 refused to delete ${key} (${res.status})`)
}
