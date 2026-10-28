import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

const DEFAULT_API = 'https://uwv0zhujxf.execute-api.ap-northeast-2.amazonaws.com'

export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_DEV_PROXY_TARGET || DEFAULT_API
  const proxy: Record<string, ProxyOptions> = Object.fromEntries(
    ['/auth', '/me', '/groups', '/invitations', '/health', '/workspace-auth', '/workspaces']
      .map(path => [path, { target, changeOrigin: true }]),
  )
  proxy['/backend'] = { target, changeOrigin: true, rewrite: path => path.replace(/^\/backend/, '') }
  let websocketTarget: string | undefined = env.VITE_DEV_WS_TARGET
  if (command === 'serve' && mode !== 'carebridge' && !websocketTarget) {
    try {
      const result = await fetch(target + '/health', { signal: AbortSignal.timeout(4000) })
      const health = await result.json() as { carebridge?: { websocketUrl?: string } }
      websocketTarget = health.carebridge?.websocketUrl
    } catch { /* REST remains available; event connection will explain deployment failures. */ }
  }
  if (websocketTarget) {
    proxy['/backend-events'] = {
      target: websocketTarget, ws: true, changeOrigin: true,
      rewrite: path => path.replace(/^\/backend-events/, ''),
      configure: server => {
        server.on('proxyReqWs', request => {
          request.setHeader('Origin', env.VITE_DEV_FRONTEND_ORIGIN || 'https://develop.db2l4u9y804jp.amplifyapp.com')
        })
      },
    }
  }
  return {
    plugins: [react()],
    define: { __CAREBRIDGE_WS_PROXY__: JSON.stringify(Boolean(websocketTarget)) },
    server: { proxy },
  }
})
