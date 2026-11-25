import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Atlas',
    short_name: 'Atlas',
    description: 'Boards, marketing calendar and team work in one place.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [{ src: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  }
}
