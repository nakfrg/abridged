/* Abridged — a one sentence journal. Prototype: no build step, localStorage only. */
(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const MAX_CHARS = 160;
  const PAGE_SIZE = 12;
  const STORE_KEY = 'abridged.entries.v1';

  /* ── dates ─────────────────────────────────────────────────── */
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const todayKey = () => keyOf(new Date());

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const longDate = (key) => {
    const d = dateOf(key);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  };
  const clockTime = (ts) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const placeName = () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return tz.split('/').pop().replace(/_/g, ' ');
  };

  /* ── storage ───────────────────────────────────────────────── */
  const store = {
    cache: null,
    all() {
      if (!this.cache) {
        try { this.cache = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
        catch { this.cache = {}; }
      }
      return this.cache;
    },
    flush() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.cache)); }
      catch { toast('Storage is full — try exporting and erasing.'); }
    },
    get(key) { return this.all()[key] || null; },
    set(key, text, ts) {
      const now = ts ?? Date.now();
      const prev = this.all()[key];
      this.cache[key] = { text, created: prev?.created ?? now, updated: now };
      this.flush();
    },
    remove(key) { delete this.all()[key]; this.flush(); },
    replace(obj) { this.cache = obj; this.flush(); },
    /** Newest first by default. */
    list(desc = true) {
      const keys = Object.keys(this.all()).sort();
      if (desc) keys.reverse();
      return keys.map((k) => ({ key: k, ...this.cache[k] }));
    },
    count() { return Object.keys(this.all()).length; },
  };

  /* ── app state ─────────────────────────────────────────────── */
  const state = {
    view: 'write',
    writeDate: todayKey(),
    calCursor: new Date(),          // any date inside the displayed month
    calSelected: todayKey(),
    sort: 'desc',
    range: 'all',
    query: '',
    shown: PAGE_SIZE,
  };

  /* ── toast ─────────────────────────────────────────────────── */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
  }

  const escapeHTML = (s) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── navigation ────────────────────────────────────────────── */
  function go(view) {
    state.view = view;
    ['write', 'calendar', 'journal'].forEach((v) => {
      $(`#view-${v}`).hidden = v !== view;
    });
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.nav === view));
    $$('.rail-btn').forEach((b) => {
      if (b.dataset.nav === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (view === 'write') renderWrite();
    if (view === 'calendar') renderCalendar();
    if (view === 'journal') { renderJournal(true); maybeLoadMore(); }
    if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
    window.scrollTo({ top: 0, behavior: 'instant' in document.body.style ? 'instant' : 'auto' });
  }

  $$('[data-nav]').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.preventDefault(); go(btn.dataset.nav); }));

  /* ── write view ────────────────────────────────────────────── */
  const textarea = $('#entryText');
  const counter = $('#counter');
  const saveBtn = $('#saveBtn');
  const saveLabel = $('#saveLabel');
  const writeNote = $('#writeNote');

  function renderWrite() {
    const key = state.writeDate;
    const d = dateOf(key);
    const isToday = key === todayKey();
    const existing = store.get(key);

    $('#wWeekday').textContent = DAYS[d.getDay()];
    $('#wDate').innerHTML = `${d.getDate()} ${MONTHS[d.getMonth()]}, <b>${d.getFullYear()}</b>`;
    $('#wTime').textContent = isToday
      ? `${clockTime(Date.now())}, ${placeName()}`
      : 'A past day';

    textarea.value = existing?.text || '';
    saveLabel.textContent = existing ? 'Update Entry' : 'Save Entry';
    syncCounter();

    if (isToday) {
      writeNote.hidden = true;
    } else {
      writeNote.hidden = false;
      writeNote.innerHTML =
        `Writing for a past day. <button class="link-btn" id="backToday">Back to today</button>`;
      $('#backToday').addEventListener('click', () => {
        state.writeDate = todayKey();
        renderWrite();
      });
    }
  }

  function syncCounter() {
    const left = MAX_CHARS - textarea.value.length;
    counter.textContent = left;
    counter.classList.toggle('low', left <= 20);
    saveBtn.disabled = textarea.value.trim().length === 0;
    textarea.style.height = '0px';                 // collapse first so it can shrink back
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  textarea.addEventListener('input', syncCounter);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  });

  function save() {
    const text = textarea.value.trim();
    if (!text) return;
    const key = state.writeDate;
    const isNew = !store.get(key);
    store.set(key, text);
    toast(isNew ? 'Entry saved.' : 'Entry updated.');
    saveLabel.textContent = 'Update Entry';
    state.calSelected = key;
    state.calCursor = dateOf(key);
    if (state.writeDate !== todayKey()) state.writeDate = todayKey();
    setTimeout(() => go('calendar'), 420);
  }
  saveBtn.addEventListener('click', save);

  /* ── calendar view ─────────────────────────────────────────── */
  function renderCalendar() {
    const cursor = state.calCursor;
    const year = cursor.getFullYear();
    const month = cursor.getMonth();

    $('#calMonth').textContent =
      year === new Date().getFullYear() ? MONTHS[month] : `${MONTHS[month]} ${year}`;

    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());   // back up to Sunday
    const today = todayKey();
    const grid = $('#calGrid');
    grid.innerHTML = '';

    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = keyOf(d);
      const outside = d.getMonth() !== month;
      // trim a trailing all-outside week
      if (i >= 35 && outside) break;

      const cell = document.createElement('button');
      cell.className = 'day';
      cell.dataset.key = key;
      cell.textContent = d.getDate();
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', longDate(key));
      if (outside) cell.classList.add('mute');
      if (key > today) cell.classList.add('future');
      if (key === today) cell.classList.add('today');
      if (key === state.calSelected) cell.classList.add('sel');
      if (store.get(key)) cell.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
      grid.appendChild(cell);
    }
    renderDetail();
  }

  $('#calGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('.day');
    if (!cell) return;
    state.calSelected = cell.dataset.key;
    if (cell.classList.contains('mute')) state.calCursor = dateOf(cell.dataset.key);
    renderCalendar();
  });

  $('#calPrev').addEventListener('click', () => shiftMonth(-1));
  $('#calNext').addEventListener('click', () => shiftMonth(1));
  function shiftMonth(delta) {
    const c = state.calCursor;
    state.calCursor = new Date(c.getFullYear(), c.getMonth() + delta, 1);
    renderCalendar();
  }

  const LEAF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4c-9 0-15 4-15 11a5 5 0 0 0 8.6 3.5C17.9 14.2 20 9.7 20 4Z"/><path d="M5 19.5C7.5 14 11.3 10.4 16 8.4"/></svg>';

  function renderDetail() {
    const key = state.calSelected;
    const entry = store.get(key);
    const box = $('#calDetail');

    if (entry) {
      box.innerHTML = `
        <div class="entry-card">
          <div class="entry-head">
            <span class="date-pill">${longDate(key)}</span>
            <span class="entry-time">${clockTime(entry.created)}</span>
          </div>
          <p class="entry-text">&ldquo;${escapeHTML(entry.text)}&rdquo;</p>
          <div class="entry-foot">
            ${LEAF}
            <span>
              <button class="link-btn" data-act="edit">Edit</button>
              &nbsp;&nbsp;
              <button class="link-btn warn" data-act="delete">Delete</button>
            </span>
          </div>
        </div>
        <p class="hint">Tap any date with a dot to relive that moment.</p>`;
    } else {
      const future = key > todayKey();
      box.innerHTML = `
        <div class="hint">
          ${future
            ? `Nothing here yet — ${longDate(key)} hasn&rsquo;t happened.`
            : `No entry for ${longDate(key)}.<br>
               <button class="link-btn" data-act="write">Write one for this day</button>`}
        </div>`;
    }

    box.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'write' || act === 'edit') {
        state.writeDate = key;
        go('write');
        setTimeout(() => textarea.focus(), 120);
      }
      if (act === 'delete') {
        if (!confirm(`Delete the entry for ${longDate(key)}?`)) return;
        store.remove(key);
        toast('Entry deleted.');
        renderCalendar();
      }
    };
  }

  /* ── journal view ──────────────────────────────────────────── */
  const feed = $('#feed');
  const feedEnd = $('#feedEnd');

  function inRange(key) {
    if (state.range === 'all') return true;
    const now = new Date();
    const d = dateOf(key);
    if (state.range === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (state.range === 'year') return d.getFullYear() === now.getFullYear();
    if (state.range === '30') return (now - d) / 86400000 <= 30;
    return true;
  }

  function matches() {
    const q = state.query.trim().toLowerCase();
    return store.list(state.sort === 'desc')
      .filter((e) => inRange(e.key))
      .filter((e) => !q || e.text.toLowerCase().includes(q));
  }

  function highlight(text) {
    const q = state.query.trim();
    const safe = escapeHTML(text);
    if (!q) return safe;
    const rx = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return safe.replace(rx, '<mark>$1</mark>');
  }

  function renderJournal(reset = false) {
    if (reset) state.shown = PAGE_SIZE;
    const results = matches();
    const slice = results.slice(0, state.shown);

    if (!results.length) {
      feed.innerHTML = `<p class="empty">${
        store.count() === 0
          ? 'Your journal is empty.<br>Write your first sentence and it will live here.'
          : 'Nothing matches that search.'
      }</p>`;
      feedEnd.hidden = true;
      return;
    }

    feed.innerHTML = slice.map((e) => `
      <p class="feed-date">${longDate(e.key).toUpperCase()} &nbsp;|&nbsp; ${clockTime(e.created)}</p>
      <article class="feed-item" data-key="${e.key}" tabindex="0">${highlight(e.text)}</article>
    `).join('');

    const done = state.shown >= results.length;
    feedEnd.hidden = !done || results.length < PAGE_SIZE;
    if (!done) feed.insertAdjacentHTML('beforeend', '<div class="skeleton"></div>');
  }

  feed.addEventListener('click', (e) => {
    const item = e.target.closest('.feed-item');
    if (!item) return;
    state.calSelected = item.dataset.key;
    state.calCursor = dateOf(item.dataset.key);
    go('calendar');
  });

  const sentinel = $('#sentinel');

  function loadMore() {
    if (state.view !== 'journal') return;
    if (state.shown >= matches().length) return;
    state.shown += PAGE_SIZE;
    renderJournal();
    // a tall viewport can reveal the sentinel again straight away — keep filling
    setTimeout(maybeLoadMore, 0);
  }

  function maybeLoadMore() {
    if (state.view !== 'journal') return;
    const box = sentinel.getBoundingClientRect();
    if (box.top - window.innerHeight < 240) loadMore();
  }

  // IntersectionObserver where it works, scroll position as the dependable fallback
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '240px' }).observe(sentinel);
  }

  let scrollTick = false;
  const onScroll = () => {
    if (scrollTick) return;
    scrollTick = true;
    setTimeout(() => { scrollTick = false; maybeLoadMore(); }, 80);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => { state.query = v; renderJournal(true); }, 140);
  });

  $$('.seg').forEach((btn) => btn.addEventListener('click', () => {
    state.sort = btn.dataset.sort;
    $$('.seg').forEach((b) => b.classList.toggle('on', b === btn));
    renderJournal(true);
  }));

  const filterMenu = $('#filterMenu');
  $('#filterBtn').addEventListener('click', (e) => {
    const open = filterMenu.hidden;
    filterMenu.hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  filterMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    state.range = btn.dataset.range;
    $$('button', filterMenu).forEach((b) => b.classList.toggle('on', b === btn));
    $('#filterLabel').textContent = state.range === 'all' ? 'Filter' : btn.textContent;
    renderJournal(true);
  });

  /* ── settings ──────────────────────────────────────────────── */
  const sheet = $('#settings');
  const scrim = $('#scrim');

  function openSettings() {
    const n = store.count();
    $('#statLine').textContent = n === 0
      ? 'No entries yet'
      : `${n} ${n === 1 ? 'sentence' : 'sentences'} kept, oldest ${longDate(store.list(false)[0].key)}`;
    sheet.hidden = scrim.hidden = false;
  }
  const closeSettings = () => { sheet.hidden = scrim.hidden = true; };

  $('#settingsOpen').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', closeSettings);
  scrim.addEventListener('click', closeSettings);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.all(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `abridged-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exported.');
  });

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      let added = 0;
      for (const [key, val] of Object.entries(data)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || typeof val?.text !== 'string') continue;
        store.cache[key] = val;
        added++;
      }
      store.flush();
      toast(`Imported ${added} ${added === 1 ? 'entry' : 'entries'}.`);
      openSettings();
      go(state.view);
    } catch {
      toast('That file could not be read.');
    }
    e.target.value = '';
  });

  $('#wipeBtn').addEventListener('click', () => {
    if (!confirm('Erase every entry? This cannot be undone.')) return;
    store.replace({});
    closeSettings();
    toast('All entries erased.');
    go(state.view);
  });

  /* ── sample data ───────────────────────────────────────────── */
  const SAMPLES = [
    'Watched the fog roll across the valley this morning, feeling the heavy silence settle into something like peace.',
    'Found an old film camera at the markets; the mechanical click of the shutter is satisfying in a way a digital screen isn’t.',
    'The house is completely silent at 6:00 AM — the only time of day when nothing is expected of me.',
    'Found an old photograph of my grandfather and realised we share the same squint when we’re trying to hide a smile.',
    'Rain started just as I reached the front door, and the smell of wet pavement arrived a second later.',
    'Watched the crowd at the station this morning; everyone heading somewhere with a specific purpose.',
    'Cooked something new and it worked, which felt like a small and undeserved piece of luck.',
    'The jacaranda on the corner dropped everything overnight and the footpath is purple.',
    'Realised halfway through the meeting that nobody was going to ask the obvious question, so I did.',
    'Sat in the car for ten minutes after getting home just to finish the song.',
    'A stranger held the lift and we talked about the weather like it mattered.',
    'The first cup of coffee is still the best part of the morning and I refuse to examine why.',
    'Went for a walk with no destination and came back with a decision already made.',
    'Someone laughed in the next room and I remembered that the house used to always sound like that.',
    'Wrote three sentences today and deleted two of them, which is roughly my usual ratio.',
    'The light at four in the afternoon has started arriving lower and warmer.',
    'Missed the bus and found a bookshop I’d walked past a hundred times.',
    'Told the truth about something small and it turned out to cost nothing.',
    'The ocean was flat and grey and I stayed longer than I meant to.',
    'Nothing much happened, and that turned out to be the good part.',
  ];

  $('#seedBtn').addEventListener('click', () => {
    const now = new Date();
    let added = 0;
    for (let i = 0; i < 120; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = keyOf(d);
      if (store.get(key)) continue;
      if ((i * 7919) % 10 < 3) continue;                      // deterministic gaps
      const text = SAMPLES[(i * 13) % SAMPLES.length];
      const hour = 6 + ((i * 5) % 15);
      const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, (i * 17) % 60).getTime();
      store.cache[key] = { text, created: ts, updated: ts };
      added++;
    }
    store.flush();
    toast(`Added ${added} sample entries.`);
    openSettings();
    go(state.view);
  });

  /* ── install prompt ────────────────────────────────────────── */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installRow').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#installRow').hidden = true;
  });

  /* ── boot ──────────────────────────────────────────────────── */
  const start = ['write', 'calendar', 'journal'].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : 'write';
  go(start);

  // the webfont changes text metrics, so re-measure the textarea once it lands
  if (document.fonts?.ready) document.fonts.ready.then(syncCounter);
  window.addEventListener('resize', syncCounter, { passive: true });

  // keep the write view honest across midnight / long-lived tabs
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.view === 'write') renderWrite();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
