import assert from 'node:assert/strict';
import { parseAcpTokenUsage } from './acpClient';

// 契约：ACP v2 unstable `usage` 原样透传；字段缺失/非法一律视为「未上报」，绝不估算。

assert.equal(parseAcpTokenUsage(undefined), undefined, 'undefined 应视为未上报');
assert.equal(parseAcpTokenUsage(null), undefined, 'null 应视为未上报');
assert.equal(parseAcpTokenUsage('123'), undefined, '字符串应视为未上报');
assert.equal(parseAcpTokenUsage({}), undefined, '空对象应视为未上报');
assert.equal(
  parseAcpTokenUsage({ inputTokens: '100', outputTokens: null }),
  undefined,
  '非法类型不得被强转为数字'
);
assert.equal(
  parseAcpTokenUsage({ inputTokens: -5, outputTokens: -1 }),
  undefined,
  '负数不得视为有效用量'
);

const full = parseAcpTokenUsage({
  inputTokens: 1200,
  outputTokens: 340,
  totalTokens: 1540,
  thoughtTokens: 200,
  cachedReadTokens: 900,
  cachedWriteTokens: null,
});
assert.deepEqual(
  full,
  {
    inputTokens: 1200,
    outputTokens: 340,
    totalTokens: 1540,
    thoughtTokens: 200,
    cachedReadTokens: 900,
    cachedWriteTokens: null,
  },
  '完整上报应逐字段保留（null 可选计数保持 null）'
);

const onlyTotal = parseAcpTokenUsage({ totalTokens: 777 });
assert.deepEqual(
  onlyTotal,
  {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 777,
    thoughtTokens: undefined,
    cachedReadTokens: undefined,
    cachedWriteTokens: undefined,
  },
  '仅上报 totalTokens 时应保留真值，输入输出补 0 而不是凭空估算'
);

const derivedTotal = parseAcpTokenUsage({ inputTokens: 10, outputTokens: 5 });
assert.equal(derivedTotal?.totalTokens, 15, '缺失 totalTokens 时按输入+输出求和');

const rounded = parseAcpTokenUsage({ inputTokens: 10.6, outputTokens: 4.4, totalTokens: 15 });
assert.equal(rounded?.inputTokens, 11, '非整数应四舍五入为整数 token');
assert.equal(rounded?.outputTokens, 4, '非整数应四舍五入为整数 token');

console.log('✅ acp-usage: 12 条 token 用量契约断言全部通过');
