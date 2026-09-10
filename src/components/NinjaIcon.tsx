import React from 'react';

interface NinjaIconProps {
  className?: string;
  size?: number;
}

export const NinjaIcon: React.FC<NinjaIconProps> = ({ className = "w-5 h-5", size }) => {
  return (
    <svg 
      viewBox="0 0 128 128" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <defs>
        <linearGradient id="hoodGradInline" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="bandGradInline" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#b91c1c" />
        </linearGradient>
        <linearGradient id="cyanEyeGlowInline" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>

      {/* Ninja Hood */}
      <path 
        d="M34 40 C34 22, 94 22, 94 40 C94 56, 96 74, 98 88 C94 98, 78 104, 64 104 C50 104, 34 98, 30 88 C32 74, 34 56, 34 40 Z" 
        fill="url(#hoodGradInline)" 
        stroke="#475569" 
        strokeWidth="3" 
      />

      {/* Forehead Band (Crimson Red Ribbon) */}
      <path d="M32 44 C42 42, 86 42, 96 44 L95 54 C85 52, 43 52, 33 54 Z" fill="url(#bandGradInline)" />

      {/* Forehead Protector Plate */}
      <rect x="46" y="43" width="36" height="10" rx="3" fill="#94a3b8" stroke="#cbd5e1" strokeWidth="1" />
      <circle cx="49" cy="48" r="1.2" fill="#1e293b" />
      <circle cx="79" cy="48" r="1.2" fill="#1e293b" />
      <path d="M60 46 L68 46 L62 50 L66 50" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" />

      {/* Face Opening */}
      <path d="M38 58 C46 56, 82 56, 90 58 C88 66, 86 70, 78 72 C68 73, 60 73, 50 72 C42 70, 40 66, 38 58 Z" fill="#090d16" />

      {/* Glowing Eyes */}
      <path d="M44 63 Q52 62 57 66 Q52 68 44 65 Z" fill="url(#cyanEyeGlowInline)" />
      <path d="M84 63 Q76 62 71 66 Q76 68 84 65 Z" fill="url(#cyanEyeGlowInline)" />

      {/* Lower Face Scarf */}
      <path d="M36 71 C46 75, 82 75, 92 71 C93 84, 82 96, 64 97 C46 96, 35 84, 36 71 Z" fill="#0f172a" stroke="#1e293b" strokeWidth="2" />
      <path d="M48 77 Q64 85 80 77" stroke="#334155" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      {/* Ribbons */}
      <path d="M95 48 C104 50, 108 58, 114 62 C109 60, 104 57, 95 53 Z" fill="url(#bandGradInline)" opacity="0.9" />
      <path d="M96 52 C106 58, 112 68, 116 76 C110 70, 103 64, 95 55 Z" fill="url(#bandGradInline)" opacity="0.75" />
    </svg>
  );
};
