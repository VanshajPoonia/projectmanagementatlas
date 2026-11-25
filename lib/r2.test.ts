import { describe, expect, it } from 'vitest'
import { presignUrl, r2Config } from './r2'

describe('presignUrl', () => {
  // The worked example from AWS's own Signature V4 query-string documentation.
  it('matches the published AWS example signature', () => {
    const url = presignUrl({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(url).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
    expect(url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?')).toBe(true)
  })

  it('encodes odd characters in the key', () => {
    const url = presignUrl({
      method: 'PUT', host: 'h.example', path: '/b/a b/c(1).mp4', region: 'auto', service: 's3',
      accessKeyId: 'k', secretAccessKey: 's', expiresSeconds: 60, now: new Date('2026-11-26T00:00:00Z'),
    })
    expect(url).toContain('/b/a%20b/c%281%29.mp4?')
  })
})

describe('r2Config', () => {
  it('needs all four settings', () => {
    expect(r2Config({ R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'c' })).toBeNull()
    expect(r2Config({ R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'c', R2_SECRET_ACCESS_KEY: 'd' })).toEqual({
      accountId: 'a', bucket: 'b', accessKeyId: 'c', secretAccessKey: 'd',
    })
  })
})
