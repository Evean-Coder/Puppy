import { useCallback, useEffect, useRef, useState } from 'react';
import Player, { type PlayerHandle } from './components/Player';
import { useChat, type ChatHandle } from './components/StageChat';
import SettingsPanel from './components/SettingsPanel';
import { COURSE_PAGES } from './data/course';
import type { TeacherConfig } from './engine/brain';
import { Settings, ShieldCheck, Dog } from 'lucide-react';

const CFG_KEY = 'dog-course-teacher-config';

export default function App() {
  const playerRef = useRef<PlayerHandle>(null);
  const chatRef = useRef<ChatHandle>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [pageId, setPageId] = useState('P1');
  const [cfg, setCfg] = useState<TeacherConfig>(() => {
    const dflt: TeacherConfig = { roomInfo: '', hotline: '' };
    try {
      const raw = JSON.parse(localStorage.getItem(CFG_KEY) || 'null') as Partial<TeacherConfig> | null;
      // 只认这两个字段，且必须是字符串：旧结构或 "null" 都能兜住，不然 trim() 会直接抛错白屏
      if (!raw || typeof raw !== 'object') return dflt;
      return {
        roomInfo: typeof raw.roomInfo === 'string' ? raw.roomInfo : '',
        hotline: typeof raw.hotline === 'string' ? raw.hotline : '',
      };
    } catch { return dflt; }
  });

  useEffect(() => { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }, [cfg]);

  // 关键冲突帧：小柴在视频画面里主动开口提问
  const onKeyframe = useCallback((k: { question: string; hint: string; pageId: string }) => {
    chatRef.current?.inject(k.question, `${k.hint} · 小柴主动提问`);
  }, []);

  const gotoPage = useCallback((pid: string) => playerRef.current?.seekToPage(pid), []);
  const { overlay, inputBar } = useChat(cfg, gotoPage, chatRef);

  const page = COURSE_PAGES.find(p => p.id === pageId)!;

  return (
    <div className="flex min-h-dvh flex-col bg-[#F7F1E6] text-[#3E2C28]">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-[#E8DCC4] bg-[#FFFDF9] px-4 py-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#8B1A1A] text-[#F4A23C]">
          <Dog size={18} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold">《那只放弃挣扎的狗》· 数字人伴学助教</h1>
          <p className="truncate text-xs text-[#8a7368]">高二心理健康微课 · 识别习得性无助，完成一次自我重启</p>
        </div>
        <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-[#F0E7D8] px-2.5 py-1 text-xs text-[#6b554c] md:flex">
          <ShieldCheck size={13} className="text-[#8B1A1A]" /> 我是AI伴学助手，不是专业心理医生
        </span>
        <button onClick={() => setSettingsOpen(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#E0D3BF] px-2.5 py-1.5 text-xs text-[#6b554c] transition hover:bg-[#F0E7D8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]">
          <Settings size={14} /> 教师配置
        </button>
      </header>

      {/* 主体：舞台 = 视频 + 嵌入的小柴数字人 */}
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">
        <section className="rounded-2xl bg-[#FFFDF9] p-4 shadow-sm ring-1 ring-[#E8DCC4]">
          <Player ref={playerRef} onKeyframe={onKeyframe} onPageChange={setPageId}
            videoUrl={videoUrl} onVideoUpload={setVideoUrl} overlay={overlay} />
          {inputBar}
        </section>
      </main>

      {/* 底栏：当前页 + 伦理声明 */}
      <footer className="border-t border-[#E8DCC4] bg-[#FFFDF9] px-4 py-2 text-center text-xs leading-relaxed text-[#8a7368]">
        正在学习 {page.id}《{page.title}》 · 本助手仅作课程伴学，不做任何专业心理诊断与承诺；如遇持续两周以上情绪低落、睡眠饮食异常或自伤念头，请立刻告诉信任的成年人或学校心理老师
        {cfg.roomInfo.trim() ? ` · 学校心理辅导室：${cfg.roomInfo.trim()}` : ''}
        {cfg.hotline.trim() ? ` · 心理援助热线：${cfg.hotline.trim()}` : ''}
      </footer>

      <SettingsPanel open={settingsOpen} cfg={cfg} onChange={setCfg} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
