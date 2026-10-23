// Liest eine Ableton-Live-Session (.als = gzip-komprimiertes XML) und extrahiert
// pro Spur alle Third-Party-Plugins (VST2, VST3, AU) und Max-for-Live-Devices.
(function () {
  const PLUGIN_TAGS = 'PluginDevice, AuPluginDevice, MxDeviceAudioEffect, MxDeviceInstrument, MxDeviceMidiEffect';
  const RACK_LABELS = {
    InstrumentGroupDevice: 'Instrument Rack',
    AudioEffectGroupDevice: 'Audio Effect Rack',
    MidiEffectGroupDevice: 'MIDI Effect Rack',
    DrumGroupDevice: 'Drum Rack',
  };
  const TRACK_TYPES = {
    AudioTrack: 'audio',
    MidiTrack: 'midi',
    GroupTrack: 'group',
    ReturnTrack: 'return',
    MainTrack: 'main',
    MasterTrack: 'main', // ältere Live-Versionen
  };

  const childEl = (parent, tag) => {
    if (!parent) return null;
    for (const c of parent.children) if (c.tagName === tag) return c;
    return null;
  };
  const childVal = (parent, tag) => {
    const el = childEl(parent, tag);
    return el ? el.getAttribute('Value') : null;
  };

  async function readXmlText(file) {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Dieser Browser kann .als-Dateien nicht entpacken (DecompressionStream fehlt).');
      }
      return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }
    return file.text(); // unkomprimiertes XML
  }

  function basenameNoExt(p) {
    const base = decodeURIComponent(String(p)).split(/[\\/]/).pop() || '';
    return base.replace(/\.[a-z0-9]+$/i, '');
  }

  function rackPath(dev, track) {
    const path = [];
    for (let p = dev.parentElement; p && p !== track; p = p.parentElement) {
      const label = RACK_LABELS[p.tagName];
      if (label) path.unshift(childVal(p, 'UserName') || label);
    }
    return path;
  }

  function describeDevice(dev, track) {
    const enabled = childVal(childEl(dev, 'On'), 'Manual') !== 'false';
    const rack = rackPath(dev, track);

    if (dev.tagName === 'PluginDevice' || dev.tagName === 'AuPluginDevice') {
      const info = childEl(childEl(dev, 'PluginDesc'), 'VstPluginInfo')
        || childEl(childEl(dev, 'PluginDesc'), 'Vst3PluginInfo')
        || childEl(childEl(dev, 'PluginDesc'), 'AuPluginInfo');
      if (!info) return null;
      const kind = info.tagName;
      const format = kind === 'VstPluginInfo' ? 'VST2' : kind === 'Vst3PluginInfo' ? 'VST3' : 'AU';
      const name = (kind === 'VstPluginInfo' ? childVal(info, 'PlugName') : childVal(info, 'Name')) || '';
      if (!name) return null;
      return { name, format, manufacturer: childVal(info, 'Manufacturer') || '', enabled, rack };
    }

    // Max for Live
    let name = childVal(dev, 'UserName');
    if (!name) {
      for (const p of dev.querySelectorAll('Path, RelativePath, BrowserContentPath')) {
        const v = p.getAttribute('Value') || '';
        if (/\.(amxd|adv|adg)$/i.test(v)) { name = basenameNoExt(v); break; }
      }
    }
    return { name: name || 'Max for Live Device', format: 'M4L', manufacturer: '', enabled, rack };
  }

  function describeTrack(el, index) {
    const type = TRACK_TYPES[el.tagName];
    const nameEl = childEl(el, 'Name');
    const name = childVal(nameEl, 'EffectiveName') || childVal(nameEl, 'UserName') || `${type} ${index + 1}`;
    const plugins = [];
    for (const dev of el.querySelectorAll(PLUGIN_TAGS)) {
      const d = describeDevice(dev, el);
      if (d) plugins.push(d);
    }
    const groupId = childVal(el, 'TrackGroupId');
    return {
      id: el.getAttribute('Id') || '',
      name,
      type,
      groupId: groupId && groupId !== '-1' ? groupId : null,
      frozen: childVal(el, 'Freeze') === 'true',
      plugins,
    };
  }

  async function parseSession(file) {
    const text = await readXmlText(file);
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Die Datei ist kein gültiges Ableton-Live-Set.');
    const root = doc.documentElement;
    const liveSet = childEl(root, 'LiveSet');
    if (root.tagName !== 'Ableton' || !liveSet) throw new Error('Die Datei ist kein Ableton-Live-Set.');

    const trackEls = [];
    const tracksEl = childEl(liveSet, 'Tracks');
    if (tracksEl) for (const c of tracksEl.children) if (TRACK_TYPES[c.tagName]) trackEls.push(c);
    for (const tag of ['MainTrack', 'MasterTrack']) {
      const m = childEl(liveSet, tag);
      if (m) trackEls.push(m);
    }

    const tracks = trackEls.map(describeTrack);
    const groupNames = new Map(tracks.filter(t => t.type === 'group').map(t => [t.id, t.name]));
    for (const t of tracks) {
      t.group = t.groupId ? groupNames.get(t.groupId) || null : null;
      delete t.groupId;
    }

    return {
      format: 'ableton-plugin-list',
      version: 1,
      session: {
        name: file.name.replace(/\.als$/i, ''),
        liveVersion: root.getAttribute('Creator') || '',
        exportedAt: new Date().toISOString(),
      },
      tracks,
    };
  }

  function validateList(obj) {
    if (!obj || obj.format !== 'ableton-plugin-list' || !Array.isArray(obj.tracks)) {
      throw new Error('Die Datei ist keine Plugin-Liste dieser App.');
    }
    return obj;
  }

  window.PC = window.PC || {};
  window.PC.parseSession = parseSession;
  window.PC.validateList = validateList;
})();
