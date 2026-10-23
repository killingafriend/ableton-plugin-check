// Vergleicht eine Plugin-Liste mit den lokal installierten Plugins und
// bestimmt, welche Spuren gefroren werden müssen.
(function () {
  const NOISE = new Set(['x64', 'x86', 'arm', 'arm64', 'universal', 'vst', 'vst3', 'au']);

  function tokens(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .split(/[^a-z0-9]+/)
      .filter(t => t && !NOISE.has(t));
  }

  // Gleich, oder das kürzere Token-Array ist ein Suffix des längeren
  // ("Pro-Q 3" passt auf "FabFilter Pro-Q 3", aber nicht auf "FabFilter Pro-Q 4").
  function tokenMatch(a, b) {
    if (!a.length || !b.length) return false;
    if (a.join('') === b.join('')) return true;
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    if (s.length < 2 && s.join('').length < 5) return false;
    const off = l.length - s.length;
    return s.every((t, i) => l[off + i] === t);
  }

  const key = p => `${p.format}|${tokens(p.name).join(' ')}`;

  function prepareInventory(inv) {
    if (!inv) return null;
    return inv.plugins.map(p => ({
      ...p,
      tokenSets: [p.name, ...(p.aliases || [])].map(tokens).filter(t => t.length),
    }));
  }

  function findInstalled(plugin, prepared, format) {
    const want = tokens(plugin.name);
    const withMfr = tokens(`${plugin.manufacturer} ${plugin.name}`);
    return prepared.find(i => i.format === format
      && i.tokenSets.some(ts => tokenMatch(want, ts) || (plugin.manufacturer && tokenMatch(withMfr, ts))));
  }

  // Status pro Plugin: ok | manual | format | missing | m4l | unknown
  function plugStatus(plugin, prepared, manual) {
    if (manual.has(key(plugin))) return { status: 'manual' };
    if (plugin.format === 'M4L') return { status: 'm4l' };
    if (!prepared) return { status: 'unknown' };
    if (findInstalled(plugin, prepared, plugin.format)) return { status: 'ok' };
    const other = prepared.find(i => i.format !== plugin.format && findInstalled(plugin, [i], i.format));
    if (other) return { status: 'format', installedAs: other.format };
    return { status: 'missing' };
  }

  const FREEZABLE = new Set(['audio', 'midi']);

  function analyze(list, inventory, manualKeys) {
    const prepared = prepareInventory(inventory);
    const manual = new Set(manualKeys || []);
    const missingMap = new Map();

    const tracks = list.tracks.map(t => {
      const plugins = t.plugins.map(p => ({ ...p, ...plugStatus(p, prepared, manual) }));
      const isMissing = p => p.status === 'missing' || p.status === 'format';
      const blocking = plugins.filter(p => isMissing(p) && p.enabled);
      const inactiveOnly = plugins.some(isMissing) && !blocking.length;

      let verdict = 'ok';
      if (!plugins.length) verdict = 'empty';
      else if (!prepared) verdict = 'unknown';
      else if (blocking.length && t.frozen) verdict = 'frozen';
      else if (blocking.length && FREEZABLE.has(t.type)) verdict = 'freeze';
      else if (blocking.length) verdict = 'blocked';
      else if (inactiveOnly) verdict = 'inactive';

      for (const p of plugins.filter(isMissing)) {
        const k = key(p);
        if (!missingMap.has(k)) missingMap.set(k, { key: k, name: p.name, format: p.format, installedAs: p.installedAs, tracks: [] });
        const entry = missingMap.get(k);
        if (!entry.tracks.includes(t.name)) entry.tracks.push(t.name);
      }
      return { ...t, plugins, verdict, missingCount: blocking.length };
    });

    return {
      tracks,
      hasInventory: !!prepared,
      freeze: tracks.filter(t => t.verdict === 'freeze'),
      blocked: tracks.filter(t => t.verdict === 'blocked'),
      missingPlugins: [...missingMap.values()],
    };
  }

  window.PC = window.PC || {};
  window.PC.analyze = analyze;
  window.PC.pluginKey = key;
  window.PC.tokens = tokens;
})();
