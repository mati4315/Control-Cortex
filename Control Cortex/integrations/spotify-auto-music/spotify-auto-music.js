(function() {
	"use strict";

	const DEFAULT_COOLDOWN_MS = 40000;
	const DEFAULT_USER_COOLDOWN_MS = 120000;
	const CACHE_TTL_MS = 10 * 60 * 1000;
	const COMMANDS = ["!playnow", "!tema", "!musica"];
	// URL base de Cortex: la genera el auto-patcher (local-overrides/cortex-base-url.js).
	// El valor de respaldo mantiene el comportamiento si el override no esta cargado.
	const CORTEX_BASE_URL = (() => {
		const configured = (typeof window !== "undefined" && window.CORTEX_BASE_URL)
			? String(window.CORTEX_BASE_URL)
			: "http://192.168.4.100:4000";
		return configured.replace(/\/+$/, "");
	})();
	const CONTROL_CORTEX_DEVICE_TARGET_URL = CORTEX_BASE_URL + "/api/spotify-device-target";
	const CONTROL_CORTEX_PLAYBACK_OFFSET_URL = CORTEX_BASE_URL + "/api/spotify-playback-offset";
	const RULO_BOT_RELAY_URL = CORTEX_BASE_URL + "/api/rulo-bot-message";
	// Dashboard de Spotify (Rulo/Spotify): ajustes en vivo, registro y comandos.
	const MODULE_VERSION = 24;
	const CORTEX_CLIENT_STATE_URL = CORTEX_BASE_URL + "/api/spotify-client-state";
	const CORTEX_WS_URL = CORTEX_BASE_URL.replace(/^http/i, "ws") + "/api/spotify-ws";
	const CORTEX_REQUEST_LOG_URL = CORTEX_BASE_URL + "/api/spotify-request-log";
	const CORTEX_DEVICES_REPORT_URL = CORTEX_BASE_URL + "/api/spotify-devices-report";
	const CORTEX_ALIASES_URL = CORTEX_BASE_URL + "/api/spotify-aliases";
	const CORTEX_SETTINGS_POLL_MS = 4000;
	const DEVICES_REPORT_MIN_MS = 10000;
	// Valores de respaldo: se usan solo si Cortex todavia no respondio.
	const DEFAULT_CORTEX_SETTINGS = {
		enabled: true,
		testMode: false,
		cooldownSeconds: DEFAULT_COOLDOWN_MS / 1000,
		userCooldownSeconds: DEFAULT_USER_COOLDOWN_MS / 1000,
		minTextLength: 8,
		requireCommand: false,
		personalize: true,
		announce: true,
		autoContinue: true,
		skipEnabled: false,
		skipSeconds: 10,
		pollSeconds: CORTEX_SETTINGS_POLL_MS / 1000,
		deviceTargetName: ""
	};
	// Ajustes de SocialStream Ninja que se siguen respetando si Cortex no manda nada.
	const SSN_SETTING_KEYS = {
		enabled: "spotifyAutoMusicRequests",
		cooldownSeconds: "spotifyAutoMusicCooldownSeconds",
		userCooldownSeconds: "spotifyAutoMusicUserCooldownSeconds",
		deviceTargetName: "spotifyAutoMusicDeviceName"
	};
	// Todo normalizado sin acentos (normalizeText los saca antes de comparar).
	const GENRE_ALIASES = {
		bachata: "bachata",
		bachatas: "bachata",
		blues: "blues",
		chamame: "chamame",
		cumbia: "cumbia",
		cumbias: "cumbia",
		"cumbia villera": "cumbia",
		cuarteto: "cuarteto",
		cuartetos: "cuarteto",
		edm: "electronic",
		electro: "electronic",
		electronica: "electronic",
		folclore: "folk",
		folklore: "folk",
		funk: "funk",
		jazz: "jazz",
		merengue: "merengue",
		merengues: "merengue",
		metal: "metal",
		pop: "pop",
		rap: "rap",
		regae: "reggae",
		reggae: "reggae",
		regaeton: "reggaeton",
		regeaton: "reggaeton",
		regeton: "reggaeton",
		regueton: "reggaeton",
		reggaeton: "reggaeton",
		regueto: "reggaeton",
		romantica: "romantico",
		romanticas: "romantico",
		romantico: "romantico",
		romanticos: "romantico",
		romanticon: "romantico",
		rock: "rock",
		salsa: "salsa",
		salsas: "salsa",
		techno: "techno",
		tekno: "techno",
		trap: "trap",
		traps: "trap",
		vallenato: "vallenato",
		vallenatos: "vallenato"
	};
	// Palabras con las que la gente pide musica (incluye "temita", "temazo"...).
	const MUSIC_WORDS = "(?:tema|temas|temita|temitas|temon|temones|temazo|temazos|music|musica|musicas|musicon|musiquita|cancion|canciones|cancioncita|track|tracks|rola|rolas|rolita)";
	const REQUEST_VERBS = "(?:quiero escuchar|quiero oir|me pones|me podes poner|podes poner|podrias poner|poneme|ponele|ponete|pones|poner|pongan|pone|pon|pasame|pasate|pasale|pasen|pasa|quiero|quisiera|queria|pedime|pedia|pedi|pedir|pido|necesito)";
	const GREETINGS = "(?:hola+|holis|buen dia|buenas tardes|buenas noches|buenas+|bue|que tal|q tal|como va|como andan|como estas|como te va|epa|hey|saludos|aloha|buenas y santas)";
	const FILLERS = "(?:che|por favor|porfa|porfavor|please|dale|gracias|muchas gracias|amigo|amiga|genio|crack|maestro|capo|grande|bot|porfi)";
	const ARTICLES = "(?:un|una|unos|unas|el|la|los|las|algun|alguna|alguno|algunos|otro|otra)";

	function settingValue(settings, key, fallback) {
		const value = settings && settings[key];
		if (value && typeof value === "object") {
			if ("setting" in value) return value.setting;
			if ("textsetting" in value) return value.textsetting;
		}
		return value === undefined || value === null ? fallback : value;
	}

	// --- Ajustes efectivos: Dashboard de Cortex > SocialStream Ninja > respaldo ---
	function cortexSettings(integration) {
		const remote = integration && integration.cortexSpotifySettings;
		return remote && typeof remote === "object" ? remote : null;
	}

	function resolveSetting(integration, key, fallback) {
		const remote = cortexSettings(integration);
		if (remote && remote[key] !== undefined && remote[key] !== null) return remote[key];
		const ssnKey = SSN_SETTING_KEYS[key];
		if (ssnKey) {
			const local = settingValue(integration && integration.settings, ssnKey, undefined);
			if (local !== undefined && local !== null) return local;
		}
		const preset = DEFAULT_CORTEX_SETTINGS[key];
		return preset === undefined ? fallback : preset;
	}

	function boolSetting(integration, key, fallback) {
		const value = resolveSetting(integration, key, fallback);
		if (typeof value === "boolean") return value;
		if (value && typeof value === "object") {
			const inner = "setting" in value ? value.setting : value.textsetting;
			return inner === true || String(inner).toLowerCase() === "true";
		}
		return String(value).toLowerCase() === "true" || value === 1 || value === "1";
	}

	// A diferencia del viejo numberSetting, acepta 0 (sirve para "sin espera").
	function numSetting(integration, key, fallback, min, max) {
		const value = Number(resolveSetting(integration, key, fallback));
		if (!Number.isFinite(value)) return fallback;
		const lower = Number.isFinite(min) ? min : 0;
		const upper = Number.isFinite(max) ? max : 100000;
		return Math.min(upper, Math.max(lower, Math.round(value)));
	}

	function requestLimits(integration) {
		return {
			minTextLength: numSetting(integration, "minTextLength", 8, 3, 120),
			requireCommand: boolSetting(integration, "requireCommand", false)
		};
	}

	// Cada cuanto la extension consulta los ajustes y los comandos del dashboard.
	// Bajarlo hace que "Probar" suene casi al instante.
	function cortexPollMs(integration) {
		return numSetting(integration, "pollSeconds", CORTEX_SETTINGS_POLL_MS / 1000, 1, 15) * 1000;
	}

	function stripHtml(value) {
		return String(value || "")
			.replace(/<[^>]*>/g, " ")
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'");
	}

	function normalizeText(value) {
		return stripHtml(value)
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[–—−]/g, "-")
			.replace(/https?:\/\/\S+/g, " ")
			.replace(/[^\w\s"'!.-]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function cleanQueryPart(value) {
		return String(value || "")
			.replace(/^["'\s]+|["'\s]+$/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	function requesterKey(data) {
		return `${data?.type || "chat"}:${data?.userid || data?.username || data?.chatname || "unknown"}`;
	}

	function requesterName(data) {
		return String(data?.chatname || data?.displayname || data?.username || "")
			.replace(/\s+/g, " ").trim().slice(0, 80);
	}

	function requesterFirstName(data) {
		return requesterName(data).split(/\s+/)[0] || "";
	}

	function personalizeBotMessage(message, data) {
		const firstName = requesterFirstName(data);
		if (!firstName || !message) return message;
		const text = String(message);
		if (/^Reproduciendo:/i.test(text)) {
			return `Listo ${firstName}, ya se esta ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
		}
		return `${firstName}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
	}

	// mood: estado visual de Rulo (idle | thinking | success | warning | error | speaking).
	// El nombre visible y el mood final los valida Control Cortex.
	function postRuloBotResponse(message, data, mood, provisional) {
		if (!message || typeof fetch !== "function") return;
		fetch(RULO_BOT_RELAY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				message: String(message).slice(0, 500),
				requester: requesterFirstName(data),
				mood: mood || "success",
				// Un provisorio se muestra enseguida pero no queda como respuesta definitiva.
				provisional: provisional === true,
				timestamp: Date.now()
			})
		}).catch(error => console.debug("[Rulo] No se pudo enviar la respuesta al overlay:", error.message));
	}

	// Texto del aviso "pensando" que se muestra mientras se busca en Spotify.
	function describeSearchMessage(parsed) {
		const query = String((parsed && parsed.query) || "").trim();
		if (!query) return "Buscando en Spotify...";
		if (/^genre:/i.test(query)) return `Buscando algo de ${query.slice(6)}...`;
		return `Buscando "${query.slice(0, 60)}" en Spotify...`;
	}

	function normalizeArtistPhrase(value) {
		return cleanQueryPart(value)
			.replace(/^de\s+el\s+/i, "el ")
			.replace(/^del\s+/i, "el ");
	}

	function regex(source, flags) {
		return new RegExp(source, flags || "i");
	}

	// Saca saludos y muletillas que la gente escribe antes del pedido:
	// "hola matias un temita de los palmeras" -> "matias un temita de los palmeras".
	function stripNoise(text) {
		let out = String(text || "");
		out = out.replace(regex("^" + GREETINGS + "[\\s,.:;!¡-]*"), " ");
		out = out.replace(regex("@[\\w.]+", "g"), " ");
		out = out.replace(regex("\\b" + FILLERS + "\\b", "gi"), " ");
		return out.replace(/\s+/g, " ").trim();
	}

	// Palabras que valen como artista o titulo (descarta articulos y conectores).
	function usefulWords(value) {
		const stop = regex("^(?:" + ARTICLES + "|de|del|al|a|y|o|con|para|que|mi|me|te|se|un|es|son)$");
		return String(value || "")
			.split(/\s+/)
			.filter(word => word.length > 2 && !stop.test(word));
	}

	// "laberiso" -> "la beriso": articulo pegado al nombre, tipico en el chat.
	function splitGluedArticle(value) {
		const match = String(value || "").trim().match(/^(el|la|los|las|un|una)([a-z]{4,})$/);
		return match ? `${match[1]} ${match[2]}` : "";
	}

	// "los palmeras" -> "palmeras": por si el buscador se traba con el articulo.
	function dropArticles(value) {
		return String(value || "")
			.replace(regex("\\b(?:el|la|los|las|un|una|del|de)\\b", "gi"), " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function parseGenreRequest(text) {
		const cleaned = stripNoise(text)
			.replace(regex("^(?:" + REQUEST_VERBS + ")\\s+"), "")
			.replace(regex("^(?:" + ARTICLES + ")\\s+"), "")
			.replace(regex("^(?:" + MUSIC_WORDS + ")(?:\\s+de)?\\s+"), "")
			.replace(/^(?:de|del)\s+/i, "")
			.trim();
		const genre = GENRE_ALIASES[cleaned];
		return genre ? { genre, query: `genre:${genre}`, source: "genre" } : null;
	}

	function parseRequest(message, limits) {
		const options = limits && typeof limits === "object" ? limits : {};
		const minTextLength = Number.isFinite(Number(options.minTextLength))
			? Number(options.minTextLength)
			: DEFAULT_CORTEX_SETTINGS.minTextLength;
		const requireCommand = options.requireCommand === true;
		const raw = normalizeText(message);
		if (!raw || raw.length < minTextLength) return null;

		const command = COMMANDS.find(cmd => raw === cmd || raw.startsWith(cmd + " "));
		if (command) {
			const query = cleanQueryPart(raw.slice(command.length));
			if (!query || query.length < 3) {
				return { error: `Uso: ${command} <tema o artista>` };
			}
			return { query, source: "command" };
		}

		if (raw.startsWith("!")) return null;

		// Modo "solo comandos": ignora el lenguaje natural del chat.
		if (requireCommand) return null;

		// Sin saludos ni muletillas: "hola matias un temita de los palmeras".
		const text = stripNoise(raw);
		if (text.length < 4) return null;

		const genreRequest = parseGenreRequest(text);
		if (genreRequest) return genreRequest;

		// "tema Titulo - Artista" y "tema de Titulo - Artista".
		const pairText = text
			.replace(regex("^(?:" + REQUEST_VERBS + ")\\s+"), "")
			.replace(regex("^(?:" + ARTICLES + "\\s+)?(?:" + MUSIC_WORDS + ")\\s+"), "")
			.trim();
		const explicitMatch = pairText.match(/^de\s+(.+?)\s+-\s+(.+)$/) || pairText.match(/^(.+?)\s+-\s+(.+)$/);
		if (explicitMatch && /-/.test(text)) {
			const title = cleanQueryPart(explicitMatch[1].replace(regex("\\b(?:" + MUSIC_WORDS + ")\\b", "g"), " "));
			const artist = cleanQueryPart(explicitMatch[2]);
			if (title && artist) return { artist, title, query: `track:${title} artist:${artist}`, source: "natural" };
		}

		// "de ARTISTA el tema TITULO" ("quiero la musica de Amar Azul el tema Yo Tomo Licor").
		let match = text.match(regex("\\bde\\s+(.+?)\\s+(?:el\\s+)?" + MUSIC_WORDS + "\\s+(.+)$"));
		if (match) {
			const artist = cleanQueryPart(match[1]);
			const title = cleanQueryPart(match[2]);
			if (artist && title && artist.length >= 3) return { artist, title, query: `track:${title} artist:${artist}`, source: "natural" };
		}

		// "poneme TITULO de ARTISTA".
		match = text.match(regex("\\b(?:" + REQUEST_VERBS + ")\\s+(.+?)\\s+de\\s+(.+)$"));
		if (match) {
			const title = cleanQueryPart(match[1].replace(regex("\\b(?:" + MUSIC_WORDS + ")\\b", "g"), " "));
			const artist = cleanQueryPart(match[2]);
			if (artist && title && usefulWords(title).length) return { artist, title, query: `track:${title} artist:${artist}`, source: "natural" };
		}

		// Artista en cualquier parte del comentario: "un tema de laberiso",
		// "hola matias un temita de los palmeras", "un tema del polaco".
		match = text.match(regex("\\b" + MUSIC_WORDS + "\\s+(?:de\\s+|del\\s+|la\\s+|el\\s+|los\\s+|las\\s+)?(.+)$"));
		if (match) {
			const artist = normalizeArtistPhrase(match[1]);
			if (usefulWords(artist).length || artist.length >= 4) {
				return { artist, query: `artist:${artist}`, source: "natural" };
			}
		}

		// Verbo + artista, sin la palabra "tema": "pasame a ke personajes",
		// "quiero escuchar ke personajes", "poneme amar azul".
		match = text.match(regex("\\b(?:" + REQUEST_VERBS + ")\\s+(?:(?:a|al|el|la|los|las|un|una|de|del)\\s+)?(.+)$"));
		if (match) {
			const candidate = cleanQueryPart(match[1].replace(regex("\\b(?:" + MUSIC_WORDS + ")\\b", "g"), " "));
			if (candidate.length >= 4 && usefulWords(candidate).length) return { query: candidate, source: "natural" };
		}

		return null;
	}

	async function spotifyFetch(integration, url, options, retry) {
		const response = await fetch(url, options);
		if (response.status === 401 && retry !== false && typeof integration.refreshAccessToken === "function") {
			await integration.refreshAccessToken();
			const nextOptions = Object.assign({}, options, {
				headers: Object.assign({}, options?.headers, {
					Authorization: `Bearer ${integration.accessToken}`
				})
			});
			return fetch(url, nextOptions);
		}
		return response;
	}

	function getCachedTrack(integration, query) {
		const cache = integration.autoMusicSearchCache;
		const key = query.toLowerCase();
		const cached = cache && cache.get(key);
		if (!cached || cached.expiresAt <= Date.now()) {
			if (cached) cache.delete(key);
			return null;
		}
		return cached.track;
	}

	function setCachedTrack(integration, query, track) {
		if (!integration.autoMusicSearchCache) integration.autoMusicSearchCache = new Map();
		integration.autoMusicSearchCache.set(query.toLowerCase(), {
			track,
			expiresAt: Date.now() + CACHE_TTL_MS
		});
		if (integration.autoMusicSearchCache.size > 100) {
			const firstKey = integration.autoMusicSearchCache.keys().next().value;
			integration.autoMusicSearchCache.delete(firstKey);
		}
	}

	function aliasFor(integration, value) {
		const map = integration.cortexSpotifyAliases;
		if (!map || typeof map !== "object") return "";
		const key = String(value || "").trim().toLowerCase();
		const found = key && map[key];
		return typeof found === "string" ? found : "";
	}

	// Alternativas para un termino mal escrito: articulo pegado ("laberiso" ->
	// "la beriso"), sin articulo ("los palmeras" -> "palmeras") y confusiones
	// tipicas del español (i/y, b/v, s/z, ll/y, qu/k).
	function queryVariants(value) {
		const term = String(value || "").trim();
		if (!term) return [];
		const out = [];
		const push = candidate => {
			const clean = cleanQueryPart(candidate);
			if (!clean || clean.toLowerCase() === term.toLowerCase()) return;
			if (out.some(item => item.toLowerCase() === clean.toLowerCase())) return;
			if (out.length < 8) out.push(clean);
		};

		push(splitGluedArticle(term));
		push(dropArticles(term));

		const words = term.split(/\s+/);
		const swaps = [["y", "i"], ["i", "y"], ["b", "v"], ["v", "b"], ["s", "z"], ["z", "s"], ["ll", "y"], ["qu", "k"], ["c", "s"]];
		words.forEach((word, index) => {
			if (word.length < 5) return;
			swaps.forEach(([from, to]) => {
				if (out.length >= 8 || word.indexOf(from) === -1) return;
				const replaced = words.slice();
				replaced[index] = word.replace(from, to);
				push(replaced.join(" "));
			});
		});
		return out;
	}

	// Guarda la correccion que funciono para que la proxima sea directa.
	function rememberAlias(integration, from, to, track) {
		const origin = cleanQueryPart(String(from || "").toLowerCase());
		const fixed = cleanQueryPart(String(to || "").replace(/^(?:artist|track|genre):\s*/i, ""));
		if (!origin || !fixed || origin === fixed.toLowerCase()) return;
		if (origin.length > 60 || fixed.length > 60) return;
		if (!integration.cortexSpotifyAliases) integration.cortexSpotifyAliases = {};
		integration.cortexSpotifyAliases[origin] = fixed;
		if (typeof fetch !== "function") return;
		fetch(CORTEX_ALIASES_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				from: origin,
				to: fixed,
				artist: track?.artists?.[0]?.name || "",
				track: track?.name || ""
			})
		}).catch(error => console.debug("[Spotify Auto Music] No se pudo guardar la correccion:", error.message));
	}

	async function searchTrack(integration, query) {
		const cached = getCachedTrack(integration, query);
		if (cached) return cached;

		const fieldMatch = String(query).match(/^(artist|track|genre):\s*(.+)$/i);
		const field = fieldMatch ? fieldMatch[1].toLowerCase() : "";
		const term = fieldMatch ? fieldMatch[2].trim() : String(query).trim();

		const attempts = [];
		const addAttempt = candidate => {
			const clean = cleanQueryPart(candidate);
			if (!clean || attempts.length >= 7) return;
			if (attempts.some(item => item.toLowerCase() === clean.toLowerCase())) return;
			attempts.push(clean);
		};

		// 1) como lo escribio la persona  2) la correccion aprendida
		// 3) variantes por errores de escritura  4) sin el filtro de campo.
		addAttempt(query);
		const learned = aliasFor(integration, term);
		if (learned) addAttempt(field ? `${field}:${learned}` : learned);
		queryVariants(term).forEach(variant => addAttempt(field ? `${field}:${variant}` : variant));
		addAttempt(term);

		for (const attempt of attempts) {
			const response = await spotifyFetch(
				integration,
				`https://api.spotify.com/v1/search?q=${encodeURIComponent(attempt)}&type=track&limit=${attempt.startsWith("genre:") ? 10 : 3}`,
				{ headers: { Authorization: `Bearer ${integration.accessToken}` } }
			);
			const data = await response.json().catch(() => null);
			const tracks = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
			if (tracks[0]) {
				setCachedTrack(integration, query, tracks[0]);
				// Si hubo que corregir la escritura, se aprende para la proxima.
				if (attempt.toLowerCase() !== String(query).toLowerCase()) {
					rememberAlias(integration, term, attempt, tracks[0]);
				}
				return tracks[0];
			}
		}
		return null;
	}

	async function getSpotifyDevices(integration) {
		const response = await spotifyFetch(
			integration,
			"https://api.spotify.com/v1/me/player/devices",
			{ headers: { Authorization: `Bearer ${integration.accessToken}` } }
		);
		if (!response.ok) return [];
		const data = await response.json().catch(() => null);
		const devices = Array.isArray(data?.devices) ? data.devices : [];
		reportSpotifyDevices(integration, devices);
		return devices;
	}

	function chooseSpotifyDevice(integration, devices, remotePreferredName = "") {
		const usable = (devices || []).filter(device => device && device.id && !device.is_restricted);
		if (!usable.length) return null;

		const preferredName = String(remotePreferredName || settingValue(integration.settings, "spotifyAutoMusicDeviceName", "") || "")
			.trim()
			.toLowerCase();
		if (preferredName) {
			const named = usable.find(device => String(device.name || "").toLowerCase().includes(preferredName));
			if (named) return named;
		}

		return usable.find(device => device.is_active) ||
			usable.find(device => String(device.type || "").toLowerCase() === "computer") ||
			usable[0];
	}

	async function getRemoteDeviceTarget() {
		try {
			const response = await fetch(CONTROL_CORTEX_DEVICE_TARGET_URL, { cache: "no-store" });
			if (!response.ok) return "";
			const data = await response.json().catch(() => null);
			return String(data?.deviceName || "").trim();
		} catch (error) {
			console.debug("[Spotify Auto Music] No se pudo consultar el destino de Cortex:", error.message);
			return "";
		}
	}

	function getContinuationState(integration) {
		if (!integration.autoMusicContinuation) {
			integration.autoMusicContinuation = {
				active: false,
				playedUris: new Set(),
				queuedUris: new Set(),
				inFlight: false
			};
		}
		return integration.autoMusicContinuation;
	}

	async function getPlaybackOffsetConfig(integration) {
		// Los ajustes del dashboard ya traen el salto: si llegaron, mandan ellos.
		const remote = cortexSettings(integration);
		if (remote) {
			const remoteSeconds = Number(remote.skipSeconds);
			return {
				enabled: remote.skipEnabled === true,
				seconds: Number.isFinite(remoteSeconds) && remoteSeconds > 0 ? Math.min(120, Math.round(remoteSeconds)) : 10
			};
		}
		const now = Date.now();
		if (integration.spotifyPlaybackOffsetCache && integration.spotifyPlaybackOffsetCache.expiresAt > now) {
			return integration.spotifyPlaybackOffsetCache;
		}
		try {
			const response = await fetch(CONTROL_CORTEX_PLAYBACK_OFFSET_URL, { cache: "no-store" });
			const data = response.ok ? await response.json().catch(() => null) : null;
			const enabled = data?.enabled === true;
			const requestedSeconds = Number(data?.seconds);
			const seconds = Number.isFinite(requestedSeconds) && requestedSeconds > 0
				? Math.min(120, Math.round(requestedSeconds))
				: 10;
			integration.spotifyPlaybackOffsetCache = { enabled, seconds, expiresAt: now + 10000 };
			return integration.spotifyPlaybackOffsetCache;
		} catch (error) {
			console.debug("[Spotify Auto Music] No se pudo consultar el salto configurable:", error.message);
			return { enabled: false, seconds: 10, expiresAt: now + 5000 };
		}
	}

	async function applyTenSecondPlaybackRule(integration, track, state) {
		const offsetConfig = await getPlaybackOffsetConfig(integration);
		if (!track?.uri || !offsetConfig.enabled) return;
		const offsetMs = offsetConfig.seconds * 1000;
		if (!state.startedUris.has(track.uri)) {
			// El polling puede traer un estado viejo mientras la llamada espera.
			// Confirmar la posicion actual evita aplicar el seek tarde, por ejemplo
			// cuando Spotify ya paso de los 10 segundos.
			const freshStateResponse = await spotifyFetch(
				integration,
				"https://api.spotify.com/v1/me/player",
				{ headers: { Authorization: `Bearer ${integration.accessToken}` } }
			);
			const freshState = freshStateResponse.ok
				? await freshStateResponse.json().catch(() => null)
				: null;
			const freshUri = freshState?.item?.uri;
			const freshProgressMs = Number(freshState?.progress_ms);
			const lateThresholdMs = offsetMs;
			if (freshUri !== track.uri || !Number.isFinite(freshProgressMs) || freshProgressMs > lateThresholdMs) {
				state.startedUris.add(track.uri);
				return;
			}
			const seekResponse = await spotifyFetch(
				integration,
				`https://api.spotify.com/v1/me/player/seek?position_ms=${offsetMs}`,
				{ method: "PUT", headers: { Authorization: `Bearer ${integration.accessToken}` } }
			);
			if (seekResponse.status === 204 || seekResponse.ok) state.startedUris.add(track.uri);
		}

		const remainingMs = Number(track.duration || 0) - Number(track.progress || 0);
			if (track.isPlaying && remainingMs > 0 && remainingMs <= offsetMs + 5000 && !state.endedUris.has(track.uri)) {
			const remotePreferredName = await getRemoteDeviceTarget();
			const device = chooseSpotifyDevice(integration, await getSpotifyDevices(integration), remotePreferredName);
			const nextUrl = device?.id
				? `https://api.spotify.com/v1/me/player/next?device_id=${encodeURIComponent(device.id)}`
				: "https://api.spotify.com/v1/me/player/next";
			const nextResponse = await spotifyFetch(integration, nextUrl, {
				method: "POST",
				headers: { Authorization: `Bearer ${integration.accessToken}` }
			});
			if (nextResponse.status === 204 || nextResponse.ok) {
				state.endedUris.add(track.uri);
				console.log(`[Spotify Auto Music] Salto de ${offsetConfig.seconds} segundos aplicado: ${track.name}`);
			}
		}
	}

	async function getSimilarTrack(integration, track) {
		const state = getContinuationState(integration);
		const seed = track?.id || String(track?.uri || "").split(":").pop();
		if (!seed) return null;

		try {
			const response = await spotifyFetch(
				integration,
				`https://api.spotify.com/v1/recommendations?seed_tracks=${encodeURIComponent(seed)}&limit=5`,
				{ headers: { Authorization: `Bearer ${integration.accessToken}` } }
			);
			const data = await response.json().catch(() => null);
			const candidates = Array.isArray(data?.tracks) ? data.tracks : [];
			const fresh = candidates.find(candidate => candidate?.uri && !state.playedUris.has(candidate.uri));
			if (fresh) return fresh;
		} catch (error) {
			console.debug("[Spotify Auto Music] Recomendaciones no disponibles:", error.message);
		}

		// Fallback compatible: buscar otra pista del artista actual y evitar las ya usadas.
		const artistName = track?.artists?.[0]?.name || track?.artist?.split(",")[0];
		if (!artistName) return null;
		try {
			const response = await spotifyFetch(
				integration,
				`https://api.spotify.com/v1/search?q=${encodeURIComponent(`artist:${artistName}`)}&type=track&limit=10`,
				{ headers: { Authorization: `Bearer ${integration.accessToken}` } }
			);
			const data = await response.json().catch(() => null);
			const candidates = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
			return candidates.find(candidate => candidate?.uri && !state.playedUris.has(candidate.uri)) || null;
		} catch (error) {
			console.debug("[Spotify Auto Music] Fallback de artista no disponible:", error.message);
			return null;
		}
	}

	async function queueContinuation(integration, track) {
		const state = getContinuationState(integration);
		if (!state.active || state.inFlight || !track?.uri) return;
		state.inFlight = true;
		try {
			const nextTrack = await getSimilarTrack(integration, track);
			if (!nextTrack?.uri || state.playedUris.has(nextTrack.uri)) return;
			const response = await spotifyFetch(
				integration,
				`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(nextTrack.uri)}`,
				{
					method: "POST",
					headers: { Authorization: `Bearer ${integration.accessToken}` }
				}
			);
			if (response.status === 204 || response.ok) {
				state.playedUris.add(nextTrack.uri);
				state.queuedUris.add(nextTrack.uri);
				console.log(`[Spotify Auto Music] Continuacion en cola: ${nextTrack.name}`);
			}
		} catch (error) {
			console.debug("[Spotify Auto Music] No se pudo preparar continuacion:", error.message);
		} finally {
			state.inFlight = false;
		}
	}

	async function activateSpotifyDevice(integration, device) {
		if (!device || device.is_active) return true;
		const response = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${integration.accessToken}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				device_ids: [device.id],
				play: true
			})
		});
		return response.status === 204 || response.ok;
	}

	function waitForSpotify(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	function emitTrackSwitchHint(integration, track, offsetConfig) {
		const callback = integration?.callbacks?.onTrackUpdate;
		if (typeof callback !== "function" || !track?.uri) return;
		const artist = Array.isArray(track.artists)
			? track.artists.map(item => item.name).join(", ")
			: String(track.artist || "");
		const offsetMs = offsetConfig.enabled ? offsetConfig.seconds * 1000 : 0;
		callback({
			track: {
				name: track.name,
				artist,
				album: track.album?.name || track.album || "",
				imageUrl: track.album?.images?.[0]?.url,
				uri: track.uri,
				id: track.id,
				duration: track.duration_ms || track.duration || 0
			},
			status: "switching",
			isPlaying: true,
			progressMs: offsetMs,
			durationMs: track.duration_ms || track.duration || 0,
			receivedAt: Date.now(),
			queue: typeof integration.getOverlayQueue === "function" ? integration.getOverlayQueue() : []
		});
	}

	function installRequesterOverlayBridge(integration) {
		const callbacks = integration?.callbacks;
		if (!callbacks || typeof callbacks.onTrackUpdate !== "function" || callbacks.__cortexRequesterBridge) return;
		const original = callbacks.onTrackUpdate;
		callbacks.onTrackUpdate = function(payload) {
			const requestedUri = integration.currentTrackRequesterUri;
			const requester = requestedUri && payload?.track?.uri === requestedUri
				? integration.currentTrackRequester : "";
			if (payload?.track) {
				const track = { ...payload.track };
				if (requester) track.requester = requester;
				else delete track.requester;
				payload = { ...payload, track };
			}
			return original.call(this, payload);
		};
		callbacks.__cortexRequesterBridge = true;
	}

	function scheduleOverlayRefresh(integration) {
		if (typeof integration?.getCurrentTrack !== "function") return;
		if (integration.spotifyOverlayRefreshTimers) {
			integration.spotifyOverlayRefreshTimers.forEach(timer => clearTimeout(timer));
		}
		const refresh = () => integration.getCurrentTrack().catch(() => {});
		integration.spotifyOverlayRefreshTimers = [
			setTimeout(refresh, 250),
			setTimeout(refresh, 900)
		];
	}

	async function startTrackOnDevice(integration, device, track, startPositionMs = 0) {
		const playRequest = (deviceId = device.id) => {
			const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`;
			const body = { uris: [track.uri] };
			if (startPositionMs > 0) body.position_ms = startPositionMs;
			return spotifyFetch(integration, playUrl, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${integration.accessToken}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
			});
		};

		// Spotify tarda un poco en terminar una transferencia entre dispositivos.
		// Esperar aqui evita que la orden de reproduccion llegue durante ese cambio.
		if (!device.is_active) await waitForSpotify(700);
		let response = await playRequest();
		if (!(response.status === 204 || response.ok)) return response;

		// La API puede responder 204 antes de que el cliente de escritorio actualice
		// su estado. Confirmamos y repetimos una vez si quedo pausado o en otro tema.
		await waitForSpotify(900);
		const stateResponse = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player", {
			headers: { Authorization: `Bearer ${integration.accessToken}` }
		});
		const state = stateResponse.ok ? await stateResponse.json().catch(() => null) : null;
		const isPlayingRequestedTrack = state?.is_playing && state?.item?.uri === track.uri;
		if (!isPlayingRequestedTrack) {
			// Algunos clientes de Spotify para Windows aceptan mejor la orden
			// dirigida al dispositivo activo que la orden con device_id.
			response = await playRequest();
			if (response.status === 204 || response.ok) await waitForSpotify(700);
			const activeStateResponse = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player", {
				headers: { Authorization: `Bearer ${integration.accessToken}` }
			});
			const activeState = activeStateResponse.ok ? await activeStateResponse.json().catch(() => null) : null;
			if (!(activeState?.is_playing && activeState?.item?.uri === track.uri)) {
				response = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player/play", {
					method: "PUT",
					headers: {
						Authorization: `Bearer ${integration.accessToken}`,
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ uris: [track.uri], ...(startPositionMs > 0 ? { position_ms: startPositionMs } : {}) })
				});
			}
		}
		return response;
	}

	async function describeSpotifyDevices(integration) {
		if (!integration.accessToken) return "Spotify no esta conectado.";
		const devices = await getSpotifyDevices(integration);
		if (!devices.length) {
			return "No veo dispositivos de Spotify. Abri Spotify en la PC del OBS y reproduce/pausa algo una vez.";
		}
		return "Dispositivos Spotify: " + devices.map(device => {
			const flags = [];
			if (device.is_active) flags.push("activo");
			if (device.is_restricted) flags.push("restringido");
			return `${device.name || "Sin nombre"} (${device.type || "tipo desconocido"}${flags.length ? ", " + flags.join(", ") : ""})`;
		}).join(" | ");
	}

	function checkCooldown(integration, data) {
		const now = Date.now();
		// Los pedidos del dashboard son del streamer: no consumen esperas.
		const fromDashboard = data?.dashboard === true;
		const bypass = fromDashboard || !!(data?.host || data?.admin || data?.mod);
		const testMode = boolSetting(integration, "testMode", false);
		const cooldownMs = numSetting(integration, "cooldownSeconds", DEFAULT_COOLDOWN_MS / 1000, 0, 3600) * 1000;
		const userCooldownMs = numSetting(integration, "userCooldownSeconds", DEFAULT_USER_COOLDOWN_MS / 1000, 0, 7200) * 1000;

		if (integration.autoMusicInFlight) {
			return { ok: false, message: "Ya estoy procesando un pedido musical. Espera un momento." };
		}

		if (bypass || testMode) {
			// Modo prueba: se saltean las dos esperas (la de un pedido en curso sigue).
			return { ok: true, cooldownMs, userCooldownMs, testMode };
		}

		const globalRemaining = cooldownMs - (now - (integration.lastAutoMusicRequestAt || 0));
		if (globalRemaining > 0) {
			return { ok: false, message: `Espera ${Math.ceil(globalRemaining / 1000)}s para pedir otro tema.` };
		}

		if (!integration.autoMusicUserRequests) integration.autoMusicUserRequests = new Map();
		const key = requesterKey(data);
		const userRemaining = userCooldownMs - (now - (integration.autoMusicUserRequests.get(key) || 0));
		if (userRemaining > 0) {
			return { ok: false, message: `Ya pediste un tema hace poco. Espera ${Math.ceil(userRemaining / 1000)}s.` };
		}

		return { ok: true, cooldownMs, userCooldownMs, testMode };
	}

	async function playTrackNow(integration, query, data) {
		if (!integration.accessToken) {
			return { success: false, message: "Spotify no esta conectado." };
		}

		const cooldown = checkCooldown(integration, data);
		if (!cooldown.ok) return { success: false, message: cooldown.message, blockedByCooldown: true };

		integration.autoMusicInFlight = true;
		try {
			const track = await searchTrack(integration, query);
			if (!track) {
				return { success: false, message: "No encontre ese tema en Spotify." };
			}

			const devices = await getSpotifyDevices(integration);
			const remotePreferredName = await getRemoteDeviceTarget();
			const device = chooseSpotifyDevice(integration, devices, remotePreferredName);
			if (!device) {
				if (remotePreferredName) {
					return {
						success: false,
						message: `No encuentro el dispositivo configurado "${remotePreferredName}". Envia !spotifydevices para ver los nombres disponibles.`
					};
				}
				return {
					success: false,
					message: "No encontre un dispositivo Spotify disponible. Abri Spotify en la PC del OBS y reproduce/pausa algo una vez."
				};
			}
			const activated = await activateSpotifyDevice(integration, device);
			if (!activated) {
				return { success: false, message: "Spotify no pudo activar la PC del OBS." };
			}

			const offsetConfig = await getPlaybackOffsetConfig(integration);
			const response = await startTrackOnDevice(integration, device, track, offsetConfig.enabled ? offsetConfig.seconds * 1000 : 0);

			if (response.status === 204 || response.ok) {
				installRequesterOverlayBridge(integration);
				integration.currentTrackRequester = requesterName(data);
				integration.currentTrackRequesterUri = track.uri;
				// Actualizacion inmediata: el polling normal puede tardar varios segundos.
				emitTrackSwitchHint(integration, track, offsetConfig);
				if (typeof integration.getCurrentTrack === "function") {
					integration.getCurrentTrack().catch(error => {
						console.debug("[Spotify Auto Music] Confirmacion de cambio pendiente:", error.message);
					});
				}
				const continuationState = getContinuationState(integration);
				const autoContinue = boolSetting(integration, "autoContinue", true);
				continuationState.active = autoContinue;
				continuationState.playedUris.add(track.uri);
				if (autoContinue) queueContinuation(integration, track).catch(() => {});
				// Los pedidos lanzados desde el dashboard no consumen esperas del chat.
				if (data?.dashboard !== true) {
					const now = Date.now();
					integration.lastAutoMusicRequestAt = now;
					if (!integration.autoMusicUserRequests) integration.autoMusicUserRequests = new Map();
					integration.autoMusicUserRequests.set(requesterKey(data), now);
				}
				const artists = track.artists.map(artist => artist.name).join(", ");
				return {
					success: true,
					message: `Reproduciendo: ${track.name} - ${artists}`,
					track: { name: track.name, artist: artists, uri: track.uri }
				};
			}

			if (response.status === 404) {
				return {
					success: false,
					message: "No hay dispositivo activo. Abri Spotify y reproduce algo manualmente primero."
				};
			}

			const message = typeof integration.parsePlaybackError === "function"
				? await integration.parsePlaybackError(response, "No pude cambiar el tema")
				: "No pude cambiar el tema";
			return { success: false, message };
		} catch (error) {
			console.warn("[Spotify Auto Music] Error:", error);
			return { success: false, message: "Error procesando el pedido musical." };
		} finally {
			integration.autoMusicInFlight = false;
		}
	}

	// --- Puente con el dashboard de Spotify (Rulo/Spotify) ---

	function reportSpotifyDevices(integration, devices) {
		if (typeof fetch !== "function") return;
		const now = Date.now();
		const forced = integration.spotifyDevicesReportForced === true;
		if (!forced && integration.spotifyDevicesReportedAt && now - integration.spotifyDevicesReportedAt < DEVICES_REPORT_MIN_MS) return;
		integration.spotifyDevicesReportedAt = now;
		integration.spotifyDevicesReportForced = false;
		const payload = (devices || []).map(device => ({
			name: device?.name,
			type: device?.type,
			isActive: device?.is_active === true,
			isRestricted: device?.is_restricted === true,
			volumePercent: device?.volume_percent
		}));
		fetch(CORTEX_DEVICES_REPORT_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				devices: payload,
				activeName: (devices || []).find(device => device?.is_active)?.name || ""
			})
		}).catch(error => console.debug("[Spotify Auto Music] No se pudo reportar dispositivos:", error.message));
	}

	function reportRequestResult(integration, entry) {
		if (typeof fetch !== "function") return;
		fetch(CORTEX_REQUEST_LOG_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				source: entry.source || "chat",
				requester: entry.requester || "",
				query: entry.query || "",
				ok: entry.ok === true,
				message: String(entry.message || "").slice(0, 300),
				track: entry.track || null
			})
		}).catch(error => console.debug("[Spotify Auto Music] No se pudo reportar el pedido:", error.message));
	}

	// Poll: trae los ajustes en vivo del dashboard y, si hay, un comando pendiente.
	async function syncWithCortex(integration) {
		if (typeof fetch !== "function") return null;
		try {
			const url = `${CORTEX_CLIENT_STATE_URL}?alive=1&version=${MODULE_VERSION}&token=${integration.accessToken ? 1 : 0}`;
			const response = await fetch(url, { cache: "no-store" });
			if (!response.ok) return null;
			const data = await response.json().catch(() => null);
			if (!data) return null;
			applyCortexSettings(integration, data.settings);
			if (data.aliases && typeof data.aliases === "object") integration.cortexSpotifyAliases = data.aliases;
			return data;
		} catch (error) {
			console.debug("[Spotify Auto Music] Cortex no respondio:", error.message);
			return null;
		}
	}

	// Aplica los ajustes que llegan del dashboard (por poll o por WebSocket).
	function applyCortexSettings(integration, settings) {
		if (!settings || typeof settings !== "object") return;
		const isFirst = !integration.cortexSpotifySettings;
		integration.cortexSpotifySettings = settings;
		integration.cortexSpotifySettingsAt = Date.now();
		// Si se apago la continuidad, se corta la que este en curso.
		if (settings.autoContinue === false && integration.autoMusicContinuation) {
			integration.autoMusicContinuation.active = false;
		}
		if (isFirst) {
			console.log(`[Spotify Auto Music] Ajustes del dashboard cargados (modo prueba: ${settings.testMode ? "si" : "no"}).`);
		}
		// Si el dashboard cambio la frecuencia de consulta, se aplica ya.
		const desiredPollMs = cortexPollMs(integration);
		if (integration.cortexSyncTimer && integration.cortexPollMs && integration.cortexPollMs !== desiredPollMs) {
			clearTimeout(integration.cortexSyncTimer);
			integration.cortexSyncTimer = null;
			startCortexSync(integration);
		}
	}

	// Los comandos pueden venir sueltos o en lote: se ejecutan en orden.
	function runCommandList(integration, list) {
		const commands = Array.isArray(list) ? list.filter(Boolean) : [];
		return commands.reduce(
			(chain, command) => chain.then(() => runDashboardCommand(integration, command)),
			Promise.resolve()
		);
	}

	// Enlace directo: evita la demora del poll (Brave estrangula los timers de
	// las paginas de fondo a 1 consulta por minuto).
	function connectCortexSocket(integration) {
		if (typeof WebSocket !== "function") return;
		const current = integration.cortexSocket;
		if (current && (current.readyState === 0 || current.readyState === 1)) return;
		let socket;
		try {
			socket = new WebSocket(CORTEX_WS_URL);
		} catch (error) {
			console.debug("[Spotify Auto Music] No se pudo abrir el WebSocket:", error.message);
			return;
		}
		integration.cortexSocket = socket;

		socket.onopen = function() {
			integration.cortexSocketRetryMs = 0;
			console.log("[Spotify Auto Music] Enlace instantaneo con el dashboard listo.");
			// Al reconectar, se sincroniza por las dudas de lo que se perdio.
			syncWithCortex(integration).then(data => (data ? runCommandList(integration, data.commands || data.command) : null)).catch(() => {});
		};

		socket.onmessage = function(event) {
			let payload = null;
			try {
				payload = JSON.parse(event.data);
			} catch (error) {
				return;
			}
			if (!payload) return;
			if (payload.type === "spotify_settings") {
				applyCortexSettings(integration, payload.settings);
				return;
			}
			if (payload.type === "spotify_aliases") {
				if (payload.aliases && typeof payload.aliases === "object") integration.cortexSpotifyAliases = payload.aliases;
				return;
			}
			if (payload.type === "spotify_command" && payload.command) {
				if (payload.settings) applyCortexSettings(integration, payload.settings);
				runDashboardCommand(integration, payload.command)
					.catch(error => console.debug("[Spotify Auto Music] Error ejecutando el comando:", error.message));
			}
		};

		socket.onclose = function() {
			integration.cortexSocket = null;
			const retryMs = Math.min(30000, (integration.cortexSocketRetryMs || 1000) * 2);
			integration.cortexSocketRetryMs = retryMs;
			// El reintento usa setTimeout: si la pagina esta en segundo plano,
			// el navegador puede retrasarlo, pero el poll sigue cubriendo.
			setTimeout(() => connectCortexSocket(integration), retryMs);
		};

		socket.onerror = function() {
			try { socket.close(); } catch (error) {}
		};
	}

	function startCortexSync(integration) {
		if (integration.cortexSyncTimer) return;
		const runOnce = () => syncWithCortex(integration)
			.then(data => (data ? runCommandList(integration, data.commands || data.command) : null))
			.catch(error => console.debug("[Spotify Auto Music] Error en el poll del dashboard:", error.message));
		// Cada cuanto se consulta el dashboard: lo define el propio dashboard
		// (pollSeconds). Es lo que mide la demora entre "Probar" y que suene.
		const schedule = () => {
			const pollMs = cortexPollMs(integration);
			integration.cortexPollMs = pollMs;
			integration.cortexSyncTimer = setTimeout(() => {
				runOnce().then(schedule);
			}, pollMs);
		};
		runOnce();
		schedule();
		// Enlace instantaneo (si el navegador lo permite): el poll queda de respaldo.
		connectCortexSocket(integration);
	}

	// Comandos del dashboard: probar un tema, simular un comentario real,
	// listar dispositivos o mover el transporte (pausa, siguiente...).
	async function runDashboardCommand(integration, command) {
		const type = String(command?.type || "");
		const requester = String(command?.requester || "Dashboard").slice(0, 80);
		const data = { dashboard: true, chatname: requester, type: "dashboard", host: true };
		const announce = boolSetting(integration, "announce", true);

		if (type === "play") {
			if (announce) postRuloBotResponse(`Prueba del dashboard: buscando "${String(command.query || "").slice(0, 60)}"...`, data, "thinking", true);
			const result = await playTrackNow(integration, command.query, data);
			reportRequestResult(integration, {
				source: "dashboard",
				requester,
				query: command.query,
				ok: result.success === true,
				message: result.message,
				track: result.track
			});
			if (announce) postRuloBotResponse(result.message, data, result.success ? "success" : "error");
			return result;
		}

		if (type === "simulate") {
			// Mismo camino que un comentario real: sirve para probar el parser.
			const parsed = parseRequest(command.comment, requestLimits(integration));
			if (command.parseOnly === true) {
				// Solo analiza: dice que entendio, sin tocar Spotify.
				const message = parsed && !parsed.error
					? `Entendi: ${parsed.source === "genre" ? "genero " + parsed.query.replace(/^genre:/, "") : parsed.artist ? "artista/tema de " + parsed.artist : parsed.query}`
					: (parsed?.error || "No lo lei como pedido de musica.");
				reportRequestResult(integration, {
					source: "dashboard",
					requester,
					query: command.comment,
					ok: !!(parsed && !parsed.error),
					message: message + " (solo analisis)"
				});
				if (announce) postRuloBotResponse(message, data, parsed && !parsed.error ? "success" : "warning");
				return { success: !!(parsed && !parsed.error), message, parsed };
			}
			if (!parsed || parsed.error) {
				const message = parsed?.error || "El comentario simulado no se leyo como pedido de musica.";
				reportRequestResult(integration, { source: "dashboard", requester, query: command.comment, ok: false, message });
				if (announce) postRuloBotResponse(message, data, "warning");
				return { success: false, message };
			}
			if (announce) postRuloBotResponse(describeSearchMessage(parsed), data, "thinking", true);
			const result = await playTrackNow(integration, parsed.query, data);
			const message = boolSetting(integration, "personalize", true)
				? personalizeBotMessage(result.message, data)
				: result.message;
			reportRequestResult(integration, {
				source: "dashboard",
				requester,
				query: parsed.query,
				ok: result.success === true,
				message,
				track: result.track
			});
			if (announce) postRuloBotResponse(message, data, result.success ? "success" : "error");
			return result;
		}

		if (type === "search") {
			// Busca con la misma tolerancia a errores que un pedido, sin reproducir.
			const track = await searchTrack(integration, command.query);
			const artists = Array.isArray(track?.artists) ? track.artists.map(artist => artist.name).join(", ") : "";
			const message = track
				? `Encontre: ${track.name}${artists ? " - " + artists : ""} (no reproduje)`
				: `No encontre nada para "${String(command.query || "").slice(0, 60)}".`;
			reportRequestResult(integration, {
				source: "dashboard",
				requester,
				query: command.query,
				ok: !!track,
				message,
				track: track ? { name: track.name, artist: artists, uri: track.uri } : null
			});
			if (announce) postRuloBotResponse(message, data, track ? "success" : "warning");
			return { success: !!track, message, track };
		}

		if (type === "devices") {
			integration.spotifyDevicesReportForced = true;
			const devices = await getSpotifyDevices(integration);
			reportRequestResult(integration, {
				source: "dashboard",
				requester,
				query: "!spotifydevices",
				ok: devices.length > 0,
				message: devices.length
					? `${devices.length} dispositivo(s) detectado(s): ` + devices.map(device => device.name).join(" | ")
					: "No veo dispositivos de Spotify abiertos."
			});
			return { success: true };
		}

		const transportMethods = { pause: "pause", resume: "resume", next: "skip", previous: "previous" };
		const method = transportMethods[type];
		if (method && typeof integration[method] === "function") {
			const result = await integration[method]();
			const ok = result?.success !== false;
			reportRequestResult(integration, {
				source: "dashboard",
				requester,
				query: `transporte:${type}`,
				ok,
				message: ok ? `Comando "${type}" enviado a Spotify.` : `No se pudo ejecutar "${type}".`
			});
			scheduleOverlayRefresh(integration);
			return result;
		}

		return null;
	}

	function install() {
		const SpotifyClass = window.SpotifyIntegration || (typeof SpotifyIntegration !== "undefined" ? SpotifyIntegration : null);
		if (!SpotifyClass || !SpotifyClass.prototype || SpotifyClass.prototype.__autoMusicPatched) return false;

		const originalHandleCommand = SpotifyClass.prototype.handleCommand;
		const originalInitialize = SpotifyClass.prototype.initialize;
		if (typeof originalInitialize === "function" && !SpotifyClass.prototype.__cortexBotNamePatched) {
			SpotifyClass.prototype.initialize = async function(...args) {
				const result = await originalInitialize.apply(this, args);
				if (this.settings) {
					if (this.settings.spotifyBotName && typeof this.settings.spotifyBotName === "object") {
						this.settings.spotifyBotName.textsetting = "Anormalia";
					} else {
						this.settings.spotifyBotName = { textsetting: "Anormalia" };
					}
				}
				// Ajustes en vivo del dashboard de Spotify + comandos remotos.
				startCortexSync(this);
				return result;
			};
			SpotifyClass.prototype.__cortexBotNamePatched = true;
		}
		SpotifyClass.prototype.playAutoMusicTrackNow = function(query, data) {
			return playTrackNow(this, query, data);
		};
		SpotifyClass.prototype.describeAutoMusicDevices = function() {
			return describeSpotifyDevices(this);
		};
		SpotifyClass.prototype.parseAutoMusicRequest = parseRequest;
		// Expuestos para el dashboard y las pruebas.
		SpotifyClass.prototype.describeAutoMusicVariants = function(term) {
			return queryVariants(term);
		};
		SpotifyClass.prototype.getSpotifyAliases = function() {
			const map = this.cortexSpotifyAliases;
			return map && typeof map === "object" ? { ...map } : {};
		};
		SpotifyClass.prototype.describeAutoMusicLimits = function() {
			return requestLimits(this);
		};
		SpotifyClass.prototype.runDashboardSpotifyCommand = function(command) {
			return runDashboardCommand(this, command);
		};
		SpotifyClass.prototype.syncSpotifySettings = function() {
			return syncWithCortex(this);
		};
		SpotifyClass.prototype.getCortexSpotifySettings = function() {
			return cortexSettings(this);
		};
		SpotifyClass.prototype.getCortexPollMs = function() {
			return cortexPollMs(this);
		};
		SpotifyClass.prototype.openDashboardLink = function() {
			connectCortexSocket(this);
			return true;
		};
		SpotifyClass.prototype.__cortexModuleVersion = MODULE_VERSION;
		["skip", "previous", "pause", "resume"].forEach(methodName => {
			const originalTransportMethod = SpotifyClass.prototype[methodName];
			const marker = `__cortexOverlayRefresh_${methodName}`;
			if (typeof originalTransportMethod !== "function" || SpotifyClass.prototype[marker]) return;
			SpotifyClass.prototype[methodName] = async function(...args) {
				const result = await originalTransportMethod.apply(this, args);
				if (result?.success !== false) scheduleOverlayRefresh(this);
				return result;
			};
			SpotifyClass.prototype[marker] = true;
		});
		SpotifyClass.prototype.handleCommand = async function(command, data = {}) {
			if (this.settings) {
				if (this.settings.spotifyBotName && typeof this.settings.spotifyBotName === "object") {
					this.settings.spotifyBotName.textsetting = "Anormalia";
				} else {
					this.settings.spotifyBotName = { textsetting: "Anormalia" };
				}
			}
			const originalResponse = typeof originalHandleCommand === "function"
				? await originalHandleCommand.call(this, command, data)
				: null;
			if (originalResponse) return originalResponse;
			if (/^!spotifyoffset\b/i.test(String(command || "").trim())) {
				const offsetConfig = await getPlaybackOffsetConfig(this);
				const response = `Salto de ${offsetConfig.seconds} segundos: ${offsetConfig.enabled ? "activado" : "desactivado"}.`;
				postRuloBotResponse(response, data, "idle");
				return response;
			}
			if (/^!spotifydevices\b/i.test(String(command || "").trim())) {
				const response = await describeSpotifyDevices(this);
				postRuloBotResponse(response, data, "idle");
				return response;
			}
			startCortexSync(this);
			if (!boolSetting(this, "enabled", true)) return null;
			if (data.bot || data.event || data.private || data.history || data.replay || data.reflection) return null;

			const parsed = parseRequest(command, requestLimits(this));
			if (!parsed) return null;
			const announce = boolSetting(this, "announce", true);
			if (parsed.error) {
				if (announce) postRuloBotResponse(parsed.error, data, "warning");
				return parsed.error;
			}

			// Estado "thinking" en el overlay mientras se resuelve el pedido.
			if (announce) postRuloBotResponse(describeSearchMessage(parsed), data, "thinking", true);
			const result = await playTrackNow(this, parsed.query, data);
			const response = boolSetting(this, "personalize", true)
				? personalizeBotMessage(result.message, data)
				: result.message;
			const mood = result.success ? "success" : (result.blockedByCooldown ? "warning" : "error");
			if (announce) postRuloBotResponse(response, data, mood);
			// El registro del dashboard guarda todos los pedidos del chat, incluso los rechazados.
			reportRequestResult(this, {
				source: "chat",
				requester: requesterName(data),
				query: parsed.query,
				ok: result.success === true,
				message: response,
				track: result.track
			});
			return response;
		};

		const originalGetCurrentTrack = SpotifyClass.prototype.getCurrentTrack;
		if (typeof originalGetCurrentTrack === "function" && !SpotifyClass.prototype.__autoMusicContinuationPatched) {
			SpotifyClass.prototype.getCurrentTrack = async function(...args) {
				installRequesterOverlayBridge(this);
				const previousTrack = this.currentTrack;
				const result = await originalGetCurrentTrack.apply(this, args);
				if (!this.spotifyPlaybackOffsetState) {
					this.spotifyPlaybackOffsetState = { startedUris: new Set(), endedUris: new Set() };
				}
				if (result?.uri) await applyTenSecondPlaybackRule(this, result, this.spotifyPlaybackOffsetState);
				const state = this.autoMusicContinuation;
				if (state?.active && result?.uri && result.uri !== previousTrack?.uri && state.queuedUris.has(result.uri)) {
					state.queuedUris.delete(result.uri);
					queueContinuation(this, result).catch(() => {});
				}
				return result;
			};
			SpotifyClass.prototype.__autoMusicContinuationPatched = true;
		}

		SpotifyClass.prototype.__autoMusicPatched = true;
		console.log(`[Spotify Auto Music] v${MODULE_VERSION} loaded. Dashboard de Spotify (Rulo/Spotify): ajustes en vivo, modo prueba sin esperas y comandos remotos.`);
		return true;
	}

	if (!install()) {
		setTimeout(install, 500);
	}
})();
