/**
 * CognoNexus 神经符号确定性运筹决策求解器 (M2 精确线性 BWM 求解器测试)
 * 验证：
 * 1. FLAT 平坦无偏好向量拦截（理由：insufficient_information）
 * 2. Rezaei (2015, Omega) 经典 5 准则算例求解回归测试 (maxDiff < 0.035)
 * 3. solveDeterministicBwm 业务 API 闭环验证
 */

import { solveExactBwmOptionB, solveDeterministicBwm, BWM_CONSISTENCY_INDEX_TABLE } from './mcdaDeterministicSolver';

export function runRezaeiGoldenTest() {
  console.log('=== [R-2 门禁回归测试] Rezaei (2015, Omega) Golden Test ===');

  // 1. 验证 FLAT 被拒门禁 (R-2 条件 1)
  console.log('\n[测试 1] 平坦无偏好向量 (FLAT) 拒绝门禁:');
  try {
    solveExactBwmOptionB({
      n: 3,
      bestIdx: 0,
      worstIdx: 2,
      bestToOthers: [1, 1, 1],
      othersToWorst: [1, 1, 1],
    });
    throw new Error('❌ FLAT 输入未被拦截！');
  } catch (err: any) {
    if (err.message === 'insufficient_information' || err.code === 'insufficient_information') {
      console.log('  ✓ [通过] FLAT 偏好输入成功被拦截，理由=insufficient_information');
    } else {
      throw err;
    }
  }

  // 验证 solveDeterministicBwm 对退化输入的安全拒识能力 (throwOnDegeneracy: false)
  const rejectedPayload = solveDeterministicBwm({
    criteria: [
      { id: 'c1', name: 'C1', direction: 'maximize' },
      { id: 'c2', name: 'C2', direction: 'maximize' },
      { id: 'c3', name: 'C3', direction: 'maximize' },
    ],
    alternatives: ['AltA', 'AltB'],
    scoreMatrix: { AltA: { c1: 8, c2: 8, c3: 8 }, AltB: { c1: 6, c2: 6, c3: 6 } },
    bestCriterionId: 'c1',
    worstCriterionId: 'c3',
    bestToOthers: [1, 1, 1],
    othersToWorst: [1, 1, 1],
    throwOnDegeneracy: false,
  });

  if (rejectedPayload.status === 'rejected' && rejectedPayload.rejectionReason === 'insufficient_information') {
    console.log('  ✓ [通过] solveDeterministicBwm 拒识状态与理由正确返回: status=rejected, reason=insufficient_information');
  } else {
    throw new Error(`❌ solveDeterministicBwm 拒识处理不符预期: ${JSON.stringify(rejectedPayload)}`);
  }

  // 2. 验证 Rezaei (2015) 经典论文算例 (Omega 53, pp. 53-54)
  console.log('\n[测试 2] Rezaei (2015, Omega) 经典 5 准则算例求解回归:');
  const result = solveExactBwmOptionB({
    n: 5,
    bestIdx: 1, // C2 是最优
    worstIdx: 3, // C4 是最差
    bestToOthers: [2, 1, 4, 8, 3],
    othersToWorst: [4, 8, 2, 1, 3],
  });

  console.log('  计算权重 w*:', result.weights.map((w) => Math.round(w * 1000) / 1000));
  console.log('  一致性指标 ξ*:', Math.round(result.xi * 10000) / 10000);

  // 论文理论基准值:
  // C1=0.221, C2=0.441, C3=0.110, C4=0.055, C5=0.173
  const theoreticalWeights = [0.221, 0.441, 0.110, 0.055, 0.173];

  let maxDiff = 0;
  result.weights.forEach((w, i) => {
    const diff = Math.abs(w - theoreticalWeights[i]);
    if (diff > maxDiff) maxDiff = diff;
    console.log(`    C${i + 1}: 计算值=${w.toFixed(4)}, 论文基准=${theoreticalWeights[i].toFixed(4)}, 偏差=${diff.toFixed(4)}`);
  });

  console.log(`    最大绝对权重偏差: ${maxDiff.toFixed(4)}`);
  if (maxDiff < 0.035) {
    console.log('\n✅ [R-2 通过] 论文算例回归吻合度达标 (maxDiff < 0.035)!');
    return true;
  } else {
    throw new Error(`❌ [R-2 失败] 求解结果与论文理论值偏差过大 (maxDiff=${maxDiff})`);
  }
}

if (process.argv[1]?.endsWith('test-exact-bwm.ts')) {
  try {
    runRezaeiGoldenTest();
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
