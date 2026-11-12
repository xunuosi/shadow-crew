import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

// LINT.IfChange(aistudio_media_plugin)
function aistudioMediaPlugin(): Plugin {
  return {
    name: 'vite-plugin-aistudio-media',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/assets/aistudio/')) {
          const rawPath = req.url.split('?')[0].split('#')[0];
          try {
            const decodedPath = decodeURIComponent(rawPath);
            const relativePath = decodedPath.replace(/^\//, '');
            const aistudioDir = path.resolve(
              __dirname,
              'public',
              'assets',
              'aistudio',
            );
            const filePath = path.resolve(__dirname, 'public', relativePath);
            if (
              filePath.startsWith(aistudioDir + path.sep) &&
              fs.existsSync(filePath) &&
              fs.statSync(filePath).isFile()
            ) {
              const ext = path.extname(filePath).toLowerCase();
              const mimeMap: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.bmp': 'image/bmp',
                '.ico': 'image/x-icon',
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
                '.ogv': 'video/ogg',
                '.mp3': 'audio/mpeg',
                '.wav': 'audio/wav',
                '.ogg': 'audio/ogg',
                '.pdf': 'application/pdf',
              };
              res.setHeader(
                'Content-Type',
                mimeMap[ext] || 'application/octet-stream',
              );
              res.setHeader('Cache-Control', 'no-cache');
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          } catch {
            // Fall through if URI decoding or file access fails
          }
        }
        next();
      });
    },
  };
}
// LINT.ThenChange(//depot/google3/java/com/google/alkali/boq/makersuite/applet_dev_service/templates/initializers/react_theme/vite.config.ts:aistudio_media_plugin)

// Middleware to dynamically probe host machine's PATH for ACP Agents in Vite dev server
function localAcpDiscoveryPlugin(): Plugin {
  return {
    name: 'vite-plugin-local-acp-discovery',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/api/discover-runtimes')) {
          const pathEnv = process.env.PATH || process.env.Path || '';
          const homedir = os.homedir();
          const platformDirs =
            process.platform === 'win32'
              ? [
                  path.join(homedir, '.local', 'bin'),
                  path.join(homedir, '.cargo', 'bin'),
                  path.join(
                    process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming'),
                    'npm'
                  ),
                  path.join(
                    process.env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local'),
                    'Programs'
                  ),
                ]
              : [
                  path.join(homedir, '.local', 'bin'),
                  path.join(homedir, '.cargo', 'bin'),
                  ...(process.platform === 'darwin'
                    ? ['/opt/homebrew/bin', '/usr/local/bin']
                    : ['/usr/local/bin']),
                ];
          const searchDirs = Array.from(
            new Set([...pathEnv.split(path.delimiter), ...platformDirs].filter(Boolean))
          );
          // Windows 上的 CLI 多为 .cmd / .exe，必须按 PATHEXT 枚举候选扩展名，
          // 否则 fs.existsSync 对无扩展名路径永远为 false。
          const executableExtensions =
            process.platform === 'win32'
              ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
                  .split(';')
                  .filter(Boolean)
              : [''];

          function isExecutableFile(candidate: string): boolean {
            try {
              return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
            } catch {
              return false;
            }
          }

          function resolve(cmds: string[]) {
            for (const cmd of cmds) {
              for (const dir of searchDirs) {
                const base = path.join(dir, cmd);
                const candidates = path.extname(base)
                  ? [base]
                  : executableExtensions.flatMap((ext) => [
                      `${base}${ext}`,
                      `${base}${ext.toLowerCase()}`,
                    ]);
                for (const full of candidates) {
                  if (isExecutableFile(full)) {
                    return { cmd, full };
                  }
                }
              }
            }
            return null;
          }

          const presets = [
            {
              id: 'claude_code',
              name: 'Claude Code (Anthropic)',
              description: 'Anthropic Claude Code agent running via official claude-acp adapter',
              transport: 'stdio',
              candidate_cmds: ['claude-code-acp', 'claude-agent-acp', 'claude-acp'],
              underlying_clis: ['claude', 'claude-code', 'claudecode'],
              default_args: [],
              install_hint: 'Claude CLI detected, but claude-acp adapter is missing. Install with: npm install -g @agentclientprotocol/claude-agent-acp',
              install_url: 'https://docs.anthropic.com/en/docs/agents-and-tools/claude-code',
              recommended_env: [
                ['ANTHROPIC_API_KEY', ''],
                ['CLAUDE_AUTO_APPROVE', 'false'],
              ],
            },
            {
              id: 'codex',
              name: 'OpenAI Codex',
              description: 'OpenAI Codex autonomous coding agent via local codex-acp adapter',
              transport: 'stdio',
              candidate_cmds: ['codex-acp', './bin/codex-acp', 'codex'],
              underlying_clis: ['codex'],
              default_args: [],
              install_hint: 'Codex CLI detected. Powered by local codex-acp stdio adapter.',
              install_url: 'https://openai.com',
              recommended_env: [['OPENAI_API_KEY', '']],
            },
            {
              id: 'openclaw',
              name: 'OpenClaw Mantis',
              description: 'Autonomous multi-agent gateway daemon via openclaw acp',
              transport: 'stdio',
              candidate_cmds: ['openclaw'],
              underlying_clis: [],
              default_args: ['acp'],
              install_hint: 'OpenClaw not found. Install via: npm install -g openclaw and run openclaw gateway.',
              install_url: 'https://www.openclaw.ai',
              recommended_env: [['OPENCLAW_GATEWAY_URL', 'ws://127.0.0.1:18789']],
            },
            {
              id: 'cursor_agent',
              name: 'Cursor Agent',
              description: 'Cursor AI assistant in headless ACP stdio mode',
              transport: 'stdio',
              candidate_cmds: ['cursor-agent'],
              underlying_clis: ['cursor'],
              default_args: ['acp'],
              install_hint: 'Cursor agent CLI not found on PATH. Install Cursor and ensure cursor-agent CLI is in your PATH.',
              install_url: 'https://cursor.com/downloads',
              recommended_env: [],
            },
            {
              id: 'pi_agent',
              name: 'Pi Coding Agent',
              description: 'Autonomous minimalist coding agent wrapped via pi-acp',
              transport: 'stdio',
              candidate_cmds: ['pi-acp'],
              underlying_clis: ['pi'],
              default_args: [],
              install_hint: 'Pi CLI detected, but pi-acp adapter is missing. Install with: npm install -g pi-acp',
              install_url: 'https://github.com/svkozak/pi-acp',
              recommended_env: [],
            },
            {
              id: 'kimi_code',
              name: 'Kimi Code',
              description: 'Moonshot Kimi coding assistant with ACP stdio interface',
              transport: 'stdio',
              candidate_cmds: ['kimi'],
              underlying_clis: [],
              default_args: ['acp'],
              install_hint: 'Kimi CLI not found. Visit Moonshot Kimi developer portal to install the CLI.',
              install_url: 'https://kimi.ai',
              recommended_env: [['KIMI_API_KEY', '']],
            },
            {
              id: 'omp',
              name: 'Oh My Pi (OMP)',
              description: 'Extensible terminal developer alter-ego via omp acp',
              transport: 'stdio',
              candidate_cmds: ['omp'],
              underlying_clis: [],
              default_args: ['acp'],
              install_hint: 'Oh My Pi CLI not found. Install via: curl -fsSL https://omp.sh/install | sh',
              install_url: 'https://omp.sh',
              recommended_env: [],
            },
          ];

          const results = presets.map((p) => {
            const foundAcp = resolve(p.candidate_cmds || []);
            if (foundAcp) {
              return {
                ...p,
                command: foundAcp.cmd,
                binary_path: foundAcp.full,
                availability: 'available',
              };
            }
            const foundCli = resolve(p.underlying_clis || []);
            if (foundCli) {
              return {
                ...p,
                command: (p.candidate_cmds && p.candidate_cmds[0]) || '',
                binary_path: foundCli.full,
                underlying_cli: foundCli.cmd,
                availability: 'not_adapted',
              };
            }
            return {
              ...p,
              command: (p.candidate_cmds && p.candidate_cmds[0]) || '',
              binary_path: null,
              availability: 'not_installed',
            };
          });

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(results));
          return;
        }
        next();
      });
    },
  };
}

// Middleware to proxy LLM requests in Vite dev server to bypass browser CORS & network restrictions
function llmProxyPlugin(): Plugin {
  return {
    name: 'vite-plugin-llm-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/api/llm-proxy') && req.method === 'POST') {
          let reqBodyStr = '';
          req.on('data', (chunk) => {
            reqBodyStr += chunk;
          });
          req.on('end', async () => {
            try {
              const { url, headers, body, method = 'POST', timeoutMs = 20000 } = JSON.parse(reqBodyStr || '{}');
              const reqMethod = String(method || 'POST').toUpperCase();
              const isPost = reqMethod === 'POST';

              if (!url) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, status: 400, error: 'Missing target url' }));
                return;
              }

              // 仅允许 http/https，禁止 file://、data: 等协议被当作代理目标。
              try {
                const targetUrl = new URL(String(url));
                if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(
                    JSON.stringify({
                      ok: false,
                      status: 400,
                      error: `Unsupported proxy target protocol: ${targetUrl.protocol}`,
                    })
                  );
                  return;
                }
              } catch {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, status: 400, error: 'Invalid target url' }));
                return;
              }

              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), timeoutMs);

              // Allow intranet corporate certificates in dev mode
              const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
              process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

              try {
                const fetchOptions: RequestInit = {
                  method: reqMethod,
                  headers: headers || {},
                  signal: controller.signal,
                };
                if (isPost && body !== undefined && body !== null) {
                  fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
                }

                const response = await fetch(url, fetchOptions);
                clearTimeout(timer);
                // 必须无条件恢复：原实现只在 prevTls 有值时恢复，
                // 首次请求前该变量为空会导致后续所有请求永久跳过 TLS 校验。
                if (prevTls === undefined) {
                  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
                } else {
                  process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
                }

                const rawText = await response.text();
                let parsedJson = null;
                try {
                  parsedJson = JSON.parse(rawText);
                } catch {}

                const hasValidPayload = Boolean(
                  parsedJson && (parsedJson.choices || parsedJson.id || parsedJson.content || parsedJson.data || parsedJson.models)
                );

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(
                  JSON.stringify({
                    ok: response.ok || hasValidPayload,
                    status: response.status,
                    body: parsedJson,
                    raw_text: rawText,
                  })
                );
              } catch (fetchErr: any) {
                clearTimeout(timer);
                // 必须无条件恢复：原实现只在 prevTls 有值时恢复，
                // 首次请求前该变量为空会导致后续所有请求永久跳过 TLS 校验。
                if (prevTls === undefined) {
                  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
                } else {
                  process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
                }

                // Node fetch 失败时 (如未走系统代理出现 ECONNRESET)，平滑回退至 curl 调用（自动穿透系统代理与企业网关）
                try {
                  const { execFile } = await import('child_process');
                  const { promisify } = await import('util');
                  const execFileAsync = promisify(execFile);

                  const proxyUrl = process.env.https_proxy || process.env.http_proxy || process.env.ALL_PROXY || '';
                  const curlArgs = [
                    // 仅在显式开启时才跳过证书校验；默认保持 TLS 校验。
                    ...(process.env.SHADOW_CREW_DEV_INSECURE_TLS === '1' ? ['-k'] : []),
                    '-s',
                    '-S',
                    '-X',
                    reqMethod,
                    '--max-time',
                    String(Math.ceil(timeoutMs / 1000)),
                  ];

                  if (proxyUrl) {
                    curlArgs.push('-x', proxyUrl);
                  }

                  if (headers) {
                    for (const [k, v] of Object.entries(headers)) {
                      curlArgs.push('-H', `${k}: ${v}`);
                    }
                  }

                  if (isPost && body !== undefined && body !== null) {
                    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
                    curlArgs.push('-d', bodyStr);
                  }
                  curlArgs.push(url);

                  const { stdout } = await execFileAsync('curl', curlArgs);
                  let parsedJson = null;
                  try {
                    parsedJson = JSON.parse(stdout);
                  } catch {}

                  const hasValid = Boolean(
                    parsedJson && (parsedJson.choices || parsedJson.id || parsedJson.content || parsedJson.data || parsedJson.models)
                  );

                  res.setHeader('Content-Type', 'application/json');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  res.end(
                    JSON.stringify({
                      ok: hasValid || Boolean(stdout && !stdout.includes('"error":')),
                      status: 200,
                      body: parsedJson,
                      raw_text: stdout,
                    })
                  );
                  return;
                } catch (curlErr: any) {
                  const curlStdout = curlErr?.stdout || '';
                  let parsedJson = null;
                  try {
                    parsedJson = JSON.parse(curlStdout);
                  } catch {}
                  const hasValid = Boolean(
                    parsedJson && (parsedJson.choices || parsedJson.id || parsedJson.content)
                  );
                  if (hasValid) {
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.end(
                      JSON.stringify({
                        ok: true,
                        status: 200,
                        body: parsedJson,
                        raw_text: curlStdout,
                      })
                    );
                    return;
                  }

                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  res.end(
                    JSON.stringify({
                      ok: false,
                      status: 500,
                      body: null,
                      raw_text: curlStdout || fetchErr?.message || 'Proxy fetch failed',
                      error: fetchErr?.message || curlErr?.message || 'Proxy fetch failed',
                    })
                  );
                }
              }
            } catch (parseErr: any) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, status: 400, error: parseErr.message }));
            }
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), aistudioMediaPlugin(), localAcpDiscoveryPlugin(), llmProxyPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (
                id.includes('/react/') ||
                id.includes('/react-dom/') ||
                id.includes('/scheduler/')
              ) {
                return 'vendor-react';
              }
              if (
                id.includes('/react-markdown/') ||
                id.includes('/remark-gfm/') ||
                id.includes('/prismjs/') ||
                id.includes('/unified/') ||
                id.includes('/micromark/') ||
                id.includes('/mdast-') ||
                id.includes('/unist-')
              ) {
                return 'vendor-markdown';
              }
              if (id.includes('/lucide-react/') || id.includes('/motion/')) {
                return 'vendor-ui';
              }
            }
          },
        },
      },
    },
    server: {
      port: 3033,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Rust/Tauri 构建产物 (target/) 与打包产物 (dist/) 不属于前端源码，
      // 递归监视它们会让 dev server 持续处理事件批次并长期占用多个 CPU 核。
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : { ignored: ['**/target/**', '**/dist/**', '**/.git/**', '**/*.log'] },
    },
  };
});
