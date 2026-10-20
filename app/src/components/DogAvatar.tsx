import { useEffect, useState } from 'react';

// 数字人形象：柴犬「小柴」——课程主角的动物伙伴，暖橘白配色，会眨眼、摆耳、说话时蹦跳
export default function DogAvatar({ speaking }: { speaking: boolean; size?: number }) {
  const [blink, setBlink] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);

  useEffect(() => {
    let t: number;
    const loop = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 150);
      t = window.setTimeout(loop, 2200 + Math.random() * 2800);
    };
    t = window.setTimeout(loop, 1000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!speaking) { setMouthOpen(false); return; }
    const i = window.setInterval(() => setMouthOpen(m => !m), 170);
    return () => clearInterval(i);
  }, [speaking]);

  const eyeH = blink ? 1.4 : 7;

  return (
    <svg viewBox="0 0 200 210" width="100%" height="auto" role="img" aria-label="伴学助教小柴"
      className={speaking ? 'dog-speaking' : 'dog-idle'}>
      <defs>
        <linearGradient id="furG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F2A24B" /><stop offset="1" stopColor="#E08A35" />
        </linearGradient>
      </defs>
      {/* 尾巴（说话时摇） */}
      <g className="dog-tail">
        <path d="M168 150 C190 140 196 118 184 108 C192 126 182 142 164 150 Z" fill="#E08A35" />
        <path d="M184 108 C196 100 200 112 192 120 C196 110 190 106 184 108 Z" fill="#FFF6E8" />
      </g>
      {/* 身体 */}
      <ellipse cx="100" cy="168" rx="58" ry="40" fill="url(#furG)" />
      <ellipse cx="100" cy="176" rx="34" ry="26" fill="#FFF6E8" />
      {/* 围巾（暖红，呼应PPT标题色） */}
      <path d="M58 138 Q100 158 142 138 L142 152 Q100 172 58 152 Z" fill="#8B1A1A" />
      <path d="M96 158 L104 158 L108 186 L92 186 Z" fill="#8B1A1A" />
      {/* 耳朵 */}
      <g className="dog-ear-l">
        <path d="M52 62 L40 16 L86 42 Z" fill="url(#furG)" />
        <path d="M55 55 L49 28 L76 44 Z" fill="#F7D9B0" />
      </g>
      <g className="dog-ear-r">
        <path d="M148 62 L160 16 L114 42 Z" fill="url(#furG)" />
        <path d="M145 55 L151 28 L124 44 Z" fill="#F7D9B0" />
      </g>
      {/* 头 */}
      <circle cx="100" cy="88" r="54" fill="url(#furG)" />
      {/* 白色口鼻面罩 */}
      <ellipse cx="100" cy="106" rx="34" ry="26" fill="#FFF6E8" />
      <ellipse cx="62" cy="100" rx="14" ry="12" fill="#FFF6E8" opacity="0.9" />
      <ellipse cx="138" cy="100" rx="14" ry="12" fill="#FFF6E8" opacity="0.9" />
      {/* 眉毛（白点，柴犬特征） */}
      <ellipse cx="76" cy="66" rx="8" ry="5" fill="#FFF6E8" />
      <ellipse cx="124" cy="66" rx="8" ry="5" fill="#FFF6E8" />
      {/* 眼睛 */}
      <ellipse cx="76" cy="82" rx="6" ry={eyeH} fill="#3E2C28" style={{ transition: 'ry 0.12s' }} />
      <ellipse cx="124" cy="82" rx="6" ry={eyeH} fill="#3E2C28" style={{ transition: 'ry 0.12s' }} />
      <circle cx="78.5" cy="79" r="2" fill="#FFFDF9" />
      <circle cx="126.5" cy="79" r="2" fill="#FFFDF9" />
      {/* 腮红 */}
      <ellipse cx="58" cy="102" rx="8" ry="5" fill="#E8754A" opacity="0.45" />
      <ellipse cx="142" cy="102" rx="8" ry="5" fill="#E8754A" opacity="0.45" />
      {/* 鼻子 */}
      <ellipse cx="100" cy="98" rx="7.5" ry="5.5" fill="#3E2C28" />
      <circle cx="97.5" cy="96.5" r="1.6" fill="#8a7368" />
      {/* 嘴：说话时张合 */}
      {mouthOpen ? (
        <g>
          <path d="M88 108 Q100 122 112 108 Z" fill="#8B1A1A" />
          <ellipse cx="100" cy="113" rx="6" ry="3.6" fill="#F0917B" />
        </g>
      ) : (
        <path d="M90 108 Q95 114 100 108 Q105 114 110 108" stroke="#3E2C28" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      )}
      {/* 前爪 */}
      <ellipse cx="72" cy="198" rx="14" ry="9" fill="#FFF6E8" />
      <ellipse cx="128" cy="198" rx="14" ry="9" fill="#FFF6E8" />
    </svg>
  );
}
