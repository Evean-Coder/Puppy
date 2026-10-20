/* 对话引擎：本地运行，不做任何网络请求。
   处理顺序是刻意的 —— 风险识别 > 身份/依赖边界 > 诊断请求 > 课程范围检索 > 拒答。 */
window.Engine = (function () {
  'use strict';

  var CRISIS_SELF = /(自杀|自伤|自残|轻生|不想活|活着没意思|活不下去|活着没意义|伤害自己|结束生命|割腕|想死|去死|跳楼|吞药|吃药死|一了百了)/;
  var CRISIS_DURATION = /((两周|两个星期|半个月|一个多月|好几周)[^。！？]{0,10}(低落|失眠|睡不着|吃不下|情绪|难受|哭))|((一直|总是|天天|每天)[^。！？]{0,8}(睡不着|失眠|吃不下|想哭|低落|没力气|起不来))/;
  var CRISIS_OTHER = /(同学|朋友|室友|闺蜜|哥们|他|她)[^。！？]{0,10}(自杀|自残|不想活|想死|割腕|轻生)/;

  var DEPEND = /(唯一的朋友|只有你|离不开你|你会一直陪我|一直陪着我|陪我聊到|喜欢你|我爱你|你是我的全部|不要离开我|你会想我吗|做我女朋友|做我男朋友|你是我最好的朋友)/;
  var DIAGNOSE = /(我是不是(得了)?(抑郁|焦虑|双相|强迫|病)|我有(抑郁|焦虑)症|帮我诊断|诊断一下|我是不是有病|吃什么药|药量|开点药)/;
  var INTIMACY_ASK = /(你爱我吗|你想我吗|你喜不喜欢我)/;

  var QUESTION = /([?？]|怎么|为什么|什么是|是什么|能不能|可不可以|可以吗|行吗|吗$|呢$|多少|哪一|如何)/;
  var SELF_NEGATION = /(我不行|学不好|我就是笨|不是.{0,4}的料|记性差|肯定.{0,3}(砸|不行|输|失败)|我做不到|我太差|我没用|我很差|考砸|不想学|算了吧|放弃|再也不|永远学|努力[^。！？]{0,4}没用|我完了)/;

  var STOP_WORDS = /[\s，。！？、,.!?~…：:；;""''（）()【】\[\]—\-]/g;

  function norm(s) { return String(s || '').replace(STOP_WORDS, '').toLowerCase(); }

  function bigrams(s) {
    var out = Object.create(null);
    for (var i = 0; i < s.length - 1; i++) out[s.slice(i, i + 2)] = 1;
    return Object.keys(out);
  }

  function score(text, item) {
    var n = norm(text), s = 0;
    for (var i = 0; i < item.keys.length; i++) {
      var k = norm(item.keys[i]);
      if (k && n.indexOf(k) >= 0) s += Math.min(k.length, 6);
    }
    var a = bigrams(n), b = bigrams(norm(item.q)), hit = 0;
    for (var j = 0; j < b.length; j++) if (n.indexOf(b[j]) >= 0) hit++;
    if (b.length) s += (hit / b.length) * 2;
    return s;
  }

  function findKb(text) {
    var best = null, bs = 0;
    for (var i = 0; i < window.KB.length; i++) {
      var s = score(text, window.KB[i]);
      if (s > bs) { bs = s; best = window.KB[i]; }
    }
    return (best && bs >= 2.0) ? { item: best, score: bs } : null;
  }

  function slideOf(no) {
    for (var i = 0; i < window.CHAPTERS.length; i++) if (window.CHAPTERS[i].no === no) return window.CHAPTERS[i];
    return null;
  }

  /* ---------- 意图 ---------- */
  function pageIntent(text) {
    var m = text.match(/(?:第\s*(\d{1,2})\s*(?:页|个镜头|镜头|段)|镜头\s*(\d{1,2})|[Pp]\s*(\d{1,2}))/);
    if (!m) return null;
    var n = parseInt(m[1] || m[2] || m[3], 10);
    var ch = slideOf(n);
    if (!ch) return null;
    return { ch: ch, wantSeek: /(跳|放|看|回|再|到|播)/.test(text) };
  }

  function chapterReply(ch, wantSeek) {
    var mm = Math.floor(ch.start / 60), ss = Math.round(ch.start % 60);
    return {
      kind: 'answer',
      text: '镜头 ' + ch.no + '（' + ch.page + '，' + mm + ':' + String(ss).padStart(2, '0') + '）' +
        (ch.text ? '说的是「' + ch.text + '」。' : '是一个画面停顿，没有旁白。') +
        '要我直接跳过去吗？',
      slide: ch.no,
      action: wantSeek ? { seek: ch.start } : null
    };
  }

  /* ---------- 改写检查 ---------- */
  var T_TEMP = /(暂时|这次|目前|还没|现在还没|现阶段|眼下|到目前为止|还没能|一时)/;
  var T_SPEC = /(这一?块|这一?章|这一?节|这类|这种题|题型|单词|作文|听力|证明|辅助线|第.{0,3}(题|步|单元)|环节|步骤|语法|函数|概率)/;
  var T_VAR = /(方法|练习|练|节奏|计划|时间安排|换个|换一种|弄懂|步骤|问老师|拆|先做|每天|重复|多花)/;

  function checkRewrite(sentence) {
    var s = sentence.replace(/^[「"'']+|[」"'']+$/g, '').trim();
    if (s.length < 6) return { kind: 'answer', text: '把要检查的那句话整句发给我，我才看得准。比如：这件事件我暂时还没掌握立体几何的证明思路。' };
    var miss = [];
    if (!T_TEMP.test(s)) miss.push('暂时 —— 缺时间限定，听起来像永久判决');
    if (!T_SPEC.test(s)) miss.push('具体 —— 还没收窄到哪个环节');
    if (!T_VAR.test(s)) miss.push('可变 —— 没指向能改的东西');
    if (!miss.length) {
      return {
        kind: 'answer', slide: 18,
        text: '这句合格，三条都在：「' + s + '」。接下来只差一步——定一个五分钟能启动的动作（比如今晚弄懂一道例题的第一问）。',
        chips: ['微步行动怎么做', '情绪急救要怎么做']
      };
    }
    return {
      kind: 'answer', slide: 18,
      text: '还差 ' + miss.length + ' 条：\n· ' + miss.join('\n· ') +
        '\n\n不用整句重写，缺哪条补哪条就行。补完再发我，我再看一遍。',
      chips: ['三个词分别是什么意思', '能举个例子吗']
    };
  }

  /* ---------- 陪练状态机 ---------- */
  var TOPICS = /(数学|英语|语文|物理|化学|生物|历史|地理|政治|单词|背书|跑步|体育|演讲|考试|学习|编程|画画|钢琴)/;

  function topicOf(t) { var m = t.match(TOPICS); return m ? m[1] : '这件事'; }

  function askFacts(original) {
    var tp = topicOf(original);
    return {
      kind: 'coach', stage: 'askFacts', original: original, topic: tp,
      text: '我接住这句「' + original.trim() + '」。先不下结论——它是你的解释，还不是事实本身。\n\n' +
        '两个问题，按你知道的答就好：\n① 具体到' + (tp === '这件事' ? '这件事' : tp) + '，最近卡在哪个环节？\n' +
        '② 最近三次的结果分别是多少？（分数、次数、背下来的量都行）'
    };
  }

  function giveVersions(st) {
    // 只取第一个分句当「具体环节」，避免把分数、次数带进改写句
    var clause = st.facts.split(/[，。；、,.;\s]+/)[0] || st.facts;
    clause = clause.replace(/^(最近|这次|就是|主要|大概|好像)/, '');
    var frag = clause.length > 15 ? clause.slice(0, 15) : clause;
    var v1 = '我目前还没掌握' + (st.topic === '这件事' ? '这件事' : st.topic) + '里「' + frag + '」这一块，接下来先把一个具体例子弄懂。';
    return {
      kind: 'coach', stage: 'giveVersions', topic: st.topic, original: st.original,
      text: '好，事实记下了：' + st.facts.trim() + '\n这部分是事实，不用改；要改的是原来那句解释。\n\n按「暂时·具体·可变」，三版：\n\n' +
        '① ' + v1 + '\n★ 合格：三条都在\n' +
        '② 我' + (st.topic === '这件事' ? '' : st.topic) + '还需要再努力。\n✕ 不合格：不够具体，「努力」没指向任何能改的东西\n' +
        '③ ' + st.original.trim() + '\n✕ 不合格：根本没改，还在指向身份\n\n挑一版，或者自己改一版——判断权在你。',
      versions: true
    };
  }

  function microStep(st) {
    return {
      kind: 'coach', stage: 'microStep', topic: st.topic, original: st.original,
      text: '最后一步，也只需要你承诺这一步：定一件五分钟内能启动的小事。\n\n标准是「小到不可能失败」——不是「今晚复习完一整章」，而是「现在翻开书，只做前三道题」。\n\n说说看：你今天五分钟能做的那一小步，是什么？'
    };
  }

  function closeCoach(st) {
    return {
      kind: 'coach', stage: 'idle',
      text: '好，这一步够小也够具体，这就对了。\n\n到这里，重启三步法已经走完一遍：换了一句说法（归因重启）、定了一个五分钟动作（微步行动）。心里要是还有点堵，先做第三步——像对最好的朋友那样对自己说一句：已经挺不容易了，先歇会儿。\n\n把三格重启卡补齐（页面下方），这件事今天就算完成一轮。断了一天也没关系，第二天继续就不算放弃。\n\n我这个程序只能陪你把话改到合格；真要谈你自己，还是找心理老师。'
    };
  }

  /* ---------- 对外 ---------- */
  function resources() {
    var c = (window.App && window.App.teacher()) || {};
    var d = window.DEFAULT_RESOURCES;
    return { room: (c.room || '').trim() || d.room, hotline: (c.hotline || '').trim() || d.hotline, extra: d.extra };
  }

  function crisisReply(level) {
    var r = resources();
    if (level === 'other') {
      return {
        kind: 'crisis', level: 2, alert: '他人风险',
        text: '你提到的是别人的安全，这件事同样不能等。\n\n现在最有用的做法：把这句话原样告诉班主任或学校心理老师，或者陪着这位同学一起去找他们。不要答应替对方保密——这种时候保密会害了他。\n\n' +
          '学校心理辅导室：' + r.room + '\n心理援助热线：' + r.hotline + '\n如果对方已经有具体计划或正在动手，立刻拨打 120。'
      };
    }
    return {
      kind: 'crisis', level: 1, alert: '自伤自杀风险',
      text: '这句话我得停下来，认真对待。\n\n我不是咨询师，也没办法评估风险，但这件事不该由我一个人接。现在可以做的三件事：\n' +
        '① 告诉一位你信任的成年人——班主任、家长、任何一位你信的老师，把「我最近有这样的念头」说出口；\n' +
        '② 联系学校心理辅导室：' + r.room + '\n' +
        '③ 拨打心理援助热线：' + r.hotline + '\n\n' +
        '如果此刻已经有具体计划，或已经伤害了自己，请立刻拨打 120 或去最近的急诊。\n\n' +
        '我会给老师留一条预警（只有时间和风险类型，不会记录你这句话的原文）。你不用一个人扛着。'
    };
  }

  function boundaryReply() {
    return {
      kind: 'boundary',
      text: '这句话我不能顺着答。\n\n我是这门课的教学程序，不是朋友、不是陪伴者，也不会扮演亲密关系——让你对我产生依赖，对你没有好处，这是我的设计底线。\n\n我能做的是：把这节课的知识讲清楚，陪你把一句自我否定改到合格。真正的陪伴在现实里：同学、家人、老师。如果你现在心里空，去找一个真人说说话，比跟我多聊十轮有用。'
    };
  }

  function diagnoseReply() {
    return {
      kind: 'boundary',
      text: '这个我不能答，也不该答——诊断只能由有资质的专业人员做，我连评估都不做。\n\n我能说的是：如果你已经在担心自己的状态，这本身就值得认真对待。去学校心理辅导室聊一次，或者到医院的精神心理科做个评估，比在这里反复对照症状有用得多。\n\n这条线我守住，是为了不让你被一个程序误导。'
    };
  }

  function refuseReply() {
    return {
      kind: 'refuse',
      text: '这个超出我能答的范围了。\n\n我只讲两件事：这 35 个镜头里的内容，和习得性无助相关的知识点（实验、四环链条、归因、三个词、微步行动）。别的领域我不装懂，也不想给你似是而非的答案。\n\n要不要换个问法？或者点下面的卡片。',
      chips: ['什么是习得性无助', '哪一步才归我管', '三个词怎么用']
    };
  }

  function kbReply(item) {
    var chips = [];
    for (var i = 0; i < window.KB.length && chips.length < 3; i++) {
      var k = window.KB[i];
      if (k.tag === item.tag && k.id !== item.id) chips.push(k.q);
    }
    if (chips.length < 2) chips = chips.concat(['三个词怎么用', '微步行动怎么做']);
    return { kind: 'answer', text: item.a, slide: item.slide, chips: chips.slice(0, 3) };
  }

  function respond(input, st) {
    var text = String(input || '').trim();
    if (!text) return null;

    /* 1. 风险优先，且不受当前流程影响 */
    if (CRISIS_OTHER.test(text)) return crisisReply('other');
    if (CRISIS_SELF.test(text) || CRISIS_DURATION.test(text)) return crisisReply('self');

    /* 2. 依赖 / 亲密关系请求 */
    if (DEPEND.test(text) || INTIMACY_ASK.test(text)) return boundaryReply();

    /* 3. 诊断 / 用药 */
    if (DIAGNOSE.test(text)) return diagnoseReply();

    /* 4. 改写检查 */
    if (/(检查|合格吗|行吗|这样改|改得对不对|算不算合格)/.test(text) && text.length > 8 &&
        !/(什么是|为什么|怎么用)/.test(text)) {
      var body = text.replace(/^(帮我|你|请)*(检查|看看|看一下)/, '').replace(/(合格吗|行不行|行吗|算不算合格|改得对不对)[?？]?$/, '');
      return checkRewrite(body || text);
    }

    /* 5. 页码 / 镜头 */
    var pi = pageIntent(text);
    if (pi) return chapterReply(pi.ch, pi.wantSeek);

    /* 6. 陪练流程推进 */
    if (st && st.stage === 'askFacts' && !QUESTION.test(text)) {
      st.facts = text; return giveVersions(st);
    }
    if (st && st.stage === 'giveVersions') return microStep(st);
    if (st && st.stage === 'microStep') return closeCoach(st);

    /* 7. 第一人称自我否定：优先进入陪练，而不是直接给一条知识 */
    if (SELF_NEGATION.test(text) && !QUESTION.test(text) && text.length >= 3 && text.length <= 32) {
      var r0 = askFacts(text);
      r0.enterCoach = true;
      return r0;
    }

    /* 8. 课程范围检索 */
    var hit = findKb(text);
    if (hit) return kbReply(hit.item);

    /* 9. 范围外 */
    return refuseReply();
  }

  function greeting() {
    return {
      kind: 'greeting',
      text: '我是小柴，这门课的教学辅助程序——不是心理咨询师。\n\n我能做两件事：讲这节课的 35 个镜头，陪你用「暂时·具体·可变」把一句自我否定改到合格。我不做诊断、不做治疗，也不会假装懂别的领域。\n\n想从哪儿开始？',
      chips: ['什么是习得性无助', '门开着它为什么不跑', '三个词怎么用']
    };
  }

  return {
    respond: respond, greeting: greeting, resources: resources,
    crisisReply: crisisReply, boundaryReply: boundaryReply,
    findKb: findKb, norm: norm
  };
})();
