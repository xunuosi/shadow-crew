/**
 * 补丁应用后的真实验证闭环
 *
 * 职责：
 * 1. 从工作区 package.json 推导真实存在的验证脚本（lint / build），不猜测项目类型；
 * 2. 通过 Rust `run_workspace_command` 在 Workspace Binding 根目录执行白名单命令；
 * 3. 返回真实 exit code、耗时与输出尾部，作为「验证通过/失败」的唯一证据；
 * 4. 无 Tauri IPC 或无可执行脚本时明确标记 skipped，绝不伪造 passed。
 */

import type {
  WorkspaceVerificationCommandResult,
  WorkspaceVerificationReport,
} from '../types';
import { resolveTauriInvoke } from './acpClient';

export interface WorkspaceVerificationCommand {
  label: string;
  program: string;
  args: string[];
  timeoutSecs: number;
}

export interface VerifyWorkspaceOptions {
  workspaceBindingId: string;
  workspaceRoot: string;
  channelId: string;
  topicId: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function skippedReport(reason: string, commands: WorkspaceVerificationCommandResult[] = []): WorkspaceVerificationReport {
  return {
    status: 'skipped',
    checkedAt: nowIso(),
    commands,
    summary: `未执行验证：${reason}`,
    skippedReason: reason,
  };
}

async function readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string | null> {
  const invoke = resolveTauriInvoke();
  if (!invoke) return null;
  const separator = workspaceRoot.includes('\\') ? '\\' : '/';
  const trimmedRoot = workspaceRoot.replace(/[\\/]+$/, '');
  try {
    return await invoke('read_workspace_file_sandboxed', {
      path: `${trimmedRoot}${separator}${relativePath}`,
      allowedRoot: workspaceRoot,
    });
  } catch {
    return null;
  }
}

/**
 * 仅根据 package.json 中真实存在的 scripts 生成验证计划。
 * 不猜测、不补默认值：没有 lint/build 脚本就不执行对应命令。
 */
export async function buildWorkspaceVerificationPlan(
  workspaceRoot: string
): Promise<WorkspaceVerificationCommand[]> {
  const packageRaw = await readWorkspaceFile(workspaceRoot, 'package.json');
  if (!packageRaw) return [];

  let packageJson: unknown;
  try {
    packageJson = JSON.parse(packageRaw);
  } catch {
    return [];
  }
  if (!packageJson || typeof packageJson !== 'object') return [];
  const scripts = (packageJson as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== 'object') return [];

  const scriptMap = scripts as Record<string, unknown>;
  const plan: WorkspaceVerificationCommand[] = [];
  if (typeof scriptMap.lint === 'string' && scriptMap.lint.trim()) {
    plan.push({
      label: 'TypeScript / Lint 静态检查',
      program: 'npm',
      args: ['run', 'lint'],
      timeoutSecs: 180,
    });
  }
  if (typeof scriptMap.build === 'string' && scriptMap.build.trim()) {
    plan.push({
      label: '生产构建校验',
      program: 'npm',
      args: ['run', 'build'],
      timeoutSecs: 300,
    });
  }
  return plan;
}

async function runVerificationCommand(
  options: VerifyWorkspaceOptions,
  command: WorkspaceVerificationCommand
): Promise<WorkspaceVerificationCommandResult> {
  const invoke = resolveTauriInvoke();
  if (!invoke) {
    return {
      label: command.label,
      program: command.program,
      args: command.args,
      exitCode: null,
      success: false,
      timedOut: false,
      durationMs: 0,
      stdout: '',
      stderr: '',
      error: '当前运行环境没有 Tauri IPC，验证命令未执行',
    };
  }

  try {
    const res = await invoke('run_workspace_command', {
      workspaceBindingId: options.workspaceBindingId,
      channelId: options.channelId || 'general',
      topicId: options.topicId,
      program: command.program,
      args: command.args,
      timeoutSecs: command.timeoutSecs,
    });
    return {
      label: command.label,
      program: res?.program || command.program,
      args: res?.args || command.args,
      exitCode: typeof res?.exit_code === 'number' ? res.exit_code : null,
      success: Boolean(res?.success),
      timedOut: Boolean(res?.timed_out),
      durationMs: Number(res?.duration_ms) || 0,
      stdout: res?.stdout || '',
      stderr: res?.stderr || '',
      error: res?.error || undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      label: command.label,
      program: command.program,
      args: command.args,
      exitCode: null,
      success: false,
      timedOut: false,
      durationMs: 0,
      stdout: '',
      stderr: '',
      error: `验证命令调用失败: ${message}`,
    };
  }
}

/**
 * 顺序执行验证计划；前序命令失败后立即停止，避免重复消耗时间。
 * 所有返回结果都来自宿主真实执行。
 */
export async function verifyWorkspaceAfterPatch(
  options: VerifyWorkspaceOptions
): Promise<WorkspaceVerificationReport> {
  const invoke = resolveTauriInvoke();
  if (!invoke) {
    return skippedReport('当前为浏览器预览环境，无法执行本地验证命令');
  }

  const plan = await buildWorkspaceVerificationPlan(options.workspaceRoot);
  if (plan.length === 0) {
    return skippedReport(
      '未检测到可执行的验证脚本（需在 package.json 中定义 scripts.lint 或 scripts.build）'
    );
  }

  const commands: WorkspaceVerificationCommandResult[] = [];
  for (const command of plan) {
    const result = await runVerificationCommand(options, command);
    commands.push(result);
    if (!result.success) break;
  }

  const failed = commands.find((command) => !command.success);
  if (!failed) {
    return {
      status: 'passed',
      checkedAt: nowIso(),
      commands,
      summary: `验证通过：${commands.map((command) => command.label).join('、')}`,
    };
  }

  return {
    status: 'failed',
    checkedAt: nowIso(),
    commands,
    summary: `${failed.label} 失败（exit=${failed.exitCode ?? 'null'}${failed.timedOut ? '，超时' : ''}）`,
  };
}

/** 将验证报告格式化为可直接展示在消息流中的证据块。 */
export function formatVerificationReport(report: WorkspaceVerificationReport): string {
  if (report.status === 'skipped') {
    return `⏭️ **验证未执行**：${report.skippedReason || report.summary}`;
  }
  const icon = report.status === 'passed' ? '✅' : report.status === 'running' ? '⏳' : '❌';
  const lines = [`${icon} **宿主验证${report.status === 'passed' ? '通过' : report.status === 'running' ? '进行中' : '失败'}**：${report.summary}`];
  for (const command of report.commands) {
    lines.push(
      `- **${command.label}**（\`${command.program} ${command.args.join(' ')}\`）：` +
        `${command.success ? '通过' : '失败'} · exit=${command.exitCode ?? 'null'} · ${command.durationMs}ms` +
        `${command.timedOut ? ' · 超时' : ''}`
    );
  }
  return lines.join('\n');
}

/** 把失败命令的真实输出压缩成可回注给执行 Agent 的修复证据。 */
export function extractVerificationFailureDigest(
  report: WorkspaceVerificationReport,
  maxChars = 3500
): string {
  const lines: string[] = [];
  for (const command of report.commands) {
    if (command.success) continue;
    lines.push(
      `$ ${command.program} ${command.args.join(' ')}\n` +
        `exit=${command.exitCode ?? 'null'} timed_out=${command.timedOut} duration_ms=${command.durationMs}` +
        `${command.error ? `\nerror: ${command.error}` : ''}`
    );
    const stderr = command.stderr.trim();
    const stdout = command.stdout.trim();
    if (stderr) lines.push(`stderr:\n${stderr}`);
    if (stdout) lines.push(`stdout:\n${stdout}`);
  }
  const digest = lines.join('\n\n');
  if (digest.length <= maxChars) return digest;
  return `${digest.slice(0, maxChars)}\n…（验证输出已截断，共 ${digest.length} 字符）`;
}
