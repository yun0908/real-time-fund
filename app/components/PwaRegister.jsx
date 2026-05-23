'use client';

import { useEffect } from 'react';

/**
 * 在客户端注册 Service Worker，满足 Android Chrome PWA 安装条件（需 HTTPS + manifest + SW）。
 * 仅在生产环境且浏览器支持时注册。
 */
export default function PwaRegister() {
  useEffect(() => {
    const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
    const swUrl = `${basePath}/sw.js`;
    const swScope = `${basePath || ''}/`;

    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      process.env.NODE_ENV !== 'production'
    ) {
      return;
    }
    navigator.serviceWorker
      .register(swUrl, { scope: swScope, updateViaCache: 'none' })
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // 可选：提示用户刷新以获取新版本
            }
          });
        });
      })
      .catch(() => {});
  }, []);

  return null;
}
