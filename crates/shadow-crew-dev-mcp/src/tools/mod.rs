pub mod fs;
pub mod shell;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DevMcpProfile {
    Full,
    GovernanceOnly,
}

impl DevMcpProfile {
    pub fn from_env_and_args() -> Self {
        if std::env::args().any(|arg| arg == "--governance-only") {
            return Self::GovernanceOnly;
        }
        match std::env::var("SHADOW_CREW_DEV_MCP_PROFILE") {
            Ok(val) if val.trim().eq_ignore_ascii_case("governance_only") => {
                Self::GovernanceOnly
            }
            _ => Self::Full,
        }
    }
}

const BASE_FS_SHELL_TOOL_NAMES: [&str; 6] = [
    "shell",
    "read_file",
    "write_file",
    "str_replace",
    "list_dir",
    "search_code",
];

pub fn get_tools_list_for_profile(profile: DevMcpProfile) -> Value {
    let mut tools = get_tools_list();
    if profile == DevMcpProfile::GovernanceOnly {
        if let Some(arr) = tools.as_array_mut() {
            arr.retain(|tool| {
                let name = tool["name"].as_str().unwrap_or_default();
                !BASE_FS_SHELL_TOOL_NAMES.contains(&name)
            });
        }
    }
    tools
}

/// 返回当前内置原生 MCP 工具集元数据 (符合 MCP JSON Schema 规范)
pub fn get_tools_list() -> Value {
    let mut tools = json!([
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
                        "description": "本次决议限定改动的受影响文件列表（必须填写完整绝对路径或自工作区根目录起的完整相对路径，禁止仅填裸文件名）"
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
                                    "impacted_files": { "type": "array", "items": { "type": "string" }, "description": "受影响文件（必须填写完整绝对路径或自工作区根目录起的完整相对路径，禁止仅填裸文件名）" },
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
                                    "impacted_files": { "type": "array", "items": { "type": "string" }, "description": "受影响文件（必须填写完整绝对路径或自工作区根目录起的完整相对路径，禁止仅填裸文件名）" },
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
                                    "impacted_files": { "type": "array", "items": { "type": "string" }, "description": "受影响文件（必须填写完整绝对路径或自工作区根目录起的完整相对路径，禁止仅填裸文件名）" },
                                    "solution": { "type": "string", "description": "分阶段演进实施路径" }
                                },
                                "required": ["decision_type", "summary", "trade_off_points", "impacted_files"]
                            }
                        }
                    },
                    "mcda_matrix": {
                        "type": "object",
                        "description": "可选的结构化 BWM 运筹权重与评分矩阵输入，由宿主直接送入 0-Token BWM 求解器",
                        "properties": {
                            "criteria": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": { "type": "string" },
                                        "name": { "type": "string" },
                                        "direction": { "type": "string", "enum": ["maximize", "minimize"] }
                                    },
                                    "required": ["id", "name", "direction"]
                                }
                            },
                            "alternatives": {
                                "type": "array",
                                "items": { "type": "string" }
                            },
                            "score_matrix": {
                                "type": "object",
                                "description": "方案名 -> 准则ID -> 0~10 分值字典"
                            },
                            "best_criterion_id": { "type": "string" },
                            "worst_criterion_id": { "type": "string" },
                            "best_to_others": {
                                "type": "array",
                                "items": { "type": "number" }
                            },
                            "others_to_worst": {
                                "type": "array",
                                "items": { "type": "number" }
                            },
                            "score_provenance": {
                                "type": "object"
                            }
                        }
                    }
                },
                "required": ["decision_type", "summary", "trade_off_points", "impacted_files"]
            }
        },
        {
            "name": "submit_proposal_claims",
            "description": "在博弈阶段 1 (proposal) 提交结构化的可证伪核心论点节点与 DAG 依赖图，取代自然语言切片猜测。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "提案核心架构主张与总结 (至少 10 个字符)"
                    },
                    "claims": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 8,
                        "description": "核心可证伪论点节点列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "claim_id": {
                                    "type": "string",
                                    "description": "论点节点唯一 ID (如 claim-1)"
                                },
                                "claim": {
                                    "type": "string",
                                    "description": "核心主张命题与技术承诺"
                                },
                                "assumptions": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "该论点依赖的前置假设"
                                },
                                "depends_on_claim_ids": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "显式 DAG 前驱论点节点 ID 列表"
                                },
                                "confidence": {
                                    "type": "number",
                                    "description": "提案方自评初始置信度 (0.0 ~ 1.0)"
                                }
                            },
                            "required": ["claim_id", "claim"]
                        }
                    },
                    "impacted_files": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "提案拟修改或新增的工程文件路径列表（必须填写完整绝对路径或自工作区根目录起的完整相对路径，禁止仅填裸文件名）"
                    },
                    "design_decisions": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "关键架构选型与技术边界要点 (可选)"
                    }
                },
                "required": ["summary", "claims", "impacted_files"]
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
            "description": "在 G-Frame 博弈阶段 0 (decomposition) 提交任务模块化拆解清单与跨模块公共契约。将任务（支持通用业务战略、产品规划或软件研发任务）拆解为 1~4 个职责正交、上下文物理隔离的原子模块（简单或单一职责任务可仅提交 1 个模块，复杂多域任务拆解为 2~4 个模块）。",
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
                        "minItems": 1,
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
                                    "description": "该模块允许触碰的文件或文档白名单（纯业务讨论可传空数组 []；若填写文件路径，必须填写完整绝对路径或自工作区根目录起的完整相对路径，禁止仅填裸文件名）"
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
                                },
                                "requires_red_team": {
                                    "type": "boolean",
                                    "description": "由大模型结合议题全局语义自主判断该模块是否需要红队对抗质询（true=强制进入红方 deep_debate，false=低风险确定性模块可走 fast_track 快速验证）"
                                },
                                "routing_rationale": {
                                    "type": "string",
                                    "description": "（可选）大模型自主判定是否需要红队对抗的简要依据"
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
                                "claim_id": {
                                    "type": "string",
                                    "description": "关联的原子提案论点 ID (如 claim-1)，用于 100% 确定性对齐论点实证状态 (可选)"
                                },
                                "tier": {
                                    "type": "string",
                                    "enum": ["T1", "T2"],
                                    "description": "证据分级: T1(只读静态检验, 权重<=0.3) 或 T2(受控沙箱执行检验) (可选)"
                                },
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
                        "description": "本次落地修改或新建的文件路径列表（可选；必须填写完整绝对路径或自工作区根目录起的完整相对路径，禁止仅填裸文件名）"
                    }
                },
                "required": ["section_title", "pod_title", "status_summary"]
            }
        },
        {
            "name": "submit_challenge_critique",
            "description": "在博弈阶段 2 (challenge) 提交红队反从众逆向质询与反例压测报告。必须完整覆盖红队四部曲（致命缺陷、隐含假设、失效场景、反例测算与实证要求），直接上报至争议定位器与契约门禁。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target_claim_id": {
                        "type": "string",
                        "description": "被攻击的立论因果论点节点 ID (如 claim-1 或 node-1-schema)，用于精准对齐 LMAD 局部争议切片 (可选)"
                    },
                    "disputed_claim_ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "显式指向存在争议的多个提案 claim_id 列表 (可选)"
                    },
                    "root_cause_category": {
                        "type": "string",
                        "enum": [
                            "network_partition",
                            "concurrency_race",
                            "resource_exhaustion",
                            "cost_complexity",
                            "architecture_coupling",
                            "security_boundary",
                            "general"
                        ],
                        "description": "显式冲突根因分类枚举 (用于取代文本关键词猜测，可选)"
                    },
                    "reopening_triggers": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "《少数派异议报告》的黑天鹅重启触发条件清单 (可选)"
                    },
                    "alignment_score": {
                        "type": "number",
                        "description": "质询官对当前提案对齐/收敛程度的量化评估 (0.0 ~ 1.0，可选)"
                    },
                    "fatal_flaws": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "核心逻辑矛盾、系统级缺陷或单点失效隐患列表 (四部曲之一: 逻辑矛盾与潜在风险)"
                    },
                    "hidden_assumptions": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "暴露原提案中不合理的默认前提或理想化假设 (四部曲之二: 隐含假设缺陷)"
                    },
                    "failure_scenarios": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "极端并发、网络超时断连、死锁竞争、脏数据或服务崩溃等工况反例 (四部曲之三: 极端边缘与失效场景)"
                    },
                    "counter_demands": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "向提案方索要的实证检验要求或防御性架构补丁指标 (四部曲之四: 反例压测与实证要求)"
                    },
                    "summary": {
                        "type": "string",
                        "description": "红队最终质询结论通俗陈词 (≤ 80 字)"
                    }
                },
                "required": ["fatal_flaws", "hidden_assumptions", "failure_scenarios", "counter_demands", "summary"]
            }
        },
        {
            "name": "submit_defense_patch",
            "description": "在博弈阶段 4 (defense) 提交结构化的答辩立场、逐条论点修正与架构补丁方案，严格执行 Free-MAD 反盲从妥协契约。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "答辩修正核心结论总结"
                    },
                    "stance": {
                        "type": "string",
                        "enum": [
                            "uphold_with_patch",
                            "partial_concession_with_patch",
                            "reject_critique_with_proof",
                            "full_surrender_without_patch"
                        ],
                        "description": "显式答辩立场枚举：full_surrender_without_patch 代表无条件全面认怂，将被 Free-MAD 拦截"
                    },
                    "patched_claims": {
                        "type": "array",
                        "minItems": 1,
                        "description": "针对质询与验证结果的逐条回应",
                        "items": {
                            "type": "object",
                            "properties": {
                                "claim_id": {
                                    "type": "string",
                                    "description": "对应的提案 claim_id"
                                },
                                "resolution": {
                                    "type": "string",
                                    "description": "具体修正方案或技术反驳依据"
                                },
                                "status": {
                                    "type": "string",
                                    "enum": ["resolved", "upheld", "conceded"],
                                    "description": "论点当前状态：resolved(已补丁闭环) / upheld(经实证维持原主张) / conceded(合理让步)"
                                }
                            },
                            "required": ["claim_id", "resolution", "status"]
                        }
                    },
                    "defense_patches": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "具体架构修正补丁、降级预案或边界约束列表"
                    },
                    "quantified_metrics": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "显式量化指标或性能/容灾边界约束 (可选)"
                    },
                    "impacted_files": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "答辩修正后拟变更的工程文件路径列表（必须填写完整绝对路径或自工作区根目录起的完整相对路径，禁止仅填裸文件名）"
                    },
                    "alignment_score": {
                        "type": "number",
                        "description": "答辩方对本轮收敛对齐度的自评 (0.0 ~ 1.0，可选)"
                    }
                },
                "required": ["summary", "stance", "patched_claims", "defense_patches", "impacted_files"]
            }
        },
        {
            "name": "validate_workspace_diff",
            "description": "对落地执行智能体产出的 Unified Diff 补丁执行 Dry-Run 预检。检验目标文件是否存在、上下文行是否对齐无冲突，并核验是否越界修改非白名单文件，确保 100% 可安全干净合入。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "patches": {
                        "type": "array",
                        "description": "待预检的文件补丁列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "filename": { "type": "string", "description": "相对目标文件路径 (如 src/services/acpClient.ts)" },
                                "diff": { "type": "string", "description": "标准 Unified Diff 块 (包含 @@ 行)" }
                            },
                            "required": ["filename", "diff"]
                        }
                    },
                    "allowed_files": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "当前模块允许修改的文件路径白名单（可选，用于安全爆炸半径约束；必须填写完整绝对路径或自工作区根目录起的完整相对路径，禁止仅填裸文件名）"
                    }
                },
                "required": ["patches"]
            }
        }
    ]);

    if let Some(arr) = tools.as_array_mut() {
        for tool in arr.iter_mut() {
            let name = tool["name"].as_str().unwrap_or_default();
            let (read_only, destructive, idempotent, open_world) = match name {
                "read_file"
                | "list_dir"
                | "search_code"
                | "submit_arbitration_ruling"
                | "submit_proposal_claims"
                | "submit_role_concurrence"
                | "submit_module_decomposition"
                | "submit_grounding_evidence"
                | "submit_execution_deliverable"
                | "submit_challenge_critique"
                | "submit_defense_patch"
                | "validate_workspace_diff" => (true, false, true, false),
                "write_file"
                | "str_replace"
                | "write_channel_artifact"
                | "write_agent_artifact" => (false, false, true, false),
                "shell" => (false, false, false, false),
                _ => (false, false, false, false),
            };
            if let Some(obj) = tool.as_object_mut() {
                obj.insert(
                    "annotations".to_string(),
                    json!({
                        "readOnlyHint": read_only,
                        "destructiveHint": destructive,
                        "idempotentHint": idempotent,
                        "openWorldHint": open_world
                    }),
                );
            }
        }
    }

    tools
}

/// 执行指定的 MCP 工具调用并返回文本输出 (默认 Full 模式)
pub async fn dispatch_tool_call(tool_name: &str, arguments: &Value) -> Result<String> {
    dispatch_tool_call_with_profile(tool_name, arguments, DevMcpProfile::Full).await
}

/// 按指定 Profile 执行 MCP 工具调用并返回文本输出
pub async fn dispatch_tool_call_with_profile(
    tool_name: &str,
    arguments: &Value,
    profile: DevMcpProfile,
) -> Result<String> {
    if profile == DevMcpProfile::GovernanceOnly && BASE_FS_SHELL_TOOL_NAMES.contains(&tool_name) {
        return Err(anyhow!(
            "当前宿主处于 governance_only 模式，已禁用基础文件/终端 MCP 工具 [{}]；本地 Agent 请使用自身原生工具执行（工作区外路径将自动进入宿主 ACP 授权审批）。",
            tool_name
        ));
    }

    match tool_name {
        "shell" => {
            let command = arguments["command"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 command"))?;
            let workdir = arguments["workdir"].as_str();
            if let Some(dir) = workdir {
                fs::ensure_path_within_workspace(dir)?;
            }
            let timeout_ms = arguments["timeout_ms"].as_u64();
            shell::execute_shell(command, workdir, timeout_ms).await
        }
        "read_file" => {
            let path = arguments["path"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 path"))?;
            let resolved = fs::ensure_path_within_workspace(path)?;
            let offset = arguments["offset"].as_u64().map(|v| v as usize);
            let limit = arguments["limit"].as_u64().map(|v| v as usize);
            fs::read_file(&resolved.to_string_lossy(), offset, limit).await
        }
        "write_file" => {
            let path = arguments["path"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 path"))?;
            let resolved = fs::ensure_path_within_workspace(path)?;
            let content = arguments["content"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 content"))?;
            fs::write_file(&resolved.to_string_lossy(), content).await
        }
        "str_replace" => {
            let path = arguments["path"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 path"))?;
            let resolved = fs::ensure_path_within_workspace(path)?;
            let old_str = arguments["old_str"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 old_str"))?;
            let new_str = arguments["new_str"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 new_str"))?;
            fs::str_replace(&resolved.to_string_lossy(), old_str, new_str).await
        }
        "list_dir" => {
            let raw_path = arguments["path"].as_str().unwrap_or(".");
            let resolved = fs::ensure_path_within_workspace(raw_path)?;
            let resolved_str = resolved.to_string_lossy().to_string();
            let max_depth = arguments["max_depth"].as_u64().map(|v| v as usize);
            fs::list_dir(Some(resolved_str.as_str()), max_depth).await
        }
        "search_code" => {
            let pattern = arguments["pattern"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 pattern"))?;
            let raw_path = arguments["path"].as_str().unwrap_or(".");
            let resolved = fs::ensure_path_within_workspace(raw_path)?;
            let resolved_str = resolved.to_string_lossy().to_string();
            let max_results = arguments["max_results"].as_u64().map(|v| v as usize);
            fs::search_code(pattern, Some(resolved_str.as_str()), max_results).await
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

            let mcda_info = if let Some(mcda) = arguments.get("mcda_matrix").and_then(|v| v.as_object()) {
                let criteria_count = mcda.get("criteria").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                let alt_count = mcda.get("alternatives").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                format!("\n• 结构化 MCDA 运筹矩阵: {} 准则 × {} 方案", criteria_count, alt_count)
            } else {
                String::new()
            };

            Ok(format!(
                "✓ 【仲裁定案裁决书】已成功提交至宿主与 ADR 画布：\n• 裁决类型: {}\n• 核心决议: {}\n• 关键权衡点:\n{}\n• 约束安全爆炸半径文件: {}{}{}{}",
                decision_type,
                summary,
                formatted_points,
                if formatted_files.is_empty() { "无" } else { &formatted_files },
                solution_line,
                ruling_options_info,
                mcda_info
            ))
        }
        "submit_proposal_claims" => {
            let summary = arguments["summary"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow!("缺少非空必填参数 summary"))?;
            let claims = arguments["claims"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 claims 数组"))?;
            if claims.is_empty() || claims.len() > 8 {
                return Err(anyhow!(
                    "claims 数量必须在 1~8 条之间，当前为 {}",
                    claims.len()
                ));
            }
            let impacted_files = arguments["impacted_files"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 impacted_files 数组"))?;

            let mut formatted_claims = Vec::with_capacity(claims.len());
            for (idx, item) in claims.iter().enumerate() {
                let claim_id = item["claim_id"]
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| anyhow!("第 {} 条论点缺少非空 claim_id", idx + 1))?;
                let claim_text = item["claim"]
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| anyhow!("论点 [{}] 缺少非空 claim 描述", claim_id))?;
                let deps = item
                    .get("depends_on_claim_ids")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|d| d.as_str().map(str::trim))
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_default();
                let dep_badge = if deps.is_empty() {
                    String::new()
                } else {
                    format!(" (depends_on: {})", deps)
                };
                formatted_claims.push(format!("  • [{}] {}{}", claim_id, claim_text, dep_badge));
            }

            let files_str = impacted_files
                .iter()
                .filter_map(|v| v.as_str().map(str::trim))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(", ");

            Ok(format!(
                "✓ 【提案结构化论点与因果图】已成功提交：\n• 提案摘要: {}\n• 论点节点 ({} 项):\n{}\n• 拟修改文件: {}",
                summary,
                claims.len(),
                formatted_claims.join("\n"),
                if files_str.is_empty() { "无" } else { &files_str }
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
            if modules.is_empty() || modules.len() > 4 {
                return Err(anyhow!(
                    "G-Frame 模块化拆解要求模块数在 1~4 个之间，当前为 {}",
                    modules.len()
                ));
            }

            let formatted_modules = modules
                .iter()
                .map(|m| {
                    let id = m["module_id"].as_str().unwrap_or("mod");
                    let title = m["title"].as_str().unwrap_or("未命名模块");
                    let level = m["complexity_level"].as_str().unwrap_or("medium_standard");
                    let red_team = m["requires_red_team"]
                        .as_bool()
                        .map(|v| {
                            if v {
                                ", requires_red_team=true"
                            } else {
                                ", requires_red_team=false"
                            }
                        })
                        .unwrap_or("");
                    let routing_rationale = m["routing_rationale"]
                        .as_str()
                        .filter(|value| !value.trim().is_empty())
                        .map(|value| format!(", routing_rationale={}", value.trim()))
                        .unwrap_or_default();
                    format!(
                        "  • [{}] {} ({}{}{})",
                        id, title, level, red_team, routing_rationale
                    )
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
                    let claim_id = ev["claim_id"].as_str().map(|s| format!(" (claim: {})", s)).unwrap_or_default();
                    let tier = ev["tier"].as_str().map(|s| format!("[{}]", s)).unwrap_or_default();
                    let status_badge = if is_pass { "✓ PASS" } else { "✗ FAIL" };
                    format!("  {}. [{}{}] 来源: {}{} -> {}", i + 1, status_badge, tier, tool, claim_id, report)
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
        "submit_challenge_critique" => {
            let fatal_flaws = arguments["fatal_flaws"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 fatal_flaws 数组"))?;
            let hidden_assumptions = arguments["hidden_assumptions"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 hidden_assumptions 数组"))?;
            let failure_scenarios = arguments["failure_scenarios"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 failure_scenarios 数组"))?;
            let counter_demands = arguments["counter_demands"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 counter_demands 数组"))?;
            let summary = arguments["summary"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 summary"))?;
            let target_claim_id = arguments["target_claim_id"].as_str().unwrap_or("general_proposal");
            let root_cause_category = arguments["root_cause_category"].as_str().unwrap_or("general");
            let disputed_ids = arguments
                .get("disputed_claim_ids")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", "))
                .unwrap_or_default();
            let extra_meta = if disputed_ids.is_empty() {
                format!("\n• 根因分类: {}", root_cause_category)
            } else {
                format!("\n• 争议论点集: [{}]\n• 根因分类: {}", disputed_ids, root_cause_category)
            };

            if fatal_flaws.is_empty() || hidden_assumptions.is_empty() || failure_scenarios.is_empty() || counter_demands.is_empty() {
                return Err(anyhow!("红队四部曲门禁未满足：fatal_flaws, hidden_assumptions, failure_scenarios, counter_demands 均不能为空"));
            }

            Ok(format!(
                "✓ 【红队反例质询与四部曲门禁】已成功上报并锁定争议焦点：\n• 靶向论点: [{}]{}\n• 核心质询结论: {}\n• 致命缺陷 ({} 项): {}\n• 隐含假设 ({} 项): {}\n• 失效场景 ({} 项): {}\n• 实证补丁要求 ({} 项): {}",
                target_claim_id,
                extra_meta,
                summary,
                fatal_flaws.len(),
                fatal_flaws.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("; "),
                hidden_assumptions.len(),
                hidden_assumptions.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("; "),
                failure_scenarios.len(),
                failure_scenarios.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("; "),
                counter_demands.len(),
                counter_demands.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("; ")
            ))
        }
        "submit_defense_patch" => {
            let summary = arguments["summary"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow!("缺少非空必填参数 summary"))?;
            let stance = arguments["stance"]
                .as_str()
                .ok_or_else(|| anyhow!("缺少必填参数 stance"))?;
            if !matches!(
                stance,
                "uphold_with_patch"
                    | "partial_concession_with_patch"
                    | "reject_critique_with_proof"
                    | "full_surrender_without_patch"
            ) {
                return Err(anyhow!(
                    "stance 必须为 uphold_with_patch | partial_concession_with_patch | reject_critique_with_proof | full_surrender_without_patch"
                ));
            }
            let patched_claims = arguments["patched_claims"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 patched_claims 数组"))?;
            if patched_claims.is_empty() {
                return Err(anyhow!("patched_claims 不能为空，必须至少回应一条质询论点"));
            }
            let defense_patches = arguments["defense_patches"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 defense_patches 数组"))?;
            let impacted_files = arguments["impacted_files"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 impacted_files 数组"))?;

            if stance == "full_surrender_without_patch" && defense_patches.is_empty() {
                return Err(anyhow!(
                    "违反 Free-MAD 抗妥协契约 (surrender_detected=true)：禁止未提供任何 defense_patches 即提交 full_surrender_without_patch"
                ));
            }

            let patch_list = defense_patches
                .iter()
                .filter_map(|v| v.as_str().map(str::trim))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("; ");
            let files_list = impacted_files
                .iter()
                .filter_map(|v| v.as_str().map(str::trim))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(", ");

            Ok(format!(
                "✓ 【答辩修正立场与补丁方案】已成功提交：\n• 立场状态: {}\n• 核心答辩结论: {}\n• 回应论点数: {}\n• 架构补丁: {}\n• 涉及文件: {}",
                stance,
                summary,
                patched_claims.len(),
                if patch_list.is_empty() { "无" } else { &patch_list },
                if files_list.is_empty() { "无" } else { &files_list }
            ))
        }
        "validate_workspace_diff" => {
            let raw_patches = arguments["patches"]
                .as_array()
                .ok_or_else(|| anyhow!("缺少必填参数 patches 数组"))?;
            let mut patches = Vec::new();
            for p in raw_patches {
                let filename = p["filename"]
                    .as_str()
                    .ok_or_else(|| anyhow!("patch 项缺少 filename"))?
                    .to_string();
                let diff = p["diff"]
                    .as_str()
                    .ok_or_else(|| anyhow!("patch 项缺少 diff"))?
                    .to_string();
                patches.push(fs::PatchItem { filename, diff });
            }

            let allowed_files: Option<Vec<String>> = arguments
                .get("allowed_files")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

            fs::validate_workspace_diff(&patches, allowed_files.as_deref()).await
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
        assert!(names.contains(&"submit_proposal_claims"));
        assert!(names.contains(&"submit_role_concurrence"));
        assert!(names.contains(&"submit_module_decomposition"));
        assert!(names.contains(&"submit_grounding_evidence"));
        assert!(names.contains(&"submit_execution_deliverable"));
        assert!(names.contains(&"submit_challenge_critique"));
        assert!(names.contains(&"submit_defense_patch"));
        assert!(names.contains(&"validate_workspace_diff"));

        let decomposition = arr
            .iter()
            .find(|tool| tool["name"] == "submit_module_decomposition")
            .expect("submit_module_decomposition must exist");
        assert_eq!(
            decomposition["inputSchema"]["properties"]["modules"]["minItems"],
            json!(1)
        );
        assert_eq!(
            decomposition["inputSchema"]["properties"]["modules"]["maxItems"],
            json!(4)
        );
        assert!(
            decomposition["inputSchema"]["properties"]["modules"]["items"]["properties"]
                .get("requires_red_team")
                .is_some()
        );
        assert!(
            decomposition["inputSchema"]["properties"]["modules"]["items"]["properties"]
                .get("routing_rationale")
                .is_some()
        );
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
    async fn test_dispatch_tool_call_submit_single_module_decomposition() {
        let args = json!({
            "shared_contract": {
                "summary": "单一静态页交付",
                "type_signatures": "",
                "invariants": ["只允许修改 demo/index.html"]
            },
            "modules": [
                {
                    "module_id": "only-module",
                    "title": "单文件静态页",
                    "responsibility": "创建单一静态页面",
                    "allowed_files": ["demo/index.html"],
                    "depends_on": [],
                    "complexity_level": "low_deterministic",
                    "requires_red_team": false,
                    "routing_rationale": "单文件确定性交付，无需红队深潜"
                }
            ]
        });
        let res = dispatch_tool_call("submit_module_decomposition", &args)
            .await
            .unwrap();
        assert!(res.contains("原子模块切片 (1 个)"));
        assert!(res.contains("requires_red_team=false"));
        assert!(res.contains("routing_rationale=单文件确定性交付，无需红队深潜"));
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_submit_module_decomposition_rejects_empty_and_over_limit() {
        let base = json!({
            "shared_contract": {
                "summary": "边界测试",
                "type_signatures": "",
                "invariants": []
            }
        });
        let empty_args = {
            let mut value = base.clone();
            value["modules"] = json!([]);
            value
        };
        assert!(
            dispatch_tool_call("submit_module_decomposition", &empty_args)
                .await
                .is_err(),
            "空模块数组必须被拒绝"
        );

        let five_args = {
            let mut value = base;
            value["modules"] = json!(
                (1..=5)
                    .map(|idx| json!({
                        "module_id": format!("mod-{}", idx),
                        "title": format!("模块 {}", idx),
                        "responsibility": "边界测试",
                        "allowed_files": [],
                        "depends_on": [],
                        "complexity_level": "low_deterministic"
                    }))
                    .collect::<Vec<_>>()
            );
            value
        };
        assert!(
            dispatch_tool_call("submit_module_decomposition", &five_args)
                .await
                .is_err(),
            "超过 4 个模块必须被拒绝"
        );
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

    #[tokio::test]
    async fn test_dispatch_tool_call_submit_challenge_critique() {
        let args = json!({
            "target_claim_id": "node-1-schema",
            "fatal_flaws": ["全局锁并发死锁", "无递增消息 ID 导致脑裂"],
            "hidden_assumptions": ["假设网络零延迟", "假设单实例无竞争"],
            "failure_scenarios": ["跨地域 200ms 抖动时超时", "GC 暂停导致租约失效"],
            "counter_demands": ["提供带 ID 的优雅退出单测", "提供 Jepsen 网络分区验证用例"],
            "summary": "原单点代理方案在断网时存在孤儿僵尸进程风险，必须引入超时强杀防御补丁"
        });
        let res = dispatch_tool_call("submit_challenge_critique", &args).await.unwrap();
        assert!(res.contains("✓ 【红队反例质询与四部曲门禁】已成功上报"));
        assert!(res.contains("node-1-schema"));
        assert!(res.contains("全局锁并发死锁"));
        assert!(res.contains("致命缺陷 (2 项)"));
        assert!(res.contains("实证补丁要求 (2 项)"));
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_validate_workspace_diff() {
        let temp_dir = std::env::temp_dir().join("shadow_crew_dispatch_diff_test");
        let _ = tokio::fs::create_dir_all(&temp_dir).await;
        let test_file = temp_dir.join("sample.txt");
        let _ = tokio::fs::write(&test_file, "line1\nline2\nline3\n").await;

        let sample_path = test_file.to_str().unwrap();

        let args = json!({
            "patches": [
                {
                    "filename": sample_path,
                    "diff": "--- a/sample.txt\n+++ b/sample.txt\n@@ -1,3 +1,4 @@\n line1\n+added_line\n line2\n line3\n"
                }
            ],
            "allowed_files": [sample_path]
        });

        let res = dispatch_tool_call("validate_workspace_diff", &args).await.unwrap();
        assert!(res.contains("【工作区补丁 Dry-Run 预检报告】"));
        assert!(res.contains("预检通过 (All Clean)"));
        assert!(res.contains("Clean: 1"));

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_submit_proposal_claims() {
        let args = json!({
            "summary": "引入基于 WAL 的幂等消息投递与隔离沙箱边界",
            "claims": [
                {
                    "claim_id": "claim-1",
                    "claim": "使用单调递增 seq_id 消除并发乱序覆盖",
                    "assumptions": ["单分片内 seq_id 单调严格递增"],
                    "depends_on_claim_ids": [],
                    "confidence": 0.9
                },
                {
                    "claim_id": "claim-2",
                    "claim": "基于 WAL 日志实现 3s 超时故障恢复",
                    "depends_on_claim_ids": ["claim-1"],
                    "confidence": 0.85
                }
            ],
            "impacted_files": ["src/services/acpClient.ts", "src/hooks/useGameTheoreticFsm.ts"]
        });
        let res = dispatch_tool_call("submit_proposal_claims", &args).await.unwrap();
        assert!(res.contains("✓ 【提案结构化论点与因果图】已成功提交"));
        assert!(res.contains("claim-1"));
        assert!(res.contains("depends_on: claim-1"));

        let empty_claims = json!({
            "summary": "无效空提案",
            "claims": [],
            "impacted_files": []
        });
        assert!(
            dispatch_tool_call("submit_proposal_claims", &empty_claims)
                .await
                .is_err(),
            "空 claims 数组必须被拒绝"
        );
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_submit_defense_patch() {
        let valid_args = json!({
            "summary": "保留主干递增 seq_id 机制并增补超时 fenced 租约补丁",
            "stance": "partial_concession_with_patch",
            "patched_claims": [
                {
                    "claim_id": "claim-1",
                    "resolution": "增加 fencing token 校验防止跨机房脑裂覆盖",
                    "status": "resolved"
                }
            ],
            "defense_patches": ["新增 FencingTokenGuard 校验，超时 <= 300ms 自动释放"],
            "quantified_metrics": ["lease_timeout <= 300ms"],
            "impacted_files": ["src/services/acpClient.ts"],
            "alignment_score": 0.88
        });
        let res = dispatch_tool_call("submit_defense_patch", &valid_args)
            .await
            .unwrap();
        assert!(res.contains("✓ 【答辩修正立场与补丁方案】已成功提交"));
        assert!(res.contains("partial_concession_with_patch"));

        let surrender_args = json!({
            "summary": "我完全同意红队的说法，原方案彻底作废",
            "stance": "full_surrender_without_patch",
            "patched_claims": [
                {
                    "claim_id": "claim-1",
                    "resolution": "放弃原主张",
                    "status": "conceded"
                }
            ],
            "defense_patches": [],
            "impacted_files": []
        });
        assert!(
            dispatch_tool_call("submit_defense_patch", &surrender_args)
                .await
                .is_err(),
            "无补丁全盘认怂必须被工具门禁拦截"
        );
    }

    #[test]
    fn test_tools_list_annotations() {
        let list = get_tools_list();
        let arr = list.as_array().expect("tools list must be array");
        let governance_tools = [
            "submit_arbitration_ruling",
            "submit_proposal_claims",
            "submit_role_concurrence",
            "submit_module_decomposition",
            "submit_grounding_evidence",
            "submit_execution_deliverable",
            "submit_challenge_critique",
            "submit_defense_patch",
            "validate_workspace_diff",
        ];
        for tool_name in governance_tools {
            let tool = arr
                .iter()
                .find(|t| t["name"] == tool_name)
                .unwrap_or_else(|| panic!("missing governance tool {}", tool_name));
            assert_eq!(tool["annotations"]["readOnlyHint"], json!(true));
            assert_eq!(tool["annotations"]["destructiveHint"], json!(false));
            assert_eq!(tool["annotations"]["idempotentHint"], json!(true));
            assert_eq!(tool["annotations"]["openWorldHint"], json!(false));
        }

        let write_tool = arr.iter().find(|t| t["name"] == "write_file").unwrap();
        assert_eq!(write_tool["annotations"]["readOnlyHint"], json!(false));
        assert_eq!(write_tool["annotations"]["destructiveHint"], json!(false));
    }

    #[tokio::test]
    async fn test_governance_only_profile_hides_and_blocks_base_fs_shell_tools() {
        let gov_tools = get_tools_list_for_profile(DevMcpProfile::GovernanceOnly);
        let names: Vec<&str> = gov_tools
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t["name"].as_str())
            .collect();

        for base_tool in ["shell", "read_file", "write_file", "str_replace", "list_dir", "search_code"] {
            assert!(
                !names.contains(&base_tool),
                "governance_only profile must hide base tool {}",
                base_tool
            );
            let err = dispatch_tool_call_with_profile(
                base_tool,
                &json!({ "path": "/etc/passwd", "command": "ls", "pattern": "x", "content": "y", "old_str": "a", "new_str": "b" }),
                DevMcpProfile::GovernanceOnly,
            )
            .await
            .expect_err("governance_only profile must reject base tool execution");
            assert!(err.to_string().contains("governance_only"));
        }

        for expected in ["write_channel_artifact", "write_agent_artifact", "validate_workspace_diff", "submit_arbitration_ruling"] {
            assert!(
                names.contains(&expected),
                "governance_only profile must retain {}",
                expected
            );
        }
    }
}

