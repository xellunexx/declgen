// Browser polyfill for the Electron preload bridge (window.desktop).
// Loaded only by web/server.mjs; the Electron preload stays the primary path.
(function () {
  window.__netlog = window.__netlog || [];
  async function request(args) {
    const method = (args.method || 'GET').toUpperCase();
    const t0 = Date.now();
    const r = await fetch(args.endpoint, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(args.body || {}),
    });
    const out = await r.json();
    window.__netlog.push({ t: t0, ep: args.endpoint, method, status: r.status, ok: out && out.ok, ms: Date.now() - t0, rid: r.headers.get('x-request-id') || undefined });
    if (window.__netlog.length > 30) window.__netlog.shift();
    if (out && out.ok === false && typeof window.__telemetryPush === 'function') {
      window.__telemetryPush('api_error', { ep: (args.endpoint || '').slice(0, 80), msg: String(out.error || '').slice(0, 200) });
    }
    return out;
  }

  async function upload(args) {
    const paths = args.paths || [];
    if (args.endpoint === '/api/profile_import/inspect') {
      if (paths.length !== 1) return { ok: false, error: 'Изберете точно един XML файл.' };
      return await request({ endpoint: args.endpoint, method: 'POST', body: { path: paths[0] } });
    }
    if (args.endpoint === '/api/dossier/upload') {
      return await request({ endpoint: args.endpoint, method: 'POST', body: { paths } });
    }
    return { ok: false, error: 'unsupported local upload endpoint: ' + args.endpoint };
  }

  function chooseBrowserFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept; input.multiple = multiple;
      input.addEventListener('change', () => resolve(Array.from(input.files || [])), { once: true });
      input.addEventListener('cancel', () => resolve([]), { once: true });
      input.click();
    });
  }

  async function uploadBrowserFiles(purpose) {
    const profile = purpose === 'profile';
    const files = await chooseBrowserFiles(profile ? '.xml' : '.pdf,.csv,.xml,.xlsx', !profile);
    if (!files.length) return { ok: false, cancelled: true };
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    const endpoint = profile ? '/api/profile_import/browser-upload' : '/api/dossier/browser-upload';
    const t0 = Date.now();
    const response = await fetch(endpoint, { method: 'POST', body: form });
    const out = await response.json();
    window.__netlog.push({ t: t0, ep: endpoint, method: 'POST', status: response.status, ok: out && out.ok, ms: Date.now() - t0, rid: response.headers.get('x-request-id') || undefined });
    if (window.__netlog.length > 30) window.__netlog.shift();
    return out;
  }

  function download(args) {
    // Map the Electron endpoint to a streamed file download.
    let target = null;
    if (args.endpoint === '/api/download/case_package') target = '/__download/case_package';
    if (!target) return Promise.resolve({ ok: false, error: 'Няма готов файл за изтегляне.' });
    const a = document.createElement('a');
    a.href = target + '?name=' + encodeURIComponent(args.suggestedName || 'declgen-export.zip');
    a.download = args.suggestedName || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return Promise.resolve({ ok: true, filePath: 'browser download: ' + (args.suggestedName || '') });
  }

  function normalizePath(s) {
    s = String(s || '').trim();
    while (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) s = s.slice(1, -1).trim();
    return s;
  }

  async function nativePick(mode) {
    try {
      const r = await fetch('/__native/select', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }),
      });
      return await r.json();
    } catch { return { ok: false, error: 'native-unavailable' }; }
  }

  async function selectFiles(purpose) {
    const native = await nativePick(purpose === 'profile' ? 'profile' : 'files');
    if (native && native.ok) return native.paths || [];
    if (native && native.error && native.error !== 'native-unavailable') return native.paths || [];
    // Browser clients cannot provide a usable server-side path. Components use
    // uploadBrowserFiles(), which opens the picker on the browser's own machine.
    return [];
  }

  async function selectFolder() {
    const native = await nativePick('folder');
    if (native && native.ok) return (native.paths && native.paths[0]) || null;
    if (native && native.error && native.error !== 'native-unavailable') return null;
    return null;
  }

  function openExternal(url) {
    window.open(url, '_blank', 'noopener');
    return Promise.resolve();
  }

  async function openPath(p) {
    try {
      const r = await fetch('/__native/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p }) });
      return await r.json();
    } catch (e) { return { ok: false, error: String(e) }; }
  }

  window.desktop = Object.freeze({ selectFiles, selectFolder, openExternal, request, upload, uploadBrowserFiles, download });

  // ---- Interaction telemetry (local only, values masked) ----
  (function telemetry() {
    const queue = [];
    let seq = 0;
    const session = Math.random().toString(36).slice(2, 10);
    const startedAt = Date.now();

    function label(el) {
      if (!el || !el.closest) return '';
      const t = el.closest('button, a, input, select, textarea, [role="tab"]');
      if (!t) return '';
      return (t.getAttribute('aria-label') || t.innerText || t.name || t.placeholder || t.type || '').trim().slice(0, 80);
    }
    function push(type, data) {
      queue.push({ seq: ++seq, t: Date.now(), up: Date.now() - startedAt, session, type, ...data });
      if (queue.length > 200) queue.splice(0, queue.length - 200);
      schedule();
    }
    window.__telemetryPush = push;
    let timer = 0;
    function schedule() { if (!timer) timer = setTimeout(flush, 1500); }
    function flush(sync) {
      timer = 0;
      if (!queue.length) return;
      const body = JSON.stringify(queue.splice(0, queue.length));
      if (sync && navigator.sendBeacon) { navigator.sendBeacon('/__telemetry', new Blob([body], { type: 'application/json' })); return; }
      fetch('/__telemetry', { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => {});
    }

    document.addEventListener('click', (e) => {
      const el = e.target;
      push('click', { tag: el.tagName?.toLowerCase(), label: label(el), tab: el.closest?.('[role="tab"]')?.id || undefined });
    }, true);
    document.addEventListener('change', (e) => {
      const el = e.target;
      const isSecret = el.type === 'password';
      push('change', { tag: el.tagName?.toLowerCase(), label: label(el), len: isSecret ? -1 : String(el.value ?? '').length });
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
        push('key', { key: e.ctrlKey ? 'Ctrl+' + e.key : e.key, label: label(document.activeElement) });
      }
    }, true);
    window.addEventListener('error', (e) => push('error', { msg: String(e.message || '').slice(0, 200) }));
    window.addEventListener('unhandledrejection', (e) => push('error', { msg: 'rejection: ' + String(e.reason || '').slice(0, 200) }));
    document.addEventListener('visibilitychange', () => { push(document.hidden ? 'hidden' : 'visible', {}); if (document.hidden) flush(true); });
    window.addEventListener('pagehide', () => { push('pagehide', {}); flush(true); });
    push('load', { url: location.pathname });
  })();
})();
