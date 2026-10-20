/* 页面逻辑：播放器 / 小狗 / 对话 / 记录 / 教师端。全程无网络请求。 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var KEY = 'shiba.course.v1';
  var TTL = 7 * 24 * 3600 * 1000;
  var TAIL = '如需进一步帮助，请联系学校心理教师或你信任的成年人。';

  /* 每人每次会话最多能提的问题数 */
  var QUOTA = 20;
  var WARN_AT = 5;   // 剩余 5 问时提醒

  var state = {
    messages: [], alerts: [], coach: null, turns: 0, crisis: false, savedAt: 0,
    card: { a: '', b: '', c: '' },
    voiceOn: true, voiceRate: 1.05, voiceName: '',
    ui: { cc: true, clean: true, zoom: 1, rate: 1 },
    teacher: { room: '', hotline: '', reviewer: '', date: '', coachOn: true, hardStop: true }
  };

  /* ---------- 存储 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d.savedAt || Date.now() - d.savedAt > TTL) { localStorage.removeItem(KEY); return; }
      Object.keys(d).forEach(function (k) { if (k in state) state[k] = d[k]; });
    } catch (e) { /* 存储损坏则丢弃，不影响使用 */ }
  }
  var saveTimer = null;
  function save() {
    state.savedAt = Date.now();
    var pack = {
      messages: state.messages.slice(-80), alerts: state.alerts.slice(-30), card: state.card,
      teacher: state.teacher, turns: state.turns, savedAt: state.savedAt,
      voiceOn: state.voiceOn, voiceRate: state.voiceRate, voiceName: state.voiceName,
      ui: state.ui
    };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(pack)); } catch (e) {}
    }, 120);
  }
  function wipe() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    state.messages = []; state.alerts = []; state.card = { a: '', b: '', c: '' };
    state.turns = 0; state.coach = null; state.crisis = false;
  }

  window.App = { teacher: function () { return state.teacher; } };

  /* ---------- 元素 ---------- */
  var video = $('#video'), player = $('#player'), vbox = $('#vbox'), rail = $('#rail');
  var ccBar = $('#ccBar'), ccText = $('#ccText');
  var railPlayed = $('#railPlayed'), railBuf = $('#railBuf'), railKnob = $('#railKnob');
  var btnPlay = $('#btnPlay'), timeLabel = $('#timeLabel'), chapterNow = $('#chapterNow'), centerPlay = $('#centerPlay');
  var messagesEl = $('#messages'), chipsEl = $('#chips'), input = $('#input'), composer = $('#composer');
  var dogEl = $('#dog'), dogState = $('#dogState'), dogHint = $('#dogHint');
  var mouthEl = $('#mouthBubble'), mbBody = $('#mbBody'), toastEl = $('#toast');
  var saybar = $('#composer');

  /* ================= 播放器 ================= */
  function fmt(t) {
    t = Math.max(0, Math.floor(t || 0));
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }

  function buildTicks() {
    // 进度条上的章节刻点（章节缩略图已移除，只保留刻点便于定位）
    window.CHAPTERS.forEach(function (c) {
      var d = document.createElement('i');
      d.className = 'tick';
      d.style.left = (c.start / window.TOTAL * 100) + '%';
      rail.appendChild(d);
    });
  }

  var curChap = 0;
  function tickUI() {
    var t = video.currentTime || 0, dur = window.TOTAL || video.duration || 600;
    var p = Math.min(1, t / dur);
    railPlayed.style.width = (p * 100) + '%';
    railKnob.style.left = (p * 100) + '%';
    timeLabel.textContent = fmt(t) + ' / ' + fmt(dur);
    rail.setAttribute('aria-valuenow', Math.round(t));
    if (video.buffered.length) {
      railBuf.style.width = (Math.min(1, video.buffered.end(video.buffered.length - 1) / dur) * 100) + '%';
    }
    // 章节
    var idx = 0;
    for (var i = 0; i < window.CHAPTERS.length; i++) {
      if (t + 0.02 >= window.CHAPTERS[i].start) idx = i;
    }
    if (idx !== curChap) {
      curChap = idx;
      chapterNow.textContent = '镜头 ' + window.CHAPTERS[idx].no + ' / 35';
    }
    // 中间播放按钮：播放中或已经离开片头就收起来（拖进度条后也要同步，否则会一直挂着）
    centerPlay.classList.toggle('hide', !video.paused || t > 0.3);
    setCue(t);
  }

  /* 字幕改到播放器外的 cc-bar：不压画面，也不会和成片里已经烧死的字幕叠成两层 */
  var cueIdx = -2;
  function setCue(t) {
    if (!ccBar || !ccText) return;
    var at = -1;
    for (var j = 0; j < window.CUES.length; j++) {
      if (t >= window.CUES[j].s - 0.05 && t <= window.CUES[j].e + 0.12) { at = j; break; }
    }
    if (at === cueIdx) return;
    cueIdx = at;
    var txt = at >= 0 ? window.CUES[at].t : '';
    if (!txt) txt = t < 0.6 ? '字幕会显示在这一行' : '（本页无旁白）';
    ccText.textContent = txt;
    ccBar.classList.toggle('idle', at < 0);
  }

  var rafId = null;
  function loop() { tickUI(); rafId = requestAnimationFrame(loop); }
  function startLoop() { if (!rafId) rafId = requestAnimationFrame(loop); }
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

  /* ---------- 画面：净版 / 原版、缩放、拖动 ---------- */
  var ccOn = true;
  var ZMIN = 1, ZMAX = 2.5, ZSTEP = 0.15;
  var vzoom = 1, panx = 0, pany = 0;

  function syncCCBar() {
    if (!ccBar) return;
    var clean = !player.classList.contains('full-frame');
    // 原版里成片自带字幕，页面这条就收起来，免得两层字幕
    ccBar.classList.toggle('off', !ccOn || !clean);
    if (ccOn && clean) { cueIdx = -2; setCue(video.currentTime || 0); }
  }

  function clampPan() {
    var r = player.getBoundingClientRect();
    var mx = Math.max(0, (vzoom - 1) * r.width / 2);
    var my = Math.max(0, (vzoom - 1) * r.height / 2);
    panx = Math.min(mx, Math.max(-mx, panx));
    pany = Math.min(my, Math.max(-my, pany));
  }

  function applyZoom(persist) {
    if (vzoom <= 1.001) { panx = 0; pany = 0; }
    clampPan();
    player.style.setProperty('--vzoom', vzoom.toFixed(3));
    player.style.setProperty('--panx', panx.toFixed(1) + 'px');
    player.style.setProperty('--pany', pany.toFixed(1) + 'px');
    player.classList.toggle('zoomed', vzoom > 1.001);
    var zl = $('#zoomVal');
    if (zl) zl.textContent = Math.round(vzoom * 100) + '%';
    if (persist !== false) { state.ui.zoom = vzoom; save(); }
  }

  function setZoom(z) {
    vzoom = Math.min(ZMAX, Math.max(ZMIN, Math.round(z * 100) / 100));
    applyZoom();
  }

  function setFit(clean) {
    player.classList.toggle('full-frame', !clean);
    var b = $('#btnFit');
    b.classList.toggle('on', clean);
    b.textContent = clean ? '净版' : '原版';
    b.setAttribute('aria-pressed', clean ? 'true' : 'false');
    state.ui.clean = clean;
    syncCCBar();
    save();
  }

  function setPlayingUI(playing) {
    btnPlay.classList.toggle('playing', !!playing);
    centerPlay.classList.toggle('hide', playing || video.currentTime > 0.3);
    dogState.textContent = playing ? '陪你看着' : '待机中';
  }

  /* 点画面 = 播放/暂停；放大后拖动 = 平移；Ctrl+滚轮 = 缩放 */
  function initPanZoom() {
    if (!vbox) return;
    var down = null;
    vbox.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, px: panx, py: pany, moved: 0, t: Date.now() };
      if (vzoom > 1.001) {
        player.classList.add('panning');
        try { vbox.setPointerCapture(e.pointerId); } catch (err) {}
      }
    });
    vbox.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      down.moved = Math.max(down.moved, Math.abs(dx) + Math.abs(dy));
      if (vzoom > 1.001 && down.moved > 3) {
        panx = down.px + dx; pany = down.py + dy;
        clampPan();
        player.style.setProperty('--panx', panx.toFixed(1) + 'px');
        player.style.setProperty('--pany', pany.toFixed(1) + 'px');
      }
    });
    function finish() {
      if (!down) return;
      var click = down.moved < 5 && Date.now() - down.t < 700;
      down = null;
      player.classList.remove('panning');
      if (click) togglePlay();
    }
    vbox.addEventListener('pointerup', finish);
    vbox.addEventListener('pointercancel', function () {
      down = null; player.classList.remove('panning');
    });
    vbox.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(vzoom - e.deltaY * 0.0016);
    }, { passive: false });
  }

  function initVideo() {
    video.addEventListener('loadedmetadata', function () { tickUI(); });
    video.addEventListener('play', function () { setPlayingUI(true); startLoop(); });
    video.addEventListener('pause', function () { setPlayingUI(false); tickUI(); });
    video.addEventListener('ended', function () { setPlayingUI(false); showBubble('看完了。要不要试试下面的重启卡？', 3600); });
    video.addEventListener('timeupdate', function () { if (video.paused) tickUI(); });
    ['waiting', 'stalled'].forEach(function (ev) {
      video.addEventListener(ev, function () { player.classList.add('buffering'); });
    });
    ['playing', 'canplay', 'seeked', 'pause', 'error'].forEach(function (ev) {
      video.addEventListener(ev, function () { player.classList.remove('buffering'); });
    });
    video.addEventListener('error', function () {
      player.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;' +
        'font-size:13px;line-height:1.9;text-align:center;padding:24px">' +
        '视频没有加载出来。<br><span style="color:#C8B8A8">请确认 media/那只放弃挣扎的狗_伴学版.mp4 与 index.html 在同一目录下。</span></div>';
    });

    btnPlay.addEventListener('click', togglePlay);
    $('#centerPlay').addEventListener('click', togglePlay);
    $('#centerPlay').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePlay(); } });
    $('#btnFS').addEventListener('click', toggleFullscreen);
    video.addEventListener('dblclick', toggleFullscreen);
    initPanZoom();

    $('#btnZoomIn').addEventListener('click', function () { setZoom(vzoom + ZSTEP); });
    $('#btnZoomOut').addEventListener('click', function () { setZoom(vzoom - ZSTEP); });
    $('#zoomVal').addEventListener('click', function () { setZoom(1); });
    $('#btnFit').addEventListener('click', function () {
      setFit(player.classList.contains('full-frame'));
    });
    $('#btnCC').addEventListener('click', function () {
      ccOn = !ccOn;
      state.ui.cc = ccOn;
      $('#btnCC').classList.toggle('on', ccOn);
      $('#btnCC').setAttribute('aria-pressed', String(ccOn));
      cueIdx = -2;
      syncCCBar();
      save();
    });
    $('#speed').addEventListener('change', function () {
      video.playbackRate = parseFloat(this.value) || 1;
      state.ui.rate = video.playbackRate;
      save();
    });

    /* 进度条：点击与拖拽 */
    var dragging = false;
    function seekByEvent(e) {
      var r = rail.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      video.currentTime = p * (window.TOTAL || 600);
      tickUI();
    }
    rail.addEventListener('pointerdown', function (e) { dragging = true; rail.setPointerCapture(e.pointerId); seekByEvent(e); });
    rail.addEventListener('pointermove', function (e) { if (dragging) seekByEvent(e); });
    rail.addEventListener('pointerup', function () { dragging = false; });
    rail.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { video.currentTime += 5; tickUI(); }
      if (e.key === 'ArrowLeft') { video.currentTime -= 5; tickUI(); }
    });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowRight') { video.currentTime += 10; tickUI(); }
      if (e.key === 'ArrowLeft') { video.currentTime -= 10; tickUI(); }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(vzoom + ZSTEP); }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(vzoom - ZSTEP); }
      if (e.key === '0') { e.preventDefault(); setZoom(1); }
    });
  }

  /* 全屏：优先原生；被 iframe 权限挡住时退化为「占满窗口」的伪全屏，保证一定能放大 */
  function isFullscreenUI() {
    return document.fullscreenElement === player || player.classList.contains('fs-fake');
  }
  function fakeFullscreen(on) {
    player.classList.toggle('fs-fake', on);
    document.body.classList.toggle('fs-open', on);
    $('#btnFS').setAttribute('aria-label', on ? '退出全屏' : '全屏');
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
    if (player.classList.contains('fs-fake')) { fakeFullscreen(false); return; }

    var req = player.requestFullscreen || player.webkitRequestFullscreen;
    if (!req || document.fullscreenEnabled === false) { fakeFullscreen(true); return; }

    // 有些环境（被 iframe 权限挡住、无头浏览器）requestFullscreen 既不成功也不报错，
    // 所以加一道超时兜底：500ms 内没真正进入全屏，就直接用伪全屏。
    var guard = setTimeout(function () {
      if (document.fullscreenElement !== player && !player.classList.contains('fs-fake')) fakeFullscreen(true);
    }, 500);
    try {
      var r = req.call(player);
      if (r && r.then) {
        r.then(function () { clearTimeout(guard); })
         .catch(function () { clearTimeout(guard); fakeFullscreen(true); });
      }
    } catch (e) {
      clearTimeout(guard);
      fakeFullscreen(true);
    }
  }
  document.addEventListener('fullscreenchange', function () {
    if (document.fullscreenElement) fakeFullscreen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && player.classList.contains('fs-fake')) fakeFullscreen(false);
  });

  function togglePlay() {
    if (video.paused) video.play().catch(function () {});
    else video.pause();
  }

  function seekTo(t) {
    video.currentTime = Math.max(0, Math.min(window.TOTAL - 0.1, t));
    video.play().catch(function () {});
    tickUI();
  }

  /* ================= 小狗 ================= */
  var dogTimers = [];
  function later(fn, ms) { var id = setTimeout(fn, ms); dogTimers.push(id); return id; }

  function initDog() {
    // 眨眼
    (function blinkLoop() {
      later(function () {
        dogEl.classList.add('blink');
        setTimeout(function () { dogEl.classList.remove('blink'); }, 115);
        blinkLoop();
      }, 2300 + Math.random() * 3900);
    })();
    // 抖耳朵
    (function earLoop() {
      later(function () {
        var c = Math.random() > 0.5 ? 'twitchL' : 'twitchR';
        dogEl.classList.add(c);
        setTimeout(function () { dogEl.classList.remove(c); }, 340);
        earLoop();
      }, 5200 + Math.random() * 7600);
    })();
    // 歪头
    (function tiltLoop() {
      later(function () {
        if (!dogEl.classList.contains('speaking')) {
          dogEl.classList.add('tilt');
          setTimeout(function () { dogEl.classList.remove('tilt'); }, 1700);
        }
        tiltLoop();
      }, 9000 + Math.random() * 9000);
    })();

    // 眼珠跟随指针
    document.addEventListener('pointermove', function (e) {
      var b = dogEl.getBoundingClientRect();
      var cx = b.left + b.width / 2, cy = b.top + b.height * 0.4;
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var d = Math.hypot(dx, dy) || 1;
      var k = Math.min(1, d / 260);
      var ox = (dx / d) * 2.6 * k, oy = (dy / d) * 2.2 * k;
      $$('.pupil', dogEl).forEach(function (p) { p.style.transform = 'translate(' + ox + 'px,' + oy + 'px)'; });
      dogEl.classList.toggle('curious', d < 300 && !dogEl.classList.contains('speaking'));
    }, { passive: true });

    var lines = [
      '我在。有问题直接问，别客气。',
      '那句「我不行」，是可以改的。',
      '点我不会跳过作业，但能帮你把话说对。',
      '要不要先看第 14 个镜头？「习得」两个字在那儿。',
      '尾巴摇了不代表我懂，但我确实懂这节课。'
    ];
    var li = 0, introSpoken = false;
    dogEl.addEventListener('click', function () {
      // 正在朗读：点一下先停下
      if (window.Voice && Voice.isSpeaking()) {
        Voice.stop();
        showBubble('好，我停一下。', 1600);
        return;
      }
      dogEl.classList.remove('hop');
      void dogEl.offsetWidth;
      dogEl.classList.add('hop', 'happy');
      setTimeout(function () { dogEl.classList.remove('happy'); }, 1400);

      if (locked) { toast('本次问题已经问完，剩下的交给真人。', 3200); return; }

      var firstOpen = saybar.hidden;
      openSay();
      if (firstOpen && !introSpoken) {
        introSpoken = true;
        if (window.Voice && state.voiceOn) Voice.say('我在。问我课程里的问题，我会念给你听。');
        showBubble(lines[li++ % lines.length], 2400);
      }
    });
    dogEl.setAttribute('tabindex', '0');
    dogEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dogEl.click(); } });
  }

  var toastTimer = null;
  function toast(text, ms) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 3000);
  }
  function showBubble(text, ms) { toast(text, ms || 3000); }

  /* 回答挂在小柴嘴边：每问一轮先清空，只保留本轮 */
  function scrollMouth() { if (mbBody) mbBody.scrollTop = mbBody.scrollHeight; }
  function mountMouth(el) {
    mbBody.appendChild(el);
    mouthEl.classList.add('show');
    scrollMouth();
  }
  function showAsk(text) {
    mbBody.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'ask-echo';
    d.textContent = text;
    mbBody.appendChild(d);
    mouthEl.classList.add('show');
    scrollMouth();
  }
  function openSay() {
    if (locked) { toast('本次问题已经问完，剩下的交给真人。', 3200); return; }
    mouthEl.classList.add('show');   // 卡片先立起来，再露出输入条
    saybar.hidden = false;
    dogHint.classList.add('off');
    input.focus({ preventScroll: true });
  }

  function setSpeaking(on) {
    dogEl.classList.toggle('speaking', !!on);
    dogState.textContent = on ? '说着呢' : '待机中';
  }

  function dogMood(kind) {
    if (kind === 'sad') {
      dogEl.classList.add('sad');
      setTimeout(function () { dogEl.classList.remove('sad'); }, 6000);
    }
  }

  /* ================= 对话 ================= */
  function addMsg(role, text, opt) {
    opt = opt || {};
    var el = document.createElement('div');
    el.className = 'msg ' + role + (opt.cls ? ' ' + opt.cls : '');
    el.textContent = text;

    if (opt.slide) {
      var ch = window.CHAPTERS.filter(function (c) { return c.no === opt.slide; })[0];
      if (ch) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cite';
        btn.textContent = '看镜头 ' + ch.no + ' · ' + fmt(ch.start);
        btn.addEventListener('click', function () { seekTo(ch.start); });
        el.appendChild(btn);
      }
    }
    if (opt.tail) {
      var t = document.createElement('span');
      t.className = 'tail';
      t.textContent = opt.tail;
      el.appendChild(t);
    }
    messagesEl.appendChild(el);            // 隐藏日志：记录与导出仍用它
    if (opt.quiet) return el;              // 回放历史时不打扰当前气泡
    if (role === 'me') showAsk(text);      // 提问只留一行回声
    else if (role === 'notice') toast(text, 5200);
    else mountMouth(el);                   // 回答 / 危机提示：挂到嘴边
    return el;
  }

  function typewrite(el, text, done) {
    // 用定时器而不是 rAF：后台标签页里 rAF 会被节流甚至停住，消息会一直是空的
    if (document.hidden) {
      el.textContent = text;
      scrollMouth();
      done && done();
      return;
    }
    var dur = Math.min(1800, Math.max(520, text.length * 18));
    var t0 = Date.now();
    setSpeaking(true);
    var timer = setInterval(function () {
      var p = Math.min(1, (Date.now() - t0) / dur);
      el.textContent = text.slice(0, Math.floor(text.length * p));
      scrollMouth();
      if (p >= 1) {
        clearInterval(timer);
        el.textContent = text;
        setSpeaking(false);
        done && done();
      }
    }, 33);
  }

  function renderChips(list) {
    chipsEl.innerHTML = '';
    (list || []).forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = q;
      b.addEventListener('click', function () { send(q); });
      chipsEl.appendChild(b);
    });
  }

  function afterBot(r) {
    if (r.slide) { /* 引用按钮已在 addMsg 内处理 */ }
    renderChips(r.chips);
    if (r.kind === 'crisis') {
      dogMood('sad');
      state.crisis = true;
      state.alerts.push({ t: Date.now(), type: r.alert || '自伤自杀风险', handled: false });
      save(); renderAlerts();
      addMsg('notice', '已为老师留下一条预警（不含你的原话）。你随时可以继续问课程内容。');
      input.placeholder = '想说什么都可以，也可以先歇一会儿';
    }
  }

  var locked = false, busy = false;

  /* 明确离题的请求不外发，省一次调用，也避免把无关内容带进课堂 */
  var HARD_OFF = /(写代码|代码是|编程|python|java|javascript|c\+\+|sql|写作业|帮我写|翻译|作文|小说|股票|彩票|天气|明星|政治)/i;

  function cleanOut(t) {
    return String(t || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function llmHistory() {
    return state.messages
      .filter(function (m) { return (m.r === 'me' || m.r === 'bot') && m.kind !== 'crisis' && m.kind !== 'error'; })
      .slice(-6)
      .map(function (m) { return { role: m.r === 'me' ? 'user' : 'assistant', content: String(m.t).slice(0, 300) }; });
  }

  function speak(text) {
    if (!window.Voice || !Voice.supported || !state.voiceOn) return;
    Voice.say(cleanOut(text));
  }

  function renderQuota() {
    var q = $('#quota');
    if (!q) return;
    if (!state.teacher.hardStop) {
      q.textContent = '不限次数';
      q.classList.remove('warn', 'out');
      return;
    }
    var left = Math.max(0, QUOTA - state.turns);
    q.textContent = left > 0 ? '剩余 ' + left + ' 问' : '已用完';
    q.classList.toggle('warn', left > 0 && left <= WARN_AT);
    q.classList.toggle('out', left === 0);
  }

  function lockInput() {
    locked = true;
    input.disabled = true;
    $('.send', composer).disabled = true;
    input.placeholder = '本次 20 个问题已用完';
    saybar.hidden = true;
    renderChips([]);
    dogHint.classList.remove('off');
    if (window.Voice) Voice.stop();
  }

  function unlockInput() {
    locked = false;
    input.disabled = false;
    $('.send', composer).disabled = false;
    input.placeholder = '问点这节课的事，或说一句你想改的话…';
    saybar.hidden = false;
  }

  function checkTurnPolicy() {
    renderQuota();
    if (!state.teacher.hardStop) return;   // 教师关闭了硬性结束：不计数、不打断
    if (!locked && state.turns >= QUOTA) {
      lockInput();
      addMsg('notice', '本次的 ' + QUOTA + ' 个问题已经用完。按设计，我在这里停下——再多聊，对你没有帮助。');
      addMsg('bot', '接下来的问题交给真人：' +
        (state.teacher.room ? '学校心理辅导室——' + state.teacher.room + '；' : '') +
        '心理援助热线 ' + (state.teacher.hotline || '12356') + '。\n\n今天的三格重启卡还在页面下方，随时可以填完。',
        { tail: '' });
    } else if (!locked && state.turns === QUOTA - WARN_AT) {
      addMsg('notice', '这是第 ' + state.turns + ' 个问题，还剩 ' + WARN_AT + ' 次。建议把最想问的留到后面——剩下的部分，真人能接得比我好。');
    }
  }

  function finishLocal(r) {
    var el = addMsg(r.kind === 'crisis' ? 'crisis' : 'bot', '', {
      tail: (r.kind === 'answer' || r.kind === 'coach') ? TAIL : ''
    });

    typewrite(el, r.text, function () {
      // 引用按钮与尾注要在打字结束后补，避免被 textContent 覆盖
      if (r.slide) {
        var ch = window.CHAPTERS.filter(function (c) { return c.no === r.slide; })[0];
        if (ch) {
          var btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'cite';
          btn.textContent = '看镜头 ' + ch.no + ' · ' + fmt(ch.start);
          btn.addEventListener('click', function () { seekTo(ch.start); });
          el.appendChild(btn);
        }
      }
      if (r.kind === 'answer' || r.kind === 'coach') {
        var t2 = document.createElement('span');
        t2.className = 'tail'; t2.textContent = TAIL; el.appendChild(t2);
      }
      scrollMouth();
      speak(r.text);
    });

    if (r.kind === 'coach') {
      if (r.stage === 'idle') state.coach = null;
      else state.coach = {
        stage: r.stage,
        original: r.original || (state.coach && state.coach.original) || '',
        topic: r.topic || '这件事',
        facts: (state.coach && state.coach.facts) || ''
      };
    }

    state.messages.push({ r: 'bot', t: r.text, at: Date.now(), kind: r.kind });
    afterBot(r);
    save();
    checkTurnPolicy();
  }

  /* 超出课程范围的问题：交给 DeepSeek，边收边读 */
  function askRemote(text) {
    busy = true;
    var el = addMsg('bot', '让我想一下……', { cls: 'remote' });
    var full = '', spokenUpto = 0, done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true; busy = false;
      el.textContent = '等太久了，先停在这里。可以换个问法，或者问我课程里的固定问题。';
    }, 45000);

    function flushSpeech() {
      var rest = full.slice(spokenUpto);
      var m = rest.match(/^[\s\S]*?[。！？!?；;\n]/);
      if (m && m[0].trim() && window.Voice) {
        Voice.push(cleanOut(m[0]));
        spokenUpto += m[0].length;
      }
    }

    window.LLM.ask(llmHistory(), {
      onDelta: function (d, acc) {
        if (done) return;
        full = acc;
        el.textContent = full;
        scrollMouth();
        flushSpeech();
      },
      onDone: function (t) {
        if (done) return;
        done = true; clearTimeout(timer);
        var g = window.LLM.guard(t || full);
        var out = g.ok ? cleanOut(g.text) : g.text;
        el.textContent = out;

        var tag = document.createElement('span');
        tag.className = 'src remote';
        tag.textContent = g.ok ? 'DeepSeek · 未经本课审定' : '已拦截 · 未采用联网内容';
        el.appendChild(tag);
        var tl = document.createElement('span');
        tl.className = 'tail'; tl.textContent = TAIL; el.appendChild(tl);
        scrollMouth();

        if (g.ok && window.Voice) {
          var rest = cleanOut(full.slice(spokenUpto));
          if (rest) Voice.push(rest);
        }
        state.messages.push({ r: 'bot', t: out, at: Date.now(), kind: 'remote' });
        save(); busy = false; checkTurnPolicy();
      },
      onError: function (msg) {
        if (done) return;
        done = true; clearTimeout(timer);
        el.textContent = msg;
        var tl = document.createElement('span');
        tl.className = 'tail';
        tl.textContent = '这期间仍然可以问我课程里的问题。';
        el.appendChild(tl);
        state.messages.push({ r: 'bot', t: msg, at: Date.now(), kind: 'error' });
        save(); busy = false;
      }
    });
  }

  function send(raw) {
    var text = String(raw || '').trim();
    if (!text || locked) return;
    if (state.teacher.hardStop && state.turns >= QUOTA) { checkTurnPolicy(); return; }
    if (busy) { addMsg('notice', '上一个问题还在回答，稍等一下。'); return; }
    if (text.length > 120) text = text.slice(0, 120);

    addMsg('me', text);
    state.messages.push({ r: 'me', t: text, at: Date.now() });
    state.turns++;
    renderQuota();
    input.value = '';
    renderChips([]);
    save();
    if (window.Voice) Voice.stop();

    dogEl.classList.add('thinking');
    dogState.textContent = '想一想';

    setTimeout(function () {
      dogEl.classList.remove('thinking');
      if (!state.teacher.coachOn && state.coach) state.coach = null;
      var r = window.Engine.respond(text, state.coach);

      if (r && r.enterCoach && !state.teacher.coachOn) {
        var kb = window.Engine.findKb(text);
        r = kb ? { kind: 'answer', text: kb.item.a, slide: kb.item.slide }
               : { kind: 'answer', text: '这句先留着。这门课讲的是：反复失败之后，人怎么把「我不行」当成结论。要不要先看第 14 个镜头？', slide: 14 };
      }
      if (!r) r = { kind: 'answer', text: '我没听清，再说一次？' };

      // 范围外 → 只有教师开了联网、且不是明显离题时才外发
      if (r.kind === 'refuse') {
        var online = window.LLM && LLM.ready();
        if (online && !HARD_OFF.test(text)) { askRemote(text); return; }
        finishLocal(r);
        if (!online) {
          addMsg('notice', '联网回答未开启：教师端 →「语音与联网」填入 API Key 后，超出课程范围的问题会转给 DeepSeek。');
        }
        return;
      }

      finishLocal(r);
    }, 320);
  }

  /* ================= 重启卡 ================= */
  var T = {
    temp: /(暂时|这次|目前|还没|现在还没|现阶段|眼下|到目前为止|还没能|一时)/,
    spec: /(这一?块|这一?章|这一?节|这类|这种题|题型|单词|作文|听力|证明|辅助线|第.{0,3}(题|步|单元)|环节|步骤|语法|函数|概率)/,
    vary: /(方法|练习|练|节奏|计划|时间安排|换个|换一种|弄懂|步骤|问老师|拆|先做|每天|重复|多花)/
  };
  function updateBadges() {
    var v = $('#cardB').value;
    $$('#cardBadges .badge').forEach(function (b) {
      var k = b.dataset.k;
      var ok = k === 'temp' ? T.temp.test(v) : k === 'spec' ? T.spec.test(v) : T.vary.test(v);
      b.classList.toggle('on', !!v.trim() && ok);
    });
  }
  function initCard() {
    ['a', 'b', 'c'].forEach(function (k) {
      var el = $('#card' + k.toUpperCase());
      el.value = state.card[k] || '';
      el.addEventListener('input', function () {
        state.card[k] = el.value;
        if (k === 'b') updateBadges();
        save();
      });
    });
    updateBadges();
    $('#btnCardSave').addEventListener('click', function () {
      save();
      $('#cardSaved').textContent = '已存本机 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    });
  }

  /* ================= 知识地图 ================= */
  function initConcepts() {
    var box = $('#concepts');
    box.innerHTML = window.CONCEPTS.map(function (c) {
      return '<button class="concept" type="button" data-q="' + c.k + '"><b>' + c.n + '</b><span>' + c.d + '</span></button>';
    }).join('');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.concept'); if (!b) return;
      send(b.dataset.q);
      if (window.innerWidth < 900) $('#dogStage').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  /* ================= 伦理弹窗 ================= */
  var ETHICS = [
    ['政治方向', '不涉及意识形态与价值判断，只讲心理学机制与可操作的方法；示例全部取自校内学习场景，不夹带任何立场。'],
    ['非咨询师身份', '首句即声明「教学辅助程序，不是心理咨询师」；顶栏常驻「教学辅助 · 非咨询师」标识；每条回答尾部附求助提示。'],
    ['不诊断、不治疗', '遇到「我是不是抑郁」这类问题，直接说明诊断只能由专业人员做，不评估、不给药名剂量，引导至校医或精神心理科。'],
    ['人在环路', '所有回答是预置文本，由心理教师审定后发布；教师端可改辅导室与热线、查看风险预警、导出会话复核；教师可关闭陪练流程。'],
    ['防范情感依赖', '拒绝「唯一的朋友」「一直陪我」这类请求，不模拟亲密关系；每人每次最多 20 个问题，第 15 问提醒，用完即停；不设拟人化亲昵语气。'],
    ['危机转介', '识别自伤自杀表述、持续两周以上的低落与睡眠饮食改变、以及他人风险三类信号；输出辅导室与热线，并给教师留预警（只记时间与类型）。'],
    ['隐私保护', '对话只存本机浏览器，7 天自动删除，不采集姓名学号。课程内问题不外发；只有超出范围的问题、且在教师开启联网后，才会发往 DeepSeek 官方接口；危机与诊断类内容在本地拦截，永不上传。'],
    ['内容审核', '课程内回答为固定文本、逐条可审；联网回答在气泡上标注「未经本课审定」，并对诊断、用药类表述做二次拦截。教师可关闭联网，只保留审定内容。'],
    ['未成年人保护', '明确定位为教学工具而非陪伴产品；提示教师或监护人知情；强制结束机制避免长时间沉浸。']
  ];
  function initEthics() {
    $('#ethicsList').innerHTML = ETHICS.map(function (e) {
      return '<div class="eth"><h3>' + e[0] + '</h3><p>' + e[1] + '</p></div>';
    }).join('');
  }

  /* ================= 教师端 ================= */
  function renderAlerts() {
    var box = $('#alertList');
    $('#alertCount').textContent = state.alerts.filter(function (a) { return !a.handled; }).length;
    if (!state.alerts.length) {
      box.innerHTML = '<div class="alert-empty">暂无预警记录</div>';
      return;
    }
    box.innerHTML = state.alerts.slice().reverse().map(function (a) {
      var d = new Date(a.t);
      var time = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
        ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      return '<div class="alert-item"><b>' + a.type + '</b><span class="t">' + time + (a.handled ? ' · 已处理' : '') + '</span>' +
        '<div style="margin-top:5px;color:#8A5A52;font-size:11.5px">未记录触发原话。请尽快当面核实，必要时按学校危机干预流程上报。</div></div>';
    }).join('');
  }

  function fillTeacherForm() {
    $('#setRoom').value = state.teacher.room || '';
    $('#setHotline').value = state.teacher.hotline || '';
    $('#setReviewer').value = state.teacher.reviewer || '';
    $('#setDate').value = state.teacher.date || '';
    $('#setCoach').checked = !!state.teacher.coachOn;
    $('#setHardStop').checked = !!state.teacher.hardStop;
  }

  function initTeacher() {
    fillTeacherForm();
    $('#btnSetSave').addEventListener('click', function () {
      state.teacher = {
        room: $('#setRoom').value.trim(),
        hotline: $('#setHotline').value.trim(),
        reviewer: $('#setReviewer').value.trim(),
        date: $('#setDate').value,
        coachOn: $('#setCoach').checked,
        hardStop: $('#setHardStop').checked
      };
      save(); syncResources();
      if (!state.teacher.hardStop) unlockInput();
      else if (state.turns >= QUOTA) checkTurnPolicy();
      renderQuota();
      $('#setSaved').textContent = '已保存，学生端立即生效';
      setTimeout(function () { $('#setSaved').textContent = ''; }, 2600);
    });
    $$('#teacherTabs .tab').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('#teacherTabs .tab').forEach(function (x) { x.classList.remove('active'); });
        $$('.tab-panel').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        $('#' + t.dataset.tab).classList.add('active');
      });
    });
    $('#btnExport').addEventListener('click', exportMd);
    $('#btnResetQuota').addEventListener('click', function () {
      if (!confirm('重置后，学生会再获得 20 个问题。仅在其确需继续时使用。')) return;
      state.turns = 0; state.coach = null;
      unlockInput(); renderQuota(); save();
      $('#setSaved').textContent = '已重置：学生可再提 ' + QUOTA + ' 个问题';
      setTimeout(function () { $('#setSaved').textContent = ''; }, 3200);
    });
    $('#btnWipe').addEventListener('click', function () {
      if (!confirm('将清除本机保存的对话、重启卡与预警记录，无法恢复。继续？')) return;
      wipe(); closeAll(); unlockInput(); renderQuota();
      addMsg('notice', '本机数据已清除，提问次数已重置。'); renderAlerts();
    });
    renderAlerts();
  }

  function exportMd() {
    var lines = ['# 伴学对话记录', '', '导出时间：' + new Date().toLocaleString('zh-CN'), ''];
    lines.push('> 本记录含学生对话，请按学校心理档案管理规定保存，不得转发或另作他用。', '');
    lines.push('## 重启卡', '');
    lines.push('- 事实：' + (state.card.a || '（未填）'));
    lines.push('- 改写：' + (state.card.b || '（未填）'));
    lines.push('- 微步：' + (state.card.c || '（未填）'), '');
    if (state.alerts.length) {
      lines.push('## 风险预警', '');
      state.alerts.forEach(function (a) { lines.push('- ' + new Date(a.t).toLocaleString('zh-CN') + ' · ' + a.type); });
      lines.push('');
    }
    lines.push('## 对话', '');
    state.messages.forEach(function (m) {
      lines.push('**' + (m.r === 'me' ? '学生' : '小柴') + '**：' + String(m.t).replace(/\n/g, '  \n'));
      lines.push('');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '伴学记录_' + new Date().toISOString().slice(0, 10) + '.md';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  /* ================= 记录弹窗 ================= */
  function renderRecord() {
    var box = $('#recordBody');
    var has = state.card.a || state.card.b || state.card.c;
    if (!has) {
      box.innerHTML = '<div class="rec-empty">还没有填写重启卡。三格填完，这节课才算带走点东西。</div>';
    } else {
      box.innerHTML =
        '<div class="rec-block"><h3>① 这次具体发生了什么</h3><p>' + (state.card.a || '（空）') + '</p></div>' +
        '<div class="rec-block"><h3>② 换一种说法怎么说</h3><p>' + (state.card.b || '（空）') + '</p></div>' +
        '<div class="rec-block"><h3>③ 今天五分钟能做的一步</h3><p>' + (state.card.c || '（空）') + '</p></div>';
    }
    $('#recordInfo').textContent = '对话 ' + state.messages.length + ' 条 · 保存于 ' + new Date(state.savedAt || Date.now()).toLocaleString('zh-CN');
  }

  /* ================= 资源信息 ================= */
  function syncResources() {
    var r = window.Engine.resources();
    $('#resRoom').textContent = r.room;
    $('#resHotline').textContent = r.hotline;
  }

  /* ================= 弹窗控制 ================= */
  function openDlg(id) {
    var d = $('#' + id);
    if (!d) return;
    if (id === 'dlgRecord') renderRecord();
    if (id === 'dlgTeacher') {
      fillTeacherForm(); renderAlerts();
      $('#statMsg').textContent = state.messages.length + ' 条';
      $('#statCoach').textContent = state.turns + ' / ' + QUOTA + ' 问';
    }
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }
  function closeAll() { $$('dialog[open]').forEach(function (d) { d.close(); }); }

  /* ================= 语音与联网 ================= */
  function updateAIState() {
    var online = window.LLM && LLM.ready();
    $('#aiState').textContent = (online ? '课程知识库 + DeepSeek 联网' : '课程知识库（未联网）') +
      (state.voiceOn ? ' · 语音已开' : ' · 语音已关');
    $('#dotLive').classList.toggle('off', !online);
    $('#dotLive').title = online ? '课程内问题走知识库；范围外问题发往 DeepSeek 官方接口' : '当前只用本地知识库，无网络请求';
  }

  function initVoice() {
    var btn = $('#btnVoice');
    if (!window.Voice || !Voice.supported) {
      btn.disabled = true;
      btn.title = '当前浏览器不支持语音合成';
      state.voiceOn = false;
      return;
    }
    Voice.setEnabled(state.voiceOn);
    Voice.setRate(state.voiceRate || 1.05);
    Voice.setVoice(state.voiceName || '');
    syncVoiceBtn();

    btn.addEventListener('click', function () {
      state.voiceOn = !state.voiceOn;
      Voice.setEnabled(state.voiceOn);
      syncVoiceBtn();
      updateAIState();
      save();
      if (state.voiceOn) showBubble('语音开了，我会念出来。', 2200);
    });
    $('#btnStopVoice').addEventListener('click', function () { Voice.stop(); });

    Voice.onState(function (speaking) {
      setSpeaking(speaking);
      $('#btnStopVoice').hidden = !speaking;
    });
  }

  function syncVoiceBtn() {
    var btn = $('#btnVoice');
    btn.classList.toggle('on', state.voiceOn);
    $('.ic-sound', btn).hidden = !state.voiceOn;
    $('.ic-mute', btn).hidden = state.voiceOn;
    btn.setAttribute('aria-pressed', state.voiceOn ? 'true' : 'false');
  }

  function fillVoices() {
    var sel = $('#setVoice');
    if (!window.Voice || !Voice.supported) {
      sel.innerHTML = '<option value="">当前浏览器不支持语音合成</option>';
      return;
    }
    function render() {
      var list = Voice.voices();
      var cur = Voice.currentName();
      sel.innerHTML = list.length
        ? list.map(function (v) {
            var n = v.name.replace(/"/g, '&quot;');
            return '<option value="' + n + '"' + (v.name === cur ? ' selected' : '') + '>' +
              v.name.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</option>';
          }).join('')
        : '<option value="">（系统暂无中文语音，可在系统设置里添加）</option>';
    }
    render();
    setTimeout(render, 700);
    setTimeout(render, 2000);
  }

  function initAI() {
    var st = window.LLM.state();
    $('#setKey').value = '';
    $('#setKey').placeholder = st.hasKey ? '已保存（留空则不修改）' : 'sk-...';
    $('#setModel').value = st.model || 'deepseek-chat';
    $('#setRate').value = String(state.voiceRate || 1.05);
    $('#setAI').checked = !!st.on;
    fillVoices();

    $('#btnAISave').addEventListener('click', function () {
      var key = $('#setKey').value.trim();
      var patch = { model: $('#setModel').value, on: $('#setAI').checked };
      if (key) patch.key = key;
      window.LLM.set(patch);

      state.voiceRate = parseFloat($('#setRate').value) || 1.05;
      state.voiceName = $('#setVoice').value || '';
      if (window.Voice) { Voice.setRate(state.voiceRate); Voice.setVoice(state.voiceName); }
      save();

      $('#setKey').value = '';
      $('#setKey').placeholder = window.LLM.state().hasKey ? '已保存（留空则不修改）' : 'sk-...';
      $('#aiSaved').textContent = '已保存';
      updateAIState();
      setTimeout(function () { $('#aiSaved').textContent = ''; }, 2400);
    });

    $('#btnClearKey').addEventListener('click', function () {
      window.LLM.clearKey();
      updateAIState();
      $('#setKey').placeholder = 'sk-...';
      $('#aiSaved').textContent = 'Key 已清除';
    });

    $('#btnTestAI').addEventListener('click', function () {
      var typed = $('#setKey').value.trim();
      var saved = '';
      try { saved = (JSON.parse(localStorage.getItem('shiba.ai.v1') || '{}').key) || ''; } catch (e) {}
      var token = typed || saved;
      var out = $('#aiSaved');
      if (!token) { out.textContent = '先填 Key'; return; }
      out.textContent = '测试中…';
      fetch('https://api.deepseek.com/models', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (r) {
          if (r.ok) out.textContent = '连接正常';
          else if (r.status === 401) out.textContent = 'Key 无效（401）';
          else out.textContent = '返回 ' + r.status;
        })
        .catch(function () { out.textContent = '连不上，检查网络或改用本地服务打开'; });
    });

    $('#setVoice').addEventListener('change', function () {
      state.voiceName = this.value;
      if (window.Voice) { Voice.setVoice(this.value); Voice.say('我是小柴，这是现在的声音。'); }
      save();
    });
  }

  /* ================= 初始化 ================= */
  function boot() {
    load();
    if (!state.ui || typeof state.ui !== 'object') state.ui = { cc: true, clean: true, zoom: 1, rate: 1 };
    if (state.teacher.hardStop && state.turns >= QUOTA) lockInput();
    renderQuota();
    buildTicks();
    initVideo();
    /* 恢复上次的播放器状态：字幕开关 / 净版 / 缩放 / 倍速 */
    ccOn = state.ui.cc !== false;
    $('#btnCC').classList.toggle('on', ccOn);
    $('#btnCC').setAttribute('aria-pressed', String(ccOn));
    setFit(state.ui.clean !== false);
    setZoom(state.ui.zoom || 1);
    if (state.ui.rate && state.ui.rate !== 1) {
      video.playbackRate = state.ui.rate;
      $('#speed').value = String(state.ui.rate);
    }
    initDog();
    initCard();
    initConcepts();
    initEthics();
    initTeacher();
    syncResources();
    initVoice();
    initAI();
    updateAIState();
    tickUI();

    composer.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });

    $('#btnEthics').addEventListener('click', function () { openDlg('dlgEthics'); });
    $('#btnTeacher').addEventListener('click', function () { openDlg('dlgTeacher'); });
    $('#btnRecord').addEventListener('click', function () { openDlg('dlgRecord'); });
    $('#btnRecordWipe').addEventListener('click', function () {
      if (!confirm('删除本机保存的对话与重启卡？')) return;
      wipe(); unlockInput(); renderQuota(); renderRecord(); renderAlerts();
    });
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { var d = b.closest('dialog'); if (d) d.close(); });
    });
    $$('dialog').forEach(function (d) {
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    });

    // 恢复历史对话（只回放，不再走一遍风控）
    if (state.messages.length) {
      addMsg('notice', '已恢复上次的对话（本机保存）', { quiet: true });
      state.messages.slice(-8).forEach(function (m) {
        addMsg(m.r === 'me' ? 'me' : 'bot', m.t, { quiet: true });
      });
      var lastBot = '';
      for (var i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].r === 'bot') { lastBot = state.messages[i].t; break; }
      }
      if (lastBot) mountMouth(addMsg('bot', lastBot, { quiet: true }));
    }

    var g = window.Engine.greeting();
    setTimeout(function () {
      typewrite(addMsg('bot', ''), g.text, function () {
        // 快捷问题等点开输入条后再出现
        if (!saybar.hidden) renderChips(g.chips);
      });
    }, 420);

    // 首次进入的引导气泡
    setTimeout(function () { showBubble('点我试试，我能回答问题。', 4200); }, 2200);

    // 调试/嵌入用接口
    window.App.ask = send;
    window.App.state = state;
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
