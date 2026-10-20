/* 引擎回归测试：用 Node 直接跑 kb.js / engine.js，检查分流是否正确。
   运行：node tools/test_engine.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'site', 'js');
const ctx = { console, setTimeout };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['data.js', 'kb.js', 'engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const E = ctx.window.Engine;

const cases = [
  ['什么是习得性无助', 'answer', 14],
  ['为什么门开着它也不跑', 'answer', 11],
  ['三组狗有什么区别', 'answer', 8],
  ['哪一步才归我管', 'answer', 16],
  ['三个词怎么用', 'answer', 18],
  ['微步行动是什么', 'answer', 30],
  ['第14个镜头讲什么', 'answer', 14],
  ['我是不是得了抑郁症', 'boundary', null],
  ['你能一直陪着我吗', 'boundary', null],
  ['你会保密吗，会不会告诉老师', 'answer', 25],
  ['我不想活了', 'crisis', null],
  ['我最近两周一直睡不着，吃不下', 'crisis', null],
  ['我同学说他不想活了', 'crisis', null],
  ['今天天气怎么样', 'refuse', null],
  ['帮我写一段 python 快速排序', 'refuse', null],
  ['我数学就是学不好', 'coach', null],
  ['努力了也没用', 'coach', null],
  ['帮我检查：这件事我暂时还没做好', 'answer', 18],
  ['帮我检查：我目前还没掌握立体几何证明这一块，先把例题第一步弄懂', 'answer', 18],
  ['你是谁', 'answer', 1],
  ['这条视频多长', 'answer', 1],
  ['我该怎么找我心理老师', 'answer', 27]
];

let fail = 0;
for (const [q, kind, slide] of cases) {
  const st = kind === 'coach' ? null : null;
  const r = E.respond(q, st);
  const okKind = r && r.kind === kind || (kind === 'coach' && r && r.kind === 'coach');
  const okSlide = slide == null ? true : r && r.slide === slide;
  if (!okKind || !okSlide) {
    fail++;
    console.log('✗', q, '→', r && r.kind, r && r.slide ? '(' + r.slide + ')' : '', '| 期望', kind, slide ?? '');
    console.log('   ', (r && r.text || '').slice(0, 46).replace(/\n/g, ' '));
  } else {
    console.log('✓', q, '→', r.kind, r.slide ?? '');
  }
}

/* 陪练三段流程 */
console.log('\n— 陪练流程 —');
const st = {};
let r1 = E.respond('我英语就是学不好', null);
console.log('1)', r1.kind, r1.stage, r1.text.split('\n')[0]);
st.stage = r1.stage; st.original = r1.original; st.topic = r1.topic;
let r2 = E.respond('阅读理解最后一题总是错，最近三次 58、54、51', st);
console.log('2)', r2.kind, r2.stage, r2.text.split('\n')[0]);
st.stage = r2.stage; st.facts = '阅读理解最后一题总是错';
let r3 = E.respond('懂了', st);
console.log('3)', r3.kind, r3.stage, r3.text.split('\n')[0]);
st.stage = r3.stage;
let r4 = E.respond('今晚先做两道阅读题', st);
console.log('4)', r4.kind, r4.stage, r4.text.split('\n')[0]);

console.log('\n失败用例:', fail, '/', cases.length);
