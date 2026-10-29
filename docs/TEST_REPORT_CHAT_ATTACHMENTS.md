# Shadow Crew 图片与文件附件测试报告

> **执行日期**：2026-10-29（Asia/Shanghai）
> **结论**：图片、文件、DM、DM Topic、ACP Content Blocks 与刷新持久化链路通过
> **方案文档**：[`TECH_SPEC_CHAT_ATTACHMENTS.md`](./TECH_SPEC_CHAT_ATTACHMENTS.md)

---

## 1. 自动化验证

| 检查 | 命令 | 结果 |
| :--- | :--- | :--- |
| TypeScript | `npm run lint` | ✅ 通过 |
| 前端构建 | `npm run build` | ✅ 通过 |
| Rust Workspace | `cargo test --workspace` | ✅ Desktop 30/30；Dev MCP 9/9 |
| 附件专项 | `node --import tsx src/services/test-chat-attachments.ts` | ✅ 23/23 |
| 本地 ACP 权限协议 | `node --import tsx src/services/test-acp-permission-protocol.ts` | ✅ 5/5 |
| 权限 UI | `node --import tsx src/services/test-acp-permission-ui.ts` | ✅ 14/14 |
| 普通模式编排 | `node --import tsx src/services/test-normal-mode-buzz-orchestration.ts` | ✅ 54/54 |
| LLM 压缩治理 | `node --import tsx src/services/test-llm-compaction-governance.ts` | ✅ 140/140 |
| CognoNexus | `npm run test:cogno` | ✅ 全部通过 |
| G-Frame 边界探测 | `npm run test:cogno:edge` | ✅ DEFECT 0 / WARN 0 |
| DM Topic | `npm run test:dm` | ✅ 20/20 |
| Workspace Binding | `npm run test:workspace` | ✅ 8 组通过 |
| ACP-only 运行时 | `npm run test:acp-only` | ✅ 通过 |
| Mention 边界 | `node --import tsx src/services/test-mention-resolution.ts` | ✅ 13/13 |
| 差异格式 | `git diff --check` | ✅ 通过 |

### 1.1 附件专项覆盖

- 图片 MIME 与文件头校验；
- SVG 伪装图片拒绝；
- 普通文件识别；
- 单消息附件数量上限；
- Base64 编码；
- 附件清单生成；
- 图片缩略图和文件卡片静态渲染；
- 远程 WebSocket 附件显式阻断；
- 附件校验与发送状态更新保持 React 更新器纯度；
- 异步发送重入锁阻止快速双击产生重复附件消息；
- 附件保存 IPC 不重复回传图片 Base64 预览；
- Tauri Host 图片/文件保存；
- 附件大小声明校验；
- 伪造图片拒绝；
- 路径段清洗；
- ACP `image` / `resource` / `resource_link` block 构造；
- 附件路径逃逸拒绝；
- 图片能力未声明时 Fail-Closed。

## 2. Rust Host 测试

新增 `attachment_tests`：

- 合法 PNG 与 Markdown 文件写入独立 scope 目录；
- 返回 `file://` URI；
- 文件实际内容与输入一致；
- 伪造 PNG 文件头被拒绝；
- 声明大小与实际大小不一致被拒绝；
- 路径段 `../../etc` 被清洗。

新增 ACP Prompt block 测试：

- 图片生成 `image` block；
- 文件生成 `resource` block；
- 无 embedded context 时生成 `resource_link`；
- Binding 外附件路径被拒绝；
- `promptCapabilities.image/embeddedContext` 正确解析。

新增 Workspace Binding 路径迁移测试：

- 历史 `~/.shinobi/...` / 非规范路径在数据库入口规范化；
- 迁移幂等；
- 避免新增 Topic 时因旧路径表示差异被误判为修改不可变 Binding。

## 3. 真实 Tauri App 验证

测试使用：

```text
python3 -u src-tauri/tests/fixtures/fake_permission_acp.py
```

### 3.1 DM 图片 + 文件

1. 在 DM Composer 选择 `public/ninja-icon.png`；
2. 选择 `package.json`；
3. 不输入文本，直接发送附件-only 消息；
4. App 显示图片缩略图与文件卡片；
5. ACP 收到：

```text
blocks=text,image,resource
```

6. Agent 的权限请求正常弹出；
7. 用户允许后 Agent 执行写操作。

### 3.2 刷新恢复

关闭并重新启动 Tauri App：

- 图片缩略图仍显示；
- 文件卡片仍显示；
- 文件名、MIME、大小和存储路径保持一致；
- ACP 回复与附件消息未丢失。

### 3.3 DM Topic 文件

1. 在附件测试 Agent 的私聊中创建 DM Topic；
2. 在 Topic Drawer Composer 选择 `package.json`；
3. 附件-only 发送；
4. ACP 收到：

```text
blocks=text,resource
```

5. Topic Response 正常落库；
6. Topic CWD 仍为独立 `agents/<agentId>/topics/<topicId>`。

## 4. 人工复测用例

| ID | 步骤 | 预期 |
| :--- | :--- | :--- |
| ATT-01 | 点击附件按钮选择 PNG | 显示图片缩略图与大小 |
| ATT-02 | 选择 Markdown/JSON/PDF 等文件 | 显示文件卡片、MIME 和大小 |
| ATT-03 | 从剪贴板粘贴截图 | 图片直接进入附件条 |
| ATT-04 | 拖入文件 | 文件进入附件条 |
| ATT-05 | 仅发送附件、不输入文本 | 消息可发送并投递 ACP |
| ATT-06 | 添加 7 个附件 | 明确拒绝 |
| ATT-07 | 添加大于 4 MiB 图片 | 明确拒绝 |
| ATT-08 | 添加大于 8 MiB 文件 | 明确拒绝 |
| ATT-09 | 把 SVG 改名 PNG | 文件头校验拒绝 |
| ATT-10 | Agent 未声明 image 能力时发送图片 | 明确 ACP 能力错误，不静默丢图 |
| ATT-11 | Agent 支持 embeddedContext 时发文件 | ACP 收到 `resource` |
| ATT-12 | Agent 不支持 embeddedContext 时发文件 | ACP 收到 `resource_link` |
| ATT-13 | 刷新或重启 App | 图片和文件卡片恢复 |
| ATT-14 | 远程 WebSocket Agent + 附件 | 明确阻断 |
| ATT-15 | DM Topic 附件 | 使用 Topic scope 存储并投递 |

## 5. 已知边界

1. 远程 WebSocket 附件上传尚未实现，本期明确 Fail-Closed。
2. 图片只支持 PNG / JPEG / WebP / GIF。
3. 普通文件在 embedded context 下会进入 ACP Prompt 数据；大文本会增加上下文 Token。
4. Agent 未声明图片能力时不能接收图片。
5. 应用重启后，ACP Session 是否恢复原始多模态历史由 ACP 端点负责。
