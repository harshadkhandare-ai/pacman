(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const startOverlay = document.getElementById("startOverlay");
  const pauseOverlay = document.getElementById("pauseOverlay");
  const startButton = document.getElementById("startButton");
  const resumeButton = document.getElementById("resumeButton");
  const endOverlay = document.getElementById("endOverlay");
  const endStartButton = document.getElementById("endStartButton");
  const finalScore = document.getElementById("finalScore");
  const leaderboardList = document.getElementById("leaderboardList");
  const pauseButton = document.getElementById("pauseButton");
  const soundButton = document.getElementById("soundButton");
  const screenWrap = document.getElementById("screenWrap");

  const TILE = 24;
  const HUD = 72;
  const COLS = 21;
  const ROWS = 24;
  const WIDTH = COLS * TILE;
  const HEIGHT = HUD + ROWS * TILE;

  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const RAW_MAP = [
    "#####################",
    "#.........#.........#",
    "#o###...........###o#",
    "#...................#",
    "#.....###...###.....#",
    "#...................#",
    "#####.#.......#.#####",
    "    #.#.......#.#    ",
    "#####.#.##=##.#.#####",
    "    ... #   # ...    ",
    "#####.# #   # #.#####",
    "    #.# ##### #.#    ",
    "#####.#       #.#####",
    "    ... ##### ...    ",
    "#####.# ##### #.#####",
    "#...................#",
    "#.....###...###.....#",
    "#o.................o#",
    "#...#.....#.....#...#",
    "#...#...........#...#",
    "#...#####...#####...#",
    "#...................#",
    "#.........#.........#",
    "#####################"
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
  const TURN_WINDOW = 6;
  const HOUSE_EXIT = { col: 10, row: 7 };
  const HOUSE_CENTER = { col: 10, row: 9 };
  const LEVEL_ZOOMS = [1.42, 1.34, 1.26, 1.18, 1.1, 1.04, 1];

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
  let currentRunId = "";
  let cameraX = 0;
  let cameraY = 0;
  let cameraReady = false;

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

  function currentZoom() {
    return LEVEL_ZOOMS[Math.min(level - 1, LEVEL_ZOOMS.length - 1)];
  }

  function resetCamera() {
    cameraReady = false;
  }

  function updateCamera() {
    const zoom = currentZoom();
    const worldHeight = ROWS * TILE;
    const viewWidth = WIDTH / zoom;
    const viewHeight = worldHeight / zoom;
    const maxX = Math.max(0, WIDTH - viewWidth);
    const maxY = Math.max(0, worldHeight - viewHeight);
    const targetX = Math.max(0, Math.min(maxX, player.x - viewWidth / 2));
    const targetY = Math.max(0, Math.min(maxY, player.y - HUD - viewHeight / 2));

    if (!cameraReady) {
      cameraX = targetX;
      cameraY = targetY;
      cameraReady = true;
      return { zoom, x: cameraX, y: cameraY };
    }

    const easing = state === "playing" ? 0.12 : 0.2;
    cameraX += (targetX - cameraX) * easing;
    cameraY += (targetY - cameraY) * easing;
    return { zoom, x: cameraX, y: cameraY };
  }

  function makeBoard() {
    pelletsLeft = 0;
    board = RAW_MAP.map((row) => row.split("").map((cell) => {
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
    ghosts = starts.map(([col, row, dir], index) => {
      const ghost = makeActor(col, row, dir, Math.min(88 + level * 3, 110));
      ghost.color = GHOST_COLORS[index];
      ghost.index = index;
      ghost.home = HOUSE_CENTER;
      ghost.releaseAt = phaseTime + index * 1.25;
      ghost.eaten = false;
      ghost.inHouse = true;
      return ghost;
    });
    frightenedUntil = 0;
    ghostChain = 0;
    resetCamera();
  }

  function startGame(fresh = false) {
    ensureAudio();
    if (fresh || state === "title" || state === "gameover") {
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
    startOverlay.classList.add("hidden");
    pauseOverlay.classList.add("hidden");
    endOverlay.classList.add("hidden");
    blip(440, 0.055, "square", 0.035);
    blip(660, 0.08, "square", 0.025, 0.07);
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
    if (!soundOn || state !== "playing") return;
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
      target = distance > 7 ? { col: player.col, row: player.row } : { col: 1, row: ROWS - 2 };
    }

    const scatter = Math.floor(phaseTime / 7) % 4 === 0 && !ghost.eaten && !ghost.inHouse;
    if (scatter) {
      const corners = [{ col: COLS - 2, row: 1 }, { col: 1, row: 1 }, { col: COLS - 2, row: ROWS - 2 }, { col: 1, row: ROWS - 2 }];
      target = corners[ghost.index];
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
      frightenedUntil = phaseTime + 7;
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
    blip(523.25, 0.09, "square", 0.035);
    blip(659.25, 0.09, "square", 0.032, 0.1);
    blip(783.99, 0.09, "square", 0.032, 0.2);
    blip(1046.5, 0.18, "square", 0.03, 0.3);
    window.setTimeout(() => {
      if (state !== "levelclear") return;
      level += 1;
      makeBoard();
      resetActors();
      state = "playing";
      resetMusicClock(0.12);
    }, 1100);
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
      const frightened = phaseTime < frightenedUntil && !ghost.eaten;
      ghost.speed = ghost.eaten ? 150 : frightened ? 66 : Math.min(88 + level * 3, 110);
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
        ghost.speed = 90;
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
      drawPixelText("MAZE CLEAR!", WIDTH / 2, HUD + HEIGHT * .33, 27, "center", "#ffe000");
    } else if (state === "dying") {
      drawPixelText("READY!", WIDTH / 2, HUD + 13 * TILE, 20, "center", "#ffdf31");
    }
  }

  function draw() {
    drawHud();

    const camera = updateCamera();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HUD, WIDTH, ROWS * TILE);
    ctx.clip();
    ctx.translate(0, HUD);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -HUD - camera.y);
    drawMaze();
    drawFruit();
    ghosts.forEach(drawGhost);
    drawPlayer();
    ctx.restore();

    drawStatus();
  }

  function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000 || 0, 0.033);
    lastTime = timestamp;
    update(dt);
    updateMusic();
    draw();
    animationId = requestAnimationFrame(loop);
  }

  function setDirection(direction) {
    ensureAudio();
    if (state === "title" || state === "gameover") startGame(true);
    if (state !== "playing") return;
    player.wanted = direction;
    const button = document.querySelector(`[data-direction="${direction}"]`);
    if (button) {
      button.classList.add("active");
      window.setTimeout(() => button.classList.remove("active"), 100);
    }
  }

  document.querySelectorAll("[data-direction]").forEach((button) => {
    const direction = button.dataset.direction;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setDirection(direction);
    });
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
      togglePause();
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

  startButton.addEventListener("click", () => {
    startGame(true);
  });
  endStartButton.addEventListener("click", () => startGame(true));
  resumeButton.addEventListener("click", togglePause);
  pauseButton.addEventListener("click", togglePause);
  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    soundButton.classList.toggle("active", !soundOn);
    soundButton.classList.toggle("muted", !soundOn);
    soundButton.setAttribute("aria-label", soundOn ? "Mute sound" : "Turn sound on");
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
  draw();
  animationId = requestAnimationFrame(loop);
})();
