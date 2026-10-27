(() => {
  "use strict";

  // Funda Activity Tracking API: batches of up to 20 events per request, tied
  // to a session. The player comes from the Bearer token, not the URL.
  const ENDPOINT = window.FUNDA_EVENTS_URL
    || "https://apip-preprod.classplusapp.com/funda/api/activity/events";
  const APP = "pacman";
  const TOKEN_KEY = "funda-token";
  const BATCH_SIZE = 20;
  const MAX_QUEUE = 200;
  const FLUSH_INTERVAL_MS = 5000;
  const HEARTBEAT_INTERVAL_MS = 30000;

  function createUuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      const value = character === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  // The host app opens the game with ?token=<Funda JWT>. The token is kept so
  // reloads keep reporting for the same player.
  function resolveToken() {
    try {
      const supplied = new URLSearchParams(window.location.search).get("token")?.trim();
      if (supplied) {
        localStorage.setItem(TOKEN_KEY, supplied);
        return supplied;
      }
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  let token = resolveToken();
  if (!token) {
    window.PacmanTracking = Object.freeze({
      gameStarted() {},
      updateSnapshot() {},
      levelCompleted() {},
      gameEnded() {}
    });
    return;
  }

  let sessionId = createUuid();
  let gameId = null;
  let activeMilliseconds = 0;
  let activeStartedAt = document.hidden ? null : performance.now();
  let gameActiveStart = 0;
  let latestScore = 0;
  let latestLevel = 1;
  let queue = [];
  let sending = false;
  let lastSentAt = 0;

  function updateActiveTime() {
    const now = performance.now();
    if (activeStartedAt !== null) {
      activeMilliseconds += Math.max(0, now - activeStartedAt);
    }
    activeStartedAt = document.hidden ? null : now;
  }

  function activeSeconds() {
    updateActiveTime();
    return Math.floor(activeMilliseconds / 1000);
  }

  function track(type, payload) {
    if (!token) return;
    queue.push({ eventId: createUuid(), type, ...(payload ? { payload } : {}) });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    if (queue.length >= BATCH_SIZE) flush();
  }

  // Events carry UUIDs, so resending a batch after a failure is safe.
  async function flush() {
    if (!token || sending) return;
    sending = true;
    try {
      do {
        const events = queue.slice(0, BATCH_SIZE);
        const response = await window.fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            app: APP,
            session: { sessionId, activeSeconds: activeSeconds() },
            events
          }),
          credentials: "omit",
          keepalive: true
        });
        // A 4xx batch would fail again; only network errors and 5xx retry.
        if (response.status >= 500) break;
        if (response.status === 401) token = null;
        lastSentAt = Date.now();
        queue = queue.slice(events.length);
      } while (queue.length && token);
    } catch {
      // Offline: the queue is sent with the next flush.
    } finally {
      sending = false;
    }
  }

  function gameDetails(overrides = {}) {
    return {
      gameId,
      level: latestLevel,
      score: latestScore,
      timeSpentSeconds: Math.max(0, activeSeconds() - gameActiveStart),
      ...overrides
    };
  }

  function gameStarted() {
    if (gameId) {
      track("game_ended", gameDetails({ status: "restarted" }));
    }
    gameId = createUuid();
    gameActiveStart = activeSeconds();
    latestScore = 0;
    latestLevel = 1;
    track("game_started", { gameId, level: 1 });
    flush();
  }

  function updateSnapshot(score, level) {
    if (!gameId) return;
    latestScore = Math.max(latestScore, Math.floor(score || 0));
    latestLevel = Math.max(latestLevel, Math.floor(level || 1));
  }

  function levelCompleted(level, score) {
    if (!gameId) return;
    updateSnapshot(score, level);
    track("level_completed", gameDetails({ level }));
    flush();
  }

  function gameEnded(status, score, level) {
    if (!gameId) return;
    updateSnapshot(score, level);
    track("game_ended", gameDetails({ status: status || "abandoned" }));
    gameId = null;
    flush();
  }

  document.addEventListener("visibilitychange", () => {
    updateActiveTime();
    track(document.hidden ? "session_paused" : "session_resumed");
    flush();
  });

  window.addEventListener("pagehide", () => {
    if (gameId) {
      track("game_ended", gameDetails({ status: "abandoned" }));
      gameId = null;
    }
    track("session_ended");
    flush();
  });

  window.addEventListener("pageshow", (event) => {
    // Restored from the back-forward cache after session_ended.
    if (!event.persisted) return;
    sessionId = createUuid();
    activeMilliseconds = 0;
    activeStartedAt = document.hidden ? null : performance.now();
    track("session_started");
    flush();
  });

  // Queued events go out every few seconds; an empty batch is the heartbeat.
  window.setInterval(() => {
    if (queue.length || Date.now() - lastSentAt >= HEARTBEAT_INTERVAL_MS) flush();
  }, FLUSH_INTERVAL_MS);

  track("session_started");
  flush();

  window.PacmanTracking = Object.freeze({
    gameStarted,
    updateSnapshot,
    levelCompleted,
    gameEnded
  });
})();
