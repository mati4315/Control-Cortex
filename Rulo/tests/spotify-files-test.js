// Pruebas del estado en memoria de los JSON de Rulo/Spotify
// (Control Cortex/backend/file-store.js): lo importante es que una edicion hecha
// por fuera (a mano o con una IA) se vea sin reiniciar el backend y que un
// archivo roto o borrado no rompa nada.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileStore } = require('D:/plugins para mi OBS/Control Cortex/backend/file-store.js');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rulo-store-'));
const filePath = path.join(tempDir, 'spotify-vocabulary.json');
const warnings = [];
const normalize = raw => ({
  musicWords: Array.isArray(raw && raw.musicWords) ? raw.musicWords.map(String) : [],
  genres: Array.isArray(raw && raw.genres) ? raw.genres.length : 0
});
const store = createFileStore({
  filePath,
  normalize,
  fallback: { musicWords: ['tema'], genres: 0 },
  label: 'prueba',
  warn: message => warnings.push(message)
});
const write = value => fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  // ---------- A) primera carga ----------
  check('store: si el archivo no existe usa el respaldo', store.init().exists === false && store.value.musicWords[0] === 'tema', JSON.stringify(store.value));

  write({ musicWords: ['tema', 'temita'], genres: [{ id: 'cumbia' }] });
  check('store: lee el archivo existente', store.init().ok === true && store.value.musicWords.length === 2, JSON.stringify(store.value));
  check('store: el normalize limpia', store.value.genres === 1, store.value.genres);

  // ---------- B) sin cambios ----------
  check('store: sin cambios no relee', store.refresh() === null, 'releyó de más');

  // ---------- C) edicion externa (una IA tocando el JSON) ----------
  await wait(15);
  write({ musicWords: ['tema', 'temita', 'hitazo'], genres: [] });
  const externo = store.refresh();
  check('store: una edicion externa se detecta', !!externo && externo.musicWords.indexOf('hitazo') !== -1, JSON.stringify(store.value));
  check('store: el valor en memoria queda actualizado', store.value.musicWords.length === 3, JSON.stringify(store.value));
  check('store: la segunda consulta no relee', store.refresh() === null, 'releyó dos veces el mismo cambio');

  // ---------- D) guardado propio ----------
  store.markSynced({ musicWords: ['tema'], genres: 0 });
  check('store: el guardado propio no cuenta como cambio externo', store.refresh() === null, 'se confundió el guardado propio');
  const escrito = store.write({ musicWords: ['tema', 'propia'], genres: 0 });
  check('store: write guarda en disco', JSON.parse(fs.readFileSync(filePath, 'utf8')).musicWords.length === 2, 'no escribió');
  check('store: write deja el sello al dia', store.refresh() === null && escrito.musicWords.length === 2, 'el write disparó una relectura');

  // ---------- E) JSON a medio escribir ----------
  await wait(15);
  fs.writeFileSync(filePath, '{ "musicWords": [\n', 'utf8');
  const antes = store.value.musicWords.length;
  check('store: con JSON roto conserva lo que ya estaba', store.refresh() === null && store.value.musicWords.length === antes, JSON.stringify(store.value));
  check('store: con JSON roto avisa una sola vez', warnings.length === 1, warnings.join(' | '));
  store.refresh();
  check('store: no repite el aviso si el archivo sigue roto', warnings.length === 1, warnings.length);

  // ---------- F) se arregla el archivo ----------
  await wait(15);
  write({ musicWords: ['tema', 'arreglado'], genres: [] });
  check('store: cuando el archivo se corrige se relee', (store.refresh() || {}).musicWords.join(',') === 'tema,arreglado', JSON.stringify(store.value));

  // ---------- G) archivo borrado ----------
  await wait(15);
  fs.rmSync(filePath);
  check('store: si borran el archivo conserva lo cargado', store.refresh() === null && store.value.musicWords.length === 2, JSON.stringify(store.value));

  // ---------- H) valores basura ----------
  write({ musicWords: 'no soy lista', genres: 'tampoco' });
  await wait(15);
  const basura = store.refresh();
  check('store: el normalize aguanta valores basura', !!basura && basura.musicWords.length === 0 && basura.genres === 0, JSON.stringify(basura));

  fs.rmSync(tempDir, { recursive: true, force: true });

  const failed = results.filter(item => !item.ok);
  results.forEach(item => console.log(`${item.ok ? 'OK  ' : 'FALLA'}  ${item.name}${item.ok ? '' : ' -- ' + item.detail}`));
  console.log(`\n${results.length - failed.length}/${results.length} pruebas de los archivos de Spotify OK`);
  process.exit(failed.length ? 1 : 0);
})();
