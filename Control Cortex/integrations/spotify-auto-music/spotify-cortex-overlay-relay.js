(function() {
	"use strict";

	// URL base de Cortex: la genera el auto-patcher (local-overrides/cortex-base-url.js).
	const CORTEX_BASE_URL = (() => {
		const configured = (typeof window !== "undefined" && window.CORTEX_BASE_URL)
			? String(window.CORTEX_BASE_URL)
			: "http://192.168.4.100:4000";
		return configured.replace(/\/+$/, "");
	})();
	const RELAY_URL = CORTEX_BASE_URL + "/api/spotify-overlay";
	let installAttempts = 0;

	function postSpotifyOverlay(payload) {
		if (!payload || typeof fetch !== "function") return;
		fetch(RELAY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ spotify: payload })
		}).catch(function(error) {
			console.warn("[Spotify Cortex Relay] No se pudo enviar el estado a Control Cortex:", error);
		});
	}

	function install() {
		const original = window.sendSpotifyOverlay;
		if (typeof original !== "function") {
			installAttempts += 1;
			if (installAttempts < 40) setTimeout(install, 500);
			return;
		}
		if (original.__cortexOverlayRelayWrapped) return;

		window.sendSpotifyOverlay = function(payload, uid) {
			const result = original.apply(this, arguments);
			if (!uid) postSpotifyOverlay(payload);
			return result;
		};
		window.sendSpotifyOverlay.__cortexOverlayRelayWrapped = true;
		console.log("[Spotify Cortex Relay] Enviando estado de Spotify a Control Cortex.");
	}

	install();
})();
