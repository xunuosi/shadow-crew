# 🎤 Shadow Crew 技术宣讲方案全景指南
## —— 用 ACP 连接你常用的 Agent 与身边同事的经验，让协作真正发生

> **定位**：技术峰会 / 架构师技术沙龙 / 团队内部技术分享 Keynote 完整演讲策划方案与逐页 PPT 蓝图  
> **核心主旨**：不重复造 Agent 轮子，基于开源开放的 **ACP (Agent Client Protocol)** 协议标准，把常用的编程 Agent、同事调优好的 Agent 与 `.scpack` 经验包连接在同一个工作台，让 Agent 之间协作，也让经验开始流动。

---

## 目录
1. [宣讲定位与受众心智分析](#1-宣讲定位与受众心智分析)
2. [四大核心板块讲解答题规范（针对用户提问）](#2-四大核心板块讲解答题规范针对用户提问)
   - [板块 1：ACP 协议重点能力剖析（为什么是 ACP？）](#板块-1acp-协议重点能力剖析为什么是-acp)
   - [板块 2：ACP V1 与 V2 核心差异对比与双栈设计](#板块-2acp-v1-与-v2-核心差异对比与双栈设计)
   - [板块 3：Shadow Crew 基于 ACP 构建的全景功能版图](#板块-3shadow-crew-基于-acp-构建的全景功能版图)
   - [板块 4：全球相似开源产品与生态横向对标](#板块-4全球相似开源产品与生态横向对标)
3. [推荐补充的高价值宣讲板块](#3-推荐补充的高价值宣讲板块)
   - [高价值补充 1：10 分钟 Live Demo 现场实操闭环设计](#高价值补充-110-分钟-live-demo-现场实操闭环设计)
   - [高价值补充 2：多角色讨论的失真与纠偏（反从众偏见与运筹学收敛）](#高价值补充-2多角色讨论的失真与纠偏反从众偏见与运筹学收敛)
4. [29 页正文 PPT 蓝图 + 7 页 ACP 实操附录（含排版建议与讲师台词）](#4-29-页-ppt-幻灯片逐页策划蓝图)
5. [宣讲演练与互动 Q&A 预案指南](#5-宣讲演练与互动-qa-预案指南)
6. [ACP 协议实操附录（30–36 页）](#6-acp-协议实操附录3036-页)

---

## 1. 宣讲定位与受众心智分析

### 1.1 三个协作工程问题（共鸣建立）
当前团队在尝试 AI 辅助研发时，常见的不是“模型不够强”，而是三个协作工程问题：
1. **认知盲区**：Cursor、Cline、Claude Code 加速了个人编码，但本质上仍是“单 Agent 绑定单一大模型”。受单一模型预训练分布与归纳偏置的限制，单模型“自我审视（Self-Refine）”有边界，容易陷入一致性幻觉（Consistency Illusion）。面对跨领域复杂架构，缺少异构视角之间的交叉质疑与闭环纠正能力。
2. **沉淀难移的记忆孤岛**：老工程师花了数月调优好的 Claude Code / Codex，积累了大量领域知识与特定业务规约，一旦换电脑或新员工入职，记忆无法快速迁移，陷入“重新教一遍 Agent”的低效循环。
3. **协作失真风险**：传统的 Multi-Agent 框架（如 AutoGen、CrewAI）在缺少角色约束与验证机制时，可能出现多 Agent 之间的互相附和（Sycophancy）、循环复读与不收敛；Token 上升，却不一定产出确定性的结果。问题不在“多 Agent”本身，而在协作机制。

### 1.2 破局之道：Thin Control Plane 与超级个体
**Shadow Crew 的核心思想**：
> **“个人不必再造一个 Agent，而是成为连接者：用 ACP 把常用的编程 Agent、同事调优好的 Agent 与活体记忆接进同一个工作台，让协作真正发生，也让经验开始流动。”**

---

## 2. 四大核心板块讲解答题规范（针对用户提问）

### 板块 1：ACP 协议重点能力剖析（为什么是 ACP？）
- **AI 时代的“LSP 时刻”**：
  - 微软发明 **LSP**，解耦了“编辑器 ⟷ 语言静态分析”；
  - Anthropic 发明 **MCP**，解耦了“Agent ⟷ 外部工具/数据源”；
  - Zed 与社区发起的 **ACP (Agent Client Protocol)**，**解耦了“桌面宿主控制面 ⟷ 自治编程 Agent 运行时”**。
- **ACP 7 大核心支柱**：
  1. **stdio 传输**：客户端拉起 Agent 子进程，stdin/stdout 按行传输 JSON-RPC；ACP 核心只定义 stdio，远程 WebSocket / HTTP 传输在独立 RFD 中，Shadow Crew 的 WS / Relay 属于扩展传输。
  2. **双向对等 JSON-RPC 2.0**：客户端正向派发任务（`session/prompt`），Agent 执行敏感操作时反向申请权限（`session/request_permission`）。
  3. **严格的会话与 CWD 物理绑定**：`session/new` 将任务上下文与操作系统路径绝对锁定，杜绝路径串扰。
  4. **全双工流式与内容块**：`session/update` 推送消息、工具与状态；`text` / `resource_link` 是基线，`image` / `audio` / `resource` 需要初始化时协商的 prompt 能力。
  5. **会话生命周期**：`session/new`、`session/list`、`session/resume`、`session/close`；v1 的 `session/load` 做全量重放，v2 移除 load，改用 resume + `replayFrom` / `replay_complete`。
  6. **细粒度版本握手与能力协商 (Capability Negotiation)**：`initialize` 交换 `protocolVersion` / `capabilities` / `info`；v1 用布尔标记，v2 用对象标记，省略即不支持。
  7. **反向权限代理机制 (Permission Broker)**：`session/request_permission` 让 Agent 在敏感操作前回头问宿主；v2 用 `title` + `subject` + `options`，返回 `selected` / `cancelled`。

> **边界说明**：远程 WebSocket / Relay、300s~1800s 心跳、`agentCapabilities.nativeMemory` 属于 Shadow Crew 的传输与记忆扩展，不是 ACP 核心规范；对外宣讲时必须主动区分“核心 vs 扩展”。

### 板块 2：ACP V1 与 V2 核心差异对比与双栈设计
| 对比维度 | **ACP V1（稳定）** | **ACP V2（Draft）** | **接入影响** |
| :--- | :--- | :--- | :--- |
| **版本协商** | 整数 `1`；Agent 返回自己支持的最新版 | 整数 `2`；取 ≤ 请求的最高版；无匹配返回 `-32022`（`requested` / `supported`） | 一个连接只跑一个版本；v1/v2 两套 handler |
| **能力模型** | `agentCapabilities` / `clientCapabilities`；布尔标记，session 能力分散 | 统一 `capabilities` + 必填 `info`；对象存在即支持，`session` 为基线 | 存在性判断，不做布尔等值；只发对端声明过的能力 |
| **Prompt 生命周期** | `session/prompt` 挂起到回合结束，响应 `{ stopReason }` | 插入即 ack `{ messageId }`；`state_update` 报 `running` / `idle`，终态带 `stopReason` | UI 不能把 prompt 响应当完成；终态看 idle |
| **会话恢复** | `session/load` 全量重放；`session/resume` 可选 | `load` 移除；`resume` 必选，支持 `replayFrom` + `replay_complete` | 迁移到 resume；处理 replay 边界与截断 |
| **客户端工具** | `fs/read_text_file`、`fs/write_text_file`、`terminal/*` | 移除；工具在 Agent 执行，客户端工具改走 MCP | 删除 fs/terminal 调用；用 MCP 提供客户端工具 |
| **认证与模式** | `authenticate`、`logout`、`session/set_mode` | `auth/login`、`auth/logout`；`set_mode` → `set_config_option` | 方法重命名；模式改配置项 |
| **工具报告** | `tool_call` + `tool_call_update` | `tool_call` 移除；`tool_call_update` 首次即创建，upsert 语义 | 更新 UI 的增量合并逻辑 |
| **V2 状态** | — | **Draft**（稳定基线 + experimental） | 特性开关 + 双栈；不要用消息翻译伪装兼容 |

### 板块 3：Shadow Crew 基于 ACP 构建的全景功能版图
Shadow Crew 在纯粹的 ACP 协议之上，构建了 5 大工业级控制面能力：
1. **本机与同事 Agent 的双模直连**：
   - 本地 Stdio 进程安全拉起（防静默偷跑，UI 显式启动）；
   - 跨机远程连接（局域网/Tailscale 直连或 Axum Relay Hub），挂载同事电脑上调优完毕的高阶 Agent，默认施加 **ReadOnly Guard** 物理保护。
2. **工业级团队记忆资产化（`.scpack`）**：
   - 纯 TypeScript 实现 256 位 **BLAKE3 哈希完整性校验** 与 **RFC 8785 规范化签名 (JCS)**；
   - 独创 **企业网关 503 补偿算法**：即使企业模型抽取出错，仍可直接从原始 Rollout 轨迹提取专家经验；
   - **零污染只读卡带**：四级记忆漏斗过滤，前置 0 Token，按需工具检索，杜绝污染本地知识库。
3. **普通敏捷协同流（对标 Buzz）**：
   - `<delta-events>` 未读增量切片编译：热会话 Prompt 相比旧版全量模板**字符数缩减 51.1%**（479 vs 980 chars，`test-normal-mode-buzz-orchestration.ts` 单场景实测）；前缀不变 → Prefix Cache 可命中，属设计前提，未做跨模型压测；
   - 派遣时刻并发水位线不变量与 Turn Barrier 同步屏障，优雅支持多人/多 Agent 并发交织研讨。
4. **CognoNexus 4+1 博弈论决策治理**：
   - DIANOIA 4+1 角色解耦（提案官 $\rightarrow$ Free-MAD 红队反从众质询 $\rightarrow$ 物理接地实证 $\rightarrow$ 答辩修正 $\rightarrow$ BWM 运筹学仲裁）；
   - 0-Token 纯数学运筹求解，一致性比率 $\xi^* \le 0.12$ 硬门禁，输出包含《少数派异议报告》的 Living ADR 活体架构画布。
5. **本地 Rust 级反向权限代理中心 (Local Permission Broker)**：
   - 拦截 Agent 的 `session/request_permission`，归一化 6 大 Capability；
   - 工作区沙箱白名单守卫，越界写盘严禁持久化放行，严格遵循 Fail-Closed。

### 板块 4：全球相似开源产品与生态横向对标
| 维度 | **Shadow Crew** | **Buzz (`buzz-acp`)** | **T3 Code** | **OpenHands** | **Goose / Cline** | **CrewAI / AutoGen** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **协议标准** | **ACP 双栈**<br>(stdio 核心 + WS 扩展，支持 V1/V2) | **标准 ACP**<br>(Nostr 中继桥接 stdio ACP) | **私有 CLI 包装**<br>(PTY/CLI 进程驱动 + WebSocket 隧道) | **私有 EventStream**<br>+ MCP 工具集成 | **纯 MCP Client**<br>(无 ACP，属被驱动的 Agent 端) | **私有 Python SDK**<br>(内存对象传递，无通用通信协议) |
| **协同模型** | **双模驱动**：<br>① 普通流：Buzz `<delta-events>` 增量流 + Fan-out；<br>② 议题流：**CognoNexus 4+1 博弈论** (BWM 运筹仲裁) | **频道消息广播**<br>(Nostr 事件驱动，全员自由 `@mention`，异步流式) | **单人多线程并行**<br>(多 Git Worktree 独立任务分配，无 Agent 间协同) | **层级树状派发**<br>(主 Agent 调度专用 Sub-Agent，集中控制) | **纯单 Agent**<br>(无多 Agent 协同，或仅靠人工手动切换 Mode) | **集中式中心化调度**<br>(GroupChatManager 轮询、顺序 SOP 链，缺乏硬收敛) |
| **记忆共享** | **`.scpack` 跨机专家能力包**：<br>• 6 源一致性快照<br>• BLAKE3 + RFC8785 JCS 签名<br>• 外挂只读 Cartridge (零污染) | **会话级/渠道级滚动**<br>(依赖 Nostr 频道历史，无跨机打包标准) | **工作区隔离**<br>(依赖 Git 分支与历史，无 Agent 记忆导出) | **向量数据库 (Vector DB)**<br>(Chroma 集中式持久化，无法便携分发) | **本地规约文件**<br>(`.clinerules`, Markdown Memory Bank) | **短/长期内存抽象**<br>(SQLite/Chroma 本地持久化，不可移植) |
| **安全沙箱** | **Rust 级反向权限代理**：<br>• `session/request_permission` 拦截<br>• Topic 级不可变 CWD 物理隔离 | **宿主 OS / 进程权限**<br>(依赖子进程默认权限或人工在 CLI 交互) | **Worktree 隔离**<br>(Git Worktree 目录隔离，命令白名单审批) | **Docker 容器沙箱**<br>(完全容器化隔离，权限由容器环境限制) | **编辑器交互弹窗**<br>(VS Code 级 Tool Call 确认，工作区限定) | **Python 运行沙箱**<br>(缺乏 OS 级细粒度系统调用/文件拦截) |

---

## 3. 推荐补充的高价值宣讲板块

### 高价值补充 1：10 分钟 Live Demo 现场实操闭环设计
*（建议在演讲中段进行，视觉冲击力与说服力拉满）*
- **步骤 1：启动与拓扑装载（1 分钟）**
  - 演示在 UI 启动本地 Codex Agent，并输入同事电脑 IP，秒级挂载同事调优好的“分布式缓存专家 Agent（Remote ACP）”。
- **步骤 2：导入专家能力卡带（1 分钟）**
  - 将一份同事导出的 `redis-redlock-expert.scpack` 拖入系统，展示 BLAKE3 验签秒级通过，作为只读卡带挂载（Zero Contamination）。
- **步骤 3：敏捷增量协同讨论（2 分钟）**
  - 在 Channel 发起讨论：“我们要在结算链路接入分布式锁”，展示本地 Agent 与远程同事 Agent 并发响应；
  - 屏幕展示 Token 水位线监控，展示 `<delta-events>` 机制仅发送 200 Token 未读增量，节省 75% 费用。
- **步骤 4：升维 4+1 博弈推演（4 分钟）**
  - 遇到“Redlock 在 NTP 时钟跳变下的安全性”分歧，一键将 Topic 升级为 **CognoNexus 4+1 博弈模式**；
  - 提案官发起方案 $\rightarrow$ Free-MAD 红队尖锐质询时钟漏洞 $\rightarrow$ 验证官拉起本地 Rust 执行真实实证 $\rightarrow$ 提案方补防御修正 $\rightarrow$ 综合裁定官启动 BWM 运筹求解，屏幕显示一致性指标 $\xi^* = 0.08 \le 0.12$，瞬间生成规范的 Living ADR 架构决策画布。
- **步骤 5：Rust 权限仲裁与物理补丁合入（2 分钟）**
  - 定案后一键派发执行，Agent 发起文件修改，Rust 弹窗拦截 `fs.write` 请求，演示工作区内路径安全放行，代码自动合入 Git 工作区并一次性测试通过。

#### 💡 演讲实战秘籍：现场演示时应对“公司网络封锁”与“本地离线模拟”方案
在技术宣讲与现场 Demo 中，若遇到“公司 Wi-Fi 开启了 AP 隔离禁止两台电脑互连”或“现场没有双机网络条件”，推荐采用以下两套成熟策略：
1. **单机 100% 真实协议模拟方案（官方推荐，零风险保底）**：
   - 项目内置开箱即用的轻量 WebSocket ACP 模拟服务：`npm run mock:remote`（或 `node scripts/mock-remote-acp-agent.mjs 9001 "张工 (分布式锁专家)"`）；
   - 在 Shadow Crew 连接弹窗中选择 **Remote ACP**，填入 `ws://127.0.0.1:9001`；
   - **说服力保证**：虽然运行在本地回环，但 Shadow Crew 走的是**完全真实的 WebSocket 网络协议栈**，UI 会展示 **`Remote ACP`** 蓝色高亮徽章，精确触发 40ms 网络 RTT 探针检测与逐字流式推送。对现场观众而言，这就是一个真实的远端同事端点，同时彻底杜绝了现场断网翻车的风险。
2. **真实跨机网络穿透方案（若坚持使用两台物理电脑演示）**：
   - **手机热点对联（最稳妥实机方案）**：演示时两台电脑同时连接手机热点（iPhone/Android 默认不设 AP 隔离），直接通过 `172.20.10.x` 或 `192.168.43.x` 直连；
   - **Tailscale 虚拟 Mesh 网**：两机加入同一个 Tailscale 账号，直接通过 `100.x.y.z` 虚拟内网穿透公司防火墙；
   - **反向代理/公网穿透**：同事电脑使用 `cloudflared tunnel` 或 `ngrok` 将本地端点暴露为 `wss://*.trycloudflare.com`，甚至直接部署本项目自带的 `crates/shadow-crew-server`（Axum Relay Hub）。

### 高价值补充 2：多角色讨论的失真与纠偏（反从众偏见与运筹学收敛）
- **学术界痛点**：研究表明（Free-MAD、Sycophancy Propagation 等），LLM 在多轮讨论中可能出现“谄媚效应（Sycophancy）”，即倾向于附和之前发言者的观点，即使前者的观点存在明显逻辑漏洞。
- **Shadow Crew 的趋真保障机制**：
  1. **BSS/DSS 谄媚量化与信任折减**：动态追踪 Agent 的发言，对“无任何代码/测试实据却突然屈服妥协”的行为施加 $\gamma$ 信任度折减；
  2. **Free-MAD 强制红队反从众四部曲**：挑战官必须针对提案寻找 3 类致命反例（死锁、并发竞态、越界）；
  3. **BWM（Best-Worst Method，最佳-最差法）运筹求解**：将架构权衡转化为可检查的数学规划，减少凭空捏造的“虚假共识”；
  4. **验证门禁**：结论进入裁决前过四道检查——证据可复现、反例逐条回应、一致性达标（$\xi^* \le 0.12$）、法定人数/程序完备；缺证据就退回，不按“看起来一致”放行；
  5. **《少数派异议报告》**：不抹杀反对声音，伴生保留红队的核心异议与 3 条量化黑天鹅重启触发器。


---

## 4. 29 页 PPT 幻灯片逐页策划蓝图

> 正文 29 页；另附 7 页 ACP 实操附录（30–36 页），见第 6 节。

| 页码 | 页面标题 | 视觉焦点与图表布局 | 讲师核心话术与展开重点 |
| :--- | :--- | :--- | :--- |
| **01** | **连接 Agent，连接彼此**<br>—— 基于 ACP 协议的 Agent 连接与协作新范式 | 极简深色封面，中央为发光的组织网络，节点连接着各类 Agent 与应用图标 | “欢迎各位同行。今天我们要探讨的，不仅是如何用 AI 提效，而是如何利用标准协议，把常用的 Agent 和同事的经验连接起来，让协作真正发生。” |
| **02** | **单 Agent 与多 Agent：两种工作方式**<br>不比较优劣，先看取舍 | 左右对比卡片：单 Agent（链路短、上下文集中、单点偏差） vs 多 Agent（角色分工、交叉验证、协调成本） | “这不是代际替代。单 Agent 链路短，多 Agent 增加分工与验证，但协调、Token、时延都会上升。协作的目的不是证明谁更强，而是把过程交给工作流，让人只关注结果。” |
| **03** | **协作的三个工程问题**<br>认知、经验、收敛 | 三列卡片：认知盲区、记忆孤岛、协作失真 | “三个问题都不是‘多 Agent 一定不好’，而是缺少外部挑战、经验资产化与验证门禁。论文依据与边界见附录 A7。” |
| **04** | **不造 Agent 轮子：先划清责任边界**<br>不是能力清单，而是责任划分 | 五行责任表（层 / 谁负责 / Shadow Crew 的做法），每格附一句白话解释：CWD 绑定、反向权限代理、作用域授权、Fail-Closed、增量协同、4+1、BWM 门禁、Living ADR、跨机经验包；右侧为控制面 + 外置 Agent 示意 | “这页不写简称。CWD 绑定就是每个议题锁定一个目录；反向权限代理就是 Agent 动手前必须回头问宿主；作用域授权是一次 / 本会话 / Channel / Topic / DM；Fail-Closed 是越界、超时、选项不全一律拒绝。协同侧同样：增量协同只发未读、4+1 是五阶段、BWM 门禁把权衡交给数学、Living ADR 是可导出的决策记录、跨机经验包是同事的经验可带走。” |
| **05** | **ACP 的核心架构理念**<br>职责彻底解耦与对等双向通信 | 双向通信泳道图：Client ↔ Agent 的正向派发与反向权限请求；页脚标注 ACP 沿用 LSP 的结构（JSON-RPC 2.0 · stdio 子进程 · initialize 能力协商） | “ACP 不是新发明的通信方式：它沿用 LSP 的结构，把‘编辑器驱动语言服务器’换成‘宿主驱动 Agent 运行时’。区别在方法集合——Agent 会跑 prompt turn、报工具调用、反向申请权限。” |
| **06** | **ACP 之上：宿主补的控制层**<br>协议只到单 Agent，协作质量靠宿主 | 三张主卡：协议双轨（v2 探针 / v1 兜底）、会话账本（创建/恢复/隔离/销毁）、水位线增量上下文；四张 mini 卡：并发调度、博弈趋真、模块化分治、安全隔离 | “ACP 都有了，宿主还补什么？第一，协议双轨：先探 v2，被拒 3 秒内降 v1。第二，会话账本：CWD 宿主解析，恢复前校验 persona/CWD/binding，停止时统一清理。第三，水位线：热会话只发未读增量，冷会话才发全量。第四，四层质量：并发用 Turn Barrier，趋真用 4+1 与 BWM，分治用 G-Frame，安全用 CWD + 权限代理 + Fail-Closed。” |
| **07** | **从 V1 到 V2：调用模型变了**<br>最大差异是同步挂起 vs 立即确认 | 上半区两条时间轴：V1 的 session/prompt 一整条挂起到 stopReason；V2 插入即 ack { messageId }，之后走 session/update 的 state_update。下半区左右对账五行：版本、能力（布尔清单 vs 对象存在即支持）、客户端工具、会话恢复、认证与配置 | “先讲调用模型：V1 请求一直挂着，中途想补话只能 cancel；V2 消息插入就返回，执行在后台，进度和终态靠 state_update。能力那行的差别是：V1 写 true/false，V2 写 {{}} 表示支持、不写表示不支持。其余差异都围绕这一点收敛。” |
| **08** | **六维核心差异全景对照表**<br>ACP V1 vs V2 的工程级深度对账 | 6 行对比表（版本、能力、生命周期、恢复、客户端工具、认证/模式） | 逐项讲透 V2 的 `{ messageId }` ack、`state_update` 终态、`session/resume`、客户端工具改走 MCP 与对象化能力。 |
| **09** | **Shadow Crew 的双栈协商**<br>一个连接，只讲一个版本 | 协商状态机图：initialize 选版本 $\rightarrow$ 2 / 1 / `-32022` | 讲解官方协商规则：请求最新、Agent 选 ≤ 请求的最高版、无匹配返回 `-32022`；按连接选 handler，不做消息翻译；V2 是 Draft，用特性开关。 |
| **10** | **读写谁来做：端点优先，宿主兜底**<br>端点有工具就自己执行，宿主 MCP 只补缺口 | 三卡：端点原生工具（默认，挂 governance_only）、宿主 MCP full（兜底）、治理类工具（两种 profile 都在）；下方两条边界说明 | “默认让端点用自己的 read/write/shell：session 注入 governance_only，6 个基础工具从 tools/list 移除、调用直接拒绝。端点没有对应能力时，dev MCP 用 full 补位。但不管工具在谁手里，越界路径都要进宿主 ACP 权限审批。” |
| **11** | **每个单元，一个会话，一个工作区**<br>隔离不是说出来的，是 key 和目录决定的 | 五行对照表：Channel / Topic / DM / DM Topic 各自的 session key 与工作目录，外加 Module 的沙箱与 allowedFiles；右侧四条规则（建立即锁定、运行期不可变、并发互不越界、模块级隔离） | “频道、议题、私聊、私聊议题、模块，每个单元都有独立的 session key 和工作目录。key 由宿主拼，cwd 由 binding 解析；模块层再叠上下文沙箱和 allowedFiles。所以并发时不会串上下文，也不会互相覆盖文件。” |
| **12** | **私聊：按 Agent 连续，按议题切开**<br>不绑项目目录换连贯，用议题换聚焦 | 两条轨道：主私聊（`dm:` + `agents/<aid>`）与私聊议题（`dmtopic:` + `agents/<aid>/topics/<tid>`）；右侧三种目录来源 default / agent_snapshot / custom；底部取舍说明 | “私聊不绑项目目录，绑在 Agent 家目录，所以换项目继续聊还是同一条历史。代价是上下文会膨胀，于是私聊也有议题：独立 session key、独立目录，只谈一个特定问题，聊完不回流。产物永远落在 agents/<aid>/topics/<tid>/artifacts。” |
| **13** | **普通讨论：靠 @ 接力，用沉默收敛**<br>默认模式的自然收敛与 Swarm 支线 | 上排三卡：@ 是接力棒 / 没有 @ 就结束（静默收敛）/ LoopGuard 兜底；中间 Swarm 条：触发→拆解→确认→并行→Reduce；底部设计初衷 | “默认模式没有总指挥也没有固定轮次：谁被 @ 谁发言，本轮没人发出有效 @ 就自然结束，不弹提示、不加系统消息——沉默本身就是已达成。兜底是 LoopGuard 12 跳或单 Agent 8 次，到顶静默收口。设计初衷是不让 Agent 为了表态而发言。” |
| **14** | **4+1：四类 AI 角色，加一把人类法槌**<br>角色说准，门禁说清 | 五张角色卡：提案 P / 红方 C / 落地验证 V / 综合 S（AI 主席）/ 裁决 H（人类法槌）；一行阶段说明（6 阶段 FSM，答辩属提案方）；四张门禁卡：有界重试 ≤2、SPRT 死锁熔断、法定人数、人类法槌 | “4+1 是 4 类 AI 角色 + 1 类人类：提案、红方、落地验证、综合、裁决。答辩不是第 5 个角色，defense 阶段由提案方自己出补丁。下面四个门禁要说清归属：有界重试是阶段契约校验失败后的 Self-Refine 次数（≤2），超限 stageFailed 转人工；SPRT 死锁熔断是似然比跌破下界；LoopGuard 管的是普通协同的级联，不是这个 FSM。” |
| **15** | **凭什么更准（上）：角色、从众、假一致、谄媚**<br>四类错误出在人与角色上 | 2×2 卡片：角色同质化 / 从众 / 假一致 / 谄媚，每张卡写「依据论文 + 机制 + 代码 + 不达标会怎样」 | “角色同质用四类正交角色加准入阻断；从众靠红方可证伪反例和裸确认拦截；假一致靠 T1/T2 分级接地和未实证硬锁；谄媚靠 BSS/DSS 打分与 γ 折减。” |
| **16** | **凭什么更准（下）：多样性、权重、异议、增量**<br>四类错误出在证据与数值上 | 2×2 卡片：伪多样性 / 拍脑袋 / 抹平异议 / 廉价对话，同样四段式；页脚点明“不保证结论一定对，只保证错得可查” | “同一模型多开实例不算多样性，用家族检测告警；权重交给 BWM，ξ* 超 0.12 锁死定案；异议写进 ADR 并挂重开触发器；廉价对话按事实增量计分、套话扣分。” |
| **17** | **把架构权衡，写成可检查的数学问题**<br>BWM（最佳-最差法）求解 0 次 LLM 调用，ξ* 不达标就退回 | 顶部三步条（输入 / 求解 / 门禁）＋ 左侧例子（3 准则 × 3 方案打分表、两组比值、一句白话导语 + 极小极大 LP + 权重代入 + 效用复算行）＋ 右侧结果（ξ*=0.065 PASS、权重 0.563/0.311/0.125、C 方案效用 0.861 排第一） | “拿一个具体场景走一遍：一致性权重 0.563、性能 0.311、复杂度 0.125，ξ*=0.065 过门禁，C 方案效用最高。页面上给了两段计算方式：权重来自极小极大线性规划，效用是归一化后加权求和。口径：打分和比值由规则或模型给出，BWM 只保证推导自洽、可复算。” |
| **18** | **防谄媚：契约优先，词表兜底**<br>结构化直判 → AST 兜底 → BSS/γ 折减 | 左侧三层：① 结构化契约（0.92/0.82 硬判、0.08/0.22 基准、补丁 −0.05）② 文本兜底（AST 结构证据 + 双抵扣）③ BSS 查表与 γ 公式；右侧三处下游联动（SPRT / BWM / G-Frame）+ γ 算例 | “新版不是纯关键词匹配：有 submit_defense_patch 就直接读 stance，全盘投降没补丁直接 0.92；没有结构化契约才降级到 AST 结构证据；最后用 BSS 先验和 γ 折减，正面分往 0.5 强拉、负面只轻微收缩。折减后进 SPRT 防伪早停、BWM 置信度矩阵降权、G-Frame 模块健康分。” |
| **19** | **长在 ACP 总线上的五个控制面**<br>入口 / 控制面 / 总线三层，逐层说清 | 三层架构图：入口（频道、私聊、标准议题、4+1 议题、ADR 画布、权限中心）→ 控制面（本地+远程、记忆资产、敏捷协同、博弈治理、权限中心）→ ACP 总线（JSON-RPC 2.0 · stdio 核心 + WS 扩展；Local / Remote / Relay Hub / Adapter）；下方读法一行 | “越往上越靠近人，越往下越靠近协议。注意别说‘双模直连’——双模在别处指普通讨论与 4+1 两种模式，这里讲的是本地与远程两种连接方式。最下面这层只负责送请求，执行面换端点，上面五个控制面不用跟着改。” |
| **20** | **记忆归端点：宿主只传策略，不替它记住**<br>四态探测 + 不自建向量库 + 专家包强制隔离 | 左侧宿主“做三件事、不做一件”；右侧四列表：状态 / 端点实际说了什么（supported + enabled 组合）/ 宿主动作 / 用户看到；表头给出对象形状；页脚补“探活只反映当前进程”与“--disable 属适配器” | “握手返回的是对象不是布尔：supported 与 enabled 组合出四态——enabled 就尊重索引；disabled 就写 env=0 让适配器关；unsupported 就置灰不再探测；unknown 是没声明或还没握手，UI 显示待握手。每次握手重新探测，不复用旧状态。” |
| **21** | **团队记忆资产化：便携经验包 (.scpack)**<br>工业级加密、脱敏与防篡改封装 | 打包解构图：6 源一致性快照、BLAKE3 校验、RFC 8785 JCS 签名 | 详细解析 `.scpack` 规范，如何通过密码学手段确保经验的安全流转，以及针对企业网关 503 报错独创的 Rollout 补偿提取算法。产品意图：同事休假、换机、离职，经验仍然在线。 |
| **22** | **离线建索引，在线只取 Top-1**<br>打包时建索引，发消息时本地算一次 BM25 | 四级漏斗（6 源快照 → 离线建索引 → 在线检索 → 注入）+ 右侧四条机制（分词 / 打分 / 门禁 / 安全）+ 底部“在线≠联网”说明 | “离线是打包时：Playbook 的 title+triggers+tags+正文分词，统计 TF/DF 写进 search_index.json，随包签名。在线是发消息那一刻：同样分词，跑 Okapi BM25（k1=1.5、b=0.75），trigger +1.25、tag +0.75，只取 Top-1，不到 0.15 不注入。两处口径要讲明：top_k 参数被忽略，实际 Top-1；注入块始终有 Global Index（≤8KB），不是字面 0 Token。” |
| **23** | **跨机互联：连接身边同事的 Agent**<br>从单机 stdio 到局域网 / Relay Hub | 网络拓扑图：本地 Agent、同事 A 电脑（Tailscale 直连）、中心 Relay Hub（Shadow Crew 扩展传输） | “张工精通 Linux 内核，他的 Claude Code 调优得很顺手。通过 Shadow Crew 连接他的端点，他的 Agent 就能和我一起工作。产品最期望的方向，是同事不在场时，他的 Agent 和经验仍然在线。” |
| **24** | **四种协作形态，不同取舍**<br>不是代际替代，是四种取舍 | 2×2 卡片：框架式编排（CrewAI / AutoGen→MAF）、编辑器或终端的单 Agent（Cline / Goose）、沙盒执行平台（OpenHands）、解耦型控制面（Shadow Crew）；每张写适合与代价 | “四种形态各解决不同问题。两点别说错：Goose 是桌面与 CLI，不是 IDE 插件；AutoGen 在 2025 年底并入 Microsoft Agent Framework。选择取决于任务、团队与治理成本。” |
| **25** | **四个维度：我们怎么选，代价是什么**<br>只讲自己的取舍，不替同行下判断 | 四行三列表：维度 / 我们的选择 / 为什么这样选 / 代价与适用边界；协同一行写“频道 + 议题”（论坛式：频道是常驻讨论流，议题从频道里开专题）；四枚 take 标签 | “协议选 ACP 双栈，代价是依赖端点、V2 还是 Draft；协同是论坛式结构——频道像版块常驻讨论，里面可以再开 topic 专题，议题有独立会话、目录与流程，代价是要人判断何时开议题；记忆端点原生优先加 .scpack，代价是要端点配合关记忆、卡带只读；安全用 Rust 反向代理，代价是只管本地宿主。” |
| **26** | **六个设计选择：我们如何取舍**<br>不是六个功能，而是六个取舍 | 3×2 大卡：执行面解耦 / 经验可携带 / 收敛有门禁 / 按任务选流程 / 对话不绑项目 / 边界在本地；每张写一句选择、一行证据、一行代价 | “六个取舍，每条都写代价。第五个讲抽象层面的选择：对话不绑项目——协作单元各自独立，换项目不打断同一段历史，具体问题再开议题；代价是历史越长越要主动收敛。具体到私聊与议题的 session key 放在第 11、12 页展开，这页只说选择本身。” |
| **27** | **现场演示：10 分钟 Live Demo 实战**<br>一次真实的跨端团队协同与博弈之旅 | 现场实操投影 / 关键步骤截图卡片流 | 现场还原端到端实操：挂载同事远端 Agent $\rightarrow$ 挂载只读记忆卡带 $\rightarrow$ 敏捷讨论 $\rightarrow$ 升维 4+1 博弈 $\rightarrow$ Living ADR 补丁合入。 |
| **28** | **接下来的三个方向**<br>不做时间预测 | 三张卡片：现在（桌面协同） $\rightarrow$ 下一步（P2P 组网） $\rightarrow$ 探索（组织经验网络） | 讲方向，不承诺时间点；把“探索”明确标为探索，不包装成必然。 |
| **29** | **结语与致谢**<br>让 Agent 彼此连接，让经验彼此流动 | 极简留白页面，项目 GitHub 仓库二维码与联系方式 | “协作不是目的。把人从过程里抽出来，只关注结果，才是。同事不在场，他们的经验也一直在线。感谢大家！” |

---

## 5. 宣讲演练与互动 Q&A 预案指南

### Q1：为什么要专门用 ACP 协议，而不是直接用大模型的 REST API 或者 OpenAI 格式？
> **讲师回答要点**：  
> OpenAI REST API 只是“无状态的单次补全接口”，它不包含 Agent 自治运行所需的“多轮 ReAct 循环、操作系统权限反向申请、工作目录锁定、流式取消与会话状态同步”。如果宿主去拼装这些，就必须在前端实现大量厚重的 Agent 执行逻辑；而 ACP 将执行黑盒完整交给外部独立进程（如 Claude Code、Codex），宿主只做轻量的组织协同，架构极其纯粹。

### Q2：连接同事的 Agent，是否会把同事电脑的敏感文件或密钥泄露过来？
> **讲师回答要点**：  
> 设计上不会。Shadow Crew 采用双向安全防御：
> 1. 远程 Agent 在连接时默认施加 **ReadOnly Guard**，阻断文件写与执行指令；
> 2. 跨机流转的专家记忆包（`.scpack`）内置**硬脱敏网关**，自动剔除 API 密钥、内网 Token 并将绝对路径相对化；同时记忆以外挂**只读卡带**方式读取，零污染本地环境。

### Q3：4+1 博弈推演会不会耗费太多时间和 Token？
> **讲师回答要点**：  
> 这正是我们设计**双模协同（Dual-Mode Orchestration）**的原因。日常任务走对标 Buzz 的敏捷协同流（增量切片，热会话 Prompt 字符数 980 → 479）；只有在遇到高危架构争议时，才一键升维至 4+1 博弈。同时，我们在博弈中采用 **LMAD 局部冲突切片**、**BWM 0-Token 纯数学运筹求解** 与 **Wald-SPRT 早停机制**，减少无休止讨论，兼顾效率与严谨。

---

## 6. ACP 协议实操附录（30–36 页）

> 面向需要落地接入的听众。现场讲不完时，放到 Q&A 或会后资料；正文节奏不变。

| 页码 | 页面 | 核心内容 |
| :--- | :--- | :--- |
| **30** | **一次 ACP 调用，从头到尾** | `initialize` → `session/new` → `session/prompt` → `session/update` → `session/request_permission` → `idle`；v1/v2 终态差异 |
| **31** | **capabilities 是什么** | 握手时交换的能力清单：`session` 总开关、prompt / MCP / systemPrompt / auth.terminal / elicitation；v1 布尔 vs v2 对象 |
| **32** | **V1 方法地图** | 基线方法、能力门控、`fs/*` / `terminal/*` 客户端工具、布尔能力 |
| **33** | **V2 方法地图** | 基线方法、六个断点、V2 Draft 状态 |
| **34** | **最小接入：四段报文** | `initialize` / `session/new` / `prompt` / `update + permission` 的可照抄 JSON-RPC |
| **35** | **接入检查清单** | 传输、版本、能力、会话、内容、流式、权限、取消、恢复、双栈 |
| **36** | **参考论文与适用边界** | Free-MAD / ColMAD / LMAD / ReConcile / Sycophancy Propagation / DIANOIA / LLM+BWM / Disagreement-Aware，以及 G-Frame 内部规范 |

### 6.1 最小接入步骤

1. **传输**：客户端拉起 Agent 子进程，stdin/stdout 每行一个 JSON-RPC 对象；stdout 只写 ACP 消息，日志走 stderr。
2. **握手**：`initialize` 带 `protocolVersion`、`capabilities`、`info`；读返回的 `protocolVersion` 决定后续 handler。
3. **建会话**：`session/new` 带绝对路径 `cwd` 与 `mcpServers`，拿 `sessionId`。
4. **发消息**：`session/prompt` 带 `ContentBlock[]`；v2 立即收到 `{ messageId }`，v1 等回合结束收 `{ stopReason }`。
5. **收流**：按序处理 `session/update`；需要审批时响应 `session/request_permission`。
6. **收口**：v2 等 `state_update` 的 `idle` + `stopReason`；取消用 `session/cancel`，恢复用 `session/resume`，关闭用 `session/close`。

### 6.2 方法速查（V1 → V2）

| 场景 | V1 | V2 |
| :--- | :--- | :--- |
| 建会话 | `session/new`（`cwd` + `mcpServers`） | `session/new`（`cwd` + 可选 `mcpServers` / `systemPrompt` / `additionalDirectories`） |
| 发消息 | `session/prompt`，响应 `{ stopReason }` | `session/prompt`，响应 `{ messageId }`；终态看 `state_update` |
| 恢复 | `session/load`（重放） / `session/resume`（可选） | `session/resume`（必选，可带 `replayFrom`） |
| 取消 | `session/cancel` 通知 | `session/cancel` 通知；等 `idle stopReason: cancelled` |
| 审批 | `session/request_permission`（`toolCall` + `options`） | `session/request_permission`（`title` + `subject` + `options`） |
| 工具 | `tool_call` / `tool_call_update` | `tool_call_update`（首次创建，upsert） |

### 6.3 论文依据与适用边界

- **Free-MAD**：反从众的多 Agent 辩论；挑战者迫使提案给出可证伪反例。
- **ColMAD**：协作式多 Agent 辩论；角色分工与协同增量。
- **LMAD**：局部多 Agent 辩论；按冲突切片，减少无关上下文。
- **ReConcile**：异构模型共识与置信度校准；用校准置信度而非简单投票。
- **Sycophancy Propagation**：谄媚在多轮讨论中传播；需要量化与信任折减。
- **DIANOIA**：角色正交的认知流程；4+1 阶段划分的依据之一。
- **LLM + BWM**：用 BWM 把准则权重变成可检查的数学问题。
- **Disagreement-Aware**：保留少数派异议与黑天鹅重启触发器。
- **G-Frame**（内部规范，不是论文）：用贝叶斯先验 / 后验做模块路由（宣讲中可称“贝叶斯博弈”），把大任务拆成 2–4 个原子模块，按模块选择模型与验证强度。

> **引用边界**：论文结论依赖任务、模型与提示；不把“多 Agent 必然更准”当作普遍结论。宣讲时先讲条件，再讲证据。

> **资料来源**：ACP 官方规范 v1 / v2（agentclientprotocol.com）。V2 目前仍为 Draft；正式对外演讲前请再核对一次版本状态与 schema。
