// fe-predeploy 런타임 계측 스니펫 — 시나리오 실행 전에 브라우저 페이지에 주입한다
// (claude-in-chrome javascript_tool로 이 파일 내용을 그대로 평가).
// 리스너·타이머 잔존과 네트워크 요청 수를 세어 "중복 클릭 → API 1회"·"언마운트 → 누수 0"을
// 숫자로 판정할 수 있게 한다. 플레인 스크립트(수출 없음) — 브라우저 eval과 Node import 양쪽에서 동작.
// 주의: 페이지를 이동/새로고침하면 계측이 사라진다 — 시나리오마다 재주입한다.
(() => {
  const g = globalThis;
  if (g.__fePredeploy) return; // 멱등 — 재주입해도 계측 상태를 초기화하지 않는다

  const state = {
    listenersByType: new Map(),
    activeIntervals: new Set(),
    activeTimeouts: new Set(),
    requests: [],
    consoleErrors: [],
  };
  const bump = (type, delta) => {
    const next = (state.listenersByType.get(type) ?? 0) + delta;
    state.listenersByType.set(type, Math.max(0, next));
  };

  // 리스너 — once는 발화 시 자동 해제되므로 잔존 후보로 세지 않는다.
  if (typeof g.EventTarget === 'function') {
    const proto = g.EventTarget.prototype;
    const origAdd = proto.addEventListener;
    const origRemove = proto.removeEventListener;
    proto.addEventListener = function (type, listener, options) {
      if (!(options === Object(options) && options.once)) bump(type, 1);
      return origAdd.call(this, type, listener, options);
    };
    proto.removeEventListener = function (type, listener, options) {
      bump(type, -1);
      return origRemove.call(this, type, listener, options);
    };
  }

  // 타이머 — interval은 clear까지 잔존, timeout은 발화하면 스스로 잔존 목록에서 빠진다.
  const origSetInterval = g.setInterval;
  const origClearInterval = g.clearInterval;
  const origSetTimeout = g.setTimeout;
  const origClearTimeout = g.clearTimeout;
  g.setInterval = function (...args) {
    const id = origSetInterval.apply(g, args);
    state.activeIntervals.add(id);
    return id;
  };
  g.clearInterval = function (id) {
    state.activeIntervals.delete(id);
    return origClearInterval.call(g, id);
  };
  g.setTimeout = function (callback, delayMs, ...rest) {
    const wrapped = typeof callback === 'function'
      ? function (...cbArgs) { state.activeTimeouts.delete(id); return callback.apply(this, cbArgs); }
      : callback;
    const id = origSetTimeout.call(g, wrapped, delayMs, ...rest);
    state.activeTimeouts.add(id);
    return id;
  };
  g.clearTimeout = function (id) {
    state.activeTimeouts.delete(id);
    return origClearTimeout.call(g, id);
  };

  // 네트워크 — fetch와 XHR(브라우저의 axios 기본 어댑터) 양쪽을 기록한다.
  const record = (url, method) => state.requests.push({
    url: String(url),
    method: String(method || 'GET').toUpperCase(),
    at: Date.now(),
  });
  if (typeof g.fetch === 'function') {
    const origFetch = g.fetch;
    g.fetch = function (input, init) {
      record(input && input.url ? input.url : input, (init && init.method) || (input && input.method));
      return origFetch.call(g, input, init);
    };
  }
  if (typeof g.XMLHttpRequest === 'function') {
    const origOpen = g.XMLHttpRequest.prototype.open;
    g.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      record(url, method);
      return origOpen.call(this, method, url, ...rest);
    };
  }

  // 콘솔 에러 — 시나리오 통과 기준 "에러 0건" 판정용 요약 수집.
  const origConsoleError = console.error;
  console.error = function (...args) {
    state.consoleErrors.push(args.map(String).join(' ').slice(0, 300));
    return origConsoleError.apply(console, args);
  };

  g.__fePredeploy = {
    report() {
      const listenersByType = {};
      let activeListeners = 0;
      for (const [type, count] of state.listenersByType) {
        if (count > 0) { listenersByType[type] = count; activeListeners += count; }
      }
      return {
        activeListeners,
        listenersByType,
        activeIntervals: state.activeIntervals.size,
        activeTimeouts: state.activeTimeouts.size,
        requestCount: state.requests.length,
        requests: state.requests.slice(-50),
        consoleErrors: state.consoleErrors.slice(),
      };
    },
    countRequests(urlPart, method) {
      return state.requests.filter((r) => r.url.includes(urlPart)
        && (!method || r.method === String(method).toUpperCase())).length;
    },
    resetRequests() { state.requests.length = 0; },
  };
})();
