import { AgentSkill } from '../types';

export const BUILTIN_SKILLS: AgentSkill[] = [
  {
    id: 'skill-red-team-falsification',
    name: '红队反从众证伪与缺陷压测',
    description: 'Free-MAD 红队反从众四部曲批判与反例压测契约，调用 submit_challenge_critique 原生工具定位逻辑破绽、隐含假设与边缘失效。',
    type: 'builtin',
    mcpServer: 'shadow-crew-dev-mcp',
    commandSnippet: 'submit_challenge_critique',
  },
  {
    id: 'skill-grounding-verification',
    name: '物理接地验证与代码沙箱实证',
    description: '客观物理接地反事实实证规约，基于 AST 检索或测试沙箱输出真实证据，调用 submit_grounding_evidence 提交真值判定。',
    type: 'builtin',
    mcpServer: 'shadow-crew-dev-mcp',
    commandSnippet: 'submit_grounding_evidence',
  },
  {
    id: 'skill-gframe-modular-executor',
    name: 'G-Frame 模块化执行与爆炸半径隔离',
    description: 'G-Frame 拓扑分治串行落地执行规约，调用 validate_workspace_diff 预检防冲突，调用 submit_execution_deliverable 提交交付物。',
    type: 'builtin',
    mcpServer: 'shadow-crew-dev-mcp',
    commandSnippet: 'submit_execution_deliverable',
  },
  {
    id: 'skill-living-adr-governance',
    name: '活体 ADR 决策治理与运筹仲裁',
    description: '多准则运筹决策求解与活体 ADR 决策画布演进治理规约，调用 submit_arbitration_ruling 提交三态终局裁决选项。',
    type: 'builtin',
    mcpServer: 'shadow-crew-dev-mcp',
    commandSnippet: 'submit_arbitration_ruling',
  },
];

export function getBuiltinSkill(id: string): AgentSkill | undefined {
  return BUILTIN_SKILLS.find((s) => s.id === id);
}
