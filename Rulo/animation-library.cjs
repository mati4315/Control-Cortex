// Biblioteca y preparación offline. Nunca se sobrescribe un video publicado.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const FAMILIES = ['Idle', 'Dormir', 'Mate', 'Reacciones', 'Baile', 'Hablar', 'Especiales'];
function binary(name) {
  if (process.env[name.toUpperCase() + '_BIN']) return process.env[name.toUpperCase() + '_BIN'];
  const local = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', name + '.exe');
  return process.platform === 'win32' && fs.existsSync(local) ? local : name;
}
const defaults = () => ({ version: 2, revision: 0,
  video: { width: 1920, height: 1080, fps: 30, codec: 'libvpx-vp9', crf: 28, preserveSource: false, audio: false, anchorX: 0.5, anchorY: 1 },
  behavior: { idleMinMinutes: 4, idleMaxMinutes: 6, recentCount: 3, queueLimit: 30 },
  fallback: '', animations: {} });
function number(value, min, max, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw Error(`${name}: debe estar entre ${min} y ${max}.`);
  return n;
}
function identifier(value, name = 'Nombre') {
  const s = String(value || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(s)) throw Error(`${name}: usa letras sin acentos, números y guiones; empieza con una letra.`);
  return s;
}
function metadata(data) {
  const id = identifier(data.id);
  if (!FAMILIES.includes(data.family)) throw Error('Familia desconocida.');
  const role = data.role || 'behavior';
  if (!['behavior', 'transition', 'entry', 'exit'].includes(role)) throw Error('Tipo de clip inválido.');
  const chroma = data.chroma || {};
  const color = chroma.color || '#00ff00';
  if (!/^#[a-f0-9]{6}$/i.test(color)) throw Error('Color de chroma inválido.');
  return { id, family: data.family, from: identifier(data.from, 'Pose inicial'), to: identifier(data.to, 'Pose final'),
    role, loop: data.loop === true, interruptible: data.interruptible === true, enabled: data.enabled !== false,
    weight: number(data.weight ?? 10, 0, 10000, 'Peso'), priority: number(data.priority ?? 1, 0, 100, 'Prioridad'),
    cooldown: number(data.cooldown ?? 0, 0, 86400, 'Cooldown'),
    chroma: { enabled: chroma.enabled === true, color, similarity: number(chroma.similarity ?? 0.18, 0.01, 1, 'Tolerancia chroma'), blend: number(chroma.blend ?? 0.06, 0, 1, 'Suavizado chroma') } };
}
async function probe(file) {
  const result = await run(binary('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  const data = JSON.parse(result.stdout), stream = data.streams?.find(s => s.codec_type === 'video');
  if (!stream) throw Error('El archivo no contiene video.');
  const duration = Number(data.format?.duration || stream.duration);
  const parts = String(stream.avg_frame_rate || stream.r_frame_rate).split('/').map(Number);
  const fps = parts[0] / (parts[1] || 1);
  if (!(duration > 0 && duration <= 300 && stream.width > 0 && stream.height > 0 && fps > 0)) throw Error('Duración, resolución o FPS inválidos (máximo 5 minutos).');
  return { duration, width: stream.width, height: stream.height, fps, codec: stream.codec_name, alpha: String(stream.tags?.alpha_mode) === '1' };
}
function createLibrary(root, changed = () => {}) {
  fs.mkdirSync(root, { recursive: true });
  const manifestPath = path.join(root, 'animations.json');
  const historyDir = path.join(root, '.history'), thumbnailsDir = path.join(root, 'thumbnails');
  fs.mkdirSync(historyDir, { recursive: true }); fs.mkdirSync(thumbnailsDir, { recursive: true });
  let manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : defaults();
  if (manifest.version !== 2) throw Error('Versión de biblioteca no compatible.');
  const jobs = new Map(); const pending = []; let working = false;
  for (const family of FAMILIES) fs.mkdirSync(path.join(root, family), { recursive: true });
  fs.mkdirSync(path.join(root, 'source'), { recursive: true });
  fs.mkdirSync(path.join(root, '.temp'), { recursive: true });
  function save(next) {
    if (fs.existsSync(manifestPath)) {
      const id = `${Date.now()}-${crypto.randomUUID()}`;
      fs.writeFileSync(path.join(historyDir, `${id}.json`), JSON.stringify({ id, savedAt: Date.now(), manifest }, null, 2), { flag: 'wx' });
      const old = fs.readdirSync(historyDir).filter(name => name.endsWith('.json')).sort().reverse().slice(40);
      for (const name of old) try { fs.unlinkSync(path.join(historyDir, name)); } catch (_) {}
    }
    next.revision = manifest.revision + 1;
    const temp = manifestPath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(next, null, 2)); fs.renameSync(temp, manifestPath);
    manifest = next; changed(read()); return read();
  }
  function read() { return structuredClone(manifest); }
  if (!fs.existsSync(manifestPath)) save(manifest);
  function url(file) { return '/rulo-animaciones/' + file.split('/').map(encodeURIComponent).join('/'); }
  function publicManifest() {
    const m = read();
    for (const a of Object.values(m.animations)) { a.url = url(a.file); if (a.thumbnail) a.thumbnailUrl = url(a.thumbnail); }
    return { ...m, families: FAMILIES };
  }
  function safeSource(relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative)) throw Error('Ruta inválida.');
    const candidate = path.resolve(root, relative);
    const real = fs.realpathSync(candidate), base = fs.realpathSync(root) + path.sep;
    if (!real.toLowerCase().startsWith(base.toLowerCase()) || !/\.(mp4|webm)$/i.test(real)) throw Error('El video debe estar dentro de animaciones.');
    return real;
  }
  function candidates() {
    const result = [];
    function visit(dir, prefix = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || ['source', 'node_modules'].includes(entry.name) || entry.isSymbolicLink()) continue;
        const relative = prefix + entry.name;
        if (entry.isDirectory()) visit(path.join(dir, entry.name), relative + '/');
        else if (/\.mp4$/i.test(entry.name)) result.push({ file: relative, bytes: fs.statSync(path.join(dir, entry.name)).size });
      }
    }
    visit(root); return result;
  }
  function originals() {
    const result = [], dir = path.join(root, 'source');
    if (!fs.existsSync(dir)) return result;
    function visit(folder, prefix = '') { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue; const relative = prefix + entry.name; if (entry.isDirectory()) visit(path.join(folder, entry.name), relative + '/'); else if (/\.mp4$/i.test(entry.name)) result.push({ file: `source/${relative}`, bytes: fs.statSync(path.join(folder, entry.name)).size }); } }
    visit(dir); return result;
  }
  async function generateMissingThumbnails() {
    const next = read(); let generated = 0; const warnings = [];
    for (const animation of Object.values(next.animations)) {
      if (animation.thumbnail && fs.existsSync(path.resolve(root, ...animation.thumbnail.split('/')))) continue;
      const source = path.resolve(root, ...String(animation.file || '').split('/')), base = path.resolve(root) + path.sep;
      if (!animation.file || !source.toLowerCase().startsWith(base.toLowerCase()) || !fs.existsSync(source)) { warnings.push(`Falta el WebM de ${animation.id}.`); continue; }
      const name = path.basename(animation.file).replace(/\.webm$/i, '') + '.png', destination = path.join(thumbnailsDir, name);
      try { await run(binary('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(Math.min(.15, Number(animation.media?.duration || 1) / 2)), '-i', source, '-frames:v', '1', '-vf', 'scale=240:-2:flags=lanczos', '-an', '-f', 'image2', destination], { windowsHide: true, timeout: 60000 }); animation.thumbnail = `thumbnails/${name}`; generated++; }
      catch (_) { warnings.push(`No se pudo crear miniatura para ${animation.id}.`); }
    }
    if (generated) save(next);
    return { generated, warnings, manifest: publicManifest() };
  }
  function backups() {
    return fs.readdirSync(historyDir).filter(name => name.endsWith('.json')).map(name => {
      try { const item = JSON.parse(fs.readFileSync(path.join(historyDir, name), 'utf8')); return { id: item.id, savedAt: item.savedAt, revision: item.manifest?.revision || 0, animations: Object.keys(item.manifest?.animations || {}).length }; }
      catch (_) { return null; }
    }).filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
  }
  function restoreBackup(id) {
    if (!/^\d+-[a-f0-9-]{36}$/i.test(String(id))) throw Error('Identificador de copia inválido.');
    const file = path.join(historyDir, `${id}.json`); if (!fs.existsSync(file)) throw Error('La copia ya no está disponible.');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')).manifest;
    if (!saved || saved.version !== 2 || !saved.animations || typeof saved.animations !== 'object') throw Error('La copia está dañada o no es compatible.');
    for (const animation of Object.values(saved.animations)) {
      const target = path.resolve(root, ...String(animation.file || '').split('/')), base = path.resolve(root) + path.sep;
      if (!animation.file || !target.toLowerCase().startsWith(base.toLowerCase()) || !fs.existsSync(target)) throw Error(`No se puede restaurar: falta el video de ${animation.id}.`);
    }
    return save(saved);
  }
  function preflight() {
    const m = read(), issues = [], animations = Object.values(m.animations), fallback = m.animations[m.fallback];
    if (!fallback || !fallback.enabled || fallback.family !== 'Idle' || fallback.from !== fallback.to) issues.push({ level: 'error', message: 'El Idle seguro no existe o no es válido.' });
    const basePose = fallback?.to || '';
    for (const animation of animations) {
      const target = path.resolve(root, ...String(animation.file || '').split('/')), base = path.resolve(root) + path.sep;
      if (!animation.file || !target.toLowerCase().startsWith(base.toLowerCase()) || !fs.existsSync(target)) issues.push({ level: 'error', animationId: animation.id, message: `Falta el archivo de video de ${animation.id}.` });
      if (!animation.enabled) continue;
      if (!animation.from || !animation.to) issues.push({ level: 'error', animationId: animation.id, message: `${animation.id} no tiene poses inicial y final.` });
      if (animation.role === 'behavior' && basePose && routeTo(basePose, animation.from, animations) === null) issues.push({ level: 'warning', animationId: animation.id, message: `No hay transición desde ${basePose} hasta la pose inicial ${animation.from} de ${animation.id}.` });
      if (animation.role === 'behavior' && basePose && routeTo(animation.to, basePose, animations) === null && animation.to !== basePose) issues.push({ level: 'warning', animationId: animation.id, message: `No hay retorno desde ${animation.to} al Idle seguro ${basePose} después de ${animation.id}.` });
      if (['entry', 'exit', 'transition'].includes(animation.role) && animation.from === animation.to) issues.push({ level: 'warning', animationId: animation.id, message: `${animation.id} figura como transición, pero sus dos poses son iguales.` });
      if (animation.source && !fs.existsSync(path.resolve(root, ...String(animation.source).split('/')))) issues.push({ level: 'info', animationId: animation.id, message: `No se encuentra el original MP4 de ${animation.id}; el WebM publicado sigue disponible.` });
    }
    return { ok: !issues.some(issue => issue.level === 'error'), checked: animations.length, issues };
  }
  function routeTo(from, to, items = Object.values(read().animations)) {
    if (from === to) return [];
    const edges = items.filter(a => a.enabled && ['entry', 'exit', 'transition'].includes(a.role) && a.from !== a.to);
    const queue = [{ pose: from, path: [] }], seen = new Set([from]);
    while (queue.length) { const node = queue.shift(); for (const edge of edges.filter(a => a.from === node.pose).sort((a, b) => b.priority - a.priority)) { if (edge.to === to) return [...node.path, edge.id]; if (!seen.has(edge.to)) { seen.add(edge.to); queue.push({ pose: edge.to, path: [...node.path, edge.id] }); } } }
    return null;
  }
  function edit(id, data) {
    const old = manifest.animations[id]; if (!old) throw Error('Animación inexistente.');
    const next = metadata({ ...old, ...data, id });
    if (next.family !== old.family) throw Error('Para cambiar de carpeta, vuelve a importar el original con otra familia.');
    if (JSON.stringify(next.chroma) !== JSON.stringify(old.chroma)) throw Error('El chroma requiere volver a procesar el original.');
    if (id === manifest.fallback && !next.enabled) throw Error('El Idle seguro no se puede deshabilitar. Elige otro fallback primero.');
    const m = read(); m.animations[id] = { ...old, ...next }; return save(m);
  }
  function remove(id) {
    const old = manifest.animations[id];
    if (!old) throw Error('Animación inexistente.');
    if (id === manifest.fallback) throw Error('No puedes eliminar el Idle seguro. Elige otro clip de respaldo primero.');
    const m = read(); delete m.animations[id];
    const stillUsed = Object.values(m.animations).some(a => a.file === old.file);
    let trashedFile = '';
    const trash = path.join(root, '.trash'); fs.mkdirSync(trash, { recursive: true });
    const trashId = crypto.randomUUID();
    if (!stillUsed && old.file) {
      const target = path.resolve(root, ...String(old.file).split('/'));
      const base = path.resolve(root) + path.sep;
      if (!target.toLowerCase().startsWith(base.toLowerCase())) throw Error('Ruta de video inválida; no se movió ningún archivo.');
      if (fs.existsSync(target)) {
        if (!fs.lstatSync(target).isFile()) throw Error('El WebM no es un archivo normal; no se movió.');
        trashedFile = path.join(trash, `${trashId}.webm`);
        fs.renameSync(target, trashedFile);
      }
    }
    const recordPath = path.join(trash, `${trashId}.json`);
    try {
      fs.writeFileSync(recordPath, JSON.stringify({ id: trashId, deletedAt: Date.now(), animation: old,
        trashedFile: trashedFile ? path.relative(root, trashedFile).split(path.sep).join('/') : '' }, null, 2), { flag: 'wx' });
      const manifest = save(m);
      return { manifest, trashedFile: trashedFile ? path.relative(root, trashedFile).split(path.sep).join('/') : '', trashId };
    } catch (error) {
      try { fs.unlinkSync(recordPath); } catch (_) {}
      if (trashedFile && fs.existsSync(trashedFile)) {
        fs.mkdirSync(path.dirname(path.resolve(root, old.file)), { recursive: true });
        fs.renameSync(trashedFile, path.resolve(root, old.file));
      }
      throw error;
    }
  }
  function trashList() {
    const dir = path.join(root, '.trash'); if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
        const video = record.trashedFile ? path.resolve(root, ...record.trashedFile.split('/')) : path.resolve(root, ...String(record.animation?.file || '').split('/'));
        const base = path.resolve(root) + path.sep;
        if (!video.toLowerCase().startsWith(base.toLowerCase())) return null;
        return { id: record.id, animationId: record.animation?.id || '', family: record.animation?.family || '', file: record.animation?.file || '', deletedAt: record.deletedAt || 0, canRestore: fs.existsSync(video), hasOriginal: !!record.animation?.source };
      } catch (_) { return null; }
    }).filter(Boolean).sort((a, b) => b.deletedAt - a.deletedAt);
  }
  function restore(trashId) {
    if (!/^[a-f0-9-]{36}$/i.test(String(trashId))) throw Error('Identificador de papelera inválido.');
    const trash = path.join(root, '.trash'), recordPath = path.join(trash, `${trashId}.json`);
    if (!fs.existsSync(recordPath)) throw Error('El clip ya no está en la papelera.');
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')), animation = record.animation;
    if (!animation?.id || !animation.file || manifest.animations[animation.id]) throw Error('Ya existe un clip con ese identificador; cambia su nombre antes de restaurarlo.');
    const destination = path.resolve(root, ...String(animation.file).split('/')), base = path.resolve(root) + path.sep;
    if (!destination.toLowerCase().startsWith(base.toLowerCase())) throw Error('La ruta original no es válida.');
    const source = record.trashedFile ? path.resolve(root, ...record.trashedFile.split('/')) : destination;
    if (!source.toLowerCase().startsWith(base.toLowerCase()) || !fs.existsSync(source)) throw Error('No se encuentra el WebM que se debe restaurar.');
    if (source !== destination && fs.existsSync(destination)) throw Error('Ya existe un archivo en la ruta original; no se sobrescribió.');
    if (source !== destination) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.renameSync(source, destination); }
    try {
      const next = read(); next.animations[animation.id] = animation;
      const manifest = save(next); try { fs.unlinkSync(recordPath); } catch (_) {}
      return { manifest, animationId: animation.id };
    } catch (error) {
      if (source !== destination && fs.existsSync(destination)) fs.renameSync(destination, source);
      throw error;
    }
  }
  function configure(data) {
    const m = read();
    if (data.video) {
      const v = { ...m.video, ...data.video };
      v.width = number(v.width, 64, 3840, 'Ancho'); v.height = number(v.height, 64, 2160, 'Alto');
      if (v.width % 2 || v.height % 2) throw Error('La resolución debe ser par.');
      v.fps = number(v.fps, 1, 60, 'FPS'); v.crf = number(v.crf, 0, 63, 'CRF');
      v.preserveSource = v.preserveSource === true;
      v.anchorX = number(v.anchorX, 0, 1, 'Anclaje X'); v.anchorY = number(v.anchorY, 0, 1, 'Anclaje Y');
      v.codec = 'libvpx-vp9'; v.audio = v.audio === true; m.video = v;
    }
    if (data.behavior) {
      const b = { ...m.behavior, ...data.behavior };
      b.idleMinMinutes = number(b.idleMinMinutes, 0.1, 1440, 'Inactividad mínima');
      b.idleMaxMinutes = number(b.idleMaxMinutes, b.idleMinMinutes, 1440, 'Inactividad máxima');
      b.recentCount = Math.floor(number(b.recentCount, 0, 10, 'Historial reciente'));
      b.queueLimit = Math.floor(number(b.queueLimit, 1, 100, 'Límite de cola')); m.behavior = b;
    }
    if (data.fallback !== undefined) {
      const a = m.animations[data.fallback];
      if (!a || !a.enabled || a.family !== 'Idle' || a.from !== a.to) throw Error('El respaldo debe ser un Idle habilitado con la misma pose inicial y final.');
      m.fallback = data.fallback;
    }
    return save(m);
  }
  function enqueue(data, input) {
    const meta = metadata(data);
    if (manifest.animations[meta.id] && !data.replace) throw Error('Nombre duplicado: activa «Actualizar existente».');
    if ([...jobs.values()].some(j => ['queued', 'processing'].includes(j.status) && j.animationId === meta.id)) throw Error('Ese nombre ya se está procesando.');
    if (pending.length >= 10) throw Error('La cola de importación está llena.');
    const ext = String(input.extension || path.extname(input.path || '')).toLowerCase();
    if (!['.mp4', '.webm'].includes(ext)) throw Error('Elige un MP4 o WebM.');
    const jobId = crypto.randomUUID();
    const originalDir = path.join(root, 'source', meta.family); fs.mkdirSync(originalDir, { recursive: true });
    const sourceRelative = `source/${meta.family}/${meta.id}--${jobId}${ext}`;
    const original = path.join(root, sourceRelative);
    const bytes = input.buffer ? input.buffer.length : fs.statSync(input.path).size;
    if (bytes < 12 || bytes > 250 * 1024 * 1024) throw Error('Tamaño inválido (máximo 250 MB).');
    if (input.buffer) fs.writeFileSync(original, input.buffer, { flag: 'wx' });
    else fs.copyFileSync(input.path, original, fs.constants.COPYFILE_EXCL);
    const job = { id: jobId, animationId: meta.id, status: 'queued', progress: 0, createdAt: Date.now(), source: sourceRelative };
    jobs.set(jobId, job); pending.push({ job, meta, original, video: structuredClone(manifest.video), sourceRelative });
    while (jobs.size > 40) { const finished = [...jobs].find(([, j]) => ['done', 'error'].includes(j.status)); if (!finished) break; jobs.delete(finished[0]); }
    setImmediate(drain); return structuredClone(job);
  }
  async function drain() {
    if (working || !pending.length) return;
    working = true; const { job, meta, original, video, sourceRelative } = pending.shift();
    const output = path.join(root, '.temp', job.id + '.webm');
    try {
      job.status = 'processing'; job.stage = 'Validando original'; const info = await probe(original); job.warnings = [];
      if (info.fps < 20 || info.fps > 60) job.warnings.push(`FPS inusual: ${info.fps.toFixed(2)}; revisa que el movimiento se vea fluido.`);
      if (info.width % 2 || info.height % 2) job.warnings.push('La resolución original tiene un lado impar; la conversión puede requerir ajustar un píxel.');
      if (info.duration > 60) job.warnings.push('El clip dura más de un minuto; confirma que no sea un video demasiado largo para una animación.');
      if (!meta.chroma.enabled && !info.alpha) job.warnings.push('El original no declara canal alfa y Chroma está apagado; el fondo se conservará opaco.');
      if (meta.chroma.enabled && info.alpha) job.warnings.push('El original ya declara canal alfa; revisa que Chroma no quite píxeles del personaje.');
      const outputVideo = video.preserveSource ? { ...video, width: info.width, height: info.height, fps: info.fps } : video;
      if (outputVideo.width % 2 || outputVideo.height % 2) throw Error('No se puede conservar exactamente una resolución impar con el formato de transparencia actual. Desactiva «Conservar resolución y FPS originales» o prepara el video con ancho y alto pares.');
      const filters = [];
      if (meta.chroma.enabled) filters.push(`chromakey=0x${meta.chroma.color.slice(1)}:${meta.chroma.similarity}:${meta.chroma.blend}`);
      filters.push('format=yuva420p', `fps=${outputVideo.fps}`, `scale=${outputVideo.width}:${outputVideo.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        `pad=${outputVideo.width}:${outputVideo.height}:(ow-iw)*${outputVideo.anchorX}:(oh-ih)*${outputVideo.anchorY}:color=black@0`, 'setsar=1');
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
      if (['vp8', 'vp9'].includes(info.codec)) args.push('-c:v', info.codec === 'vp9' ? 'libvpx-vp9' : 'libvpx');
      args.push('-i', original, '-map', '0:v:0', '-vf', filters.join(','), '-c:v', outputVideo.codec, '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', String(outputVideo.crf), '-lossless', outputVideo.crf === 0 ? '1' : '0', '-cpu-used', '4', '-row-mt', '1', '-threads', '2', '-g', String(Math.round(outputVideo.fps * 2)));
      args.push(...(outputVideo.audio ? ['-map', '0:a?', '-c:a', 'libopus'] : ['-an']));
      args.push('-progress', 'pipe:1', '-nostats', output); job.stage = 'Convirtiendo a VP9';
      await new Promise((resolve, reject) => {
        const child = spawn(binary('ffmpeg'), args, { windowsHide: true }); let errorText = '', progressBuffer = '';
        const timeout = setTimeout(() => { child.kill(); reject(Error('FFmpeg superó los 30 minutos.')); }, 1800000);
        child.stdout.on('data', chunk => {
          progressBuffer += chunk.toString(); const lines = progressBuffer.split('\n'); progressBuffer = lines.pop();
          for (const line of lines) if (line.startsWith('out_time_us=')) job.progress = Math.min(99, Math.round(Number(line.split('=')[1]) / (info.duration * 1000000) * 100));
        });
        child.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-8000); });
        child.on('error', e => { clearTimeout(timeout); reject(e); });
        child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error(errorText || 'FFmpeg no pudo convertir el video.')); });
      });
      job.stage = 'Validando WebM'; const out = await probe(output);
      if (out.codec !== 'vp9' || out.width !== outputVideo.width || out.height !== outputVideo.height || Math.abs(out.fps - outputVideo.fps) > 0.1 || Math.abs(out.duration - info.duration) > 0.5 || (meta.chroma.enabled && !out.alpha)) throw Error('El WebM no cumple la normalización solicitada.');
      const hash = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex').slice(0, 16);
      const relative = `${meta.family}/${meta.id}--${hash}.webm`;
      const target = path.join(root, relative);
      if (fs.existsSync(target)) fs.unlinkSync(output); else fs.renameSync(output, target);
      let thumbnail = '';
      try {
        const name = `${meta.id}--${hash}.png`, thumb = path.join(thumbnailsDir, name);
        if (!fs.existsSync(thumb)) await run(binary('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(Math.min(0.15, out.duration / 2)), '-i', target, '-frames:v', '1', '-vf', 'scale=240:-2:flags=lanczos', '-an', '-f', 'image2', thumb], { windowsHide: true, timeout: 60000 });
        if (fs.existsSync(thumb)) thumbnail = `thumbnails/${name}`;
      } catch (_) { job.warnings.push('No se pudo crear la miniatura; el video se importó correctamente.'); }
      const m = read(); m.animations[meta.id] = { ...meta, file: relative, thumbnail, source: sourceRelative, media: out, video: outputVideo, updatedAt: Date.now() };
      if (!m.fallback && meta.family === 'Idle' && meta.from === meta.to) m.fallback = meta.id;
      save(m); job.status = 'done'; job.progress = 100; job.stage = 'Disponible'; job.file = relative;
    } catch (e) { job.status = 'error'; job.error = e.message; try { fs.unlinkSync(output); } catch (_) {} }
    finally { job.finishedAt = Date.now(); working = false; setImmediate(drain); }
  }
  return { read, publicManifest, edit, remove, trashList, restore, backups, restoreBackup, preflight, generateMissingThumbnails, configure, candidates, originals, safeSource, enqueue, jobs: () => [...jobs.values()].map(j => ({ ...j })), job: id => jobs.get(id), root };
}
module.exports = { createLibrary, metadata, defaults, FAMILIES, probe, binary };
