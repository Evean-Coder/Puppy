import { X } from 'lucide-react';
import type { TeacherConfig } from '../engine/brain';

interface Props {
  open: boolean;
  cfg: TeacherConfig;
  onChange: (c: TeacherConfig) => void;
  onClose: () => void;
}

// 教师配置：学校心理辅导室信息 + 专业心理援助热线（仅存本机浏览器）
export default function SettingsPanel({ open, cfg, onChange, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="教师配置"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="w-full max-w-md rounded-2xl bg-[#FFFDF9] p-5 shadow-xl ring-1 ring-[#E8DCC4]">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-[#3E2C28]">教师配置 · 援助资源接口</h2>
          <button onClick={onClose} aria-label="关闭"
            className="cursor-pointer rounded-md p-1.5 text-[#6b554c] transition hover:bg-[#F0E7D8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]">
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[#8a7368]">
          填写后将展示在课后资源提示与危机转介语中。信息仅保存在当前浏览器，不会上传。
        </p>
        <label className="mt-4 block text-sm font-medium text-[#3E2C28]">
          学校心理辅导室（时间 / 地点 / 联系方式）
          <textarea value={cfg.roomInfo} onChange={e => onChange({ ...cfg, roomInfo: e.target.value })}
            rows={2} placeholder="例：每周一至周五 12:30–13:30，实验楼 3 层 302 室，找李老师"
            className="mt-1.5 w-full rounded-lg border border-[#E0D3BF] bg-white px-3 py-2 text-sm font-normal focus:border-[#F4A23C] focus:outline-none" />
        </label>
        <label className="mt-3 block text-sm font-medium text-[#3E2C28]">
          专业心理援助热线
          <textarea value={cfg.hotline} onChange={e => onChange({ ...cfg, hotline: e.target.value })}
            rows={2} placeholder="例：全国心理援助热线 12356（以当地公布为准）"
            className="mt-1.5 w-full rounded-lg border border-[#E0D3BF] bg-white px-3 py-2 text-sm font-normal focus:border-[#F4A23C] focus:outline-none" />
        </label>
        <button onClick={onClose}
          className="mt-4 w-full cursor-pointer rounded-xl bg-[#8B1A1A] py-2.5 text-sm font-medium text-[#FFF6E8] transition hover:bg-[#a02424] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F4A23C]">
          保存并关闭
        </button>
      </div>
    </div>
  );
}
