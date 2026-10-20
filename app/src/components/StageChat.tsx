import { useEffect, useRef, useState, useCallback } from 'react';
import DogAvatar from './DogAvatar';
import { think, type CoachState, type TeacherConfig } from '../engine/brain';
import { Send, RotateCcw, BookOpen, PencilLine, ListChecks, Volume2, VolumeX } from 'lucide-react';

export interface Msg {
  id: number; role: 'user' | 'ai'; text: string;
  gotoPage?: string; crisis?: boolean; hint?: string; shown?: string;
}

export interface ChatHandle {
  inject: (text: string, hint?: string) => void;
}

const WELCOME =
  '你好，我是小柴，这节课的 AI 伴学助教。我是AI伴学助手，不是专业心理医生——这十分钟里的任何一页、任何一个概念，你都可以问我；也可以把一句对自己说的否定的话发给我，我陪你按「暂时、具体、可变」改到合格。但如果你正经历持续两周以上的低落、睡不好、吃不下，或有过伤害自己的念头，请立刻告诉信任的成年人或学校心理老师。';

const QUICK = [
  { icon: BookOpen, label: '什么是习得性无助？', send: '什么是习得性无助？' },
  { icon: PencilLine, label: '开始归因改写练习', send: '我就是学不好数学。' },
  { icon: ListChecks, label: '回顾重启三步法', send: '回顾重启三步法' },
];

let mid = 1;

// 朗读前清洗：去掉标记符号，让语音更自然
function toSpeech(text: string): string {
  return text
    .replace(/[★✕✓▶·]/g, '，')
    .replace(/[①②③④]/g, m => String('①②③④'.indexOf(m) + 1) + '，')
    .replace(/[「」『』]/g, '')
    .replace(/\n+/g, '。')
    .replace(/，{2,}/g, '，')
    .replace(/。{2,}/g, '。')
    .replace(/P(\d{1,2})/g, '第 $1 页');
}

export function useChat(cfg: TeacherConfig, onGotoPage: (id: string) => void, chatRef: React.RefObject<ChatHandle | null>) {
  // shown 不设初值：没有打字过程的首屏消息直接显示 text（设成 '' 会让 ?? 不回退，气泡永远空白）
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, role: 'ai', text: WELCOME }]);
  const [typing, setTyping] = useState(false);
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem('xiaochai-voice') !== 'off');
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [coach, setCoach] = useState<CoachState>({ stage: 'idle', original: '', topic: '', facts: '' });
  const listRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const zhVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // 挑选中文嗓音
  useEffect(() => {
    const pick = () => {
      const vs = window.speechSynthesis?.getVoices() ?? [];
      zhVoiceRef.current =
        vs.find(v => /zh[-_]CN/i.test(v.lang) && /xiaoxiao|xiaoyi|yunxia|ting|mei|hui/i.test(v.name)) ||
        vs.find(v => /zh/i.test(v.lang)) || null;
    };
    pick();
    window.speechSynthesis?.addEventListener('voiceschanged', pick);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', pick);
  }, []);

  const speak = useCallback((text: string) => {
    if (!voiceOn || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(toSpeech(text));
    if (zhVoiceRef.current) u.voice = zhVoiceRef.current;
    u.lang = 'zh-CN';
    u.rate = 0.95;   // 语速适中
    u.pitch = 1.15;  // 略明亮，贴合温和形象
    u.onstart = () => setVoiceSpeaking(true);
    u.onend = () => setVoiceSpeaking(false);
    u.onerror = () => setVoiceSpeaking(false);
    window.speechSynthesis.speak(u);
  }, [voiceOn]);

  const toggleVoice = useCallback(() => {
    setVoiceOn(v => {
      const nx = !v;
      localStorage.setItem('xiaochai-voice', nx ? 'on' : 'off');
      if (!nx) { window.speechSynthesis?.cancel(); setVoiceSpeaking(false); }
      return nx;
    });
  }, []);

  const scrollDown = () => requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }));

  const typeOut = useCallback((m: Msg) => {
    setTyping(true);
    speak(m.text);
    let i = 0;
    const step = () => {
      i += 2;
      setMsgs(prev => prev.map(x => x.id === m.id ? { ...x, shown: m.text.slice(0, i) } : x));
      scrollDown();
      if (i < m.text.length) timerRef.current = window.setTimeout(step, 110);
      else { setTyping(false); timerRef.current = null; }
    };
    step();
  }, [speak]);

  const pushAI = useCallback((text: string, extra?: Partial<Msg>) => {
    const m: Msg = { id: mid++, role: 'ai', text, shown: '', ...extra };
    setMsgs(prev => [...prev, m]);
    typeOut(m);
    scrollDown();
  }, [typeOut]);

  useEffect(() => {
    if (chatRef) chatRef.current = { inject: (text, hint) => pushAI(text, { hint }) };
  }, [chatRef, pushAI]);

  const send = useCallback((text: string) => {
    const t = text.trim();
    if (!t || typing) return;
    setMsgs(prev => [...prev, { id: mid++, role: 'user', text: t }]);
    scrollDown();
    setTimeout(() => {
      const r = think(t, coach, cfg);
      if (r.coachingStage) {
        setCoach(s => ({
          stage: r.coachingStage!,
          original: s.stage === 'idle' ? t : s.original,
          topic: s.topic || (t.match(/(数学|英语|语文|物理|化学|生物|历史|地理|政治|单词|背书|跑步|体育|演讲|考试|学习)/)?.[1] ?? '这件事'),
          facts: s.stage === 'askFacts' ? t : s.facts,
        }));
      }
      pushAI(r.text, { gotoPage: r.gotoPage, crisis: r.crisis });
    }, 350);
  }, [typing, coach, cfg, pushAI]);

  const resetCoach = useCallback(() => {
    setCoach({ stage: 'idle', original: '', topic: '', facts: '' });
    pushAI('好，练习先收起来。想重新开始时，直接把那句话发给我就行；想回顾哪一页，也随时说。');
  }, [pushAI]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    window.speechSynthesis?.cancel();
  }, []);

  const speaking = typing || voiceSpeaking;

  const overlay = (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* 气泡列：画面右侧，嵌入视频中 */}
      <div ref={listRef} className="pointer-events-auto absolute right-2 top-2 bottom-24 w-[62%] max-w-md space-y-2.5 overflow-y-auto pr-1 sm:right-4 sm:top-4" aria-live="polite">
        {msgs.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[95%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-md backdrop-blur-sm ${
              m.role === 'user'
                ? 'rounded-br-sm bg-[#8F5A38]/95 text-[#FFF9F0]'
                : m.crisis
                  ? 'rounded-bl-sm bg-[#FBEAE6]/95 text-[#7c2318] ring-2 ring-[#c05a48]'
                  : 'rounded-bl-sm bg-[#FFFDF9]/95 text-[#3E2C28] ring-1 ring-[#EADFCB]'
            }`}>
              {m.hint && <div className="mb-1 text-[11px] font-medium text-[#A0441B]">{m.hint}</div>}
              {m.shown ?? m.text}
              {m.gotoPage && (m.shown === undefined || m.shown.length >= m.text.length) && (
                <button onClick={() => onGotoPage(m.gotoPage!)}
                  className="mt-2 block cursor-pointer rounded-md bg-[#F4A23C]/25 px-2.5 py-1 text-xs font-medium text-[#8B1A1A] transition hover:bg-[#F4A23C]/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]">
                  ▶ 跳到 {m.gotoPage} 再看一眼
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 小柴：画面左下角，嵌在视频里 */}
      <div className="pointer-events-auto absolute bottom-2 left-2 flex flex-col items-center sm:bottom-3 sm:left-4">
        <div className={`w-[64px] rounded-full bg-[#FFFDF9]/90 p-1 shadow-lg ring-2 transition sm:w-[96px] ${speaking ? 'ring-[#F4A23C]' : 'ring-[#E8DCC4]'}`}>
          <DogAvatar speaking={speaking} />
        </div>
        <span className="mt-1 rounded-full bg-[#3E2C28]/80 px-2 py-0.5 text-[11px] text-[#FFF6E8] backdrop-blur-sm">
          {speaking ? '小柴 · 说话中' : '小柴 · 伴学助教'}
        </span>
        {coach.stage !== 'idle' && (
          <button onClick={resetCoach}
            className="mt-1 flex cursor-pointer items-center gap-1 rounded-full bg-[#F4A23C]/90 px-2 py-0.5 text-[11px] text-[#4a2a10] shadow transition hover:bg-[#F4A23C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            陪练中 · {coach.stage === 'askFacts' ? '追问事实' : coach.stage === 'giveVersions' ? '三版改写' : '微步行动'} <RotateCcw size={10} />
          </button>
        )}
      </div>
    </div>
  );

  const inputBar = <ChatInputBar typing={typing} voiceOn={voiceOn} onToggleVoice={toggleVoice} onSend={send} />;

  return { overlay, inputBar };
}

function ChatInputBar({ typing, voiceOn, onToggleVoice, onSend }: {
  typing: boolean; voiceOn: boolean; onToggleVoice: () => void; onSend: (t: string) => void;
}) {
  const [input, setInput] = useState('');
  const submit = (raw?: string) => {
    const t = (raw ?? input).trim();
    if (!t) return;
    setInput('');
    onSend(t);
  };
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK.map(q => (
          <button key={q.label} onClick={() => submit(q.send)} disabled={typing}
            className="flex cursor-pointer items-center gap-1 rounded-full bg-[#F0E7D8] px-2.5 py-1 text-xs text-[#6b554c] transition hover:bg-[#F4A23C]/30 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]">
            <q.icon size={12} /> {q.label}
          </button>
        ))}
        <button onClick={onToggleVoice} title={voiceOn ? '关闭语音朗读' : '开启语音朗读'}
          className={`ml-auto flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C] ${
            voiceOn ? 'bg-[#8B1A1A] text-[#FFF6E8]' : 'bg-[#F0E7D8] text-[#6b554c] hover:bg-[#F4A23C]/30'
          }`}>
          {voiceOn ? <Volume2 size={12} /> : <VolumeX size={12} />} {voiceOn ? '语音开' : '语音关'}
        </button>
      </div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); submit(); }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          placeholder="问我课程问题，或把那句否定自己的话发给我…"
          aria-label="与小柴对话"
          className="min-w-0 flex-1 rounded-xl border border-[#E0D3BF] bg-[#FFFDF9] px-3.5 py-2.5 text-[15px] text-[#3E2C28] placeholder:text-[#b6a294] focus:border-[#F4A23C] focus:outline-none" />
        <button type="submit" disabled={typing || !input.trim()} aria-label="发送"
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-[#8B1A1A] text-[#FFF6E8] shadow transition hover:bg-[#a02424] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]">
          <Send size={17} />
        </button>
      </form>
    </div>
  );
}
