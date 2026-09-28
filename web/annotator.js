// declgen human-annotated runtime tracing — MVP.
// Gated: enable via ?annotate=1 (persists) or localStorage.declgen_annotate='1'. Off = zero listeners.
(function () {
  const qs = new URLSearchParams(location.search);
  if (qs.get('annotate') === '1') {
    try {
      localStorage.setItem('declgen_annotate', '1');
    } catch {}
  }
  let on = false;
  try {
    on = localStorage.getItem('declgen_annotate') === '1';
  } catch {}
  if (!on) return;

  // ---- local interaction ring (snapshot evidence) ----
  const ring = [];
  function rec(type, e) {
    const el = e && e.target;
    ring.push({
      t: Date.now(),
      type,
      tag: el && el.tagName ? el.tagName.toLowerCase() : undefined,
      label: labelOf(el),
      tab: el && el.closest ? (el.closest('[role="tab"]') || {}).id : undefined,
    });
    if (ring.length > 60) ring.shift();
  }
  function labelOf(el) {
    if (!el || !el.closest) return '';
    const t = el.closest('button, a, input, select, textarea, [role="tab"]');
    if (!t) return '';
    return (
      t.getAttribute('aria-label') ||
      t.innerText ||
      t.name ||
      t.placeholder ||
      t.type ||
      ''
    )
      .trim()
      .slice(0, 80);
  }
  for (const type of ['click', 'change', 'submit'])
    document.addEventListener(type, (e) => rec(type, e), true);
  window.addEventListener('error', (e) =>
    ring.push({
      t: Date.now(),
      type: 'error',
      label: String(e.message || '').slice(0, 200),
    }),
  );

  // ---- helpers ----
  function selectorOf(el) {
    if (!el || el === document.body) return '';
    const parts = [];
    let cur = el;
    while (cur && cur !== document.documentElement && parts.length < 6) {
      let p = cur.tagName.toLowerCase();
      if (cur.id) {
        p += '#' + cur.id;
        parts.unshift(p);
        break;
      }
      const cls = String(cur.className || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      const role = cur.getAttribute && cur.getAttribute('role');
      if (role) p += '[role="' + role + '"]';
      parts.unshift(p);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }
  function componentsOf(el) {
    // Deterministic for our own components; heuristic for minified deps. Never faked.
    const out = [];
    if (!el) return out;
    const fiberKey = Object.keys(el).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
    );
    if (!fiberKey) return out;
    let f = el[fiberKey];
    while (f && out.length < 6) {
      const n =
        f.elementType &&
        (typeof f.elementType === 'function' ? f.elementType.name : null);
      if (n) out.push(n);
      f = f.return;
    }
    return out;
  }
  function attrsOf(el) {
    const keep = [
      'id',
      'role',
      'aria-label',
      'name',
      'type',
      'placeholder',
      'data-testid',
      'disabled',
    ];
    const o = {};
    if (!el || !el.getAttribute) return o;
    for (const k of keep) {
      const v = el.getAttribute(k);
      if (v != null) o[k] = String(v).slice(0, 120);
    }
    for (const a of el.attributes || [])
      if (
        a.name.startsWith('data-') &&
        !/private|secret|token|pass/i.test(a.name)
      )
        o[a.name] = String(a.value).slice(0, 120);
    return o;
  }

  function captureInteractionContext(e) {
    const el = e.target;
    const r =
      el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return Object.freeze({
      annotationId:
        'ann_' +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 8),
      capturedAt: new Date().toISOString(),
      page: {
        url: location.href,
        route: location.pathname,
        title: document.title.slice(0, 120),
      },
      viewport: { w: innerWidth, h: innerHeight, scrollY: Math.round(scrollY) },
      target: {
        selector: selectorOf(el) || undefined,
        tagName: el && el.tagName ? el.tagName.toLowerCase() : undefined,
        elementId: (el && el.id) || undefined,
        text:
          el && el.innerText ? el.innerText.trim().slice(0, 120) : undefined,
        rect: r
          ? {
              x: Math.round(r.x),
              y: Math.round(r.y),
              w: Math.round(r.width),
              h: Math.round(r.height),
            }
          : undefined,
        attrs: attrsOf(el),
        components: componentsOf(el),
        componentsConfidence: 'inferred-from-react-fiber',
      },
      interaction: { type: 'contextmenu', x: e.clientX, y: e.clientY },
      recentInteractions: ring.slice(-25),
      recentNetwork: (window.__netlog || []).slice(-15),
      build: {
        version: (
          window.__BUILD_ID__ ||
          document.querySelector('script[type=module]')?.src.split('/').pop() ||
          ''
        ).slice(0, 60),
      },
      userAgent: navigator.userAgent.slice(0, 160),
    });
  }

  // ---- UI: context menu + comment box ----
  let menu = null,
    pending = null;
  const css = {
    menu: 'position:fixed;z-index:2147483647;background:#1f2430;color:#e8eaf2;border:1px solid #3a4152;border-radius:8px;padding:4px;min-width:140px;font:13px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.5)',
    item: 'display:block;width:100%;text-align:left;background:none;border:0;color:inherit;padding:8px 12px;border-radius:6px;cursor:pointer',
    box: 'position:fixed;z-index:2147483647;background:#161a23;color:#e8eaf2;border:1px solid #3a4152;border-radius:10px;padding:12px;width:340px;font:13px system-ui;box-shadow:0 12px 40px rgba(0,0,0,.6)',
    ta: 'width:100%;box-sizing:border-box;height:90px;background:#0e1118;color:#e8eaf2;border:1px solid #3a4152;border-radius:6px;padding:8px;font:13px system-ui;resize:vertical',
    btn: 'background:#4f7cff;border:0;color:#fff;padding:7px 14px;border-radius:6px;cursor:pointer',
    btn2: 'background:none;border:1px solid #3a4152;color:#9aa3b5;padding:7px 12px;border-radius:6px;cursor:pointer;margin-left:8px',
    meta: 'color:#8a91a3;font-size:11px;margin:6px 0 10px;max-height:74px;overflow:auto;white-space:pre-wrap',
  };
  function el(tag, style, text) {
    const n = document.createElement(tag);
    n.style.cssText = style;
    if (text != null) n.textContent = text;
    return n;
  }
  function killMenu() {
    if (menu) {
      menu.remove();
      menu = null;
    }
  }

  function openComment(ctx) {
    const box = el('div', css.box);
    box.style.left = Math.min(ctx.interaction.x + 4, innerWidth - 360) + 'px';
    box.style.top = Math.min(ctx.interaction.y + 4, innerHeight - 260) + 'px';
    box.appendChild(
      el(
        'div',
        'font-weight:600;margin-bottom:6px',
        'Input — бележка към телеметрията',
      ),
    );
    const meta = el(
      'div',
      css.meta,
      (ctx.target.selector || '(няма селектор)') +
        (ctx.target.components.length
          ? '\ncomponents: ' + ctx.target.components.join(' › ')
          : '') +
        (ctx.recentNetwork.length
          ? '\nlast api: ' +
            (ctx.recentNetwork[ctx.recentNetwork.length - 1].ep || '?') +
            ' → ' +
            ctx.recentNetwork[ctx.recentNetwork.length - 1].status
          : ''),
    );
    box.appendChild(meta);
    const ta = el('textarea', css.ta);
    ta.placeholder = ' Какво е грешно / неочаквано тук?';
    ta.dataset.private = '1';
    box.appendChild(ta);
    const row = el('div', 'margin-top:10px;text-align:right');
    const send = el('button', css.btn, 'Запиши');
    const cancel = el('button', css.btn2, 'Откажи');
    cancel.style.marginLeft = '8px';
    cancel.onclick = () => box.remove();
    send.onclick = () => {
      const comment = ta.value.trim();
      if (!comment) {
        ta.focus();
        return;
      }
      const event = Object.freeze({
        ...ctx,
        type: 'annotation',
        comment,
        submittedAt: new Date().toISOString(),
      });
      const body = JSON.stringify([event]);
      if (navigator.sendBeacon)
        navigator.sendBeacon(
          '/__telemetry',
          new Blob([body], { type: 'application/json' }),
        );
      else
        fetch('/__telemetry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }).catch(() => {});
      box.remove();
      send.textContent = '✓ ' + ctx.annotationId;
      const ok = el(
        'div',
        'position:fixed;z-index:2147483647;background:#134e2a;color:#d9f5e3;border-radius:6px;padding:6px 10px;font:12px system-ui',
        'Записано: ' + ctx.annotationId,
      );
      ok.style.left = ctx.interaction.x + 'px';
      ok.style.top = ctx.interaction.y + 'px';
      document.body.appendChild(ok);
      setTimeout(() => ok.remove(), 2500);
    };
    row.appendChild(send);
    row.appendChild(cancel);
    box.appendChild(row);
    box.addEventListener('contextmenu', (e) => e.stopPropagation());
    document.body.appendChild(box);
    ta.focus();
  }

  document.addEventListener(
    'contextmenu',
    (e) => {
      if (
        (e.target && e.target.dataset && e.target.dataset.private) ||
        e.target.closest('[data-private]')
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      const ctx = captureInteractionContext(e); // frozen BEFORE the user types
      pending = ctx;
      killMenu();
      menu = el('div', css.menu);
      const item = el('button', css.item, 'Input');
      item.onmouseenter = () => (item.style.background = '#2a3142');
      item.onmouseleave = () => (item.style.background = 'none');
      item.onclick = () => {
        killMenu();
        openComment(pending);
        pending = null;
      };
      menu.appendChild(item);
      menu.style.left = Math.min(e.clientX, innerWidth - 160) + 'px';
      menu.style.top = Math.min(e.clientY, innerHeight - 80) + 'px';
      document.body.appendChild(menu);
      const off = () => {
        killMenu();
        document.removeEventListener('click', off, true);
      };
      setTimeout(() => document.addEventListener('click', off, true), 10);
    },
    true,
  );

  // future browser-extension hook: window.__annotate.open() opens the box for an ad-hoc target
  window.__annotate = Object.freeze({
    open(target) {
      const el2 = target instanceof Element ? target : document.body;
      const r = el2.getBoundingClientRect();
      openComment(
        captureInteractionContext({
          target: el2,
          clientX: r.x + 8,
          clientY: r.y + 8,
        }),
      );
    },
    capture: captureInteractionContext,
  });
  console.log('[declgen] annotator active — right-click → Input');
})();
