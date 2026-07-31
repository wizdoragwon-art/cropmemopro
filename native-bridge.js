/* Crop Memo Pro — 네이티브(안드로이드 앱) 브리지
 *
 * 이 파일은 웹앱과 안드로이드 WebView 래퍼(android/ 폴더) 사이를 잇는 얇은 층입니다.
 * 브라우저(크롬 등)에서 열면 아무것도 하지 않으므로, 기존 웹앱 동작에 영향이 없습니다.
 *
 * 네이티브가 주입하는 객체: window.CMNative
 *   speechAvailable() -> boolean
 *   speechStart(lang, partial, preferOffline)
 *   speechStop()  /  speechCancel()
 *   saveBegin(name, mime) -> token(String)
 *   saveChunk(token, base64)
 *   saveEnd(token)
 *   toast(msg)
 *   info() -> JSON 문자열
 *
 * 네이티브 -> 웹 콜백 진입점: window.__CM.speech.* , window.__CM.file.*
 */
(function () {
  'use strict';

  var N = window.CMNative;
  var hasNative = !!(N && typeof N.speechStart === 'function');
  var CM = window.__CM || (window.__CM = {});

  window.CM_NATIVE = hasNative;                       // 앱 안에서 실행 중인지 여부
  window.CM_NATIVE_INFO = null;
  if (hasNative) {
    try { window.CM_NATIVE_INFO = JSON.parse(N.info()); } catch (e) { window.CM_NATIVE_INFO = {}; }
  }

  // 앱(APK) 안에서는 서비스워커 캐시가 앱 업데이트를 가릴 수 있으므로 남은 등록을 정리한다
  if (hasNative && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    try {
      navigator.serviceWorker.getRegistrations().then(function (rs) {
        rs.forEach(function (r) { try { r.unregister(); } catch (e) {} });
      });
    } catch (e) {}
  }

  /* ==========================================================
   * 1) 음성인식 — 안드로이드 SpeechRecognizer를 웹 표준 형태로 감싸기
   *    WebView에는 window.SpeechRecognition이 없으므로 여기서 만들어 준다.
   *    → app.js의 renderVoice()는 수정 없이 마이크 버튼을 그대로 쓸 수 있다.
   * ========================================================== */
  var ERRMAP = {
    1: ['network', '네트워크 응답이 없습니다'],
    2: ['network', '네트워크에 연결할 수 없습니다'],
    3: ['audio-capture', '마이크를 사용할 수 없습니다'],
    4: ['service-not-allowed', '음성인식 서버 오류'],
    5: ['aborted', '음성인식이 중단되었습니다'],
    6: ['no-speech', '말소리가 인식되지 않았습니다'],
    7: ['no-speech', '인식된 내용이 없습니다'],
    8: ['aborted', '음성인식이 사용 중입니다. 잠시 후 다시 시도하세요'],
    9: ['not-allowed', '마이크 권한이 필요합니다'],
    10: ['aborted', '요청이 너무 많습니다'],
    11: ['service-not-allowed', '음성인식 서비스 연결이 끊겼습니다'],
    12: ['language-not-supported', '한국어 음성 언어팩이 지원되지 않습니다'],
    13: ['language-not-supported', '한국어 음성 언어팩을 내려받아야 합니다 (설정 > 음성 입력)'],
    14: ['service-not-allowed', '음성인식 지원 여부를 확인할 수 없습니다'],
    100: ['not-allowed', '마이크 권한이 거부되었습니다'],
    101: ['service-not-allowed', '이 기기에서 음성인식을 사용할 수 없습니다']
  };

  function fire(obj, name, ev) {
    var fn = obj[name];
    if (typeof fn === 'function') { try { fn.call(obj, ev); } catch (e) { /* noop */ } }
  }
  function resultEvent(text, isFinal) {
    var alt = { transcript: text, confidence: isFinal ? 0.9 : 0.4 };
    var res = [alt];
    res.isFinal = !!isFinal;
    return { resultIndex: 0, results: [res], type: 'result' };
  }

  var active = null;   // 현재 동작 중인 인스턴스 (한 번에 하나)

  function NativeSpeechRecognition() {
    this.lang = 'ko-KR';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.preferOffline = true;          // 현장(비행기모드/음영지역) 대응 — 언어팩이 있으면 오프라인 인식
    this.onstart = null; this.onaudiostart = null; this.onspeechstart = null;
    this.onresult = null; this.onerror = null; this.onend = null;
    this.onspeechend = null; this.onaudioend = null; this.onnomatch = null;
    this._running = false;
    this._ended = false;
  }
  NativeSpeechRecognition.prototype.start = function () {
    if (this._running) return;
    if (active && active !== this) { try { active.abort(); } catch (e) {} }
    active = this; this._running = true; this._ended = false;
    try {
      N.speechStart(this.lang || 'ko-KR', !!this.interimResults, this.preferOffline !== false);
    } catch (e) {
      this._running = false;
      fire(this, 'onerror', { error: 'service-not-allowed', message: '음성인식을 시작할 수 없습니다', type: 'error' });
      fire(this, 'onend', { type: 'end' });
    }
  };
  NativeSpeechRecognition.prototype.stop = function () {
    if (!this._running) return;
    try { N.speechStop(); } catch (e) {}
  };
  NativeSpeechRecognition.prototype.abort = function () {
    if (!this._running) return;
    try { N.speechCancel(); } catch (e) {}
  };
  NativeSpeechRecognition.prototype.addEventListener = function (t, fn) { this['on' + t] = fn; };
  NativeSpeechRecognition.prototype.removeEventListener = function (t) { this['on' + t] = null; };

  CM.speech = {
    onStart: function () { if (active) fire(active, 'onstart', { type: 'start' }); },
    onAudioStart: function () { if (active) fire(active, 'onaudiostart', { type: 'audiostart' }); },
    onPartial: function (text) {
      if (!active || !text) return;
      if (active.interimResults) fire(active, 'onresult', resultEvent(String(text), false));
    },
    onFinal: function (text) {
      if (!active) return;
      fire(active, 'onresult', resultEvent(String(text || ''), true));
    },
    onError: function (code, msg) {
      if (!active) return;
      var m = ERRMAP[Number(code)] || ['aborted', msg || '음성인식 오류'];
      fire(active, 'onerror', { error: m[0], message: msg || m[1], code: Number(code), type: 'error' });
    },
    onEnd: function () {
      var a = active;
      if (!a || a._ended) return;
      a._ended = true; a._running = false; active = null;
      fire(a, 'onend', { type: 'end' });
    }
  };

  if (hasNative && !window.SpeechRecognition && !window.webkitSpeechRecognition) {
    var ok = true;
    try { ok = N.speechAvailable(); } catch (e) { ok = true; }
    if (ok) {
      window.SpeechRecognition = NativeSpeechRecognition;
      window.webkitSpeechRecognition = NativeSpeechRecognition;
      window.CM_SPEECH_NATIVE = true;      // 앱 내장 음성인식 사용 중
    }
  }

  /* ==========================================================
   * 2) 파일 저장 — WebView는 blob: 다운로드를 못 받으므로 네이티브로 넘긴다
   *    (CSV 내보내기, ZIP, 사진 jpg, 그래프 PNG/SVG, GAS 코드 .gs 전부 해당)
   * ========================================================== */
  var pending = {};   // token -> {resolve, reject, name}
  CM.file = {
    onSaved: function (token, name, where) {
      var p = pending[token]; delete pending[token];
      if (p) p.resolve({ name: name, where: where });
    },
    onError: function (token, name, msg) {
      var p = pending[token]; delete pending[token];
      if (p) p.reject(new Error(msg || '저장 실패'));
    }
  };

  function sliceB64(blob, start, end) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        res(i >= 0 ? s.slice(i + 1) : '');
      };
      fr.onerror = function () { rej(fr.error || new Error('read fail')); };
      fr.readAsDataURL(blob.slice(start, end));
    });
  }

  // 앱(네이티브)에서 실행 중이면 true를 돌려주고 저장을 진행한다. 브라우저에서는 false.
  window.CMSaveBlob = function (blob, filename) {
    if (!hasNative || typeof N.saveBegin !== 'function') return false;
    var mime = (blob && blob.type) || 'application/octet-stream';
    var token;
    try { token = N.saveBegin(String(filename || 'file'), mime); } catch (e) { return false; }
    if (!token) return false;

    var CHUNK = 192 * 1024;                 // 조각별로 따로 디코드하므로 경계 제약 없음
    var size = blob.size, pos = 0;
    var p = new Promise(function (resolve, reject) { pending[token] = { resolve: resolve, reject: reject, name: filename }; });
    p.catch(function () {});                // 미처리 거부 경고 방지

    (function step() {
      if (pos >= size) { try { N.saveEnd(token); } catch (e) {} return; }
      var end = Math.min(pos + CHUNK, size);
      sliceB64(blob, pos, end).then(function (b64) {
        try { N.saveChunk(token, b64); } catch (e) { CM.file.onError(token, filename, '전송 실패'); return; }
        pos = end; step();
      }, function () { CM.file.onError(token, filename, '읽기 실패'); });
    })();

    window.CM_LAST_SAVE = p;
    return true;
  };

  /* ==========================================================
   * 3) 입력 보조 — 키보드 마이크(IME 음성 입력) 사용성
   * ========================================================== */
  // (a) 일부 IME는 한글 조합 확정 시 input 이벤트를 늦게 보낸다 → compositionend에서 한 번 더 알림
  document.addEventListener('compositionend', function (e) {
    var t = e.target;
    if (!t || !(t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
    try { t.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) {}
  }, true);

  // (b) 키보드가 올라올 때 입력칸이 가리지 않도록 스크롤 (네이티브는 adjustResize + 인셋 패딩 처리)
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t || !(t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
    setTimeout(function () {
      try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) {}
    }, 320);
  }, true);

  // (c) 안드로이드 뒤로가기 버튼 → 앱 내 뒤로 이동 (네이티브가 호출)
  CM.back = function () {
    if (typeof window.CM_ON_BACK === 'function') { try { return !!window.CM_ON_BACK(); } catch (e) {} }
    return false;
  };
})();
