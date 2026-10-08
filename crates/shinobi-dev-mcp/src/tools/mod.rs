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
            "description": "将正式技术产物 (如 ADR 架构决策文档、推演方案白皮书、关键补丁 diff) 永久归档至当前频道专属产物目录 (~/.shinobi/channels/<channel_id>/artifacts/)。可被系统访达一键查看。",
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
        unknown => Err(anyhow!("未知的 MCP 工具名称: {}", unknown)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tools_list_schema() {
        let list = get_tools_list();
        let arr = list.as_array().expect("tools list must be array");
        assert!(arr.len() >= 7);
        let names: Vec<&str> = arr.iter().filter_map(|t| t["name"].as_str()).collect();
        assert!(names.contains(&"shell"));
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&"write_file"));
        assert!(names.contains(&"str_replace"));
        assert!(names.contains(&"list_dir"));
        assert!(names.contains(&"search_code"));
        assert!(names.contains(&"write_channel_artifact"));
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
        let temp_dir = std::env::temp_dir().join("shinobi_dispatch_test_art");
        std::env::set_var("SHINOBI_HOME", &temp_dir);

        let args = json!({
            "filename": "test_dispatch_adr.md",
            "content": "# Test Dispatch ADR",
            "channel_id": "test-dispatch-chan"
        });
        let res = dispatch_tool_call("write_channel_artifact", &args).await.unwrap();
        assert!(res.contains("test_dispatch_adr.md"));

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }
}

