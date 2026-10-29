# Shadow Crew 聊天图片与文件附件技术方案

> **版本**：v1.0.0
> **状态**：已实施
> **范围**：本地 ACP stdio
> **暂不包含**：远程 WebSocket 附件传输

---

## 1. 目标

用户可以在 Channel、Channel Topic、DM 和 DM Topic Composer 中：

1. 通过文件选择器插入图片；
2. 通过文件选择器插入普通文件；
3. 直接粘贴剪贴板图片或文件；
4. 将图片/文件拖入 Composer；
5. 在发送前查看图片缩略图和文件卡片；
6. 将附件随消息持久化；
7. 在刷新或重启后恢复附件展示；
8. 将附件作为 ACP Content Blocks 同步给当前参与 Agent。

## 2. 数据模型

页面内的待发送附件：

```ts
interface MessageAttachmentInput {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
  previewDataUrl?: string;
}
```

持久化到 `message_json` 的附件元数据：

```ts
interface MessageAttachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  path?: string;
  uri?: string;
  previewDataUrl?: string;
}
```

图片保留受限大小的 `previewDataUrl` 用于刷新后直接渲染；普通文件只保存元数据和本地路径，避免在 SQLite 中重复保存文件正文。

## 3. UI 交互

### 3.1 输入入口

- Composer 工具栏附件按钮打开原生多选文件框；
- Composer 任意区域支持粘贴文件；
- Composer 支持拖放文件；
- 图片显示缩略图，普通文件显示文件卡片；
- 发送前可以单独移除任意附件；
- 仅附件、无文本时也允许发送。

### 3.2 限制

| 限制 | 值 |
| :--- | :--- |
| 单条消息附件数 | 最多 6 个 |
| 单张图片 | 最多 4 MiB |
| 单个普通文件 | 最多 8 MiB |
| 单条消息附件总量 | 最多 16 MiB |
| 图片格式 | PNG / JPEG / WebP / GIF |

前端限制用于即时反馈；Rust Host 必须独立复验。

## 4. 本地附件存储

附件由 Tauri Host 写入：

```text
~/.shadow-crew/attachments/
  <scopeType>/
    <scopeId>/
      <messageId>/
        <attachmentId>-<safeFileName>
```

`scopeType` 为：

- `channel`
- `topic`
- `dm`
- `dm_topic`

Rust Host 会：

1. 重新 Base64 解码；
2. 校验声明大小与实际大小；
3. 校验图片文件头；
4. 清理目录段和文件名中的路径字符；
5. 写入私有附件目录；
6. 返回规范化绝对 `path` 和 `file://` URI。

WebView 不能通过自报 `path` 读取附件目录外文件。ACP 投递前 Host 会 canonicalize 路径并确认其仍位于 `~/.shadow-crew/attachments` 下。

## 5. ACP Content Blocks

ACP Prompt 从单文本块扩展为：

```json
[
  { "type": "text", "text": "用户文本 + 附件清单" },
  { "type": "image", "data": "...", "mimeType": "image/png" },
  {
    "type": "resource",
    "resource": {
      "uri": "file:///...",
      "mimeType": "text/markdown",
      "text": "..."
    }
  }
]
```

### 5.1 图片

只有当 ACP `initialize` 返回：

```json
{
  "agentCapabilities": {
    "promptCapabilities": {
      "image": true
    }
  }
}
```

才发送 `image` block。未声明图片能力时本轮 Fail-Closed，不静默删除图片。

### 5.2 文件

文件 Content Block 采用两级策略：

- Agent 声明 `embeddedContext=true`：发送 `resource`，Host 直接内嵌 UTF-8 文本或 Base64 Blob；
- 未声明 embedded context：发送 ACP 基线 `resource_link`，包含 URI、文件名、MIME、大小。

这保证普通文件不依赖视觉模型能力，同时尽量优先使用无额外 IO 的 embedded resource。

## 6. Session 与历史

- 附件随当前用户消息进入本轮 ACP Prompt；
- 图片/文件块只在本次发送中传输；
- ACP Session 后的上下文保存、压缩与恢复由 ACP 端点负责；
- Shadow Crew 消息历史独立保存附件元数据和图片预览；
- 同一轮并发 Fan-out 时，每个被唤醒 Agent 都收到同一附件集合。

## 7. 远程 WebSocket

本期不发送远程附件。检测到远程 Agent 且消息包含附件时：

```text
当前远程 ACP 附件同步尚未实现，本轮已阻断
```

禁止只发送文本元数据并静默丢弃图片/文件。后续远程协议需要单独设计：

- 分段上传；
- URI 授权；
- 远程资源生命周期；
- 大文件与临时 URL 鉴权。

## 8. 安全与失败策略

- 扩展名不作为唯一 MIME 依据；
- 图片必须通过文件头校验；
- 前端和 Rust Host 双重校验；
- 附件 URI 由 Host 根据已验证绝对路径重算；
- 越出附件根目录的路径直接拒绝；
- 附件大小变化后拒绝发送；
- 附件保存失败时不提交用户消息；
- 图片能力不满足时显示明确 ACP 错误。

## 9. 验收

- 文件选择、粘贴、拖放均可添加图片和文件；
- 图片显示缩略图，文件显示卡片；
- 附件-only 消息可以发送；
- 刷新和重启后附件仍显示；
- 多 Agent 并发首轮均收到附件；
- ACP 收到正确的 `text/image/resource/resource_link` block；
- 超限、伪造图片和路径逃逸被拒绝；
- 远程 WebSocket 不会被静默降级。
