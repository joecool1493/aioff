// Element picker, injected on demand through activeTab. Overlay, highlight on hover,
// preview the hide, then save locally. "Submit to AI Off" opens a prefilled GitHub issue
// in a new tab; nothing is sent unless the user submits that form.
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { browser } from 'wxt/browser';
import { buildIssueUrl, generateSelectors, type PickResult } from '@aioff/picker';
import { RULES_REPO } from '../lib/constants';

export default defineUnlistedScript(() => {
  const w = window as unknown as { __aioffPicker?: boolean };
  if (w.__aioffPicker) return;
  w.__aioffPicker = true;

  const host = document.createElement('aioff-picker');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .box { position: fixed; pointer-events: none; border: 2px solid #d8442b; background: rgba(216,68,43,.15); border-radius: 3px; transition: all .04s; }
      .bar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); pointer-events: auto; max-width: min(640px, calc(100vw - 32px));
             font: 13px/1.4 system-ui, sans-serif; color: #f1eee6; background: #1e1d1a; border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
      .bar code { display: block; font: 11px ui-monospace, Menlo, monospace; background: #000; padding: 6px 8px; border-radius: 6px; margin: 8px 0; overflow-wrap: anywhere; max-height: 5em; overflow: auto; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; }
      button { font: inherit; border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; background: #35332e; color: inherit; }
      button.primary { background: #d8442b; color: #fff; }
    </style>
    <div class="box" hidden></div>
    <div class="bar" role="dialog" aria-label="AI Off element picker">
      <div class="msg">Point at the AI element and click it. Press Escape to cancel.</div>
    </div>`;
  document.documentElement.appendChild(host);
  const box = shadow.querySelector<HTMLElement>('.box')!;
  const bar = shadow.querySelector<HTMLElement>('.bar')!;

  let current: Element | null = null;
  let picked: { el: Element; result: PickResult; prevDisplay: string } | null = null;

  const outline = (el: Element | null) => {
    if (!el) return void (box.hidden = true);
    const r = el.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
  };

  const onMove = (e: MouseEvent) => {
    if (picked) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === host || el === document.documentElement || el === document.body) return;
    current = el;
    outline(el);
  };

  const close = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    w.__aioffPicker = false;
  };

  const undoPreview = () => {
    if (picked) (picked.el as HTMLElement).style.display = picked.prevDisplay;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    undoPreview();
    close();
  };

  function onClick(e: MouseEvent) {
    if (e.composedPath().includes(host)) return; // clicks on our own bar
    e.preventDefault();
    e.stopPropagation();
    if (picked || !current) return;
    const el = current;
    const result = generateSelectors(el);
    picked = { el, result, prevDisplay: (el as HTMLElement).style.display };
    (el as HTMLElement).style.setProperty('display', 'none', 'important'); // preview
    box.hidden = true;
    bar.innerHTML = `
      <div>Hidden as a preview. Keep it?</div>
      <code></code>
      <div class="row">
        <button class="primary" data-act="save">Hide it on ${location.hostname}</button>
        <button data-act="submit">Save and submit to AI Off rules</button>
        <button data-act="parent">Pick the parent instead</button>
        <button data-act="cancel">Cancel</button>
      </div>`;
    bar.querySelector('code')!.textContent = result.best;
  }

  bar.addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (!act || !picked) return;
    if (act === 'cancel') {
      undoPreview();
      return close();
    }
    if (act === 'parent') {
      undoPreview();
      const parent = picked.el.parentElement;
      picked = null;
      if (parent && parent !== document.body) {
        current = parent;
        onClick(new MouseEvent('click'));
      }
      return;
    }
    await browser.runtime.sendMessage({ type: 'saveUserRule', host: location.hostname, selector: picked.result.best });
    if (act === 'submit') {
      const url = buildIssueUrl({
        repo: RULES_REPO,
        pageUrl: location.href,
        result: picked.result,
        extensionVersion: browser.runtime.getManifest().version,
      });
      window.open(url, '_blank', 'noopener');
    }
    close();
  });

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
});
