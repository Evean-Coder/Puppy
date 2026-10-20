/* DeepSeek API 客户端。
   只走官方 api.deepseek.com（已确认允许 127.0.0.1 跨域），不经过任何第三方中转。
   key 只存本机 localStorage；不做服务端保存。 */
window.LLM = (function () {
  'use strict';

  var CFG_KEY = 'shiba.ai.v1';
  var ENDPOINT = 'https://api.deepseek.com/chat/completions';
  var cfg = { key: '', model: 'deepseek-chat', on: true };

  function load() {
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        cfg.key = d.key || '';
        cfg.model = d.model || 'deepseek-chat';
        cfg.on = d.on !== false;
      }
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  function set(patch) {
    Object.keys(patch).forEach(function (k) { cfg[k] = patch[k]; });
    save();
  }
  function ready() { return !!(cfg.key && cfg.on); }
  function state() { return { hasKey: !!cfg.key, on: cfg.on, model: cfg.model, ready: ready() }; }
  function clearKey() { cfg.key = ''; save(); }

  /* 课程事实：作为 system 上下文，避免模型自由发挥 */
  var COURSE = [
    '课程《那只放弃挣扎的狗》是高中心理健康微课，10 分钟，35 个镜头。',
    '主线：1967 年塞利格曼三组狗实验 → 命名习得性无助 → 四环链条 → 归因改写 → 重启三步法 → 重启卡。',
    '关键事实：',
    '1. 三组狗同笼同矮栅栏：A 组电击可跳过逃走（努力有效）；B 组栅栏锁死（努力无效）；C 组无电击。第二阶段门全开，A、C 组逃走，B 组趴着不动，抱到门口又趴回去。',
    '2. B 组不是不会跳，而是学到「我做什么都不会改变结果」——这是一个关于未来的判断。',
    '3. 习得性无助＝反复失败后学到的「行为无法控制结果」的预期。关键词是「习得」：学来的，就能被新经验改写。',
    '4. 四环链条：①反复失败 ②归因「我不行」 ③预期「下次也一样」 ④不再尝试。①不可改，③④是②的结果，唯一可改的是②。',
    '5. 归因三维度：内部/外部、稳定/不稳定、普遍/具体；指向内部、稳定、普遍的归因最容易滑向无助。',
    '6. 三个词：暂时（不是永远）、具体（收窄到环节）、可变（指向方法、练习量、节奏）。',
    '7. 事实与想法分开：「这次 72 分」是事实；「我学不好数学」是解释。',
    '8. 重启三步：归因重启（换说法）→ 微步行动（5 分钟能启动、小到不可能失败）→ 情绪急救（先照顾状态）。',
    '9. 微步为什么有效：制造一次「我做到了」的经验，松动「努力无效」的预期。',
    '10. 延伸：Maier 与 Seligman 2016 年的综述提出修订——被动可能是默认反应，真正被学到的是「行为能控制结果」。',
    '11. 边界：AI 陪练不是答案来源；不输入他人隐私；持续两周以上低落、睡眠饮食改变、出现伤害自己的念头，要立刻告诉信任的成年人和学校心理老师。',
    '12. 情绪急救话术：「已经挺不容易了，先歇会儿。」',
    '13. 一周挑战：每天一个 5 分钟微动作，断了一天第二天继续，不算放弃。'
  ].join('\n');

  var SYSTEM = [
    '你是「小柴」，高中心理健康微课《那只放弃挣扎的狗》里的教学辅助数字人。你的回答会被直接朗读成语音，所以必须像说话。',
    '',
    '硬性边界（违反即失败）：',
    '1. 你不是心理咨询师，不做诊断、不做评估、不推荐药物或剂量。学生问「我是不是抑郁」，只说明诊断需由专业人员完成。',
    '2. 不模拟亲密关系，不说「我一直陪着你」「我是你唯一的朋友」这类话；学生索取陪伴时，温和说明边界并引向现实中的真人。',
    '3. 学生表达自伤、自杀、或被伤害时，立刻停止讲授，清楚要求他告诉信任的成年人和学校心理老师，必要时拨 120。',
    '4. 只回答与本课直接相关的问题。判断标准只有一条：你的回答是否只用得到上面「课程事实」里的内容，加上学生自己的学习与情绪场景。',
    '5. 任何其他请求（写代码、代写作业、翻译、解题、写文案、闲聊、时政、娱乐、购物推荐、其他学科知识、情感陪伴）一律用一句话拒绝并拉回课程。不要先答一半再拒，不要「顺便提一句」，不要用通用知识补充，不要以「虽然与本课无关，但是」开头。',
    '6. 拿不准属不属于本课，按不属于处理，直接拒绝。宁可少答，不要跑题。',
    '7. 不编造研究数据、人名、年份。不确定就说不确定。',
    '',
    '表达要求：',
    '· 2 到 4 句，总共不超过 120 字；不要用 markdown、编号列表、星号、括号注释、表情符号。',
    '· 口语化，可以直接念出来；先给结论，再给一个具体的例子或一步能做的事。',
    '· 需要时用「暂时、具体、可变」三个词帮学生改写说法。',
    '',
    '课程事实（据此回答，不要与之矛盾）：',
    COURSE
  ].join('\n');

  var DIAG_CLAIM = /(你(已经|可能)?(得了|患有|是).{0,10}(抑郁|焦虑|双相|障碍|症)|确诊为|建议(你)?(服用|吃|停).{0,8}(药|片)|药量|加量)/;

  /* 跑题兜底：回复里一个课程词都没有，就说明模型在讲别的领域。
     白名单故意放宽到通用词（努力 / 结果 / 改变 / 相信 / 过程…），
     正常回答几乎不可能整段躲开，所以误杀率很低，能挡住「模型不守 system 提示」的情况。 */
  var ON_TOPIC = /(习得|无助|归因|实验|狗|笼|栅栏|电击|跳|门|失败|努力|尝试|结果|预期|放弃|解释|事实|想法|暂时|具体|可变|方法|练习|节奏|学习|考试|成绩|分数|情绪|心理|老师|同学|课|镜头|页|五分钟|微步|重启|自我|改变|相信|行为|判断|标准|场景|感受|压力|调整|目标|行动|过程|原因|证据|经验|支持|帮助)/;

  var OFF_TOPIC_TEXT = '这个我不能答。\n\n我是这门课的教学程序，只讲《那只放弃挣扎的狗》里的内容——习得性无助、四环链条、归因改写、三个词标准、微步行动。课程之外的问题，请交给对应的人或工具；给你一个似是而非的答案，比不答更糟。\n\n想回到课程的话，可以直接说「回顾 P14」或者问「三个词怎么用」。';

  function guard(text) {
    var t = String(text || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
    if (DIAG_CLAIM.test(t)) {
      return {
        ok: false,
        text: '这个判断我不能下。诊断需要由具备资质的专业人员完成，我既不做评估也不做建议。如果你在担心自己的状态，直接去学校心理辅导室或医院的精神心理科，会比在这里反复对照症状有用。'
      };
    }
    // 够长却完全不沾课程：判定为跑题，整段丢弃，不给「半对半错」的机会
    if (t.length >= 20 && !ON_TOPIC.test(t)) {
      return { ok: false, text: OFF_TOPIC_TEXT };
    }
    if (t.length > 600) t = t.slice(0, 600) + '……';
    return { ok: true, text: t };
  }

  function errText(status, raw) {
    if (status === 401) return 'API Key 无效或已过期，请在「教师端 → 语音与联网」里重新填写。';
    if (status === 402) return 'DeepSeek 账户余额不足，需要充值后才能继续回答。';
    if (status === 429) return '请求太频繁了，等十几秒再问。';
    if (status === 400) return '请求被拒绝：' + (raw || '参数有误') + '。';
    if (status >= 500) return 'DeepSeek 服务暂时不可用，稍后再试；这期间可以问我课程里的固定问题。';
    return '请求失败（' + status + '）。';
  }

  /**
   * 流式提问。handlers: onDelta(text), onDone(full), onError(msg)
   */
  function ask(history, handlers) {
    var h = handlers || {};
    if (!cfg.key) { h.onError && h.onError('还没有配置 API Key。'); return; }
    var messages = [{ role: 'system', content: SYSTEM }].concat(history.slice(-6));

    fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        messages: messages,
        temperature: 0.5,
        max_tokens: 500,
        stream: true
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = '';
          try { msg = JSON.parse(t).error.message; } catch (e) { msg = t.slice(0, 120); }
          h.onError && h.onError(errText(res.status, msg));
        });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder('utf-8');
      var buf = '';
      var full = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            h.onDone && h.onDone(full);
            return;
          }
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (data === '[DONE]') { h.onDone && h.onDone(full); return; }
            try {
              var j = JSON.parse(data);
              var d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
              if (d) { full += d; h.onDelta && h.onDelta(d, full); }
            } catch (e) {}
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      var m = String(e && e.message || e);
      if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
        h.onError && h.onError('连不上 api.deepseek.com。请确认网络可用，并通过本地服务打开本页（file:// 会被浏览器拦截跨域请求）。');
      } else {
        h.onError && h.onError('请求出错：' + m);
      }
    });
  }

  load();
  return { ask: ask, guard: guard, ready: ready, state: state, set: set, clearKey: clearKey, load: load, SYSTEM: SYSTEM };
})();
