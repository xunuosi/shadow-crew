import { LocalAcpRuntime } from '../types';

export const FALLBACK_PRESET_RUNTIMES: LocalAcpRuntime[] = [
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
    command: 'claude-code-acp',
    default_args: [],
    underlying_cli: 'claude',
    availability: 'available',
    binary_path: '/opt/homebrew/bin/claude-code-acp',
    install_hint:
      'Claude CLI detected, but claude-acp adapter is missing. Install with: npm install -g @agentclientprotocol/claude-agent-acp',
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
    command: 'codex-acp',
    default_args: [],
    underlying_cli: 'codex',
    availability: 'available',
    binary_path: '~/.local/bin/codex-acp',
    install_hint:
      'Codex CLI detected. Powered by local codex-acp stdio adapter.',
    install_url: 'https://openai.com',
    recommended_env: [['OPENAI_API_KEY', '']],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw Mantis',
    description: 'Autonomous multi-agent gateway daemon via openclaw acp',
    transport: 'stdio',
    command: 'openclaw',
    default_args: ['acp'],
    availability: 'available',
    binary_path: '/opt/homebrew/bin/openclaw',
    install_hint:
      'OpenClaw not found. Install via: npm install -g openclaw and run openclaw gateway.',
    install_url: 'https://docs.openclaw.ai',
    recommended_env: [['OPENCLAW_GATEWAY_URL', 'ws://127.0.0.1:18789']],
  },
  {
    id: 'cursor_agent',
    name: 'Cursor Agent',
    description: 'Cursor AI assistant in headless ACP stdio mode',
    transport: 'stdio',
    command: 'cursor-agent',
    default_args: ['acp'],
    availability: 'not_installed',
    binary_path: null,
    install_hint:
      'Cursor agent CLI not found on PATH. Install Cursor and ensure cursor-agent CLI is in your PATH.',
    install_url: 'https://cursor.com/downloads',
    recommended_env: [],
  },
  {
    id: 'pi_agent',
    name: 'Pi Coding Agent',
    description: 'Autonomous minimalist coding agent wrapped via pi-acp',
    transport: 'stdio',
    command: 'pi-acp',
    default_args: [],
    underlying_cli: 'pi',
    availability: 'not_installed',
    binary_path: null,
    install_hint:
      'Pi CLI not installed. Install with `npm install -g @earendil-works/pi-coding-agent`, then `npm install -g pi-acp`.',
    install_url: 'https://github.com/svkozak/pi-acp',
    recommended_env: [],
  },
  {
    id: 'kimi_code',
    name: 'Kimi Code',
    description: 'Moonshot Kimi coding assistant with ACP stdio interface',
    transport: 'stdio',
    command: 'kimi',
    default_args: ['acp'],
    availability: 'not_installed',
    binary_path: null,
    install_hint:
      'Kimi CLI not found. Visit Moonshot Kimi developer portal to install the CLI.',
    install_url: 'https://kimi.ai',
    recommended_env: [['KIMI_API_KEY', '']],
  },
  {
    id: 'omp',
    name: 'Oh My Pi (OMP)',
    description: 'Extensible terminal developer alter-ego via omp acp',
    transport: 'stdio',
    command: 'omp',
    default_args: ['acp'],
    availability: 'not_installed',
    binary_path: null,
    install_hint:
      'Oh My Pi CLI not found. Install via: curl -fsSL https://omp.sh/install | sh',
    install_url: 'https://omp.sh',
    recommended_env: [],
  },
];

export async function discoverLocalAcpRuntimes(): Promise<LocalAcpRuntime[]> {
  // 1. If running inside Tauri WebView app, invoke Rust command
  try {
    if (
      typeof window !== 'undefined' &&
      (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<LocalAcpRuntime[]> } })
        .__TAURI_INTERNALS__?.invoke
    ) {
      const results = await (
        window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<LocalAcpRuntime[]> } }
      ).__TAURI_INTERNALS__.invoke('discover_local_acp_runtimes');
      if (Array.isArray(results) && results.length > 0) {
        return results;
      }
    }
  } catch (error) {
    console.warn('Tauri IPC discover_local_acp_runtimes call failed:', error);
  }

  // 2. If running in browser dev mode, probe via Vite dev server middleware
  try {
    const res = await fetch('/api/discover-runtimes');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data as LocalAcpRuntime[];
      }
    }
  } catch {
    // Network or server fetch failed, proceed to fallback
  }

  // 3. Fallback to default catalog
  return FALLBACK_PRESET_RUNTIMES;
}
