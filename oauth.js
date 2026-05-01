"use strict";

const oauthStorageKeys = {
    clientId: "oauth_client_id",
    session: "oauth_session",
    pendingState: "oauth_pending_state",
    pendingVerifier: "oauth_pending_verifier"
};

const oauthConfig = {
    authorizeUrl: "https://www.warcraftlogs.com/oauth/authorize",
    tokenUrl: "https://www.warcraftlogs.com/oauth/token"
};

function getOAuthClientId() {
    const input = document.getElementById("oauth_client_id");
    if (input && input.value.trim()) {
        return input.value.trim();
    }
    return localStorage.getItem(oauthStorageKeys.clientId) || "";
}

function setOAuthClientId(clientId) {
    localStorage.setItem(oauthStorageKeys.clientId, clientId || "");
}

function getOAuthRedirectUri() {
    return location.origin + location.pathname;
}

function bytesToBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64Url(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value) {
    const encoded = new TextEncoder().encode(value);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    return bytesToBase64Url(new Uint8Array(hashBuffer));
}

function getStoredOAuthSession() {
    const raw = localStorage.getItem(oauthStorageKeys.session);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.warn("Could not parse OAuth session.", e);
        localStorage.removeItem(oauthStorageKeys.session);
        return null;
    }
}

function setStoredOAuthSession(tokenResponse) {
    if (!tokenResponse || !tokenResponse.access_token) {
        throw new Error("Missing access token from Warcraft Logs.");
    }
    const expiresIn = Number(tokenResponse.expires_in || 3600);
    const session = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token || "",
        tokenType: tokenResponse.token_type || "Bearer",
        scope: tokenResponse.scope || "",
        expiresAt: Date.now() + expiresIn * 1000
    };
    localStorage.setItem(oauthStorageKeys.session, JSON.stringify(session));
    return session;
}

function clearOAuthSession() {
    localStorage.removeItem(oauthStorageKeys.session);
}

function clearPendingOAuthState() {
    localStorage.removeItem(oauthStorageKeys.pendingState);
    localStorage.removeItem(oauthStorageKeys.pendingVerifier);
}

function isOAuthSessionExpired(session, skewMs = 30000) {
    if (!session || !session.expiresAt) {
        return true;
    }
    return Date.now() >= (Number(session.expiresAt) - skewMs);
}

function getOAuthStatusDetails() {
    const session = getStoredOAuthSession();
    if (!session || !session.accessToken) {
        return {
            state: "disconnected",
            text: "Not Signed In"
        };
    }
    if (isOAuthSessionExpired(session, 0)) {
        return {
            state: "expired",
            text: "Not Signed In"
        };
    }
    const secondsLeft = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
    const minutesLeft = Math.floor(secondsLeft / 60);
    return {
        state: "connected",
        text: "Signed In - Click to Disconnect (" + minutesLeft + "m left)"
    };
}

function refreshAuthNotifierUI(statusDetails) {
    const notifierEl = document.getElementById("oauth_notifier");
    if (!notifierEl) {
        return;
    }
    const details = statusDetails || getOAuthStatusDetails();
    notifierEl.textContent = details.text;
    notifierEl.classList.remove("oauth-notifier-connected", "oauth-notifier-expired", "oauth-notifier-disconnected");
    notifierEl.classList.add("oauth-notifier-" + details.state);
    notifierEl.classList.add("oauth-notifier-interactable");
    notifierEl.setAttribute(
        "title",
        details.state === "connected"
            ? "Signed in. Click to disconnect."
            : "Not signed in. Click to sign in with Warcraft Logs."
    );
}

function refreshAuthStatusUI() {
    const statusDetails = getOAuthStatusDetails();
    refreshAuthNotifierUI(statusDetails);
}

function syncAuthStateFromLocalStorageOnLoad() {
    const rawSession = localStorage.getItem(oauthStorageKeys.session);
    if (!rawSession) {
        clearOAuthSession();
        clearPendingOAuthState();
        refreshAuthStatusUI();
        return false;
    }
    const parsedSession = getStoredOAuthSession();
    if (!parsedSession || !parsedSession.accessToken) {
        clearOAuthSession();
        clearPendingOAuthState();
        refreshAuthStatusUI();
        return false;
    }
    refreshAuthStatusUI();
    return true;
}

function promptForOAuthClientId(currentClientId) {
    const prompted = window.prompt("Enter your Warcraft Logs OAuth client ID:", currentClientId || "");
    if (prompted === null) {
        return null;
    }
    const trimmed = prompted.trim();
    if (!trimmed) {
        alert("A Warcraft Logs OAuth client ID is required to sign in.");
        return null;
    }
    return trimmed;
}

async function handleOAuthPanelClick() {
    const status = getOAuthStatusDetails();
    if (status.state === "connected") {
        const shouldDisconnect = window.confirm("Sign out from Warcraft Logs on this browser?");
        if (shouldDisconnect) {
            disconnectWarcraftLogs();
        }
        return;
    }
    const existingClientId = getOAuthClientId();
    const clientId = promptForOAuthClientId(existingClientId);
    if (!clientId) {
        return;
    }
    setOAuthClientId(clientId);
    await connectWarcraftLogs();
}

function initializeOAuthPanelInteractions() {
    const notifierEl = document.getElementById("oauth_notifier");
    if (!notifierEl || notifierEl.dataset.oauthBound === "true") {
        return;
    }
    notifierEl.dataset.oauthBound = "true";
    notifierEl.addEventListener("click", () => {
        handleOAuthPanelClick().catch((e) => {
            console.error(e);
            alert("OAuth error:\n" + (e && e.message ? e.message : e));
        });
    });
}

function initializeOAuthUIOnReady() {
    syncAuthStateFromLocalStorageOnLoad();
    initializeOAuthPanelInteractions();
    refreshAuthStatusUI();
}

function removeOAuthQueryParamsFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    const query = url.searchParams.toString();
    const newUrl = url.pathname + (query ? "?" + query : "") + url.hash;
    history.replaceState({}, document.title, newUrl);
}

async function exchangeOAuthToken(bodyParams) {
    const response = await fetch(oauthConfig.tokenUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams(bodyParams).toString()
    });
    if (!response.ok) {
        let details = "";
        try {
            details = await response.text();
        } catch (e) {
            details = "";
        }
        throw new Error("OAuth token exchange failed (" + response.status + "): " + details);
    }
    return response.json();
}

async function connectWarcraftLogs() {
    const clientId = getOAuthClientId();
    if (!clientId) {
        alert("Click the auth panel and enter your Warcraft Logs OAuth client id first.");
        return;
    }
    setOAuthClientId(clientId);

    const state = randomBase64Url(24);
    const verifier = randomBase64Url(48);
    const challenge = await sha256Base64Url(verifier);

    localStorage.setItem(oauthStorageKeys.pendingState, state);
    localStorage.setItem(oauthStorageKeys.pendingVerifier, verifier);

    const authorizeUrl = new URL(oauthConfig.authorizeUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", getOAuthRedirectUri());
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    window.location.assign(authorizeUrl.toString());
}

function disconnectWarcraftLogs() {
    clearOAuthSession();
    clearPendingOAuthState();
    if (typeof clearLoadedReportCache === "function") {
        clearLoadedReportCache();
    }
    if (window.weaveDelayStorage && typeof window.weaveDelayStorage.clearAll === "function") {
        window.weaveDelayStorage.clearAll().catch((e) => {
            console.warn("Failed to clear local report cache on sign-out.", e);
        });
    }
    refreshAuthStatusUI();
}

async function refreshAuthAccessToken() {
    const session = getStoredOAuthSession();
    const clientId = getOAuthClientId();
    if (!session || !session.refreshToken || !clientId) {
        return null;
    }
    try {
        const tokenResponse = await exchangeOAuthToken({
            grant_type: "refresh_token",
            refresh_token: session.refreshToken,
            client_id: clientId
        });
        const refreshed = setStoredOAuthSession(tokenResponse);
        refreshAuthStatusUI();
        return refreshed.accessToken;
    } catch (e) {
        console.warn("Token refresh failed, clearing OAuth session.", e);
        clearOAuthSession();
        refreshAuthStatusUI();
        return null;
    }
}

async function ensureAuthAccessToken() {
    const session = getStoredOAuthSession();
    if (!session || !session.accessToken) {
        throw new Error("Warcraft Logs is not connected. Click the auth panel to sign in.");
    }
    if (!isOAuthSessionExpired(session)) {
        return session.accessToken;
    }
    const refreshedAccessToken = await refreshAuthAccessToken();
    if (refreshedAccessToken) {
        return refreshedAccessToken;
    }
    clearOAuthSession();
    refreshAuthStatusUI();
    throw new Error("Warcraft Logs login expired. Click the auth panel to reconnect.");
}

async function initializeOAuthFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const authError = params.get("error");
    const authErrorDescription = params.get("error_description");

    if (!code && !authError) {
        refreshAuthStatusUI();
        return false;
    }

    if (authError) {
        removeOAuthQueryParamsFromUrl();
        refreshAuthStatusUI();
        throw new Error("OAuth authorization failed: " + authError + (authErrorDescription ? " (" + authErrorDescription + ")" : ""));
    }

    const expectedState = localStorage.getItem(oauthStorageKeys.pendingState);
    const verifier = localStorage.getItem(oauthStorageKeys.pendingVerifier);
    const clientId = getOAuthClientId();

    if (!state || !expectedState || state !== expectedState || !verifier) {
        removeOAuthQueryParamsFromUrl();
        clearPendingOAuthState();
        refreshAuthStatusUI();
        throw new Error("OAuth state validation failed. Please reconnect.");
    }
    if (!clientId) {
        removeOAuthQueryParamsFromUrl();
        clearPendingOAuthState();
        refreshAuthStatusUI();
        throw new Error("Missing OAuth client id. Enter client id and reconnect.");
    }

    const tokenResponse = await exchangeOAuthToken({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: getOAuthRedirectUri(),
        client_id: clientId,
        code_verifier: verifier
    });
    setStoredOAuthSession(tokenResponse);
    clearPendingOAuthState();
    removeOAuthQueryParamsFromUrl();
    refreshAuthStatusUI();
    return true;
}

window.connectWarcraftLogs = connectWarcraftLogs;
window.disconnectWarcraftLogs = disconnectWarcraftLogs;
window.ensureAuthAccessToken = ensureAuthAccessToken;
window.refreshAuthAccessToken = refreshAuthAccessToken;
window.initializeOAuthFromUrl = initializeOAuthFromUrl;
window.refreshAuthStatusUI = refreshAuthStatusUI;
window.initializeOAuthPanelInteractions = initializeOAuthPanelInteractions;
window.syncAuthStateFromLocalStorageOnLoad = syncAuthStateFromLocalStorageOnLoad;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeOAuthUIOnReady);
} else {
    initializeOAuthUIOnReady();
}
