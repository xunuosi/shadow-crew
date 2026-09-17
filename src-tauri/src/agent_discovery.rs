use serde::{Deserialize, Serialize};
use std::env;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AcpAvailabilityStatus {
    Available,
    NotAdapted,
    NotInstalled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRuntimeCatalogEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub transport: String,
    pub command: String,
    pub default_args: Vec<String>,
    pub underlying_cli: Option<String>,
    pub availability: AcpAvailabilityStatus,
    pub binary_path: Option<String>,
    pub install_hint: String,
    pub install_url: Option<String>,
    pub recommended_env: Vec<(String, String)>,
}

pub struct PresetHarness {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub transport: &'static str,
    pub command_candidates: &'static [&'static str],
    pub default_args: &'static [&'static str],
    pub underlying_cli_candidates: &'static [&'static str],
    pub install_hint: &'static str,
    pub install_url: Option<&'static str>,
    pub recommended_env: &'static [(&'static str, &'static str)],
}

pub const PRESET_HARNESSES: &[PresetHarness] = &[
    PresetHarness {
        id: "shinobi_core",
        name: "Shinobi Native Agent (Rust)",
        description: "Local ultra-fast native agent runtime with private SQLite memory bank",
        transport: "stdio",
        command_candidates: &["cargo run --bin shinobi-agent -- --acp", "shinobi-agent"],
        default_args: &[],
        underlying_cli_candidates: &[],
        install_hint: "Shinobi native agent is bundled within this workspace and ready to run.",
        install_url: None,
        recommended_env: &[("SHINOBI_LOG", "debug"), ("MEMORY_STORE", "sqlite")],
    },
    PresetHarness {
        id: "claude_code",
        name: "Claude Code (Anthropic)",
        description: "Anthropic Claude Code agent running via official claude-acp adapter",
        transport: "stdio",
        command_candidates: &["claude-code-acp", "claude-agent-acp", "claude-acp"],
        default_args: &[],
        underlying_cli_candidates: &["claude", "claude-code", "claudecode"],
        install_hint: "Claude CLI detected, but claude-acp adapter is missing. Install with: npm install -g @agentclientprotocol/claude-agent-acp",
        install_url: Some("https://docs.anthropic.com/en/docs/agents-and-tools/claude-code"),
        recommended_env: &[("ANTHROPIC_API_KEY", ""), ("CLAUDE_AUTO_APPROVE", "false")],
    },
    PresetHarness {
        id: "codex",
        name: "OpenAI Codex",
        description: "OpenAI Codex autonomous coding agent via local codex-acp adapter",
        transport: "stdio",
        command_candidates: &["codex-acp", "./bin/codex-acp", "codex"],
        default_args: &[],
        underlying_cli_candidates: &["codex"],
        install_hint: "Codex CLI detected. Powered by local codex-acp stdio adapter.",
        install_url: Some("https://openai.com"),
        recommended_env: &[("OPENAI_API_KEY", "")],
    },
    PresetHarness {
        id: "openclaw",
        name: "OpenClaw Mantis",
        description: "Autonomous multi-agent gateway daemon via openclaw acp",
        transport: "stdio",
        command_candidates: &["openclaw"],
        default_args: &["acp"],
        underlying_cli_candidates: &[],
        install_hint: "OpenClaw not found. Install via: npm install -g openclaw and run openclaw gateway.",
        install_url: Some("https://docs.openclaw.ai"),
        recommended_env: &[("OPENCLAW_GATEWAY_URL", "ws://127.0.0.1:18789")],
    },
    PresetHarness {
        id: "cursor_agent",
        name: "Cursor Agent",
        description: "Cursor AI assistant in headless ACP stdio mode",
        transport: "stdio",
        command_candidates: &["cursor-agent"],
        default_args: &["acp"],
        underlying_cli_candidates: &["cursor"],
        install_hint: "Cursor agent CLI not found on PATH. Install Cursor and ensure cursor-agent CLI is in your PATH.",
        install_url: Some("https://cursor.com/downloads"),
        recommended_env: &[],
    },
    PresetHarness {
        id: "pi_agent",
        name: "Pi Coding Agent",
        description: "Autonomous minimalist coding agent wrapped via pi-acp",
        transport: "stdio",
        command_candidates: &["pi-acp"],
        default_args: &[],
        underlying_cli_candidates: &["pi"],
        install_hint: "Pi CLI not installed. Install with: npm install -g @earendil-works/pi-coding-agent && npm install -g pi-acp",
        install_url: Some("https://github.com/svkozak/pi-acp"),
        recommended_env: &[],
    },
    PresetHarness {
        id: "kimi_code",
        name: "Kimi Code",
        description: "Moonshot Kimi coding assistant with ACP stdio interface",
        transport: "stdio",
        command_candidates: &["kimi"],
        default_args: &["acp"],
        underlying_cli_candidates: &[],
        install_hint: "Kimi CLI not found. Visit Moonshot Kimi developer portal to install the CLI.",
        install_url: Some("https://kimi.ai"),
        recommended_env: &[("KIMI_API_KEY", "")],
    },
    PresetHarness {
        id: "omp",
        name: "Oh My Pi (OMP)",
        description: "Extensible terminal developer alter-ego via omp acp",
        transport: "stdio",
        command_candidates: &["omp"],
        default_args: &["acp"],
        underlying_cli_candidates: &[],
        install_hint: "Oh My Pi CLI not found. Install via: curl -fsSL https://omp.sh/install | sh",
        install_url: Some("https://omp.sh"),
        recommended_env: &[],
    },
];

/// 跨平台在系统 PATH 及常用开发者目录中解析可执行文件路径
pub fn resolve_command_path(command: &str) -> Option<PathBuf> {
    let raw_cmd = command.split_whitespace().next().unwrap_or(command);
    let p = Path::new(raw_cmd);
    if p.is_file() {
        return Some(p.to_path_buf());
    }

    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Some(path_var) = env::var_os("PATH") {
        dirs.extend(env::split_paths(&path_var));
    }

    // 在 macOS / Linux 上补充 GUI 运行环境下常漏掉的 bin 目录
    if let Some(home) = env::var_os("HOME") {
        let home_path = PathBuf::from(home);
        dirs.push(home_path.join(".local/bin"));
        dirs.push(home_path.join(".cargo/bin"));
        dirs.push(home_path.join(".orbstack/bin"));
        dirs.push(home_path.join(".codex/plugins/.plugin-appserver"));
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/Applications/ChatGPT.app/Contents/Resources"));
    dirs.push(PathBuf::from("./bin"));
    dirs.push(PathBuf::from("../bin"));

    for dir in dirs {
        let candidate = dir.join(raw_cmd);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let exe = dir.join(format!("{}.exe", raw_cmd));
            if exe.is_file() {
                return Some(exe);
            }
            let cmd = dir.join(format!("{}.cmd", raw_cmd));
            if cmd.is_file() {
                return Some(cmd);
            }
        }
    }

    None
}

/// 探测本地所有预设的 ACP Agent 状态
pub fn discover_presets() -> Vec<AcpRuntimeCatalogEntry> {
    PRESET_HARNESSES
        .iter()
        .map(|def| {
            // 特殊处理 Shinobi 本地核心：只要是在此代码仓库中，始终认为可用
            if def.id == "shinobi_core" {
                return AcpRuntimeCatalogEntry {
                    id: def.id.to_string(),
                    name: def.name.to_string(),
                    description: def.description.to_string(),
                    transport: def.transport.to_string(),
                    command: def.command_candidates[0].to_string(),
                    default_args: def.default_args.iter().map(|s| s.to_string()).collect(),
                    underlying_cli: None,
                    availability: AcpAvailabilityStatus::Available,
                    binary_path: Some("cargo (workspace shinobi-agent)".to_string()),
                    install_hint: def.install_hint.to_string(),
                    install_url: def.install_url.map(|s| s.to_string()),
                    recommended_env: def
                        .recommended_env
                        .iter()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect(),
                };
            }

            // 1. 尝试解析候选 ACP 命令
            let mut found_acp: Option<(String, PathBuf)> = None;
            for candidate in def.command_candidates {
                if let Some(path) = resolve_command_path(candidate) {
                    found_acp = Some((candidate.to_string(), path));
                    break;
                }
            }

            if let Some((cmd, path)) = found_acp {
                return AcpRuntimeCatalogEntry {
                    id: def.id.to_string(),
                    name: def.name.to_string(),
                    description: def.description.to_string(),
                    transport: def.transport.to_string(),
                    command: cmd,
                    default_args: def.default_args.iter().map(|s| s.to_string()).collect(),
                    underlying_cli: None,
                    availability: AcpAvailabilityStatus::Available,
                    binary_path: Some(path.display().to_string()),
                    install_hint: def.install_hint.to_string(),
                    install_url: def.install_url.map(|s| s.to_string()),
                    recommended_env: def
                        .recommended_env
                        .iter()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect(),
                };
            }

            // 2. 检查是否存在 underlying_cli (判定 NotAdapted)
            let mut found_cli: Option<(String, PathBuf)> = None;
            for candidate in def.underlying_cli_candidates {
                if let Some(path) = resolve_command_path(candidate) {
                    found_cli = Some((candidate.to_string(), path));
                    break;
                }
            }

            let (availability, command, binary_path, underlying_cli) = match found_cli {
                Some((cli, path)) => (
                    AcpAvailabilityStatus::NotAdapted,
                    def.command_candidates.first().unwrap_or(&"").to_string(),
                    Some(path.display().to_string()),
                    Some(cli),
                ),
                None => (
                    AcpAvailabilityStatus::NotInstalled,
                    def.command_candidates.first().unwrap_or(&"").to_string(),
                    None,
                    None,
                ),
            };

            AcpRuntimeCatalogEntry {
                id: def.id.to_string(),
                name: def.name.to_string(),
                description: def.description.to_string(),
                transport: def.transport.to_string(),
                command,
                default_args: def.default_args.iter().map(|s| s.to_string()).collect(),
                underlying_cli,
                availability,
                binary_path,
                install_hint: def.install_hint.to_string(),
                install_url: def.install_url.map(|s| s.to_string()),
                recommended_env: def
                    .recommended_env
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discover_codex() {
        let presets = discover_presets();
        let codex = presets.iter().find(|p| p.id == "codex");
        assert!(codex.is_some(), "Codex should be present in discovered presets");
        let codex = codex.unwrap();
        println!("Discovered Codex: name={}, avail={:?}, cmd={}, bin={:?}", codex.name, codex.availability, codex.command, codex.binary_path);
        assert_eq!(codex.availability, AcpAvailabilityStatus::Available);
    }
}
