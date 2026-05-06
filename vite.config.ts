import { defineConfig, loadEnv, type PluginOption, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { Server as OscServer } from 'node-osc'
import { AccessToken } from 'livekit-server-sdk'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const poseOutputDir = path.resolve(__dirname, 'src/poses')

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars to get LIVEKIT secrets
  const env = loadEnv(mode, process.cwd(), '')
  const isDev = mode === 'development'
  const enableVmcBridge = env.VITE_ENABLE_VMC_BRIDGE === 'true'
  const enablePoseExport = env.VITE_ENABLE_POSE_EXPORT === 'true'
  const plugins: PluginOption[] = [
    react(),
    nodePolyfills(),
    {
      name: 'livekit-token-endpoint',
      configureServer(server: ViteDevServer) {
        server.middlewares.use('/.netlify/functions/livekit-token', async (req: IncomingMessage, res: ServerResponse) => {
           if (req.method !== 'POST') {
             res.writeHead(405, { 'Content-Type': 'application/json' });
             res.end(JSON.stringify({ error: 'Method Not Allowed' }));
             return;
           }

           let body = '';
           req.on('data', chunk => body += chunk);
           req.on('end', async () => {
             try {
                const { roomName, participantName } = JSON.parse(body || '{}');
                const apiKey = env.LIVEKIT_API_KEY;
                const apiSecret = env.LIVEKIT_API_SECRET;
                
                if (!apiKey || !apiSecret) {
                  console.error('Missing LiveKit credentials in environment variables');
                   res.writeHead(500, { 'Content-Type': 'application/json' });
                   res.end(JSON.stringify({ error: 'Missing LiveKit credentials' }));
                   return;
                }

                const at = new AccessToken(apiKey, apiSecret, {
                  identity: participantName,
                  name: participantName,
                });

                at.addGrant({
                  roomJoin: true,
                  room: roomName,
                  canPublish: true,
                  canSubscribe: true,
                  canPublishData: true,
                });

                const token = await at.toJwt();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token, url: env.LIVEKIT_URL }));
             } catch (err) {
                console.error('Error generating token:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
             }
           });
        });

        // Mock Discord Token Exchange
        server.middlewares.use('/api/discord-token', async (req: IncomingMessage, res: ServerResponse) => {
           if (req.method !== 'POST') {
             res.writeHead(405, { 'Content-Type': 'application/json' });
             res.end(JSON.stringify({ error: 'Method Not Allowed' }));
             return;
           }

           let body = '';
           req.on('data', chunk => body += chunk);
           req.on('end', async () => {
             try {
                const { code } = JSON.parse(body || '{}');
                const clientId = env.VITE_DISCORD_CLIENT_ID;
                const clientSecret = env.DISCORD_CLIENT_SECRET;
                
                if (!clientId || !clientSecret) {
                  console.error('Missing Discord credentials in environment variables');
                   res.writeHead(500, { 'Content-Type': 'application/json' });
                   res.end(JSON.stringify({ error: 'Missing Discord credentials' }));
                   return;
                }

                const data = new URLSearchParams({
                  client_id: clientId,
                  client_secret: clientSecret,
                  grant_type: 'authorization_code',
                  code: code,
                });

                const response = await fetch('https://discord.com/api/oauth2/token', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: data,
                });

                if (!response.ok) {
                  res.writeHead(response.status, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Failed to exchange token with Discord' }));
                  return;
                }

                const { access_token } = (await response.json()) as { access_token: string };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ access_token }));
             } catch (err) {
                console.error('Error in discord token exchange:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
             }
           });
        });

        // Local Auth Redirect for Discord
        server.middlewares.use('/api/auth/discord', (_req: IncomingMessage, res: ServerResponse) => {
          const clientId = env.VITE_DISCORD_CLIENT_ID || env.DISCORD_CLIENT_ID;
          // Use the actual dev port (usually 5173)
          const port = server.config.server.port || 5173;
          const redirectUri = encodeURIComponent(`http://localhost:${port}/api/auth/callback`);
          const scope = encodeURIComponent('identify email guilds guilds.members.read');
          const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
          
          res.writeHead(302, { Location: url });
          res.end();
        });

        // Local Callback Mock for Development
        server.middlewares.use('/api/auth/callback', (_req: IncomingMessage, res: ServerResponse) => {
          // In a real scenario, we'd exchange the code here.
          // For local Vite dev, we'll just redirect back with a "mock" success state
          // or you can implement the full exchange if you have the client secret.
          
          const mockUser = {
            id: 'mock_user_id',
            discordId: 'mock_user_id',
            username: 'DevMode_User',
            avatarUrl: null,
            lp: 1000
          };
          
          const sessionBase64 = Buffer.from(JSON.stringify(mockUser)).toString('base64');
          
          res.writeHead(302, { 
            Location: '/?login=success',
            'Set-Cookie': `poselab_user=${sessionBase64}; Path=/; SameSite=Lax; Max-Age=2592000`
          });
          res.end();
        });

        // Mock LP Ledger API
        server.middlewares.use('/.netlify/functions/bot-lp', (req: IncomingMessage, res: ServerResponse) => {
           let body = '';
           req.on('data', chunk => body += chunk);
           req.on('end', () => {
             const { action } = JSON.parse(body || '{}');
             res.writeHead(200, { 'Content-Type': 'application/json' });
             if (action === 'read') {
               res.end(JSON.stringify({ lp: 1250 }));
             } else {
               res.end(JSON.stringify({ success: true, lp: 1250 }));
             }
           });
        });

        // Mock Feed API
        server.middlewares.use('/.netlify/functions/fetch-feed', (_req: IncomingMessage, res: ServerResponse) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ feed: [] }));
        });

        // Mock Upvote API
        server.middlewares.use('/.netlify/functions/upvote-pose', (_req: IncomingMessage, res: ServerResponse) => {
           res.writeHead(200, { 'Content-Type': 'application/json' });
           res.end(JSON.stringify({ success: true }));
        });
      }
    },
    enableVmcBridge && {
      name: 'vmc-bridge',
      configureServer(server: ViteDevServer) {
        if (!isDev) {
          console.warn('[vmc-bridge] Skipping setup outside development mode.')
          return
        }
        try {
          console.log('[vmc-bridge] Starting WebSocket server on port 39540...')
          const wss = new WebSocketServer({ port: 39540, host: '127.0.0.1' })
          
          wss.on('error', (e: any) => {
            if (e.code === 'EADDRINUSE') {
              console.log('[vmc-bridge] Port 39540 in use, VMC bridge (WebSocket) will be disabled for this instance.');
            } else {
              console.error('[vmc-bridge] WebSocket error:', e);
            }
          });

          console.log('[vmc-bridge] Starting UDP listener on port 39539...')
          const oscServer = new OscServer(39539, '127.0.0.1', () => {
             console.log('[vmc-bridge] UDP listener active on 39539')
          })

          oscServer.on('error', (e: any) => {
            if (e.code === 'EADDRINUSE') {
              console.log('[vmc-bridge] Port 39539 in use, VMC bridge (UDP) will be disabled for this instance.');
              try { oscServer.close(); } catch { /* ignore */ }
            } else {
              console.error('[vmc-bridge] OSC error:', e);
            }
          });

          const handleOscMessage = (msg: any) => {
              // msg is [address, arg1, arg2...]
              const address = msg[0];
              const args = msg.slice(1);
              const json = JSON.stringify({ address, args });
              wss.clients.forEach((client) => {
                  if (client.readyState === 1) { 
                      client.send(json);
                  }
              });
          };

          oscServer.on('message', (msg) => {
              handleOscMessage(msg);
          });

          oscServer.on('bundle', (bundle) => {
              bundle.elements.forEach((element: any) => {
                  if (Array.isArray(element)) {
                      handleOscMessage(element);
                  } else if (element.elements) {
                      element.elements.forEach((subElement: any) => {
                          if (Array.isArray(subElement)) handleOscMessage(subElement);
                      });
                  }
              });
          });

          // Cleanup when Vite server closes
          server.httpServer?.on('close', () => {
              console.log('[vmc-bridge] Closing servers...')
              wss.close()
              oscServer.close()
          })
        } catch (err) {
          console.error('[vmc-bridge] Failed to start:', err)
        }
      }
    },
    enablePoseExport && {
      name: 'pose-export-endpoint',
      configureServer(server: ViteDevServer) {
        if (!isDev) {
          console.warn('[pose-export] Skipping setup outside development mode.')
          return
        }
        console.log('[pose-export] Endpoint active at /__pose-export');
        server.middlewares.use('/__pose-export', (req: IncomingMessage, res: ServerResponse) => {
          console.log(`[pose-export] Received ${req.method} request`);
          const remoteAddress = req.socket?.remoteAddress
          if (remoteAddress && remoteAddress !== '127.0.0.1' && remoteAddress !== '::1') {
            res.writeHead(403)
            res.end('Forbidden')
            return
          }

          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end('Method not allowed')
            return
          }

          let raw = ''
          const maxBodyBytes = 1024 * 1024
          req.on('data', (chunk: Buffer) => {
            raw += chunk
            if (raw.length > maxBodyBytes) {
              res.writeHead(413)
              res.end('Payload too large')
              req.destroy()
            }
          })
          req.on('end', () => {
            try {
              const payload = JSON.parse(raw || '{}')
              const { poseId, data } = payload
              if (!poseId || !data) {
                res.writeHead(400)
                res.end('Missing poseId or data')
                return
              }
              const safeId = String(poseId).replace(/[^a-zA-Z0-9-_]/g, '')
              const filePath = path.join(poseOutputDir, `${safeId}.json`)
              fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, filePath }))
            } catch (err) {
              console.error('[pose-export] failed', err)
              res.writeHead(500)
              res.end('Failed to save pose')
            }
          })
        })
      },
    },
  ].filter(Boolean)

  if (!enableVmcBridge) {
    console.log('[vmc-bridge] Disabled. Set VITE_ENABLE_VMC_BRIDGE=true to enable.')
  }
  if (!enablePoseExport) {
    console.log('[pose-export] Disabled. Set VITE_ENABLE_POSE_EXPORT=true to enable.')
  }

  return {
    // Security headers removed to fix black screen issue (blocks external resources)
    // server: {
    //   headers: {
    //     'Cross-Origin-Opener-Policy': 'same-origin',
    //     'Cross-Origin-Embedder-Policy': 'require-corp',
    //   },
    // },
    preview: {
      // headers removed
    },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  worker: {
    format: 'iife'
  },
  plugins,
  }
})
