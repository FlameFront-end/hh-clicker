/* ui-clean.js — слой отображения для главной (без изменения логики app.js).
   1) Эмодзи в шапке, табах и на главной → иконки Lucide (lucide-subset.js).
      Неизвестные эмодзи просто убираются. В имени аккаунта и бейдже статуса — убираются.
   2) Новые карточки по умолчанию свёрнуты (через штатный State.compactCards).
   3) Узлы карточки раскладываются по зонам .x-* (только перенос, id/обработчики целы).
   Отключение: убрать <script> ui-clean.js и lucide-subset.js из index.html. */
(function () {
  var ICONS = window.LUCIDE_ICONS || {}, EMAP = window.LUCIDE_EMOJI || {};
  var SCOPES = '#header, #tabs, #panel-main';
  var STRIP_ONLY = '.acc-name, .acc-status-badge, option, select, title';
  var SKIP_TAGS = { TEXTAREA: 1, SCRIPT: 1, STYLE: 1, INPUT: 1, svg: 1, SVG: 1 };
  var E = '[\\u{1F000}-\\u{1FFFF}\\u2600-\\u27BF\\u2B00-\\u2BFF\\u2300-\\u23FF\\u25B6\\u2715\\u2713\\u2716]';
  var RE = new RegExp('(' + E + ')[\\uFE0F\\u200D\\u20E3]*', 'gu');
  var TEST = new RegExp(E, 'u');
  var tpl = document.createElement('template');
  var cache = {};

  function icon(name, tone) {
    var key = name + '|' + tone;
    if (!cache[key]) {
      var body = name === 'dot' ? '<circle cx="12" cy="12" r="6"/>' : (ICONS[name] || '');
      tpl.innerHTML = '<svg class="i i-' + name + (tone ? ' t-' + tone : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
      cache[key] = tpl.content.firstChild;
    }
    return cache[key].cloneNode(true);
  }

  function processText(n) {
    var v = n.nodeValue;
    var p = n.parentElement;
    if (!p) return;
    if (p.closest(STRIP_ONLY)) {
      var s = v.replace(RE, '').replace(/^\s+/, '');
      if (p.closest('.acc-name')) s = s.replace(/\s*\(\s*\)/, '');
      if (s !== v) n.nodeValue = s;
      return;
    }
    var frag = document.createDocumentFragment(), last = 0, m;
    RE.lastIndex = 0;
    while ((m = RE.exec(v))) {
      if (m.index > last) frag.appendChild(document.createTextNode(v.slice(last, m.index)));
      var hit = EMAP[m[1]];
      if (hit) frag.appendChild(icon(hit[0], hit[1]));
      last = RE.lastIndex;
    }
    if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
    p.replaceChild(frag, n);
  }

  function iconize() {
    document.querySelectorAll(SCOPES).forEach(function (root) {
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentNode;
          if (!p || SKIP_TAGS[p.nodeName] || (p.closest && p.closest('svg'))) return NodeFilter.FILTER_REJECT;
          return TEST.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      });
      var list = [], n;
      while ((n = w.nextNode())) list.push(n);
      list.forEach(processText);
    });
  }

  // ── Свёрнуто по умолчанию ──
  var seen = {};
  function seed() {
    if (typeof State === 'undefined' || !State.compactCards) return;
    document.querySelectorAll('.acc-card[id^="card-"]').forEach(function (c) {
      var idx = Number(c.id.slice(5));
      if (isNaN(idx) || seen[idx]) return;
      seen[idx] = true;
      State.compactCards.add(idx);
      c.classList.add('compact');
    });
  }

  // ── Зоны карточки ──
  //   .x-top     — шапка + кнопки действий
  //   .x-main    — плашки статов | .x-now (текущая вакансия, мета)
  //   .x-alerts  — капча, ошибки, протухшие куки, диагностика
  //   .x-details — .x-activity (HH-цифры, LLM, лог) | .x-settings (чекбоксы, секции)
  var ZONES = [
    ['top', '.acc-header, .acc-actions'],
    ['main', '.acc-stats'],
    ['now', '.acc-vacancy, .acc-meta, [id^="acc-last-apply-"], [id^="acc-limit-eta-"]'],
    ['alerts', '[id^="acc-captcha-"], [id^="acc-errbadge-"], [id^="acc-cookiesbadge-"], [id^="acc-diagbadge-"]'],
    ['activity', '.acc-hh-stats, [id^="acc-llm-status-"], .acc-resume-stats, .acc-history, .acc-event-log'],
    ['settings', '*']
  ];
  function zoneEl(card, name) {
    var z = card.querySelector('.x-' + name);
    if (z) return z;
    z = document.createElement('div');
    z.className = 'x-' + name;
    return z;
  }
  function layout() {
    document.querySelectorAll('.acc-card').forEach(function (card) {
      var stray = [];
      for (var i = 0; i < card.children.length; i++) {
        var ch = card.children[i];
        if (ch.className && /(^|\s)(x-[a-z]+|acc-progress)(\s|$)/.test(ch.className)) continue;
        stray.push(ch);
      }
      if (!stray.length) return;
      var z = {};
      ZONES.forEach(function (p) { z[p[0]] = zoneEl(card, p[0]); });
      if (!z.top.parentNode) card.appendChild(z.top);
      if (!z.main.parentNode) card.appendChild(z.main);
      if (!z.now.parentNode) z.main.appendChild(z.now);
      if (!z.alerts.parentNode) card.appendChild(z.alerts);
      var det = card.querySelector('.x-details');
      if (!det) { det = document.createElement('div'); det.className = 'x-details'; card.appendChild(det); }
      if (!z.activity.parentNode) det.appendChild(z.activity);
      if (!z.settings.parentNode) det.appendChild(z.settings);
      stray.forEach(function (ch) {
        for (var k = 0; k < ZONES.length; k++) {
          if (ch.matches(ZONES[k][1])) {
            if (ZONES[k][0] === 'main') z.main.insertBefore(ch, z.now);
            else z[ZONES[k][0]].appendChild(ch);
            return;
          }
        }
      });
    });
  }

  function titles() {
    document.querySelectorAll('.acc-name').forEach(function (e) { if (e.title !== e.textContent) e.title = e.textContent; });
  }

  var queued = false;
  function run() {
    queued = false;
    seed();
    layout();
    iconize();
    titles();
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(run); } }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  document.addEventListener('DOMContentLoaded', schedule);
  schedule();
})();
