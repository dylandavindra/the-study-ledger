(function () {
  "use strict";

  // Baseline SUSS semester structure — no user input needed:
  //   July Semester:    starts 2nd Monday of Aug, ends last Sunday of Oct
  //   January Semester: starts 2nd Monday of Jan, ends last Sunday of Mar
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function nthWeekdayOfMonth(year, monthIndex, weekday, n) {
    var d = new Date(year, monthIndex, 1);
    var count = 0;
    while (d.getMonth() === monthIndex) {
      if (d.getDay() === weekday) {
        count++;
        if (count === n) return new Date(d);
      }
      d.setDate(d.getDate() + 1);
    }
    return null;
  }

  function lastWeekdayOfMonth(year, monthIndex, weekday) {
    var d = new Date(year, monthIndex + 1, 0); // last calendar day of the month
    while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
    return d;
  }

  // Jan Semester = Jan-Mar window, Jul Semester = Aug-Oct window, for a given year.
  function semesterWindows(year) {
    return {
      jan: { kind: "jan", year: year, start: nthWeekdayOfMonth(year, 0, 1, 2), end: lastWeekdayOfMonth(year, 2, 0) },
      jul: { kind: "jul", year: year, start: nthWeekdayOfMonth(year, 7, 1, 2), end: lastWeekdayOfMonth(year, 9, 0) }
    };
  }

  // Which semester "owns" this date — either because it falls inside that
  // semester's window (active: true), or because it's the next one coming
  // up during a gap between semesters (active: false).
  function currentTerm(date) {
    date = date || new Date();
    var y = date.getFullYear();
    var thisYear = semesterWindows(y);

    if (date >= thisYear.jan.start && date <= thisYear.jan.end) return withActive(thisYear.jan, true);
    if (date >= thisYear.jul.start && date <= thisYear.jul.end) return withActive(thisYear.jul, true);
    if (date < thisYear.jan.start) return withActive(thisYear.jan, false);
    if (date > thisYear.jan.end && date < thisYear.jul.start) return withActive(thisYear.jul, false);
    return withActive(semesterWindows(y + 1).jan, false);
  }

  function withActive(term, active) {
    return { kind: term.kind, year: term.year, start: term.start, end: term.end, active: active };
  }

  function labelFor(term) {
    return (term.kind === "jul" ? "JUL" : "JAN") + pad(term.year % 100);
  }

  window.SussTerm = { currentTerm: currentTerm, semesterWindows: semesterWindows, labelFor: labelFor };

  // ---------- Light/dark toggle ----------
  // The stylesheet already defines both palettes (light by default, dark via
  // prefers-color-scheme or an explicit data-theme="dark"). This just adds a
  // manual override that beats the OS setting and remembers your choice.
  function effectiveTheme() {
    var saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.textContent = theme === "dark" ? "🌚" : "🌞";
      btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var label = labelFor(currentTerm(new Date()));
    document.querySelectorAll(".term-eyebrow").forEach(function (el) {
      el.textContent = "SUSS · " + label + " Term";
    });

    applyTheme(effectiveTheme());
    var toggleBtn = document.getElementById("theme-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        applyTheme(effectiveTheme() === "dark" ? "light" : "dark");
      });
    }
  });
})();
