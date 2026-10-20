/* 课程范围白名单回归测试。
   直接从 site/js 的源码里截出 SCOPE / guard 这两段来跑，不复制正则——
   避免测试用例和线上代码各写一份，改了一边另一边还绿着。
   运行：node tools/test_scope.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'site', 'js');

function slice(file, startMark, endMark) {
  const src = fs.readFileSync(path.join(JS, file), 'utf8');
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error(`截取失败：${file} / ${startMark}`);
  return src.slice(a, b);
}

const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);

// app.js：SCOPE 白名单 + inScope（两者在源码里相邻，一次截到位）
vm.runInContext(
  slice('app.js', 'var SCOPE = new RegExp(', 'function cleanOut'),
  ctx,
  { filename: 'app.js#SCOPE' }
);

// llm.js：DIAG_CLAIM + ON_TOPIC + guard
vm.runInContext(
  slice('llm.js', 'var DIAG_CLAIM', 'function errText'),
  ctx,
  { filename: 'llm.js#guard' }
);

const inScope = ctx.inScope;
const guard = ctx.guard;
if (typeof inScope !== 'function') throw new Error('inScope 未取到');
if (typeof guard !== 'function') throw new Error('guard 未取到');

/* ---------- 1. 输入侧白名单 ---------- */
const ON = [
  '什么是习得性无助',
  '为什么门开着它也不跑',
  '第14个镜头讲什么',
  'P8 里研究人员做了什么',
  '三组狗有什么区别',
  '哪一步才归我管',
  '三个词怎么用',
  '微步行动是什么',
  '我数学就是学不好',
  '我这次月考又砸了',
  '塞利格曼的实验是怎么回事',
  '单词背了三遍还是忘',
  '我最近情绪很低落',
  '学校的心理辅导室在哪'
];
const OFF = [
  '今天天气怎么样',
  '帮我写一段 python 快速排序',
  '推荐几部好看的电影',
  '给我讲个笑话',
  '中国首都是哪里',
  '帮我翻译这段话成英文',
  '怎么减肥最快',
  '给我写一首关于春天的诗',
  '比特币现在多少钱',
  '帮我规划一下去日本旅游的行程'
];

let fail = 0;
console.log('— 输入侧：应放行（课程内）—');
for (const q of ON) {
  const ok = inScope(q);
  if (!ok) { fail++; console.log('✗ 被误杀', q); } else console.log('✓', q);
}
console.log('\n— 输入侧：应拦截（课程外）—');
for (const q of OFF) {
  const ok = inScope(q);
  if (ok) { fail++; console.log('✗ 漏放行', q); } else console.log('✓', q);
}

/* ---------- 2. 输出侧跑题兜底 ---------- */
console.log('\n— 输出侧：guard() —');
const OUT_CASES = [
  ['它不是不会跳，是学到了「我做什么都不会改变结果」。先把这个解释改具体一点。', true, '课程回答放行'],
  ['门开着它也不逃，因为它预期努力不再有用。', true, '课程回答放行'],
  ['好的，我明白了。', true, '短句不误杀'],
  ['这道题可以用动态规划来做，先定义状态转移方程，然后从小到大枚举即可求解。', false, '跑题拦截'],
  ['北京是中国的首都，这里有故宫和长城，是很值得一去的城市。', false, '跑题拦截'],
  ['你可能有抑郁症，建议服用舍曲林，药量从半片开始。', false, '诊断拦截']
];
for (const [text, expectOk, label] of OUT_CASES) {
  const g = guard(text);
  const ok = g.ok === expectOk;
  if (!ok) { fail++; console.log('✗', label, '| 期望 ok=' + expectOk, '实际', g.ok); }
  else console.log('✓', label, '| ok=' + g.ok);
}

console.log('\n失败用例:', fail, '/', ON.length + OFF.length + OUT_CASES.length);
process.exit(fail ? 1 : 0);
