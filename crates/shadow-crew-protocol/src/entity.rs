use serde::{Deserialize, Serialize};

/// 项目实体 (顶级工作空间边界)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectEntity {
    pub id: String,
    pub name: String,
    pub description: String,
    pub repo_url: Option<String>,
    pub local_workspace_root: String,
    pub assigned_agent_pubkeys: Vec<String>,
    pub created_at: u64,
}

/// 频道分类 (功能特性 / 需求分析 / 具体任务)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    Feature,     // 功能特性 (如 feat/auth)
    Requirement, // 需求分析与 PRD 研讨
    Task,        // 缺陷排查或具体任务 (如 task/fix-leak)
}

/// 频道生命周期状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChannelStatus {
    Active,   // 正常活跃
    Archived, // 已归档只读
    Deleted,  // 已删除
}

/// 频道实体 (受邀准入制与完整生命周期)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelEntity {
    pub id: String,
    pub project_id: String,
    pub creator_pubkey: String,           // 创建者公钥 (拥有 Owner 权限)
    pub name: String,
    pub kind: ChannelKind,
    pub status: ChannelStatus,
    pub description: String,
    pub active_git_branch: Option<String>,
    pub member_pubkeys: Vec<String>,      // 成员列表 (默认初始仅为 [creator_pubkey])
    pub is_private: bool,                 // 默认为 true (受邀准入)
    pub created_at: u64,
    pub deleted_at: Option<u64>,
}

/// Topic 议题状态机
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TopicStatus {
    Open,          // 待研讨
    Investigating, // 正在推演
    Resolved,      // 已达成共识并解决
    Archived,      // 已归档
}

/// 结构化消息实体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMessage {
    pub id: String,
    pub project_id: String,
    pub channel_id: String,
    pub pubkey: String,
    pub author_name: String,
    pub is_agent: bool,
    pub content: String,
    pub is_topic_head: bool,
    pub topic_title: Option<String>,
    pub topic_status: Option<TopicStatus>,
    pub thread_root_id: Option<String>,
    pub consensus_summary: Option<String>,
    pub created_at: u64,
    pub sig: String,
}
