import React from 'react';

interface AgentAvatarArtworkProps {
  type?: string;
  name?: string;
  avatar?: string;
  className?: string;
}

export function resolveArtworkType(avatar?: string, type?: string, name?: string): string {
  // 1. Check explicit avatar emoji or id first
  if (avatar) {
    if (avatar === '🥷' || avatar === 'shinobi') return 'shinobi';
    if (avatar === '🤖' || avatar === 'codex') return 'codex';
    if (avatar === '✨' || avatar === '🪷' || avatar === 'claudecode' || avatar === 'claude') return 'claudecode';
    if (avatar === '🐳' || avatar === '🐋' || avatar === '🐞' || avatar === 'deepseek' || avatar === 'alien') return 'deepseek';
    if (avatar === '🦗' || avatar === 'openclaw' || avatar === 'mantis') return 'openclaw';
    if (avatar === '⚡' || avatar === 'bolt' || avatar === 'turbo') return 'bolt';
    if (avatar === '🛡️' || avatar === 'sentinel' || avatar === 'shield') return 'sentinel';
    if (avatar === '🧭' || avatar === 'astra') return 'astra';
    if (avatar === '🎨' || avatar === 'palette' || avatar === 'artisan') return 'palette';
  }

  // 2. Check type prop
  if (type) {
    const t = type.toLowerCase();
    if (t === 'shinobi' || t.includes('ninja')) return 'shinobi';
    if (t === 'codex' || t.includes('openai') || t.includes('gpt')) return 'codex';
    if (t === 'claudecode' || t.includes('claude') || t.includes('anthropic')) return 'claudecode';
    if (t === 'deepseek' || t.includes('whale') || t === 'alien') return 'deepseek';
    if (t === 'openclaw' || t.includes('mantis') || t.includes('claw')) return 'openclaw';
    if (t === 'bolt' || t.includes('lightning') || t.includes('turbo')) return 'bolt';
    if (t === 'sentinel' || t.includes('shield') || t.includes('guard')) return 'sentinel';
    if (t === 'astra' || t.includes('compass') || t.includes('star')) return 'astra';
    if (t === 'palette' || t.includes('art') || t.includes('paint') || t.includes('artisan')) return 'palette';
  }

  // 3. Fallback to name heuristic only if avatar/type did not match a preset
  const n = (name || '').toLowerCase();
  if (n.includes('shinobi') || n.includes('ninja')) return 'shinobi';
  if (n.includes('codex') || n.includes('openai')) return 'codex';
  if (n.includes('claudecode') || n.includes('claude')) return 'claudecode';
  if (n.includes('deepseek') || n.includes('whale') || n.includes('alien')) return 'deepseek';
  if (n.includes('openclaw') || n.includes('claw') || n.includes('mantis')) return 'openclaw';
  if (n.includes('bolt') || n.includes('turbo') || n.includes('speed')) return 'bolt';
  if (n.includes('sentinel') || n.includes('shield') || n.includes('guard')) return 'sentinel';
  if (n.includes('astra') || n.includes('compass')) return 'astra';
  if (n.includes('artistry') || n.includes('palette') || n.includes('artisan')) return 'palette';

  return 'other';
}

export const AgentAvatarArtwork: React.FC<AgentAvatarArtworkProps> = ({
  type,
  name,
  avatar,
  className = 'w-20 h-20',
}) => {
  const artwork = resolveArtworkType(avatar, type, name);

  // 1. Shinobi - Cyber Stealth Ninja Mask (DEFAULT)
  if (artwork === 'shinobi') {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#18263a] via-[#0d1624] to-[#060a10] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="shinoBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="50%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#020617" />
            </linearGradient>
            <linearGradient id="shinoCyan" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="50%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
            <linearGradient id="shinoMetal" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#64748b" />
              <stop offset="100%" stopColor="#334155" />
            </linearGradient>
            <radialGradient id="shinoGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#0891b2" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Outer Rim */}
          <circle cx="50" cy="50" r="46" fill="url(#shinoBg)" stroke="#1e293b" strokeWidth="1.5" />
          {/* Stealth Hood / Cowl */}
          <path d="M24 46 C24 22 76 22 76 46 C76 76 66 86 50 86 C34 86 24 76 24 46 Z" fill="#090d16" stroke="#1e293b" strokeWidth="1.5" />
          {/* Inner Shadow / Folds */}
          <path d="M28 44 C28 26 72 26 72 44 C72 68 64 78 50 78 C36 78 28 68 28 44 Z" fill="#0f172a" />
          {/* Stealth Headband Plate */}
          <path d="M26 36 Q50 32 74 36 L72 44 Q50 40 28 44 Z" fill="url(#shinoMetal)" stroke="#475569" strokeWidth="1" />
          {/* Headband Shuriken Star Crest */}
          <g transform="translate(50, 38) scale(0.65)">
            <polygon points="0,-8 3,-3 8,0 3,3 0,8 -3,3 -8,0 -3,-3" fill="#22d3ee" />
            <circle cx="0" cy="0" r="2" fill="#0f172a" />
          </g>
          {/* Face Mask Void */}
          <path d="M30 46 Q50 44 70 46 L68 56 Q50 59 32 56 Z" fill="#020617" />
          {/* Glowing Visor Aura */}
          <ellipse cx="50" cy="50" rx="16" ry="6" fill="url(#shinoGlow)" />
          {/* Twin Cybernetic Optic Visor Slits */}
          <path d="M34 49 L46 51" stroke="url(#shinoCyan)" strokeWidth="3" strokeLinecap="round" />
          <path d="M54 51 L66 49" stroke="url(#shinoCyan)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="44" cy="50.8" r="1" fill="#ffffff" />
          <circle cx="56" cy="50.8" r="1" fill="#ffffff" />
          {/* Lower Mask / Carbon Faceplate */}
          <polygon points="32,58 68,58 64,74 50,82 36,74" fill="#090d16" stroke="#334155" strokeWidth="1.2" />
          {/* Stealth Cyber Vents */}
          <line x1="43" y1="65" x2="47" y2="65" stroke="#06b6d4" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
          <line x1="53" y1="65" x2="57" y2="65" stroke="#06b6d4" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
          <line x1="45" y1="70" x2="55" y2="70" stroke="#06b6d4" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
        </svg>
      </div>
    );
  }

  // 2. DeepSeek - Oceanic Quantum Whale (Breaching in Sonar Telemetry)
  if (artwork === 'deepseek') {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#061826] via-[#04111c] to-[#02080e] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <radialGradient id="deepOcean" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#0284c7" />
              <stop offset="60%" stopColor="#0369a1" />
              <stop offset="100%" stopColor="#082f49" />
            </radialGradient>
            <linearGradient id="whaleSkin" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#e0f2fe" />
              <stop offset="40%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#0284c7" />
            </linearGradient>
            <linearGradient id="whaleBelly" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#bae6fd" />
            </linearGradient>
          </defs>
          {/* Abyssal Ocean Core */}
          <circle cx="50" cy="50" r="46" fill="#041826" stroke="#0e3f61" strokeWidth="1.5" />
          {/* Sonar Telemetry Waves */}
          <circle cx="50" cy="50" r="40" fill="none" stroke="#0284c7" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
          <circle cx="50" cy="50" r="28" fill="none" stroke="#38bdf8" strokeWidth="0.8" strokeDasharray="2 3" opacity="0.5" />
          {/* Bioluminescent Oceanic Glow */}
          <circle cx="50" cy="46" r="32" fill="url(#deepOcean)" opacity="0.4" />
          {/* Sleek Cyber Whale */}
          <g transform="translate(50, 48) scale(0.85)">
            {/* Whale Body Arc */}
            <path d="M-36 6 C-30 -16 6 -24 34 -4 C38 -1 36 8 26 12 C10 18 -14 20 -28 14 Z" fill="url(#whaleSkin)" stroke="#38bdf8" strokeWidth="1.2" />
            {/* Whale White Belly */}
            <path d="M-26 12 C-14 18 10 16 26 10 C22 13 14 16 0 16 C-14 16 -22 14 -26 12 Z" fill="url(#whaleBelly)" />
            {/* Dorsal Fin */}
            <path d="M-6 8 C-10 18 -2 22 2 12 Z" fill="#0284c7" />
            {/* Whale Tail Flukes */}
            <path d="M-34 4 C-44 -4 -48 2 -42 6 C-46 10 -42 16 -34 8 Z" fill="url(#whaleSkin)" />
            {/* Whale Optic Eye */}
            <circle cx="24" cy="2" r="2.5" fill="#ffffff" />
            <circle cx="24.5" cy="2" r="1.2" fill="#0284c7" />
            {/* Spout Pulse Node */}
            <ellipse cx="14" cy="-14" rx="2" ry="4" fill="#7dd3fc" opacity="0.9" />
            <ellipse cx="18" cy="-20" rx="1.5" ry="3" fill="#bae6fd" opacity="0.7" />
          </g>
        </svg>
      </div>
    );
  }

  // 3. Codex - OpenAI Neural Code Core with Interlocking Aperture Loop
  if (artwork === 'codex') {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#102a24] via-[#0b1714] to-[#050b09] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="codexNeon" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <radialGradient id="codexCoreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.85" />
              <stop offset="50%" stopColor="#059669" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#042f2e" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Cyber Hex Outer Frame */}
          <polygon points="50,10 84,29 84,71 50,90 16,71 16,29" fill="#071318" stroke="#134e4a" strokeWidth="2" strokeDasharray="4 2" />
          {/* Neural Core Radial Glow */}
          <circle cx="50" cy="50" r="32" fill="url(#codexCoreGlow)" />
          {/* OpenAI-inspired Spiraling Neural Aperture Loop */}
          <g transform="translate(50, 50)">
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <path
                key={deg}
                d="M 0 -22 C 12 -22 20 -12 20 0 C 20 12 12 20 0 16"
                fill="none"
                stroke="url(#codexNeon)"
                strokeWidth="3.2"
                strokeLinecap="round"
                transform={`rotate(${deg})`}
              />
            ))}
            <circle cx="0" cy="0" r="4.5" fill="#a7f3d0" stroke="#064e3b" strokeWidth="1.5" />
          </g>
          {/* Code Prompt Indicator Bracket */}
          <path d="M 37 77 L 43 81 L 37 85" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="47" y1="85" x2="57" y2="85" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  // 4. Claude Code - Anthropic Lumina Sparkburst & Crystal Intelligence
  if (artwork === 'claudecode') {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#2d1b14] via-[#1c0f0a] to-[#0c0604] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <radialGradient id="claudeSpark" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="25%" stopColor="#fdba74" />
              <stop offset="60%" stopColor="#ea580c" />
              <stop offset="100%" stopColor="#9a3412" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="claudeFacet" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fb923c" />
              <stop offset="100%" stopColor="#c2410c" />
            </linearGradient>
          </defs>
          {/* Dark Amber Abyss Backing */}
          <circle cx="50" cy="50" r="46" fill="#1c0f0a" stroke="#431407" strokeWidth="1.5" />
          {/* Radiant Core Glow */}
          <circle cx="50" cy="50" r="38" fill="url(#claudeSpark)" opacity="0.65" />
          {/* Crystalline Anthropic Sparkburst Geometry */}
          <g transform="translate(50, 50)">
            <polygon points="0,-36 8,-12 36,0 12,8 0,36 -8,12 -36,0 -12,-8" fill="url(#claudeFacet)" stroke="#ffedd5" strokeWidth="1" />
            <polygon points="0,-24 5,-8 24,0 8,5 0,24 -5,8 -24,0 -8,-5" fill="#f97316" />
            <polygon points="0,-16 16,-16 0,0" fill="#fed7aa" opacity="0.6" />
            <polygon points="0,16 -16,16 0,0" fill="#ea580c" opacity="0.6" />
            <polygon points="-16,-16 0,-16 0,0" fill="#f97316" opacity="0.6" />
            <polygon points="16,16 0,16 0,0" fill="#c2410c" opacity="0.6" />
            <circle cx="0" cy="0" r="4" fill="#ffffff" />
            <circle cx="0" cy="0" r="7" fill="none" stroke="#fff7ed" strokeWidth="1" strokeDasharray="2 2" />
          </g>
        </svg>
      </div>
    );
  }

  // 5. OpenClaw - Aerodynamic Cyber Mantis Recon Strike
  if (artwork === 'openclaw') {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#0d2a1d] via-[#081b12] to-[#040e0a] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="clawArmor" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="60%" stopColor="#059669" />
              <stop offset="100%" stopColor="#064e3b" />
            </linearGradient>
            <linearGradient id="clawVisor" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#a7f3d0" />
              <stop offset="50%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="46" fill="#061f16" stroke="#065f46" strokeWidth="1.5" />
          {/* Twin Aerodynamic Blade-Antennae */}
          <path d="M42 24 Q30 8 16 14 Q26 24 38 32 Z" fill="#10b981" stroke="#34d399" strokeWidth="1" />
          <path d="M58 24 Q70 8 84 14 Q74 24 62 32 Z" fill="#10b981" stroke="#34d399" strokeWidth="1" />
          {/* Mecha Mantis Helmet Shield */}
          <polygon points="50,22 76,40 68,76 50,88 32,76 24,40" fill="url(#clawArmor)" stroke="#34d399" strokeWidth="1.5" />
          <polygon points="50,24 55,50 50,68 45,50" fill="#047857" />
          {/* Angular Cyber Optic Visors */}
          <polygon points="32,46 45,50 43,60 30,56" fill="url(#clawVisor)" stroke="#d1fae5" strokeWidth="0.8" />
          <polygon points="68,46 55,50 57,60 70,56" fill="url(#clawVisor)" stroke="#d1fae5" strokeWidth="0.8" />
          {/* Mandible Chin Guard Pincher */}
          <path d="M43 68 L50 78 L57 68" stroke="#a7f3d0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="50" cy="62" r="2.5" fill="#34d399" />
        </svg>
      </div>
    );
  }

  // 6. Bolt - Overclocked Turbo Lightning Surge
  if (artwork === 'bolt') {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#2a2007] via-[#181203] to-[#0c0901] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="boltGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="40%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#ca8a04" />
            </linearGradient>
            <radialGradient id="boltGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#facc15" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#854d0e" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="46" fill="#191303" stroke="#422006" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="32" fill="url(#boltGlow)" />
          {/* Carbon Octagon Frame */}
          <polygon points="50,14 78,26 86,54 70,80 50,86 30,80 14,54 22,26" fill="#0d0a02" stroke="#eab308" strokeWidth="1.5" strokeDasharray="6 3" />
          {/* High Voltage Neon Lightning Crest */}
          <path d="M54 18 L28 50 L48 50 L42 82 L72 46 L52 46 Z" fill="url(#boltGrad)" stroke="#fef9c3" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="26" cy="46" r="2" fill="#fef08a" />
          <circle cx="74" cy="54" r="2" fill="#fef08a" />
        </svg>
      </div>
    );
  }

  // 7. Sentinel - Aegis Security Guardian Shield
  if (artwork === 'sentinel') {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#191e3e] via-[#0f1226] to-[#070914] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="50%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#4338ca" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="46" fill="#0d1124" stroke="#1e1b4b" strokeWidth="1.5" />
          {/* Hexagonal Forcefield Grid */}
          <polygon points="50,14 78,26 86,54 70,80 50,86 30,80 14,54 22,26" fill="none" stroke="#4f46e5" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
          {/* Aegis Shield */}
          <path d="M50 20 L74 32 C74 58 64 74 50 82 C36 74 26 58 26 32 Z" fill="url(#shieldGrad)" stroke="#a5b4fc" strokeWidth="1.5" />
          {/* Inner Core */}
          <path d="M50 28 L66 38 C66 58 58 68 50 74 C42 68 34 58 34 38 Z" fill="#1e1b4b" stroke="#818cf8" strokeWidth="1" />
          {/* Security Crest */}
          <g transform="translate(50, 48) scale(0.85)">
            <rect x="-8" y="-2" width="16" height="14" rx="3" fill="#c7d2fe" />
            <path d="M-5 -2 V-7 C-5 -10 5 -10 5 -7 V-2" fill="none" stroke="#c7d2fe" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="0" cy="5" r="1.5" fill="#312e81" />
          </g>
        </svg>
      </div>
    );
  }

  // 8. Astra - Ornate Golden Compass Star
  if (artwork === 'astra') {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#16273e] via-[#0d1726] to-[#070b12] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="goldLight" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="40%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#854d0e" />
            </linearGradient>
            <linearGradient id="goldDark" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ca8a04" />
              <stop offset="70%" stopColor="#713f12" />
              <stop offset="100%" stopColor="#422006" />
            </linearGradient>
            <linearGradient id="navyRing" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#goldDark)" strokeWidth="3" />
          <circle cx="50" cy="50" r="34" fill="url(#navyRing)" stroke="url(#goldLight)" strokeWidth="1.5" />
          {/* Diagonal Star Points */}
          <polygon points="50,50 22,22 50,38" fill="url(#goldDark)" />
          <polygon points="50,50 22,22 38,50" fill="url(#goldLight)" />
          <polygon points="50,50 78,22 62,50" fill="url(#goldDark)" />
          <polygon points="50,50 78,22 50,38" fill="url(#goldLight)" />
          <polygon points="50,50 78,78 50,62" fill="url(#goldDark)" />
          <polygon points="50,50 78,78 62,50" fill="url(#goldLight)" />
          <polygon points="50,50 22,78 38,50" fill="url(#goldDark)" />
          <polygon points="50,50 22,78 50,62" fill="url(#goldLight)" />
          {/* 4 Primary Star Points */}
          <polygon points="50,50 50,8 43,45" fill="url(#goldLight)" />
          <polygon points="50,50 50,8 57,45" fill="url(#goldDark)" />
          <polygon points="50,50 50,92 57,55" fill="url(#goldLight)" />
          <polygon points="50,50 50,92 43,55" fill="url(#goldDark)" />
          <polygon points="50,50 8,50 45,57" fill="url(#goldLight)" />
          <polygon points="50,50 8,50 45,43" fill="url(#goldDark)" />
          <polygon points="50,50 92,50 55,43" fill="url(#goldLight)" />
          <polygon points="50,50 92,50 55,57" fill="url(#goldDark)" />
          <circle cx="50" cy="50" r="7" fill="url(#goldLight)" stroke="#713f12" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="3" fill="#fef08a" />
        </svg>
      </div>
    );
  }

  // 9. Artisan - Holographic Prism Palette with CMYK Drops
  if (artwork === 'palette') {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#241a35] via-[#160f22] to-[#0c0813] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="prismBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e1b4b" />
              <stop offset="50%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#030712" />
            </linearGradient>
            <radialGradient id="prismGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#c084fc" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="46" fill="url(#prismBg)" stroke="#312e81" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="34" fill="url(#prismGlow)" />
          {/* Cyber Palette Board */}
          <path d="M50 18 C74 14 88 28 86 52 C84 72 72 84 52 84 C40 84 36 76 28 74 C20 72 14 78 12 64 C10 46 22 20 50 18 Z" fill="#18181b" stroke="#a855f7" strokeWidth="2" />
          {/* Thumb Hole with Cyber Rim */}
          <ellipse cx="66" cy="66" rx="6" ry="8" fill="#09090b" stroke="#c084fc" strokeWidth="1.2" />
          {/* Glowing Neon CMYK Color Drops */}
          <circle cx="34" cy="30" r="5" fill="#38bdf8" />
          <circle cx="34" cy="30" r="1.8" fill="#e0f2fe" />
          <circle cx="50" cy="26" r="5" fill="#f43f5e" />
          <circle cx="50" cy="26" r="1.8" fill="#ffe4e6" />
          <circle cx="66" cy="32" r="5" fill="#facc15" />
          <circle cx="66" cy="32" r="1.8" fill="#fef9c3" />
          <circle cx="28" cy="46" r="4.5" fill="#a855f7" />
          <circle cx="28" cy="46" r="1.5" fill="#f3e8ff" />
          <circle cx="30" cy="60" r="4.5" fill="#10b981" />
          <circle cx="30" cy="60" r="1.5" fill="#d1fae5" />
          {/* Stylus Angled */}
          <g transform="rotate(-38 50 50)">
            <line x1="50" y1="14" x2="50" y2="86" stroke="#e4e4e7" strokeWidth="3" strokeLinecap="round" />
            <line x1="50" y1="14" x2="50" y2="30" stroke="#a855f7" strokeWidth="3" strokeLinecap="round" />
            <circle cx="50" cy="14" r="3" fill="#c084fc" />
          </g>
        </svg>
      </div>
    );
  }

  // Fallback: If custom emoji avatar provided, render emoji in stylish dark-cyber gradient circle!
  if (avatar && avatar.trim()) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-tr from-[#1e293b] via-[#0f172a] to-[#020617] border-2 border-[#334155] flex items-center justify-center text-3xl sm:text-4xl shadow-inner select-none`}>
        {avatar}
      </div>
    );
  }

  // Fallback: Elegant Initials Avatar
  return (
    <div className={`${className} rounded-full bg-gradient-to-tr from-[#1e293b] to-[#0f172a] border-2 border-[#334155] flex items-center justify-center text-3xl font-bold text-gray-200 shadow-inner select-none`}>
      {name ? name.slice(0, 2).toUpperCase() : 'AI'}
    </div>
  );
};

// Team Artwork Component
interface TeamArtworkProps {
  type?: string;
  name?: string;
  className?: string;
}

export const TeamArtwork: React.FC<TeamArtworkProps> = ({
  type,
  name,
  className = 'w-24 h-24',
}) => {
  const normalized = (type || name || '').toLowerCase();

  // 1. First Contact - Group of 3D Friendly Colorful Aliens (Matching Screenshot)
  if (normalized.includes('first contact') || normalized.includes('contact') || normalized.includes('alien')) {
    return (
      <div className={`${className} flex items-center justify-center relative select-none`}>
        <svg viewBox="0 0 120 100" className="w-full h-full drop-shadow-lg">
          <defs>
            <radialGradient id="tealAlien" cx="40%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#99f6e4" />
              <stop offset="60%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#0f766e" />
            </radialGradient>
            <radialGradient id="greenAlien" cx="40%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#bbf7d0" />
              <stop offset="60%" stopColor="#22c55e" />
              <stop offset="100%" stopColor="#15803d" />
            </radialGradient>
            <radialGradient id="redAlien" cx="40%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#fca5a5" />
              <stop offset="60%" stopColor="#ef4444" />
              <stop offset="100%" stopColor="#991b1b" />
            </radialGradient>
            <radialGradient id="blueAlien" cx="40%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#bfdbfe" />
              <stop offset="60%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#1e40af" />
            </radialGradient>
          </defs>

          {/* Tall Center Teal Alien */}
          <ellipse cx="60" cy="36" rx="16" ry="24" fill="url(#tealAlien)" />
          <ellipse cx="53" cy="34" rx="4.5" ry="7" fill="#042f2e" />
          <ellipse cx="67" cy="34" rx="4.5" ry="7" fill="#042f2e" />
          <circle cx="52" cy="32" r="1.5" fill="#ffffff" />
          <circle cx="66" cy="32" r="1.5" fill="#ffffff" />

          {/* Left Green Alien with Antennas */}
          <circle cx="34" cy="54" r="15" fill="url(#greenAlien)" />
          <ellipse cx="30" cy="52" rx="3.5" ry="5" fill="#052e16" />
          <ellipse cx="38" cy="52" rx="3.5" ry="5" fill="#052e16" />
          <circle cx="29" cy="50" r="1" fill="#ffffff" />
          <circle cx="37" cy="50" r="1" fill="#ffffff" />
          <path d="M26 40 L20 32 M42 40 L48 32" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="19" cy="30" r="2.5" fill="#86efac" />
          <circle cx="49" cy="30" r="2.5" fill="#86efac" />

          {/* Right Blue Alien with Antennas */}
          <circle cx="86" cy="54" r="15" fill="url(#blueAlien)" />
          <ellipse cx="82" cy="52" rx="3.5" ry="5" fill="#172554" />
          <ellipse cx="90" cy="52" rx="3.5" ry="5" fill="#172554" />
          <circle cx="81" cy="50" r="1" fill="#ffffff" />
          <circle cx="89" cy="50" r="1" fill="#ffffff" />
          <path d="M78 40 L72 32 M94 40 L100 32" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="71" cy="30" r="2.5" fill="#93c5fd" />
          <circle cx="101" cy="30" r="2.5" fill="#93c5fd" />

          {/* Front Center Terracotta/Red Alien */}
          <ellipse cx="60" cy="68" rx="17" ry="15" fill="url(#redAlien)" />
          <ellipse cx="53" cy="65" rx="4" ry="5" fill="#450a0a" />
          <ellipse cx="67" cy="65" rx="4" ry="5" fill="#450a0a" />
          <circle cx="52" cy="63" r="1.2" fill="#ffffff" />
          <circle cx="66" cy="63" r="1.2" fill="#ffffff" />
          <path d="M56 73 Q60 76 64 73" stroke="#450a0a" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    );
  }

  // 2. Coding Squad - Code Window, Gears & Lightbulb (Matching Screenshot)
  if (normalized.includes('coding') || normalized.includes('squad') || normalized.includes('tech')) {
    return (
      <div className={`${className} flex items-center justify-center relative select-none`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
          <defs>
            <linearGradient id="bulbGlow" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="60%" stopColor="#facc15" />
              <stop offset="100%" stopColor="#eab308" />
            </linearGradient>
          </defs>

          {/* Terminal / Code Window (Top Left) */}
          <rect x="12" y="16" width="46" height="34" rx="6" fill="#1e293b" stroke="#475569" strokeWidth="2.5" />
          {/* Header dots */}
          <circle cx="18" cy="22" r="2" fill="#ef4444" />
          <circle cx="24" cy="22" r="2" fill="#eab308" />
          <circle cx="30" cy="22" r="2" fill="#22c55e" />
          {/* Code text </> */}
          <path d="M23 34 L18 39 L23 44 M35 34 L40 39 L35 44 M31 31 L27 47" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />

          {/* Red/Coral Gear (Top Right) */}
          <g transform="translate(62, 18) scale(0.65)">
            <circle cx="20" cy="20" r="16" fill="#f87171" stroke="#ef4444" strokeWidth="3" />
            <circle cx="20" cy="20" r="7" fill="#1e293b" />
            <path d="M20 0 L20 40 M0 20 L40 20 M6 6 L34 34 M6 34 L34 6" stroke="#ef4444" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Teal Gear (Center Right) */}
          <g transform="translate(66, 46) scale(0.75)">
            <circle cx="20" cy="20" r="16" fill="#2dd4bf" stroke="#0d9488" strokeWidth="3" />
            <circle cx="20" cy="20" r="7" fill="#0f172a" />
            <path d="M20 0 L20 40 M0 20 L40 20 M6 6 L34 34 M6 34 L34 6" stroke="#0d9488" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Glowing Lightbulb (Bottom Center) */}
          <g transform="translate(32, 42)">
            <path d="M18 10 C10 10 6 16 6 22 C6 28 11 31 12 36 L24 36 C25 31 30 28 30 22 C30 16 26 10 18 10 Z" fill="url(#bulbGlow)" stroke="#ca8a04" strokeWidth="2.5" />
            {/* Filament */}
            <path d="M15 22 L18 18 L21 22" stroke="#b45309" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            {/* Screw Base */}
            <rect x="12" y="37" width="12" height="3" rx="1.5" fill="#64748b" />
            <rect x="13" y="41" width="10" height="3" rx="1.5" fill="#475569" />
            <path d="M15 45 L21 45" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
          </g>
        </svg>
      </div>
    );
  }

  // Fallback: Team Badge
  return (
    <div className={`${className} rounded-2xl bg-gradient-to-tr from-[#1e293b] to-[#0f172a] border-2 border-[#334155] flex items-center justify-center text-3xl shadow-inner`}>
      👥
    </div>
  );
};
