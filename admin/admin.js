(() => {
  "use strict";

  const SUPABASE_URL = "https://czzwqpyylagvannwsvix.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6endxcHl5bGFndmFubndzdml4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMDQ4NTUsImV4cCI6MjEwMDg4MDg1NX0.NdkVn0IZe_FY0ZN9IvcajSeYhxZ04uD3_gKx3AERSks";
  const SESSION_KEY = "pacman-admin-session";
  const PAGE_SIZE = 25;

  const METRICS = [
    ["totalUsers", "Total users", "◎", "number", "Players active in this period"],
    ["newUsers", "New users", "✦", "number", "Players seen for the first time"],
    ["totalGamesStarted", "Total games started", "▶", "number", "All game runs started"],
    ["totalLevelsCleared", "Total levels cleared", "✓", "number", "All completed maze levels"],
    ["totalTimeSeconds", "Total time spent", "◷", "duration", "Active time across all players"],
    ["avgGamesPlayed", "Avg. games played", "×", "decimal", "Game starts per active player"],
    ["avgLevelsCleared", "Avg. levels cleared", "◆", "decimal", "Cleared levels per active player"],
    ["avgTimeSeconds", "Avg. time spent", "◴", "duration", "Active time per player"]
  ];
  const RETENTION_KEYS = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8Plus"];

  const elements = Object.fromEntries([
    "loginView", "dashboard", "loginForm", "loginEmail", "loginPassword", "loginError",
    "loginButton", "accountEmail", "logoutButton", "refreshButton",
    "exportButton", "presetTabs", "customDateForm", "fromDate", "toDate", "rangeLabel",
    "notice", "overviewPanel", "usersPanel", "metricGrid", "retentionBody", "usersCount",
    "userSearch", "usersBody", "previousPage", "nextPage", "pageLabel"
  ].map((id) => [id, document.getElementById(id)]));

  const state = {
    session: null,
    tab: "overview",
    preset: "today",
    range: rangeForPreset("today"),
    overview: null,
    users: null,
    page: 1,
    search: "",
    sort: "lastSeenAt",
    direction: "desc",
    loading: false
  };

  function indiaDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const value = (name) => parts.find((part) => part.type === name)?.value || "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  }

  function shiftDate(date, days) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }

  function rangeForPreset(preset) {
    const today = indiaDate();
    if (preset === "today") return { from: today, to: today };
    if (preset === "yesterday") {
      const yesterday = shiftDate(today, -1);
      return { from: yesterday, to: yesterday };
    }
    const days = preset === "3days" ? 3 : 7;
    return { from: shiftDate(today, -(days - 1)), to: today };
  }

  function dayCount(from, to) {
    return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  }

  function formatRange(from, to) {
    const formatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const format = (date) => formatter.format(new Date(`${date}T00:00:00Z`));
    return from === to ? format(from) : `${format(from)} – ${format(to)}`;
  }

  function formatDuration(value) {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${remaining}s`;
    return `${remaining}s`;
  }

  function formatMetric(value, type) {
    if (type === "duration") return formatDuration(value);
    if (type === "decimal") return Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    return Math.round(Number(value) || 0).toLocaleString("en-IN");
  }

  function formatTimestamp(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata"
    }).format(new Date(value));
  }

  function setNotice(message = "") {
    elements.notice.textContent = message;
    elements.notice.classList.toggle("hidden", !message);
  }

  function readSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (!session?.email || !session?.password) return null;
      return session;
    } catch (_error) {
      return null;
    }
  }

  function saveSession(session) {
    state.session = session;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  async function rpc(name, body, password = state.session?.password) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ...body, p_password: password || "" })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 403 || payload.code === "42501"
        ? "The shared password is incorrect."
        : payload.message || "Could not load analytics.";
      throw new Error(message);
    }
    return payload;
  }

  function showDashboard(email, overview = null) {
    elements.loginView.classList.add("hidden");
    elements.dashboard.classList.remove("hidden");
    elements.accountEmail.textContent = email || state.session?.email || "Admin";
    updateRangeUi();
    if (overview) {
      state.overview = overview;
      renderMetrics();
      renderRetention();
    } else {
      loadCurrentTab();
    }
  }

  function showLogin() {
    state.session = null;
    sessionStorage.removeItem(SESSION_KEY);
    elements.dashboard.classList.add("hidden");
    elements.loginView.classList.remove("hidden");
  }

  async function handleLogin(event) {
    event.preventDefault();
    elements.loginError.textContent = "";
    elements.loginButton.disabled = true;
    elements.loginButton.textContent = "SIGNING IN…";
    try {
      const email = elements.loginEmail.value.trim();
      const password = elements.loginPassword.value;
      const overview = await rpc("pacman_admin_overview_shared", {
        p_from: state.range.from,
        p_to: state.range.to
      }, password);
      saveSession({ email, password });
      showDashboard(email, overview);
    } catch (error) {
      elements.loginError.textContent = error.message;
    } finally {
      elements.loginButton.disabled = false;
      elements.loginButton.textContent = "SIGN IN";
    }
  }

  function logout() {
    showLogin();
  }

  function updateRangeUi() {
    elements.rangeLabel.textContent = formatRange(state.range.from, state.range.to);
    elements.fromDate.value = state.range.from;
    elements.toDate.value = state.range.to;
    [...elements.presetTabs.querySelectorAll(".preset")].forEach((button) => {
      button.classList.toggle("active", button.dataset.preset === state.preset);
    });
    elements.customDateForm.classList.toggle("hidden", state.preset !== "custom");
  }

  function renderMetricSkeletons() {
    elements.metricGrid.replaceChildren(...METRICS.map((metric) => {
      const card = document.createElement("article");
      card.className = "metric-card loading";
      card.innerHTML = `<div class="metric-head"><span class="metric-icon">${metric[2]}</span><span>${metric[1]}</span></div><strong>0000</strong><div class="metric-change">Loading analytics</div>`;
      return card;
    }));
  }

  function renderMetrics() {
    const current = state.overview?.current || {};
    const changes = state.overview?.changes || {};
    elements.metricGrid.replaceChildren(...METRICS.map(([key, label, icon, type, description]) => {
      const change = Number(changes[key] || 0);
      const card = document.createElement("article");
      card.className = "metric-card";
      const head = document.createElement("div");
      head.className = "metric-head";
      head.title = description;
      head.innerHTML = `<span class="metric-icon">${icon}</span><span>${label}</span>`;
      const value = document.createElement("strong");
      value.textContent = formatMetric(current[key], type);
      const comparison = document.createElement("div");
      comparison.className = "metric-change";
      const badge = document.createElement("span");
      badge.className = `change-badge${change < 0 ? " negative" : ""}`;
      badge.textContent = `${change > 0 ? "↑" : change < 0 ? "↓" : "•"} ${Math.abs(change).toFixed(1)}%`;
      comparison.append(badge, document.createTextNode("vs previous period"));
      card.append(head, value, comparison);
      return card;
    }));
  }

  function retentionCell(value) {
    const cell = document.createElement("td");
    cell.className = "retention-cell";
    if (!value) {
      cell.textContent = "—";
      return cell;
    }
    cell.style.setProperty("--heat", String(0.08 + Math.min(100, Number(value.rate)) / 130));
    cell.textContent = `${Number(value.rate).toFixed(1)}%`;
    const count = document.createElement("small");
    count.textContent = `${Number(value.users).toLocaleString("en-IN")} users`;
    cell.append(count);
    return cell;
  }

  function renderRetention() {
    const rows = state.overview?.retention?.rows || [];
    elements.retentionBody.replaceChildren();
    if (!rows.length) {
      const row = document.createElement("tr");
      row.className = "empty-row";
      const cell = document.createElement("td");
      cell.colSpan = 11;
      cell.textContent = "No new-player cohorts in this period yet.";
      row.append(cell);
      elements.retentionBody.append(row);
      return;
    }
    rows.forEach((data) => {
      const row = document.createElement("tr");
      const date = document.createElement("td");
      date.textContent = formatRange(data.cohortDate, data.cohortDate);
      const users = document.createElement("td");
      users.textContent = Number(data.newUsers).toLocaleString("en-IN");
      row.append(date, users, ...RETENTION_KEYS.map((key) => retentionCell(data[key])));
      elements.retentionBody.append(row);
    });
  }

  async function loadOverview() {
    renderMetricSkeletons();
    setNotice();
    try {
      state.overview = await rpc("pacman_admin_overview_shared", { p_from: state.range.from, p_to: state.range.to });
      renderMetrics();
      renderRetention();
    } catch (error) {
      setNotice(error.message);
      renderMetrics();
      elements.retentionBody.replaceChildren();
    }
  }

  function renderUsers() {
    const report = state.users || { total: 0, rows: [] };
    const totalPages = Math.max(1, Math.ceil(report.total / PAGE_SIZE));
    elements.usersCount.textContent = `${Number(report.total).toLocaleString("en-IN")} active players in this period`;
    elements.pageLabel.textContent = `Page ${state.page} of ${totalPages}`;
    elements.previousPage.disabled = state.page <= 1;
    elements.nextPage.disabled = state.page >= totalPages;
    elements.usersBody.replaceChildren();
    if (!report.rows.length) {
      const row = document.createElement("tr");
      row.className = "empty-row";
      const cell = document.createElement("td");
      cell.colSpan = 7;
      cell.textContent = "No players match this date range and search.";
      row.append(cell);
      elements.usersBody.append(row);
    }
    report.rows.forEach((data) => {
      const row = document.createElement("tr");
      const values = [
        data.userId,
        Number(data.gamesPlayed).toLocaleString("en-IN"),
        Number(data.levelsCleared).toLocaleString("en-IN"),
        formatDuration(data.timeSpentSeconds),
        `D${data.activeDay}`,
        formatTimestamp(data.firstSeenAt),
        formatTimestamp(data.lastSeenAt)
      ];
      values.forEach((value, index) => {
        const cell = document.createElement("td");
        if (index === 0) { cell.className = "user-id"; cell.title = data.userId; }
        if (index === 4) {
          const badge = document.createElement("span");
          badge.className = "active-day";
          badge.textContent = value;
          badge.title = Array.isArray(data.activeDays) ? data.activeDays.join(", ") : value;
          cell.append(badge);
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      });
      elements.usersBody.append(row);
    });
    document.querySelectorAll("[data-sort]").forEach((button) => {
      button.classList.toggle("active", button.dataset.sort === state.sort);
      button.textContent = button.textContent.replace(/ [↑↓]$/, "") + (button.dataset.sort === state.sort ? ` ${state.direction === "asc" ? "↑" : "↓"}` : "");
    });
  }

  async function loadUsers() {
    setNotice();
    elements.usersBody.innerHTML = '<tr class="empty-row"><td colspan="7">Loading players…</td></tr>';
    try {
      state.users = await rpc("pacman_admin_users_shared", {
        p_from: state.range.from,
        p_to: state.range.to,
        p_search: state.search || null,
        p_limit: PAGE_SIZE,
        p_offset: (state.page - 1) * PAGE_SIZE,
        p_sort: state.sort,
        p_direction: state.direction
      });
      renderUsers();
    } catch (error) {
      setNotice(error.message);
      state.users = { total: 0, rows: [] };
      renderUsers();
    }
  }

  function loadCurrentTab() {
    state.tab === "overview" ? loadOverview() : loadUsers();
  }

  function setTab(tab) {
    state.tab = tab;
    state.page = 1;
    elements.overviewPanel.classList.toggle("hidden", tab !== "overview");
    elements.usersPanel.classList.toggle("hidden", tab !== "users");
    elements.exportButton.classList.toggle("hidden", tab !== "users");
    document.querySelectorAll(".main-tabs .tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    loadCurrentTab();
  }

  function setPreset(preset) {
    state.preset = preset;
    if (preset !== "custom") {
      state.range = rangeForPreset(preset);
      state.page = 1;
      updateRangeUi();
      loadCurrentTab();
    } else {
      updateRangeUi();
      elements.fromDate.focus();
    }
  }

  function applyCustomRange(event) {
    event.preventDefault();
    const from = elements.fromDate.value;
    const to = elements.toDate.value;
    const days = dayCount(from, to);
    if (!from || !to || days < 1 || days > 90) {
      setNotice("Choose a valid date range of up to 90 days.");
      return;
    }
    state.range = { from, to };
    state.page = 1;
    updateRangeUi();
    loadCurrentTab();
  }

  async function exportUsers() {
    elements.exportButton.disabled = true;
    elements.exportButton.textContent = "Preparing…";
    try {
      const report = await rpc("pacman_admin_users_shared", {
        p_from: state.range.from, p_to: state.range.to, p_search: state.search || null,
        p_limit: 500, p_offset: 0, p_sort: state.sort, p_direction: state.direction
      });
      const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const lines = [["User ID", "Games played", "Levels cleared", "Time spent seconds", "Active day", "First seen", "Last seen"],
        ...report.rows.map((row) => [row.userId, row.gamesPlayed, row.levelsCleared, row.timeSpentSeconds, `D${row.activeDay}`, row.firstSeenAt, row.lastSeenAt])
      ].map((row) => row.map(escapeCsv).join(","));
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
      link.download = `pacman-users-${state.range.from}-to-${state.range.to}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      setNotice(error.message);
    } finally {
      elements.exportButton.disabled = false;
      elements.exportButton.textContent = "Export users";
    }
  }

  let searchTimer = 0;
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.logoutButton.addEventListener("click", logout);
  elements.refreshButton.addEventListener("click", loadCurrentTab);
  elements.exportButton.addEventListener("click", exportUsers);
  elements.customDateForm.addEventListener("submit", applyCustomRange);
  elements.presetTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (button) setPreset(button.dataset.preset);
  });
  document.querySelector(".main-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (button) setTab(button.dataset.tab);
  });
  document.querySelector(".users-table thead").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sort]");
    if (!button) return;
    const sort = button.dataset.sort;
    state.direction = state.sort === sort && state.direction === "desc" ? "asc" : "desc";
    state.sort = sort;
    state.page = 1;
    loadUsers();
  });
  elements.userSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = elements.userSearch.value.trim();
      state.page = 1;
      loadUsers();
    }, 280);
  });
  elements.previousPage.addEventListener("click", () => { if (state.page > 1) { state.page -= 1; loadUsers(); } });
  elements.nextPage.addEventListener("click", () => { state.page += 1; loadUsers(); });

  async function init() {
    const session = readSession();
    if (!session) return showLogin();
    state.session = session;
    try {
      const overview = await rpc("pacman_admin_overview_shared", {
        p_from: state.range.from,
        p_to: state.range.to
      }, session.password);
      showDashboard(session.email, overview);
    } catch (_error) {
      showLogin();
    }
  }

  init();
})();
