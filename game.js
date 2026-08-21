(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const landingPage = document.getElementById("landingPage");
  const landingBestScore = document.getElementById("landingBestScore");
  const rulesPage = document.getElementById("rulesPage");
  const pauseOverlay = document.getElementById("pauseOverlay");
  const startButton = document.getElementById("startButton");
  const howToPlayButton = document.getElementById("howToPlayButton");
  const rulesStartButton = document.getElementById("rulesStartButton");
  const rulesStartLabel = document.getElementById("rulesStartLabel");
  const rulesBackButton = document.getElementById("rulesBackButton");
  const resumeButton = document.getElementById("resumeButton");
  const pauseHowToPlayButton = document.getElementById("pauseHowToPlayButton");
  const exitGameButton = document.getElementById("exitGameButton");
  const endOverlay = document.getElementById("endOverlay");
  const endStartButton = document.getElementById("endStartButton");
  const finalScore = document.getElementById("finalScore");
  const leaderboardList = document.getElementById("leaderboardList");
  const pauseButton = document.getElementById("pauseButton");
  const soundButton = document.getElementById("soundButton");
  const screenWrap = document.getElementById("screenWrap");
  const dpadWell = document.querySelector(".dpad-well");

  const TILE = 24;
  const HUD = 72;
  const COLS = 21;
  const ROWS = 24;
  const WIDTH = COLS * TILE;
  const HEIGHT = HUD + ROWS * TILE;

  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const MAZE_BOUNDS = [
    { left: 3, right: 17, top: 4, bottom: 20 },
    { left: 2, right: 18, top: 3, bottom: 21 },
    { left: 1, right: 19, top: 2, bottom: 22 },
    { left: 0, right: 20, top: 1, bottom: 23 },
    { left: 0, right: 20, top: 0, bottom: 23 }
  ];

  const WALL_SEGMENTS = [
    { stage: 0, row: 6, from: 6, to: 8 },
    { stage: 0, row: 6, from: 12, to: 14 },
    { stage: 0, row: 14, from: 5, to: 7 },
    { stage: 0, row: 14, from: 13, to: 15 },
    { stage: 0, col: 6, from: 16, to: 18 },
    { stage: 0, col: 14, from: 16, to: 18 },
    { stage: 1, row: 4, from: 5, to: 7 },
    { stage: 1, row: 4, from: 13, to: 15 },
    { stage: 1, col: 4, from: 7, to: 10 },
    { stage: 1, col: 16, from: 7, to: 10 },
    { stage: 2, row: 18, from: 3, to: 7 },
    { stage: 2, row: 18, from: 13, to: 17 },
    { stage: 2, col: 3, from: 12, to: 15 },
    { stage: 2, col: 17, from: 12, to: 15 },
    { stage: 3, row: 2, from: 4, to: 8 },
    { stage: 3, row: 2, from: 12, to: 16 },
    { stage: 3, col: 2, from: 5, to: 8 },
    { stage: 3, col: 18, from: 5, to: 8 },
    { stage: 4, row: 21, from: 4, to: 8 },
    { stage: 4, row: 21, from: 12, to: 16 }
  ];

  const DIRS = {
    none: { x: 0, y: 0, angle: 0 },
    right: { x: 1, y: 0, angle: 0 },
    down: { x: 0, y: 1, angle: Math.PI / 2 },
    left: { x: -1, y: 0, angle: Math.PI },
    up: { x: 0, y: -1, angle: -Math.PI / 2 }
  };
  const OPPOSITE = { right: "left", left: "right", up: "down", down: "up", none: "none" };
  const GHOST_COLORS = ["#ff355e", "#ff85d6", "#42e6f5", "#ff9d3d"];
  const GHOST_DIFFICULTIES = [
    {
      label: "EASY",
      speed: 60,
      frightenedSpeed: 38,
      releases: [1, 7, 16, 26],
      accuracy: 0.28,
      scatter: 9,
      chase: 5,
      powerSeconds: 9
    },
    {
      label: "EASY+",
      speed: 68,
      frightenedSpeed: 44,
      releases: [0.75, 5, 11, 18],
      accuracy: 0.42,
      scatter: 8,
      chase: 6,
      powerSeconds: 8
    },
    {
      label: "NORMAL",
      speed: 77,
      frightenedSpeed: 50,
      releases: [0.5, 3.5, 7.5, 12],
      accuracy: 0.58,
      scatter: 7,
      chase: 7,
      powerSeconds: 7
    },
    {
      label: "HARD",
      speed: 87,
      frightenedSpeed: 57,
      releases: [0.25, 2.25, 4.5, 7],
      accuracy: 0.74,
      scatter: 6,
      chase: 8,
      powerSeconds: 6
    },
    {
      label: "EXPERT",
      speed: 98,
      frightenedSpeed: 64,
      releases: [0, 1.25, 2.5, 3.75],
      accuracy: 0.9,
      scatter: 5,
      chase: 10,
      powerSeconds: 5
    }
  ];
  const TURN_WINDOW = 6;
  const HOUSE_EXIT = { col: 10, row: 7 };
  const HOUSE_CENTER = { col: 10, row: 9 };

  let board = [];
  let pelletsLeft = 0;
  let totalPellets = 0;
  let score = 0;
  let highScore = loadHighScore();
  let lives = 3;
  let level = 1;
  let state = "title";
  let lastTime = 0;
  let phaseTime = 0;
  let frightenedUntil = 0;
  let ghostChain = 0;
  let bonusAwarded = false;
  let fruit = { active: false, shown: false, expires: 0 };
  let player;
  let ghosts = [];
  let audioContext = null;
  let masterGain = null;
  let musicGain = null;
  let effectsGain = null;
  let soundOn = true;
  let chompTone = false;
  let musicStep = 0;
  let nextMusicNoteAt = 0;
  let animationId = null;
  let touchStart = null;
  let activeDirectionButton = null;
  let directionFeedbackTimer = 0;
  let introTransitionTimer = 0;
  let rulesReadyTimer = 0;
  let rulesCountdownTimer = 0;
  let rulesAutoStart = false;
  let preparationMusicActive = false;
  let rulesOrigin = "landing";
  let confetti = [];
  let currentRunId = "";
  let activeMazeBounds = MAZE_BOUNDS[0];

  const MUSIC_STEP_SECONDS = 0.125;
  const MUSIC_MELODY = [
    659.25, 783.99, 880, 783.99, 659.25, 523.25, 587.33, null,
    659.25, 783.99, 987.77, 880, 783.99, 659.25, 587.33, null,
    523.25, 659.25, 783.99, 659.25, 587.33, 523.25, 493.88, null,
    587.33, 659.25, 783.99, 987.77, 880, 783.99, 659.25, null
  ];
  const MUSIC_BASS = [130.81, 130.81, 146.83, 146.83, 110, 110, 123.47, 123.47];

  function loadHighScore() {
    try {
      return Number(window.localStorage.getItem("pocket-chomp-high") || 0);
    } catch (_error) {
      return 0;
    }
  }

  function saveHighScore() {
    try {
      window.localStorage.setItem("pocket-chomp-high", String(highScore));
    } catch (_error) {
      // Storage can be unavailable when the game is opened directly from disk.
    }
  }

  function loadTodayBest() {
    try {
      const entries = JSON.parse(window.localStorage.getItem(dailyScoreKey()) || "[]");
      return Array.isArray(entries) && entries.length
        ? Math.max(...entries.map((entry) => Number(entry.score) || 0))
        : 0;
    } catch (_error) {
      return 0;
    }
  }

  function dailyScoreKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `funda-champ-daily-${year}-${month}-${day}`;
  }

  function saveDailyScore() {
    const entry = { id: currentRunId, score, level };
    let entries = [];
    try {
      entries = JSON.parse(window.localStorage.getItem(dailyScoreKey()) || "[]");
      if (!Array.isArray(entries)) entries = [];
    } catch (_error) {
      entries = [];
    }
    entries.push(entry);
    entries.sort((a, b) => b.score - a.score || b.level - a.level);
    entries = entries.slice(0, 5);
    try {
      window.localStorage.setItem(dailyScoreKey(), JSON.stringify(entries));
    } catch (_error) {
      // The current score still renders if browser storage is unavailable.
    }
    return entries;
  }

  function renderDailyLeaderboard(entries) {
    leaderboardList.textContent = "";
    entries.slice(0, 5).forEach((entry) => {
      const item = document.createElement("li");
      if (entry.id === currentRunId) item.classList.add("current");
      const name = document.createElement("span");
      const levelText = document.createElement("span");
      const scoreText = document.createElement("span");
      name.textContent = entry.id === currentRunId ? "YOU" : "PLAYER";
      levelText.className = "board-level";
      levelText.textContent = `LV ${entry.level}`;
      scoreText.textContent = String(entry.score).padStart(6, "0");
      item.append(name, levelText, scoreText);
      leaderboardList.appendChild(item);
    });
  }

  function tileCenter(col, row) {
    return { x: col * TILE + TILE / 2, y: HUD + row * TILE + TILE / 2 };
  }

  function ghostDifficulty() {
    return GHOST_DIFFICULTIES[Math.min(level - 1, GHOST_DIFFICULTIES.length - 1)];
  }

  function mazeDisplayTransform() {
    const { left, right, top, bottom } = activeMazeBounds;
    const mazeWidth = (right - left + 1) * TILE;
    const mazeHeight = (bottom - top + 1) * TILE;
    const playHeight = ROWS * TILE;
    const scale = Math.min(WIDTH / mazeWidth, playHeight / mazeHeight);
    return {
      scale,
      x: (WIDTH - mazeWidth * scale) / 2,
      y: HUD + (playHeight - mazeHeight * scale) / 2,
      sourceX: left * TILE,
      sourceY: HUD + top * TILE
    };
  }

  function buildLevelMaze() {
    const stage = Math.min(level - 1, MAZE_BOUNDS.length - 1);
    activeMazeBounds = MAZE_BOUNDS[stage];
    const { left, right, top, bottom } = activeMazeBounds;
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(" "));

    for (let row = top; row <= bottom; row += 1) {
      for (let col = left; col <= right; col += 1) {
        const boundary = row === top || row === bottom || col === left || col === right;
        grid[row][col] = boundary ? "#" : ".";
      }
    }

    WALL_SEGMENTS.forEach((segment) => {
      if (segment.stage > stage) return;
      if (segment.row !== undefined) {
        for (let col = segment.from; col <= segment.to; col += 1) {
          if (segment.row > top && segment.row < bottom && col > left && col < right) {
            grid[segment.row][col] = "#";
          }
        }
      } else {
        for (let row = segment.from; row <= segment.to; row += 1) {
          if (row > top && row < bottom && segment.col > left && segment.col < right) {
            grid[row][segment.col] = "#";
          }
        }
      }
    });

    // A compact central ghost house shared by every maze size.
    for (let col = 8; col <= 12; col += 1) grid[8][col] = "#";
    grid[8][10] = "=";
    for (let row = 9; row <= 10; row += 1) {
      grid[row][8] = "#";
      grid[row][12] = "#";
      for (let col = 9; col <= 11; col += 1) grid[row][col] = " ";
    }
    for (let col = 8; col <= 12; col += 1) grid[11][col] = "#";

    const powerPellets = [
      [left + 1, top + 1],
      [right - 1, top + 1],
      [left + 1, bottom - 1],
      [right - 1, bottom - 1]
    ];
    powerPellets.forEach(([col, row]) => {
      if (grid[row][col] === ".") grid[row][col] = "o";
    });
    return grid;
  }

  function makeBoard() {
    pelletsLeft = 0;
    board = buildLevelMaze().map((row) => row.map((cell) => {
      if (cell === "." || cell === "o") pelletsLeft += 1;
      return cell;
    }));
    totalPellets = pelletsLeft;
    fruit = { active: false, shown: false, expires: 0 };
  }

  function makeActor(col, row, dir, speed) {
    const pos = tileCenter(col, row);
    return {
      x: pos.x,
      y: pos.y,
      col,
      row,
      dir,
      wanted: dir,
      speed,
      radius: TILE * 0.42,
      progress: 0,
      alive: true
    };
  }

  function resetActors() {
    player = makeActor(10, 17, "left", Math.min(112 + (level - 1) * 3, 132));
    player.mouth = 0;
    player.spawnLock = 0.75;

    const starts = [
      [10, 9, "left"],
      [9, 9, "right"],
      [11, 9, "left"],
      [10, 10, "up"]
    ];
    const difficulty = ghostDifficulty();
    ghosts = starts.map(([col, row, dir], index) => {
      const ghost = makeActor(col, row, dir, difficulty.speed);
      ghost.color = GHOST_COLORS[index];
      ghost.index = index;
      ghost.home = HOUSE_CENTER;
      ghost.releaseAt = phaseTime + difficulty.releases[index];
      ghost.eaten = false;
      ghost.inHouse = true;
      return ghost;
    });
    frightenedUntil = 0;
    ghostChain = 0;
  }

  function startGame(fresh = false) {
    ensureAudio();
    preparationMusicActive = false;
    const completedCountdown = rulesAutoStart;
    cancelRulesCountdown(!completedCountdown);
    if (completedCountdown) {
      rulesStartButton.style.setProperty("--countdown-progress", "100%");
      rulesStartLabel.textContent = "STARTING GAME";
    }
    window.clearTimeout(introTransitionTimer);
    if (fresh || state === "title" || state === "gameover") {
      confetti = [];
      score = 0;
      lives = 3;
      level = 1;
      bonusAwarded = false;
      currentRunId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      phaseTime = 0;
      makeBoard();
      resetActors();
    }
    state = "playing";
    resetMusicClock(0.22);
    pauseButton.classList.add("is-playing");
    pauseButton.setAttribute("aria-label", "Pause game");
    pauseButton.nextElementSibling.textContent = "PAUSE";
    landingPage.classList.add("is-leaving");
    rulesPage.classList.add("is-leaving");
    introTransitionTimer = window.setTimeout(() => {
      landingPage.classList.add("hidden");
      rulesPage.classList.add("hidden");
      landingPage.classList.remove("is-leaving");
      rulesPage.classList.remove("is-leaving", "is-entering");
      resetRulesCountdownButton();
    }, 360);
    pauseOverlay.classList.add("hidden");
    endOverlay.classList.add("hidden");
    blip(440, 0.055, "square", 0.035);
    blip(660, 0.08, "square", 0.025, 0.07);
  }

  function resetRulesCountdownButton() {
    rulesStartButton.disabled = false;
    rulesStartButton.removeAttribute("aria-label");
    rulesStartButton.classList.remove("is-counting-down");
    rulesStartButton.style.removeProperty("--countdown-progress");
    rulesStartLabel.textContent = "LET'S PLAY";
  }

  function cancelRulesCountdown(resetButton = true) {
    if (rulesReadyTimer) window.clearTimeout(rulesReadyTimer);
    if (rulesCountdownTimer) window.clearInterval(rulesCountdownTimer);
    rulesReadyTimer = 0;
    rulesCountdownTimer = 0;
    rulesAutoStart = false;
    if (resetButton) resetRulesCountdownButton();
  }

  function beginRulesCountdown() {
    cancelRulesCountdown();
    rulesAutoStart = true;
    rulesStartButton.disabled = false;
    rulesStartButton.setAttribute("aria-label", "Start game now");
    rulesStartButton.classList.add("is-counting-down");
    rulesStartButton.style.setProperty("--countdown-progress", "0%");
    rulesStartLabel.textContent = "GET READY...";

    // Keep the preparation state on screen for a complete five seconds.
    // The visible five-second countdown is created only after this timeout.
    rulesReadyTimer = window.setTimeout(() => {
      rulesReadyTimer = 0;
      const deadline = Date.now() + 5000;

      const updateCountdown = () => {
        const remainingMs = Math.max(0, deadline - Date.now());
        const remaining = Math.ceil(remainingMs / 1000);
        const progress = Math.min(100, ((5000 - remainingMs) / 5000) * 100);
        rulesStartButton.style.setProperty("--countdown-progress", `${progress}%`);
        if (remaining > 0) {
          rulesStartLabel.textContent = `STARTING GAME IN ${remaining}`;
          return;
        }

        window.clearInterval(rulesCountdownTimer);
        rulesCountdownTimer = 0;
        startGame(true);
      };

      updateCountdown();
      rulesCountdownTimer = window.setInterval(updateCountdown, 50);
    }, 5000);
  }

  function showRules(autoStart = false, origin = "landing") {
    ensureAudio();
    cancelRulesCountdown();
    rulesOrigin = origin;
    preparationMusicActive = autoStart;
    rulesBackButton.textContent = origin === "pause" ? "← PAUSE MENU" : "← BACK";
    if (origin === "pause") {
      rulesStartLabel.textContent = "RESUME GAME";
      rulesStartButton.setAttribute("aria-label", "Resume game");
    }
    if (autoStart) resetMusicClock(0.04);
    window.clearTimeout(introTransitionTimer);
    rulesPage.classList.remove("hidden", "is-leaving");
    rulesPage.classList.add("is-entering");
    landingPage.classList.add("is-leaving");

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => rulesPage.classList.remove("is-entering"));
    });

    introTransitionTimer = window.setTimeout(() => {
      landingPage.classList.add("hidden");
      landingPage.classList.remove("is-leaving");
    }, 360);

    if (autoStart) beginRulesCountdown();
  }

  function showLanding() {
    rulesOrigin = "landing";
    preparationMusicActive = false;
    cancelRulesCountdown();
    window.clearTimeout(introTransitionTimer);
    landingPage.classList.remove("hidden", "is-leaving");
    rulesPage.classList.add("is-leaving");
    introTransitionTimer = window.setTimeout(() => {
      rulesPage.classList.add("hidden");
      rulesPage.classList.remove("is-leaving", "is-entering");
    }, 360);
  }

  function returnToPauseMenu() {
    cancelRulesCountdown();
    rulesPage.classList.add("is-leaving");
    introTransitionTimer = window.setTimeout(() => {
      rulesPage.classList.add("hidden");
      rulesPage.classList.remove("is-leaving", "is-entering");
      resetRulesCountdownButton();
      rulesBackButton.textContent = "← BACK";
      rulesOrigin = "landing";
    }, 360);
  }

  function resumeFromRules() {
    rulesPage.classList.add("is-leaving");
    state = "playing";
    resetMusicClock(0.08);
    pauseOverlay.classList.add("hidden");
    pauseButton.classList.add("is-playing");
    pauseButton.setAttribute("aria-label", "Pause game");
    pauseButton.nextElementSibling.textContent = "PAUSE";
    introTransitionTimer = window.setTimeout(() => {
      rulesPage.classList.add("hidden");
      rulesPage.classList.remove("is-leaving", "is-entering");
      resetRulesCountdownButton();
      rulesBackButton.textContent = "← BACK";
      rulesOrigin = "landing";
    }, 360);
  }

  function togglePause() {
    if (state === "title" || state === "gameover") {
      startGame(true);
      return;
    }
    if (state === "playing") {
      state = "paused";
      pauseButton.classList.remove("is-playing");
      pauseButton.setAttribute("aria-label", "Resume game");
      pauseButton.nextElementSibling.textContent = "PLAY";
      pauseOverlay.classList.remove("hidden");
    } else if (state === "paused") {
      state = "playing";
      resetMusicClock(0.08);
      pauseButton.classList.add("is-playing");
      pauseButton.setAttribute("aria-label", "Pause game");
      pauseButton.nextElementSibling.textContent = "PAUSE";
      pauseOverlay.classList.add("hidden");
    }
  }

  function exitGame() {
    state = "title";
    preparationMusicActive = false;
    confetti = [];
    pauseOverlay.classList.add("hidden");
    endOverlay.classList.add("hidden");
    pauseButton.classList.remove("is-playing");
    pauseButton.setAttribute("aria-label", "Start game");
    pauseButton.nextElementSibling.textContent = "PLAY";
    showLanding();
  }

  function ensureAudio() {
    if (!soundOn) return null;
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
        masterGain = audioContext.createGain();
        musicGain = audioContext.createGain();
        effectsGain = audioContext.createGain();
        masterGain.gain.value = 0.78;
        musicGain.gain.value = 0.32;
        effectsGain.gain.value = 0.9;
        musicGain.connect(masterGain);
        effectsGain.connect(masterGain);
        masterGain.connect(audioContext.destination);
        nextMusicNoteAt = audioContext.currentTime + 0.12;
      }
    }
    if (audioContext?.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  function resetMusicClock(delay = 0.08) {
    if (!audioContext) return;
    nextMusicNoteAt = audioContext.currentTime + delay;
  }

  function scheduleTone(freq, start, duration, type, volume, destination) {
    if (!audioContext || !freq) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.015);
  }

  function updateMusic() {
    if (!soundOn || (state !== "playing" && !preparationMusicActive)) return;
    const activeAudio = ensureAudio();
    if (!activeAudio || !musicGain) return;
    if (nextMusicNoteAt < activeAudio.currentTime - MUSIC_STEP_SECONDS) {
      nextMusicNoteAt = activeAudio.currentTime + 0.04;
    }

    while (nextMusicNoteAt < activeAudio.currentTime + 0.18) {
      const melody = MUSIC_MELODY[musicStep % MUSIC_MELODY.length];
      const danger = phaseTime < frightenedUntil;
      scheduleTone(
        danger && melody ? melody * 0.75 : melody,
        nextMusicNoteAt,
        MUSIC_STEP_SECONDS * 0.72,
        "square",
        danger ? 0.027 : 0.021,
        musicGain
      );

      if (musicStep % 4 === 0) {
        const bass = MUSIC_BASS[Math.floor(musicStep / 4) % MUSIC_BASS.length];
        scheduleTone(
          danger ? bass * 1.06 : bass,
          nextMusicNoteAt,
          MUSIC_STEP_SECONDS * 2.5,
          "triangle",
          0.038,
          musicGain
        );
      }

      musicStep = (musicStep + 1) % MUSIC_MELODY.length;
      nextMusicNoteAt += MUSIC_STEP_SECONDS;
    }
  }

  function blip(freq, duration, type = "square", volume = 0.02, delay = 0) {
    if (!soundOn) return;
    const activeAudio = ensureAudio();
    if (!activeAudio) return;
    const now = activeAudio.currentTime + delay;
    scheduleTone(freq, now, duration, type, volume, effectsGain || activeAudio.destination);
  }

  function cellAt(col, row) {
    if (row < 0 || row >= ROWS) return "#";
    if (col < 0 || col >= COLS) return " ";
    return board[row][col];
  }

  function isWalkable(col, row, ghostActor = null) {
    const cell = cellAt(col, row);
    if (cell === "#") return false;
    if (cell === "=") return Boolean(ghostActor && (ghostActor.inHouse || ghostActor.eaten));
    return true;
  }

  function nearCenter(actor) {
    return actor.progress < 0.001;
  }

  function canMove(actor, dir, ghostActor = null) {
    if (dir === "none") return false;
    const d = DIRS[dir];
    return isWalkable(actor.col + d.x, actor.row + d.y, ghostActor);
  }

  function centerActor(actor) {
    const center = tileCenter(actor.col, actor.row);
    actor.x = center.x;
    actor.y = center.y;
  }

  function completeTile(actor, direction) {
    actor.col += direction.x;
    actor.row += direction.y;
    actor.progress = 0;

    if (actor.col < 0) actor.col = COLS;
    else if (actor.col >= COLS) actor.col = -1;

    centerActor(actor);
  }

  function applyTurnAssist(actor, ghostActor) {
    if (
      ghostActor ||
      actor.progress <= 0 ||
      actor.dir === "none" ||
      actor.wanted === actor.dir ||
      actor.wanted === OPPOSITE[actor.dir]
    ) return;

    // Forgive a slightly early or late perpendicular press at intersections.
    if (actor.progress <= TURN_WINDOW && canMove(actor, actor.wanted, null)) {
      actor.progress = 0;
      centerActor(actor);
      actor.dir = actor.wanted;
      return;
    }

    if (TILE - actor.progress <= TURN_WINDOW) {
      const direction = DIRS[actor.dir];
      const nextTile = { col: actor.col + direction.x, row: actor.row + direction.y };
      if (canMove(nextTile, actor.wanted, null)) {
        completeTile(actor, direction);
        actor.dir = actor.wanted;
      }
    }
  }

  function moveActor(actor, dt, isGhost = false) {
    let distanceLeft = actor.speed * dt;
    const ghostActor = isGhost ? actor : null;

    applyTurnAssist(actor, ghostActor);

    // Reversing direction should feel immediate, even between tile centers.
    if (
      actor.progress > 0 &&
      actor.wanted === OPPOSITE[actor.dir]
    ) {
      const oldDirection = DIRS[actor.dir];
      actor.col += oldDirection.x;
      actor.row += oldDirection.y;
      actor.dir = actor.wanted;
      actor.progress = TILE - actor.progress;

      if (actor.col < 0) actor.col = COLS;
      if (actor.col >= COLS) actor.col = -1;
    }

    while (distanceLeft > 0) {
      if (nearCenter(actor)) {
        centerActor(actor);
        if (actor.wanted && canMove(actor, actor.wanted, ghostActor)) actor.dir = actor.wanted;
        if (!canMove(actor, actor.dir, ghostActor)) {
          actor.dir = "none";
          return;
        }
      }

      const direction = DIRS[actor.dir];
      const step = Math.min(distanceLeft, TILE - actor.progress);
      actor.x += direction.x * step;
      actor.y += direction.y * step;
      actor.progress += step;
      distanceLeft -= step;

      if (actor.progress >= TILE - 0.001) {
        completeTile(actor, direction);
        // Ghost AI chooses at tile centers. Do not spend this frame's tiny
        // remainder before it has selected the next corridor.
        if (isGhost) return;
      }
    }

  }

  function chooseGhostDirection(ghost) {
    if (!nearCenter(ghost)) return;
    centerActor(ghost);
    if (ghost.inHouse && !ghost.eaten && ghost.col === HOUSE_EXIT.col && ghost.row <= HOUSE_EXIT.row) {
      ghost.inHouse = false;
    }
    const options = ["up", "left", "down", "right"].filter((dir) =>
      dir !== OPPOSITE[ghost.dir] && canMove(ghost, dir, ghost)
    );
    if (!options.length) {
      ghost.wanted = OPPOSITE[ghost.dir];
      return;
    }

    const difficulty = ghostDifficulty();
    const frightened = phaseTime < frightenedUntil && !ghost.eaten;
    let target = { col: player.col, row: player.row };

    if (ghost.eaten) {
      target = ghost.home;
    } else if (ghost.inHouse) {
      target = HOUSE_EXIT;
    } else if (frightened) {
      ghost.wanted = options[Math.floor(Math.random() * options.length)];
      return;
    } else if (ghost.index === 1) {
      const ahead = DIRS[player.dir];
      target = { col: player.col + ahead.x * 4, row: player.row + ahead.y * 4 };
    } else if (ghost.index === 2) {
      const red = ghosts[0];
      target = { col: player.col * 2 - red.col, row: player.row * 2 - red.row };
    } else if (ghost.index === 3) {
      const distance = Math.hypot(player.col - ghost.col, player.row - ghost.row);
      target = distance > 7
        ? { col: player.col, row: player.row }
        : { col: activeMazeBounds.left + 1, row: activeMazeBounds.bottom - 1 };
    }

    const modeTime = phaseTime % (difficulty.scatter + difficulty.chase);
    const scatter = modeTime < difficulty.scatter && !ghost.eaten && !ghost.inHouse;
    if (scatter) {
      const { left, right, top, bottom } = activeMazeBounds;
      const corners = [
        { col: right - 1, row: top + 1 },
        { col: left + 1, row: top + 1 },
        { col: right - 1, row: bottom - 1 },
        { col: left + 1, row: bottom - 1 }
      ];
      target = corners[ghost.index];
    } else if (!ghost.eaten && !ghost.inHouse && Math.random() > difficulty.accuracy) {
      ghost.wanted = options[Math.floor(Math.random() * options.length)];
      return;
    }

    options.sort((a, b) => {
      const da = DIRS[a];
      const db = DIRS[b];
      const aDist = Math.hypot(ghost.col + da.x - target.col, ghost.row + da.y - target.row);
      const bDist = Math.hypot(ghost.col + db.x - target.col, ghost.row + db.y - target.row);
      return aDist - bDist;
    });
    ghost.wanted = options[0];
  }

  function eatAtPlayer() {
    if (player.row < 0 || player.row >= ROWS || player.col < 0 || player.col >= COLS) return;
    const cell = board[player.row][player.col];
    if (cell === ".") {
      board[player.row][player.col] = " ";
      pelletsLeft -= 1;
      addScore(10);
      chompTone = !chompTone;
      blip(chompTone ? 235 : 315, 0.045, "square", 0.026);
    } else if (cell === "o") {
      board[player.row][player.col] = " ";
      pelletsLeft -= 1;
      addScore(50);
      frightenedUntil = phaseTime + ghostDifficulty().powerSeconds;
      ghostChain = 0;
      ghosts.forEach((ghost) => {
        if (!ghost.eaten) ghost.dir = OPPOSITE[ghost.dir];
      });
      blip(145, 0.18, "sawtooth", 0.035);
      blip(105, 0.22, "square", 0.018, 0.08);
    }
    if (!fruit.shown && pelletsLeft <= totalPellets * 0.55) {
      fruit.shown = true;
      fruit.active = true;
      fruit.expires = phaseTime + 10;
    }
    if (pelletsLeft <= 0) nextLevel();
  }

  function addScore(points) {
    score += points;
    if (!bonusAwarded && score >= 10000) {
      bonusAwarded = true;
      lives += 1;
      blip(880, 0.1, "square", 0.025);
      blip(1180, 0.14, "square", 0.02, 0.11);
    }
    if (score > highScore) {
      highScore = score;
      saveHighScore();
    }
  }

  function updateFruit() {
    if (!fruit.active) return;
    if (phaseTime >= fruit.expires) {
      fruit.active = false;
      return;
    }
    const pos = tileCenter(10, 12);
    if (Math.hypot(player.x - pos.x, player.y - pos.y) < TILE * 0.72) {
      fruit.active = false;
      addScore(Math.min(5000, 100 * (2 ** Math.min(level - 1, 5))));
      blip(620, 0.08, "square", 0.025);
      blip(930, 0.12, "square", 0.02, 0.08);
    }
  }

  function nextLevel() {
    state = "levelclear";
    launchConfetti();
    blip(523.25, 0.09, "square", 0.035);
    blip(659.25, 0.09, "square", 0.032, 0.1);
    blip(783.99, 0.09, "square", 0.032, 0.2);
    blip(1046.5, 0.18, "square", 0.03, 0.3);
    window.setTimeout(() => {
      if (state !== "levelclear") return;
      level += 1;
      confetti = [];
      makeBoard();
      resetActors();
      state = "playing";
      resetMusicClock(0.12);
    }, 1100);
  }

  function launchConfetti() {
    const colors = ["#ffe000", "#59f2ca", "#ff5775", "#ff85d6", "#42e6f5", "#f7f8ff"];
    confetti = Array.from({ length: 96 }, (_, index) => {
      const fromLeft = index % 2 === 0;
      return {
        x: fromLeft ? 18 : WIDTH - 18,
        y: HEIGHT - 18 - Math.random() * 24,
        vx: (fromLeft ? 1 : -1) * (85 + Math.random() * 175),
        vy: -(210 + Math.random() * 230),
        gravity: 330 + Math.random() * 130,
        size: 4 + Math.random() * 7,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 12,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1.05 + Math.random() * 0.45
      };
    });
  }

  function updateConfetti(dt) {
    if (!confetti.length) return;
    confetti.forEach((piece) => {
      piece.life -= dt;
      piece.vy += piece.gravity * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.rotation += piece.spin * dt;
    });
    confetti = confetti.filter((piece) => piece.life > 0);
  }

  function drawConfetti() {
    if (!confetti.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HUD, WIDTH, ROWS * TILE);
    ctx.clip();
    confetti.forEach((piece) => {
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      ctx.globalAlpha = Math.min(1, piece.life * 2.5);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      ctx.restore();
    });
    ctx.restore();
  }

  function checkCollisions() {
    ghosts.forEach((ghost) => {
      const distance = Math.hypot(player.x - ghost.x, player.y - ghost.y);
      if (distance > TILE * 0.72) return;
      const frightened = phaseTime < frightenedUntil && !ghost.eaten;
      if (frightened) {
        ghost.eaten = true;
        ghost.speed = 150;
        ghostChain += 1;
        const points = 100 * (2 ** ghostChain);
        addScore(points);
        blip(720, 0.08, "square", 0.03);
        blip(960, 0.09, "square", 0.02, 0.07);
      } else if (!ghost.eaten && player.spawnLock <= 0) {
        loseLife();
      }
    });
  }

  function loseLife() {
    if (state !== "playing") return;
    state = "dying";
    lives -= 1;
    [392, 349.23, 311.13, 261.63, 196].forEach((note, index) => {
      blip(note, 0.12 + index * 0.025, "sawtooth", 0.032, index * 0.1);
    });
    window.setTimeout(() => {
      if (lives <= 0) {
        state = "gameover";
        pauseButton.classList.remove("is-playing");
        pauseButton.setAttribute("aria-label", "Start game");
        pauseButton.nextElementSibling.textContent = "PLAY";
        finalScore.textContent = String(score).padStart(6, "0");
        renderDailyLeaderboard(saveDailyScore());
        endOverlay.classList.remove("hidden");
      } else {
        resetActors();
        state = "playing";
        resetMusicClock(0.18);
      }
    }, 1050);
  }

  function update(dt) {
    if (state !== "playing") return;
    phaseTime += dt;
    player.spawnLock = Math.max(0, player.spawnLock - dt);
    player.mouth += dt * 13;
    moveActor(player, dt, false);
    eatAtPlayer();
    updateFruit();

    ghosts.forEach((ghost) => {
      if (phaseTime < ghost.releaseAt) return;
      chooseGhostDirection(ghost);
      const difficulty = ghostDifficulty();
      const frightened = phaseTime < frightenedUntil && !ghost.eaten;
      ghost.speed = ghost.eaten ? 150 : frightened ? difficulty.frightenedSpeed : difficulty.speed;
      moveActor(ghost, dt, true);
      if (
        ghost.eaten &&
        nearCenter(ghost) &&
        ghost.col === HOUSE_CENTER.col &&
        ghost.row === HOUSE_CENTER.row
      ) {
        ghost.eaten = false;
        ghost.inHouse = true;
        ghost.dir = "up";
        ghost.wanted = "up";
        ghost.releaseAt = phaseTime + 0.55;
        ghost.speed = difficulty.speed;
      }
    });
    checkCollisions();
  }

  function drawPixelText(text, x, y, size = 18, align = "left", color = "#f6f7ff") {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `900 ${size}px monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(50,80,255,.3)";
    ctx.shadowBlur = 3;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawHud() {
    ctx.fillStyle = "#050711";
    ctx.fillRect(0, 0, WIDTH, HUD);
    drawPixelText("1UP", 28, 8, 16, "left", "#ff5277");
    drawPixelText(String(score).padStart(6, "0"), 20, 31, 19);
    drawPixelText("HIGH", WIDTH / 2, 8, 14, "center", "#5ef0d0");
    drawPixelText(String(highScore).padStart(6, "0"), WIDTH / 2, 31, 17, "center");
    drawPixelText(`LV ${level}`, WIDTH - 24, 10, 15, "right", "#ffdf31");
    drawPixelText(ghostDifficulty().label, WIDTH - 24, 31, 10, "right", "#ff85d6");
    for (let i = 0; i < lives; i += 1) drawPacman(WIDTH - 29 - i * 23, 48, 8, Math.PI, 0.24);
  }

  function drawMaze() {
    ctx.fillStyle = "#050711";
    ctx.fillRect(0, HUD, WIDTH, ROWS * TILE);

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cell = board[row][col];
        const x = col * TILE;
        const y = HUD + row * TILE;
        if (cell === "#") {
          ctx.fillStyle = "#0c1948";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = "#2860e3";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
        } else if (cell === "=") {
          ctx.fillStyle = "#ff72ba";
          ctx.fillRect(x + 2, y + TILE / 2 - 2, TILE - 4, 4);
        } else if (cell === ".") {
          ctx.fillStyle = "#ffdca8";
          ctx.fillRect(x + TILE / 2 - 2, y + TILE / 2 - 2, 4, 4);
        } else if (cell === "o") {
          const pulse = 4.5 + Math.sin(phaseTime * 7) * 1.3;
          ctx.fillStyle = "#fff0cd";
          ctx.beginPath();
          ctx.arc(x + TILE / 2, y + TILE / 2, pulse, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawPacman(x, y, radius, angle, mouthAmount) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "#ffe000";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, mouthAmount, Math.PI * 2 - mouthAmount);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    if (state === "dying") {
      const t = Math.min(1, (performance.now() % 1000) / 1000);
      drawPacman(player.x, player.y, player.radius, DIRS[player.dir].angle, t * Math.PI);
      return;
    }
    const mouth = 0.12 + Math.abs(Math.sin(player.mouth)) * 0.34;
    drawPacman(player.x, player.y, player.radius, DIRS[player.dir].angle, mouth);
  }

  function drawGhost(ghost) {
    const frightened = phaseTime < frightenedUntil && !ghost.eaten;
    const flashing = frightened && frightenedUntil - phaseTime < 2 && Math.floor(phaseTime * 9) % 2 === 0;
    const x = ghost.x;
    const y = ghost.y;
    const r = ghost.radius;
    ctx.save();
    ctx.translate(x, y);

    if (!ghost.eaten) {
      ctx.fillStyle = flashing ? "#f5f7ff" : frightened ? "#244bdc" : ghost.color;
      ctx.beginPath();
      ctx.arc(0, -1, r, Math.PI, 0);
      ctx.lineTo(r, r);
      ctx.lineTo(r * 0.5, r * 0.64);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.5, r * 0.64);
      ctx.lineTo(-r, r);
      ctx.closePath();
      ctx.fill();
    }

    if (frightened) {
      ctx.fillStyle = flashing ? "#244bdc" : "#f7f7ff";
      ctx.fillRect(-r * .45, -r * .12, 3, 4);
      ctx.fillRect(r * .25, -r * .12, 3, 4);
      ctx.strokeStyle = flashing ? "#244bdc" : "#f7f7ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * .45, r * .45);
      ctx.lineTo(-r * .2, r * .25);
      ctx.lineTo(0, r * .45);
      ctx.lineTo(r * .2, r * .25);
      ctx.lineTo(r * .45, r * .45);
      ctx.stroke();
    } else {
      const look = DIRS[ghost.dir];
      [-1, 1].forEach((side) => {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.ellipse(side * r * .4, -r * .12, r * .28, r * .36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#183e9f";
        ctx.beginPath();
        ctx.arc(side * r * .4 + look.x * 2.2, -r * .12 + look.y * 2.2, r * .13, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.restore();
  }

  function drawFruit() {
    if (!fruit.active) return;
    const pos = tileCenter(10, 12);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.strokeStyle = "#58e178";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-2, -2);
    ctx.quadraticCurveTo(0, -10, 9, -10);
    ctx.stroke();
    ctx.fillStyle = "#ff335d";
    ctx.beginPath();
    ctx.arc(-5, 4, 6, 0, Math.PI * 2);
    ctx.arc(6, 4, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawStatus() {
    if (state === "levelclear") {
      ctx.fillStyle = "rgba(2,4,12,.76)";
      ctx.fillRect(0, HUD + HEIGHT * .31, WIDTH, 58);
      drawPixelText("LEVEL COMPLETE!", WIDTH / 2, HUD + HEIGHT * .33, 25, "center", "#ffe000");
    } else if (state === "dying") {
      drawPixelText("READY!", WIDTH / 2, HUD + 13 * TILE, 20, "center", "#ffdf31");
    }
  }

  function draw() {
    drawHud();
    ctx.fillStyle = "#050711";
    ctx.fillRect(0, HUD, WIDTH, ROWS * TILE);

    const transform = mazeDisplayTransform();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HUD, WIDTH, ROWS * TILE);
    ctx.clip();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-transform.sourceX, -transform.sourceY);
    drawMaze();
    drawFruit();
    ghosts.forEach(drawGhost);
    drawPlayer();
    ctx.restore();
    drawConfetti();
    drawStatus();
  }

  function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000 || 0, 0.033);
    lastTime = timestamp;
    update(dt);
    updateConfetti(dt);
    updateMusic();
    draw();
    animationId = requestAnimationFrame(loop);
  }

  function setDirection(direction) {
    ensureAudio();
    if (!landingPage.classList.contains("hidden")) {
      showRules(true);
      return;
    }
    if (!rulesPage.classList.contains("hidden")) return;
    if (state === "title" || state === "gameover") startGame(true);
    if (state !== "playing") return;
    player.wanted = direction;
    applyTurnAssist(player, null);

    const button = document.querySelector(`[data-direction="${direction}"]`);
    if (button) {
      if (activeDirectionButton && activeDirectionButton !== button) {
        activeDirectionButton.classList.remove("active");
      }
      window.clearTimeout(directionFeedbackTimer);
      activeDirectionButton = button;
      button.classList.add("active");
      directionFeedbackTimer = window.setTimeout(() => {
        button.classList.remove("active");
        if (activeDirectionButton === button) activeDirectionButton = null;
      }, 70);
    }
  }

  dpadWell.addEventListener("pointerdown", (event) => {
    event.preventDefault();

    const button = event.target.closest("[data-direction]");
    if (button) {
      setDirection(button.dataset.direction);
      return;
    }

    // Make the whole circular well a forgiving touch target. Taps outside
    // the visible cross are routed to the closest directional arm.
    const bounds = dpadWell.getBoundingClientRect();
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    const centerDeadZone = Math.min(bounds.width, bounds.height) * 0.1;
    if (Math.hypot(dx, dy) < centerDeadZone) return;

    setDirection(
      Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? "right" : "left")
        : (dy > 0 ? "down" : "up")
    );
  });

  window.addEventListener("keydown", (event) => {
    ensureAudio();
    const keyMap = {
      ArrowUp: "up", w: "up", W: "up",
      ArrowDown: "down", s: "down", S: "down",
      ArrowLeft: "left", a: "left", A: "left",
      ArrowRight: "right", d: "right", D: "right"
    };
    if (keyMap[event.key]) {
      event.preventDefault();
      setDirection(keyMap[event.key]);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (!landingPage.classList.contains("hidden")) showRules(true);
      else if (!rulesPage.classList.contains("hidden")) {
        if (rulesOrigin === "pause") resumeFromRules();
        else startGame(true);
      }
      else togglePause();
    }
  });

  screenWrap.addEventListener("pointerdown", (event) => {
    ensureAudio();
    touchStart = { x: event.clientX, y: event.clientY };
  });

  screenWrap.addEventListener("pointerup", (event) => {
    if (!touchStart) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = null;
    if (Math.hypot(dx, dy) < 18) return;
    setDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });

  startButton.addEventListener("click", () => showRules(true));
  howToPlayButton.addEventListener("click", () => showRules(false));
  rulesStartButton.addEventListener("click", () => {
    if (rulesOrigin === "pause") resumeFromRules();
    else startGame(true);
  });
  rulesBackButton.addEventListener("click", () => {
    if (rulesOrigin === "pause") returnToPauseMenu();
    else showLanding();
  });
  endStartButton.addEventListener("click", () => startGame(true));
  resumeButton.addEventListener("click", togglePause);
  pauseHowToPlayButton.addEventListener("click", () => showRules(false, "pause"));
  exitGameButton.addEventListener("click", exitGame);
  pauseButton.addEventListener("click", togglePause);
  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    soundButton.classList.toggle("active", !soundOn);
    soundButton.classList.toggle("muted", !soundOn);
    soundButton.setAttribute("aria-label", soundOn ? "Mute music" : "Turn music on");
    if (soundOn) {
      ensureAudio();
      resetMusicClock(0.16);
      blip(540, 0.07, "square", 0.035);
      blip(760, 0.08, "square", 0.025, 0.07);
    }
  });

  document.addEventListener("pointerdown", ensureAudio, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  makeBoard();
  resetActors();
  landingBestScore.textContent = String(loadTodayBest()).padStart(6, "0");
  draw();
  animationId = requestAnimationFrame(loop);
})();
