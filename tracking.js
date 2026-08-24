(() => {
  "use strict";

  const SUPABASE_URL = "https://czzwqpyylagvannwsvix.supabase.co";
  const SUPABASE_PUBLIC_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6endxcHl5bGFndmFubndzdml4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMDQ4NTUsImV4cCI6MjEwMDg4MDg1NX0.NdkVn0IZe_FY0ZN9IvcajSeYhxZ04uD3_gKx3AERSks";
  const TRACKING_RPC = SUPABASE_URL + "/rest/v1/rpc/pacman_track_activity";
  const HEARTBEAT_INTERVAL_MS = 15000;

  function createUuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      const value = character === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function resolveUserId() {
    const params = new URLSearchParams(window.location.search);
    const supplied = window.PACMAN_USER_ID
      || params.get("user_id")
      || params.get("userId")
      || params.get("userid")
      || params.get("uid");
    const normalized = String(supplied || "").trim().slice(0, 128);
    if (!normalized || ["userid", "user_id", "undefined", "null"].includes(normalized.toLowerCase())) {
      return null;
    }
    return normalized;
  }

  const userId = resolveUserId();
  if (!userId) {
    window.PacmanTracking = Object.freeze({
      userId: null,
      gameStarted() {},
      updateSnapshot() {},
      levelCompleted() {},
      gameEnded() {}
    });
    return;
  }
  let sessionId = null;
  let activeMilliseconds = 0;
  let activeStartedAt = null;
  let heartbeatTimer = 0;
  let latestScore = 0;
  let latestLevel = 1;
  let requestQueue = Promise.resolve();

  function request(eventType, details = {}, keepalive = false) {
    return window.fetch(TRACKING_RPC, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLIC_KEY,
        Authorization: "Bearer " + SUPABASE_PUBLIC_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_event_type: eventType,
        p_user_id: userId,
        p_session_id: details.sessionId || null,
        p_level_number: details.level ?? null,
        p_score: Math.max(0, Math.floor(details.score || 0)),
        p_time_spent_seconds: Math.max(0, Math.floor(details.timeSpent || 0)),
        p_status: details.status || null
      }),
      credentials: "omit",
      keepalive
    }).then((response) => {
      if (!response.ok) throw new Error("Pac-Man tracking request failed");
      return response;
    });
  }

  function enqueue(eventType, details) {
    requestQueue = requestQueue
      .catch(() => {})
      .then(() => request(eventType, details))
      .catch(() => {});
    return requestQueue;
  }

  function updateActiveTime() {
    if (!sessionId) return;
    const now = performance.now();
    if (activeStartedAt !== null) {
      activeMilliseconds += Math.max(0, now - activeStartedAt);
    }
    activeStartedAt = document.hidden ? null : now;
  }

  function timeSpentSeconds() {
    updateActiveTime();
    return Math.floor(activeMilliseconds / 1000);
  }

  function sessionDetails(overrides = {}) {
    return {
      sessionId,
      level: latestLevel,
      score: latestScore,
      timeSpent: timeSpentSeconds(),
      ...overrides
    };
  }

  function sendHeartbeat() {
    if (!sessionId) return;
    enqueue("heartbeat", sessionDetails());
  }

  function stopHeartbeat() {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
  }

  function gameStarted() {
    if (sessionId) {
      enqueue("game_ended", sessionDetails({ status: "restarted" }));
    }

    stopHeartbeat();
    sessionId = createUuid();
    activeMilliseconds = 0;
    activeStartedAt = document.hidden ? null : performance.now();
    latestScore = 0;
    latestLevel = 1;
    enqueue("game_started", sessionDetails());
    heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  }

  function updateSnapshot(score, level) {
    if (!sessionId) return;
    latestScore = Math.max(latestScore, Math.floor(score || 0));
    latestLevel = Math.max(latestLevel, Math.floor(level || 1));
  }

  function levelCompleted(level, score) {
    if (!sessionId) return;
    updateSnapshot(score, level);
    enqueue("level_completed", sessionDetails({ level }));
  }

  function gameEnded(status, score, level) {
    if (!sessionId) return;
    updateSnapshot(score, level);
    const finalDetails = sessionDetails({ status: status || "abandoned" });
    stopHeartbeat();
    enqueue("game_ended", finalDetails);
    sessionId = null;
    activeStartedAt = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (!sessionId) return;
    updateActiveTime();
    if (document.hidden) sendHeartbeat();
  });

  window.addEventListener("pagehide", () => {
    if (!sessionId) return;
    const finalDetails = sessionDetails({ status: "abandoned" });
    request("game_ended", finalDetails, true).catch(() => {});
  });

  enqueue("user_arrived", {});

  window.PacmanTracking = Object.freeze({
    userId,
    gameStarted,
    updateSnapshot,
    levelCompleted,
    gameEnded
  });
})();
