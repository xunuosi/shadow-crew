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
            "description": "将正式技术产物 (如 ADR 架构决策文档、推演方案白皮书、关键补丁 diff) 永久归档至当前 Workspace Binding 的 artifactRoot。Channel 与 Topic 使用各自的独立产物目录。",
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
                    },
                    "ruling_options": {
                        "type": "object",
                        "description": "可选的 3 种模式完整备选方案 (adopt_proposer, reject_rebuild, trade_off_matrix)，供法槌控制台多模式审阅与实时无缝切换",
                        "properties": {
                            "adopt_proposer": {
                                "type": "object",
                                "description": "采纳提案主导方案预案",
                                "properties": {
                                    "decision_type": { "type": "string", "enum": ["adopt_proposer"] },
                                    "summary": { "type": "string", "description": "采纳方案核心依据" },
                                    "trade_off_points": { "type": "array", "items": { "type": "string" }, "description": "权衡点列表" },
                                    "impacted_files": { "type": "array", "items": { "type": "string" }, "description": "受影响文件" },
                                    "solution": { "type": "string", "description": "落地实施路径" }
                                },
                                "required": ["decision_type", "summary", "trade_off_points", "impacted_files"]
                            },
                            "reject_rebuild": {
                                "type": "object",
                                "description": "采纳红队驳回重构预案",
                                "properties": {
                                    "decision_type": { "type": "string", "enum": ["reject_rebuild"] },
                                    "summary": { "type": "string", "description": "驳回重构核心依据" },
                                    "trade_off_points": { "type": "array", "items": { "type": "string" }, "description": "权衡点列表" },
                                    "impacted_files": { "type": "array", "items": { "type": "string" }, "description": "受影响文件" },
                                    "solution": { "type": "string", "description": "重构指引与安全假设" }
                                },
                                "required": ["decision_type", "summary", "trade_off_points", "impacted_files"]
                            },
                            "trade_off_matrix": {
                                "type": "object",
                                "description": "综合权衡折中矩阵预案",
                                "properties": {
                                    "decision_type": { "type": "string", "enum": ["trade_off_matrix"] },
                                    "summary": { "type": "string", "description": "折中定案总览依据" },
                                    "trade_off_points": { "type": "array", "items": { "type": "string" }, "description": "权衡点列表" },
                                    "impacted_files": { "type": "array", "items": { "type": "string" }, "description": "受影响文件" },
                                    "solution": { "type": "string", "description": "分阶段演进实施路径" }
                                },
                                "required": ["decision_type", "summary", "trade_off_points", "impacted_files"]
                            }
                        }
                    }
                },
                "required": ["decision_type", "summary", "trade_off_points", "impacted_files"]
            }
        },
        {
            "name": "submit_role_concurrence",
            "description": "提交参研角色针对当前终局方案的正式结构化无异议票。自然语言回复不能替代该工具契约；宿主仅接受摘要匹配且字段一致的有效票。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "protocol_version": {
                        "type": "integer",
                        "enum": [1],
                        "description": "角色无异议票协议版本，固定为 1"
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "当前投票 Agent 的真实 ID，禁止代投"
                    },
                    "role": {
                        "type": "string",
                        "enum": ["proposer", "challenger", "verifier"],
                        "description": "当前 Agent 在本议题中的参研角色"
                    },
                    "solution_digest": {
                        "type": "string",
                        "description": "宿主下发的 sha256:... 终局方案摘要，必须逐字一致"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["concurred", "conditional", "objected", "unavailable"],
                        "description": "无异议、条件保留、阻断异议或无法判断"
                    },
                    "blocking_issue_ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "阻断性问题 ID；concurred 时必须为空数组"
                    },
                    "conditions": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "暂缓、补测或上线前置条件；concurred 时必须为空数组"
                    },
                    "rationale": {
                        "type": "string",
                        "description": "结构化判断依据摘要，供人类审计"
                    },
                    "evidence_refs": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "支撑本次判断的实证或证据编号"
                    }
                },
                "required": [
                    "protocol_version",
                    "agent_id",
                    "role",
                    "solution_digest",
                    "status",
                    "blocking_issue_ids",
                    "conditions",
                    "rationale",
                    "evidence_refs"
                ]
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
        },
        {
            "name": "submit_grounding_evidence",
            "description": "在博弈阶段 3 (verification) 提交自动化测试与客观物理接地验证的实证检验数据与结论。将结构化实证结果直接上报至宿主争议证据链与安全宪章账本。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "evidences": {
                        "type": "array",
                        "description": "客观实证检验项列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source_tool": {
                                    "type": "string",
                                    "description": "检验工具或执行沙箱名称 (如 ast_grep, code_sandbox, cargo_test, read_file, static_analyzer)"
                                },
                                "input_query_or_code": {
                                    "type": "string",
                                    "description": "执行的具体检验代码、测试命令或参数 (可选)"
                                },
                                "raw_output": {
                                    "type": "string",
                                    "description": "工具执行的原始输出摘要或观测结果 (可选)"
                                },
                                "truth_value": {
                                    "type": "boolean",
                                    "description": "真值判定: true 表示通过/证实，false 表示失效/反例成立"
                                },
                                "confidence": {
                                    "type": "number",
                                    "description": "实证置信度 (0.0 ~ 1.0，默认为 0.9)"
                                },
                                "verifier_report": {
                                    "type": "string",
                                    "description": "精炼客观的实证审查结论"
                                }
                            },
                            "required": ["source_tool", "truth_value", "verifier_report"]
                        }
                    }
                },
                "required": ["evidences"]
            }
        },
        {
            "name": "submit_execution_deliverable",
            "description": "在议题定案决议落地执行（或 G-Frame 模块化串行落地）阶段，提交落地交付物的结构化元数据，直接绑定落地舱 UI 展示与审查/合入行为，无需在正文中附加 EXECUTION_META 契约块。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "section_title": {
                        "type": "string",
                        "description": "交付章节标题 (如: 订单幂等锁实现与单测补丁)"
                    },
                    "pod_title": {
                        "type": "string",
                        "description": "带 Emoji 的简短落地舱名称 (10字以内，如: 🛠️ 幂等锁代码交付)"
                    },
                    "status_summary": {
                        "type": "string",
                        "description": "一句话交付成果摘要 (40字以内，用于卡片与系统通知展示)"
                    },
                    "deliverable_kind": {
                        "type": "string",
                        "enum": ["workspace_files", "report_only"],
                        "description": "交付物类别: workspace_files(包含工作区文件变更) 或 report_only(纯方案报告)"
                    },
                    "review_action_label": {
                        "type": "string",
                        "description": "审查按钮动态文案 (例如: 审查代码 Diff / 预览文档变更)"
                    },
                    "apply_action_label": {
                        "type": "string",
                        "description": "合入按钮动态文案 (例如: 一键合入本地仓库 / 写入本地文档)"
                    },
                    "impacted_files": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "本次落地修改或新建的文件路径列表 (可选)"
                    }
                },
                "required": ["section_title", "pod_title", "status_summary"]
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

            let solution_line = if solution.is_empty() {
                String::new()
            } else {
                format!("\n• 实施路径概要: {}", solution)
            };

            let ruling_options_info = if let Some(opts) = arguments.get("ruling_options").and_then(|v| v.as_object()) {
                let keys = opts.keys().cloned().collect::<Vec<_>>().join(", ");
                format!("\n• 备选模式预案: 包含 [{}]", keys)
            } else {
                String::new()
            };

            Ok(format!(
                "✓ 【仲裁定案裁决书】已成功提交至宿主与 ADR 画布：\n• 裁决类型: {}\n• 核心决议: {}\n• 关键权衡点:\n{}\n• 约束安全爆炸半径文件: {}{}{}",
                decision_type,
                summary,
                formatted_points,
                if formatted_files.is_empty() { "无" } else { &formatted_files },
                solution_line,
                ruling_options_info
            ))
        }
        "submit_role_concurrence" => {
            let protocol_version = arguments["protocol_version"]
                .as_u64()
                .ok_or_else(|| anyhow!("缺少必填参数 protocol_version"))?;
            if protocol_version != 1 {
                return Err(anyhow!("protocol_version 必须为 1"));
            }
            let agent_id = arguments["agent_id"]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| anyhow!("缺少必填参数 agent_id"))?;
            let role = arguments["role"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 role"))?;
            if !matches!(role, "proposer" | "challenger" | "verifier") {
                return Err(anyhow!("role 必须为 proposer、challenger 或 verifier"));
            }
            let solution_digest = arguments["solution_digest"]
                .as_str()
                .map(str::trim)
                .ok_or_else(|| anyhow!("缺少必填参数 solution_digest"))?;
            let valid_digest = solution_digest
                .strip_prefix("sha256:")
                .map(|hex| hex.len() == 64 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
                .unwrap_or(false);
            if !valid_digest {
                return Err(anyhow!(
                    "solution_digest 必须是 sha256: 加 64 位十六进制摘要"
                ));
            }
            let status = arguments["status"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 status"))?;
            if !matches!(
                status,
                "concurred" | "conditional" | "objected" | "unavailable"
            ) {
                return Err(anyhow!(
                    "status 必须为 concurred | conditional | objected | unavailable"
                ));
            }
            let blocking_issue_ids = arguments["blocking_issue_ids"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 blocking_issue_ids 数组"))?;
            let conditions = arguments["conditions"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 conditions 数组"))?;
            let evidence_refs = arguments["evidence_refs"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 evidence_refs 数组"))?;
            let rationale = arguments["rationale"]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| anyhow!("缺少非空必填参数 rationale"))?;
            if status == "concurred" && (!blocking_issue_ids.is_empty() || !conditions.is_empty()) {
                return Err(anyhow!(
                    "status=concurred 时 blocking_issue_ids 与 conditions 必须为空；存在条件时应提交 conditional"
                ));
            }
            if status == "conditional" && conditions.is_empty() {
                return Err(anyhow!("status=conditional 时必须至少提供一项 conditions"));
            }
            if status == "objected" && blocking_issue_ids.is_empty() {
                return Err(anyhow!(
                    "status=objected 时必须至少提供一个 blocking_issue_id"
                ));
            }
            if blocking_issue_ids.iter().any(|item| {
                item.as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_none()
            }) || conditions.iter().any(|item| {
                item.as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_none()
            }) || evidence_refs.iter().any(|item| {
                item.as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_none()
            }) {
                return Err(anyhow!(
                    "blocking_issue_ids、conditions、evidence_refs 必须全部为非空字符串"
                ));
            }

            Ok(format!(
                "✓ 【角色终局无异议票】已成功提交：\n• Agent: {} ({})\n• 方案摘要: {}\n• 状态: {}\n• 阻断项: {}\n• 前置条件: {}\n• 判断依据: {}",
                agent_id,
                role,
                solution_digest,
                status,
                if blocking_issue_ids.is_empty() { "无".to_string() } else { format!("{:?}", blocking_issue_ids) },
                if conditions.is_empty() { "无".to_string() } else { format!("{:?}", conditions) },
                rationale
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
        "submit_grounding_evidence" => {
            let raw_evidences = arguments
                .get("evidences")
                .and_then(|v| v.as_array())
                .ok_or_else(|| anyhow!("缺少必填参数 evidences 数组"))?;
            if raw_evidences.is_empty() {
                return Err(anyhow!("evidences 数组不能为空，必须至少包含一条实证检验项"));
            }

            let formatted = raw_evidences
                .iter()
                .enumerate()
                .map(|(i, ev)| {
                    let tool = ev["source_tool"].as_str().unwrap_or("unknown_tool");
                    let is_pass = ev["truth_value"].as_bool().unwrap_or(false);
                    let report = ev["verifier_report"].as_str().unwrap_or("完成检验");
                    let status_badge = if is_pass { "✓ PASS" } else { "✗ FAIL" };
                    format!("  {}. [{}] 来源: {} -> {}", i + 1, status_badge, tool, report)
                })
                .collect::<Vec<_>>()
                .join("\n");

            Ok(format!(
                "✓ 【客观物理接地实证结论】已成功载入实证证据链：\n• 提交实证项 ({} 项):\n{}",
                raw_evidences.len(),
                formatted
            ))
        }
        "submit_execution_deliverable" => {
            let section_title = arguments["section_title"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 section_title"))?;
            let pod_title = arguments["pod_title"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 pod_title"))?;
            let status_summary = arguments["status_summary"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 status_summary"))?;
            let deliverable_kind = arguments["deliverable_kind"].as_str().unwrap_or("workspace_files");
            let review_label = arguments["review_action_label"].as_str().unwrap_or("审查交付物");
            let apply_label = arguments["apply_action_label"].as_str().unwrap_or("合入工作区");

            Ok(format!(
                "✓ 【定案落地交付物元数据】已成功上报：\n• 章节标题: {}\n• 落地舱: {}\n• 成果摘要: {}\n• 类别: {}\n• 操作标签: {} / {}",
                section_title,
                pod_title,
                status_summary,
                deliverable_kind,
                review_label,
                apply_label
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
        assert!(names.contains(&"submit_role_concurrence"));
        assert!(names.contains(&"submit_module_decomposition"));
        assert!(names.contains(&"submit_grounding_evidence"));
        assert!(names.contains(&"submit_execution_deliverable"));
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
    async fn test_dispatch_tool_call_submit_ruling_with_options() {
        let args = json!({
            "decision_type": "trade_off_matrix",
            "summary": "围绕分布式缓存一致性进行两阶段推进",
            "trade_off_points": [
                "优先保障强一致性 (确定性权重 45%)",
                "适度接受 5ms 本地内存对账延迟"
            ],
            "impacted_files": ["src/services/cache.ts", "config/redis.toml"],
            "solution": "第一阶段启用本地原子流水号，第二阶段按需配置旁路对账",
            "ruling_options": {
                "adopt_proposer": {
                    "decision_type": "adopt_proposer",
                    "summary": "采纳提案主导方案",
                    "trade_off_points": ["快速交付优先"],
                    "impacted_files": ["src/services/cache.ts"],
                    "solution": "合入主干"
                },
                "reject_rebuild": {
                    "decision_type": "reject_rebuild",
                    "summary": "驳回重构方案",
                    "trade_off_points": ["严格协议规范"],
                    "impacted_files": ["src/services/cache.ts"],
                    "solution": "推倒重来"
                },
                "trade_off_matrix": {
                    "decision_type": "trade_off_matrix",
                    "summary": "权衡折中两阶段方案",
                    "trade_off_points": ["两阶段推进"],
                    "impacted_files": ["src/services/cache.ts"],
                    "solution": "分期实施"
                }
            }
        });
        let res = dispatch_tool_call("submit_arbitration_ruling", &args).await.unwrap();
        assert!(res.contains("✓ 【仲裁定案裁决书】已成功提交"));
        assert!(res.contains("备选模式预案: 包含"));
        assert!(res.contains("adopt_proposer"));
        assert!(res.contains("reject_rebuild"));
        assert!(res.contains("trade_off_matrix"));
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_submit_role_concurrence() {
        let args = json!({
            "protocol_version": 1,
            "agent_id": "agent-challenger",
            "role": "challenger",
            "solution_digest": format!("sha256:{}", "a".repeat(64)),
            "status": "concurred",
            "blocking_issue_ids": [],
            "conditions": [],
            "rationale": "关键反例已被数据库唯一键兜底。",
            "evidence_refs": ["EV-01"]
        });
        let res = dispatch_tool_call("submit_role_concurrence", &args)
            .await
            .unwrap();
        assert!(res.contains("角色终局无异议票"));
        assert!(res.contains("agent-challenger"));
        assert!(res.contains("status") || res.contains("状态: concurred"));

        let invalid_conditional = json!({
            "protocol_version": 1,
            "agent_id": "agent-challenger",
            "role": "challenger",
            "solution_digest": format!("sha256:{}", "b".repeat(64)),
            "status": "concurred",
            "blocking_issue_ids": [],
            "conditions": ["完成跨机房 Chaos 压测"],
            "rationale": "仍需补测。",
            "evidence_refs": []
        });
        assert!(
            dispatch_tool_call("submit_role_concurrence", &invalid_conditional)
                .await
                .is_err(),
            "concurred 携带条件必须被工具层拒绝"
        );

        let empty_conditional_status = json!({
            "protocol_version": 1,
            "agent_id": "agent-challenger",
            "role": "challenger",
            "solution_digest": format!("sha256:{}", "c".repeat(64)),
            "status": "conditional",
            "blocking_issue_ids": [],
            "conditions": [],
            "rationale": "需要补测但没有列明条件。",
            "evidence_refs": []
        });
        assert!(
            dispatch_tool_call("submit_role_concurrence", &empty_conditional_status)
                .await
                .is_err(),
            "conditional 无前置条件必须被工具层拒绝"
        );
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

    #[tokio::test]
    async fn test_dispatch_tool_call_submit_grounding_evidence() {
        let args = json!({
            "evidences": [
                {
                    "source_tool": "ast_grep",
                    "input_query_or_code": "ast-grep --pattern 'active_sessions.lock()'",
                    "raw_output": "src/acp_manager.rs:42: match found",
                    "truth_value": true,
                    "confidence": 0.95,
                    "verifier_report": "复现全局锁竞争点，证实反例成立"
                },
                {
                    "source_tool": "code_sandbox",
                    "input_query_or_code": "cargo test -p shadow-crew-dev-mcp",
                    "raw_output": "test failed: connection timeout",
                    "truth_value": false,
                    "confidence": 0.9,
                    "verifier_report": "沙箱测试失败"
                }
            ]
        });
        let res = dispatch_tool_call("submit_grounding_evidence", &args).await.unwrap();
        assert!(res.contains("✓ 【客观物理接地实证结论】已成功载入实证证据链"));
        assert!(res.contains("2 项"));
        assert!(res.contains("✓ PASS"));
        assert!(res.contains("✗ FAIL"));
        assert!(res.contains("ast_grep"));
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_submit_execution_deliverable() {
        let args = json!({
            "section_title": "优化 ACP 会话关闭超时强杀机制",
            "pod_title": "🛠️ 强杀补丁交付",
            "status_summary": "完成 3s 退出超时守卫与测试验证",
            "deliverable_kind": "workspace_files",
            "review_action_label": "审查补丁 Diff",
            "apply_action_label": "应用补丁到本地工作区"
        });
        let res = dispatch_tool_call("submit_execution_deliverable", &args).await.unwrap();
        assert!(res.contains("✓ 【定案落地交付物元数据】已成功上报"));
        assert!(res.contains("强杀补丁交付"));
        assert!(res.contains("workspace_files"));
        assert!(res.contains("审查补丁 Diff"));
    }
}

