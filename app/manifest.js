export default function manifest() {
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
  const appRoot = `${basePath || ''}/`;
  const iconSrc = `${basePath}/Icon-60@3x.png`;

  return {
    name: '基估宝',
    short_name: '基估宝',
    description: '基金管理管家',
    start_url: appRoot,
    scope: appRoot,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    id: appRoot,
    icons: [
      {
        src: iconSrc,
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: iconSrc,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: iconSrc,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
    categories: ['finance', 'utilities'],
    prefer_related_applications: false,
  };
}
