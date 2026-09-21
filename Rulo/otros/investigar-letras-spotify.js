/**
 * INVESTIGACIÓN (no es parte del bot): mira qué guarda el cliente de Spotify en Windows.
 *
 * Uso:
 *   node "Rulo/otros/investigar-letras-spotify.js"            -> lista las letras cacheadas
 *   node "Rulo/otros/investigar-letras-spotify.js" --mapa     -> además mide claves y cuerpos
 *   node "Rulo/otros/investigar-letras-spotify.js" --foto antes   -> guarda una foto del estado
 *   node "Rulo/otros/investigar-letras-spotify.js" --foto despues -> compara con la foto "antes"
 *
 * Sólo LEE archivos propios del usuario. No descifra nada, no toca el audio y no
 * modifica la instalación de Spotify.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PAQUETES = path.join(process.env.LOCALAPPDATA || '', 'Packages');
const CLASICO = path.join(process.env.LOCALAPPDATA || '', 'Spotify');
const FOTO = path.join(__dirname, 'letras-spotify-foto.json');

function carpetaDelCliente() {
  // 1) version de la Microsoft Store   2) instalador clasico (por si algun dia cambia)
  try {
    const paquetes = fs.readdirSync(PAQUETES).filter(nombre => /^SpotifyAB\.SpotifyMusic_/.test(nombre));
    for (const paquete of paquetes) {
      const base = path.join(PAQUETES, paquete);
      for (const sub of ['LocalCache/Spotify', 'LocalState/Spotify']) {
        const candidato = path.join(base, sub);
        if (fs.existsSync(candidato)) return { tipo: 'Microsoft Store', paquete, base: candidato };
      }
    }
  } catch (_) { /* sin permisos o no existe */ }
  if (fs.existsSync(CLASICO)) return { tipo: 'instalador clasico', paquete: '', base: CLASICO };
  return null;
}

function descomprimir(buffer) {
  const intentos = [
    ['brotli', () => zlib.brotliDecompressSync(buffer)],
    ['gzip', () => zlib.gunzipSync(buffer)],
    ['deflate', () => zlib.inflateSync(buffer)],
    ['deflate-raw', () => zlib.inflateRawSync(buffer)]
  ];
  for (const [nombre, fn] of intentos) {
    try {
      const salida = fn(buffer);
      if (salida && salida.length > 20) return { nombre, salida };
    } catch (_) { /* no era ese formato */ }
  }
  return null;
}

function buscarLetras(cliente) {
  const cache = path.join(cliente.base, 'Browser', 'Cache', 'Cache_Data');
  const resultado = { carpeta: cache, existe: fs.existsSync(cache), claves: [], letras: [] };
  if (!resultado.existe) return resultado;

  for (const nombre of fs.readdirSync(cache)) {
    if (!/^data_/.test(nombre)) continue;
    const ruta = path.join(cache, nombre);
    let buffer = null;
    try { buffer = fs.readFileSync(ruta); } catch (_) { continue; }
    const texto = buffer.toString('latin1');

    // claves: la URL de la petición, que trae el Track ID
    const rxClave = /color-lyrics\/v2\/track\/([0-9A-Za-z]{22})/g;
    let coincidencia;
    while ((coincidencia = rxClave.exec(texto)) !== null) {
      const cola = texto.slice(coincidencia.index + coincidencia[0].length, coincidencia.index + coincidencia[0].length + 8);
      if (cola.indexOf('/image/') !== -1) continue;   // la portada, no la letra
      resultado.claves.push({ archivo: nombre, offset: coincidencia.index, trackId: coincidencia[1] });
    }

    // cuerpos: gzip embebidos cuyo contenido es el JSON de letras
    for (let i = 0; i < buffer.length - 3; i += 1) {
      if (buffer[i] !== 0x1f || buffer[i + 1] !== 0x8b || buffer[i + 2] !== 0x08) continue;
      let salida = null;
      for (let corte = Math.min(4 * 1024 * 1024, buffer.length - i); corte > 64; corte -= 32) {
        try { salida = zlib.gunzipSync(buffer.subarray(i, i + corte)).toString('utf8'); break; } catch (_) { /* sigue */ }
      }
      if (!salida || salida.indexOf('"syncType"') === -1) continue;
      let json = null;
      try { json = JSON.parse(salida); } catch (_) { continue; }
      if (!json.lyrics || !Array.isArray(json.lyrics.lines)) continue;
      const lineas = json.lyrics.lines;
      resultado.letras.push({
        archivo: nombre,
        offset: i,
        bytes: salida.length,
        syncType: json.lyrics.syncType,
        proveedor: json.lyrics.providerDisplayName,
        idioma: json.lyrics.language,
        lineas: lineas.length,
        primera: (lineas[0] || {}).words,
        primerMs: (lineas[0] || {}).startTimeMs,
        ultimoMs: (lineas[lineas.length - 1] || {}).startTimeMs
      });
    }
  }
  return resultado;
}

// Foto del estado de las carpetas relevantes (para el experimento paso a paso).
function tomarFoto(cliente) {
  const objetivo = {};
  const revisar = (dir, prefijo) => {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const item of items) {
      const completo = path.join(dir, item.name);
      if (item.isDirectory()) { revisar(completo, prefijo + '/' + item.name); continue; }
      try {
        const info = fs.statSync(completo);
        objetivo[prefijo + '/' + item.name] = { bytes: info.size, mtime: info.mtimeMs };
      } catch (_) { /* archivo bloqueado */ }
    }
  };
  for (const sub of ['Browser/Cache', 'Browser/IndexedDB', 'Browser/Local Storage', `${''}Storage`, 'Users']) {
    const dir = path.join(cliente.base, sub);
    if (fs.existsSync(dir)) revisar(dir, sub);
  }
  for (const dir of [path.join(cliente.base, 'Browser', 'Code Cache'), path.join(cliente.base, 'Browser', 'Service Worker')]) {
    if (fs.existsSync(dir)) revisar(dir, path.relative(cliente.base, dir).replace(/\\/g, '/'));
  }
  return objetivo;
}

function compararFoto(antes, despues) {
  const nuevos = [], cambiados = [], borrados = [];
  for (const [ruta, datos] of Object.entries(despues)) {
    const previo = antes[ruta];
    if (!previo) nuevos.push([ruta, datos.bytes]);
    else if (previo.bytes !== datos.bytes || Math.abs(previo.mtime - datos.mtime) > 1000) cambiados.push([ruta, previo.bytes, datos.bytes]);
  }
  for (const ruta of Object.keys(antes)) if (!despues[ruta]) borrados.push(ruta);
  return { nuevos, cambiados, borrados };
}

(function principal() {
  const argumentos = process.argv.slice(2);
  const cliente = carpetaDelCliente();
  if (!cliente) {
    console.log('No encontre ninguna instalacion de Spotify en este usuario.');
    return;
  }
  console.log('Cliente detectado: ' + cliente.tipo + (cliente.paquete ? ' (' + cliente.paquete + ')' : ''));
  console.log('Carpeta de datos: ' + cliente.base);
  console.log('');

  if (argumentos[0] === '--foto') {
    const cuando = argumentos[1] === 'despues' ? 'despues' : 'antes';
    const foto = tomarFoto(cliente);
    if (cuando === 'antes') {
      fs.writeFileSync(FOTO, JSON.stringify(foto), 'utf8');
      console.log('Foto "antes" guardada: ' + Object.keys(foto).length + ' archivos en ' + FOTO);
      console.log('Ahora hace el experimento y despues corre: --foto despues');
      return;
    }
    if (!fs.existsSync(FOTO)) { console.log('Falta la foto "antes". Corre primero: --foto antes'); return; }
    const antes = JSON.parse(fs.readFileSync(FOTO, 'utf8'));
    const { nuevos, cambiados, borrados } = compararFoto(antes, foto);
    console.log('ARCHIVOS NUEVOS: ' + nuevos.length);
    nuevos.slice(0, 40).forEach(([ruta, bytes]) => console.log('  + ' + ruta + ' (' + bytes + ' bytes)'));
    console.log('ARCHIVOS CAMBIADOS: ' + cambiados.length);
    cambiados.slice(0, 40).forEach(([ruta, a, b]) => console.log('  ~ ' + ruta + ' (' + a + ' -> ' + b + ')'));
    console.log('ARCHIVOS BORRADOS: ' + borrados.length);
    borrados.slice(0, 20).forEach(ruta => console.log('  - ' + ruta));
    console.log('');
    console.log('Ahora corre sin argumentos para ver si aparecieron letras nuevas.');
    return;
  }

  const hallazgo = buscarLetras(cliente);
  console.log('LETRAS CACHEADAS POR SPOTIFY: ' + hallazgo.letras.length);
  hallazgo.letras.forEach(letra => {
    console.log('  - ' + letra.archivo + '@' + letra.offset + ' | ' + letra.lineas + ' lineas | ' +
      letra.idioma + ' | ' + letra.proveedor + ' | sincronizada: ' + letra.syncType +
      ' | ' + letra.primerMs + ' ms a ' + letra.ultimoMs + ' ms');
    console.log('      primera linea: ' + JSON.stringify(letra.primera));
  });
  console.log('');
  console.log('CLAVES CON TRACK ID: ' + hallazgo.claves.length);
  hallazgo.claves.slice(0, 20).forEach(clave => console.log('  - ' + clave.trackId + '  (' + clave.archivo + '@' + clave.offset + ')'));

  if (argumentos[0] === '--mapa') {
    console.log('');
    console.log('MAPA (la clave y el cuerpo estan en archivos distintos: para unirlos hay que');
    console.log('parsear el indice de la cache de Chromium, no alcanza con buscar texto):');
    console.log('  claves por archivo: ' + JSON.stringify(hallazgo.claves.reduce((acc, c) => {
      acc[c.archivo] = (acc[c.archivo] || 0) + 1;
      return acc;
    }, {})));
    console.log('  cuerpos por archivo: ' + JSON.stringify(hallazgo.letras.reduce((acc, l) => {
      acc[l.archivo] = (acc[l.archivo] || 0) + 1;
      return acc;
    }, {})));
  }
})();
