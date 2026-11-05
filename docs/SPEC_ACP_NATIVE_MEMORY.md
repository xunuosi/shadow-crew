# Shadow Crew ACP 原生记忆能力规范

> 状态：已实现  
> 范围：本地 stdio ACP 与远程 ACP 的能力声明、Agent 策略、运行时状态展示  
> 非目标：由 Shadow Crew 代替端点召回、写入、压缩或迁移长期记忆

## 1. 设计边界

ACP 协议本身不定义统一的长期记忆存储格式。Shadow Crew 采用“端点原生记忆优先”模型：

1. 长期记忆的持久化、召回、自动提炼与删除均由 ACP 端点负责。
2. Shadow Crew 只传递显式策略、展示端点声明，并提供可复测的状态。
3. 清理 ACP Session、重启 Shadow Crew 或切换议题不得删除端点长期记忆。
4. 端点未声明能力时状态为 `unknown`，不得推断为支持。
5. 当前实现不向 Prompt 注入 Shadow Crew 自建长期记忆，避免与端点原生 Memory 重复。

端点原生记忆通常按 ACP Runtime 隔离，而不是按 Shadow Crew 的 Agent UI 实例隔离。多个 Agent 共用同一 `CODEX_HOME` 时可能读取同一份 Codex Memory；需要独立记忆时必须配置独立运行目录或独立端点。

## 2. Agent 配置

`AgentMemoryBank` 使用显式版本和策略：

```ts
interface AgentMemoryBank {
  schemaVersion: 1;
  mode: 'native' | 'disabled';
  autoGenerate: boolean;
  nativeCapability: {
    status: 'unknown' | 'enabled' | 'disabled' | 'unsupported';
    persistent?: boolean | null;
    crossThread?: boolean | null;
    provider?: string | null;
    scope?: 'agent' | 'workspace' | 'runtime' | 'unknown' | null;
    detail?: string | null;
    lastCheckedAt?: number;
  };
}
```

- `native`：允许适配器启用端点原生长期记忆。
- `disabled`：明确禁用；支持该策略的适配器不仅不得启用原生 Memory，还必须显式覆盖用户级全局配置。
- `autoGenerate`：是否允许端点从历史对话自动提炼记忆；默认关闭，显式 memory 工具写入不受影响。
- 旧 Agent 数据通过 `migrateAgentMemoryV1()` 集中迁移，不在 UI 或业务逻辑中散落字段回退。

## 3. ACP 能力扩展

Agent 在 `initialize` 响应中使用以下可选扩展：

```json
{
  "agentCapabilities": {
    "nativeMemory": {
      "supported": true,
      "enabled": true,
      "persistent": true,
      "crossThread": true,
      "scope": "runtime",
      "provider": "codex-memories",
      "detail": "optional diagnostic text"
    }
  }
}
```

状态判定：

| `supported` | `enabled` | Shadow Crew 状态 |
| --- | --- | --- |
| `false` | 任意 | `unsupported` |
| `true` | `false` | `disabled` |
| `true` | `true` | `enabled` |
| 缺失/非法 | 缺失/非法 | `unknown` |

## 4. 本地进程策略传递

Shadow Crew 拉起本地 ACP 进程时注入：

```text
SHADOW_CREW_ACP_NATIVE_MEMORY=1|0
SHADOW_CREW_ACP_NATIVE_MEMORY_AUTO_GENERATE=1|0
```

该变量只表达 Agent 配置策略，不构成“端点已经具备长期记忆”的结论。适配器必须结合自身能力探测后，在 `initialize` 中声明结果。

每次 `session/prompt` 同时携带策略元数据，供本地与远程适配器统一读取：

```json
{
  "_meta": {
    "shadowCrew": {
      "nativeMemory": {
        "enabled": true,
        "autoGenerate": false
      }
    }
  }
}
```

## 5. Codex ACP 适配器

`bin/codex-acp` 的映射：

| 环节 | 行为 |
| --- | --- |
| 能力探测 | 有界重试执行 `codex --enable memories features list`；成功输出判定 `supported`，连续探测异常返回 `unknown`，不得伪装为 `unsupported` |
| 策略开启 | 传入 `--enable memories` |
| 召回策略 | 传入 `-c memories.use_memories=true` |
| 自动提炼 | 传入 `-c memories.generate_memories=true\|false`，由 Agent 配置决定 |
| 专用工具 | 传入 `-c memories.dedicated_tools=true` |
| 显式禁用 | 传入 `--disable memories`、`features.memories=false` 及 `use/generate/dedicated=false` |
| 工具召回 | 通过 Codex 原生 memory/read/search/ad_hoc_note 工具完成 |
| 会话持久化 | 沿用 `codex exec resume <thread_id>`；不影响跨线程 Memory |
| 测试隔离 | 支持 `SHADOW_CREW_HOME` 覆盖 ACP Session 缓存目录 |

自动提炼任务是否可用取决于当前 Codex 模型提供方。即使自动 consolidation 被提供方限制，显式 native memory 工具写入与新线程召回仍是可测试的主链路。

## 6. 运行时链路

```text
AgentMemoryBank.mode
  -> buildAgentLaunchEnv()
  -> AcpProcessManager.spawn_agent()
  -> ACP initialize
  -> agentCapabilities.nativeMemory
  -> AcpNativeMemoryCapability
  -> get_agents_runtime_status()
  -> App 每 3 秒同步
  -> AcpInspector / ConnectAgentModal 展示
```

关键文件：

- `src/services/agentMemory.ts`：版本迁移、能力解析、默认策略
- `src/services/acpClient.ts`：本地启动策略环境变量、远程握手能力解析
- `src-tauri/src/acp_manager.rs`：`initialize` 能力解析与运行态返回
- `bin/codex-acp`：Codex 原生 Memory 能力探测与 CLI 参数映射
- `src/components/ConnectAgentModal.tsx`：Agent 原生记忆开关
- `src/components/AcpInspector.tsx`：能力、提供方、持久化/跨线程状态展示

## 7. 验收用例

| ID | 场景 | 预期 |
| --- | --- | --- |
| NM-01 | 旧 Agent JSON 加载 | 一次性迁移为 `schemaVersion=1`，策略为 `native`，能力为 `unknown` |
| NM-02 | native 模式启动支持 memories 的 Codex | 握手声明 `enabled`，CLI 参数包含三项 memories 配置 |
| NM-03 | disabled 模式启动 | 能力可判定时握手声明 `disabled`，Prompt 子进程收到 `--disable memories` 与 `use/generate/dedicated=false` 显式覆盖 |
| NM-04 | 用户伪造 `SHADOW_CREW_ACP_NATIVE_MEMORY` ENV | 宿主策略覆盖用户值，结果与 Agent 开关一致 |
| NM-05 | 端点缺少扩展 | Rust/前端均显示 `unknown`，不宣称支持 |
| NM-06 | 同一 Codex 会话第二轮 | 使用 `resume <thread_id>`，Session 上下文连续 |
| NM-07 | 真实 Codex 新 ACP Session | 通过原生 memory 工具召回另一线程写入的 canary |
| NM-08 | 清理 ACP Session | 仅清理会话映射，不删除端点 memories |
| NM-09 | 重启 Shadow Crew | 能力重新握手；端点长期记忆不依赖宿主持久化 |
| NM-10 | 初始化首次与 lazy retry 均超时 | 始终保持 `initialized=false`，后续 Prompt 可再次重试 |
| NM-11 | 用户全局配置启用 memories，Agent 设置为 disabled | Codex 子进程收到显式 disable/false 参数 |
| NM-12 | 远程 Agent 启动/停止/编辑/删除发生 probe 竞态 | generation 失效旧结果；仅最新操作可更新运行态 |
| NM-13 | 远程 Agent 断线 | 独立健康租约在超时后回落 `error + unknown` |
| NM-14 | Codex 特性探测临时失败 | 单次 `initialize` 内有界重试；持续失败上报 `unknown`，后续请求可再次探测且不缓存失败结论；一旦 `session/prompt` 重试探测成功，响应同步回写 `agentCapabilities.nativeMemory` 供宿主更新状态 |
| NM-15 | SSR/内嵌首帧主题 | 亮色与暗色均可通过显式初始主题确定性渲染，不依赖浏览器 `document` |
| NM-16 | 本地退出事件与弹窗保存门控 | 本地进程退出（`acp:status_change=stopped`）及 3s 轮询对账无条件清理残留 `enabled` 能力；新建/离线/本地重启或远程复测失败保存时一律回落 `unknown + canUseInternalMemory=false` |
| NM-17 | 新启动与 starting 收敛 | 进入 `starting` 时立即失效上一轮 native memory 与 load/resume 握手结果；`spawn_acp_agent` 返回后若后端已无存活实例，starting 必须收敛为 `idle + unknown`，不得因事件丢失永久卡住 |
