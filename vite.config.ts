import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
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
          const pathEnv = process.env.PATH || '';
          const homedir = process.env.HOME || '';
          const searchDirs = [
            ...pathEnv.split(path.delimiter),
            path.join(homedir, '.local', 'bin'),
            path.join(homedir, '.cargo', 'bin'),
            '/opt/homebrew/bin',
            '/usr/local/bin',
          ].filter(Boolean);

          function resolve(cmds: string[]) {
            for (const cmd of cmds) {
              for (const dir of searchDirs) {
                const full = path.join(dir, cmd);
                try {
                  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
                    return { cmd, full };
                  }
                } catch {
                  // ignore
                }
              }
            }
            return null;
          }

          const presets = [
            {
              id: 'shinobi_core',
              name: 'Shinobi Native Agent (Rust)',
              description: 'Local ultra-fast native agent runtime with private SQLite memory bank',
              transport: 'stdio',
              command: 'cargo run --bin shinobi-agent -- --acp',
              default_args: [],
              availability: 'available',
              binary_path: 'cargo (workspace shinobi-agent)',
              install_hint: 'Shinobi native agent is bundled within this workspace and ready to run.',
              install_url: null,
              recommended_env: [
                ['SHINOBI_LOG', 'debug'],
                ['MEMORY_STORE', 'sqlite'],
              ],
            },
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
            if (p.id === 'shinobi_core') {
              return p;
            }
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

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), aistudioMediaPlugin(), localAcpDiscoveryPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
