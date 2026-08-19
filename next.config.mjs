/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },

  // Security headers. CSP is production-only: Turbopack's dev-mode HMR relies on
  // patterns (eval-based fast refresh) that a strict policy would block, and dev
  // never needs hardening against a remote attacker the way the deployed app does.
  async headers() {
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // `microphone=(self)`, NOT `microphone=()`. The dictation button
      // (components/ui/voice-input-button.tsx) drives the Web Speech API, and Chrome gates
      // SpeechRecognition.start() on exactly this policy feature - so `microphone=()` made the
      // mic button fail on every page, which is what got reported as "the mic doesn't work".
      // Measured in a real browser against this dev server: with `()`,
      // document.featurePolicy.allowsFeature('microphone') is FALSE; with `(self)` it is TRUE.
      // `(self)` still locks out every other origin, including anything framed in. Camera and
      // geolocation stay fully disabled - nothing in this app asks for either.
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
    ]

    if (process.env.NODE_ENV === 'production') {
      securityHeaders.push({
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          // blob: and the Supabase origin are both required by Storage-backed images:
          // the marketing calendar previews an asset by downloading it and rendering
          // URL.createObjectURL(...) (a blob: URL), and task attachments render large
          // image thumbnails straight from a signed Storage URL. Neither is covered by
          // 'self' - verified in a real browser against this exact policy, where both
          // were BLOCKED while data: (the inline base64 path) loaded, which is why the
          // marketing preview had been silently broken in production only.
          // Allowing the origin grants no access on its own: the buckets are private and
          // every object still requires a signed, short-lived URL.
          "img-src 'self' data: blob: https://*.supabase.co https://www.google.com https://*.gstatic.com",
          "font-src 'self' data:",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
          "frame-ancestors 'none'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      })
    }

    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
