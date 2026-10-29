# Shadow Crew ACP-only 与私聊 Topic 测试报告

> **执行日期**：2026-10-29（Asia/Shanghai）
> **结论**：自动化基线、专项回归、生产构建与浏览器运行期检查通过。
> **关联方案**：
> - [`TECH_SPEC_ACP_ONLY_RUNTIME.md`](./TECH_SPEC_ACP_ONLY_RUNTIME.md)
> - [`TECH_SPEC_DM_TOPICS.md`](./TECH_SPEC_DM_TOPICS.md)
> - [`TECH_SPEC_TOPIC_CWD_ISOLATION.md`](./TECH_SPEC_TOPIC_CWD_ISOLATION.md)

---

## 1. 交付结论

本轮交付包含两条主线：

1. Shadow Crew 不再包含自研内置 Agent 执行运行时。Agent 推理、工具循环、Session 压缩和长期 Memory 均由本地或远程 ACP 端点负责；软件自身的全局模型配置继续保留，供应用内部摘要、抽取和分析调用。
2. 私聊支持普通 Topic 与双方博弈 Topic。双方博弈固定为“提案方 + 对抗方”，人类和当前私聊 Agent 各占一方；DM 主会话与每个 DM Topic 使用独立 ACP Session 和 cwd。

### 1.1 Session 与 CWD 结论

- ACP 的 `cwd` 属于 Session 创建语义；协议没有标准化的 `session/set_cwd`。
- Shadow Crew 不为旧 Session 原地切换 cwd，而是通过不同 Session Key 建立新 Session。
- DM 主会话：

```text
~/.shadow-crew/agents/<agentId>/
```

- DM Topic：

```text
~/.shadow-crew/agents/<agentId>/topics/<topicId>/
~/.shadow-crew/agents/<agentId>/topics/<topicId>/artifacts/
```

- DM Topic Session Key：

```text
dmtopic:{agentId}:{topicId}:{discussionMode}:ws-{workspaceBindingId}
```

- 同一 Agent 进入不同 Channel、Topic 或 DM 时，Shadow Crew 使用不同 Session Key、Workspace Binding 与 ACP Session；不会复用同一个已绑定其他 cwd 的 Session。

---

## 2. 本轮自检发现并修复的问题

| 问题 | 影响 | 修复结果 |
| :--- | :--- | :--- |
| Vite 开发态仍注入 `shinobi_core` 内置 Agent 预设 | Web 开发模式可能重新显示已删除的内置 Agent | 删除预设与特判；ACP-only 回归测试扫描并锁定 |
| Rust Host 未按 Topic Binding 解析 `scopeType=dm_topic` | UI 可创建 DM Topic，但真实 ACP Prompt 会被误判为 Channel Binding | Host 显式分流 DM 主会话 / DM Topic；缺失 Binding Fail-Closed |
| 编辑 DM Topic 时成员 memo 未依赖 `editingTopic` | 从私聊打开编辑弹窗时可能显示“0 位 Agent” | 补齐依赖；运行期确认显示 `1 / 1` |
| 编辑 DM Topic 仍可能进入 4+1 多角色配置 | 破坏“仅提案方 + 对抗方”的业务约束 | 编辑弹窗改为双方角色互换，不提供 Verifier / Agent 仲裁官 |
| 两项旧 Session 屏障测试仍期待无 ACP 时模拟成功 | 删除 fallback 后出现误报 | 改为验证“进入 ACP 派发路径 + 无通道时显式失败 + Session 仍登记” |

---

## 3. 自动化验证

### 3.1 基础质量门禁

| 检查 | 命令 | 结果 |
| :--- | :--- | :--- |
| TypeScript 类型检查 | `npm run lint` | ✅ 通过 |
| Vite 生产构建 | `npm run build` | ✅ 通过，2008 modules transformed |
| Rust 全工作区测试 | `cargo test --workspace` | ✅ Desktop 22/22；Dev MCP 9/9 |
| Diff 空白与冲突标记 | `git diff --check` | ✅ 通过 |

### 3.2 功能专项回归

| 套件 | 命令 | 结果 |
| :--- | :--- | :--- |
| ACP-only 执行面 | `node --import tsx src/services/test-acp-only-runtime.ts` | ✅ 9 项断言通过 |
| DM Topic / 双方角色 | `node --import tsx src/services/test-dm-topics.ts` | ✅ 20/20 断言通过 |
| Workspace Binding | `node --import tsx src/services/test-workspace-bindings.ts` | ✅ 通过 |
| 普通模式 Buzz 编排 | `node --import tsx src/services/test-normal-mode-buzz-orchestration.ts` | ✅ 54/54 通过 |
| 应用内部 LLM 压缩治理 | `node --import tsx src/services/test-llm-compaction-governance.ts` | ✅ 140/140 通过 |
| Mention 边界 | `node --import tsx src/services/test-mention-resolution.ts` | ✅ 13/13 通过 |
| CognoNexus 主基线 | `npm run test:cogno` | ✅ 全套通过 |
| G-Frame 边界探测 | `node --import tsx src/services/cogno/test-gframe-edge-cases.ts` | ✅ DEFECT 0 / WARN 0 |

`npm run test:cogno` 包含：

- 18/18 核心 Token 控制与趋真机制断言；
- Wave 1 闭环；
- Wave 2 谄媚治理与模型多样性；
- Wave 3 Claim DAG / SPRT / ColMAD；
- BWM 黄金算例；
- G-Frame 14/14；
- Adaptive SPRT 5/5。

说明：`cargo fmt --check` 不是本仓库当前的可通过基线，会报告大量未触碰文件的既有格式差异。本轮未执行全仓库机械格式化，以免污染无关改动；新增 Rust 代码已通过编译和全工作区测试。

---

## 4. 运行期浏览器验证

验证地址：`http://localhost:3035/`

| 用例 | 操作 | 实际结果 |
| :--- | :--- | :--- |
| UI-01 私聊入口 | 打开与 ACP Agent 的私聊 | Header 与 Composer 均出现“新建议题” |
| UI-02 普通 DM Topic | 创建标准私聊 Topic | 创建成功，抽屉显示独立 CWD |
| UI-03 默认路径 | 查看普通 DM Topic 的只读 CWD | 精确显示 `~/.shadow-crew/agents/<agentId>/topics/<topicId>` |
| UI-04 编辑弹窗 | 在私聊 Topic 抽屉打开编辑 | 显示“私聊 Topic”，ACP Agent 为 `1 / 1` |
| UI-05 博弈角色 | 切换双方博弈模式 | 仅出现两组互斥选项：人类提案 / Agent 对抗、Agent 提案 / 人类对抗 |
| UI-06 角色持久化 | 选择“Agent 提案 / 人类对抗”并保存 | 卡片、抽屉角色卡与四阶段条同步更新 |
| UI-07 刷新恢复 | 刷新整个页面 | Topic、模式、角色和 CWD 保持稳定 |
| UI-08 离线防护 | Agent 未启动时在 DM Topic 发送消息 | 显示 ACP 未连接 Guard，不产生模拟 Agent 回答 |

---

## 5. 人工复测用例

### 5.1 前置条件

1. 执行 `npm install`。
2. 开发调试执行 `npm run dev`；真实本地 ACP 测试执行 `npm run dev:desktop`。
3. 至少准备一个可启动的本地 ACP 或远程 ACP 端点。
4. 如需验证全局模型配置，在 Agents 页面打开全局默认值设置。

### 5.2 ACP-only

| ID | 步骤 | 预期 |
| :--- | :--- | :--- |
| ACP-01 | 打开 Agents Dashboard 和“连接 Agent” | 不存在 Shadow Crew Native / Shinobi Core 预设 |
| ACP-02 | 检查 Agent 编辑弹窗 | 只有 ACP 命令、参数、ENV、远程 URL 等连接配置；没有 Agent 底座模型配置 |
| ACP-03 | 打开全局模型配置 | 仍可配置 Provider、模型、Key、Base URL、上下文与推理参数 |
| ACP-04 | Agent 保持 idle，直接发送消息 | 明确提示先 Start ACP；不调用全局模型代答 |
| ACP-05 | 浏览器环境且无远程 ACP，向运行态 Agent 发 Prompt | 返回“当前运行环境未提供 ACP 调用通道”；无模拟回答 |
| ACP-06 | 启动本地 ACP 后发送普通 DM | 能收到 ACP 真实流式回复 |
| ACP-07 | 配置远程 `ws://` / `wss://` ACP 后发送消息 | 请求携带 `scopeType`、`workspaceBindingId`、`workspaceUri` |
| ACP-08 | 连续多轮复用同一 ACP Session | Shadow Crew 不注入 `<compacted-summary>`、不注入外挂 Memory；压缩和长期记忆由 ACP 端点决定 |

### 5.3 DM Topic 与 CWD

| ID | 步骤 | 预期 |
| :--- | :--- | :--- |
| DM-01 | 私聊 Header 点击“新建议题” | 打开私聊 Topic 弹窗，不要求 Channel |
| DM-02 | 使用默认 CWD 创建普通 Topic | 路径为 `~/.shadow-crew/agents/<agentId>/topics/<topicId>/` |
| DM-03 | 查看 Topic Binding / CWD | 显示“只读绑定”；没有修改 cwd 的入口 |
| DM-04 | 创建第二个普通 Topic | 两个 Topic 的 cwd、Session Key、artifacts 路径均不同 |
| DM-05 | 在 DM 主会话发送消息 | 使用 Agent 根目录，不复用任一 Topic Session |
| DM-06 | 在两个 Topic 间切换发送消息 | ACP Prompt 的 cwd 分别对应各自 Binding，互不串目录 |
| DM-07 | 删除或更新 Topic 模式/角色 | 只清理 `dmtopic:<agentId>:<topicId>` 下的 Session |
| DM-08 | 创建自定义 cwd Topic | 创建后不可编辑；产物归档到该 Binding 的 artifactRoot |
| DM-09 | 刷新桌面应用或页面 | Topic、角色、Session 映射和 cwd 恢复一致 |

### 5.4 私聊双方博弈

| ID | 步骤 | 预期 |
| :--- | :--- | :--- |
| DUEL-01 | 创建博弈 Topic，选择“我提案 / Agent 对抗” | 角色卡显示人类提案、Agent 对抗 |
| DUEL-02 | 创建博弈 Topic，选择“Agent 提案 / 人类对抗”反向组合 | 角色卡显示 Agent 提案、人类对抗 |
| DUEL-03 | 编辑既有 DM 博弈 Topic | 仅能在前述两种组合间切换，不能选择 Verifier 或 Agent 仲裁官 |
| DUEL-04 | 人类提案后发送首条立论 | Agent 以对抗方身份质询 |
| DUEL-05 | Agent 提案后发送首轮消息 | Agent 以提案方身份立论，人类进行质询与最终决策 |
| DUEL-06 | 检查阶段条 | 显示“提案立论 → 对抗质询 → 提案方回应 → 人类决策” |
| DUEL-07 | 检查 Channel 4+1 | Channel Topic 的 4+1 配置不受 DM 双方博弈改动影响 |

### 5.5 数据与清理

| ID | 步骤 | 预期 |
| :--- | :--- | :--- |
| ISO-01 | 比较 DM 主键与 DM Topic Key | 前缀分别为 `dm:` 与 `dmtopic:` |
| ISO-02 | 比较两个 DM Topic Key | Topic ID、模式或 Binding 不同，Key 不相同 |
| ISO-03 | 解析形如 `dmtopic:a:b:standard` 的 Key | 可解析，但不含 Binding |
| ISO-04 | 解析多段畸形 Key | 回退 `legacy`，绝不截断成合法 Key |
| ISO-05 | DM Topic 缺少 Workspace Binding 时派发 | Host Fail-Closed，不按 Agent 根目录兜底 |
| ISO-06 | 停止某个 Agent | 清理其 `dm:` 与 `dmtopic:` 前缀，不影响其他 Agent |

---

## 6. 已知边界

1. 本轮运行期验证使用浏览器 UI 与模拟数据，真实本地/远程 ACP 端到端回复仍需要用户提供的 ACP CLI 或 WebSocket 服务复测。
2. ACP 是否自动压缩上下文、是否保留长期 Memory、是否支持 Session resume/load，由具体 ACP 端点能力决定。
3. Shadow Crew 不提供同一 ACP Session 内切换 cwd 的能力。更换工作目录必须新建 Channel/Topic；该限制是刻意设计，用于避免不同 ACP 实现对 cwd 生命周期语义不一致造成串目录。
4. 远程 ACP 若自身按 `roomId` 或自定义元数据复用 Session，需在端点侧保证 `workspaceBindingId` 不冲突。
