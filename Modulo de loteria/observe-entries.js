require('dotenv').config();
const admin = require('firebase-admin');
const WebSocket = require('ws');
const ftp = require('basic-ftp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');

// ── Config ──────────────────────────────────────────────
const WS_URL = process.env.WS_URL || 'ws://localhost:688';
const WS_TOKEN = process.env.WS_TOKEN || '';
const SA_PATH = process.env.FIREBASE_SA_PATH || path.join(__dirname, 'service-account.json');
const STATE_FILE = path.join(__dirname, '.watcher-state.json');
const AVATAR_CACHE_FILE = path.join(__dirname, '.avatar-cache.json');
const POLL_INTERVAL_MS = 2000;

const FTP_HOST = process.env.HOSTING_FTP_HOST || '';
const FTP_PORT = Number(process.env.HOSTING_FTP_PORT || 21);
const FTP_USER = process.env.HOSTING_FTP_USER || '';
const FTP_PASSWORD = process.env.HOSTING_FTP_PASSWORD || '';
const FTP_SECURE = String(process.env.HOSTING_FTP_SECURE || 'false').toLowerCase() === 'true';
const FTP_BASE_PATH = process.env.HOSTING_FTP_BASE_PATH || '/domains/bot.cdelu.io/public_html/images';
const AVATAR_DIR = 'AVATARES';
const HOSTING_PUBLIC_BASE_URL = process.env.HOSTING_PUBLIC_BASE_URL || 'https://bot.cdelu.io/images';

// ── Firebase Admin ──────────────────────────────────────
const saExists = fs.existsSync(SA_PATH);
if (saExists) {
  admin.initializeApp({ credential: admin.credential.cert(SA_PATH) });
} else {
  const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'cdelu-4e564';
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();

function getTimestamp(seconds, nanoseconds) {
  return new admin.firestore.Timestamp(seconds, nanoseconds || 0);
}

// ── State (evita re-procesar al reiniciar) ──────────────
const state = { lastEntryId: null };
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (saved.lastEntryId) state.lastEntryId = saved.lastEntryId;
} catch {}
const processedIds = new Set();
const avatarCache = new Map();

try {
  const cacheRaw = JSON.parse(fs.readFileSync(AVATAR_CACHE_FILE, 'utf8'));
  for (const [key, value] of Object.entries(cacheRaw || {})) {
    if (value && typeof value.hostedUrl === 'string') {
      avatarCache.set(key, value);
    }
  }
} catch {}

// ── Helpers ──────────────────────────────────────────────
function publishToOBS(number, name, entryId, profilePicUrl) {
  const ws = new WebSocket(WS_URL);
  const timeout = setTimeout(() => { try { ws.close(); } catch {} }, 3000);
  ws.on('open', () => {
    clearTimeout(timeout);
    const payload = { type: 'TRIGGER_BALL', number, name, profilePicUrl, eventId: `obs_${entryId}` };
    if (WS_TOKEN) payload.token = WS_TOKEN;
    ws.send(JSON.stringify(payload));
    ws.close();
  });
  ws.on('error', () => clearTimeout(timeout));
}

function saveAvatarCache() {
  const out = {};
  for (const [key, value] of avatarCache.entries()) out[key] = value;
  try { fs.writeFileSync(AVATAR_CACHE_FILE, JSON.stringify(out)); } catch {}
}

function normalizeExt(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  const safeUrl = String(url || '').toLowerCase();
  if (safeUrl.includes('.png')) return 'png';
  if (safeUrl.includes('.webp')) return 'webp';
  if (safeUrl.includes('.gif')) return 'gif';
  return 'jpg';
}

function buildAvatarFileName(userName, sourceUrl, ext) {
  const slug = String(userName || 'user')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'user';
  const hash = crypto.createHash('sha1').update(String(sourceUrl || '')).digest('hex').slice(0, 10);
  return `${slug}-${hash}.${ext}`;
}

function canUseFtpHosting() {
  return Boolean(FTP_HOST && FTP_USER && FTP_PASSWORD && HOSTING_PUBLIC_BASE_URL);
}

async function uploadAvatarToHosting(fileName, buffer) {
  const client = new ftp.Client(10000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: FTP_HOST,
      port: FTP_PORT,
      user: FTP_USER,
      password: FTP_PASSWORD,
      secure: FTP_SECURE
    });

    const remoteDir = `${FTP_BASE_PATH}/${AVATAR_DIR}`;
    await client.ensureDir(remoteDir);
    await client.uploadFrom(Readable.from(buffer), `${remoteDir}/${fileName}`);

    const base = HOSTING_PUBLIC_BASE_URL.replace(/\/$/, '');
    return `${base}/${AVATAR_DIR}/${fileName}`;
  } finally {
    client.close();
  }
}

async function resolveObsProfilePicUrl(sourceUrl, userName) {
  const safeUrl = typeof sourceUrl === 'string' ? sourceUrl.trim() : '';
  if (!safeUrl) return '';
  if (!canUseFtpHosting()) return safeUrl;

  const cached = avatarCache.get(safeUrl);
  if (cached && cached.hostedUrl) return cached.hostedUrl;

  try {
    const res = await fetch(safeUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return safeUrl;

    const contentType = res.headers.get('content-type') || '';
    const arrayBuffer = await res.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return safeUrl;

    const ext = normalizeExt(contentType, safeUrl);
    const fileName = buildAvatarFileName(userName, safeUrl, ext);
    const hostedUrl = await uploadAvatarToHosting(fileName, Buffer.from(arrayBuffer));

    avatarCache.set(safeUrl, {
      hostedUrl,
      fileName,
      updatedAt: Date.now()
    });
    saveAvatarCache();
    return hostedUrl;
  } catch {
    return safeUrl;
  }
}

async function processEntry(entryDoc, lotteryId) {
  const uid = `${lotteryId}/${entryDoc.id}`;
  if (processedIds.has(uid)) return false;

  const data = entryDoc.data() || {};
  const number = data.selectedNumber;
  const name = data.userName || data.userUsername || 'Alguien';
  const sourceProfilePicUrl = data.userProfilePicUrl || '';
  if (!number) return false;

  processedIds.add(uid);
  state.lastEntryId = uid;
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ lastEntryId: uid })); } catch {}

  const profilePicUrl = await resolveObsProfilePicUrl(sourceProfilePicUrl, name);

  console.log(`[+] #${number} - ${name} | pic-obs: ${profilePicUrl ? 'si' : 'no'}`);
  publishToOBS(number, name, uid, profilePicUrl);
  return true;
}

// ── Print config ────────────────────────────────────────
console.log('═══════════════════════════════════════');
console.log('  Watcher de Entradas - Loteria');
console.log('═══════════════════════════════════════');
console.log(`WS Local: ${WS_URL}`);
console.log(`Estado previo: ${state.lastEntryId ? state.lastEntryId : 'ninguno'}`);
if (!canUseFtpHosting()) {
  console.log('[i] FTP hosting avatar NO configurado. Se usa URL externa directa.');
} else {
  console.log(`[i] Avatar OBS se sube a: ${FTP_BASE_PATH}/${AVATAR_DIR}`);
}
console.log('');
console.log('Cargando loterias activas...');

// ── Busca todas las loterias y escucha sus entries ────
async function watchLotteries() {
  try {
    const lotteriesSnap = await db.collection('lotteries')
      .where('deletedAt', '==', null)
      .select()
      .get();

    console.log(`Encontradas ${lotteriesSnap.size} loteria(s) activa(s)`);
    console.log('');

    if (lotteriesSnap.empty) {
      console.log('[!] No hay loterias activas. Esperando nueva loteria...');
      // Escuchar nuevas loterias (no entries)
      db.collection('lotteries')
        .where('deletedAt', '==', null)
        .onSnapshot((snap) => {
          for (const change of snap.docChanges()) {
            if (change.type === 'added') {
              console.log(`[+] Nueva loteria detectada: ${change.doc.id}`);
              listenToLotteryEntries(change.doc.ref);
            }
          }
        });
      return;
    }

    for (const doc of lotteriesSnap.docs) {
      listenToLotteryEntries(doc.ref);
    }
  } catch (err) {
    console.error('[!] Error cargando loterias:', err.message);
    process.exit(1);
  }
}

function listenToLotteryEntries(lotteryRef, retryMs = 3000) {
  const entriesRef = lotteryRef.collection('entries');
  const fiveMinAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 300000);

  const unsub = entriesRef
    .where('createdAt', '>', fiveMinAgo)
    .orderBy('createdAt', 'asc')
    .onSnapshot(
      (snapshot) => {
        if (snapshot.empty) return;
        for (const change of snapshot.docChanges()) {
          if (change.type === 'added') {
            void processEntry(change.doc, lotteryRef.id).catch((error) => {
              console.warn(`[!] Error procesando entry ${change.doc.id}:`, error?.message || error);
            });
          }
        }
      },
      (err) => {
        console.warn(`[!] Listener fallo para ${lotteryRef.id}: ${err.message}. Reintentando en ${retryMs}ms...`);
        unsub();
        setTimeout(() => listenToLotteryEntries(lotteryRef, Math.min(retryMs * 1.5, 30000)), retryMs);
      }
    );
}

// ── Start ────────────────────────────────────────────────
watchLotteries();
