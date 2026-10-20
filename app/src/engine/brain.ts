// 伴学助教对话引擎：本地规则引擎，温和、理性、非评判，第一人称「我」
import { COURSE_PAGES, CONCEPTS, type CoursePage, type Concept } from '../data/course';

export interface TeacherConfig {
  roomInfo: string;   // 学校心理辅导室：时间/地点
  hotline: string;    // 专业心理援助热线
}

export interface CoachState {
  stage: 'idle' | 'askFacts' | 'giveVersions' | 'microStep';
  original: string;   // 学生原句
  topic: string;      // 抽取出的事领域，如「数学」
  facts: string;      // 学生补充的事实
}

export interface Reply {
  text: string;
  gotoPage?: string;        // 建议跳转的页面
  crisis?: boolean;         // 危机响应
  coachingStage?: CoachState['stage'];
}

const CRISIS_STRONG = /(自杀|自伤|自残|自虐|轻生|不想活|活着没意思|活不下去|伤害自己|结束生命|割腕|想死|去死)/;
const CRISIS_DURATION = /(两周|两个星期|半个月|持续.{0,4}(低落|失眠|睡不着|吃不下|情绪)|(一直|总是|天天).{0,4}(睡不着|失眠|吃不下|想哭|低落))/;

export function detectCrisis(text: string): boolean {
  return CRISIS_STRONG.test(text) || CRISIS_DURATION.test(text);
}

export function crisisReply(cfg: TeacherConfig): string {
  const lines = [
    '我要在这里停下来，练习先不做了。',
    '',
    '请立刻告诉信任的成年人或学校心理老师，这不是AI该处理的事。',
  ];
  if (cfg.roomInfo.trim()) lines.push(`学校心理辅导室：${cfg.roomInfo.trim()}`);
  if (cfg.hotline.trim()) lines.push(`专业心理援助热线：${cfg.hotline.trim()}`);
  lines.push('你不需要一个人扛着这件事。');
  return lines.join('\n');
}

const SELF_NEGATION = /(我不行|学不好|我就是笨|不是.{0,4}的料|记性差|肯定.{0,3}(砸|不行|输|失败)|我做不到|我太差|我没用|我很差|考砸|不想学|算了吧|放弃|再也不|永远学|怎么努力都没用)/;

function extractTopic(text: string): string {
  const m = text.match(/(数学|英语|语文|物理|化学|生物|历史|地理|政治|单词|背书|跑步|体育|演讲|考试|学习)/);
  return m ? m[1] : '这件事';
}

function findPage(text: string): CoursePage | null {
  const m = text.match(/[Pp]\s*(\d{1,2})|第\s*(\d{1,2})\s*页/);
  if (m) {
    const n = m[1] || m[2];
    const p = COURSE_PAGES.find(pg => pg.id === `P${n}`);
    if (p) return p;
  }
  // 按标题/要点模糊匹配
  let best: CoursePage | null = null; let score = 0;
  for (const pg of COURSE_PAGES) {
    let s = 0;
    for (const kp of pg.keyPoints) if (text.includes(kp.slice(0, 4))) s += 2;
    if (pg.title.length >= 4 && text.includes(pg.title.slice(0, 6))) s += 3;
    if (s > score) { score = s; best = pg; }
  }
  return score >= 2 ? best : null;
}

function findConcept(text: string): Concept | null {
  for (const c of CONCEPTS) if (c.keys.some(k => text.includes(k))) return c;
  return null;
}

function pageReply(pg: CoursePage): Reply {
  return {
    text: `这一页是 ${pg.id}《${pg.title}》（${fmt(pg.start)}–${fmt(pg.end)}）。\n\n${pg.brief}\n\n要点：\n${pg.keyPoints.map(k => `· ${k}`).join('\n')}\n\n想让我把画面跳到这一页的话，点下方按钮即可。`,
    gotoPage: pg.id,
  };
}

function fmt(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function startCoaching(original: string): Reply {
  const topic = extractTopic(original);
  return {
    text: `好，我接住这句「${original.trim()}」。\n\n先不忙下结论——我们先把事实和想法分开（P18）：这句话是你的解释，还不是事实本身。\n\n所以我想先追问两件事实，你按你知道的回答就好：\n1. 具体到「${topic}」这件事，最近具体卡在哪个环节？（比如哪一类题、哪一个部分丢分最多）\n2. 最近三次相关的结果分别是多少？（分数、次数、背下来的量都行）`,
    coachingStage: 'askFacts',
  };
}

function giveVersions(state: CoachState, facts: string): Reply {
  const topic = state.topic || extractTopic(state.original);
  const v1 = `我目前还没有掌握${topic}里「${facts.slice(0, 18)}」这一环节；接下来我先针对这一小块，弄懂一个具体例子。`;
  const v2 = `我${topic === '这件事' ? '' : topic}还需要继续努力。`;
  const v3 = state.original.trim();
  return {
    text: `好，谢谢你把事实说清楚：「${facts.trim()}」。这部分是事实，不需要改；要改的是原来那句解释。\n\n按「暂时、具体、可变」三条标准（P16），我给你三版改写：\n\n① ${v1}\n★ 合格：暂时（还没有，不是永远）· 具体（收窄到环节）· 可变（指向方法和练习）\n\n② ${v2}\n✕ 不合格：不够具体——「努力」没指向任何能改的东西\n\n③ ${v3}\n✕ 不合格：根本没改，还是在指向身份\n\n你可以自己挑——这也是陪练的规则：我给三版，判断权在你（P24）。挑好以后，我们做最后一步。`,
    coachingStage: 'giveVersions',
  };
}

function microStep(_state: CoachState): Reply {
  const topic = _state.topic;
  return {
    text: `最后一步，也是唯一需要你承诺的一步：定一件 5 分钟内就能启动的小事（P28 微步行动）。\n\n注意标准——小到不可能失败：不是「今晚复习完一整章」，那是给自己挖第三个坑；而是类似「现在翻开${topic === '这件事' ? '书' : topic + '的书'}，只做前三道题」这样的动作。\n\n为什么要这么小？因为小到不可能失败，你就会重新拿到一次「我做到了」的经验——而这，才真正松动那条链。\n\n说说看：你今天 5 分钟内能启动的那一小步，是什么？`,
    coachingStage: 'microStep',
  };
}

function closeCoaching(_state: CoachState, step: string): Reply {
  return {
    text: `好，「${step.trim()}」——这一步足够小，也够具体，这就对了。\n\n到这里，我们其实已经把重启三步法走完了一遍（P26）：换了一句说法（归因重启），定了一个 5 分钟动作（微步行动）。如果这会儿心里还有点堵，先做第三步——像对你最好的朋友那样对自己说一句：已经挺不容易了，先歇会儿（P29）。\n\n最后，如果你愿意，可以把今天的三格重启卡补齐（P30）：① 这次具体发生了什么；② 换的说法；③ 刚才这一小步。写完可以发给我，我替你检查第②格是否三条标准都合格。\n\n断了一天也没关系——第二天继续，就不算放弃。`,
    coachingStage: 'idle',
  };
}

const GREET = /^(你好|嗨|hi|hello|在吗|老师好|您好)/i;
const THANKS = /(谢谢|感谢|辛苦)/;
const WHO = /(你是谁|你是AI|你是谁|机器人|真人)/;

export function think(input: string, state: CoachState, cfg: TeacherConfig): Reply {
  const text = input.trim();

  // 0. 危机识别：最高优先级，立即停止一切流程
  if (detectCrisis(text)) {
    return { text: crisisReply(cfg), crisis: true, coachingStage: 'idle' };
  }

  // 1. 陪练流程推进（状态机优先于通用意图）
  if (state.stage === 'askFacts') {
    if (text.length < 2) return { text: '我在听。哪怕只说一个大概也行——具体卡在哪个环节？最近几次的结果大概是多少？', coachingStage: 'askFacts' };
    return giveVersions({ ...state, facts: text }, text);
  }
  if (state.stage === 'giveVersions') {
    // 若学生又抛新的自我否定，先接事实
    if (SELF_NEGATION.test(text) && !/[①②③123挑选]/.test(text)) {
      return giveVersions(state, text);
    }
    return microStep(state);
  }
  if (state.stage === 'microStep') {
    return closeCoaching(state, text);
  }

  // 2. 身份声明
  if (WHO.test(text)) {
    return { text: '我是这节课的 AI 伴学助教——伴你一起看完《那只放弃挣扎的狗》。说明白一点：我是AI伴学助手，不是专业心理医生；练习和概念我可以陪你拆，但情绪上真正难熬的部分，请交给信任的成年人和学校心理老师。\n\n我可以做三件事：解答这节微课里的任何一页、当「归因改写陪练」陪你改一句话、随时带你回顾某个概念。' };
  }

  // 3. 页面回顾请求
  if (/(回顾|讲一讲|讲解|再看|跳到|回到|第.{1,3}页|P\d|哪一页)/.test(text)) {
    const pg = findPage(text);
    if (pg) return pageReply(pg);
  }

  // 4. 概念讲解
  const concept = findConcept(text);
  if (concept && /(是什么|什么意思|什么是|解释|回顾|讲讲|不懂|没懂|再说)/.test(text) || (concept && text.length <= 12)) {
    const pg = COURSE_PAGES.find(p => p.id === concept.pageId)!;
    return { text: `${concept.explain}\n\n这段对应 ${concept.pageId}《${pg.title}》（${fmt(pg.start)}–${fmt(pg.end)}），可以跳回去再看一眼。`, gotoPage: concept.pageId };
  }

  // 5. 自我否定 → 启动归因改写陪练
  if (SELF_NEGATION.test(text)) {
    return startCoaching(text);
  }

  // 6. 打招呼 / 感谢
  if (GREET.test(text)) {
    return { text: '你好，我在。我是这节课的 AI 伴学助手，不是专业心理医生，但这十分钟里的内容，我可以陪你慢慢拆。\n\n你可以：问我任何一页讲了什么（比如「回顾 P14」）；把一句自我否定的话丢给我，我做你的归因改写陪练；或者只是看到哪里卡住了，直接问我。' };
  }
  if (THANKS.test(text)) {
    return { text: '不用谢。记住顺序就好：改一句话、迈一小步、照顾好状态——顺序别反（P31）。还有想回顾的页面或概念，随时叫我。' };
  }

  // 7. 关键帧提问的回应（学生在回答猜想类问题）
  if (/(会逃|不会逃|不动|趴着|跳过去|B ?组|A ?组|C ?组)/.test(text) && /(猜|觉得|认为|因为|可能|吧|。)?/.test(text) && text.length < 60) {
    return { text: `你的判断有道理。实验的真实结果是（P9）：A 组一跃而过，C 组犹豫了一下也跳了过去，只有 B 组趴在原地一动不动——把它抱到门口，它自己又趴了回去。\n\n它不是不会跳，是不再相信「跳」有用（P11）：它学到的是「我做什么，都不会改变结果」——注意，这是一个关于未来的判断。`, gotoPage: 'P9' };
  }

  // 8. 页码/标题直达
  const direct = findPage(text);
  if (direct) return pageReply(direct);

  // 9. 兜底：温和引导回课程内容
  return {
    text: '我把这句话先放在这里——我们慢慢来。\n\n我这边的本事主要在三件事上：\n1. 讲解这节微课的任何一页（直接说「回顾 P8」「P14 讲了什么」）；\n2. 解释概念（习得性无助、四环链条、三个词标准、事实与想法分开、微步行动……）；\n3. 当「归因改写陪练」——把一句你对自己说的否定的话发给我，我不安慰你，只陪你按「暂时、具体、可变」把它改到合格。\n\n你想从哪一个开始？',
  };
}
