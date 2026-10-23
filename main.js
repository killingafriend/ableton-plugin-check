const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const EXT_FORMAT = { '.vst': 'VST2', '.vst3': 'VST3', '.component': 'AU' };

function defaultDirs() {
  if (process.platform === 'darwin') {
    const roots = ['/Library/Audio/Plug-Ins', path.join(os.homedir(), 'Library/Audio/Plug-Ins')];
    return roots.flatMap(r => ['VST', 'VST3', 'Components'].map(d => path.join(r, d)));
  }
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return [
      path.join(pf, 'Common Files', 'VST3'),
      path.join(pf, 'VSTPlugins'),
      path.join(pf, 'Steinberg', 'VSTPlugins'),
      path.join(pf, 'Common Files', 'VST2'),
      path.join(pf86, 'VSTPlugins'),
      path.join(pf86, 'Steinberg', 'VSTPlugins'),
    ];
  }
  return [];
}

function plutilJson(file) {
  return new Promise(resolve => {
    execFile('plutil', ['-convert', 'json', '-o', '-', file], { maxBuffer: 8 << 20 }, (err, out) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

// Zusätzliche Namen, unter denen Ableton das Plugin führen könnte.
async function bundleAliases(bundle, format) {
  const aliases = new Set();
  const plist = await plutilJson(path.join(bundle, 'Contents', 'Info.plist'));
  if (plist) {
    for (const k of ['CFBundleName', 'CFBundleDisplayName']) if (plist[k]) aliases.add(plist[k]);
    for (const c of plist.AudioComponents || []) {
      if (!c.name) continue;
      aliases.add(c.name); // "Hersteller: Name"
      const i = c.name.indexOf(':');
      if (i > 0) aliases.add(c.name.slice(i + 1).trim());
    }
  }
  if (format === 'VST3') {
    try {
      const info = JSON.parse(await fs.promises.readFile(path.join(bundle, 'Contents', 'moduleinfo.json'), 'utf8'));
      if (info.Name) aliases.add(info.Name);
      for (const c of info.Classes || []) if (c.Name) aliases.add(c.Name);
    } catch { /* nicht jedes VST3 hat moduleinfo.json */ }
  }
  return [...aliases];
}

async function walk(dir, depth, found) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const ext = path.extname(e.name).toLowerCase();
    if (EXT_FORMAT[ext]) {
      found.push({ full, ext, name: path.basename(e.name, path.extname(e.name)) });
    } else if (process.platform === 'win32' && ext === '.dll') {
      found.push({ full, ext: '.vst', name: path.basename(e.name, '.dll') });
    } else if (e.isDirectory() && depth < 3) {
      await walk(full, depth + 1, found);
    }
  }
}

async function scanPlugins(extraDirs = []) {
  const found = [];
  for (const d of [...defaultDirs(), ...extraDirs]) await walk(d, 0, found);

  const plugins = [];
  const queue = [...found];
  const worker = async () => {
    for (let item; (item = queue.shift());) {
      const format = EXT_FORMAT[item.ext];
      const isBundle = process.platform === 'darwin';
      const aliases = isBundle ? await bundleAliases(item.full, format) : [];
      plugins.push({ name: item.name, format, aliases, path: item.full });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return { scannedAt: new Date().toISOString(), plugins };
}

ipcMain.handle('plugins:scan', (_e, extraDirs) => scanPlugins(extraDirs));
// Ordner (z. B. ein Ableton-Projektordner) werden akzeptiert: es wird das neueste .als darin genommen.
async function findSessions(dir) {
  const found = [];
  const scan = async (d, depth) => {
    let entries;
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.name.startsWith('.')) continue;
      if (e.isFile() && /\.als$/i.test(e.name)) found.push({ full, mtime: (await fs.promises.stat(full)).mtimeMs });
      else if (e.isDirectory() && depth < 1 && e.name !== 'Backup') await scan(full, depth + 1);
    }
  };
  await scan(dir, 0);
  return found.sort((a, b) => b.mtime - a.mtime).map(f => f.full);
}

ipcMain.handle('file:read', async (_e, p) => {
  let target = p;
  if ((await fs.promises.stat(p)).isDirectory()) {
    const [newest] = await findSessions(p);
    if (!newest) throw new Error('In diesem Ordner liegt kein Ableton-Set (.als).');
    target = newest;
  }
  return { name: path.basename(target), bytes: await fs.promises.readFile(target) };
});
ipcMain.handle('plugins:pickFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Plugin-Ordner hinzufügen' });
  return r.canceled ? null : r.filePaths[0];
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#141416',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  // Dateien, die ins Fenster gezogen werden, nie als Navigation öffnen.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
