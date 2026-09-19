// Pruebas del parcheo de SocialStream Ninja (Control Cortex/backend/ssn-patcher.js):
// el punto clave es que una actualizacion de SSN no rompa nada en silencio.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const PATCHER = require('D:/plugins para mi OBS/Control Cortex/backend/ssn-patcher.js');
// La version la fija versions.js: asi esta prueba no queda vieja al subir el modulo.
const PATCHER_VERSION = require('D:/plugins para mi OBS/Control Cortex/backend/versions.js').SPOTIFY_MODULE_VERSION;
const SSN_DIR = 'D:/plugins para mi OBS/SocialStream Ninja';
const LOADER_PATH = path.join(SSN_DIR, 'loader.js');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}
function syntaxOk(code) {
  try {
    new vm.Script(code);
    return true;
  } catch (error) {
    return error.message;
  }
}
function countLine(code, fragment) {
  return code.split(fragment).length - 1;
}
const OVERRIDE_LINES = {
  baseUrl: "'./local-overrides/cortex-base-url.js?v=1',",
  music: null, // depende de la version
  relay: "'./local-overrides/spotify-cortex-overlay-relay.js?v=1',",
  chat: "'./local-overrides/rulo-chat-relay.js?v=1',",
  session: "'./local-overrides/stable-ssn-session-id.js?v=1',"
};
function musicLine(version) {
  return `'./local-overrides/spotify-auto-music.js?v=${version}',`;
}
function allPresent(code, version) {
  const lines = [OVERRIDE_LINES.baseUrl, musicLine(version), OVERRIDE_LINES.relay, OVERRIDE_LINES.chat, OVERRIDE_LINES.session];
  return lines.every(line => countLine(code, line) === 1);
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  // ---------- A) loader real (tal como esta ahora) ----------
  {
    const original = fs.readFileSync(LOADER_PATH, 'utf8');
    const patched = PATCHER.patchLoaderCode(original, { moduleVersion: 26 });
    check('parcheo: el loader real queda con las 5 lineas exactamente una vez', allPresent(patched.code, 26), JSON.stringify(patched.checks));
    check('parcheo: todas detras de su import', patched.applied.length === 5 && patched.applied.every(item => item.mode.indexOf('host:') === 0), JSON.stringify(patched.applied.map(item => item.id + '=' + item.mode)));
    check('parcheo: el resultado sigue siendo JavaScript valido', syntaxOk(patched.code) === true, syntaxOk(patched.code));
    check('parcheo: sin avisos', patched.warnings.length === 0 && patched.ok === true, JSON.stringify(patched.warnings));
  }

  // ---------- B) idempotencia (parchear dos veces no duplica) ----------
  {
    const original = fs.readFileSync(LOADER_PATH, 'utf8');
    const once = PATCHER.patchLoaderCode(original, { moduleVersion: 26 });
    const twice = PATCHER.patchLoaderCode(once.code, { moduleVersion: 26 });
    check('parcheo: aplicarlo dos veces no duplica nada', twice.code === once.code, 'los archivos deberian ser identicos');
    check('parcheo: sigue habiendo 5 lineas', allPresent(twice.code, 26), JSON.stringify(twice.checks));
  }

  // ---------- C) version vieja del modulo (se normaliza) ----------
  {
    const conVersionVieja = fs.readFileSync(LOADER_PATH, 'utf8').replace(/spotify-auto-music\.js\?v=\d+/, 'spotify-auto-music.js?v=19');
    const patched = PATCHER.patchLoaderCode(conVersionVieja, { moduleVersion: 26 });
    check('parcheo: una version vieja del modulo se reemplaza', countLine(patched.code, 'spotify-auto-music.js?v=19') === 0 && countLine(patched.code, musicLine(26)) === 1, 'v19 deberia desaparecer');
  }

  // ---------- D) SSN nuevo: cambia los ?v= y mueve los imports ----------
  {
    const futuro = [
      '// loader.js (for background.html)',
      'async function loadScriptsInOrder() {',
      '    const scripts = [',
      "        './libs/objects.js?v=7',",
      "        './background.js?v=12',",
      "        './spotify.js?v=4',",
      "        './dashboard.js',",
      '    ];',
      '}',
      ''
    ].join('\n');
    const patched = PATCHER.patchLoaderCode(futuro, { moduleVersion: 27 });
    check('parcheo SSN nuevo: las 5 lineas entran igual', allPresent(patched.code, 27), JSON.stringify(patched.checks));
    check('parcheo SSN nuevo: el Session ID va antes de background.js', /stable-ssn-session-id[^\n]*\n[^\n]*background\.js\?v=12/.test(patched.code), patched.code.split('\n').slice(4, 12).join(' / '));
    check('parcheo SSN nuevo: sigue siendo JavaScript valido', syntaxOk(patched.code) === true, syntaxOk(patched.code));
  }

  // ---------- E) SSN renombra spotify.js: camino alternativo, no silencio ----------
  {
    const renombrado = [
      'async function loadScriptsInOrder() {',
      '    const scripts = [',
      "        './spotify-player.js?v=1',",
      "        './background.js?v=1',",
      '    ];',
      '}',
      ''
    ].join('\n');
    const patched = PATCHER.patchLoaderCode(renombrado, { moduleVersion: 26 });
    check('parcheo SSN renombrado: avisa en vez de fallar en silencio', patched.warnings.length > 0, JSON.stringify(patched.warnings));
    check('parcheo SSN renombrado: igual deja las 5 lineas activas', allPresent(patched.code, 26) && patched.ok === true, JSON.stringify(patched.checks));
    check('parcheo SSN renombrado: el Session ID igual queda antes de background.js', patched.code.indexOf('stable-ssn-session-id') < patched.code.indexOf("'./background.js?v=1',"), patched.code.split(String.fromCharCode(10)).slice(2, 9).join(' / '));
  }

  // ---------- F) loader destruido: no puede decir "listo" ----------
  {
    const roto = 'solo texto suelto sin lista de scripts\n';
    const patched = PATCHER.patchLoaderCode(roto, { moduleVersion: 26 });
    check('parcheo loader roto: reporta falla (no exito falso)', patched.ok === false && patched.missing.length === 5, JSON.stringify(patched.missing));
    check('parcheo loader roto: explica el motivo', /lista de scripts/.test(patched.warnings.join(' ')), JSON.stringify(patched.warnings.slice(0, 1)));
  }

  // ---------- G) applySsnPatches sobre una copia temporal ----------
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssn-test-'));
    const fakeSsn = path.join(tempDir, 'SocialStream Ninja');
    fs.mkdirSync(fakeSsn, { recursive: true });
    fs.writeFileSync(path.join(fakeSsn, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'SSN test', version: '9.9.9' }, null, 2), 'utf8');
    fs.writeFileSync(path.join(fakeSsn, 'loader.js'), [
      'async function loadScriptsInOrder() {',
      '    const scripts = [',
      "        './spotify.js?v=3',",
      "        './background.js?v=8',",
      '    ];',
      '}',
      ''
    ].join('\n'), 'utf8');

    const sources = path.join(tempDir, 'fuentes');
    fs.mkdirSync(sources, { recursive: true });
    fs.writeFileSync(path.join(sources, 'modulo.js'), 'console.log("modulo v1");\n', 'utf8');
    fs.writeFileSync(path.join(sources, 'relay.js'), 'console.log("relay");\n', 'utf8');

    const status = PATCHER.applySsnPatches({
      ssnDir: fakeSsn,
      moduleVersion: 30,
      cortexBaseUrl: 'http://192.168.4.100:4000',
      ruloSessionId: 'TEST123',
      overrides: [{ id: 'spotify-auto-music', file: 'spotify-auto-music.js', source: path.join(sources, 'modulo.js') }, { id: 'rulo-chat-relay', file: 'rulo-chat-relay.js', source: path.join(sources, 'relay.js') }],
      log: () => {}
    });
    check('instalacion temporal: termina OK', status.ok === true, JSON.stringify(status.warnings));
    check('instalacion temporal: toma la version de SSN', status.ssnVersion === '9.9.9', status.ssnVersion);
    const manifest = JSON.parse(fs.readFileSync(path.join(fakeSsn, 'manifest.json'), 'utf8'));
    check('instalacion temporal: inyecta la clave del ID de extension', !!manifest.key && manifest.key === PATCHER.SSN_PINNED_KEY, 'sin clave');
    check('instalacion temporal: copia los overrides', fs.existsSync(path.join(fakeSsn, 'local-overrides', 'spotify-auto-music.js')), 'falta el modulo');
    const baseUrl = fs.readFileSync(path.join(fakeSsn, 'local-overrides', 'cortex-base-url.js'), 'utf8');
    check('instalacion temporal: genera la URL base', /CORTEX_BASE_URL = "http:\/\/192\.168\.4\.100:4000"/.test(baseUrl) && /TEST123/.test(baseUrl), baseUrl.split('\n')[3]);
    const loader = fs.readFileSync(path.join(fakeSsn, 'loader.js'), 'utf8');
    check('instalacion temporal: parchea el loader nuevo', loader.indexOf("'./local-overrides/spotify-auto-music.js?v=30',") !== -1 && loader.indexOf("'./local-overrides/rulo-chat-relay.js?v=1',") !== -1, loader.split('\n').slice(2, 8).join(' / '));
    check('instalacion temporal: no inventa overrides que no existen', loader.indexOf('spotify-cortex-overlay-relay') === -1, 'no deberia estar');

    // Segunda pasada: idempotente.
    const again = PATCHER.applySsnPatches({
      ssnDir: fakeSsn,
      moduleVersion: 30,
      cortexBaseUrl: 'http://192.168.4.100:4000',
      ruloSessionId: 'TEST123',
      overrides: [{ id: 'spotify-auto-music', file: 'spotify-auto-music.js', source: path.join(sources, 'modulo.js') }, { id: 'rulo-chat-relay', file: 'rulo-chat-relay.js', source: path.join(sources, 'relay.js') }],
      log: () => {}
    });
    const loaderAgain = fs.readFileSync(path.join(fakeSsn, 'loader.js'), 'utf8');
    check('instalacion temporal: la segunda pasada no cambia el loader', loaderAgain === loader && again.ok === true, JSON.stringify(again.checks));
    check('instalacion temporal: la segunda pasada informa "sin cambios"', again.steps.some(step => step.id === 'overrides' && /0 actualizados/.test(step.detail)), JSON.stringify(again.steps.map(step => step.detail)));

    // Falta el origen de un override: se avisa.
    const faltante = PATCHER.applySsnPatches({
      ssnDir: fakeSsn,
      moduleVersion: 30,
      cortexBaseUrl: 'http://127.0.0.1:4000',
      overrides: [{ id: 'rulo-chat-relay', file: 'no-existe.js', source: path.join(sources, 'no-existe.js') }],
      log: () => {}
    });
    check('instalacion temporal: avisa si falta un origen', faltante.ok === false && faltante.warnings.join(' ').indexOf('no-existe.js') !== -1, JSON.stringify(faltante.warnings));

    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // ---------- H) contra el loader real guardado en git (SSN limpio) ----------
  {
    let pristine = null;
    try {
      pristine = execFileSync('git', ['-C', SSN_DIR, 'show', 'HEAD:loader.js'], { encoding: 'utf8' });
    } catch (error) {
      pristine = null;
    }
    if (pristine) {
      const patched = PATCHER.patchLoaderCode(pristine, { moduleVersion: 26 });
      check('SSN limpio de git: se parchea completo', patched.ok === true && allPresent(patched.code, 26), JSON.stringify(patched.checks));
      check('SSN limpio de git: los imports de SSN no se tocan', pristine.split('\n').filter(line => line.indexOf('local-overrides') === -1).join('\n') === patched.code.split('\n').filter(line => line.indexOf('local-overrides') === -1).join('\n'), 'solo deberian agregarse lineas');
    } else {
      check('SSN limpio de git: disponible para comparar', false, 'no se pudo leer HEAD:loader.js');
    }
  }

  // ---------- I) migracion completa, en un entorno de prueba ----------
  {
    const MIGRAR = 'D:/plugins para mi OBS/Control Cortex/tools/migrar-ssn.js';
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssn-migra-'));
    const sandbox = path.join(tempDir, 'SocialStream Ninja');
    const backups = path.join(tempDir, 'backups');
    const nueva = path.join(tempDir, 'SSN-Nueva');

    // Instalacion "actual": vieja, con nuestras lineas y su copia de seguridad de datos.
    fs.mkdirSync(path.join(sandbox, 'local-overrides'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'SSN', version: '3.50.13', key: 'CLAVE-VIEJA' }, null, 2), 'utf8');
    fs.writeFileSync(path.join(sandbox, 'loader.js'), [
      'async function loadScriptsInOrder() {',
      '    const scripts = [',
      "        './spotify.js?v=1',",
      "        './background.js?v=5',",
      '    ];',
      '}',
      ''
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(sandbox, 'local-overrides', 'cortex-base-url.js'), 'window.CORTEX_BASE_URL = "http://192.168.4.100:4000";\nwindow.CORTEX_SESSION_ID = "ABC123";\n', 'utf8');

    // Version nueva de SSN: otras versiones de import, sin nuestras lineas, un archivo extra.
    fs.mkdirSync(nueva, { recursive: true });
    fs.writeFileSync(path.join(nueva, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'SSN', version: '4.0.0' }, null, 2), 'utf8');
    fs.writeFileSync(path.join(nueva, 'loader.js'), [
      'async function loadScriptsInOrder() {',
      '    const scripts = [',
      "        './spotify.js?v=9',",
      "        './background.js?v=12',",
      '    ];',
      '}',
      ''
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(nueva, 'nuevo-archivo.js'), 'console.log("archivo nuevo");\n', 'utf8');

    const runRaw = args => {
      try {
        const out = execFileSync(process.execPath, [MIGRAR, ...args], {
          encoding: 'utf8',
          env: Object.assign({}, process.env, { CORTEX_SSN_DIR: sandbox, CORTEX_BACKUP_DIR: backups })
        });
        return { code: 0, out };
      } catch (error) {
        return { code: error.status === undefined ? 1 : error.status, out: String(error.stdout || '') + String(error.stderr || '') };
      }
    };
    const run = args => runRaw(args).out;

    const antes = run(['estado']);
    check('migracion: el estado previo detecta que falta aplicar', /FALLA loader\.js/.test(antes), (antes.split('\n').find(line => /loader\.js/.test(line)) || '').trim());

    const salida = run(['desde', nueva]);
    check('migracion: detecta y aplica la version nueva', /Version nueva detectada: 4\.0\.0/.test(salida) && /Parcheo aplicado y verificado/.test(salida), salida.split('\n').filter(line => /Version nueva|Parcheo aplicado/.test(line)).join(' | '));
    check('migracion: respalda antes de tocar nada', fs.existsSync(backups) && fs.readdirSync(backups).length === 1, fs.existsSync(backups) ? fs.readdirSync(backups).join(',') : 'sin backup');
    check('migracion: copia los archivos de la version nueva', fs.existsSync(path.join(sandbox, 'nuevo-archivo.js')), 'falta nuevo-archivo.js');

    const manifest = JSON.parse(fs.readFileSync(path.join(sandbox, 'manifest.json'), 'utf8'));
    check('migracion: deja el ID de extension protegido', manifest.key === PATCHER.SSN_PINNED_KEY, manifest.key === PATCHER.SSN_PINNED_KEY ? 'clave fija' : 'clave inesperada');
    const loader = fs.readFileSync(path.join(sandbox, 'loader.js'), 'utf8');
    check('migracion: parchea el loader de la version nueva', loader.indexOf("'./local-overrides/spotify-auto-music.js?v=" + PATCHER_VERSION + "',") !== -1 && loader.indexOf("'./spotify.js?v=9',") !== -1, loader.split('\n').slice(2, 9).join(' / '));
    const baseUrl = fs.readFileSync(path.join(sandbox, 'local-overrides', 'cortex-base-url.js'), 'utf8');
    check('migracion: conserva la URL base y el Session ID', /192\.168\.4\.100:4000/.test(baseUrl) && /ABC123/.test(baseUrl), baseUrl.split('\n')[0]);

    const despues = run(['estado']);
    check('migracion: el estado final queda todo OK', /Todo listo/.test(despues) && !/FALLA/.test(despues), (despues.split('\n').find(line => /FALLA/.test(line)) || 'sin fallas').trim());

    const sinArgumento = runRaw(['desde']);
    check('migracion: avisa si falta la carpeta nueva', sinArgumento.code === 1 && /Falta la carpeta/.test(sinArgumento.out), sinArgumento.out.split('\n').filter(Boolean).pop() || '');

    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // ---------- F) SSN reformateado: comillas dobles y CRLF ----------
  {
    const crlf = [
      'async function loadScriptsInOrder() {',
      '  const scripts = [',
      '    "./spotify.js?v=3",',
      '    "./background.js?v=9",',
      '  ];',
      '}',
      ''
    ].join('\r\n');
    const patched = PATCHER.patchLoaderCode(crlf, { moduleVersion: 26 });
    check('SSN reformateado: ancla igual en los imports', patched.applied.length === 5 && patched.applied.every(item => item.mode.indexOf('host:') === 0), JSON.stringify(patched.applied.map(item => item.mode)));
    check('SSN reformateado: sin avisos', patched.warnings.length === 0, patched.warnings.join(' | '));
    check('SSN reformateado: mantiene el fin de linea del archivo', patched.code.indexOf("'./local-overrides/cortex-base-url.js?v=1',\r\n") !== -1, 'mezclo LF con CRLF');
    check('SSN reformateado: los imports de SSN no se tocan', patched.code.indexOf('"./spotify.js?v=3",') !== -1 && patched.code.indexOf('"./background.js?v=9",') !== -1, 'se perdio un import de SSN');
    check('SSN reformateado: el Session ID queda antes de background.js', patched.code.indexOf('stable-ssn-session-id') < patched.code.indexOf('background.js?v=9'), 'quedo despues');
    check('SSN reformateado: sigue siendo JavaScript valido', (() => { try { new vm.Script(patched.code); return true; } catch (error) { return false; } })(), 'no compila');
  }

  // ---------- Resultado ----------
  const failed = results.filter(item => !item.ok);
  results.forEach(item => console.log(`${item.ok ? 'OK  ' : 'FALLA'}  ${item.name}${item.ok ? '' : ' -- ' + item.detail}`));
  console.log(`\n${results.length - failed.length}/${results.length} pruebas del parcheo de SSN OK`);
  process.exit(failed.length ? 1 : 0);
})();
