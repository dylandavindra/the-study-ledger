(function () {
  "use strict";

  /* ============ State (mirrors the SQLite database) ============ */
  var STATE = { modules: [], sessions: [], assessments: [], logs: [], prepItems: [], term: null };
  var modByCode = {};

  var TERM_START, CLASSES_END, EXAM_START, EXAM_END, TERM_WEEKS;

  /* ============ API helper ============ */
  async function api(method, path, body) {
    var res = await fetch("/api" + path, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
      window.location.href = "/login.html";
      throw new Error("Session expired");
    }
    if (!res.ok) {
      var msg = "Request failed";
      try {
        var j = await res.json();
        msg = j.error || msg;
      } catch (e) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function loadState() {
    STATE = await api("GET", "/state");
    modByCode = {};
    STATE.modules.forEach(function (m) { modByCode[m.code] = m; });
    TERM_START = new Date(STATE.term.start + "T00:00:00+08:00");
    CLASSES_END = new Date(STATE.term.classesEnd + "T23:59:00+08:00");
    EXAM_START = new Date(STATE.term.examStart + "T00:00:00+08:00");
    EXAM_END = new Date(STATE.term.examEnd + "T23:59:00+08:00");
    TERM_WEEKS = STATE.term.weeks;
  }

  /* ============ Helpers ============ */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayLocal() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function startOfWeek(d) { var x = new Date(d); var day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function fmtShort(d) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  function fmtDay(d) { return d.toLocaleDateString("en-GB", { weekday: "short" }); }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ============ Header / term status ============ */
  function renderTermStatus() {
    var today = todayLocal();
    var weekNum = Math.min(TERM_WEEKS, Math.max(1, Math.floor(daysBetween(TERM_START, today) / 7) + 1));
    var toClassesEnd = daysBetween(today, CLASSES_END);
    var toExam = daysBetween(today, EXAM_START);
    var html = "";
    if (today < EXAM_START) {
      html += '<span class="term-pill accent">Week <strong>' + weekNum + '</strong> of ' + TERM_WEEKS + '</span>';
    }
    if (today <= CLASSES_END) {
      html += '<span class="term-pill"><strong>' + toClassesEnd + '</strong> days to last class</span>';
    }
    if (today <= EXAM_END) {
      html += '<span class="term-pill' + (toExam <= 14 && today < EXAM_START ? ' accent' : '') + '"><strong>' + (today < EXAM_START ? toExam : "") + '</strong>' + (today < EXAM_START ? " days to exams" : "Exams are on") + '</span>';
    } else {
      html += '<span class="term-pill">Exams complete</span>';
    }
    document.getElementById("term-status").innerHTML = html;
  }

  /* ============ KPI strip ============ */
  function renderKPIs(attentionCount) {
    var today = todayLocal();
    var wkStart = startOfWeek(today);
    var weekTotal = 0, allTotal = 0;
    STATE.logs.forEach(function (l) {
      allTotal += l.hours;
      var ld = new Date(l.date + "T00:00:00");
      if (ld >= wkStart) weekTotal += l.hours;
    });
    var weekTarget = STATE.modules.reduce(function (s, m) { return s + m.target; }, 0);

    var undone = STATE.assessments.filter(function (a) { return !a.done; })
      .map(function (a) { return { a: a, d: new Date(a.due) }; })
      .filter(function (x) { return x.d >= today; })
      .sort(function (x, y) { return x.d - y.d; });
    var nextDl = undone[0];

    var weekNum = Math.min(TERM_WEEKS, Math.max(1, Math.floor(daysBetween(TERM_START, today) / 7) + 1));
    var pct = Math.round(Math.min(1, weekNum / TERM_WEEKS) * 100);

    var tiles = [];
    tiles.push({
      label: "This week's hours", value: weekTotal.toFixed(1) + '<small>/ ' + weekTarget + 'h</small>',
      foot: allTotal.toFixed(1) + "h logged all term", cls: ""
    });
    tiles.push({
      label: "Needs attention", value: String(attentionCount) + '<small>of ' + STATE.modules.length + '</small>',
      foot: attentionCount > 0 ? "check the flagged cards below" : "everything's on pace",
      cls: attentionCount >= 3 ? "crit" : (attentionCount > 0 ? "warn" : "")
    });
    tiles.push({
      label: "Next deadline", value: nextDl ? daysBetween(today, nextDl.d) + '<small>days</small>' : '—',
      foot: nextDl ? (nextDl.a.module + " " + nextDl.a.label) : "nothing scheduled",
      cls: nextDl && daysBetween(today, nextDl.d) <= 3 ? "crit" : (nextDl && daysBetween(today, nextDl.d) <= 7 ? "warn" : "")
    });
    tiles.push({
      label: "Term progress", value: pct + '<small>%</small>',
      foot: "Week " + weekNum + " of " + TERM_WEEKS, cls: ""
    });

    document.getElementById("kpi-strip").innerHTML = tiles.map(function (t) {
      return '<div class="kpi ' + t.cls + '"><div class="label">' + t.label + '</div><div class="value">' + t.value + '</div><div class="foot">' + t.foot + '</div></div>';
    }).join("");
  }

  /* ============ Module cards ============ */
  function computeModuleStats(code) {
    var today = todayLocal();
    var wkStart = startOfWeek(today);
    var weekHours = 0, allHours = 0;
    STATE.logs.forEach(function (l) {
      if (l.module !== code) return;
      allHours += l.hours;
      var ld = new Date(l.date + "T00:00:00");
      if (ld >= wkStart) weekHours += l.hours;
    });
    var upcoming = STATE.assessments.filter(function (a) { return a.module === code && !a.done && new Date(a.due) >= today; })
      .sort(function (a, b) { return new Date(a.due) - new Date(b.due); });
    var next = upcoming[0];
    var nextClass = STATE.sessions.filter(function (s) { return s.module === code && new Date(s.date + "T" + s.end + ":00") >= new Date(); })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.start.localeCompare(b.start); })[0];
    return { weekHours: weekHours, allHours: allHours, next: next, nextClass: nextClass };
  }

  function statusFor(confidence, weekHours, target, next) {
    var today = todayLocal();
    var daysToNext = next ? daysBetween(today, new Date(next.due)) : Infinity;
    var pace = target > 0 ? weekHours / target : 1;
    if (confidence <= 2 || (daysToNext <= 5 && pace < 0.6) || (daysToNext <= 2)) return "critical";
    if (confidence === 3 || pace < 0.85 || daysToNext <= 9) return "watch";
    return "good";
  }

  function renderModules() {
    var grid = document.getElementById("module-grid");
    var existing = {};
    grid.querySelectorAll(".modcard").forEach(function (c) { existing[c.dataset.code] = c; });

    var attentionCount = 0;

    STATE.modules.forEach(function (mod) {
      var card = existing[mod.code];
      var firstBuild = !card;
      if (firstBuild) {
        card = document.createElement("div");
        card.className = "modcard";
        card.dataset.code = mod.code;
        card.style.setProperty("--mc", "var(--s" + mod.slot + ")");
        card.style.setProperty("--mc-soft", "var(--s" + mod.slot + "-soft)");
        grid.appendChild(card);
      }

      var stats = computeModuleStats(mod.code);
      var status = statusFor(mod.confidence, stats.weekHours, mod.target, stats.next);
      if (status !== "good") attentionCount++;

      var pct = mod.target > 0 ? Math.min(100, Math.round(stats.weekHours / mod.target * 100)) : 0;
      var statusLabel = status === "good" ? "On track" : (status === "watch" ? "Watch" : "Attention");

      var nextClassTxt = stats.nextClass
        ? (new Date(stats.nextClass.date + "T00:00:00")).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + " · " + stats.nextClass.start + "–" + stats.nextClass.end + " (" + (stats.nextClass.type === "S" ? "Seminar" : "Lab") + ")"
        : "No more classes";
      var nextDlTxt = stats.next
        ? stats.next.label + " — " + Math.max(0, daysBetween(todayLocal(), new Date(stats.next.due))) + "d left"
        : "All caught up";

      if (firstBuild) {
        card.innerHTML =
          '<div class="mchead">' +
            '<div><div class="mcode">' + mod.code + '</div><div class="mname" data-role="mname"></div></div>' +
            '<div class="mchead-right">' +
              '<span class="status-pill ' + status + '" data-role="status">' + statusLabel + '</span>' +
              '<button type="button" class="card-edit-btn" data-role="edit-module-card" aria-label="Edit module">&#9998;</button>' +
            '</div>' +
          '</div>' +
          '<div class="confidence">' +
            '<span class="clabel">Confidence</span>' +
            '<div class="dots" data-role="dots">' +
              [1, 2, 3, 4, 5].map(function (v) { return '<button type="button" class="dot" data-value="' + v + '" aria-label="Set confidence ' + v + ' of 5"></button>'; }).join("") +
            '</div>' +
          '</div>' +
          '<div class="progress-row">' +
            '<div class="progress-label"><span>This week</span><span class="ph" data-role="ph"></span></div>' +
            '<div class="progress-track"><div class="progress-fill" data-role="fill" style="width:0%"></div></div>' +
            '<div class="target-edit"><span>Weekly target</span><input type="number" min="0" step="0.5" data-role="target" value="' + mod.target + '" /><span>h</span></div>' +
          '</div>' +
          '<div class="mc-meta">' +
            '<div class="row"><span>Next class</span><b data-role="nextclass"></b></div>' +
            '<div class="row"><span>Next deadline</span><b data-role="nextdl"></b></div>' +
            '<div class="row"><span>All-term hours</span><b data-role="allhours"></b></div>' +
          '</div>';

        card.querySelectorAll('[data-role="dots"] .dot').forEach(function (dot) {
          dot.addEventListener("click", async function () {
            await api("PATCH", "/modules/" + mod.code, { confidence: parseInt(dot.dataset.value, 10) });
            await loadState();
            renderAll();
          });
        });
        card.querySelector('[data-role="target"]').addEventListener("change", async function (e) {
          var v = parseFloat(e.target.value);
          if (isNaN(v) || v < 0) { e.target.value = mod.target; return; }
          await api("PATCH", "/modules/" + mod.code, { target: v });
          await loadState();
          renderAll();
        });
        card.querySelector('[data-role="edit-module-card"]').addEventListener("click", function () {
          openModuleModal(mod.code);
        });
      }

      card.querySelector('[data-role="mname"]').textContent = mod.name;
      card.querySelector('[data-role="status"]').className = "status-pill " + status;
      card.querySelector('[data-role="status"]').textContent = statusLabel;
      card.querySelectorAll('[data-role="dots"] .dot').forEach(function (dot) {
        dot.classList.toggle("on", parseInt(dot.dataset.value, 10) <= mod.confidence);
      });
      card.querySelector('[data-role="ph"]').textContent = stats.weekHours.toFixed(1) + "h / " + mod.target + "h";
      card.querySelector('[data-role="fill"]').style.width = pct + "%";
      card.querySelector('[data-role="target"]').value = mod.target;
      card.querySelector('[data-role="nextclass"]').textContent = nextClassTxt;
      card.querySelector('[data-role="nextdl"]').textContent = nextDlTxt;
      card.querySelector('[data-role="allhours"]').textContent = stats.allHours.toFixed(1) + "h";
    });

    var currentCodes = {};
    STATE.modules.forEach(function (mod) { currentCodes[mod.code] = true; });
    Object.keys(existing).forEach(function (code) {
      if (!currentCodes[code]) existing[code].remove();
    });

    return attentionCount;
  }

  /* ============ Notes ============ */
  function renderNotes() {
    var grid = document.getElementById("note-grid");
    var existing = {};
    grid.querySelectorAll(".notecard").forEach(function (c) { existing[c.dataset.code] = c; });

    var orderedModules = STATE.modules.slice().sort(function (a, b) { return a.note_order - b.note_order; });

    orderedModules.forEach(function (mod) {
      var card = existing[mod.code];
      var firstBuild = !card;
      if (firstBuild) {
        card = document.createElement("div");
        card.className = "notecard";
        card.dataset.code = mod.code;
        card.style.setProperty("--mc", "var(--s" + mod.slot + ")");
        card.style.setProperty("--mc-soft", "var(--s" + mod.slot + "-soft)");
        card.innerHTML =
          '<div class="nchead">' +
            '<div><div class="ncode">' + mod.code + '</div><div class="nname" data-role="nname"></div></div>' +
            '<button type="button" class="drag-handle" data-role="drag-handle" draggable="true" aria-label="Drag to reorder ' + mod.code + '" title="Drag to reorder">⠿</button>' +
          '</div>' +
          '<textarea data-role="notes" placeholder="Notes for ' + mod.code + '…"></textarea>' +
          '<span class="note-saved" data-role="saved">Saved</span>';

        var textarea = card.querySelector('[data-role="notes"]');
        var savedTag = card.querySelector('[data-role="saved"]');
        var saveTimer = null;
        textarea.addEventListener("change", async function () {
          await api("PATCH", "/modules/" + mod.code, { notes: textarea.value });
          await loadState();
          renderAll();
          savedTag.classList.add("show");
          clearTimeout(saveTimer);
          saveTimer = setTimeout(function () { savedTag.classList.remove("show"); }, 1500);
        });
      }

      card.querySelector('[data-role="nname"]').textContent = mod.name;
      var textareaEl = card.querySelector('[data-role="notes"]');
      if (document.activeElement !== textareaEl) {
        textareaEl.value = mod.notes || "";
      }

      // Re-append in note_order sequence every render, so drag reorders (and
      // any later PATCH from elsewhere) always converge on the right layout.
      grid.appendChild(card);
    });

    var currentCodes = {};
    STATE.modules.forEach(function (mod) { currentCodes[mod.code] = true; });
    Object.keys(existing).forEach(function (code) {
      if (!currentCodes[code]) existing[code].remove();
    });
  }

  /* ============ Notes: drag-and-drop reordering ============ */
  function initNotesDragDrop() {
    var grid = document.getElementById("note-grid");
    var draggedCode = null;

    grid.addEventListener("dragstart", function (e) {
      var handle = e.target.closest('[data-role="drag-handle"]');
      var card = handle ? handle.closest(".notecard") : null;
      if (!handle || !card) { e.preventDefault(); return; }
      draggedCode = card.dataset.code;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", draggedCode);
      if (e.dataTransfer.setDragImage) {
        var rect = card.getBoundingClientRect();
        e.dataTransfer.setDragImage(card, e.clientX - rect.left, e.clientY - rect.top);
      }
    });

    grid.addEventListener("dragend", function () {
      grid.querySelectorAll(".notecard.dragging").forEach(function (c) { c.classList.remove("dragging"); });
      grid.querySelectorAll(".notecard.drag-over").forEach(function (c) { c.classList.remove("drag-over"); });
      draggedCode = null;
    });

    grid.addEventListener("dragover", function (e) {
      if (!draggedCode) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var overCard = e.target.closest(".notecard");
      grid.querySelectorAll(".notecard.drag-over").forEach(function (c) { c.classList.remove("drag-over"); });
      if (overCard && overCard.dataset.code !== draggedCode) {
        overCard.classList.add("drag-over");
      }
    });

    grid.addEventListener("drop", async function (e) {
      e.preventDefault();
      var overCard = e.target.closest(".notecard");
      grid.querySelectorAll(".notecard.drag-over").forEach(function (c) { c.classList.remove("drag-over"); });
      if (!draggedCode || !overCard || overCard.dataset.code === draggedCode) return;

      var cards = Array.from(grid.querySelectorAll(".notecard"));
      var order = cards.map(function (c) { return c.dataset.code; });
      var fromIdx = order.indexOf(draggedCode);
      var toIdx = order.indexOf(overCard.dataset.code);
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, draggedCode);

      order.forEach(function (code) {
        grid.appendChild(cards.filter(function (c) { return c.dataset.code === code; })[0]);
      });

      await api("POST", "/modules/reorder", { order: order });
      await loadState();
      renderAll();
    });
  }

  /* ============ Module management (popup: add / edit / delete) ============ */
  var moduleModalCode = null;
  function openModuleModal(code) {
    var titleEl = document.getElementById("module-modal-title");
    var codeEl = document.getElementById("mm-code");
    var nameEl = document.getElementById("mm-name");
    var targetEl = document.getElementById("mm-target");
    var confEl = document.getElementById("mm-confidence");
    var saveBtn = document.getElementById("module-modal-save");
    var deleteBtn = document.getElementById("module-modal-delete");

    moduleModalCode = code || null;
    if (code) {
      var mod = modByCode[code];
      if (!mod) return;
      titleEl.textContent = "Edit module";
      codeEl.value = mod.code;
      codeEl.disabled = true;
      nameEl.value = mod.name;
      targetEl.value = mod.target;
      confEl.value = mod.confidence;
      saveBtn.textContent = "Save changes";
      deleteBtn.style.display = "";
    } else {
      titleEl.textContent = "Add module";
      codeEl.value = "";
      codeEl.disabled = false;
      nameEl.value = "";
      targetEl.value = "";
      confEl.value = "3";
      saveBtn.textContent = "Add module";
      deleteBtn.style.display = "none";
    }
    document.getElementById("module-modal-overlay").hidden = false;
    (code ? nameEl : codeEl).focus();
  }

  function closeModuleModal() {
    document.getElementById("module-modal-overlay").hidden = true;
    moduleModalCode = null;
  }

  function initModuleModal() {
    var overlay = document.getElementById("module-modal-overlay");
    var codeEl = document.getElementById("mm-code");
    var nameEl = document.getElementById("mm-name");
    var targetEl = document.getElementById("mm-target");
    var confEl = document.getElementById("mm-confidence");
    var saveBtn = document.getElementById("module-modal-save");
    var deleteBtn = document.getElementById("module-modal-delete");

    document.getElementById("mod-open-add").addEventListener("click", function () { openModuleModal(null); });
    document.getElementById("module-modal-cancel").addEventListener("click", closeModuleModal);
    document.getElementById("module-modal-close").addEventListener("click", closeModuleModal);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModuleModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closeModuleModal();
    });

    saveBtn.addEventListener("click", async function () {
      var code = codeEl.value.trim().toUpperCase();
      var name = nameEl.value.trim();
      var target = targetEl.value === "" ? 3 : parseFloat(targetEl.value);
      var confidence = parseInt(confEl.value, 10);
      if (!name || (!moduleModalCode && !code) || isNaN(target) || target < 0) {
        nameEl.focus();
        return;
      }
      if (moduleModalCode) {
        await api("PATCH", "/modules/" + moduleModalCode, { name: name, target: target, confidence: confidence });
      } else {
        await api("POST", "/modules", { code: code, name: name, target: target });
        if (confidence !== 3) await api("PATCH", "/modules/" + code, { confidence: confidence });
      }
      closeModuleModal();
      await loadState();
      renderAll();
    });

    deleteBtn.addEventListener("click", async function () {
      if (!moduleModalCode) return;
      if (!confirm("Delete module " + moduleModalCode + "? This also removes its classes, assessments, and logged hours.")) return;
      await api("DELETE", "/modules/" + moduleModalCode);
      closeModuleModal();
      await loadState();
      renderAll();
    });
  }

  /* ============ Keep module <select> lists in sync ============ */
  function refreshModuleSelects() {
    ["cm-module", "log-module", "am-module", "pm-module"].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var prev = sel.value;
      sel.innerHTML = STATE.modules.map(function (m) { return '<option value="' + m.code + '">' + m.code + '</option>'; }).join("");
      if (STATE.modules.some(function (m) { return m.code === prev; })) sel.value = prev;
    });
  }

  /* ============ Timetable ============ */
  var ttWeekOffset = 0;
  function renderTimetable() {
    var base = startOfWeek(todayLocal());
    var wkStart = addDays(base, ttWeekOffset * 7);
    var wkEnd = addDays(wkStart, 6);
    document.getElementById("wk-label").textContent = fmtShort(wkStart) + " – " + fmtShort(wkEnd);

    var grid = document.getElementById("tt-grid");
    var todayIso = isoDate(todayLocal());
    var html = "";
    for (var i = 0; i < 7; i++) {
      var day = addDays(wkStart, i);
      var iso = isoDate(day);
      var isToday = iso === todayIso;
      var daySessions = STATE.sessions.filter(function (s) { return s.date === iso; })
        .sort(function (a, b) { return a.start.localeCompare(b.start); });
      html += '<div class="ttday' + (isToday ? ' today' : '') + '">';
      html += '<div class="dname"><span>' + fmtDay(day) + '</span><span class="dnum">' + day.getDate() + '</span></div>';
      if (daySessions.length === 0) {
        html += '<span class="none">—</span>';
      } else {
        daySessions.forEach(function (s) {
          var mod = modByCode[s.module];
          html += '<div class="ttclass" data-id="' + s.id + '" style="--mc:var(--s' + mod.slot + ');--mc-soft:var(--s' + mod.slot + '-soft)">' +
            '<button type="button" class="ttedit" data-role="edit-session" aria-label="Edit class">&#9998;</button>' +
            '<div class="tcode">' + s.module + '</div>' +
            '<div class="ttime">' + s.start + '–' + s.end + '</div>' +
            '<div class="ttype">' + (s.type === "S" ? "Seminar" : "Lab") + (s.room ? ' · ' + s.room : '') + '</div>' +
          '</div>';
        });
      }
      html += '</div>';
    }
    grid.innerHTML = html;
  }

  /* ============ Class management (popup: add / edit / delete) ============ */
  var classModalId = null;
  function openClassModal(id) {
    var titleEl = document.getElementById("class-modal-title");
    var dateEl = document.getElementById("cm-date");
    var modSel = document.getElementById("cm-module");
    var typeEl = document.getElementById("cm-type");
    var startEl = document.getElementById("cm-start");
    var endEl = document.getElementById("cm-end");
    var roomEl = document.getElementById("cm-room");
    var saveBtn = document.getElementById("class-modal-save");
    var deleteBtn = document.getElementById("class-modal-delete");

    classModalId = id || null;
    if (id) {
      var s = STATE.sessions.filter(function (x) { return x.id === id; })[0];
      if (!s) return;
      titleEl.textContent = "Edit class";
      dateEl.value = s.date;
      modSel.value = s.module;
      typeEl.value = s.type;
      startEl.value = s.start;
      endEl.value = s.end;
      roomEl.value = s.room || "";
      saveBtn.textContent = "Save changes";
      deleteBtn.style.display = "";
    } else {
      titleEl.textContent = "Add class";
      dateEl.value = isoDate(todayLocal());
      modSel.value = STATE.modules[0] ? STATE.modules[0].code : "";
      typeEl.value = "S";
      startEl.value = "12:00";
      endEl.value = "14:00";
      roomEl.value = "";
      saveBtn.textContent = "Add class";
      deleteBtn.style.display = "none";
    }
    document.getElementById("class-modal-overlay").hidden = false;
  }

  function closeClassModal() {
    document.getElementById("class-modal-overlay").hidden = true;
    classModalId = null;
  }

  function initClassModal() {
    var overlay = document.getElementById("class-modal-overlay");
    var dateEl = document.getElementById("cm-date");
    var modSel = document.getElementById("cm-module");
    var typeEl = document.getElementById("cm-type");
    var startEl = document.getElementById("cm-start");
    var endEl = document.getElementById("cm-end");
    var roomEl = document.getElementById("cm-room");
    var saveBtn = document.getElementById("class-modal-save");
    var deleteBtn = document.getElementById("class-modal-delete");

    document.getElementById("cls-open-add").addEventListener("click", function () { openClassModal(null); });
    document.getElementById("class-modal-cancel").addEventListener("click", closeClassModal);
    document.getElementById("class-modal-close").addEventListener("click", closeClassModal);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeClassModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closeClassModal();
    });

    document.getElementById("tt-grid").addEventListener("click", function (e) {
      var editBtn = e.target.closest('[data-role="edit-session"]');
      if (!editBtn) return;
      var id = Number(editBtn.closest(".ttclass").dataset.id);
      openClassModal(id);
    });

    saveBtn.addEventListener("click", async function () {
      var date = dateEl.value;
      var module = modSel.value;
      var type = typeEl.value;
      var start = startEl.value;
      var end = endEl.value;
      var room = roomEl.value.trim();
      if (!date || !start || !end) {
        dateEl.focus();
        return;
      }
      if (classModalId) {
        await api("PATCH", "/sessions/" + classModalId, { date: date, module: module, type: type, start: start, end: end, room: room });
      } else {
        await api("POST", "/sessions", { date: date, module: module, type: type, start: start, end: end, room: room });
      }
      closeClassModal();
      await loadState();
      renderAll();
    });

    deleteBtn.addEventListener("click", async function () {
      if (!classModalId) return;
      if (!confirm("Delete this class?")) return;
      await api("DELETE", "/sessions/" + classModalId);
      closeClassModal();
      await loadState();
      renderAll();
    });
  }

  /* ============ Deadlines ============ */
  var showAllAssessments = false;
  function renderDeadlines() {
    var today = todayLocal();
    var allRows = STATE.assessments.slice().sort(function (a, b) { return new Date(a.due) - new Date(b.due); });
    var upcomingRows = allRows.filter(function (a) { return !a.done; });
    var rows = showAllAssessments ? allRows : upcomingRows.slice(0, 6);

    var body = document.getElementById("deadline-body");
    body.innerHTML = rows.map(function (a) {
      var mod = modByCode[a.module];
      var due = new Date(a.due);
      var days = daysBetween(today, due);
      var cdText, cdClass = "";
      if (a.done) { cdText = "submitted"; }
      else if (days < 0) { cdText = Math.abs(days) + "d overdue"; cdClass = "urgent"; }
      else if (days === 0) { cdText = "due today"; cdClass = "urgent"; }
      else { cdText = days + "d left"; cdClass = days <= 3 ? "urgent" : (days <= 9 ? "soon" : ""); }
      var dueStr = due.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + due.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      return '<tr class="' + (a.done ? "done" : "") + '" data-id="' + a.id + '">' +
        '<td><input type="checkbox" class="dl-check" ' + (a.done ? "checked" : "") + ' aria-label="Mark ' + esc(a.module + " " + a.label) + ' as submitted"/></td>' +
        '<td><span class="modchip" style="--mc:var(--s' + mod.slot + ');--mc-soft:var(--s' + mod.slot + '-soft)">' + a.module + '</span></td>' +
        '<td class="dl-label">' + esc(a.label) + '</td>' +
        '<td><span class="cat-tag ' + a.category + '">' + a.category + '</span></td>' +
        '<td>' + dueStr + '</td>' +
        '<td class="dl-countdown ' + cdClass + '">' + cdText + '</td>' +
        '<td><button type="button" class="edit-btn" data-role="edit-assess" aria-label="Edit assessment">&#9998;</button></td>' +
      '</tr>';
    }).join("");

    body.querySelectorAll(".dl-check").forEach(function (cb) {
      cb.addEventListener("change", async function () {
        var id = cb.closest("tr").dataset.id;
        await api("PATCH", "/assessments/" + id, { done: cb.checked });
        await loadState();
        renderAll();
      });
    });

    var doneCount = allRows.length - upcomingRows.length;
    var canToggle = upcomingRows.length > 6 || doneCount > 0;
    var toggleBtn = document.getElementById("deadline-toggle-all");
    toggleBtn.style.display = canToggle ? "" : "none";
    toggleBtn.textContent = showAllAssessments ? "Show upcoming only" : "Show all (" + allRows.length + ")";
  }

  function initDeadlineToggle() {
    document.getElementById("deadline-toggle-all").addEventListener("click", function () {
      showAllAssessments = !showAllAssessments;
      renderDeadlines();
    });
  }

  /* ============ Assessment management (popup: add / edit / delete) ============ */
  var assessModalId = null;
  function openAssessModal(id) {
    var titleEl = document.getElementById("assess-modal-title");
    var modSel = document.getElementById("am-module");
    var labelEl = document.getElementById("am-label");
    var dueEl = document.getElementById("am-due");
    var catEl = document.getElementById("am-category");
    var saveBtn = document.getElementById("assess-modal-save");
    var deleteBtn = document.getElementById("assess-modal-delete");

    assessModalId = id || null;
    if (id) {
      var a = STATE.assessments.filter(function (x) { return x.id === id; })[0];
      if (!a) return;
      titleEl.textContent = "Edit assessment";
      modSel.value = a.module;
      labelEl.value = a.label;
      dueEl.value = a.due;
      catEl.value = a.category;
      saveBtn.textContent = "Save changes";
      deleteBtn.style.display = "";
    } else {
      titleEl.textContent = "Add assessment";
      modSel.value = STATE.modules[0] ? STATE.modules[0].code : "";
      labelEl.value = "";
      dueEl.value = "";
      catEl.value = "quiz";
      saveBtn.textContent = "Add assessment";
      deleteBtn.style.display = "none";
    }
    document.getElementById("assess-modal-overlay").hidden = false;
    labelEl.focus();
  }

  function closeAssessModal() {
    document.getElementById("assess-modal-overlay").hidden = true;
    assessModalId = null;
  }

  function initAssessModal() {
    var overlay = document.getElementById("assess-modal-overlay");
    var modSel = document.getElementById("am-module");
    var labelEl = document.getElementById("am-label");
    var dueEl = document.getElementById("am-due");
    var catEl = document.getElementById("am-category");
    var saveBtn = document.getElementById("assess-modal-save");
    var deleteBtn = document.getElementById("assess-modal-delete");

    document.getElementById("as-open-add").addEventListener("click", function () { openAssessModal(null); });
    document.getElementById("assess-modal-cancel").addEventListener("click", closeAssessModal);
    document.getElementById("assess-modal-close").addEventListener("click", closeAssessModal);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeAssessModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closeAssessModal();
    });

    document.getElementById("deadline-body").addEventListener("click", function (e) {
      var editBtn = e.target.closest('[data-role="edit-assess"]');
      if (!editBtn) return;
      var id = Number(editBtn.closest("tr").dataset.id);
      openAssessModal(id);
    });

    saveBtn.addEventListener("click", async function () {
      var module = modSel.value;
      var label = labelEl.value.trim();
      var due = dueEl.value;
      var category = catEl.value;
      if (!label || !due) {
        labelEl.focus();
        return;
      }
      if (assessModalId) {
        await api("PATCH", "/assessments/" + assessModalId, { module: module, label: label, due: due, category: category });
      } else {
        await api("POST", "/assessments", { module: module, label: label, due: due, category: category });
      }
      closeAssessModal();
      await loadState();
      renderAll();
    });

    deleteBtn.addEventListener("click", async function () {
      if (!assessModalId) return;
      if (!confirm("Delete this assessment?")) return;
      await api("DELETE", "/assessments/" + assessModalId);
      closeAssessModal();
      await loadState();
      renderAll();
    });
  }

  /* ============ Prep plan ============ */
  function renderPrep() {
    var today = todayLocal();
    var majors = STATE.assessments.filter(function (a) { return a.category === "tma" || a.category === "gba"; })
      .slice().sort(function (a, b) { return new Date(a.due) - new Date(b.due); });

    var itemsByAssessment = {};
    STATE.prepItems.forEach(function (p) {
      if (!itemsByAssessment[p.assessment_id]) itemsByAssessment[p.assessment_id] = { steps: [], blocks: [] };
      itemsByAssessment[p.assessment_id][p.kind === "step" ? "steps" : "blocks"].push(p);
    });

    var grid = document.getElementById("prep-grid");
    grid.innerHTML = majors.map(function (a) {
      var mod = modByCode[a.module];
      var due = new Date(a.due);
      var days = daysBetween(today, due);
      var items = itemsByAssessment[a.id] || { steps: [], blocks: [] };
      var steps = items.steps.slice().sort(function (x, y) { return x.sort_order - y.sort_order; });
      var blocks = items.blocks.slice().sort(function (x, y) { return x.sort_order - y.sort_order; });

      var stepsHtml = steps.map(function (st, idx) {
        var isFirstUndone = !st.done && steps.slice(0, idx).every(function (s) { return s.done; });
        var cls = st.done ? "done" : (isFirstUndone ? "active" : "");
        var whenTxt = st.due ? fmtShort(new Date(st.due + "T00:00:00")) : "";
        return '<div class="prepstep ' + cls + '"><div class="node"></div><div class="ptext">' + esc(st.text) + (whenTxt ? '<span class="pwhen">' + whenTxt + '</span>' : '') + '</div></div>';
      }).join("") || '<div class="hint">No steps yet — click edit to add some.</div>';

      var blocksHtml = blocks.map(function (b) { return '<span class="wb">' + esc(b.text) + '</span>'; }).join("");

      return '<div class="prepcard" style="--mc:var(--s' + mod.slot + ');--mc-soft:var(--s' + mod.slot + '-soft)">' +
        '<div class="ph-title" data-id="' + a.id + '"><span class="modchip" style="--mc:var(--s' + mod.slot + ');--mc-soft:var(--s' + mod.slot + '-soft)">' + a.module + '</span>' +
          '<div class="ph-right"><span class="duein">' + (days >= 0 ? days + "d left" : "past due") + '</span>' +
            '<button type="button" class="card-edit-btn" data-role="edit-prep" aria-label="Edit deliverable">&#9998;</button>' +
          '</div>' +
        '</div>' +
        '<div class="pname">' + esc(a.label) + ' — ' + esc(mod.name) + '</div>' +
        '<div class="prepsteps">' + stepsHtml + '</div>' +
        (blocksHtml ? '<div class="work-blocks">' + blocksHtml + '</div>' : '') +
      '</div>';
    }).join("") || '<div class="hint">No TMAs or GBAs to plan for right now.</div>';
  }

  /* ============ Prep plan management (popup: add / edit / delete + steps/blocks) ============ */
  var prepModalId = null;

  function renderPrepModalLists() {
    if (!prepModalId) return;
    var steps = STATE.prepItems.filter(function (p) { return p.assessment_id === prepModalId && p.kind === "step"; })
      .sort(function (a, b) { return a.sort_order - b.sort_order; });
    var blocks = STATE.prepItems.filter(function (p) { return p.assessment_id === prepModalId && p.kind === "block"; })
      .sort(function (a, b) { return a.sort_order - b.sort_order; });

    document.getElementById("pm-steps-list").innerHTML = steps.map(function (s) {
      return '<div class="pm-row" data-id="' + s.id + '">' +
        '<input type="checkbox" class="pm-step-done" ' + (s.done ? "checked" : "") + ' aria-label="Mark step done" />' +
        '<input type="date" class="pm-step-date" value="' + (s.due || "") + '" />' +
        '<input type="text" class="pm-step-text" value="' + esc(s.text) + '" />' +
        '<button type="button" class="del-btn pm-step-del" aria-label="Delete step">&times;</button>' +
      '</div>';
    }).join("") || '<div class="pm-empty">No steps yet.</div>';

    document.getElementById("pm-blocks-list").innerHTML = blocks.map(function (b) {
      return '<div class="pm-row" data-id="' + b.id + '">' +
        '<input type="text" class="pm-block-text" value="' + esc(b.text) + '" />' +
        '<button type="button" class="del-btn pm-block-del" aria-label="Delete block">&times;</button>' +
      '</div>';
    }).join("") || '<div class="pm-empty">No work blocks yet.</div>';
  }

  function openPrepModal(assessmentId) {
    var titleEl = document.getElementById("prep-modal-title");
    var modSel = document.getElementById("pm-module");
    var labelEl = document.getElementById("pm-label");
    var dueEl = document.getElementById("pm-due");
    var catEl = document.getElementById("pm-category");
    var saveBtn = document.getElementById("prep-modal-save");
    var deleteBtn = document.getElementById("prep-modal-delete");
    var stepsSection = document.getElementById("pm-steps-section");
    var blocksSection = document.getElementById("pm-blocks-section");

    prepModalId = assessmentId || null;
    if (assessmentId) {
      var a = STATE.assessments.filter(function (x) { return x.id === assessmentId; })[0];
      if (!a) return;
      titleEl.textContent = "Edit deliverable";
      modSel.value = a.module;
      labelEl.value = a.label;
      dueEl.value = a.due;
      catEl.value = a.category === "gba" ? "gba" : "tma";
      saveBtn.textContent = "Save changes";
      deleteBtn.style.display = "";
      stepsSection.style.display = "";
      blocksSection.style.display = "";
      renderPrepModalLists();
    } else {
      titleEl.textContent = "Add deliverable";
      modSel.value = STATE.modules[0] ? STATE.modules[0].code : "";
      labelEl.value = "";
      dueEl.value = "";
      catEl.value = "tma";
      saveBtn.textContent = "Add deliverable";
      deleteBtn.style.display = "none";
      stepsSection.style.display = "none";
      blocksSection.style.display = "none";
    }
    document.getElementById("prep-modal-overlay").hidden = false;
    labelEl.focus();
  }

  function closePrepModal() {
    document.getElementById("prep-modal-overlay").hidden = true;
    prepModalId = null;
  }

  function initPrepModal() {
    var overlay = document.getElementById("prep-modal-overlay");
    var modSel = document.getElementById("pm-module");
    var labelEl = document.getElementById("pm-label");
    var dueEl = document.getElementById("pm-due");
    var catEl = document.getElementById("pm-category");
    var saveBtn = document.getElementById("prep-modal-save");
    var deleteBtn = document.getElementById("prep-modal-delete");

    document.getElementById("prep-open-add").addEventListener("click", function () { openPrepModal(null); });
    document.getElementById("prep-modal-cancel").addEventListener("click", closePrepModal);
    document.getElementById("prep-modal-close").addEventListener("click", closePrepModal);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closePrepModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closePrepModal();
    });

    document.getElementById("prep-grid").addEventListener("click", function (e) {
      var editBtn = e.target.closest('[data-role="edit-prep"]');
      if (!editBtn) return;
      var id = Number(editBtn.closest(".ph-title").dataset.id);
      openPrepModal(id);
    });

    saveBtn.addEventListener("click", async function () {
      var module = modSel.value;
      var label = labelEl.value.trim();
      var due = dueEl.value;
      var category = catEl.value;
      if (!label || !due) {
        labelEl.focus();
        return;
      }
      if (prepModalId) {
        await api("PATCH", "/assessments/" + prepModalId, { module: module, label: label, due: due, category: category });
      } else {
        await api("POST", "/assessments", { module: module, label: label, due: due, category: category });
      }
      closePrepModal();
      await loadState();
      renderAll();
    });

    deleteBtn.addEventListener("click", async function () {
      if (!prepModalId) return;
      if (!confirm("Delete this deliverable? This also removes its prep steps and work blocks.")) return;
      await api("DELETE", "/assessments/" + prepModalId);
      closePrepModal();
      await loadState();
      renderAll();
    });

    document.getElementById("pm-add-step").addEventListener("click", async function () {
      if (!prepModalId) return;
      await api("POST", "/prep-items", { assessment_id: prepModalId, kind: "step", text: "New step" });
      await loadState();
      renderPrep();
      renderPrepModalLists();
    });

    document.getElementById("pm-add-block").addEventListener("click", async function () {
      if (!prepModalId) return;
      await api("POST", "/prep-items", { assessment_id: prepModalId, kind: "block", text: "New work block" });
      await loadState();
      renderPrep();
      renderPrepModalLists();
    });

    document.getElementById("pm-steps-list").addEventListener("change", async function (e) {
      var row = e.target.closest(".pm-row");
      if (!row) return;
      var id = row.dataset.id;
      if (e.target.classList.contains("pm-step-done")) {
        await api("PATCH", "/prep-items/" + id, { done: e.target.checked });
      } else if (e.target.classList.contains("pm-step-date")) {
        await api("PATCH", "/prep-items/" + id, { due: e.target.value || null });
      } else if (e.target.classList.contains("pm-step-text")) {
        var text = e.target.value.trim();
        if (!text) { e.target.focus(); return; }
        await api("PATCH", "/prep-items/" + id, { text: text });
      } else {
        return;
      }
      await loadState();
      renderPrep();
    });

    document.getElementById("pm-steps-list").addEventListener("click", async function (e) {
      var delBtn = e.target.closest(".pm-step-del");
      if (!delBtn) return;
      var id = delBtn.closest(".pm-row").dataset.id;
      await api("DELETE", "/prep-items/" + id);
      await loadState();
      renderPrep();
      renderPrepModalLists();
    });

    document.getElementById("pm-blocks-list").addEventListener("change", async function (e) {
      if (!e.target.classList.contains("pm-block-text")) return;
      var row = e.target.closest(".pm-row");
      var text = e.target.value.trim();
      if (!text) { e.target.focus(); return; }
      await api("PATCH", "/prep-items/" + row.dataset.id, { text: text });
      await loadState();
      renderPrep();
    });

    document.getElementById("pm-blocks-list").addEventListener("click", async function (e) {
      var delBtn = e.target.closest(".pm-block-del");
      if (!delBtn) return;
      var id = delBtn.closest(".pm-row").dataset.id;
      await api("DELETE", "/prep-items/" + id);
      await loadState();
      renderPrep();
      renderPrepModalLists();
    });
  }

  /* ============ Daily log ============ */
  var showAllLogs = false;
  function renderLogTable() {
    var allLogs = STATE.logs;
    var rows = showAllLogs ? allLogs : allLogs.slice(0, 3);

    var body = document.getElementById("log-body");
    body.innerHTML = rows.map(function (l) {
      var mod = modByCode[l.module];
      var d = new Date(l.date + "T00:00:00");
      return '<tr data-id="' + l.id + '">' +
        '<td class="ldate">' + fmtShort(d) + '</td>' +
        '<td><span class="modchip" style="--mc:var(--s' + mod.slot + ');--mc-soft:var(--s' + mod.slot + '-soft)">' + l.module + '</span></td>' +
        '<td class="lh">' + l.hours.toFixed(2).replace(/\.?0+$/, "") + 'h</td>' +
        '<td>' + esc(l.topic || "—") + '</td>' +
        '<td><button type="button" class="del-btn" data-role="del-log" aria-label="Delete entry">×</button></td>' +
      '</tr>';
    }).join("");
    document.getElementById("log-empty").style.display = allLogs.length ? "none" : "block";

    var toggleBtn = document.getElementById("log-toggle-all");
    toggleBtn.style.display = allLogs.length > 3 ? "" : "none";
    toggleBtn.textContent = showAllLogs ? "Show recent only" : "Show all (" + allLogs.length + ")";
  }

  function initLogToggle() {
    document.getElementById("log-toggle-all").addEventListener("click", function () {
      showAllLogs = !showAllLogs;
      renderLogTable();
    });
  }

  function initLogForm() {
    var sel = document.getElementById("log-module");
    sel.innerHTML = STATE.modules.map(function (m) { return '<option value="' + m.code + '">' + m.code + '</option>'; }).join("");
    document.getElementById("log-date").value = isoDate(todayLocal());

    document.getElementById("log-add").addEventListener("click", async function () {
      var module = sel.value;
      var date = document.getElementById("log-date").value || isoDate(todayLocal());
      var hours = parseFloat(document.getElementById("log-hours").value);
      var topic = document.getElementById("log-topic").value.trim();
      if (!hours || hours <= 0) {
        document.getElementById("log-hours").focus();
        return;
      }
      await api("POST", "/logs", { module: module, date: date, hours: hours, topic: topic });
      document.getElementById("log-hours").value = "";
      document.getElementById("log-topic").value = "";
      await loadState();
      renderAll();
    });

    document.getElementById("log-body").addEventListener("click", async function (e) {
      var btn = e.target.closest('[data-role="del-log"]');
      if (!btn) return;
      var id = btn.closest("tr").dataset.id;
      await api("DELETE", "/logs/" + id);
      await loadState();
      renderAll();
    });
  }

  /* ============ Chart: last 14 days ============ */
  function renderChart() {
    var svg = document.getElementById("chart-svg");
    var today = todayLocal();
    var days = [];
    for (var i = 13; i >= 0; i--) days.push(addDays(today, -i));

    var byDay = {};
    days.forEach(function (d) { byDay[isoDate(d)] = {}; });
    STATE.logs.forEach(function (l) {
      if (byDay[l.date]) byDay[l.date][l.module] = (byDay[l.date][l.module] || 0) + l.hours;
    });

    var maxTotal = 1;
    days.forEach(function (d) {
      var tot = STATE.modules.reduce(function (s, m) { return s + (byDay[isoDate(d)][m.code] || 0); }, 0);
      if (tot > maxTotal) maxTotal = tot;
    });
    maxTotal = Math.ceil(maxTotal);

    var W = 960, H = 220, padL = 30, padB = 24, padT = 10, padR = 10;
    var chartW = W - padL - padR, chartH = H - padT - padB;
    var bw = chartW / days.length;
    var barW = Math.min(28, bw * 0.6);

    var svgns = "http://www.w3.org/2000/svg";
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);

    [0, 0.5, 1].forEach(function (f) {
      var y = padT + chartH * (1 - f);
      var line = document.createElementNS(svgns, "line");
      line.setAttribute("x1", padL); line.setAttribute("x2", W - padR);
      line.setAttribute("y1", y); line.setAttribute("y2", y);
      line.setAttribute("stroke", "var(--gridline)"); line.setAttribute("stroke-width", "1");
      svg.appendChild(line);
      var t = document.createElementNS(svgns, "text");
      t.setAttribute("x", 4); t.setAttribute("y", y + 3);
      t.textContent = (maxTotal * f).toFixed(1) + "h";
      svg.appendChild(t);
    });

    days.forEach(function (d, i) {
      var iso = isoDate(d);
      var x = padL + i * bw + (bw - barW) / 2;
      var yCursor = padT + chartH;
      STATE.modules.forEach(function (m) {
        var h = byDay[iso][m.code] || 0;
        if (h <= 0) return;
        var segH = (h / maxTotal) * chartH;
        yCursor -= segH;
        var rect = document.createElementNS(svgns, "rect");
        rect.setAttribute("class", "bar-seg");
        rect.setAttribute("x", x); rect.setAttribute("y", yCursor);
        rect.setAttribute("width", barW); rect.setAttribute("height", Math.max(0, segH - 1.5));
        rect.setAttribute("fill", "var(--s" + m.slot + ")");
        rect.setAttribute("rx", "2");
        var title = document.createElementNS(svgns, "title");
        title.textContent = m.code + " · " + fmtShort(d) + " · " + h.toFixed(2) + "h";
        rect.appendChild(title);
        svg.appendChild(rect);
      });
      var lbl = document.createElementNS(svgns, "text");
      lbl.setAttribute("x", x + barW / 2); lbl.setAttribute("y", H - 6);
      lbl.setAttribute("text-anchor", "middle");
      lbl.textContent = d.getDate() + "/" + (d.getMonth() + 1);
      svg.appendChild(lbl);
    });

    document.getElementById("chart-legend").innerHTML = STATE.modules.map(function (m) {
      return '<span class="li"><span class="sw" style="background:var(--s' + m.slot + ')"></span>' + m.code + '</span>';
    }).join("");
  }

  /* ============ Orchestration ============ */
  function renderAll() {
    refreshModuleSelects();
    renderTermStatus();
    var attentionCount = renderModules();
    renderNotes();
    renderKPIs(attentionCount);
    renderTimetable();
    renderDeadlines();
    renderPrep();
    renderLogTable();
    renderChart();
  }

  document.addEventListener("DOMContentLoaded", async function () {
    try {
      await loadState();
    } catch (err) {
      document.getElementById("db-note").textContent = "Could not reach the local server — is `npm start` running?";
      console.error(err);
      return;
    }
    document.getElementById("db-note").textContent = "Backed by SQLite — data/study-ledger.db";
    fetch("/api/auth/me").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.username) document.getElementById("whoami").textContent = "Signed in as " + j.username;
    }).catch(function () {});
    initLogForm();
    initLogToggle();
    initNotesDragDrop();
    initClassModal();
    initModuleModal();
    initAssessModal();
    initDeadlineToggle();
    initPrepModal();
    document.getElementById("wk-prev").addEventListener("click", function () { ttWeekOffset--; renderTimetable(); });
    document.getElementById("wk-next").addEventListener("click", function () { ttWeekOffset++; renderTimetable(); });
    document.getElementById("wk-today").addEventListener("click", function () { ttWeekOffset = 0; renderTimetable(); });
    document.getElementById("logout-btn").addEventListener("click", async function () {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login.html";
    });
    renderAll();
  });
})();
