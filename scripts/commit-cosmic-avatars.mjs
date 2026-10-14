/**
 * scripts/commit-cosmic-avatars.mjs
 * 一键在 public/avatars/ 生成 8 枚「宇宙×神话」抽象几何图腾头像 + TS 映射配置，并提交至本地 Git 仓库
 * 运行方式: node scripts/commit-cosmic-avatars.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const AVATARS_DIR = path.resolve(process.cwd(), 'public/avatars');
const CONFIG_FILE = path.resolve(process.cwd(), 'src/config/cosmicAvatars.ts');

fs.mkdirSync(AVATARS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });

const THEMES = [
  {
    id: 'polaris-proposer',
    name: 'Polaris Astrolabe (Proposer)',
    bgStart: '#071324',
    bgEnd: '#030914',
    ringColor: '#164e63',
    glowColor: '#06b6d4',
    primaryFill: '#06b6d4',
    secondaryFill: '#3b82f6',
    geometryType: 'compass8',
  },
  {
    id: 'ra-eclipse-critic',
    name: 'Eye of Ra Eclipse (Critic)',
    bgStart: '#22080c',
    bgEnd: '#0f0305',
    ringColor: '#7f1d1d',
    glowColor: '#ef4444',
    primaryFill: '#ef4444',
    secondaryFill: '#f97316',
    geometryType: 'eclipseEye',
  },
  {
    id: 'astraea-arbiter',
    name: 'Astraea Binary Star (Arbiter)',
    bgStart: '#170d2e',
    bgEnd: '#090414',
    ringColor: '#581c87',
    glowColor: '#a855f7',
    primaryFill: '#8b5cf6',
    secondaryFill: '#eab308',
    geometryType: 'binaryStar',
  },
  {
    id: 'ouroboros-synthesizer',
    name: 'Ouroboros Hexagram Nebula (Synthesizer)',
    bgStart: '#06241f',
    bgEnd: '#02100e',
    ringColor: '#115e59',
    glowColor: '#10b981',
    primaryFill: '#10b981',
    secondaryFill: '#14b8a6',
    geometryType: 'hexagram',
  },
  {
    id: 'apollo-supernova',
    name: 'Apollo Supernova (Claude Code)',
    bgStart: '#241006',
    bgEnd: '#120702',
    ringColor: '#7c2d12',
    glowColor: '#f97316',
    primaryFill: '#f97316',
    secondaryFill: '#fbbf24',
    geometryType: 'supernova4',
  },
  {
    id: 'athena-pulsar',
    name: 'Athena Pulsar Shield (Codex)',
    bgStart: '#0b192c',
    bgEnd: '#050b14',
    ringColor: '#1e3a8a',
    glowColor: '#38bdf8',
    primaryFill: '#38bdf8',
    secondaryFill: '#818cf8',
    geometryType: 'aegisPulsar',
  },
  {
    id: 'hermes-quasar',
    name: 'Hermes Quasar Wings (Gemini)',
    bgStart: '#260824',
    bgEnd: '#110310',
    ringColor: '#701a75',
    glowColor: '#ec4899',
    primaryFill: '#ec4899',
    secondaryFill: '#a855f7',
    geometryType: 'quasarTwin',
  },
  {
    id: 'chronos-horizon',
    name: 'Chronos Event Horizon (DeepSeek)',
    bgStart: '#1c1608',
    bgEnd: '#0c0903',
    ringColor: '#713f12',
    glowColor: '#eab308',
    primaryFill: '#eab308',
    secondaryFill: '#f59e0b',
    geometryType: 'chronosRing',
  },
];

function renderGeometry(t) {
  switch (t.geometryType) {
    case 'compass8':
      return `
        <polygon points="100,24 116,84 176,100 116,116 100,176 84,116 24,100 84,84" fill="${t.primaryFill}" fill-opacity="0.72" stroke="#ffffff" stroke-width="1.8"/>
        <polygon points="100,40 112,88 160,100 112,112 100,160 88,112 40,100 88,88" transform="rotate(45 100 100)" fill="${t.secondaryFill}" fill-opacity="0.52" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.8"/>
      `;
    case 'eclipseEye':
      return `
        <polygon points="100,28 122,78 172,100 122,122 100,172 78,122 28,100 78,78" fill="${t.secondaryFill}" fill-opacity="0.45" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.75"/>
        <path d="M 32 100 Q 100 52 168 100 Q 100 148 32 100 Z" fill="${t.primaryFill}" fill-opacity="0.75" stroke="#ffffff" stroke-width="2"/>
        <polygon points="100,62 138,100 100,138 62,100" fill="${t.secondaryFill}" fill-opacity="0.65" stroke="#ffffff" stroke-width="1.4"/>
      `;
    case 'binaryStar':
      return `
        <polygon points="100,26 118,82 174,100 118,118 100,174 82,118 26,100 82,82" fill="${t.primaryFill}" fill-opacity="0.72" stroke="#ffffff" stroke-width="1.8"/>
        <polygon points="100,32 118,82 168,100 118,118 100,168 82,118 32,100 82,82" transform="rotate(45 100 100)" fill="${t.secondaryFill}" fill-opacity="0.58" stroke="#ffffff" stroke-width="1.5"/>
      `;
    case 'hexagram':
      return `
        <polygon points="100,30 160,134 40,134" fill="${t.primaryFill}" fill-opacity="0.62" stroke="#ffffff" stroke-width="1.8"/>
        <polygon points="100,170 160,66 40,66" fill="${t.secondaryFill}" fill-opacity="0.62" stroke="#ffffff" stroke-width="1.8"/>
        <circle cx="100" cy="100" r="46" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-opacity="0.7"/>
      `;
    case 'supernova4':
      return `
        <polygon points="72,62 128,62 128,138 72,138" transform="rotate(45 100 100)" fill="${t.secondaryFill}" fill-opacity="0.42" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.7"/>
        <polygon points="100,24 118,82 176,100 118,118 100,176 82,118 24,100 82,82" fill="${t.primaryFill}" fill-opacity="0.82" stroke="#ffffff" stroke-width="2"/>
        <polygon points="100,56 115,85 144,100 115,115 100,144 85,115 56,100 85,85" fill="#ffffff" fill-opacity="0.22"/>
      `;
    case 'aegisPulsar':
      return `
        <polygon points="100,28 152,50 172,100 152,150 100,172 48,150 28,100 48,50" fill="${t.secondaryFill}" fill-opacity="0.38" stroke="#ffffff" stroke-width="1.4"/>
        <polygon points="100,22 114,86 178,100 114,114 100,178 86,114 22,100 86,86" fill="${t.primaryFill}" fill-opacity="0.78" stroke="#ffffff" stroke-width="1.8"/>
      `;
    case 'quasarTwin':
      return `
        <polygon points="100,24 124,76 176,100 124,124 100,176 76,124 24,100 76,76" transform="rotate(22.5 100 100)" fill="${t.secondaryFill}" fill-opacity="0.50" stroke="#ffffff" stroke-width="1.3"/>
        <polygon points="100,24 115,85 176,100 115,115 100,176 85,115 24,100 85,85" transform="rotate(-22.5 100 100)" fill="${t.primaryFill}" fill-opacity="0.76" stroke="#ffffff" stroke-width="1.8"/>
      `;
    case 'chronosRing':
    default:
      return `
        <ellipse cx="100" cy="100" rx="72" ry="26" transform="rotate(-28 100 100)" fill="none" stroke="${t.secondaryFill}" stroke-width="4" stroke-opacity="0.65"/>
        <ellipse cx="100" cy="100" rx="72" ry="26" transform="rotate(-28 100 100)" fill="none" stroke="#ffffff" stroke-width="1.4"/>
        <polygon points="64,42 136,42 100,100 136,158 64,158 100,100" fill="${t.primaryFill}" fill-opacity="0.72" stroke="#ffffff" stroke-width="1.8"/>
      `;
  }
}

function buildSvg(t) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <radialGradient id="bg-${t.id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${t.bgStart}"/>
      <stop offset="100%" stop-color="${t.bgEnd}"/>
    </radialGradient>
    <radialGradient id="glow-${t.id}" cx="50%" cy="50%" r="42%">
      <stop offset="0%" stop-color="${t.glowColor}" stop-opacity="0.68"/>
      <stop offset="65%" stop-color="${t.glowColor}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${t.glowColor}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- 外层深空圆章底盘 -->
  <circle cx="100" cy="100" r="96" fill="url(#bg-${t.id})" stroke="${t.ringColor}" stroke-width="2.5"/>
  <circle cx="100" cy="100" r="86" fill="none" stroke="${t.ringColor}" stroke-width="1.2" stroke-opacity="0.65"/>
  <!-- 中心星云径向发光层 -->
  <circle cx="100" cy="100" r="76" fill="url(#glow-${t.id})"/>
  <!-- 抽象神话与宇宙几何切面 -->
  ${renderGeometry(t)}
  <!-- 标志性虚线星轨环与中心白炽奇点 -->
  <circle cx="100" cy="100" r="22" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-dasharray="4 4" stroke-opacity="0.92"/>
  <circle cx="100" cy="100" r="7.5" fill="#ffffff"/>
</svg>`;
}

const exportEntries = [];

for (const theme of THEMES) {
  const svgContent = buildSvg(theme);
  const filePath = path.join(AVATARS_DIR, `${theme.id}.svg`);
  fs.writeFileSync(filePath, svgContent, 'utf8');
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
  exportEntries.push(
    `  '${theme.id}': {\n    name: '${theme.name}',\n    publicPath: '/avatars/${theme.id}.svg',\n    dataUri: "${dataUri}",\n  }`
  );
  console.log(`✅ Generated: public/avatars/${theme.id}.svg`);
}

const tsContent = `/**
 * Auto-generated Cosmic Mythology Abstract Geometric Avatars for Shadow-Crew
 */
export const COSMIC_MYTHOLOGY_AVATARS = {
${exportEntries.join(',\n')}
} as const;

export type CosmicAvatarKey = keyof typeof COSMIC_MYTHOLOGY_AVATARS;
`;

fs.writeFileSync(CONFIG_FILE, tsContent, 'utf8');
console.log(`✅ Generated TypeScript config: src/config/cosmicAvatars.ts`);

try {
  execSync('git add public/avatars/*.svg src/config/cosmicAvatars.ts', {
    stdio: 'inherit',
  });
  execSync(
    'git commit -m "feat(ui): add abstract cosmic mythology geometric agent avatars"',
    { stdio: 'inherit' }
  );
  console.log('🎉 Successfully committed avatars to local repository! Run `git push` to publish.');
} catch (err) {
  console.warn(
    '⚠️ Files generated successfully. Please run `git add` and `git commit` manually if needed.'
  );
}
