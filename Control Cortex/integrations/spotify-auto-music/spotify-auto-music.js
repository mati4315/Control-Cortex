(function() {
	"use strict";

	const DEFAULT_COOLDOWN_MS = 40000;
	const DEFAULT_USER_COOLDOWN_MS = 120000;
	const CACHE_TTL_MS = 10 * 60 * 1000;
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
	const MODULE_VERSION = 55;
	const CORTEX_CLIENT_STATE_URL = CORTEX_BASE_URL + "/api/spotify-client-state";
	const CORTEX_WS_URL = CORTEX_BASE_URL.replace(/^http/i, "ws") + "/api/spotify-ws";
	const CORTEX_REQUEST_LOG_URL = CORTEX_BASE_URL + "/api/spotify-request-log";
	const CORTEX_DEVICES_REPORT_URL = CORTEX_BASE_URL + "/api/spotify-devices-report";
	const CORTEX_ALIASES_URL = CORTEX_BASE_URL + "/api/spotify-aliases";
	const CORTEX_AI_URL = CORTEX_BASE_URL + "/api/spotify-ai-interpret";
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
	// --- Vocabulario (entrenamiento del bot) ---
	// Estas listas son DATOS, no codigo: viven en Rulo/Spotify/spotify-vocabulary.json
	// y se editan desde el dashboard de entrenamiento. Lo de aca abajo es solo el
	// respaldo que se usa si Cortex todavia no respondio.
	const DEFAULT_VOCABULARY = {
		commands: ["!playnow", "!tema", "!musica"],
		// Palabras con las que la gente pide musica ("temita", "temazo"...).
		musicWords: ["tema", "temas", "temita", "temitas", "temon", "temones", "temazo", "temazos", "music", "musica", "musicas", "musicon", "musiquita", "cancion", "canciones", "cancioncita", "track", "tracks", "rola", "rolas", "rolita"],
		// Verbos de pedido. Las frases largas van primero (el regex corta en la primera
		// que coincide): "quiero escuchar" antes que "quiero".
		requestVerbs: ["quiero escuchar", "quiero oir", "me pones", "me podes poner", "podes poner", "podrias poner", "poneme", "ponele", "ponete", "pones", "poner", "pongan", "pone", "pon", "pasame", "pasate", "pasale", "pasen", "pasa", "quiero", "quisiera", "queria", "pedime", "pedia", "pedi", "pedir", "pido", "necesito"],
		// Saludos y muletillas que se sacan antes de analizar el pedido.
		greetings: ["hola", "holis", "buen dia", "buenas tardes", "buenas noches", "buenas", "bue", "que tal", "q tal", "como va", "como andan", "como estas", "como te va", "epa", "hey", "saludos", "aloha", "buenas y santas"],
		fillers: ["che", "por favor", "porfa", "porfavor", "please", "dale", "gracias", "muchas gracias", "amigo", "amiga", "genio", "crack", "maestro", "capo", "grande", "bot", "porfi"],
		articles: ["un", "una", "unos", "unas", "el", "la", "los", "las", "algun", "alguna", "alguno", "algunos", "otro", "otra"],
		// Generos: las palabras de la gente y el genero que entiende Spotify.
		genres: [
			{ id: "bachata", spotify: "bachata", words: ["bachata", "bachatas"] },
			{ id: "blues", spotify: "blues", words: ["blues"] },
			{ id: "chamame", spotify: "chamame", words: ["chamame"] },
			{ id: "cumbia", spotify: "cumbia", words: ["cumbia", "cumbias", "cumbia villera"] },
			{ id: "cuarteto", spotify: "cuarteto", words: ["cuarteto", "cuartetos"] },
			{ id: "electronica", spotify: "electronic", words: ["electronica", "electro", "edm"] },
			{ id: "folklore", spotify: "folk", words: ["folklore", "folclore"] },
			{ id: "funk", spotify: "funk", words: ["funk"] },
			{ id: "jazz", spotify: "jazz", words: ["jazz"] },
			{ id: "merengue", spotify: "merengue", words: ["merengue", "merengues"] },
			{ id: "metal", spotify: "metal", words: ["metal"] },
			{ id: "pop", spotify: "pop", words: ["pop"] },
			{ id: "rap", spotify: "rap", words: ["rap"] },
			{ id: "reggae", spotify: "reggae", words: ["reggae", "regae"] },
			{ id: "reggaeton", spotify: "reggaeton", words: ["reggaeton", "regueton", "regueto", "regeton", "regeaton", "regaeton"] },
			{ id: "romantico", spotify: "romantico", words: ["romantico", "romantica", "romanticos", "romanticas", "romanticon"] },
			{ id: "rock", spotify: "rock", words: ["rock"] },
			{ id: "salsa", spotify: "salsa", words: ["salsa", "salsas"] },
			{ id: "techno", spotify: "techno", words: ["techno", "tekno"] },
			{ id: "trap", spotify: "trap", words: ["trap", "traps"] },
			{ id: "vallenato", spotify: "vallenato", words: ["vallenato", "vallenatos"] }
		],
		// Cambios que se prueban cuando la busqueda no encuentra nada:
		// confusiones tipicas del español (i/y, b/v, s/z, ll/y, qu/k, c/s).
		typoSwaps: [["y", "i"], ["i", "y"], ["b", "v"], ["v", "b"], ["s", "z"], ["z", "s"], ["ll", "y"], ["qu", "k"], ["c", "s"]],
		search: { maxAttempts: 7, variantLimit: 8 },
		// Cerebro (futuro): si esta activado, los comentarios que las reglas no
		// entienden se le consultan a una IA que responde JSON con el pedido.
		ai: {
			enabled: false,
			endpoint: "",
			model: "",
			instructions: "",
			onlyWhenNotUnderstood: true,
			requireSignal: true,
			timeoutMs: 8000
		}
	};

	function vocabulary(integration) {
		const remote = integration && integration.cortexSpotifyVocabulary;
		return remote && typeof remote === "object" ? remote : DEFAULT_VOCABULARY;
	}

	function escapeRegex(value) {
		return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	// Compila las listas en regex y mapas, una sola vez por objeto de vocabulario.
	function compileVocabulary(vocab) {
		if (vocab && vocab.__compiled) return vocab.__compiled;
		const join = list => {
			const words = (Array.isArray(list) ? list : []).map(word => String(word || "").trim()).filter(Boolean);
			// Sin palabras, el patron no debe matchear nunca.
			return words.length ? "(?:" + words.map(escapeRegex).join("|") + ")" : "(?!)";
		};
		const genres = {};
		(Array.isArray(vocab?.genres) ? vocab.genres : []).forEach(entry => {
			const spotify = String(entry?.spotify || entry?.id || "").trim();
			if (!spotify) return;
			(Array.isArray(entry?.words) ? entry.words : []).forEach(word => {
				const key = String(word || "").trim().toLowerCase();
				if (key) genres[key] = spotify;
			});
		});
		const compiled = {
			musicWords: join(vocab?.musicWords),
			requestVerbs: join(vocab?.requestVerbs),
			greetings: join(vocab?.greetings),
			fillers: join(vocab?.fillers),
			articles: join(vocab?.articles),
			genres,
			commands: (Array.isArray(vocab?.commands) ? vocab.commands : []).map(cmd => String(cmd || "").toLowerCase()).filter(Boolean),
			typoSwaps: (Array.isArray(vocab?.typoSwaps) ? vocab.typoSwaps : [])
				.filter(pair => Array.isArray(pair) && pair.length === 2 && pair[0])
				.map(pair => [String(pair[0]), String(pair[1])]),
			maxAttempts: Math.min(12, Math.max(1, Number(vocab?.search?.maxAttempts) || 7)),
			variantLimit: Math.min(16, Math.max(1, Number(vocab?.search?.variantLimit) || 8))
		};
		try {
			Object.defineProperty(vocab, "__compiled", { value: compiled, enumerable: false });
		} catch (error) {}
		return compiled;
	}

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
		const vocab = vocabulary(integration);
		return {
			minTextLength: numSetting(integration, "minTextLength", 8, 3, 120),
			requireCommand: boolSetting(integration, "requireCommand", false),
			vocab,
			regexes: compileVocabulary(vocab)
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

	// Los prefijos de campo NO sirven para buscar: medido contra la API real, Spotify
	// devuelve 0 resultados para "artist:Ke Personajes", "genre:cumbia" y tambien para
	// "track:xxx" (43 consultas con prefijo en el historial, 0 reproducciones; las 86
	// que suenan van con el texto pelado). Asi que se buscan las palabras y el filtro
	// local (temasDelArtista) se encarga de que el resultado sea del artista pedido.
	function sinPrefijosDeCampo(value) {
		return cleanQueryPart(String(value || "").replace(/(?:^|\s)(?:artist|track|genre)\s*:\s*/gi, " "));
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

	// --- Respuestas del bot / Rulo -------------------------------------------
	// Cada momento del pedido tiene un contexto (ok, notFound, waitGlobal...) y cada
	// contexto tiene VARIAS variantes. La fuente de verdad es el bloque "responses"
	// de Rulo/Spotify/spotify-vocabulary.json, que el backend entrega en vivo; aca
	// solo queda el texto viejo como respaldo (fallback) por si nunca llego.
	const replyHistory = new Map();
	// El modulo es una sola integracion (SocialStream Ninja), asi que alcanza con
	// recordar la instancia para poder leer sus respuestas configuradas.
	let activeIntegration = null;

	function responseBlock(context) {
		const vocabulary = activeIntegration && activeIntegration.cortexSpotifyVocabulary;
		const responses = vocabulary && vocabulary.responses;
		const block = responses && responses.contexts && responses.contexts[context];
		if (!block || !Array.isArray(block.variants)) return null;
		const variants = block.variants.map(value => String(value === undefined || value === null ? "" : value).trim()).filter(Boolean);
		if (!variants.length) return null;
		const aiVariants = (Array.isArray(block.aiVariants) ? block.aiVariants : [])
			.map(value => String(value === undefined || value === null ? "" : value).trim())
			.filter(Boolean);
		return { responses, variants, aiVariants };
	}

	function fillPlaceholders(template, values) {
		const data = values || {};
		return String(template || "")
			.replace(/\{(\w+)\}/g, (match, key) => {
				const value = data[key];
				if (value === undefined || value === null) return "";
				const rendered = String(value);
				return key === "pedido" || key === "busqueda"
					? rendered.replace(/\bartist\s*:\s*/gi, "").replace(/\s{2,}/g, " ").trim()
					: rendered;
			})
			// Si quedo alguna llave desconocida (mal escrita a mano o por la IA), se va:
			// nunca tiene que llegar un "{cosa}" al chat.
			.replace(/\{[^}]{0,60}\}/g, "")
			// Limpieza del hueco: "Listo , ya" -> "Listo, ya" y espacios dobles.
			.replace(/\s+([,.;:!?])/g, "$1")
			.replace(/\(\s*\)/g, "")
			.replace(/\s{2,}/g, " ")
			.replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
			.trim();
	}

	function placeholdersOf(template) {
		const found = [];
		String(template || "").replace(/\{(\w+)\}/g, (match, key) => {
			if (found.indexOf(key) === -1) found.push(key);
			return match;
		});
		return found;
	}

	// Elige la variante: al azar, sin repetir las ultimas (si esta activado) y
	// salteando las que piden un dato que en este momento no existe.
	// Devuelve { template, ai } (ai = la escribio la IA en el dashboard).
	function pickResponseVariant(context, values) {
		const block = responseBlock(context);
		if (!block) return null;
		const responses = block.responses || {};
		const usable = block.variants.filter(variant => placeholdersOf(variant).every(name => {
			const value = values && values[name];
			return value !== undefined && value !== null && String(value).length > 0;
		}));
		const pool = usable.length ? usable : block.variants;
		const esDeIa = variante => (block.aiVariants || []).indexOf(String(variante).trim()) !== -1;
		if (responses.random === false) return { template: pool[0], ai: esDeIa(pool[0]) };

		const recent = Math.max(0, Math.min(10, Number(responses.recent) || 0));
		const keepHistory = responses.avoidRepeat !== false && recent > 0;
		const history = keepHistory ? (replyHistory.get(context) || []) : [];
		let available = pool.filter(item => history.indexOf(item) === -1);
		if (!available.length) {
			// Ya salieron todas: se reinicia la memoria corta de ese contexto,
			// pero igual se evita repetir la ultima si hay otra opcion.
			const ultima = history[history.length - 1];
			replyHistory.set(context, []);
			available = pool.filter(item => item !== ultima);
			if (!available.length) available = pool;
		}
		const chosen = available[Math.floor(Math.random() * available.length)];
		if (keepHistory) replyHistory.set(context, (replyHistory.get(context) || []).concat([chosen]).slice(-recent));
		return { template: chosen, ai: esDeIa(chosen) };
	}

	function lowerFirstWord(text) {
		// "Buscando" -> "buscando", pero "SIN NOMBRE" queda como esta (siglas).
		const value = String(text || "");
		if (!value) return value;
		if (/^[A-ZÁÉÍÓÚÑÜ]{2,}/.test(value)) return value;
		return value.charAt(0).toLowerCase() + value.slice(1);
	}

	// Texto final de una respuesta: variante configurada + datos + nombre del que
	// pidio. Si no hay nada configurado (o el backend nunca contesto) devuelve el
	// texto de siempre, tal cual.
	function replyText(context, values, fallback) {
		const data = values || {};
		if (data.integration) activeIntegration = data.integration;
		const elegida = pickResponseVariant(context, data);
		const template = (elegida && elegida.template) || String(fallback || "");
		const deIa = !!(elegida && elegida.ai);
		const hadName = template.indexOf("{nombre}") !== -1;
		let text = fillPlaceholders(template, data);
		if (!text) return fillPlaceholders(String(fallback || ""), data);
		const firstName = data.nombre ? String(data.nombre) : "";
		const personalize = !activeIntegration || boolSetting(activeIntegration, "personalize", true) !== false;
		if (!hadName && firstName && personalize) {
			text = /^Reproduciendo:/i.test(text)
				? `Listo ${firstName}, ya se esta ${lowerFirstWord(text)}`
				: `${firstName}, ${lowerFirstWord(text)}`;
		}
		// Queda anotado de que contexto salio y que variante se uso: va al historial.
		if (activeIntegration) {
			const responses = (activeIntegration.cortexSpotifyVocabulary || {}).responses || {};
			activeIntegration.cortexLastReply = {
				context,
				variant: template,
				text,
				random: responses.random !== false,
				ai: deIa
			};
		}
		return text;
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
				source: data?.type === 'auto' ? 'auto' : 'request',
				triggerId: data?.ruloAnimationTriggerId || '',
				animationStarted: data?.ruloAnimationStarted === true,
				mood: mood || "success",
				// Un provisorio se muestra enseguida pero no queda como respuesta definitiva.
				provisional: provisional === true,
				timestamp: Date.now()
			})
		}).catch(error => console.debug("[Rulo] No se pudo enviar la respuesta al overlay:", error.message));
	}

	async function prepareRuloSpeechForPlayback(integration, data) {
		if (!boolSetting(integration, "announce", true) || data?.type === "auto" || !boolSetting(integration, "ruloEnabled", true)) return;
		try {
			const response = await fetch(CORTEX_BASE_URL + "/api/rulo-speech-start", {
				method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({})
			});
			if (!response.ok) return;
			const sync = await response.json().catch(() => null);
			if (!sync?.started || !sync.triggerId) return;
			data.ruloAnimationTriggerId = String(sync.triggerId);
			data.ruloAnimationStarted = true;
			const delayMs = Math.max(0, Math.min(120000, Number(sync.delayMs) || 0));
			if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
		} catch (error) {
			console.debug("[Rulo] No se pudo sincronizar la música con la respuesta:", error.message);
		}
	}

	// Texto del aviso "pensando" que se muestra mientras se busca en Spotify.
	function describeSearchMessage(parsed) {
		const query = String((parsed && parsed.query) || "").trim();
		if (!query) return replyText("searching", {}, "Buscando en Spotify...");
		if (/^genre:/i.test(query)) {
			const genero = query.slice(6);
			return replyText("searching", { busqueda: genero, genero: genero }, `Buscando algo de ${genero}...`);
		}
		return replyText("searching", { busqueda: query.slice(0, 60) }, `Buscando "${query.slice(0, 60)}" en Spotify...`);
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
	function stripNoise(text, rx) {
		let out = String(text || "");
		out = out.replace(regex("^" + rx.greetings + "[\\s,.:;!¡-]*"), " ");
		out = out.replace(regex("@[\\w.]+", "g"), " ");
		out = out.replace(regex("\\b" + rx.fillers + "\\b", "gi"), " ");
		return out.replace(/\s+/g, " ").trim();
	}

	// Palabras que valen como artista o titulo (descarta articulos y conectores).
	function usefulWords(value, rx) {
		const stop = regex("^(?:" + rx.articles + "|de|del|al|a|y|o|con|para|que|mi|me|te|se|un|es|son)$");
		return String(value || "")
			.split(/\s+/)
			.filter(word => word.length > 2 && !stop.test(word));
	}

	// "laberiso" -> "la beriso": articulo pegado al nombre, tipico en el chat.
	// Se prueban los cortes de mas largo a mas corto y gana el que sea un articulo.
	function splitGluedArticle(value, rx) {
		const term = String(value || "").trim();
		if (term.indexOf(" ") !== -1) return "";
		const isArticle = candidate => regex("^(?:" + rx.articles + ")$").test(candidate);
		for (let size = Math.min(5, term.length - 4); size >= 2; size -= 1) {
			const prefix = term.slice(0, size);
			const rest = term.slice(size);
			if (rest.length >= 4 && isArticle(prefix)) return `${prefix} ${rest}`;
		}
		return "";
	}

	// "los palmeras" -> "palmeras": por si el buscador se traba con el articulo.
	function dropArticles(value, rx) {
		return String(value || "")
			.replace(regex("\\b(?:" + rx.articles + "|del|de)\\b", "gi"), " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function parseGenreRequest(text, rx) {
		const cleaned = stripNoise(text, rx)
			.replace(regex("^(?:" + rx.requestVerbs + ")\\s+"), "")
			.replace(regex("^(?:" + rx.articles + ")\\s+"), "")
			.replace(regex("^(?:" + rx.musicWords + ")(?:\\s+de)?\\s+"), "")
			.replace(/^(?:de|del)\s+/i, "")
			.trim();
		const genre = rx.genres[cleaned];
		return genre ? { genre, query: `genre:${genre}`, source: "genre" } : null;
	}

	// Contexto de parseo: los ajustes (largo minimo, solo comandos) + el vocabulario.
	function parsingContext(limits) {
		const options = limits && typeof limits === "object" ? limits : {};
		const vocab = options.vocab && typeof options.vocab === "object" ? options.vocab : DEFAULT_VOCABULARY;
		return {
			minTextLength: Number.isFinite(Number(options.minTextLength))
				? Number(options.minTextLength)
				: DEFAULT_CORTEX_SETTINGS.minTextLength,
			requireCommand: options.requireCommand === true,
			vocab,
			rx: options.regexes || compileVocabulary(vocab)
		};
	}

	function parseRequest(message, limits) {
		const ctx = parsingContext(limits);
		const rx = ctx.rx;
		const raw = normalizeText(message);
		if (!raw) return null;

		// Los comandos son explicitos: no les afecta el largo minimo.
		const command = rx.commands.find(cmd => raw === cmd || raw.startsWith(cmd + " "));
		if (command) {
			const query = cleanQueryPart(raw.slice(command.length));
			if (!query || query.length < 3) {
				return { error: replyText("usage", { comando: command }, `Uso: ${command} <tema o artista>`) };
			}
			return { query, source: "command" };
		}

		// El largo minimo filtra solo el lenguaje natural.
		if (raw.length < ctx.minTextLength) return null;

		if (raw.startsWith("!")) return null;

		// Modo "solo comandos": ignora el lenguaje natural del chat.
		if (ctx.requireCommand) return null;

		// Sin saludos ni muletillas: "hola matias un temita de los palmeras".
		const text = stripNoise(raw, rx);
		if (text.length < 4) return null;

		const genreRequest = parseGenreRequest(text, rx);
		if (genreRequest) return genreRequest;

		// "tema Titulo - Artista" y "tema de Titulo - Artista".
		const pairText = text
			.replace(regex("^(?:" + rx.requestVerbs + ")\\s+"), "")
			.replace(regex("^(?:" + rx.articles + "\\s+)?(?:" + rx.musicWords + ")\\s+"), "")
			.trim();
		const explicitMatch = pairText.match(/^de\s+(.+?)\s+-\s+(.+)$/) || pairText.match(/^(.+?)\s+-\s+(.+)$/);
		if (explicitMatch && /-/.test(text)) {
			const title = cleanQueryPart(explicitMatch[1].replace(regex("\\b(?:" + rx.musicWords + ")\\b", "g"), " "));
			const artist = cleanQueryPart(explicitMatch[2]);
			if (title && artist) return { artist, title, query: `track:${title} artist:${artist}`, source: "natural" };
		}

		// "de ARTISTA el tema TITULO" ("quiero la musica de Amar Azul el tema Yo Tomo Licor").
		let match = text.match(regex("\\bde\\s+(.+?)\\s+(?:el\\s+)?" + rx.musicWords + "\\s+(.+)$"));
		if (match) {
			const artist = cleanQueryPart(match[1]);
			const title = cleanQueryPart(match[2]);
			if (artist && title && artist.length >= 3) return { artist, title, query: `track:${title} artist:${artist}`, source: "natural" };
		}

		// "poneme TITULO de ARTISTA".
		match = text.match(regex("\\b(?:" + rx.requestVerbs + ")\\s+(.+?)\\s+de\\s+(.+)$"));
		if (match) {
			const title = cleanQueryPart(match[1].replace(regex("\\b(?:" + rx.musicWords + ")\\b", "g"), " "));
			const artist = cleanQueryPart(match[2]);
			if (artist && title && usefulWords(title, rx).length) return { artist, title, query: `track:${title} artist:${artist}`, source: "natural" };
		}

		// Artista en cualquier parte del comentario: "un tema de laberiso",
		// "hola matias un temita de los palmeras", "un tema del polaco".
		match = text.match(regex("\\b" + rx.musicWords + "\\s+(?:de\\s+|del\\s+|la\\s+|el\\s+|los\\s+|las\\s+)?(.+)$"));
		if (match) {
			const artist = normalizeArtistPhrase(match[1]);
			if (usefulWords(artist, rx).length || artist.length >= 4) {
				return { artist, query: `artist:${artist}`, source: "natural" };
			}
		}

		// Verbo + artista, sin la palabra "tema": "pasame a ke personajes",
		// "quiero escuchar ke personajes", "poneme amar azul".
		match = text.match(regex("\\b(?:" + rx.requestVerbs + ")\\s+(?:(?:" + rx.articles + "|de|del|al|a)\\s+)?(.+)$"));
		if (match) {
			const candidate = cleanQueryPart(match[1].replace(regex("\\b(?:" + rx.musicWords + ")\\b", "g"), " "));
			if (candidate.length >= 4 && usefulWords(candidate, rx).length) return { query: candidate, source: "natural" };
		}

		return null;
	}

	// Spotify frena las consultas muy seguidas (HTTP 429). Cuando eso pasa se anota
	// hasta cuando hay que esperar: insistir empeora el bloqueo y ademas hace que el
	// bot conteste "no encontre el tema" aunque el tema SI exista.
	function anotarFrenazo(integration, response) {
		if (!integration || !response) return;
		integration.spotifyUltimoEstado = response.status;
		if (!response.status) {
			// Sin respuesta: la app se colgo o se corto la conexion. Se anota para
			// contestar la verdad en vez de decir que el tema no existe.
			integration.spotifySinRespuestaHasta = Date.now() + 8000;
			return;
		}
		if (response.status !== 429) return;
		let segundos = 0;
		try {
			const cabecera = response.headers && typeof response.headers.get === "function"
				? response.headers.get("Retry-After")
				: "";
			segundos = Number(String(cabecera || "").trim());
		} catch (error) {
			segundos = 0;
		}
		const ms = Number.isFinite(segundos) && segundos > 0 ? Math.min(120000, segundos * 1000) : 15000;
		integration.spotifyFrenadoHasta = Date.now() + ms;
		console.log(`[Spotify Auto Music] Spotify freno las consultas (429): espero ${Math.round(ms / 1000)}s antes de buscar de nuevo`);
	}

	// Cuantos segundos faltan para poder volver a consultar (0 = via libre).
	function spotifyFrenado(integration) {
		const hasta = Number(integration?.spotifyFrenadoHasta || 0);
		if (!hasta || hasta <= Date.now()) return 0;
		return Math.ceil((hasta - Date.now()) / 1000);
	}

	// Si Spotify (o la app) no contesta, la espera no puede ser infinita: el bot
	// se quedaria trabado y todos los pedidos siguientes responderian "estoy ocupado".
	async function conTiempoLimite(integration, url, options) {
		const limite = Number(integration?.spotifyTimeoutMs || 12000);
		if (limite <= 0 || typeof AbortController !== "function") return fetch(url, options);
		const control = new AbortController();
		const reloj = setTimeout(() => control.abort(), limite);
		try {
			const opciones = Object.assign({}, options, { signal: control.signal });
			return await fetch(url, opciones);
		} catch (error) {
			if (control.signal.aborted || (error && error.name === "AbortError")) {
				console.log(`[Spotify Auto Music] Spotify no respondio en ${Math.round(limite / 1000)}s: sigo sin trabar el bot`);
				return { ok: false, status: 0, headers: { get: () => null }, json: async () => ({}) };
			}
			throw error;
		} finally {
			clearTimeout(reloj);
		}
	}

	// Cuantos segundos quedan de "Spotify no responde" (0 = responde bien).
	function spotifySinRespuesta(integration) {
		const hasta = Number(integration?.spotifySinRespuestaHasta || 0);
		if (!hasta || hasta <= Date.now()) return 0;
		return Math.ceil((hasta - Date.now()) / 1000);
	}

	async function spotifyFetch(integration, url, options, retry) {
		const response = await conTiempoLimite(integration, url, options);
		if (response.status === 401 && retry !== false && typeof integration.refreshAccessToken === "function") {
			await integration.refreshAccessToken();
			const nextOptions = Object.assign({}, options, {
				headers: Object.assign({}, options?.headers, {
					Authorization: `Bearer ${integration.accessToken}`
				})
			});
			const reintento = await conTiempoLimite(integration, url, nextOptions);
			anotarFrenazo(integration, reintento);
			return reintento;
		}
		anotarFrenazo(integration, response);
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
	function queryVariants(value, rx) {
		const rules = rx || compileVocabulary(DEFAULT_VOCABULARY);
		const term = String(value || "").trim();
		if (!term) return [];
		const out = [];
		const push = candidate => {
			const clean = cleanQueryPart(candidate);
			if (!clean || clean.toLowerCase() === term.toLowerCase()) return;
			if (out.some(item => item.toLowerCase() === clean.toLowerCase())) return;
			if (out.length < rules.variantLimit) out.push(clean);
		};

		push(splitGluedArticle(term, rules));
		push(dropArticles(term, rules));

		const words = term.split(/\s+/);
		words.forEach((word, index) => {
			if (word.length < 5) return;
			rules.typoSwaps.forEach(([from, to]) => {
				if (out.length >= rules.variantLimit || word.indexOf(from) === -1) return;
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

	// Cuando piden "un tema de X" (artista) o "algo de Y" (genero) sin decir cual,
	// no tiene sentido devolver siempre el primero de Spotify: se arma una bolsa
	// mezclada por artista/genero y se van sacando temas, sin repetir ninguno hasta
	// agotarla. Al agotarse se mezcla de nuevo, salteando los que ya sonaron en la
	// sesion. Los nombres repetidos (el single y el del disco) cuentan una sola vez.
	function mezclarTemas(lista) {
		const copia = lista.slice();
		for (let i = copia.length - 1; i > 0; i -= 1) {
			const j = Math.floor(Math.random() * (i + 1));
			[copia[i], copia[j]] = [copia[j], copia[i]];
		}
		return copia;
	}

	function pickVariedTrack(integration, clave, candidatos) {
		const nombres = new Set();
		const lista = (candidatos || []).filter(track => {
			if (!track || !track.uri) return false;
			const nombre = String(track.name || "").toLowerCase().trim();
			if (nombre && nombres.has(nombre)) return false;
			if (nombre) nombres.add(nombre);
			return true;
		});
		if (!lista.length) return null;

		const disponibles = new Set(lista.map(track => track.uri));
		if (!integration.artistBags) integration.artistBags = new Map();
		let bolsa = integration.artistBags.get(clave);
		if (!bolsa) {
			bolsa = { cola: [], ultimo: "" };
			integration.artistBags.set(clave, bolsa);
		}
		// Lo que ya no aparece en la busqueda sale de la bolsa.
		bolsa.cola = bolsa.cola.filter(uri => disponibles.has(uri));

		if (!bolsa.cola.length) {
			const estado = getContinuationState(integration);
			const yaSonaron = estado && estado.playedUris ? estado.playedUris : new Set();
			const frescos = lista.filter(track => !yaSonaron.has(track.uri));
			const fuente = frescos.length ? frescos : lista;   // si ya salieron todos, se permite repetir
			bolsa.cola = mezclarTemas(fuente.map(track => track.uri));
			// Que la bolsa nueva no arranque con el que acaba de sonar.
			if (bolsa.cola.length > 1 && bolsa.cola[0] === bolsa.ultimo) {
				bolsa.cola.push(bolsa.cola.shift());
			}
		}

		const elegidoUri = bolsa.cola.shift();
		bolsa.ultimo = elegidoUri;
		const elegido = lista.find(track => track.uri === elegidoUri) || lista[0];
		return { track: elegido, candidatos: lista.length, frescos: bolsa.cola.length };
	}

	// Nombre de artista comparable: minusculas, sin acentos, sin puntuacion.
	function normalizarArtista(valor) {
		return String(valor || "")
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[^a-z0-9\s]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	// Deja solo los temas que son realmente del artista (por su nombre).
	function temasDelArtista(tracks, nombre) {
		const buscado = normalizarArtista(nombre);
		if (!buscado) return tracks || [];
		return (tracks || []).filter(track => (track && track.artists ? track.artists : []).some(artista => {
			const suyo = normalizarArtista(artista && artista.name);
			return suyo === buscado || suyo.indexOf(buscado) !== -1 || buscado.indexOf(suyo) !== -1;
		}));
	}

	// "artist:polaco" no alcanza: Spotify busca por palabras y puede devolver
	// cualquier cosa (paso de verdad: devolvia "Beautiful - Tan Bionica" para
	// "un tema del polaco"). Aca se resuelve el nombre real del artista y despues
	// se busca con ESE nombre, que si encuentra lo correcto.
	async function resolverArtista(integration, term) {
		const clave = normalizarArtista(term);
		if (!clave) return null;
		if (!integration.artistasResueltos) integration.artistasResueltos = new Map();
		if (integration.artistasResueltos.has(clave)) return integration.artistasResueltos.get(clave);
		const response = await spotifyFetch(
			integration,
			`https://api.spotify.com/v1/search?q=${encodeURIComponent(term)}&type=artist&limit=5`,
			{ headers: { Authorization: `Bearer ${integration.accessToken}` } }
		);
		// Un error (429, 5xx, red) es TRANSITORIO: no se guarda, asi el proximo
		// pedido lo vuelve a intentar en vez de quedar roto toda la sesion.
		if (response.status === 429 || !response.ok) {
			console.log(`[Spotify Auto Music] Busqueda de artista "${term}" no disponible (HTTP ${response.status}): se reintenta en el proximo pedido`);
			return null;
		}
		const data = await response.json().catch(() => null);
		const artistas = Array.isArray(data && data.artists && data.artists.items) ? data.artists.items : [];
		console.log(`[Spotify Auto Music] Artistas para "${term}": ${artistas.map(a => a && a.name).filter(Boolean).join(" | ") || "(ninguno)"}`);
		const elegido = artistas.find(artista => normalizarArtista(artista && artista.name) === clave)
			|| artistas.find(artista => normalizarArtista(artista && artista.name).indexOf(clave) !== -1)
			|| null;
		integration.artistasResueltos.set(clave, elegido);
		if (elegido) console.log(`[Spotify Auto Music] Artista "${term}" resuelto como "${elegido.name}"`);
		return elegido;
	}

	// Los temas de un artista: primero su catalogo real (top-tracks, lo mismo que
	// muestra Spotify), y si no hay, la busqueda por su nombre. Devuelve [] si no
	// se pudo traer nada (y lo dice en el log, para no adivinar).
	async function temasDelArtistaReal(integration, artista, limite) {
		if (!artista || !artista.id) return [];
		const respuesta = await spotifyFetch(
			integration,
			`https://api.spotify.com/v1/artists/${encodeURIComponent(artista.id)}/top-tracks?market=from_token`,
			{ headers: { Authorization: `Bearer ${integration.accessToken}` } }
		);
		if (!respuesta.ok) {
			console.log(`[Spotify Auto Music] Catalogo de ${artista.name} no disponible (HTTP ${respuesta.status})`);
			return [];
		}
		const datos = await respuesta.json().catch(() => null);
		const temas = Array.isArray(datos && datos.tracks) ? datos.tracks : [];
		console.log(`[Spotify Auto Music] Catalogo de ${artista.name}: ${temas.length} temas`);
		return temas.slice(0, limite);
	}

	// Spotify Development Mode admite hasta 10 resultados por petición.
	// Conservamos el tamaño del grupo de variedad mediante páginas pequeñas.
	async function searchTrackPages(integration, query, count) {
		const tracks = [];
		for (let offset = 0; offset < count;) {
			const limit = Math.min(10, count - offset);
			const response = await spotifyFetch(integration,
				`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}&offset=${offset}`,
				{ headers: { Authorization: `Bearer ${integration.accessToken}` } });
			if (!response.ok) {
				if (response.status !== 429) integration.cortexSearchError = `Spotify rechazó la búsqueda (HTTP ${response.status}). Intenta de nuevo en unos segundos.`;
				console.warn(`[Spotify Auto Music] Búsqueda rechazada: HTTP ${response.status}, limit=${limit}, offset=${offset}`);
				return null;
			}
			const data = await response.json().catch(() => null);
			if (!Array.isArray(data?.tracks?.items)) {
				integration.cortexSearchError = 'Spotify devolvió una respuesta de búsqueda inválida. Intenta de nuevo.';
				return null;
			}
			tracks.push(...data.tracks.items.filter(Boolean));
			offset += limit;
			if (!data.tracks.next || data.tracks.items.length < limit) break;
		}
		return tracks;
	}

	async function searchTrack(integration, query) {
		integration.cortexSearchError = '';
		const campo = String(query).match(/^(artist|genre):/i);
		// Pedido "abierto": nombraron un artista o un genero, pero no un tema puntual.
		const abierto = !!campo && boolSetting(integration, "artistVariety", true);
		const cached = abierto ? null : getCachedTrack(integration, query);
		if (cached) return cached;

		// Si Spotify nos acaba de frenar, no se busca: se devuelve null y quien llama
		// avisa la verdad (frenado) en vez de decir que el tema no existe.
		const espera = spotifyFrenado(integration);
		if (espera) {
			console.log(`[Spotify Auto Music] Busqueda salteada por el frenazo de Spotify (faltan ${espera}s)`);
			return null;
		}

		const rx = compileVocabulary(vocabulary(integration));
		const fieldMatch = String(query).match(/^(artist|track|genre):\s*(.+)$/i);
		const field = fieldMatch ? fieldMatch[1].toLowerCase() : "";
		const term = fieldMatch ? fieldMatch[2].trim() : String(query).trim();

		// Pedido de artista: primero se resuelve el nombre real (polaco -> El Polaco) y
		// se busca con ese nombre. Ademas se descarta todo lo que no sea de ese artista,
		// que es lo que evita que salga un tema cualquiera.
		if (abierto && field === "artist") {
			const artista = await resolverArtista(integration, term);
			if (artista && artista.name) {
				const limite = numSetting(integration, "artistVarietyPool", 20, 5, 50);
				// 1) su catalogo real, que es lo que Spotify conoce de ese artista.
				let suyos = await temasDelArtistaReal(integration, artista, limite);
				// 2) si el catalogo vino vacio, la busqueda por su nombre.
				if (!suyos.length) {
					// OJO: la Web API de Spotify devuelve 0 resultados para "artist:xxx"
					// (comprobado: "artist:Ke Personajes" y "genre:cumbia" fallan, y el
					// nombre pelado encuentra). Se busca por el nombre y el filtro
					// temasDelArtista() de mas abajo se encarga de que sea de ese artista.
					const crudos = await searchTrackPages(integration, artista.name, limite);
					if (!crudos) return null;
					suyos = temasDelArtista(crudos, artista.name);
				}
				if (suyos.length) {
					const resultado = pickVariedTrack(integration, normalizarArtista(artista.name), suyos);
					const elegido = resultado ? resultado.track : suyos[0];
					console.log(`[Spotify Auto Music] "${term}" -> ${artista.name}: ${elegido.name} (${suyos.length} candidatos)`);
					return elegido;
				}
				console.log(`[Spotify Auto Music] "${term}": ${artista.name} resuelto pero sin temas disponibles`);
			}
		}

		// Para pedidos de artista, lo que devuelve Spotify se filtra por artista real:
		// sin esto, "un tema del polaco" traia "Beautiful - Tan Bionica" (paso de verdad).
		const soloDelArtista = pedido => abierto && field === "artist" && term.length >= 3 ? temasDelArtista(pedido, term) : pedido;

		const attempts = [];
		const addAttempt = candidate => {
			const clean = cleanQueryPart(candidate);
			if (!clean || attempts.length >= rx.maxAttempts) return;
			if (attempts.some(item => item.toLowerCase() === clean.toLowerCase())) return;
			attempts.push(clean);
		};

		// 1) el texto sin prefijos (el unico que funciona de verdad)  2) la correccion
		// aprendida  3) variantes por errores de escritura. Para los pedidos de artista,
		// soloDelArtista() de abajo sigue garantizando que el tema sea de ese artista.
		const plano = sinPrefijosDeCampo(query) || term;
		addAttempt(plano);
		const learned = aliasFor(integration, term);
		if (learned) addAttempt(learned);
		queryVariants(plano, rx).forEach(variant => addAttempt(variant));

		for (const attempt of attempts) {
			// Para pedidos abiertos se piden mas resultados (para poder elegir al azar).
			const limite = abierto
				? numSetting(integration, "artistVarietyPool", 20, 5, 50)
				: (attempt.startsWith("genre:") ? 10 : 3);
			const crudosDelIntento = await searchTrackPages(integration, attempt, limite);
			if (!crudosDelIntento) return null;
			// Filtro de red de seguridad: si el intento trajo temas que NO son del
			// artista pedido, no sirven (mejor no encontrar que poner otra cosa).
			const tracks = soloDelArtista(crudosDelIntento);
			if (crudosDelIntento.length && !tracks.length) {
				console.log(`[Spotify Auto Music] "${attempt}": ${crudosDelIntento.length} resultados, ninguno del artista pedido`);
			}
			if (tracks[0]) {
				let elegido = tracks[0];
				if (abierto) {
					const resultado = pickVariedTrack(integration, term.toLowerCase(), tracks);
					if (resultado) {
						elegido = resultado.track;
						console.log(`[Spotify Auto Music] "${term}": tema al azar -> ${elegido.name} (${resultado.candidatos} candidatos, ${resultado.frescos} sin repetir)`);
					}
				} else {
					setCachedTrack(integration, query, tracks[0]);
				}
				// Si hubo que corregir la escritura, se aprende para la proxima.
				if (attempt.toLowerCase() !== String(query).toLowerCase()) {
					rememberAlias(integration, term, attempt, elegido);
				}
				return elegido;
			}
		}
		return null;
	}

	// Pausa y reanudar: la version de SocialStream (PUT /me/player/pause sin indicar
	// dispositivo) falla en la app de la Microsoft Store, aunque next/previous si
	// andan. Se prueban variantes en orden y se guarda el motivo real de la ultima.
	function opcionesDeControl(integration, conCuerpo) {
		const headers = { Authorization: `Bearer ${integration.accessToken}` };
		if (!conCuerpo) return { method: "PUT", headers };
		return {
			method: "PUT",
			headers: Object.assign({ "Content-Type": "application/json" }, headers),
			body: "{}"
		};
	}

	async function motivoDeRespuesta(response) {
		if (response.status === 204 || response.ok) return "";
		let texto = "";
		try {
			texto = JSON.stringify(await response.json()).slice(0, 150);
		} catch (error) {
			texto = "";
		}
		return `HTTP ${response.status}${texto ? " " + texto : ""}`;
	}

	async function controlarReproduccion(integration, accion) {
		if (!integration.accessToken) {
			return { success: false, message: replyText("noToken", {}, "Spotify no esta conectado.") };
		}
		const esPausa = accion === "pause";
		const ruta = esPausa ? "pause" : "play";
		const devices = await getSpotifyDevices(integration);
		const device = chooseSpotifyDevice(integration, devices, await getRemoteDeviceTarget());
		const conDispositivo = device && device.id
			? `https://api.spotify.com/v1/me/player/${ruta}?device_id=${encodeURIComponent(device.id)}`
			: `https://api.spotify.com/v1/me/player/${ruta}`;
		const sinDispositivo = `https://api.spotify.com/v1/me/player/${ruta}`;
		const nombre = device ? device.name : "la PC";

		const planes = [
			{ descripcion: `con el dispositivo ${nombre}`, url: conDispositivo, conCuerpo: !esPausa },
			{ descripcion: "sin cuerpo", url: conDispositivo, conCuerpo: false },
			{ descripcion: "sin indicar dispositivo (como SocialStream)", url: sinDispositivo, conCuerpo: false },
			{ descripcion: `activando ${nombre} primero`, url: conDispositivo, conCuerpo: !esPausa, activar: true }
		];

		const intentos = [];
		for (const plan of planes) {
			if (plan.activar) {
				if (!device) continue;
				// Traspaso propio: al reanudar conviene que arranque la musica, al
				// pausar no (si no, suena un instante y despues se pausa).
				const traspaso = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player", {
					method: "PUT",
					headers: {
						Authorization: `Bearer ${integration.accessToken}`,
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ device_ids: [device.id], play: !esPausa })
				});
				const activado = traspaso.status === 204 || traspaso.ok;
				if (!activado) {
					intentos.push(`${plan.descripcion}: no se pudo activar (${await motivoDeRespuesta(traspaso)})`);
					continue;
				}
			}
			const response = await spotifyFetch(integration, plan.url, opcionesDeControl(integration, plan.conCuerpo));
			if (response.status === 204 || response.ok) {
				console.log(`[Spotify Auto Music] ${accion} OK (${plan.descripcion})`);
				return { success: true, message: `${accion} ok`, intentos };
			}
			const motivo = await motivoDeRespuesta(response);
			if (esRestriccionViolada(motivo)) {
				const estado = await estadoDelReproductor(integration);
				const yaEsta = estado && (esPausa ? estado.is_playing === false : estado.is_playing === true);
				if (yaEsta) {
					console.log(`[Spotify Auto Music] ${accion}: Spotify contesto "Restriction violated" y el estado lo confirma (ya estaba)`);
					return { success: true, message: `${accion}: ya estaba`, yaEstaba: true, intentos };
				}
			}
			intentos.push(`${plan.descripcion}: ${motivo}`);
			console.log(`[Spotify Auto Music] ${accion} fallo (${plan.descripcion}): ${motivo}`);
		}
		return { success: false, message: intentos.join(" | "), intentos };
	}

	// Estado del reproductor que ve la API (is_playing, tema, dispositivo).
	async function estadoDelReproductor(integration) {
		const response = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player", {
			headers: { Authorization: `Bearer ${integration.accessToken}` }
		});
		if (!response.ok) return null;
		return await response.json().catch(() => null);
	}

	// Spotify responde 403 "Player command failed: Restriction violated" cuando el
	// reproductor YA esta en el estado pedido: al pausar algo ya pausado, al reanudar
	// algo que ya suena, o al saltar cuando no hay a donde. No es un error real: hay
	// que confirmar el estado antes de decir que fallo.
	function esRestriccionViolada(motivo) {
		return /restriction violated/i.test(String(motivo || ""));
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
			return null;
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

	// Limites por cancion que manda la biblioteca (start_at / end_at de SQLite).
	// Se guardan por URI y los usa la regla de offset: permite que cada tema
	// arranque despues de su intro y corte antes de su final.
	function getTrackLimits(integration) {
		if (!integration.cortexTrackLimits) integration.cortexTrackLimits = new Map();
		return integration.cortexTrackLimits;
	}

	function setTrackLimits(integration, uri, startAt, endAt) {
		if (!uri) return;
		const inicio = Number(startAt);
		const fin = Number(endAt);
		const tieneInicio = Number.isFinite(inicio) && inicio > 0;
		const tieneFin = Number.isFinite(fin) && fin > 0;
		const limites = getTrackLimits(integration);
		if (!tieneInicio && !tieneFin) {
			limites.delete(uri);
			return;
		}
		limites.set(uri, { startAt: tieneInicio ? inicio : 0, endAt: tieneFin ? fin : 0 });
		// Que no crezca sin control en una sesion larga.
		if (limites.size > 200) limites.delete(limites.keys().next().value);
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

	// Cuanto antes del final hay que pasar al siguiente tema:
	//   con end_at de la biblioteca -> la diferencia entre el final real y el logico
	//   sin end_at                   -> el mismo salto que se aplica al principio
	function corteDeCierre(limite, duracionMs, offsetMs) {
		const finLogicoMs = limite && Number(limite.endAt) > 0 ? Math.round(Number(limite.endAt) * 1000) : 0;
		if (finLogicoMs > 0) return Math.max(0, Number(duracionMs || 0) - finLogicoMs);
		return Number(offsetMs) || 0;
	}

	async function applyTenSecondPlaybackRule(integration, track, state) {
		if (integration.cortexSilentTransition) return;
		const offsetConfig = await getPlaybackOffsetConfig(integration);
		if (!track?.uri) return;
		// Si la biblioteca definio start_at/end_at para esta cancion, mandan ellos.
		const limite = getTrackLimits(integration).get(track.uri) || null;
		if (!limite && !offsetConfig.enabled) return;
		const offsetMs = limite ? Math.round((limite.startAt || 0) * 1000) : offsetConfig.seconds * 1000;
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
		// Cuanto antes del final hay que pasar al siguiente:
		//  - con end_at de la biblioteca: la diferencia entre el final real y el final logico
		//  - sin end_at: el mismo salto que se aplico al principio (comportamiento de siempre)
		const duracionMs = Number(track.duration || 0);
		const finLogicoMs = limite && Number(limite.endAt) > 0 ? Math.round(Number(limite.endAt) * 1000) : 0;
		const corteMs = corteDeCierre(limite, duracionMs, offsetMs);
			if (track.isPlaying && remainingMs > 0 && remainingMs <= corteMs + 5000 && !state.endedUris.has(track.uri)) {
			const remotePreferredName = await getRemoteDeviceTarget();
			const device = chooseSpotifyDevice(integration, await getSpotifyDevices(integration), remotePreferredName);
			const nextUrl = device?.id
				? `https://api.spotify.com/v1/me/player/next?device_id=${encodeURIComponent(device.id)}`
				: "https://api.spotify.com/v1/me/player/next";
			if (finLogicoMs > 0) notifyAutoEnd(integration, track);
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
				`https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=track&limit=10`,
				{ headers: { Authorization: `Bearer ${integration.accessToken}` } }
			);
			const data = await response.json().catch(() => null);
			// Se busca el nombre pelado (Spotify ignora "artist:") y se filtra aca para que
			// la continuacion siga siendo del mismo artista.
			const crudos = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
			const candidates = temasDelArtista(crudos, artistName);
			return candidates.find(candidate => candidate?.uri && !state.playedUris.has(candidate.uri)) || null;
		} catch (error) {
			console.debug("[Spotify Auto Music] Fallback de artista no disponible:", error.message);
			return null;
		}
	}

	async function queueContinuation(integration, track) {
		const state = getContinuationState(integration);
		if (!boolSetting(integration, "ruloEnabled", true) || !state.active || state.inFlight || !track?.uri) return;
		state.inFlight = true;
		try {
			const nextTrack = await getSimilarTrack(integration, track);
			if (!boolSetting(integration, "ruloEnabled", true) || !state.active || !nextTrack?.uri || state.playedUris.has(nextTrack.uri)) return;
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
				// Queda en el historial: asi se ve que temas pone Rulo por su cuenta.
				reportRequestResult(integration, {
					source: "auto",
					requester: "Rulo",
					query: String(nextTrack.name || ""),
					ok: true,
					status: "continuation",
					comment: "continuacion automatica de " + String(track?.name || ""),
					message: "Continuacion en cola: " + String(nextTrack.name || ""),
					trackSource: "continuacion",
					track: {
						name: nextTrack.name,
						artist: Array.isArray(nextTrack.artists) ? nextTrack.artists.map(artista => artista.name).join(", ") : "",
						uri: nextTrack.uri
					}
				});
			}
		} catch (error) {
			console.debug("[Spotify Auto Music] No se pudo preparar continuacion:", error.message);
		} finally {
			state.inFlight = false;
		}
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

	// Le avisa al backend que una cancion de la biblioteca llego a su final logico:
	// asi encola la siguiente sin esperar el hueco completo.
	function notifyAutoEnd(integration, track) {
		try {
			if (!CORTEX_BASE_URL) return;
			fetch(CORTEX_BASE_URL + "/api/biblioteca-auto-termino", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ uri: track?.uri || "" })
			}).catch(() => {});
		} catch (_) { /* si falla, se sigue con el flujo normal */ }
	}

	// /next no admite position_ms. Ocultamos el inicio hasta confirmar el seek,
	// conservando la cola y restaurando el volumen incluso si falla el cambio.
	async function withSilentSpotifyTransition(integration, device, track, run) {
		const headers = { Authorization: `Bearer ${integration.accessToken}` };
		const readDevice = async () => {
			const response = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player/devices", { headers });
			const data = response.ok ? await response.json() : null;
			return data?.devices?.find(item => item.id === device.id);
		};
		const setVolume = volume => spotifyFetch(integration,
			`https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}&device_id=${encodeURIComponent(device.id)}`,
			{ method: "PUT", headers });
		const waitVolume = async volume => {
			for (let attempt = 0; attempt < 8; attempt += 1) {
				if ((await readDevice())?.volume_percent === volume) return true;
				await waitForSpotify(150);
			}
			return false;
		};
		const initialDevice = await readDevice();
		const originalVolume = initialDevice?.volume_percent;
		if (initialDevice?.supports_volume === false || !Number.isInteger(originalVolume) || originalVolume < 0 || originalVolume > 100) {
			throw new Error("No se puede confirmar el volumen de Spotify para ocultar la intro. No se avanzo la cola.");
		}
		let restoreNeeded = false;
		let changeStarted = false;
		let completed = false;
		integration.cortexSilentTransition = true;
		try {
			if (originalVolume > 0) {
				restoreNeeded = true;
				const muted = await setVolume(0);
				if (!muted.ok || !await waitVolume(0)) throw new Error("Spotify no confirmo el silencio previo; no se avanzo la cola.");
			}
			changeStarted = true;
			const result = await run();
			completed = result.ok === true;
			return result;
		} finally {
			try {
				if (changeStarted && !completed) {
					// Si fallo el seek, no dejar oir la intro al recuperar el volumen.
					const response = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player", { headers });
					const state = response.ok ? await response.json() : null;
					if (state?.item?.uri === track.uri && state?.device?.id === device.id) {
						await spotifyFetch(integration, `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(device.id)}`, { method: "PUT", headers });
					}
				}
			} finally {
				try {
					if (restoreNeeded) {
						let restored = false;
						for (let attempt = 0; attempt < 2 && !restored; attempt += 1) {
							try {
								const response = await setVolume(originalVolume);
								restored = response.ok && await waitVolume(originalVolume);
							} catch (_) { /* un segundo intento para recuperar el volumen */ }
						}
						if (!restored) throw new Error(`Spotify no confirmo la restauracion del volumen a ${originalVolume}%. Revisar el volumen de la app.`);
					}
				} finally {
					integration.cortexSilentTransition = false;
				}
			}
		}
	}

	async function transportWithConfiguredStart(integration, direction) {
		const methodName = direction === "next" ? "skip" : "previous";
		const offset = await getPlaybackOffsetConfig(integration);
		if (!offset.enabled) return integration[methodName]();
		const playbackBefore = await estadoDelReproductor(integration);
		const before = playbackBefore ? JSON.parse(JSON.stringify(playbackBefore)) : null;
		if (!before?.item?.uri || !Number.isFinite(Number(before.progress_ms))) {
			return { success: false, message: "No pude confirmar el tema actual; no aplique el salto." };
		}
		const preferredName = await getRemoteDeviceTarget();
		const device = chooseSpotifyDevice(integration, await getSpotifyDevices(integration), preferredName);
		if (!device?.id) return { success: false, message: "No encontre el dispositivo Spotify para hacer el cambio." };
		const changingTrack = { uri: before.item.uri };
		try {
			const result = await withSilentSpotifyTransition(integration, device, changingTrack, async () => {
				const moved = await integration[methodName]();
				if (moved?.success === false) return { ok: false, success: false, message: moved.message || "Spotify no acepto el cambio." };
				let after = null;
				let changed = false;
				for (let attempt = 0; attempt < 24; attempt += 1) {
					await waitForSpotify(150);
					after = await estadoDelReproductor(integration);
					if (!after?.item?.uri) continue;
					const uriChanged = after.item.uri !== before.item.uri;
					const restarted = Number(after.progress_ms) < Number(before.progress_ms) - 1000;
					if (uriChanged || restarted) { changed = true; break; }
				}
				if (!changed || !after) return { ok: true, success: true, message: "Spotify recibio el cambio." };
				changingTrack.uri = after.item.uri;
				const duration = Number(after.item.duration_ms);
				const targetMs = Number.isFinite(duration) && duration > 1000
					? Math.min(offset.seconds * 1000, duration - 1000)
					: offset.seconds * 1000;
				if (!(Number(after.progress_ms) >= targetMs)) {
					const seek = await spotifyFetch(integration,
						`https://api.spotify.com/v1/me/player/seek?position_ms=${targetMs}&device_id=${encodeURIComponent(device.id)}`,
						{ method: "PUT", headers: { Authorization: `Bearer ${integration.accessToken}` } });
					if (!seek.ok) return { ok: false, success: false, message: "Spotify no pudo aplicar el salto inicial." };
					let confirmed = false;
					for (let attempt = 0; attempt < 16; attempt += 1) {
						await waitForSpotify(150);
						after = await estadoDelReproductor(integration);
						if (after?.item?.uri === changingTrack.uri && Number(after.progress_ms) >= targetMs) { confirmed = true; break; }
					}
					if (!confirmed) return { ok: false, success: false, message: "Spotify no confirmo el salto; pause el tema para que no se oiga la intro." };
				}
				if (!integration.spotifyPlaybackOffsetState) integration.spotifyPlaybackOffsetState = { startedUris: new Set(), endedUris: new Set() };
				integration.spotifyPlaybackOffsetState.startedUris.add(changingTrack.uri);
				return { ok: true, success: true, message: "Cambio aplicado con el salto inicial." };
			});
			return { success: result?.ok === true, message: result?.message || (result?.ok ? "Cambio aplicado." : "No se pudo cambiar el tema.") };
		} catch (error) {
			integration.cortexUltimoMotivo = integration.cortexUltimoMotivo || [];
			integration.cortexUltimoMotivo.push(String(error.message || error));
			return { success: false, message: String(error.message || "No se pudo cambiar el tema.") };
		}
	}

	async function startTrackOnDevice(integration, device, track, startPositionMs = 0, strictTarget = false, queueAsNext = false) {
		// Motivos reales de Spotify de cada intento: van al registro para diagnosticar
		// sin adivinar (igual que pausa/reanudar).
		integration.cortexUltimoMotivo = [];
		const apuntar = async (response, descripcion) => {
			const motivo = await motivoDeRespuesta(response);
			integration.cortexUltimoMotivo.push(`${descripcion}: ${motivo}`);
			console.log(`[Spotify Auto Music] reproducir fallo (${descripcion}): ${motivo}`);
		};

		const playRequest = (deviceId, conPosicion) => {
			const playUrl = deviceId
				? `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`
				: "https://api.spotify.com/v1/me/player/play";
			const body = { uris: [track.uri] };
			if (conPosicion && startPositionMs > 0) body.position_ms = startPositionMs;
			return spotifyFetch(integration, playUrl, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${integration.accessToken}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify(body)
			});
		};

		// Igual que pausa/reanudar: si el dispositivo quedo inactivo (tras una pausa
		// o un rato quieto), la orden de reproducir puede ignorarse o fallar. Se
		// traspasa el audio a la PC primero, sin arrancar todavia.
		if (!device.is_active) {
			const traspaso = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player", {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${integration.accessToken}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ device_ids: [device.id], play: false })
			});
			if (traspaso.status !== 204 && !traspaso.ok) await apuntar(traspaso, `traspaso al dispositivo ${device.name}`);
			await waitForSpotify(400);
		}

		const readPlaybackState = async () => {
			const stateResponse = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player", {
				headers: { Authorization: `Bearer ${integration.accessToken}` }
			});
			return stateResponse.ok ? await stateResponse.json().catch(() => null) : null;
		};
		const confirmsPlayback = state => state?.is_playing === true && state?.item?.uri === track.uri &&
			(!strictTarget || state?.device?.id === device.id ||
				String(state?.device?.name || "").toLowerCase() === String(device.name || "").toLowerCase());

		if (queueAsNext) {
			// Los pedidos manuales se agregan con la API de cola (Spotify los coloca
			// como siguiente tema); avanzar después conserva el contexto/playlist actual.
			const queueUrl = `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(track.uri)}&device_id=${encodeURIComponent(device.id)}`;
			let currentState = await readPlaybackState();
			if (currentState?.is_playing === true && currentState?.item?.uri === track.uri) {
				console.log(`[Spotify Auto Music] ${track.name} ya estaba sonando; no se vuelve a encolar ni a avanzar.`);
				return { ok: true, status: 204, spotifyAlreadyPlaying: true, json: async () => ({}) };
			}

			const queueState = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player/queue", {
				headers: { Authorization: `Bearer ${integration.accessToken}` }
			});
			let queue = queueState.ok ? await queueState.json().catch(() => null) : null;
			let firstInQueue = queue?.queue?.[0]?.uri === track.uri;
			if (!firstInQueue) {
				const queued = await spotifyFetch(integration, queueUrl, {
					method: "POST",
					headers: { Authorization: `Bearer ${integration.accessToken}` }
				});
				if (!(queued.status === 204 || queued.ok)) {
					await apuntar(queued, "encolar tema como siguiente");
					return queued;
				}

				for (let intento = 0; intento < 4 && !firstInQueue; intento += 1) {
					await waitForSpotify(450);
					const queueResponse = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player/queue", {
						headers: { Authorization: `Bearer ${integration.accessToken}` }
					});
					queue = queueResponse.ok ? await queueResponse.json().catch(() => null) : null;
					firstInQueue = queue?.queue?.[0]?.uri === track.uri;
				}
			}
			if (!firstInQueue) {
				const detalle = `Spotify encolo "${track.name}", pero no quedo como siguiente tema; no se avanzo para evitar saltar otro tema.`;
				integration.cortexUltimoMotivo.push(detalle);
				return { ok: false, status: 409, spotifyPlaybackNotConfirmed: true, json: async () => ({ error: { status: 409, message: detalle } }) };
			}

			const advanceQueuedTrack = async () => {
				// En Spotify de escritorio, /next puede empezar a reproducir el tema
				// antes de que el cliente aplique el volumen 0. Pausamos antes del salto
				// para que ningun fragmento de la intro pueda salir por los altavoces.
				if (startPositionMs > 0) {
					const beforeAdvance = await readPlaybackState();
					if (beforeAdvance?.is_playing === true) {
						const paused = await spotifyFetch(integration, `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(device.id)}`, {
							method: "PUT",
							headers: { Authorization: `Bearer ${integration.accessToken}` }
						});
						if (!(paused.status === 204 || paused.ok)) {
							await apuntar(paused, "pausar antes de avanzar la cola");
							return paused;
						}
						let pauseConfirmed = false;
						for (let intento = 0; intento < 12; intento += 1) {
							await waitForSpotify(100);
							const state = await readPlaybackState();
							if (state?.device?.id === device.id && state.is_playing === false) { pauseConfirmed = true; break; }
						}
						if (!pauseConfirmed) {
							const detalle = "Spotify no confirmo la pausa previa; no se avanzo la cola para evitar reproducir la intro.";
							integration.cortexUltimoMotivo.push(detalle);
							return { ok: false, status: 409, spotifyPlaybackNotConfirmed: true, json: async () => ({ error: { status: 409, message: detalle } }) };
						}
					}
				}
				const skipped = await spotifyFetch(integration, `https://api.spotify.com/v1/me/player/next?device_id=${encodeURIComponent(device.id)}`, {
					method: "POST",
					headers: { Authorization: `Bearer ${integration.accessToken}` }
				});
				if (!(skipped.status === 204 || skipped.ok)) {
					await apuntar(skipped, "siguiente tras encolar tema pedido");
					return skipped;
				}

				let state = null;
				const trackIsCurrent = value => value?.item?.uri === track.uri &&
					(value?.device?.id === device.id || String(value?.device?.name || "").toLowerCase() === String(device.name || "").toLowerCase());
				for (let intento = 0; intento < (startPositionMs > 0 ? 20 : 6) && !(startPositionMs > 0 ? trackIsCurrent(state) : confirmsPlayback(state)); intento += 1) {
					await waitForSpotify(startPositionMs > 0 ? 150 : 500);
					state = await readPlaybackState();
				}
				if (startPositionMs > 0 ? !trackIsCurrent(state) : !confirmsPlayback(state)) {
					const detalle = `Spotify avanzo la cola, pero no confirmo "${track.name}" sonando en ${device.name}.`;
					integration.cortexUltimoMotivo.push(detalle);
					return { ok: false, status: 409, spotifyPlaybackNotConfirmed: true, json: async () => ({ error: { status: 409, message: detalle } }) };
				}
				if (startPositionMs > 0 && (state.progress_ms == null || !(Number(state.progress_ms) >= startPositionMs))) {
					const seek = await spotifyFetch(integration, `https://api.spotify.com/v1/me/player/seek?position_ms=${startPositionMs}&device_id=${encodeURIComponent(device.id)}`, {
						method: "PUT", headers: { Authorization: `Bearer ${integration.accessToken}` }
					});
					if (!seek.ok) {
						await apuntar(seek, "adelantar el tema antes de devolver el volumen");
						return seek;
					}
					for (let attempt = 0; attempt < 12; attempt += 1) {
						await waitForSpotify(150);
						state = await readPlaybackState();
						if (trackIsCurrent(state) && Number(state.progress_ms) >= startPositionMs) break;
					}
					if (!trackIsCurrent(state) || Number(state.progress_ms) < startPositionMs || state.progress_ms == null) {
						throw new Error("Spotify no confirmo el segundo de inicio del tema; se detuvo el cambio para no reproducir la intro.");
					}
				}
				if (startPositionMs > 0 && state.is_playing !== true) {
					const resumed = await spotifyFetch(integration, `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
						method: "PUT",
						headers: { Authorization: `Bearer ${integration.accessToken}`, "Content-Type": "application/json" },
						body: "{}"
					});
					if (!(resumed.status === 204 || resumed.ok)) {
						await apuntar(resumed, "reanudar tema pedido despues del salto inicial");
						return resumed;
					}
					let resumedAtOffset = false;
					for (let intento = 0; intento < 12; intento += 1) {
						await waitForSpotify(100);
						state = await readPlaybackState();
						if (confirmsPlayback(state) && Number(state.progress_ms) >= startPositionMs) { resumedAtOffset = true; break; }
					}
					if (!resumedAtOffset) throw new Error("Spotify no confirmo la reproduccion desde el segundo elegido; el tema quedo pausado para proteger la intro.");
				}
				if (startPositionMs > 0) {
					if (!integration.spotifyPlaybackOffsetState) integration.spotifyPlaybackOffsetState = { startedUris: new Set(), endedUris: new Set() };
					integration.spotifyPlaybackOffsetState.startedUris.add(track.uri);
				}
				console.log(`[Spotify Auto Music] ${track.name} agregado como siguiente y reproducido sin reemplazar la playlist.`);
				return { ok: true, status: 204, json: async () => ({}) };
			};
			return startPositionMs > 0
				? await withSilentSpotifyTransition(integration, device, track, advanceQueuedTrack)
				: await advanceQueuedTrack();
		}

		let response = await playRequest(device.id, true);
		if (!(response.status === 204 || response.ok)) {
			// Puede ser el 403 "Restriction violated" que Spotify devuelve cuando el
			// tema pedido YA esta sonando. Se confirma el estado antes de darlo por fallo.
			const estado = await estadoDelReproductor(integration);
			if (confirmsPlayback(estado)) {
				console.log("[Spotify Auto Music] reproducir: Spotify contesto \"Restriction violated\" y el estado confirma que ya suena el tema pedido");
				return { ok: true, status: 204, json: async () => ({}) };
			}
			// La orden directa fallo. Si se eligio un destino explicito, no cambiar
			// silenciosamente a otro reproductor.
			await apuntar(response, `reproducir con el dispositivo ${device.name}`);
			if (strictTarget) return response;
			response = await playRequest(null, startPositionMs > 0);
			if (!(response.status === 204 || response.ok)) {
				await apuntar(response, "sin indicar dispositivo");
				return response;
			}
		}

		// Spotify puede responder 204 antes de que el cliente de escritorio aplique
		// el cambio. Solo damos exito cuando el dispositivo confirma el tema sonando.
		await waitForSpotify(900);
		let state = await readPlaybackState();
		if (!confirmsPlayback(state)) {
			response = await playRequest(device.id, false);
			if (response.status === 204 || response.ok) await waitForSpotify(700);
			state = await readPlaybackState();
			if (!confirmsPlayback(state)) {
				if (!strictTarget) {
					response = await playRequest(null, startPositionMs > 0);
					if (!(response.status === 204 || response.ok)) await apuntar(response, "sin indicar dispositivo (segundo intento)");
				}
			}
		}

		// El cliente de Store puede tardar mas en reflejar el cambio. Consultamos
		// durante unos segundos, pero no tomamos un 204 como prueba de reproduccion.
		for (let intento = 0; intento < 4 && !confirmsPlayback(state); intento += 1) {
			await waitForSpotify(650);
			state = await readPlaybackState();
		}
		let triedQueueFallback = false;
		if (!confirmsPlayback(state)) {
			triedQueueFallback = true;
			// En algunos clientes de escritorio /play devuelve 204 sin iniciar el
			// tema. La cola y /next usan otro camino de Spotify Connect.
			const queueUrl = `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(track.uri)}&device_id=${encodeURIComponent(device.id)}`;
			const queued = await spotifyFetch(integration, queueUrl, {
				method: "POST",
				headers: { Authorization: `Bearer ${integration.accessToken}` }
			});
			if (queued.status === 204 || queued.ok) {
				let firstInQueue = false;
				for (let intento = 0; intento < 4 && !firstInQueue; intento += 1) {
					await waitForSpotify(450);
					const queueResponse = await spotifyFetch(integration, "https://api.spotify.com/v1/me/player/queue", {
						headers: { Authorization: `Bearer ${integration.accessToken}` }
					});
					const queue = queueResponse.ok ? await queueResponse.json().catch(() => null) : null;
					firstInQueue = queue?.queue?.[0]?.uri === track.uri;
				}
				if (firstInQueue) {
					const skipped = await spotifyFetch(integration, `https://api.spotify.com/v1/me/player/next?device_id=${encodeURIComponent(device.id)}`, {
						method: "POST",
						headers: { Authorization: `Bearer ${integration.accessToken}` }
					});
					if (skipped.status === 204 || skipped.ok) {
						for (let intento = 0; intento < 4 && !confirmsPlayback(state); intento += 1) {
							await waitForSpotify(650);
							state = await readPlaybackState();
							if (state?.item?.uri === track.uri && state.is_playing === false) {
								const resumed = await spotifyFetch(integration, `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
									method: "PUT",
									headers: {
										Authorization: `Bearer ${integration.accessToken}`,
										"Content-Type": "application/json"
									},
									body: "{}"
								});
								if (!(resumed.status === 204 || resumed.ok)) await apuntar(resumed, "reanudar tras siguiente");
							}
						}
					} else await apuntar(skipped, "siguiente tras encolar");
				} else integration.cortexUltimoMotivo.push(`Spotify no confirmo "${track.name}" al principio de la cola; no se avanzo a otro tema.`);
			} else await apuntar(queued, "encolar tema para reproducir");
		}
		if (triedQueueFallback && confirmsPlayback(state)) {
			if (startPositionMs > 0 && Number(state.progress_ms) < startPositionMs) {
				await spotifyFetch(integration, `https://api.spotify.com/v1/me/player/seek?position_ms=${startPositionMs}&device_id=${encodeURIComponent(device.id)}`, {
					method: "PUT",
					headers: { Authorization: `Bearer ${integration.accessToken}` }
				});
			}
			console.log(`[Spotify Auto Music] ${track.name} confirmado en ${device.name} tras avanzar la cola.`);
			return { ok: true, status: 204, json: async () => ({}) };
		}
		if (!confirmsPlayback(state)) {
			const temaActual = String(state?.item?.name || "ninguno");
			const reproduciendo = state?.is_playing === true ? "si" : "no";
			const dispositivoActual = String(state?.device?.name || "ninguno");
			const detalle = `Spotify acepto la orden, pero no confirmo "${track.name}" sonando en ${device.name}; tema actual: ${temaActual}; dispositivo actual: ${dispositivoActual}; reproduciendo: ${reproduciendo}.`;
			integration.cortexUltimoMotivo.push(detalle);
			console.warn(`[Spotify Auto Music] ${detalle}`);
			return {
				ok: false,
				status: 409,
				spotifyPlaybackNotConfirmed: true,
				json: async () => ({ error: { status: 409, message: detalle } })
			};
		}
		return response;
	}


	async function describeSpotifyDevices(integration) {
		if (!integration.accessToken) return replyText("noToken", {}, "Spotify no esta conectado.");
		const devices = await getSpotifyDevices(integration);
		if (!devices.length) {
			return replyText("noDevice", {}, "No veo dispositivos de Spotify. Abri Spotify en la PC del OBS y reproduce/pausa algo una vez.");
		}
		return "Dispositivos Spotify: " + devices.map(device => {
			const flags = [];
			if (device.is_active) flags.push("activo");
			if (device.is_restricted) flags.push("restringido");
			return `${device.name || "Sin nombre"} (${device.type || "tipo desconocido"}${flags.length ? ", " + flags.join(", ") : ""})`;
		}).join(" | ");
	}

	function musicCooldownRemaining(integration, data) {
		const now = Date.now();
		if (data?.type === "auto" || boolSetting(integration, "testMode", false)) return 0;
		const cooldownMs = numSetting(integration, "cooldownSeconds", DEFAULT_COOLDOWN_MS / 1000, 0, 3600) * 1000;
		const userCooldownMs = numSetting(integration, "userCooldownSeconds", DEFAULT_USER_COOLDOWN_MS / 1000, 0, 7200) * 1000;
		const globalRemaining = cooldownMs - (now - (integration.lastAutoMusicRequestAt || 0));
		if (!integration.autoMusicUserRequests) integration.autoMusicUserRequests = new Map();
		const key = requesterKey(data);
		const userRemaining = userCooldownMs - (now - (integration.autoMusicUserRequests.get(key) || 0));
		return Math.max(0, globalRemaining, userRemaining);
	}

	// Una tanda comprometida de hasta tres pedidos y los tres más recientes
	// para la siguiente. Los nuevos pedidos nunca desplazan la tanda en curso.
	function enqueueMusicRequest(integration, run, skippedValue) {
		const queue = integration.cortexMusicQueue || (integration.cortexMusicQueue = {
			batch: [], latest: [], assigned: 0, running: false
		});
		return new Promise((resolve, reject) => {
			const entry = { run, resolve, reject, skippedValue };
			if (queue.assigned < 3) { queue.batch.push(entry); queue.assigned++; }
			else {
				queue.latest.push(entry);
				if (queue.latest.length > 3) {
					const skipped = queue.latest.shift();
					skipped.resolve(skipped.skippedValue);
				}
			}
			if (queue.running) return;
			queue.running = true;
			(async () => {
				try {
					while (queue.batch.length) {
						const next = queue.batch.shift();
						try { next.resolve(await next.run()); } catch (error) { next.reject(error); }
						if (!queue.batch.length && queue.latest.length) {
							queue.batch = queue.latest; queue.latest = []; queue.assigned = queue.batch.length;
						}
					}
				} finally { queue.running = false; queue.assigned = 0; }
			})();
		});
	}

	function clearWaitingMusicRequests(integration) {
		const queue = integration.cortexMusicQueue;
		if (!queue) return;
		for (const entry of queue.batch.concat(queue.latest)) entry.resolve(entry.skippedValue);
		queue.batch = []; queue.latest = [];
	}

	// Busca una cancion por su URI/id de Spotify (lo usa el modo automatico de la
	// biblioteca: ya sabemos exactamente cual es, no hace falta buscar por texto).
	async function trackByUri(integration, uri) {
		const id = String(uri || "").replace("spotify:track:", "").trim();
		if (!/^[0-9A-Za-z]{22}$/.test(id)) return null;
		const response = await spotifyFetch(integration, `https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}`, {
			headers: { Authorization: `Bearer ${integration.accessToken}` }
		});
		if (!response.ok) return null;
		const datos = await response.json().catch(() => null);
		if (!datos || !datos.uri) return null;
		return datos;
	}

	async function playTrackNow(integration, query, data) {
		if (!boolSetting(integration, "ruloEnabled", true)) return { success: false, message: "Rulo está apagado." };
		if (!integration.accessToken) {
			return { success: false, message: replyText("noToken", {}, "Spotify no esta conectado.") };
		}
		// Los pedidos que llegan mientras Rulo prepara «Habla» esperan su turno.
		// Rechazarlos como busy disparaba otra animación y podía reemplazar el
		// triggerId que estaba esperando el primer pedido (por ejemplo, al despertar).
		while (integration.autoMusicInFlight) {
			const running = integration.autoMusicPending;
			if (running) await running;
			else await new Promise(resolve => setTimeout(resolve, 0));
		}
		if (!boolSetting(integration, "ruloEnabled", true)) return { success: false, message: "Rulo está apagado." };

		let finishPending;
		integration.autoMusicPending = new Promise(resolve => { finishPending = resolve; });
		integration.autoMusicInFlight = true;
		try {
			// Releer los ajustes durante la espera permite cambiarlos desde el panel.
			let remaining;
			while ((remaining = musicCooldownRemaining(integration, data)) > 0) {
				if (!boolSetting(integration, "ruloEnabled", true)) return { success: false, message: "Rulo está apagado." };
				await new Promise(resolve => setTimeout(resolve, Math.min(1000, remaining)));
			}
			if (!boolSetting(integration, "ruloEnabled", true)) return { success: false, message: "Rulo está apagado." };
			// Si viene la URI exacta (modo automatico de la biblioteca), se usa esa.
			const uriPedida = data && (data.uri || (/^(spotify:track:)?[0-9A-Za-z]{22}$/.test(String(query || "").trim()) ? query : ""));
			const track = uriPedida ? await trackByUri(integration, uriPedida) : await searchTrack(integration, query);
			if (!track) {
				if (spotifySinRespuesta(integration)) {
					return {
						success: false,
						sinRespuestaDeSpotify: true,
						message: replyText("sinRespuesta", { pedido: query, busqueda: query, nombre: requesterFirstName(data) }, "Spotify no me respondio (parece colgada la app): proba de nuevo en unos segundos.")
					};
				}
				const frenado = Math.max(5, spotifyFrenado(integration));
				if (spotifyFrenado(integration)) {
					return {
						success: false,
						frenadoPorSpotify: true,
						message: replyText("throttled", { pedido: query, busqueda: query, segundos: frenado, nombre: requesterFirstName(data) }, `Spotify me esta frenando las consultas: proba de nuevo en ${frenado}s.`)
					};
				}
				if (integration.cortexSearchError) return { success: false, message: integration.cortexSearchError };
				return { success: false, message: replyText("notFound", { pedido: query, busqueda: query, nombre: requesterFirstName(data) }, "No encontre ese tema en Spotify.") };
			}

			const devices = await getSpotifyDevices(integration);
			const remotePreferredName = await getRemoteDeviceTarget();
			const device = chooseSpotifyDevice(integration, devices, remotePreferredName);
			if (!device) {
				// Sin dispositivos: puede ser que no haya ninguno abierto, que la app
				// este colgada o que Spotify nos este frenando. Se dice cual es cual.
				if (spotifySinRespuesta(integration)) {
					return {
						success: false,
						sinRespuestaDeSpotify: true,
						message: replyText("sinRespuesta", { pedido: query, busqueda: query, nombre: requesterFirstName(data) }, "Spotify no me respondio (parece colgada la app): proba de nuevo en unos segundos.")
					};
				}
				if (spotifyFrenado(integration)) {
					const frenado = Math.max(5, spotifyFrenado(integration));
					return {
						success: false,
						frenadoPorSpotify: true,
						message: replyText("throttled", { pedido: query, busqueda: query, segundos: frenado, nombre: requesterFirstName(data) }, `Spotify me esta frenando las consultas: proba de nuevo en ${frenado}s.`)
					};
				}
				if (remotePreferredName) {
					return {
						success: false,
						message: replyText("noDeviceConfigured", { dispositivo: remotePreferredName }, `No encuentro el dispositivo configurado "${remotePreferredName}". Envia !spotifydevices para ver los nombres disponibles.`)
					};
				}
				return {
					success: false,
					message: replyText("noDevice", {}, "No encontre un dispositivo Spotify disponible. Abri Spotify en la PC del OBS y reproduce/pausa algo una vez.")
				};
			}
			// El traspaso al dispositivo (cuando quedo inactivo) lo hace
			// startTrackOnDevice abajo: ahi se traspasa sin arrancar la musica,
			// se reproduce y se confirma el cambio, con el motivo real anotado.

			const offsetConfig = await getPlaybackOffsetConfig(integration);
			// Limites de la biblioteca para esta cancion (si el pedido los trae).
			if (data && (data.startAt !== undefined || data.endAt !== undefined)) {
				setTrackLimits(integration, track.uri, data.startAt, data.endAt);
			}
			const propios = getTrackLimits(integration).get(track.uri) || null;
			const arranqueMs = propios && propios.startAt > 0
				? Math.round(propios.startAt * 1000)
				: (offsetConfig.enabled ? offsetConfig.seconds * 1000 : 0);
			const configuredTarget = remotePreferredName || settingValue(integration.settings, "spotifyAutoMusicDeviceName", "");
			await prepareRuloSpeechForPlayback(integration, data || {});
			if (!boolSetting(integration, "ruloEnabled", true)) return { success: false, message: "Rulo está apagado." };
			const response = await startTrackOnDevice(integration, device, track, arranqueMs, Boolean(configuredTarget), data?.type !== "auto");
			if (response.spotifyPlaybackNotConfirmed) {
				return {
					success: false,
					message: replyText(
						"playbackError",
						{ tema: track.name, dispositivo: device.name },
						`Spotify recibio "${track.name}", pero ${device.name} no confirmo que lo este reproduciendo. Abri Spotify en ese dispositivo, inicia un tema manualmente y volve a probar.`
					)
				};
			}

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
				// Ultimo tema puesto: sirve para saber si despues lo saltaron o pausaron.
				integration.cortexLastTrack = {
					name: String(track.name || ""),
					artist: track.artists.map(artist => artist.name).join(", "),
					uri: String(track.uri || ""),
					at: Date.now()
				};
			const continuationState = getContinuationState(integration);
				const autoContinue = boolSetting(integration, "autoContinue", true);
				const isAutomaticLibraryTrack = data?.type === "auto";
				// Los pedidos manuales van dentro de la cola/lista que ya está sonando.
				// No agregamos además una recomendación automática detrás del pedido.
				continuationState.active = autoContinue && isAutomaticLibraryTrack;
				continuationState.playedUris.add(track.uri);
				if (continuationState.active && !response.spotifyAlreadyPlaying) queueContinuation(integration, track).catch(() => {});
				// Toda petición manual cuenta, también la simulada y la del streamer.
				if (data?.type !== "auto") {
					const now = Date.now();
					integration.lastAutoMusicRequestAt = now;
					if (!integration.autoMusicUserRequests) integration.autoMusicUserRequests = new Map();
					integration.autoMusicUserRequests.set(requesterKey(data), now);
				}
				const artists = track.artists.map(artist => artist.name).join(", ");
				return {
					success: true,
					message: replyText("ok", { tema: track.name, artista: artists, pedido: query, nombre: requesterFirstName(data) }, `Reproduciendo: ${track.name} - ${artists}`),
					track: { name: track.name, artist: artists, uri: track.uri }
				};
			}

			if (response.status === 404) {
				return {
					success: false,
					message: replyText("noActiveDevice", {}, "No hay dispositivo activo. Abri Spotify y reproduce algo manualmente primero.")
				};
			}

			const message = typeof integration.parsePlaybackError === "function"
				? await integration.parsePlaybackError(response, replyText("playbackError", {}, "No pude cambiar el tema"))
				: replyText("playbackError", {}, "No pude cambiar el tema");
			return { success: false, message };
		} catch (error) {
			console.warn("[Spotify Auto Music] Error:", error);
			if (integration.cortexUltimoMotivo) integration.cortexUltimoMotivo.push(String(error.message || error));
			return { success: false, message: replyText("error", {}, "Error procesando el pedido musical.") };
		} finally {
			integration.autoMusicInFlight = false;
			const finish = finishPending;
			finishPending = null;
			integration.autoMusicPending = null;
			if (finish) finish();
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

	// Estado del ULTIMO pedido: el comentario que lo origino, si lo interpreto la
	// IA, como se lo leyo y que respuesta salio. Se resetea al empezar cada pedido
	// (beginInteraction) para que no se mezclen datos de uno con otro.
	function beginInteraction(integration, datos) {
		if (!integration) return;
		const info = datos || {};
		integration.cortexLastComment = String(info.comment || "").slice(0, 500);
		integration.cortexLastPlatform = String(info.platform || "").slice(0, 20);
		integration.cortexLastRequesterId = String(info.requesterId || "").slice(0, 80);
		integration.cortexLastParsed = info.parsed || null;
		integration.cortexLastReply = null;
		integration.cortexLastAi = null;
		return integration;
	}

	// De que contexto salio la respuesta -> estado del pedido en la base.
	const STATUS_BY_CONTEXT = {
		ok: "played",
		analysis: "analysis",
		analysisFail: "notfound",
		searching: "searching",
		busy: "busy",
		waitGlobal: "wait_global",
		waitUser: "wait_user",
		notFound: "notfound",
		noToken: "no_token",
		noDevice: "no_device",
		noDeviceConfigured: "no_device",
		noActiveDevice: "no_device",
		throttled: "throttled",
		sinRespuesta: "no_response",
		deviceActivateFail: "no_device",
		playbackError: "error",
		error: "error",
		parseDebug: "analysis",
		transportOk: "transport",
		transportFail: "transport",
		devices: "diagnostic",
		usage: "usage"
	};

	function reportRequestResult(integration, entry) {
		if (typeof fetch !== "function") return;
		const datos = entry || {};
		const reply = integration.cortexLastReply || null;
		const ai = integration.cortexLastAi || null;
		const parsed = datos.parsed || integration.cortexLastParsed || null;
		const estado = datos.status
			|| (reply && reply.context ? STATUS_BY_CONTEXT[reply.context] : "")
			|| (datos.ok === true ? "played" : "error");
		fetch(CORTEX_REQUEST_LOG_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				source: datos.source || "chat",
				requester: datos.requester || "",
				query: datos.query || "",
				ok: datos.ok === true,
				message: String(datos.message || "").slice(0, 300),
				track: datos.track || null,
				// --- todo esto va al historial de analisis (SQLite) ---
				comment: String(datos.comment !== undefined ? datos.comment : (integration.cortexLastComment || "")).slice(0, 500),
				platform: datos.platform || integration.cortexLastPlatform || "",
				requesterId: datos.requesterId || integration.cortexLastRequesterId || "",
				status: estado,
				isRequest: datos.isRequest === true || !!parsed,
				parsed: parsed ? {
					source: parsed.source || "",
					artist: parsed.artist || "",
					title: parsed.title || "",
					genre: parsed.genre || "",
					query: parsed.query || "",
					confidence: parsed.confidence === undefined ? null : parsed.confidence
				} : null,
				aiInterpreted: datos.aiInterpreted === true || !!(ai && ai.used),
				aiModel: (ai && ai.model) || "",
				reply: reply ? {
					context: reply.context,
					variant: String(reply.variant || "").slice(0, 300),
					text: String(reply.text || "").slice(0, 400),
					random: reply.random === true,
					ai: reply.ai === true
				} : null,
				seconds: datos.seconds === undefined ? null : datos.seconds,
				durationMs: datos.durationMs === undefined ? null : datos.durationMs,
				trackSource: datos.trackSource || "pedido",
				sincePlayMs: datos.sincePlayMs === undefined ? null : datos.sincePlayMs,
				timestamp: Date.now()
			})
		}).catch(error => console.debug("[Spotify Auto Music] No se pudo reportar el pedido:", error.message));
	}

	// Poll: trae los ajustes en vivo del dashboard y, si hay, un comando pendiente.
	async function syncWithCortex(integration) {
		if (integration) activeIntegration = integration;
		if (typeof fetch !== "function") return null;
		try {
			const url = `${CORTEX_CLIENT_STATE_URL}?alive=1&version=${MODULE_VERSION}&token=${integration.accessToken ? 1 : 0}`;
			const response = await fetch(url, { cache: "no-store" });
			if (!response.ok) return null;
			const data = await response.json().catch(() => null);
			if (!data) return null;
			applyCortexSettings(integration, data.settings);
			if (data.aliases && typeof data.aliases === "object") integration.cortexSpotifyAliases = data.aliases;
			if (data.vocabulary && typeof data.vocabulary === "object") integration.cortexSpotifyVocabulary = data.vocabulary;
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
		if (settings.ruloEnabled === false || settings.enabled === false) clearWaitingMusicRequests(integration);
		// Si se apago la continuidad, se corta la que este en curso.
		if ((settings.autoContinue === false || settings.ruloEnabled === false) && integration.autoMusicContinuation) {
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
	function runClaimedDashboardCommand(integration, command, waitForPlayback = true) {
		const admission = (integration.cortexCommandAdmission || Promise.resolve()).then(async () => {
			if (command?.id) {
				const response = await fetch(CORTEX_BASE_URL + "/api/spotify-command-claim", {
					method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: command.id })
				});
				if (!response.ok) throw new Error("No se pudo reclamar el comando de Spotify");
				const result = await response.json().catch(() => null);
				if (!result?.claimed) return null;
			}
			return { playback: runDashboardCommand(integration, command) };
		});
		integration.cortexCommandAdmission = admission.catch(() => {});
		return admission.then(result => {
			if (!result) return null;
			if (waitForPlayback) return result.playback;
			result.playback.catch(error => console.debug("[Spotify Auto Music] Error en pedido en cola:", error.message));
			return null;
		});
	}

	function runCommandList(integration, list) {
		const commands = Array.isArray(list) ? list.filter(Boolean) : [];
		// Admitir todo el lote permite seleccionar los últimos tres antes de tocarlos.
		// El poll sigue recibiendo pedidos y ajustes mientras la cola espera su turno.
		return Promise.all(commands.map(command => runClaimedDashboardCommand(integration, command, false)));
	}

	// Enlace directo: evita la demora del poll (Brave estrangula los timers de
	// las paginas de fondo a 1 consulta por minuto).
	function connectCortexSocket(integration) {
		if (typeof WebSocket !== "function") return;
		const current = integration.cortexSocket;
		if (current && (current.readyState === 0 || current.readyState === 1)) return;
		let socket;
		try {
			socket = new WebSocket(CORTEX_WS_URL + "?version=" + MODULE_VERSION);
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
			if (integration) activeIntegration = integration;
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
			if (payload.type === "spotify_vocabulary") {
				if (payload.vocabulary && typeof payload.vocabulary === "object") {
					integration.cortexSpotifyVocabulary = payload.vocabulary;
					console.log("[Spotify Auto Music] Vocabulario actualizado desde el dashboard de entrenamiento.");
				}
				return;
			}
			if (payload.type === "spotify_command" && payload.command) {
				if (payload.settings) applyCortexSettings(integration, payload.settings);
				runClaimedDashboardCommand(integration, payload.command)
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
	function runDashboardCommand(integration, command) {
		const isMusic = command?.type === "play" || (command?.type === "simulate" && !command.parseOnly && parseRequest(command.comment, requestLimits(integration)));
		const skipped = { success: false, skipped: true, message: "Pedido omitido para conservar los tres más recientes." };
		if (command?.auto === true) {
			return integration.cortexMusicQueue?.running ? Promise.resolve(skipped) : executeDashboardCommand(integration, command);
		}
		return isMusic
			? enqueueMusicRequest(integration, () => executeDashboardCommand(integration, command), skipped)
			: executeDashboardCommand(integration, command);
	}

	async function executeDashboardCommand(integration, command) {
		const type = String(command?.type || "");
		const transportAllowedWhenMascotOff = type === "next" || type === "previous";
		const mascotIsOn = boolSetting(integration, "ruloEnabled", true);
		if (!mascotIsOn && !transportAllowedWhenMascotOff) return null;
		beginInteraction(integration, {
			comment: command?.comment || command?.query || "",
			platform: "dashboard",
			requesterId: "dashboard"
		});
		const requester = String(command?.requester || "Dashboard").slice(0, 80);
		const data = { dashboard: true, chatname: requester, type: "dashboard", host: true };
		const announce = mascotIsOn && boolSetting(integration, "announce", true);

		if (type === "play") {
			const esAuto = command.auto === true;
			if (esAuto) data.type = "auto";
			if (command.uri) data.uri = String(command.uri);
			if (command.startAt !== undefined) data.startAt = Number(command.startAt) || 0;
			if (command.endAt !== undefined) data.endAt = Number(command.endAt) || 0;
			if (announce && !esAuto) postRuloBotResponse(`Prueba del dashboard: buscando "${String(command.query || "").slice(0, 60)}"...`, data, "thinking", true);
			const result = await playTrackNow(integration, command.query || command.uri, data);
			// El motivo tecnico de Spotify (si fallo) va al registro, no al cartel.
			const detalleTecnico = !result.success && integration.cortexUltimoMotivo && integration.cortexUltimoMotivo.length
				? " | " + integration.cortexUltimoMotivo.join(" | ")
				: "";
			reportRequestResult(integration, {
				source: esAuto ? "auto" : "dashboard",
				requester,
				query: command.query || command.uri,
				ok: result.success === true,
				message: result.message + detalleTecnico,
				track: result.track
			});
			if (announce) postRuloBotResponse(result.message, data, result.success ? "success" : "error");
			return result;
		}

		if (type === "simulate") {
			// Mismo camino que un comentario real: sirve para probar el parser.
			const parsed = parseRequest(command.comment, requestLimits(integration));
			if (parsed && !parsed.error) beginInteraction(integration, {
				comment: command.comment,
				platform: "dashboard",
				requesterId: "dashboard",
				parsed
			});
			if (command.parseOnly === true) {
				// Solo analiza: dice que entendio, sin tocar Spotify.
				const entendido = parsed && !parsed.error
					? (parsed.source === "genre" ? "genero " + parsed.query.replace(/^genre:/, "") : parsed.artist ? "artista/tema de " + parsed.artist : parsed.query)
					: (parsed?.error || "No lo lei como pedido de musica.");
				const message = parsed && !parsed.error
					? replyText("parseDebug", { entendido: entendido }, `Entendi: ${entendido}`)
					: entendido;
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
			// El nombre y el texto final los arma replyText (respuestas configurables).
			const message = result.message;
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
			const frenadoBusqueda = !track && spotifyFrenado(integration) ? Math.max(5, spotifyFrenado(integration)) : 0;
			const sinRespuestaBusqueda = !track && spotifySinRespuesta(integration) > 0;
			const message = track
				? replyText("analysis", { tema: track.name, artista: artists, busqueda: String(command.query || "").slice(0, 60) }, `Encontre: ${track.name}${artists ? " - " + artists : ""} (no reproduje)`)
				: (sinRespuestaBusqueda
					? replyText("sinRespuesta", { busqueda: String(command.query || "").slice(0, 60) }, "Spotify no me respondio (parece colgada la app): proba de nuevo en unos segundos.")
					: (frenadoBusqueda
					? replyText("throttled", { busqueda: String(command.query || "").slice(0, 60), segundos: frenadoBusqueda }, `Spotify me esta frenando las consultas: proba de nuevo en ${frenadoBusqueda}s.`)
					: integration.cortexSearchError || replyText("analysisFail", { busqueda: String(command.query || "").slice(0, 60) }, `No encontre nada para "${String(command.query || "").slice(0, 60)}".`)));
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
					? replyText("devices", { dispositivos: devices.map(device => device.name).join(" | ") }, `${devices.length} dispositivo(s) detectado(s): ` + devices.map(device => device.name).join(" | "))
					: replyText("noDevice", {}, "No veo dispositivos de Spotify abiertos.")
			});
			return { success: true };
		}

		const transportMethods = { pause: "pause", resume: "resume", next: "skip", previous: "previous" };
		const method = transportMethods[type];
		if (method && typeof integration[method] === "function") {
			// Pausa y reanudar van por codigo propio (controlarReproduccion): la
			// implementacion de SocialStream falla en la app de la Store. Next y
			// previous funcionan bien, asi que siguen usando la de SocialStream.
			const result = (type === "pause" || type === "resume")
				? await controlarReproduccion(integration, type)
				: ((type === "next" || type === "previous")
					? await transportWithConfiguredStart(integration, type)
					: await integration[method]());
			const ok = result?.success !== false;
			// Si saltan o pausan el tema que Rulo acaba de poner, queda guardado como
			// enganche: sirve para ver que temas y que respuestas funcionan mejor.
			const mensajeAmigable = ok
				? replyText("transportOk", { accion: type }, `Comando "${type}" enviado a Spotify.`)
				: replyText("transportFail", { accion: type }, `No se pudo ejecutar "${type}".`);
			// El motivo tecnico (que respondio Spotify) va al registro, no al cartel.
			const detalleTecnico = !ok && result && result.intentos && result.intentos.length
				? " | " + result.intentos.join(" | ")
				: "";
			const ultimo = integration.cortexLastTrack;
			const reciente = ultimo && (Date.now() - ultimo.at) <= 5 * 60 * 1000;
			const estadoEnganche = (type === "next" || type === "previous")
				? "skipped"
				: (type === "pause" ? "paused" : "");
			reportRequestResult(integration, {
				source: "dashboard",
				requester,
				query: `transporte:${type}`,
				ok,
				status: ok && reciente && estadoEnganche ? estadoEnganche : undefined,
				comment: reciente ? `transporte:${type} sobre ${ultimo.name}` : `transporte:${type}`,
				trackSource: "pedido",
				sincePlayMs: reciente ? Date.now() - ultimo.at : null,
				track: reciente ? { name: ultimo.name, artist: ultimo.artist, uri: ultimo.uri } : null,
				message: mensajeAmigable + detalleTecnico
			});
			scheduleOverlayRefresh(integration);
			return Object.assign({}, result, { message: mensajeAmigable });
		}

		return null;
	}

	// Cerebro (futuro): cuando las reglas no entienden el comentario, se le
	// pregunta a la IA configurada en el dashboard de entrenamiento. Cortex hace
	// la llamada (asi la clave nunca sale del backend) y devuelve el pedido en JSON.
	async function interpretWithAi(integration, comment, data, ctx) {
		const ai = (ctx && ctx.vocab && ctx.vocab.ai) || DEFAULT_VOCABULARY.ai;
		if (ai.enabled !== true || !ai.endpoint || typeof fetch !== "function") return null;
		const rx = (ctx && (ctx.rx || ctx.regexes)) || compileVocabulary(DEFAULT_VOCABULARY);

		// Solo se molesta a la IA si el comentario tiene alguna señal de pedido.
		if (ai.requireSignal !== false) {
			const text = normalizeText(comment);
			const hasSignal = regex("\\b" + rx.musicWords + "\\b").test(text) ||
				regex("\\b" + rx.requestVerbs + "\\b").test(text);
			if (!hasSignal) return null;
		}

		let interpretation = null;
		try {
			const response = await fetch(CORTEX_AI_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					comment: String(comment).slice(0, 400),
					requester: requesterName(data),
					genres: Object.keys(rx.genres)
				})
			});
			const payload = await response.json().catch(() => null);
			interpretation = payload && payload.ok === true ? payload.interpretation : null;
		} catch (error) {
			console.debug("[Spotify Auto Music] La IA no respondio:", error.message);
			return null;
		}
		if (!interpretation || interpretation.action !== "play") return null;

		const query = String(
			interpretation.query ||
			(interpretation.genre ? `genre:${interpretation.genre}` : "") ||
			(interpretation.title && interpretation.artist ? `track:${interpretation.title} artist:${interpretation.artist}` : "") ||
			interpretation.artist ||
			""
		).trim();
		if (query.length < 3) return null;

		// Queda anotado que este pedido lo interpreto la IA (va al historial).
		integration.cortexLastAi = {
			used: true,
			model: String((integration.cortexSpotifyVocabulary || {}).ai ? ((integration.cortexSpotifyVocabulary || {}).ai.model || "") : "").slice(0, 80)
		};
		integration.cortexLastParsed = {
			source: "ai",
			artist: interpretation.artist || "",
			title: interpretation.title || "",
			genre: interpretation.genre || "",
			query,
			confidence: interpretation.confidence === undefined ? null : interpretation.confidence
		};

		const announce = boolSetting(integration, "announce", true);
		if (announce) postRuloBotResponse(describeSearchMessage({ query }), data, "thinking", true);
		const result = await playTrackNow(integration, query, data);
		// El nombre y el texto final los arma replyText (respuestas configurables).
		const responseText = result.message;
		if (announce) postRuloBotResponse(responseText, data, result.success ? "success" : "error");
		reportRequestResult(integration, {
			source: "ia",
			requester: requesterName(data),
			query,
			ok: result.success === true,
			message: responseText,
			track: result.track
		});
		return responseText;
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
			if (!boolSetting(this, "ruloEnabled", true)) return null;
			return playTrackNow(this, query, data);
		};
		SpotifyClass.prototype.describeAutoMusicDevices = function() {
			return describeSpotifyDevices(this);
		};
		// Usa el vocabulario cargado del dashboard si no se le pasa uno.
		SpotifyClass.prototype.parseAutoMusicRequest = function(message, limits) {
			return parseRequest(message, limits || requestLimits(this));
		};
		// Expuestos para el dashboard y las pruebas.
		SpotifyClass.prototype.describeAutoMusicVariants = function(term) {
			return queryVariants(term, compileVocabulary(vocabulary(this)));
		};
		SpotifyClass.prototype.getVocabulary = function() {
			return vocabulary(this);
		};
		// Respuesta que daria el bot para un contexto, con datos de ejemplo.
		// Lo usan el dashboard y las pruebas.
		SpotifyClass.prototype.describeBotReply = function(context, values) {
			activeIntegration = this;
			return replyText(context, values || {}, "");
		};
		SpotifyClass.prototype.getBotResponseContexts = function() {
			const vocabulary = vocabulary(this);
			const responses = (vocabulary && vocabulary.responses) || {};
			return responses.contexts || {};
		};
		SpotifyClass.prototype.describeVocabulary = function() {
			const rx = compileVocabulary(vocabulary(this));
			return {
				commands: rx.commands,
				musicWords: vocabulary(this).musicWords || [],
				requestVerbs: vocabulary(this).requestVerbs || [],
				genres: Object.keys(rx.genres).length,
				ai: vocabulary(this).ai || DEFAULT_VOCABULARY.ai
			};
		};
		SpotifyClass.prototype.interpretWithBrain = function(comment, data) {
			return interpretWithAi(this, comment, data || {}, requestLimits(this));
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
		SpotifyClass.prototype.__cortexCorteDeCierre = corteDeCierre;
		SpotifyClass.prototype.__cortexLimites = function() { return getTrackLimits(this); };
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
			if (!boolSetting(this, "ruloEnabled", true)) return null;
			beginInteraction(this, {
				comment: command,
				platform: data?.type || "",
				requesterId: data?.userid || data?.username || ""
			});
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

			const limits = requestLimits(this);
			const parsed = parseRequest(command, limits);
			// Queda anotado como se leyo (va al historial de analisis).
			if (parsed && !parsed.error) this.cortexLastParsed = parsed;
			// Cerebro (futuro): si las reglas no lo entienden, se le pregunta a la IA.
			if (!parsed) return interpretWithAi(this, command, data, limits);
			const announce = boolSetting(this, "announce", true);
			if (parsed.error) {
				if (announce) postRuloBotResponse(parsed.error, data, "warning");
				return parsed.error;
			}

			// Estado "thinking" en el overlay mientras se resuelve el pedido.
			if (announce) postRuloBotResponse(describeSearchMessage(parsed), data, "thinking", true);
			const result = await playTrackNow(this, parsed.query, data);
			// El nombre y el texto final los arma replyText (respuestas configurables).
			const response = result.message;
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
		const handleRuloCommand = SpotifyClass.prototype.handleCommand;
		SpotifyClass.prototype.handleCommand = function(command, data = {}) {
			if (!boolSetting(this, "ruloEnabled", true) || data.bot || data.event || data.private || data.history || data.replay || data.reflection) return Promise.resolve(null);
			const limits = requestLimits(this);
			const parsed = parseRequest(command, limits);
			const ai = limits.vocab.ai || DEFAULT_VOCABULARY.ai;
			const text = normalizeText(command);
			const aiCandidate = ai.enabled === true && (ai.requireSignal === false ||
				regex("\\b" + limits.regexes.musicWords + "\\b").test(text) || regex("\\b" + limits.regexes.requestVerbs + "\\b").test(text));
			if ((parsed && !parsed.error) || aiCandidate) {
				return enqueueMusicRequest(this, () => handleRuloCommand.call(this, command, data), null);
			}
			return handleRuloCommand.call(this, command, data);
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
				// (El salto automatico de 10s NO se cuenta como enganche: es una regla
				//  configurada, no una decision de la gente.)
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
