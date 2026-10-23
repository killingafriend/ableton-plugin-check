(function () {
  const { parseSession, validateList, analyze, pluginKey } = window.PC;
  const $ = id => document.getElementById(id);
  const api = window.pluginApi || null; // nur in der Electron-App vorhanden

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } },
  };

  const state = {
    list: null,
    inventory: store.get('pc.inventory', null),
    manual: new Set(store.get('pc.manual', [])),
    extraDirs: store.get('pc.extraDirs', []),
    filter: 'problems',
    scanning: false,
  };

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TYPE_LABEL = { audio: 'Audio', midi: 'MIDI', group: 'Gruppe', return: 'Return', main: 'Main' };

  // ---------- Laden ----------
  async function handleFile(file) {
    if (!file) return;
    $('busy').hidden = false;
    try {
      if (api) {
        const p = api.pathForFile(file);
        if (!p) throw new Error('Pfad der Datei nicht lesbar – bitte über „Datei auswählen …“ öffnen.');
        const r = await api.readFile(p);
        file = new File([r.bytes], r.name);
      }
      let list;
      if (/\.als$/i.test(file.name)) {
        list = await parseSession(file);
      } else {
        list = validateList(JSON.parse(await file.text()));
      }
      state.list = list;
      state.filter = 'problems';
      render();
    } catch (e) {
      const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      showError(/ENOENT|EPERM|EACCES|not be found/i.test(msg)
        ? `Datei konnte nicht gelesen werden (${msg}). Liegt sie in Dropbox/iCloud, zuerst „Offline verfügbar“ machen oder lokal kopieren.`
        : msg);
    } finally {
      $('busy').hidden = true;
    }
  }

  function showError(msg) {
    if (state.list) {
      const b = $('busy'); b.textContent = msg; b.hidden = false;
      setTimeout(() => { b.hidden = true; b.textContent = 'Lese Session …'; }, 4000);
    } else {
      $('err').textContent = msg; $('err').hidden = false;
    }
  }

  // ---------- Inventar ----------
  function setInventory(inv) {
    state.inventory = inv;
    store.set('pc.inventory', inv);
    render();
  }

  async function scan() {
    if (!api || state.scanning) return;
    state.scanning = true; renderInv();
    try { setInventory(await api.scan(state.extraDirs)); } finally { state.scanning = false; renderInv(); }
  }

  async function addFolder() {
    if (api) {
      const dir = await api.pickFolder();
      if (!dir) return;
      state.extraDirs = [...new Set([...state.extraDirs, dir])];
      store.set('pc.extraDirs', state.extraDirs);
      await scan();
    } else if (window.showDirectoryPicker) {
      try {
        const root = await window.showDirectoryPicker();
        const found = [];
        await walkHandle(root, 0, found);
        const merged = new Map((state.inventory?.plugins || []).map(p => [p.format + p.name, p]));
        for (const p of found) merged.set(p.format + p.name, p);
        setInventory({ scannedAt: new Date().toISOString(), plugins: [...merged.values()] });
      } catch { /* abgebrochen */ }
    } else {
      showError('Ordnerauswahl wird in diesem Browser nicht unterstützt – nutze die Desktop-App.');
    }
  }

  const EXT = { vst: 'VST2', vst3: 'VST3', component: 'AU', dll: 'VST2' };
  async function walkHandle(dir, depth, out) {
    for await (const [name, handle] of dir.entries()) {
      const m = /\.([a-z0-9]+)$/i.exec(name);
      const fmt = m && EXT[m[1].toLowerCase()];
      if (fmt) out.push({ name: name.replace(/\.[a-z0-9]+$/i, ''), format: fmt, aliases: [] });
      else if (handle.kind === 'directory' && depth < 3) await walkHandle(handle, depth + 1, out);
    }
  }

  // ---------- Rendering ----------
  function render() {
    renderInv();
    $('drop').hidden = !!state.list;
    $('result').hidden = !state.list;
    if (!state.list) return;

    const res = analyze(state.list, state.inventory, state.manual);
    const s = state.list.session || {};
    $('sname').textContent = s.name || 'Session';
    const nPlugins = state.list.tracks.reduce((n, t) => n + t.plugins.length, 0);
    $('smeta').textContent = [
      s.liveVersion, `${state.list.tracks.length} Spuren`, `${nPlugins} Plugin-Instanzen`,
    ].filter(Boolean).join(' · ');

    renderVerdict(res);
    document.querySelectorAll('#filter button').forEach(b => b.classList.toggle('on', b.dataset.f === state.filter));
    $('copy').hidden = !(res.freeze.length || res.blocked.length);

    const problem = t => ['freeze', 'blocked', 'frozen', 'inactive'].includes(t.verdict);
    let shown = res.tracks.map((t, i) => ({ ...t, idx: i + 1 })).filter(t => t.plugins.length);
    if (state.filter === 'problems') shown = shown.filter(problem);
    $('tracks').innerHTML = shown.length
      ? shown.map(trackHtml).join('')
      : `<div class="t-note" style="padding:12px 2px">${state.filter === 'problems' ? 'Keine Probleme gefunden.' : 'Keine Spur enthält Third-Party-Plugins.'}</div>`;

    state.lastResult = res;
  }

  function renderVerdict(res) {
    const v = $('verdict');
    const hint = 'Freezen kann nur, wer die Plugins hat (z. B. der Absender): Spur wählen → Edit → Freeze Tracks.';
    if (!res.hasInventory) {
      v.className = 'verdict info';
      v.innerHTML = `<div class="big">Noch keine installierten Plugins bekannt</div>
        <div class="sub">Ohne Plugin-Scan kann nichts verglichen werden. ${api ? '' : 'Wähle deine Plugin-Ordner (z. B. /Library/Audio/Plug-Ins/VST3).'}</div>
        <button class="btn" id="vscan">${api ? 'Plugins scannen' : 'Plugin-Ordner wählen'}</button>`;
      $('vscan').onclick = api ? scan : addFolder;
    } else if (res.freeze.length || res.blocked.length) {
      const names = [...new Set(res.missingPlugins.map(p => p.name))];
      v.className = 'verdict bad';
      v.innerHTML = `<div class="stats">
          <div class="stat hot"><span class="lbl">Spuren zum Freezen</span><span class="num">${res.freeze.length}</span></div>
          <div class="stat"><span class="lbl">Nicht freezebar</span><span class="num">${res.blocked.length}</span></div>
          <div class="stat"><span class="lbl">Fehlende Plugins</span><span class="num">${names.length}</span></div>
        </div>
        <div class="sub"><b>${esc(names.join(', '))}</b></div>
        <div class="sub">${hint}</div>`;
    } else {
      v.className = 'verdict ok';
      v.innerHTML = `<div class="big">Alles da – nichts zu freezen</div>
        <div class="sub">Alle Plugins dieser Session sind auf diesem Rechner installiert.</div>`;
    }
  }

  function chipsHtml(t) {
    const groups = new Map();
    for (const p of t.plugins) {
      const k = pluginKey(p) + '|' + p.status + '|' + p.enabled + '|' + p.rack.join('>');
      if (!groups.has(k)) groups.set(k, { p, n: 0 });
      groups.get(k).n++;
    }
    return [...groups.values()].map(({ p, n }) => {
      const tip = {
        ok: 'Installiert',
        manual: 'Manuell als vorhanden markiert (Klick macht das rückgängig)',
        missing: 'Nicht installiert – Klick: „habe ich“ markieren',
        format: `Nur als ${p.installedAs} installiert – Ableton lädt nur das gleiche Format. Klick: „habe ich“ markieren`,
        m4l: 'Max-for-Live-Device – nicht automatisch prüfbar',
        unknown: 'Keine Plugin-Liste vorhanden',
      }[p.status];
      const cls = ['chip', p.status, p.enabled ? '' : 'off'].join(' ');
      return `<button class="${cls}" data-key="${esc(pluginKey(p))}" title="${esc(tip)}${p.enabled ? '' : ' · Device ist deaktiviert'}">
        ${esc(p.name)}${n > 1 ? ` ×${n}` : ''} <i>${p.format}</i>${p.rack.length ? ` <em>in ${esc(p.rack.join(' › '))}</em>` : ''}
      </button>`;
    }).join('');
  }

  function trackHtml(t) {
    const pills = {
      freeze: 'Freeze nötig', blocked: 'Nicht freezebar', frozen: 'Bereits gefroren',
      inactive: 'Nur deaktiviert', ok: 'Alles da',
    };
    const notes = {
      blocked: t.type === 'group'
        ? 'Gruppenspuren lassen sich nicht freezen. Plugin auf der Gruppe ersetzen oder die Gruppe nach dem Freeze der enthaltenen Spuren resamplen.'
        : 'Return- und Main-Spuren enthalten keine Clips und lassen sich nicht freezen. Plugin ersetzen oder die Spur resamplen.',
      frozen: 'Die Spur ist in der Session bereits gefroren – sie spielt auch ohne die fehlenden Plugins.',
      inactive: 'Die fehlenden Plugins sind deaktiviert und beeinflussen den Klang nicht.',
    };
    return `<div class="track ${t.verdict}">
      <div class="t-idx">${t.idx}</div>
      <div class="t-side">
        <span class="t-name" title="${esc(t.name)}">${esc(t.name)}</span>
        <span class="t-sub"><span>${TYPE_LABEL[t.type] || t.type}</span>${t.group ? `<span>in ${esc(t.group)}</span>` : ''}</span>
        ${pills[t.verdict] ? `<span class="pill">${pills[t.verdict]}</span>` : ''}
      </div>
      <div class="t-main">
        ${notes[t.verdict] ? `<div class="t-note">${notes[t.verdict]}</div>` : ''}
        <div class="chips">${chipsHtml(t)}</div>
      </div>
    </div>`;
  }

  function renderInv() {
    const el = $('inv');
    const n = state.inventory?.plugins.length;
    const status = state.scanning ? 'Scanne Plugins …'
      : n ? `<b>${n}</b> Plugins installiert` : 'Keine Plugin-Liste';
    el.innerHTML = `<span>${status}</span>
      ${api ? '<button class="btn ghost small" id="rescan">Neu scannen</button>' : ''}
      <button class="btn ghost small" id="addDir">Ordner hinzufügen</button>`;
    if (api) $('rescan').onclick = scan;
    $('addDir').onclick = addFolder;

    $('installedBox').hidden = !n;
    if (n) {
      $('installedSum').textContent = `Installierte Plugins (${n})`;
      $('installedList').innerHTML = state.inventory.plugins
        .map(p => `<div>${esc(p.name)} <i style="font-size:10px">${p.format}</i></div>`).join('');
    }
  }

  // ---------- Export ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function freezeText(res) {
    const name = state.list.session?.name || 'Session';
    const line = t => {
      const miss = t.plugins.filter(p => (p.status === 'missing' || p.status === 'format') && p.enabled);
      return `• ${t.name} (${TYPE_LABEL[t.type]}) — ${[...new Set(miss.map(p => p.name))].join(', ')}`;
    };
    const out = [`Freeze-Liste für „${name}“`, ''];
    if (res.freeze.length) {
      out.push('Diese Spuren bitte freezen, damit die Session ohne die fehlenden Plugins öffnet:');
      out.push(...res.freeze.map(line), '');
    }
    if (res.blocked.length) {
      out.push('Nicht freezebar (Plugin ersetzen oder Spur resamplen):');
      out.push(...res.blocked.map(line), '');
    }
    out.push('Fehlende Plugins: ' + res.missingPlugins.map(p => `${p.name} (${p.format})`).join(', '));
    return out.join('\n');
  }

  // ---------- Events ----------
  $('export').onclick = () => {
    const l = state.list;
    download(`${l.session?.name || 'session'}.pluginlist.json`, JSON.stringify(l, null, 2), 'application/json');
  };
  $('copy').onclick = async () => {
    const text = freezeText(state.lastResult);
    try { await navigator.clipboard.writeText(text); } catch { download('freeze-liste.txt', text, 'text/plain'); }
    $('copy').textContent = 'Kopiert ✓';
    setTimeout(() => { $('copy').textContent = 'Freeze-Liste kopieren'; }, 1500);
  };
  const pickWith = accept => () => { $('file').accept = accept; $('file').click(); };
  $('pickAls').onclick = pickWith('.als');
  $('pickJson').onclick = pickWith('.json');
  $('again').onclick = pickWith('.als,.json');
  $('file').onchange = e => { handleFile(e.target.files[0]); e.target.value = ''; };
  $('filter').onclick = e => {
    if (e.target.dataset.f) { state.filter = e.target.dataset.f; render(); }
  };
  $('tracks').onclick = e => {
    const chip = e.target.closest('.chip');
    if (!chip || chip.classList.contains('ok')) return;
    const k = chip.dataset.key;
    state.manual.has(k) ? state.manual.delete(k) : state.manual.add(k);
    store.set('pc.manual', [...state.manual]);
    render();
  };

  let depth = 0;
  const clearHot = () => document.querySelectorAll('.zone.hot').forEach(z => z.classList.remove('hot'));
  window.addEventListener('dragenter', e => { e.preventDefault(); depth++; if (state.list) document.body.classList.add('dragging-result'); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging-result'); clearHot(); } });
  window.addEventListener('dragover', e => {
    e.preventDefault();
    clearHot();
    const z = e.target.closest && e.target.closest('.zone');
    if (z) z.classList.add('hot');
  });
  window.addEventListener('drop', e => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging-result'); clearHot();
    handleFile(e.dataTransfer.files[0]);
  });

  // Test-Hook für die Browser-Vorschau.
  window.PC.handleFile = handleFile;

  render();
  if (api) scan();
})();
