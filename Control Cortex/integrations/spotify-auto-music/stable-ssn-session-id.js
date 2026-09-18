(function() {
	"use strict";

	const STABLE_SESSION_ID = "XJ9hQ2JDHH";

	function persistStableSessionId() {
		try {
			localStorage.setItem("streamID", STABLE_SESSION_ID);
			localStorage.setItem("ssninja_stream_id", STABLE_SESSION_ID);
		} catch (error) {
			console.warn("[Stable SSN Session] No se pudo actualizar localStorage:", error);
		}

		try {
			if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
				chrome.storage.sync.set({ streamID: STABLE_SESSION_ID });
			}
		} catch (error) {
			console.warn("[Stable SSN Session] No se pudo actualizar chrome.storage.sync:", error);
		}
	}

	persistStableSessionId();
	window.SSN_STABLE_SESSION_ID = STABLE_SESSION_ID;
	console.log("[Stable SSN Session] Session ID fijado en", STABLE_SESSION_ID);
})();
