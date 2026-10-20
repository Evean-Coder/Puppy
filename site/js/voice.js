/* 语音：浏览器内置 speechSynthesis，不联网、不产生费用。
   按句排队朗读，遇到长回答也不会被 Chrome 的 15 秒限制截断。 */
window.Voice = (function () {
  'use strict';
  var synth = window.speechSynthesis;
  var supported = !!(synth && window.SpeechSynthesisUtterance);

  var enabled = true;
  var rate = 1.05;
  var chosen = '';
  var queue = [];
  var speaking = false;
  var onState = function () {};

  function voices() {
    var vs = [];
    try { vs = synth.getVoices() || []; } catch (e) {}
    return vs;
  }

  function zhVoices() {
    return voices().filter(function (v) { return /^zh([-_]|$)/i.test(v.lang || ''); });
  }

  function pick() {
    if (chosen) {
      var hit = zhVoices().filter(function (v) { return v.name === chosen; })[0];
      if (hit) return hit;
    }
    var list = zhVoices();
    if (!list.length) return null;
    // 优先自然音色，其次是常见的几个中文音色
    var prefs = ['xiaoxiao', 'natural', 'yunxi', 'xiaoyi', 'huihui', 'yaoyao', 'kangkang', 'google'];
    for (var i = 0; i < prefs.length; i++) {
      for (var j = 0; j < list.length; j++) {
        if (list[j].name.toLowerCase().indexOf(prefs[i]) >= 0) return list[j];
      }
    }
    return list[0];
  }

  function setState(v) {
    speaking = v;
    onState(v);
  }

  function split(text) {
    return String(text || '')
      .replace(/[#*_`>]/g, '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[。！？!?；;\n])/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function speakNext() {
    if (!enabled || !queue.length) { setState(false); return; }
    var text = queue.shift();
    var u = new SpeechSynthesisUtterance(text);
    var v = pick();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'zh-CN'; }
    u.rate = rate;
    u.pitch = 1.1;
    u.volume = 1;
    u.onend = speakNext;
    u.onerror = function () { speakNext(); };
    setState(true);
    try { synth.speak(u); } catch (e) { setState(false); }
  }

  function push(chunk) {
    if (!enabled) return;
    split(chunk).forEach(function (s) { queue.push(s); });
    if (!speaking) speakNext();
  }

  function say(text) {
    stop();
    push(text);
  }

  function stop() {
    queue = [];
    try { synth.cancel(); } catch (e) {}
    setState(false);
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) stop();
  }

  function setRate(r) { rate = Math.max(0.6, Math.min(1.6, r)); }
  function setVoice(name) { chosen = name || ''; }

  if (supported) {
    // 语音列表是异步加载的，加载完重新挑一次
    try {
      synth.onvoiceschanged = function () { pick(); };
      voices();
    } catch (e) {}
    window.addEventListener('beforeunload', function () { try { synth.cancel(); } catch (e) {} });
  }

  return {
    supported: supported, say: say, push: push, stop: stop,
    setEnabled: setEnabled, setRate: setRate, setVoice: setVoice,
    isEnabled: function () { return enabled; },
    isSpeaking: function () { return speaking; },
    onState: function (fn) { onState = fn || function () {}; },
    voices: zhVoices,
    currentName: function () { var v = pick(); return v ? v.name : ''; }
  };
})();
