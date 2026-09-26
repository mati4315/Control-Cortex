// Migra el perfil de la extension de Brave al Social Stream Ninja de escritorio.
// No modifica la instalacion de Electron ni la extension. Ejecutar con --dry-run primero.
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');

const SESSION_ID = 'XJ9hQ2JDHH';
const EXTENSION_ID = 'lfompadnhpldepaaelcabnjfkglepnjb';
const BRAVE_PROFILE = path.join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default');
const APP_PROFILE = path.join(process.env.APPDATA, 'SocialStream');
const SOURCE_ROOT = path.resolve(__dirname, '..', '..', 'SocialStream Ninja');

function readVarint(buffer, cursor, end) {
  let value = 0;
  let shift = 0;
  while (cursor.offset < end && shift < 35) {
    const byte = buffer[cursor.offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return value;
    shift += 7;
  }
  throw new Error('LevelDB varint incompleto');
}

function readExtensionStorage(kind) {
  const dir = path.join(BRAVE_PROFILE, kind, EXTENSION_ID);
  const logs = fs.readdirSync(dir).filter(name => /^\d+\.log$/.test(name)).sort();
  if (!logs.length) throw new Error(`No hay registro de ${kind} para la extension`);
  const entries = new Map();
  for (const name of logs) {
    const bytes = fs.readFileSync(path.join(dir, name));
    let offset = 0;
    while (offset + 7 <= bytes.length) {
      const length = bytes.readUInt16LE(offset + 4);
      const type = bytes[offset + 6];
      const end = offset + 7 + length;
      if (!length || end > bytes.length) {
        offset = Math.ceil((offset + 1) / 32768) * 32768;
        continue;
      }
      if (type === 1 && length >= 12) {
        const cursor = { offset: offset + 19 };
        const count = bytes.readUInt32LE(offset + 15);
        for (let i = 0; i < count && cursor.offset < end; i++) {
          const operation = bytes[cursor.offset++];
          const keyLength = readVarint(bytes, cursor, end);
          const key = bytes.subarray(cursor.offset, cursor.offset + keyLength).toString('utf8');
          cursor.offset += keyLength;
          if (operation === 1) {
            const valueLength = readVarint(bytes, cursor, end);
            const value = bytes.subarray(cursor.offset, cursor.offset + valueLength).toString('utf8');
            cursor.offset += valueLength;
            entries.set(key, value);
          } else if (operation === 0) {
            entries.delete(key);
          } else {
            throw new Error(`Operacion LevelDB desconocida: ${operation}`);
          }
        }
      }
      offset = end;
    }
  }
  return entries;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomically(file, value) {
  const temporary = `${file}.cortex-migration.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const installed = 'D:\\Archivos de programa\\socialstream\\socialstream.exe';
  if (!fs.existsSync(installed)) throw new Error('No se encontro Social Stream Ninja para Windows');
  for (const relative of ['manifest.json', 'background.html', 'popup.html', 'sources/twitch.js', 'local-overrides/spotify-auto-music.js']) {
    if (!fs.existsSync(path.join(SOURCE_ROOT, relative))) throw new Error(`Falta ${relative} en la fuente local`);
  }
  const sync = readExtensionStorage('Sync Extension Settings');
  const local = readExtensionStorage('Local Extension Settings');
  const oldSession = JSON.parse(sync.get('streamID') || 'null');
  if (oldSession !== SESSION_ID) throw new Error(`El ID de Brave no coincide con el esperado: ${oldSession || 'vacio'}`);
  const oldSettings = JSON.parse(local.get('settings') || 'null');
  if (!oldSettings || typeof oldSettings !== 'object' || Array.isArray(oldSettings)) throw new Error('No se pudieron leer los ajustes de Brave');
  const oldCapability = JSON.parse(local.get('cohostAccessCapability') || 'null');

  const configPath = path.join(APP_PROFILE, 'config.json');
  const syncPath = path.join(APP_PROFILE, 'savedSync.json');
  const syncBackupPath = path.join(APP_PROFILE, 'savedSync.json.bak');
  const config = readJson(configPath);
  const saved = readJson(syncPath);
  const previousSession = saved.streamID;
  const mergedSettings = { ...saved.settings, ...oldSettings };
  // Fuentes propias de Electron; no intentar convertir las ventanas de Brave en fuentes.
  if (saved.settings.urls) mergedSettings.urls = saved.settings.urls;
  if (saved.settings.groups) mergedSettings.groups = saved.settings.groups;
  const sourceUrl = pathToFileURL(SOURCE_ROOT + path.sep).href;
  const nextSaved = { ...saved, settings: mergedSettings, streamID: SESSION_ID, state: true };
  if (oldCapability && oldCapability.scope === SESSION_ID) nextSaved.cohostAccessCapability = oldCapability;
  const nextConfig = { ...config,
    localSourcePath: sourceUrl,
    cachedStateBackup: nextSaved,
    cachedStateBackupTime: Date.now(),
    localStorageBackup: { ...config.localStorageBackup,
      streamID: SESSION_ID,
      ssninja_stream_id: SESSION_ID,
      state: 'true',
      settings: JSON.stringify(mergedSettings)
    },
    localStorageBackupTime: Date.now()
  };

  console.log(`Extension Brave: ${SESSION_ID}; aplicacion Windows: ${previousSession}`);
  console.log(`Ajustes a migrar: ${Object.keys(oldSettings).join(', ')}`);
  console.log(`Fuente local: ${SOURCE_ROOT}`);
  if (dryRun) {
    console.log('Simulacion completa; no se modifico ningun archivo.');
    return;
  }
  const tasklist = execFileSync('tasklist', ['/FI', 'IMAGENAME eq socialstream.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  if (/"socialstream\.exe"/i.test(tasklist)) throw new Error('Cierra Social Stream Ninja de Windows antes de migrar sus ajustes');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(process.env.APPDATA, 'SocialStream-migration-backups', stamp);
  fs.mkdirSync(backup, { recursive: true });
  for (const file of [configPath, syncPath, syncBackupPath]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backup, path.basename(file)));
  }
  writeJsonAtomically(configPath, nextConfig);
  writeJsonAtomically(syncPath, nextSaved);
  writeJsonAtomically(syncBackupPath, nextSaved);
  console.log(`Perfil migrado. Respaldo: ${backup}`);
  console.log('Abri Social Stream Ninja de Windows y comproba que aparece el mismo ID.');
}

try { main(); } catch (error) { console.error(`Migracion detenida: ${error.message}`); process.exitCode = 1; }
