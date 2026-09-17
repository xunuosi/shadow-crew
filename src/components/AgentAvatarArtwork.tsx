import React from 'react';

interface AgentAvatarArtworkProps {
  type?: string;
  name?: string;
  className?: string;
}

export const AgentAvatarArtwork: React.FC<AgentAvatarArtworkProps> = ({
  type,
  name,
  className = 'w-20 h-20',
}) => {
  const normalized = (type || name || '').toLowerCase();

  // 1. MyDeepSeek - Terracotta Multi-Eyed Alien Bust (Matching Screenshot)
  if (normalized.includes('deepseek') || normalized.includes('alien')) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#38262c] to-[#1a1216] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <radialGradient id="alienSkin" cx="40%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#d9777f" />
              <stop offset="50%" stopColor="#a34b54" />
              <stop offset="100%" stopColor="#5e262c" />
            </radialGradient>
            <radialGradient id="eyeGlow" cx="35%" cy="35%" r="60%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="40%" stopColor="#e2e8f0" />
              <stop offset="80%" stopColor="#475569" />
              <stop offset="100%" stopColor="#0f172a" />
            </radialGradient>
          </defs>
          {/* Head & Cranium */}
          <ellipse cx="50" cy="46" rx="28" ry="32" fill="url(#alienSkin)" />
          {/* Temporal Nodes / Ears */}
          <ellipse cx="20" cy="38" rx="8" ry="14" fill="#a34b54" />
          <ellipse cx="80" cy="38" rx="8" ry="14" fill="#a34b54" />
          <ellipse cx="20" cy="38" rx="5" ry="9" fill="#5e262c" />
          <ellipse cx="80" cy="38" rx="5" ry="9" fill="#5e262c" />
          {/* Top Center Eye */}
          <ellipse cx="50" cy="32" rx="7" ry="5.5" fill="url(#eyeGlow)" stroke="#381318" strokeWidth="1.5" />
          <circle cx="50" cy="32" r="2.5" fill="#0f172a" />
          <circle cx="51.5" cy="31" r="0.8" fill="#ffffff" />
          {/* Left Main Eye */}
          <ellipse cx="37" cy="45" rx="8" ry="6.5" fill="url(#eyeGlow)" stroke="#381318" strokeWidth="1.5" />
          <circle cx="37" cy="45" r="3" fill="#0f172a" />
          <circle cx="38.5" cy="43.5" r="1" fill="#ffffff" />
          {/* Right Main Eye */}
          <ellipse cx="63" cy="45" rx="8" ry="6.5" fill="url(#eyeGlow)" stroke="#381318" strokeWidth="1.5" />
          <circle cx="63" cy="45" r="3" fill="#0f172a" />
          <circle cx="64.5" cy="43.5" r="1" fill="#ffffff" />
          {/* Subtle Snout & Mouth */}
          <path d="M47 56 Q50 58 53 56" stroke="#4a1a20" strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M44 65 Q50 69 56 65" stroke="#381318" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          {/* Neck & Shoulders */}
          <path d="M41 74 L32 95 L68 95 L59 74 Z" fill="#873c44" />
        </svg>
      </div>
    );
  }

  // 2. Astra - Ornate Golden Compass Star (Matching Screenshot)
  if (normalized.includes('astra') || normalized.includes('star') || normalized.includes('compass')) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#16273e] via-[#0d1726] to-[#070b12] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group`}>
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
          {/* Outer Ring with Gold Ribs */}
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#goldDark)" strokeWidth="3" />
          <circle cx="50" cy="50" r="34" fill="url(#navyRing)" stroke="url(#goldLight)" strokeWidth="1.5" />
          {/* 4 Diagonal Smaller Star Points */}
          <polygon points="50,50 22,22 50,38" fill="url(#goldDark)" />
          <polygon points="50,50 22,22 38,50" fill="url(#goldLight)" />
          <polygon points="50,50 78,22 62,50" fill="url(#goldDark)" />
          <polygon points="50,50 78,22 50,38" fill="url(#goldLight)" />
          <polygon points="50,50 78,78 50,62" fill="url(#goldDark)" />
          <polygon points="50,50 78,78 62,50" fill="url(#goldLight)" />
          <polygon points="50,50 22,78 38,50" fill="url(#goldDark)" />
          <polygon points="50,50 22,78 50,62" fill="url(#goldLight)" />
          {/* 4 Primary Large Star Points (North, South, East, West) */}
          <polygon points="50,50 50,8 43,45" fill="url(#goldLight)" />
          <polygon points="50,50 50,8 57,45" fill="url(#goldDark)" />
          <polygon points="50,50 50,92 57,55" fill="url(#goldLight)" />
          <polygon points="50,50 50,92 43,55" fill="url(#goldDark)" />
          <polygon points="50,50 8,50 45,57" fill="url(#goldLight)" />
          <polygon points="50,50 8,50 45,43" fill="url(#goldDark)" />
          <polygon points="50,50 92,50 55,43" fill="url(#goldLight)" />
          <polygon points="50,50 92,50 55,57" fill="url(#goldDark)" />
          {/* Center Jewel */}
          <circle cx="50" cy="50" r="7" fill="url(#goldLight)" stroke="#713f12" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="3" fill="#fef08a" />
        </svg>
      </div>
    );
  }

  // 3. MyLxClaudeCode - Organic Emblem with Code Tag & Gear (Matching Screenshot)
  if (normalized.includes('claudecode') || normalized.includes('code') || normalized.includes('claude')) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#2d221c] to-[#14181f] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="warmBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="45%" stopColor="#ea580c" />
              <stop offset="85%" stopColor="#0d9488" />
              <stop offset="100%" stopColor="#0f766e" />
            </linearGradient>
          </defs>
          {/* Organic Rounded Wavy Badge */}
          <rect x="14" y="14" width="72" height="72" rx="24" fill="url(#warmBg)" />
          {/* Stylized Code Bracket </> */}
          <path d="M34 40 L24 50 L34 60" stroke="#ffffff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M48 34 L40 66" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M54 40 L64 50 L54 60" stroke="#ffffff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {/* Small Gear in Bottom-Right Corner */}
          <g transform="translate(62, 62) scale(0.65)">
            <circle cx="16" cy="16" r="14" fill="#0f766e" stroke="#ffffff" strokeWidth="3" />
            <circle cx="16" cy="16" r="6" fill="#ffffff" />
            <path d="M16 0 L16 32 M0 16 L32 16 M5 5 L27 27 M5 27 L27 5" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
          </g>
        </svg>
      </div>
    );
  }

  // 3.5. Codex / OpenAI - Neural Code Processor with Swirling Aperture Core
  if (normalized.includes('codex') || normalized.includes('openai')) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#102a24] via-[#0b1714] to-[#050b09] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="codexNeon" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <radialGradient id="codexCoreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#059669" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#042f2e" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Subtle Outer Cyber Hexagon / Circuit Frame */}
          <polygon points="50,12 82,30 82,70 50,88 18,70 18,30" fill="none" stroke="#134e4a" strokeWidth="2" strokeDasharray="3 2" />
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
                strokeWidth="3.5"
                strokeLinecap="round"
                transform={`rotate(${deg})`}
              />
            ))}
            {/* Center Processing Dot */}
            <circle cx="0" cy="0" r="4.5" fill="#a7f3d0" stroke="#064e3b" strokeWidth="1.5" />
          </g>
          {/* Code Prompt Indicator Bracket at bottom */}
          <path d="M 38 78 L 44 82 L 38 86" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="48" y1="86" x2="58" y2="86" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  // 4. OpenClaw - Emerald Cyber Mantis Recon
  if (normalized.includes('openclaw') || normalized.includes('claw')) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#112a1f] to-[#0a1610] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="emeraldGlow" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
          </defs>
          {/* Head & Shield */}
          <polygon points="50,16 76,38 68,76 50,88 32,76 24,38" fill="#064e3b" stroke="#10b981" strokeWidth="2.5" />
          {/* Antennas */}
          <path d="M42 22 Q30 8 18 14" stroke="#34d399" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M58 22 Q70 8 82 14" stroke="#34d399" strokeWidth="3" strokeLinecap="round" fill="none" />
          {/* Cyber Optic Visor Eyes */}
          <polygon points="34,42 46,45 44,54 32,50" fill="url(#emeraldGlow)" />
          <polygon points="66,42 54,45 56,54 68,50" fill="url(#emeraldGlow)" />
          {/* Mandible Pincher Elements */}
          <path d="M44 64 L50 74 L56 64" stroke="#a7f3d0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
    );
  }

  // 5. Shinobi - Cyber Stealth Ninja Mask
  if (normalized.includes('shinobi') || normalized.includes('ninja')) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#18263a] to-[#0c121c] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="cyanVisor" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="50%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#0891b2" />
            </linearGradient>
          </defs>
          {/* Ninja Cowl / Hood */}
          <path d="M22 45 C22 20 78 20 78 45 C78 78 68 88 50 88 C32 88 22 78 22 45 Z" fill="#0f172a" stroke="#1e293b" strokeWidth="2" />
          {/* Face Mask Slit */}
          <path d="M30 42 C36 39 64 39 70 42 L70 54 C64 57 36 57 30 54 Z" fill="#020617" />
          {/* Glowing Cyber Optic Visor */}
          <path d="M34 46 L66 46" stroke="url(#cyanVisor)" strokeWidth="4" strokeLinecap="round" />
          {/* Headband Shuriken Knot */}
          <circle cx="50" cy="30" r="4" fill="#06b6d4" />
        </svg>
      </div>
    );
  }

  // 6. Artistry Guide - Wooden Artist Palette with Brush (Matching Screenshot)
  if (normalized.includes('artistry') || normalized.includes('palette') || normalized.includes('art') || normalized.includes('paint')) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-b from-[#2a221b] to-[#141210] p-1 flex items-center justify-center shadow-inner relative overflow-hidden group`}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
          <defs>
            <radialGradient id="woodGradient" cx="40%" cy="40%" r="70%">
              <stop offset="0%" stopColor="#f3d5b5" />
              <stop offset="60%" stopColor="#d4a373" />
              <stop offset="100%" stopColor="#8c5835" />
            </radialGradient>
            <linearGradient id="brushWood" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#e6ccb2" />
              <stop offset="60%" stopColor="#b08968" />
              <stop offset="100%" stopColor="#7f4f24" />
            </linearGradient>
            <linearGradient id="brushTip" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f87171" />
              <stop offset="50%" stopColor="#475569" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>
          </defs>

          {/* Wooden Palette Board */}
          <path
            d="M 50 16 C 75 12 90 28 88 52 C 86 72 74 88 54 88 C 42 88 38 78 30 76 C 22 74 14 80 12 66 C 10 46 22 18 50 16 Z"
            fill="url(#woodGradient)"
            stroke="#6f4518"
            strokeWidth="2.5"
          />

          {/* Palette Thumb Hole */}
          <ellipse cx="68" cy="68" rx="7" ry="9" fill="#141210" stroke="#8c5835" strokeWidth="1.5" />

          {/* Vibrant Paint Blobs */}
          <circle cx="34" cy="30" r="5" fill="#3b82f6" />
          <circle cx="33" cy="29" r="1.5" fill="#93c5fd" />

          <circle cx="50" cy="25" r="5.5" fill="#ef4444" />
          <circle cx="49" cy="24" r="1.5" fill="#fca5a5" />

          <circle cx="67" cy="30" r="5" fill="#eab308" />
          <circle cx="66" cy="29" r="1.5" fill="#fef08a" />

          <circle cx="28" cy="46" r="5" fill="#a855f7" />
          <circle cx="27" cy="45" r="1.5" fill="#d8b4fe" />

          <circle cx="30" cy="62" r="5.5" fill="#22c55e" />
          <circle cx="29" cy="61" r="1.5" fill="#86efac" />

          <circle cx="48" cy="38" r="4.5" fill="#f97316" />
          <circle cx="47" cy="37" r="1.5" fill="#fdba74" />

          {/* Paintbrush Angled Across */}
          <g transform="rotate(-36 50 50)">
            {/* Brush Handle */}
            <path d="M47 18 L53 18 L51 86 L49 86 Z" fill="url(#brushWood)" stroke="#582f0e" strokeWidth="1" />
            {/* Silver Ferrule */}
            <rect x="47" y="14" width="6" height="8" rx="1" fill="#cbd5e1" stroke="#64748b" strokeWidth="0.8" />
            {/* Bristle Tip */}
            <path d="M47 14 Q50 2 53 14 Z" fill="url(#brushTip)" />
          </g>
        </svg>
      </div>
    );
  }

  // Fallback: Elegant Initials Avatar
  return (
    <div className={`${className} rounded-full bg-gradient-to-tr from-[#1e293b] to-[#0f172a] border-2 border-[#334155] flex items-center justify-center text-3xl font-bold text-gray-200 shadow-inner`}>
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
