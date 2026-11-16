import assert from 'node:assert/strict';
import {
  parseAcpConfigOptions,
  findAcpModelOption,
  setAcpConfigOption,
} from './acpClient';

// 契约：ACP v2 unstable `configOptions` 只接受运行时真实声明的结构。
// 缺失字段、非法类型一律丢弃（禁止猜测补位），模型选择仅认 category/id 语义。

assert.deepEqual(parseAcpConfigOptions(undefined), [], 'undefined 应解析为空数组');
assert.deepEqual(parseAcpConfigOptions(null), [], 'null 应解析为空数组');
assert.deepEqual(parseAcpConfigOptions({ id: 'model' }), [], '非数组载荷应解析为空数组');
assert.deepEqual(parseAcpConfigOptions(['x', null, 42]), [], '非对象条目应被丢弃');

assert.deepEqual(
  parseAcpConfigOptions([{ name: 'Model', currentValue: 'a' }]),
  [],
  '缺失 id 的条目必须丢弃'
);
assert.deepEqual(
  parseAcpConfigOptions([{ id: 'model', currentValue: 'a' }]),
  [],
  '缺失 name 的条目必须丢弃'
);
assert.deepEqual(
  parseAcpConfigOptions([{ id: 'model', name: 'Model', currentValue: null }]),
  [],
  '缺失/非法 currentValue 的条目必须丢弃'
);
assert.deepEqual(
  parseAcpConfigOptions([{ id: 'model', name: 'Model', currentValue: {} }]),
  [],
  '对象型 currentValue 必须丢弃'
);

const numeric = parseAcpConfigOptions([
  { id: 'effort', name: 'Effort', type: 'select', currentValue: 3 },
]);
assert.equal(numeric.length, 1, '数值 currentValue 应被接受');
assert.equal(numeric[0].currentValue, '3', '数值 currentValue 应字符串化为选中值');
assert.equal(numeric[0].type, 'select', 'type 缺失时回退为 select');

const full = parseAcpConfigOptions([
  {
    id: 'model',
    name: 'Model',
    description: '运行时模型',
    category: 'model',
    type: 'select',
    currentValue: 'claude-sonnet',
    options: [
      { value: 'claude-sonnet', name: 'Claude Sonnet', description: '默认' },
      { value: 'claude-opus' }, // name 缺失 → 回退为 value
      { name: '缺少 value' }, // 非法候选项 → 丢弃
      null,
    ],
  },
]);
assert.equal(full.length, 1, '完整条目应保留');
assert.deepEqual(full[0].options, [
  { value: 'claude-sonnet', name: 'Claude Sonnet', description: '默认' },
  { value: 'claude-opus', name: 'claude-opus' },
], '候选值应过滤非法项，并把缺失 name 回退为 value');
assert.equal(full[0].category, 'model', 'category 应保留');
assert.equal(full[0].description, '运行时模型', 'description 应保留');

assert.equal(findAcpModelOption(undefined), undefined, '无配置项时不存在模型项');
assert.equal(findAcpModelOption([]), undefined, '空配置项时不存在模型项');
assert.equal(
  findAcpModelOption(parseAcpConfigOptions([
    { id: 'effort', name: 'Effort', type: 'select', currentValue: 'high' },
  ])),
  undefined,
  '非模型配置项不得被识别为模型选择'
);

const byCategory = findAcpModelOption(
  parseAcpConfigOptions([
    { id: 'llm_choice', name: 'LLM', category: 'MODEL', type: 'select', currentValue: 'a' },
  ])
);
assert.ok(byCategory, 'category 大小写不敏感匹配 model');
assert.equal(byCategory?.id, 'llm_choice');

const byId = findAcpModelOption(
  parseAcpConfigOptions([
    { id: 'Model', name: 'Model', type: 'select', currentValue: 'a' },
  ])
);
assert.ok(byId, '无 category 时按 id 大小写不敏感匹配 model');
assert.equal(byId?.id, 'Model');

// 非 Tauri 环境必须显式拒绝，而不是静默返回空列表冒充成功。
await assert.rejects(
  () =>
    setAcpConfigOption({
      agentId: 'a',
      sessionKey: 'dm:a:t',
      configId: 'model',
      value: 'x',
    }),
  /非 Tauri 运行期/,
  '非 Tauri 运行期下发配置必须显式报错'
);

console.log('✅ acp-config-options: 18 条会话配置项契约断言全部通过');
