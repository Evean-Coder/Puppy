import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { COURSE_PAGES, KEYFRAMES, TOTAL_SECONDS } from '../data/course';
import { Play, Pause, SkipBack, Upload, X } from 'lucide-react';

export interface PlayerHandle { seekToPage: (pageId: string) => void; }

interface Props {
  onKeyframe: (q: { question: string; hint: string; pageId: string }) => void;
  onPageChange: (pageId: string) => void;
  videoUrl: string | null;
  onVideoUpload: (url: string | null) => void;
  overlay?: React.ReactNode;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const Player = forwardRef<PlayerHandle, Props>(function Player({ onKeyframe, onPageChange, videoUrl, onVideoUpload, overlay }, ref) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const firedRef = useRef<Set<number>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const page = COURSE_PAGES.find(p => t >= p.start && t < p.end) ?? COURSE_PAGES[COURSE_PAGES.length - 1];

  // 幻灯片模式计时器
  useEffect(() => {
    if (videoUrl || !playing) return;
    const i = window.setInterval(() => {
      setT(prev => {
        const nx = Math.min(prev + 0.25, TOTAL_SECONDS);
        if (nx >= TOTAL_SECONDS) setPlaying(false);
        return nx;
      });
    }, 250);
    return () => clearInterval(i);
  }, [playing, videoUrl]);

  // 关键帧触发：仅在自然播放经过的瞬间触发一次（拖动跳过不补发）
  const prevT = useRef(0);
  useEffect(() => {
    const prev = prevT.current;
    prevT.current = t;
    if (t < prev) return; // 回拖不触发
    for (const k of KEYFRAMES) {
      if (prev < k.at && t >= k.at && t - k.at <= 1.5 && !firedRef.current.has(k.at)) {
        firedRef.current.add(k.at);
        onKeyframe({ question: k.question, hint: k.hint, pageId: k.pageId });
      }
    }
  }, [t, onKeyframe]);

  useEffect(() => { onPageChange(page.id); }, [page.id, onPageChange]);

  // 视频模式时间同步
  useEffect(() => {
    if (!videoUrl) return;
    const v = videoRef.current; if (!v) return;
    const h = () => setT(Math.min(v.currentTime, TOTAL_SECONDS));
    v.addEventListener('timeupdate', h);
    return () => v.removeEventListener('timeupdate', h);
  }, [videoUrl]);

  useImperativeHandle(ref, () => ({
    seekToPage: (pageId: string) => {
      const p = COURSE_PAGES.find(pg => pg.id === pageId);
      if (!p) return;
      if (videoUrl && videoRef.current) { videoRef.current.currentTime = p.start + 0.1; }
      setT(p.start + 0.01);
    },
  }), [videoUrl]);

  const progress = (t / TOTAL_SECONDS) * 100;

  return (
    <div className="flex h-full flex-col">
      {/* 画面区 */}
      <div className="relative flex-1 overflow-hidden rounded-xl bg-[#241a15] shadow-inner">
        {videoUrl ? (
          <video ref={videoRef} src={videoUrl} className="h-full w-full object-contain"
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} controls={false} />
        ) : (
          <img key={page.img} src={`${import.meta.env.BASE_URL}slides/${page.img}`} alt={`${page.id} ${page.title}`}
            className="h-full w-full object-contain transition-opacity duration-300" />
        )}
        {/* 页标 */}
        <div className="absolute left-3 top-3 rounded-md bg-black/45 px-2.5 py-1 text-xs text-[#FFF6E8] backdrop-blur-sm">
          {page.id} · {page.title}
        </div>
        <button onClick={() => fileRef.current?.click()} title="教师：载入本地微课视频（mp4）"
          className="absolute right-3 top-3 z-20 flex cursor-pointer items-center gap-1.5 rounded-md bg-black/45 px-2.5 py-1 text-xs text-[#FFF6E8] backdrop-blur-sm transition hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]">
          <Upload size={13} /> {videoUrl ? '更换视频' : '载入视频'}
        </button>
        {videoUrl && (
          <button onClick={() => onVideoUpload(null)} title="回到课件帧播放"
            className="absolute right-3 top-11 z-20 cursor-pointer rounded-md bg-black/45 p-1.5 text-[#FFF6E8] backdrop-blur-sm transition hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]">
            <X size={13} />
          </button>
        )}
        <input ref={fileRef} type="file" accept="video/mp4,video/webm" className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) onVideoUpload(URL.createObjectURL(f));
            e.target.value = '';
          }} />
        {overlay}
      </div>

      {/* 控制条 */}
      <div className="mt-3 space-y-2">
        <input type="range" min={0} max={TOTAL_SECONDS} step={0.25} value={t} aria-label="播放进度"
          onChange={e => {
            const v = Number(e.target.value);
            setT(v);
            if (videoUrl && videoRef.current) videoRef.current.currentTime = v;
          }}
          className="slider w-full cursor-pointer"
          style={{ background: `linear-gradient(to right, #F4A23C ${progress}%, #E8DCC4 ${progress}%)` }} />
        <div className="flex items-center gap-3">
          <button onClick={() => { setT(0); firedRef.current.clear(); if (videoRef.current) videoRef.current.currentTime = 0; }}
            title="从头开始"
            className="cursor-pointer rounded-md p-2 text-[#3E2C28] transition hover:bg-[#F4A23C]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]">
            <SkipBack size={16} />
          </button>
          <button onClick={() => {
              if (videoUrl && videoRef.current) { videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause(); }
              else setPlaying(p => !p);
            }}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-[#8B1A1A] text-[#FFF6E8] shadow transition hover:bg-[#a02424] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]"
            aria-label={playing ? '暂停' : '播放'}>
            {playing ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
          </button>
          <span className="font-mono text-sm text-[#6b554c]">{fmt(t)} / 10:00</span>
          <span className="ml-auto hidden text-xs text-[#8a7368] sm:block">
            {videoUrl ? '视频模式 · 已同步页面时间轴' : '课件帧模式 · 可载入录制好的微课视频'}
          </span>
        </div>
      </div>

      {/* 33 页快速跳转 */}
      <div className="mt-3 flex flex-wrap gap-1.5 overflow-y-auto pr-1" style={{ maxHeight: 84 }}>
        {COURSE_PAGES.map(p => (
          <button key={p.id} onClick={() => {
              setT(p.start + 0.01);
              if (videoUrl && videoRef.current) videoRef.current.currentTime = p.start + 0.1;
            }}
            title={p.title}
            className={`cursor-pointer rounded px-1.5 py-0.5 text-[11px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C] ${
              p.id === page.id ? 'bg-[#8B1A1A] font-medium text-[#FFF6E8]' : 'bg-[#F0E7D8] text-[#6b554c] hover:bg-[#F4A23C]/30'
            }`}>
            {p.id}
          </button>
        ))}
      </div>
    </div>
  );
});

export default Player;
