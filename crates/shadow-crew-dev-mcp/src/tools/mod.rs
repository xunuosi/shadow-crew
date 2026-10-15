pub mod fs;
pub mod shell;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

/// 返回当前内置原生 MCP 工具集元数据 (符合 MCP JSON Schema 规范)
pub fn get_tools_list() -> Value {
    json!([
        {
            "name": "shell",
            "description": "在宿主操作员环境下执行命令行命令 (如 cargo check, git status, npm run lint, 测试等)。支持指定工作目录与执行超时保护。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "要执行的 Shell 命令文本"
                    },
                    "workdir": {
                        "type": "string",
                        "description": "可选的工作目录绝对路径或相对路径，默认为当前工作区根目录"
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "description": "命令最大执行毫秒数 (默认 120,000ms，最大 600,000ms)"
                    }
                },
                "required": ["command"]
            }
        },
        {
            "name": "read_file",
            "description": "读取本地工作区文件内容，支持按行号范围切片查看代码。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "目标文件路径"
                    },
                    "offset": {
                        "type": "integer",
                        "description": "起始行号 (1-indexed，可选)"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "最大读取行数 (可选)"
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "write_file",
            "description": "写入或完全覆盖目标文件。若上级目录不存在将自动创建。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "目标文件路径"
                    },
                    "content": {
                        "type": "string",
                        "description": "待写入的文件完整内容"
                    }
                },
                "required": ["path", "content"]
            }
        },
        {
            "name": "str_replace",
            "description": "对目标文件进行精准的代码子串替换。如果 old_str 在文件中不唯一或不存在，将拒绝替换并报错。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "目标文件路径"
                    },
                    "old_str": {
                        "type": "string",
                        "description": "需要被替换的原始内容精确文本"
                    },
                    "new_str": {
                        "type": "string",
                        "description": "替换后的新内容文本"
                    }
                },
                "required": ["path", "old_str", "new_str"]
            }
        },
        {
            "name": "list_dir",
            "description": "浏览指定目录下的文件与子文件夹树状结构，自动过滤 target、node_modules 等噪音目录。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "目标目录路径，默认为当前工作区根目录 \".\""
                    },
                    "max_depth": {
                        "type": "integer",
                        "description": "最大遍历递归深度 (默认为 2)"
                    }
                }
            }
        },
        {
            "name": "search_code",
            "description": "在指定目录下递归全文搜索代码关键字或模式 (类似 ripgrep)，返回匹配文件、行号与内容摘要。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "需要搜索的关键词或文本"
                    },
                    "path": {
                        "type": "string",
                        "description": "搜索起始目录路径，默认为当前目录 \".\""
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "最大返回匹配条数 (默认 50)"
                    }
                },
                "required": ["pattern"]
            }
        },
        {
            "name": "write_channel_artifact",
            "description": "将正式技术产物 (如 ADR 架构决策文档、推演方案白皮书、关键补丁 diff) 永久归档至当前频道专属产物目录 (~/.shadow-crew/channels/<channel_id>/artifacts/)。可被系统访达一键查看。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "产物文件名 (如 adr_001_storage.md, refactor_plan.md, changes.diff)"
                    },
                    "content": {
                        "type": "string",
                        "description": "产物完整文本内容"
                    },
                    "channel_id": {
                        "type": "string",
                        "description": "可选的目标频道 ID (若省略则默认写入当前所属频道)"
                    }
                },
                "required": ["filename", "content"]
            }
        },
        {
            "name": "write_agent_artifact",
            "description": "将正式技术产物 (如 ADR 架构决策文档、推演方案白皮书、关键补丁 diff) 永久归档至指定 Agent 的个人专属产物目录 (~/.shadow-crew/agents/<agent_id>/artifacts/)。可被系统访达一键查看。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "产物文件名 (如 adr_001_storage.md, refactor_plan.md, changes.diff)"
                    },
                    "content": {
                        "type": "string",
                        "description": "产物完整文本内容"
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "可选的目标 Agent ID (若省略则默认写入当前所属 Agent)"
                    }
                },
                "required": ["filename", "content"]
            }
        },
        {
            "name": "submit_arbitration_ruling",
            "description": "提交本议题的架构仲裁定案裁决书与权衡决策 (Architecture Decision Ruling)。将结构化裁决元数据直接上报至宿主与 ADR 画布。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "decision_type": {
                        "type": "string",
                        "enum": ["adopt_proposer", "reject_rebuild", "trade_off_matrix"],
                        "description": "终局裁决类型：adopt_proposer(采纳提案), reject_rebuild(采纳红队驳回重构), trade_off_matrix(综合权衡矩阵)"
                    },
                    "summary": {
                        "type": "string",
                        "description": "裁决总览陈词与定案依据"
                    },
                    "trade_off_points": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "关键权衡折中要点清单（如牺牲 X 换取 Y、引入 Z 防范边界反例）"
                    },
                    "impacted_files": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "本次决议限定改动的受影响文件列表（约束安全爆炸半径）"
                    },
                    "solution": {
                        "type": "string",
                        "description": "落地方案或重构路径概要 (可选)"
                    }
                },
                "required": ["decision_type", "summary", "trade_off_points", "impacted_files"]
            }
        },
        {
            "name": "submit_module_decomposition",
            "description": "在 G-Frame 博弈阶段 0 (decomposition) 提交任务模块化拆解清单与跨模块公共契约。将复杂任务（支持通用业务战略、产品规划或软件研发任务）拆解为 2~4 个职责正交、上下文物理隔离的原子模块。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "shared_contract": {
                        "type": "object",
                        "properties": {
                            "summary": {
                                "type": "string",
                                "description": "跨模块目标边界与核心假设简述"
                            },
                            "type_signatures": {
                                "type": "string",
                                "description": "跨模块共享的协议/接口签名定义（非代码类业务讨论可留空字符串）"
                            },
                            "invariants": {
                                "type": "array",
                                "items": { "type": "string" },
                                "description": "所有模块必须遵守的全局不变量约束或核心业务指标底线"
                            }
                        },
                        "required": ["summary", "invariants"]
                    },
                    "modules": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 4,
                        "items": {
                            "type": "object",
                            "properties": {
                                "module_id": { "type": "string", "description": "模块 ID，如 mod-1" },
                                "title": { "type": "string", "description": "模块标题" },
                                "responsibility": { "type": "string", "description": "单一模块职责与边界描述" },
                                "allowed_files": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "该模块允许触碰的文件或文档白名单（纯业务讨论可传空数组 []）"
                                },
                                "depends_on": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "依赖的前置 module_id 列表"
                                },
                                "complexity_level": {
                                    "type": "string",
                                    "enum": ["low_deterministic", "medium_standard", "high_critical"],
                                    "description": "模块复杂度/风险自评，用于初始化贝叶斯先验风险 P_prior"
                                }
                            },
                            "required": ["module_id", "title", "responsibility", "depends_on", "complexity_level"]
                        }
                    }
                },
                "required": ["shared_contract", "modules"]
            }
        }
    ])
}

/// 执行指定的 MCP 工具调用并返回文本输出
pub async fn dispatch_tool_call(tool_name: &str, arguments: &Value) -> Result<String> {
    match tool_name {
        "shell" => {
            let command = arguments["command"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 command"))?;
            let workdir = arguments["workdir"].as_str();
            let timeout_ms = arguments["timeout_ms"].as_u64();
            shell::execute_shell(command, workdir, timeout_ms).await
        }
        "read_file" => {
            let path = arguments["path"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 path"))?;
            let offset = arguments["offset"].as_u64().map(|v| v as usize);
            let limit = arguments["limit"].as_u64().map(|v| v as usize);
            fs::read_file(path, offset, limit).await
        }
        "write_file" => {
            let path = arguments["path"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 path"))?;
            let content = arguments["content"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 content"))?;
            fs::write_file(path, content).await
        }
        "str_replace" => {
            let path = arguments["path"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 path"))?;
            let old_str = arguments["old_str"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 old_str"))?;
            let new_str = arguments["new_str"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 new_str"))?;
            fs::str_replace(path, old_str, new_str).await
        }
        "list_dir" => {
            let path = arguments["path"].as_str();
            let max_depth = arguments["max_depth"].as_u64().map(|v| v as usize);
            fs::list_dir(path, max_depth).await
        }
        "search_code" => {
            let pattern = arguments["pattern"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 pattern"))?;
            let path = arguments["path"].as_str();
            let max_results = arguments["max_results"].as_u64().map(|v| v as usize);
            fs::search_code(pattern, path, max_results).await
        }
        "write_channel_artifact" => {
            let filename = arguments["filename"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 filename"))?;
            let content = arguments["content"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 content"))?;
            let channel_id = arguments["channel_id"].as_str();
            fs::write_channel_artifact(filename, content, channel_id).await
        }
        "write_agent_artifact" => {
            let filename = arguments["filename"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 filename"))?;
            let content = arguments["content"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 content"))?;
            let agent_id = arguments["agent_id"].as_str();
            fs::write_agent_artifact(filename, content, agent_id).await
        }
        "submit_arbitration_ruling" => {
            let decision_type = arguments["decision_type"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 decision_type"))?;
            let summary = arguments["summary"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 summary"))?;
            let trade_off_points = arguments["trade_off_points"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 trade_off_points 数组"))?;
            let impacted_files = arguments["impacted_files"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 impacted_files 数组"))?;
            let solution = arguments["solution"].as_str().unwrap_or_default();

            let formatted_points = trade_off_points
                .iter()
                .filter_map(|p| p.as_str())
                .map(|p| format!("  • {}", p))
                .collect::<Vec<_>>()
                .join("\n");

            let formatted_files = impacted_files
                .iter()
                .filter_map(|f| f.as_str())
                .collect::<Vec<_>>()
                .join(", ");

            Ok(format!(
                "✓ 【仲裁定案裁决书】已成功提交至宿主与 ADR 画布：\n• 裁决类型: {}\n• 核心决议: {}\n• 关键权衡点:\n{}\n• 约束安全爆炸半径文件: {}\n{}",
                decision_type,
                summary,
                formatted_points,
                if formatted_files.is_empty() { "无" } else { &formatted_files },
                if solution.is_empty() { String::new() } else { format!("• 实施路径概要: {}", solution) }
            ))
        }
        "submit_module_decomposition" => {
            let shared = arguments
                .get("shared_contract")
                .ok_or_else(|| anyhow!("缺少必填参数 shared_contract"))?;
            let summary = shared["summary"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 shared_contract.summary"))?;
            let modules = arguments["modules"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 modules 数组"))?;
            if modules.len() < 2 || modules.len() > 4 {
                return Err(anyhow!("G-Frame 模块化拆解要求模块数在 2~4 个之间，当前为 {}", modules.len()));
            }

            let formatted_modules = modules
                .iter()
                .map(|m| {
                    let id = m["module_id"].as_str().unwrap_or("mod");
                    let title = m["title"].as_str().unwrap_or("未命名模块");
                    let level = m["complexity_level"].as_str().unwrap_or("medium_standard");
                    format!("  • [{}] {} ({})", id, title, level)
                })
                .collect::<Vec<_>>()
                .join("\n");

            Ok(format!(
                "✓ 【G-Frame 模块拓扑与公共接口契约】已成功锁定：\n• 公共契约摘要: {}\n• 原子模块切片 ({} 个):\n{}",
                summary,
                modules.len(),
                formatted_modules
            ))
        }
        unknown => Err(anyhow!("未知的 MCP 工具名称: {}", unknown)),
    }
}

#[cfg(test)]
pub(crate) static TEST_ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tools_list_schema() {
        let list = get_tools_list();
        let arr = list.as_array().expect("tools list must be array");
        assert!(arr.len() >= 9);
        let names: Vec<&str> = arr.iter().filter_map(|t| t["name"].as_str()).collect();
        assert!(names.contains(&"shell"));
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&"write_file"));
        assert!(names.contains(&"str_replace"));
        assert!(names.contains(&"list_dir"));
        assert!(names.contains(&"search_code"));
        assert!(names.contains(&"write_channel_artifact"));
        assert!(names.contains(&"write_agent_artifact"));
        assert!(names.contains(&"submit_arbitration_ruling"));
        assert!(names.contains(&"submit_module_decomposition"));
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_shell() {
        let args = json!({
            "command": "echo 'shinobi dispatch ok'"
        });
        let res = dispatch_tool_call("shell", &args).await.unwrap();
        assert!(res.contains("shinobi dispatch ok"));
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_write_artifact() {
        let _guard = TEST_ENV_MUTEX.lock().unwrap();
        let temp_dir = std::env::temp_dir().join("shadow_crew_dispatch_test_art").join(".shadow-crew");
        std::env::set_var("SHADOW_CREW_HOME", &temp_dir);

        let args = json!({
            "filename": "test_dispatch_adr.md",
            "content": "# Test Dispatch ADR",
            "channel_id": "test-dispatch-chan"
        });
        let res = dispatch_tool_call("write_channel_artifact", &args).await.unwrap();
        assert!(res.contains("test_dispatch_adr.md"));

        let agent_args = json!({
            "filename": "agent_note.md",
            "content": "# Agent Note",
            "agent_id": "agent-dispatch-test"
        });
        let agent_res = dispatch_tool_call("write_agent_artifact", &agent_args).await.unwrap();
        assert!(agent_res.contains("agent_note.md"));
        assert!(temp_dir.join("agents").join("agent-dispatch-test").join("artifacts").join("agent_note.md").exists());

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
        std::env::remove_var("SHADOW_CREW_HOME");
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_submit_ruling() {
        let args = json!({
            "decision_type": "trade_off_matrix",
            "summary": "围绕分布式缓存一致性进行两阶段推进",
            "trade_off_points": [
                "优先保障强一致性 (确定性权重 45%)",
                "适度接受 5ms 本地内存对账延迟"
            ],
            "impacted_files": ["src/services/cache.ts", "config/redis.toml"],
            "solution": "第一阶段启用本地原子流水号，第二阶段按需配置旁路对账"
        });
        let res = dispatch_tool_call("submit_arbitration_ruling", &args).await.unwrap();
        assert!(res.contains("✓ 【仲裁定案裁决书】已成功提交"));
        assert!(res.contains("src/services/cache.ts"));
        assert!(res.contains("优先保障强一致性"));
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_submit_module_decomposition() {
        let args = json!({
            "shared_contract": {
                "summary": "跨模块共享状态同步接口定义",
                "type_signatures": "export interface SyncPayload { id: string; }",
                "invariants": ["禁止跨模块越界写文件"]
            },
            "modules": [
                {
                    "module_id": "mod-1",
                    "title": "模块 1：契约定义",
                    "responsibility": "定义数据结构",
                    "allowed_files": ["src/types.ts"],
                    "depends_on": [],
                    "complexity_level": "low_deterministic"
                },
                {
                    "module_id": "mod-2",
                    "title": "模块 2：核心引擎",
                    "responsibility": "实现并发同步逻辑",
                    "allowed_files": ["src/services/sync.ts"],
                    "depends_on": ["mod-1"],
                    "complexity_level": "high_critical"
                }
            ]
        });
        let res = dispatch_tool_call("submit_module_decomposition", &args).await.unwrap();
        assert!(res.contains("✓ 【G-Frame 模块拓扑与公共接口契约】已成功锁定"));
        assert!(res.contains("mod-1"));
        assert!(res.contains("mod-2"));
    }
}

