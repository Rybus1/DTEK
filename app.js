(() => {
  const API_URL = "https://dtek-api.svitlo-proxy.workers.dev/";

  console.log('Current version: 6');

  // localStorage ключі (збереження регіону/групи/RAW/теми/виду)
  const LS_REGION = "pet_dtek_region_cpu";
  const LS_QUEUE = "pet_dtek_queue";
  const LS_SHOWRAW = "pet_dtek_showraw";
  const LS_THEME = "pet_dtek_theme";
  const LS_VIEW = "pet_dtek_view"; // "grid" | "line"
  const LS_MINIMAL = "pet_dtek_minimal"; // "1" | "0"

  const elRegion = document.getElementById("regionSelect");
  const elQueue = document.getElementById("queueSelect");
  const elRefresh = document.getElementById("refreshBtn");
  const elStatus = document.getElementById("statusLine");
  const elTimeline = document.getElementById("timeline");
  const elRawWrap = document.getElementById("rawWrap");
  const elRaw = document.getElementById("raw");
  const elToggleRaw = document.getElementById("toggleRawBtn");
  const elThemeToggle = document.getElementById("themeToggleBtn");
  const elViewToggle = document.getElementById("viewToggleBtn");
  const elMinimalToggle = document.getElementById("minimalToggleBtn");
  const elMinimalFloating = document.getElementById("minimalFloatingBtn");
  const elInstallBtn = document.getElementById("installBtn");

  let lastData = null;

  const pad2 = (n) => String(n).padStart(2, "0");

  // simple debounce helper
  function debounce(fn, wait = 120) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  const UA = {
    loading: "Завантаження…",
    updated: "Оновлено",
    fetchError: "Помилка завантаження",
    badShape: "Невірний формат API: немає regions[]",
    regionNotFound: "Область не знайдена",
    now: "Зараз",
    region: "Область",
    queue: "Група",
    today: "Сьогодні",
    tomorrow: "Завтра",
    tomorrowNoData: "Завтра: немає даних",
    tomorrowNotReady: "Графіки на завтра ще не готові або завтра увесь день є світло",
    nextChange: "Наступна зміна",
    emergency: "⚠ аварійний режим",
    showJson: "Показати JSON",
    hideJson: "Сховати JSON",
    state_on: "є світло",
    state_off: "немає світла",
    state_unknown: "невідомо",
    view_grid: "🧱 Сітка",
    view_line: "📊 Лінія",
  };

  function parseMaybeWrapped(json) {
    // іноді воркер віддає { body: "....JSON...." }
    if (json && typeof json === "object" && typeof json.body === "string") {
      try { return JSON.parse(json.body); } catch (_) { }
    }
    return json;
  }

  function getViewMode() {
    return localStorage.getItem(LS_VIEW) || "grid";
  }

  function setViewMode(v) {
    localStorage.setItem(LS_VIEW, v);
  }

  function syncViewBtn() {
    if (!elViewToggle) return;
    const v = getViewMode();
    // Показуємо "що буде якщо натиснути"
    elViewToggle.textContent = (v === "grid") ? UA.view_line : UA.view_grid;
  }

  function getMinimal() {
    return localStorage.getItem(LS_MINIMAL) === "1";
  }

  function setMinimal(on) {
    localStorage.setItem(LS_MINIMAL, on ? "1" : "0");
    if (on) document.documentElement.setAttribute("data-minimal", "1");
    else document.documentElement.removeAttribute("data-minimal");
    if (elMinimalToggle) {
      elMinimalToggle.textContent = on ? "Повернутися до повного виду" : "Мінімалістичний вид";
      // keep inline button occupying space but hide visually in minimal mode via CSS
    }
    if (elMinimalFloating) {
      elMinimalFloating.hidden = !on;
      elMinimalFloating.textContent = on ? "Повернутися до повного виду" : "Повернутися до повного виду";
    }
  }

  function buildHalfLabels() {
    const out = [];
    for (let h = 0; h < 24; h++) {
      out.push(`${pad2(h)}:00`);
      out.push(`${pad2(h)}:30`);
    }
    return out;
  }

  function mapCode(code) {
    const c = Number(code || 0);
    if (c === 1) return "on";
    if (c === 2) return "off";
    return "unknown";
  }

  function stateLabel(st) {
    if (st === "on") return UA.state_on;
    if (st === "off") return UA.state_off;
    return UA.state_unknown;
  }

  function sortQueueKey(a, b) {
    // "1.1" < "1.2" < "2.1" ...
    const [a1, a2] = a.split(".").map(Number);
    const [b1, b2] = b.split(".").map(Number);
    return (a1 - b1) || (a2 - b2);
  }

  function regionName(r) {
    // пріоритет UA
    return r.name_ua || r.name_ru || r.name_en || r.cpu || UA.state_unknown;
  }

  function fillRegions(regions) {
    elRegion.innerHTML = "";
    const saved = localStorage.getItem(LS_REGION);

    for (const r of regions) {
      const opt = document.createElement("option");
      opt.value = r.cpu;
      opt.textContent = `${regionName(r)} — ${r.cpu}`;
      elRegion.appendChild(opt);
    }

    if (saved && regions.some(r => r.cpu === saved)) elRegion.value = saved;
    else if (regions[0]) elRegion.value = regions[0].cpu;
  }

  function fillQueues(region) {
    const keys = Object.keys(region.schedule || {}).sort(sortQueueKey);
    elQueue.innerHTML = "";

    for (const k of keys) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      elQueue.appendChild(opt);
    }

    const saved = localStorage.getItem(LS_QUEUE);
    if (saved && keys.includes(saved)) elQueue.value = saved;
    else if (keys[0]) elQueue.value = keys[0];
  }

  function buildHalfListFromMap(slotsMap) {
    const labels = buildHalfLabels();
    return labels.map(lbl => mapCode(slotsMap ? slotsMap[lbl] : 0));
  }

  function findNextChange(halfList, now) {
    const idx = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
    const cur = halfList[idx] || "unknown";

    for (let i = idx + 1; i < halfList.length; i++) {
      if (halfList[i] !== cur) {
        const h = Math.floor(i / 2);
        const m = (i % 2) ? 30 : 0;
        return { at: `${pad2(h)}:${pad2(m)}`, from: cur, to: halfList[i] };
      }
    }
    return null;
  }

  // ===== Режим 1: вертикальна сітка (пилюльки) =====

  function renderVerticalGrid(halfList) {
    const labels = buildHalfLabels();
    const grid = document.createElement("div");
    grid.className = "vgrid";

    const COLS = 2;
    const PER_COL = 12; // hours per column (2 * 12 = 24)

    function stateVarName(s) {
      if (s === "on") return "--accent";
      if (s === "off") return "--off";
      return "--unknown";
    }

    for (let c = 0; c < COLS; c++) {
      const col = document.createElement("div");
      col.className = "col";

      for (let i = 0; i < PER_COL; i++) {
        const hour = c * PER_COL + i; // 0..23
        if (hour >= 24) continue;

        const left = halfList[hour * 2] || "unknown"; // :00-:30
        const right = halfList[hour * 2 + 1] || "unknown"; // :30-:00

        const row = document.createElement("div");
        row.className = "slot";

        const pill = document.createElement("div");
        pill.className = "pill";

        const start = labels[hour * 2];
        const end = pad2((hour + 1) % 24) + ":00";
        const rangeLabel = `${start} - ${end}`;
        pill.textContent = rangeLabel;

        if (left === right) {
          pill.classList.add(left);
          pill.title = `${rangeLabel} — ${stateLabel(left)}`;
          pill.style.removeProperty("background");
          pill.style.removeProperty("color");
        } else {
          const leftVar = stateVarName(left);
          const rightVar = stateVarName(right);
          pill.style.background = `linear-gradient(to right, var(${leftVar}) 0 50%, var(${rightVar}) 50% 100%)`;
          pill.title = `${rangeLabel} — ${stateLabel(left)} → ${stateLabel(right)}`;
          pill.style.color = "var(--pill-text-dark)";
        }

        row.appendChild(pill);
        col.appendChild(row);
      }

      grid.appendChild(col);
    }

    return grid;
  }

  // ===== Режим 2: горизонтальна лінія з підписами у точках змін =====

  function renderTimelineLine(halfList, nowOrNull) {
    const wrap = document.createElement("div");
    wrap.className = "timeline-line";

    // containers: breakpoints (labels above) and bar (segments)
    const breaks = document.createElement("div");
    breaks.className = "tl-breaks";
    const bar = document.createElement("div");
    bar.className = "tl-bar";

    let start = 0;
    let cur = halfList[0] || "unknown";
    const boundaries = [];

    for (let i = 1; i <= halfList.length; i++) {
      const next = halfList[i] || null;
      if (i === halfList.length || next !== cur) {
        // create segment for [start, i)
        const seg = document.createElement("div");
        seg.className = `segment ${cur}`;
        const widthPct = ((i - start) / 48) * 100;
        seg.style.setProperty("--pct", widthPct + "%");

        // show duration inside if at least half-hour blocks >= 2 (>=1 hour)
        const blocks = i - start;
        if (blocks <= 2) seg.dataset.short = "1"; // mark tiny segments
        if (blocks >= 1) {
          const hours = (blocks / 2);
          const v = document.createElement("div");
          v.className = "seg-value";
          // format hours: show integer or .5
          v.textContent = (hours % 1 === 0) ? `${hours}г` : `${hours.toFixed(1)}г`;
          seg.appendChild(v);
        }

        bar.appendChild(seg);

        // record boundary at this start position (for label)
        boundaries.push(start);

        start = i;
        cur = next || "unknown";
      }
    }

    // add final boundary at end
    boundaries.push(48);

    // render breakpoint labels at boundaries (skip 0 at left if not needed)
    for (const b of boundaries) {
      if (b < 0 || b > 48) continue;
      // don't show label at end (48) as it's beyond right edge
      if (b === 48) continue;
      const lbl = document.createElement("div");
      lbl.className = "breakpoint";
      const leftPct = (b / 48) * 100;
      lbl.style.setProperty("--pos", leftPct + "%");
      // position differently on narrow screens (vertical layout)
      const isVertical = window.matchMedia && window.matchMedia('(max-width:720px)').matches;
      if (isVertical) {
        lbl.style.top = leftPct + "%";
        if (leftPct < 5) lbl.style.transform = "translateY(0)";
        else if (leftPct > 95) lbl.style.transform = "translateY(-100%)";
        else lbl.style.transform = "translateY(-50%)";
      } else {
        lbl.style.left = leftPct + "%";
        if (leftPct < 5) lbl.style.transform = "translateX(0)";
        else if (leftPct > 95) lbl.style.transform = "translateX(-100%)";
        else lbl.style.transform = "translateX(-50%)";
      }

      const h = Math.floor(b / 2);
      const m = (b % 2) ? "30" : "00";
      lbl.textContent = `${pad2(h)}:${m}`;
      breaks.appendChild(lbl);
    }

    // current-time indicator: position relative to the bar so timeline padding doesn't skew placement
    if (nowOrNull) {
      const nowIdx = nowOrNull.getHours() * 2 + (nowOrNull.getMinutes() >= 30 ? 1 : 0);
      if (nowIdx >= 0 && nowIdx < 48) {
        const posPct = (nowIdx / 48) * 100;
        const isVertical = window.matchMedia && window.matchMedia('(max-width:720px)').matches;

        const nowLine = document.createElement('div');
        nowLine.className = 'now-line';
        const nowLabel = document.createElement('div');
        nowLabel.className = 'now-indicator';
        nowLabel.textContent = `${pad2(nowOrNull.getHours())}:${pad2(nowOrNull.getMinutes())}`;

        if (isVertical) {
          // horizontal line across bar at percentage height
          nowLine.style.position = 'absolute';
          nowLine.style.left = '0';
          nowLine.style.right = '0';
          nowLine.style.top = posPct + '%';
          nowLine.style.height = '2px';

          nowLabel.style.position = 'absolute';
          nowLabel.style.left = '165px';
          nowLabel.style.top = posPct + '%';
          nowLabel.style.bottom = 'auto';
          nowLabel.style.transform = 'translateY(-50%)';
        } else {
          // vertical line across bar at percentage width
          nowLine.style.position = 'absolute';
          nowLine.style.left = posPct + '%';
          nowLine.style.top = 'auto';
          nowLine.style.width = '2px';
          nowLine.style.bottom = '0';

          nowLabel.style.position = 'absolute';
          nowLabel.style.left = posPct + '%';
          nowLabel.style.top = 'auto';
          nowLabel.style.transform = 'translateX(-50%)';
        }

        // append to bar (not wrap) so positions are relative to the bar box
        bar.appendChild(nowLine);
        bar.appendChild(nowLabel);
      }
    }

    wrap.appendChild(breaks);
    wrap.appendChild(bar);
    return wrap;
  }

  function renderLine(title, dateStr, halfList, emergency, nowOrNull) {
    const wrap = document.createElement("div");

    const head = document.createElement("div");
    head.className = "t-head";

    const left = document.createElement("div");
    left.innerHTML = `<strong>${title}</strong> <span class="muted">(${dateStr || "—"})</span>`;

    const right = document.createElement("div");
    if (emergency) {
      right.className = "danger";
      right.textContent = UA.emergency;
    } else {
      right.className = "muted";
      right.textContent = "";
    }

    head.append(left, right);

    const view = getViewMode();
    const body = (view === "line")
      ? renderTimelineLine(halfList, nowOrNull)
      : renderVerticalGrid(halfList);

    const info = document.createElement("div");
    info.className = "muted";
    info.style.marginTop = "36px";

    const next = nowOrNull ? findNextChange(halfList, nowOrNull) : null;
    info.innerHTML = next
      ? `${UA.nextChange}: <strong>${next.at}</strong> (${stateLabel(next.from)} → ${stateLabel(next.to)})`
      : `${UA.nextChange}: —`;

    wrap.append(head, body, info);
    return wrap;
  }

  function render(data) {
    elTimeline.innerHTML = "";

    if (!data || !Array.isArray(data.regions)) {
      elTimeline.innerHTML = `<div class="danger">${UA.badShape}</div>`;
      return;
    }

    const cpu = elRegion.value;
    const region = data.regions.find(r => r.cpu === cpu);
    if (!region) {
      elTimeline.innerHTML = `<div class="danger">${UA.regionNotFound}: ${cpu}</div>`;
      return;
    }

    // групи залежать від області
    fillQueues(region);

    const q = elQueue.value;

    // зберігаємо налаштування
    localStorage.setItem(LS_REGION, cpu);
    localStorage.setItem(LS_QUEUE, q);

    const dateToday = data.date_today;
    const dateTomorrow = data.date_tomorrow;

    const emergency = !!region.emergency;
    const scheduleByQueue = (region.schedule || {})[q] || {};
    const slotsToday = scheduleByQueue[dateToday] || null;
    const slotsTomorrow = (dateTomorrow && scheduleByQueue[dateTomorrow]) ? scheduleByQueue[dateTomorrow] : null;

    const now = new Date();
    const todayHalf = buildHalfListFromMap(slotsToday);
    const curIdx = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
    const cur = todayHalf[curIdx] || "unknown";

    const summary = document.createElement("div");
    summary.className = "muted";
    summary.style.marginTop = "10px";

    const cls = cur === "off" ? "" : (cur === "on" ? "ok" : "");
    summary.innerHTML =
      `${UA.now}: <strong class="${cls}">${stateLabel(cur)}</strong> · ` +
      `${UA.region}: <strong>${regionName(region)}</strong> · ` +
      `${UA.queue}: <strong>${q}</strong>`;
    elTimeline.appendChild(summary);

    elTimeline.appendChild(renderLine(UA.today, dateToday, todayHalf, emergency, now));

    if (slotsTomorrow) {
      const tomorrowHalf = buildHalfListFromMap(slotsTomorrow);
      const hasOff = tomorrowHalf.includes("off");
      if (!hasOff) {
        const note = document.createElement("div");
        note.className = "muted";
        note.style.marginTop = "10px";
        note.textContent = UA.tomorrowNotReady;
        elTimeline.appendChild(note);
      } else {
        const spacer = document.createElement("div");
        spacer.style.height = "12px";
        elTimeline.appendChild(spacer);
        elTimeline.appendChild(renderLine(UA.tomorrow, dateTomorrow, tomorrowHalf, emergency, null));
      }
    } else {
      const no = document.createElement("div");
      no.className = "muted";
      no.style.marginTop = "10px";
      no.textContent = UA.tomorrowNoData;
      elTimeline.appendChild(no);
    }

    elRaw.textContent = JSON.stringify(data, null, 2);
  }

  async function fetchData() {
    elStatus.textContent = UA.loading;
    try {
      const res = await fetch(API_URL, { cache: "no-store" });
      const json = await res.json();
      const parsed = parseMaybeWrapped(json);

      lastData = parsed;

      if (parsed && Array.isArray(parsed.regions) && elRegion.options.length === 0) {
        fillRegions(parsed.regions);
      }

      elStatus.textContent = `${UA.updated}: ${new Date().toLocaleString("uk-UA")}`;
      render(parsed);
    } catch (e) {
      console.error(e);
      elStatus.textContent = UA.fetchError;
      elTimeline.innerHTML = `<div class="danger">${UA.fetchError}: ${String(e)}</div>`;
    }
  }

  function initUI() {
    const showRaw = localStorage.getItem(LS_SHOWRAW) === "1";
    elRawWrap.hidden = !showRaw;
    elToggleRaw.textContent = showRaw ? UA.hideJson : UA.showJson;

    // theme init
    const savedTheme = localStorage.getItem(LS_THEME) || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    elThemeToggle.textContent = (savedTheme === "light") ? "🌙 Темна тема" : "☀️ Світла тема";

    // minimal init
    const minimalOn = localStorage.getItem(LS_MINIMAL) === "1";
    setMinimal(!!minimalOn);

    // view init
    syncViewBtn();

    elRefresh.addEventListener("click", fetchData);

    elRegion.addEventListener("change", () => {
      if (!lastData) return;
      render(lastData);
    });

    elQueue.addEventListener("change", () => {
      if (!lastData) return;
      localStorage.setItem(LS_QUEUE, elQueue.value);
      render(lastData);
    });

    elToggleRaw.addEventListener("click", () => {
      const next = !(localStorage.getItem(LS_SHOWRAW) === "1");
      localStorage.setItem(LS_SHOWRAW, next ? "1" : "0");
      elRawWrap.hidden = !next;
      elToggleRaw.textContent = next ? UA.hideJson : UA.showJson;
    });

    elThemeToggle.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = cur === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(LS_THEME, next);
      elThemeToggle.textContent = (next === "light") ? "🌙 Темна тема" : "☀️ Світла тема";
      if (lastData) render(lastData);
    });

    if (elMinimalToggle) {
      elMinimalToggle.addEventListener("click", () => {
        const next = !getMinimal();
        setMinimal(next);
        // re-render may hide/show UI; refresh render
        if (lastData) render(lastData);
      });
    }
    if (elMinimalFloating) {
      elMinimalFloating.addEventListener("click", () => {
        const next = !getMinimal();
        setMinimal(next);
        if (lastData) render(lastData);
      });
    }

    // re-render on resize to reposition breakpoints correctly (debounced)
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', debounce(() => {
        if (lastData) render(lastData);
      }, 140));
    }

    // register service worker for PWA / Add to Home Screen support
    if ('serviceWorker' in navigator) {
      const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      const isSecure = location.protocol === 'https:' || isLocalhost;
      if (isSecure) {
        navigator.serviceWorker.register('./sw.js').then(() => {
          console.log('Service worker registered');
        }).catch((err) => console.warn('SW registration failed', err));
      } else {
        console.log('Service worker not registered: insecure origin', location.protocol, location.hostname);
      }
    }

    // capture beforeinstallprompt to allow custom install UI
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.deferredInstallPrompt = e;
      console.log('beforeinstallprompt captured');
      if (elInstallBtn) elInstallBtn.hidden = false;
    });

    // click handler for install button
    if (elInstallBtn) {
      elInstallBtn.addEventListener('click', async () => {
        const evt = window.deferredInstallPrompt;
        if (!evt) return;
        try {
          evt.prompt();
          const choice = await evt.userChoice;
          console.log('userChoice', choice);
          window.deferredInstallPrompt = null;
          elInstallBtn.hidden = true;
          localStorage.setItem('pet_dtek_install_prompted', '1');
        } catch (err) {
          console.warn('install prompt failed', err);
        }
      });
    }

    // when app is installed, hide the button
    window.addEventListener('appinstalled', () => {
      console.log('App installed');
      if (elInstallBtn) elInstallBtn.hidden = true;
    });

    if (elViewToggle) {
      elViewToggle.addEventListener("click", () => {
        const next = getViewMode() === "grid" ? "line" : "grid";
        setViewMode(next);
        syncViewBtn();
        if (lastData) render(lastData);
      });
    }
  }

  initUI();
  fetchData();

  // Service worker registration is handled in initUI() when appropriate

})();
