/* ============================================================
   ui-timetable.js — 주간 시간표: 자동 배정 · 수동 편집 · 드래그 이동
   ============================================================ */

const Timetable = (() => {

  const COMPACT_KEY = 'pt-scheduler:compact';

  let compact = localStorage.getItem(COMPACT_KEY) === '1';
  let lastReport = null;
  let popoverKey = null;

  /* ─────────── 표시할 시간대 ─────────── */

  function visibleHours() {
    const all = Array.from({ length: 24 }, (_, h) => h);
    if (!compact) return all;

    const on = Store.get().settings.open.filter(o => o.enabled && o.end > o.start);
    if (on.length === 0) return all;

    const lo = Math.min(...on.map(o => o.start));
    const hi = Math.max(...on.map(o => o.end));
    return all.slice(lo, hi);
  }

  /* ─────────── 그리기 ─────────── */

  function render() {
    renderGrid();
    renderStats();
    renderLegend();
    renderReport();
  }

  function renderGrid() {
    const state = Store.get();
    const grid = $('#timetable');
    const hours = visibleHours();

    // 슬롯별 후보 회원 수 (빈 칸에 흐리게 표시)
    const demand = new Map();
    for (const m of state.members) {
      if (m.sessionsPerWeek === 0) continue;
      for (const k of m.availability) demand.set(k, (demand.get(k) || 0) + 1);
    }

    const perDay = Array(7).fill(0);
    for (const k of Object.keys(state.schedule)) perDay[Store.parseKey(k).day]++;

    const html = ['<div class="ghead ghead--corner"></div>'];
    for (let d = 0; d < 7; d++) {
      const tone = d === 5 ? 'ghead--sat' : d === 6 ? 'ghead--sun' : '';
      const off = !state.settings.open[d].enabled;
      html.push(`
        <div class="ghead ${tone}">${Store.DAYS[d]}
          <small>${off ? '휴무' : perDay[d] + '건'}</small>
        </div>`);
    }

    for (const h of hours) {
      html.push(`<div class="gtime ${h === 12 ? 'gtime--noon' : ''}">${Store.label(h)}</div>`);

      for (let d = 0; d < 7; d++) {
        const k = Store.key(d, h);
        const open = Store.isOpen(d, h);
        const sess = state.schedule[k];

        if (sess) {
          const m = Store.findMember(sess.memberId);
          if (!m) { html.push(emptyCell(k, open, 0)); continue; }
          const fg = readableOn(m.color);
          html.push(`
            <div class="gcell slot ${open ? '' : 'slot--closed'}" data-k="${k}">
              <div class="sess" data-k="${k}" style="background:${esc(m.color)};color:${fg}"
                   title="${Store.DAYS[d]} ${Store.range(h)} · ${esc(m.name)}${sess.locked ? ' (고정)' : ''}">
                <span class="sess__name">${esc(m.name)}</span>
                ${sess.locked ? '<span class="sess__lock">🔒</span>' : ''}
              </div>
            </div>`);
        } else {
          html.push(emptyCell(k, open, open ? (demand.get(k) || 0) : 0));
        }
      }
    }

    grid.innerHTML = html.join('');
  }

  function emptyCell(k, open, free) {
    const cls = ['gcell', 'slot', open ? '' : 'slot--closed', free > 0 ? 'slot--free-count' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-k="${k}" ${free > 0 ? `data-free="${free}"` : ''}></div>`;
  }

  function renderStats() {
    const state = Store.get();
    const assigned = Object.keys(state.schedule).length;
    const wanted = state.members.reduce((s, m) => s + m.sessionsPerWeek, 0);
    const locked = Object.values(state.schedule).filter(s => s.locked).length;

    const short = state.members.filter(
      m => m.sessionsPerWeek > 0 && Store.assignedCount(m.id) < m.sessionsPerWeek
    ).length;

    const cards = [
      ['회원', state.members.length + '명', ''],
      ['배정 / 목표', `${assigned} / ${wanted}`, assigned === wanted && wanted > 0 ? 'stat--ok' : ''],
      ['미달 회원', short + '명', short > 0 ? 'stat--warn' : 'stat--ok'],
      ['고정 세션', locked + '건', ''],
      ['운영 슬롯', Store.openSlotCount() + '칸', '']
    ];

    $('#stats').innerHTML = cards.map(([label, value, cls]) => `
      <div class="stat ${cls}">
        <div class="stat__label">${label}</div>
        <div class="stat__value">${value}</div>
      </div>`).join('');
  }

  function renderLegend() {
    const members = Store.members();
    $('#legend').innerHTML = members.map(m => {
      const n = Store.assignedCount(m.id);
      const short = m.sessionsPerWeek > 0 && n < m.sessionsPerWeek;
      return `
        <span class="legend__item">
          <span class="legend__dot" style="background:${esc(m.color)}"></span>
          ${esc(m.name)}
          <span class="legend__n ${short ? 'is-short' : ''}">${n}/${m.sessionsPerWeek}</span>
        </span>`;
    }).join('');
  }

  function renderReport() {
    const box = $('#schedule-report');
    if (!lastReport) { box.innerHTML = ''; return; }

    const { assigned, wanted, shortfalls } = lastReport;

    if (shortfalls.length === 0) {
      box.innerHTML = `
        <div class="banner banner--ok">
          ✅ <b>${assigned}건</b>을 모두 배정했습니다. 모든 회원이 원하는 횟수를 채웠습니다.
        </div>`;
      return;
    }

    box.innerHTML = `
      <div class="banner banner--warn">
        ⚠️ <b>${assigned} / ${wanted}건</b> 배정됨 — 아래 회원은 횟수를 다 채우지 못했습니다.
        <ul>
          ${shortfalls.map(s => `<li><b>${esc(s.name)}</b> ${s.got}/${s.need}회 — ${esc(s.reason)}</li>`).join('')}
        </ul>
      </div>`;
  }

  /* ─────────── 자동 배정 ─────────── */

  function autoRun() {
    const state = Store.get();

    if (state.members.length === 0) {
      toast('먼저 회원을 등록해 주세요.');
      return;
    }
    if (Store.openSlotCount() === 0) {
      toast('설정에서 운영 시간을 먼저 지정해 주세요.');
      return;
    }

    const lockedCount = Object.values(state.schedule).filter(s => s.locked).length;
    const others = Object.keys(state.schedule).length - lockedCount;

    if (others > 0 && !confirm(
      `자동 배정을 실행하면 고정(🔒)하지 않은 기존 배정 ${others}건이 새로 계산됩니다.\n` +
      `고정한 ${lockedCount}건은 그대로 유지됩니다.\n\n계속할까요?`
    )) return;

    const { schedule, report } = Scheduler.run(state);
    Store.replaceSchedule(schedule);
    lastReport = report;

    render();
    toast(report.shortfalls.length === 0
      ? `${report.assigned}건을 모두 배정했습니다.`
      : `${report.assigned}건 배정 · ${report.shortfalls.length}명 미달`);
  }

  function clearUnlocked() {
    const n = Object.values(Store.get().schedule).filter(s => !s.locked).length;
    if (n === 0) { toast('지울 배정이 없습니다.'); return; }
    if (!confirm(`고정하지 않은 배정 ${n}건을 모두 지울까요?`)) return;

    Store.clearUnlocked();
    lastReport = null;
    render();
    toast(`${n}건을 지웠습니다.`);
  }

  /* ─────────── 팝오버 (셀 클릭) ─────────── */

  function openPopover(cell) {
    const k = cell.dataset.k;
    if (popoverKey === k && !$('#popover').hidden) { closePopover(); return; }

    const { day, hour } = Store.parseKey(k);
    const state = Store.get();
    const sess = state.schedule[k];

    popoverKey = k;

    const pop = $('#popover');
    $('#popover-head').textContent =
      `${Store.DAYS[day]}요일 ${Store.range(hour)}` + (Store.isOpen(day, hour) ? '' : ' · 운영시간 외');

    const rows = [];

    if (sess) {
      rows.push(`
        <button class="pop-item" data-act="lock">
          <span>${sess.locked ? '🔓' : '🔒'}</span>
          <span class="pop-item__name">${sess.locked ? '고정 해제' : '고정하기'}</span>
        </button>
        <button class="pop-item pop-item--danger" data-act="clear">
          <span>✕</span><span class="pop-item__name">배정 취소</span>
        </button>
        <div class="pop-sep"></div>`);
    }

    const members = state.members;
    if (members.length === 0) {
      rows.push(`<div class="pop-item" style="color:var(--text-3)">등록된 회원이 없습니다</div>`);
    } else {
      // 이 시간에 가능한 회원을 위로 올린다.
      const sorted = [...members].sort((a, b) => {
        const av = b.availability.includes(k) - a.availability.includes(k);
        return av || a.name.localeCompare(b.name, 'ko');
      });

      for (const m of sorted) {
        const can = m.availability.includes(k);
        const isNow = sess && sess.memberId === m.id;
        const n = Store.assignedCount(m.id);
        const note = isNow ? '배정됨' : can ? `${n}/${m.sessionsPerWeek}` : '가능시간 외';
        rows.push(`
          <button class="pop-item" data-act="assign" data-id="${m.id}" ${isNow ? 'disabled' : ''}>
            <span class="pop-item__dot" style="background:${esc(m.color)}"></span>
            <span class="pop-item__name">${esc(m.name)}</span>
            <span class="pop-item__note">${note}</span>
          </button>`);
      }
    }

    $('#popover-list').innerHTML = rows.join('');
    pop.hidden = false;

    // 화면 안으로 위치 보정
    const r = cell.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.left + window.scrollX;
    let top = r.bottom + window.scrollY + 4;

    if (left + pw > window.scrollX + document.documentElement.clientWidth - 8) {
      left = window.scrollX + document.documentElement.clientWidth - pw - 8;
    }
    if (r.bottom + ph + 8 > document.documentElement.clientHeight) {
      top = r.top + window.scrollY - ph - 4;
    }

    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  function closePopover() {
    $('#popover').hidden = true;
    popoverKey = null;
  }

  function onPopoverClick(e) {
    const item = e.target.closest('.pop-item[data-act]');
    if (!item || !popoverKey) return;

    const k = popoverKey;
    const { act, id } = item.dataset;

    if (act === 'lock') {
      Store.toggleLock(k);
    } else if (act === 'clear') {
      Store.unassign(k);
    } else if (act === 'assign') {
      const m = Store.findMember(id);
      const { day, hour } = Store.parseKey(k);
      if (!Store.isOpen(day, hour)) toast('운영 시간 밖이지만 그대로 배정했습니다.');
      else if (m && !m.availability.includes(k)) toast(`${m.name} 회원의 가능 시간이 아니지만 그대로 배정했습니다.`);
      // 수동 배정은 자동 배정에 지워지지 않도록 고정해 둔다.
      Store.assign(k, id, true);
    }

    closePopover();
    lastReport = null;
    render();
  }

  /* ─────────── 드래그로 이동 ─────────── */

  let drag = null;   // { fromKey, ghost, startX, startY, active }

  function onPointerDown(e) {
    const sess = e.target.closest('.sess');
    if (!sess || e.button === 2) return;

    drag = {
      fromKey: sess.dataset.k,
      el: sess,
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      active: false
    };
    $('#timetable').setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!drag) return;

    if (!drag.active) {
      const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (moved < 6) return;      // 아직은 클릭으로 본다
      startDrag(e);
    }

    drag.ghost.style.left = (e.clientX + 8) + 'px';
    drag.ghost.style.top = (e.clientY + 8) + 'px';

    $$('.slot.is-drop').forEach(el => el.classList.remove('is-drop'));
    const cell = targetCell(e);
    if (cell && cell.dataset.k !== drag.fromKey) cell.classList.add('is-drop');
  }

  function startDrag(e) {
    drag.active = true;
    drag.el.classList.add('is-dragging');

    const ghost = drag.el.cloneNode(true);
    ghost.classList.remove('is-dragging');
    Object.assign(ghost.style, {
      position: 'fixed',
      inset: 'auto',
      width: drag.el.offsetWidth + 'px',
      height: drag.el.offsetHeight + 'px',
      pointerEvents: 'none',
      opacity: '.9',
      zIndex: '200',
      left: (e.clientX + 8) + 'px',
      top: (e.clientY + 8) + 'px'
    });
    document.body.appendChild(ghost);
    drag.ghost = ghost;
  }

  function targetCell(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el?.closest?.('.gcell[data-k]') || null;
  }

  function onPointerUp(e) {
    if (!drag) return;

    const wasActive = drag.active;
    const fromKey = drag.fromKey;

    drag.ghost?.remove();
    drag.el.classList.remove('is-dragging');
    $$('.slot.is-drop').forEach(el => el.classList.remove('is-drop'));
    drag = null;

    if (!wasActive) {                       // 움직이지 않았으면 클릭 처리
      const cell = e.target.closest('.gcell[data-k]');
      if (cell) openPopover(cell);
      return;
    }

    const cell = targetCell(e);
    if (!cell) return;

    const toKey = cell.dataset.k;
    if (toKey === fromKey) return;

    const { day, hour } = Store.parseKey(toKey);
    const sess = Store.get().schedule[fromKey];
    const m = sess && Store.findMember(sess.memberId);

    if (!Store.isOpen(day, hour)) {
      if (!confirm(`${Store.DAYS[day]}요일 ${Store.range(hour)}는 운영 시간이 아닙니다.\n그래도 옮길까요?`)) return;
    } else if (m && !m.availability.includes(toKey)) {
      if (!confirm(`${m.name} 회원의 가능 시간이 아닙니다.\n그래도 옮길까요?`)) return;
    }

    Store.move(fromKey, toKey);
    lastReport = null;
    render();
    toast(`${Store.DAYS[day]} ${Store.range(hour)}로 옮겼습니다.`);
  }

  /* ─────────── 이벤트 ─────────── */

  function wire() {
    const grid = $('#timetable');

    grid.addEventListener('pointerdown', onPointerDown);
    grid.addEventListener('pointermove', onPointerMove);
    grid.addEventListener('pointerup', onPointerUp);
    grid.addEventListener('pointercancel', () => {
      drag?.ghost?.remove();
      drag?.el.classList.remove('is-dragging');
      drag = null;
    });

    // 세션이 없는 빈 칸 클릭
    grid.addEventListener('click', (e) => {
      if (e.target.closest('.sess')) return;    // 세션은 pointerup 에서 처리
      const cell = e.target.closest('.gcell[data-k]');
      if (cell) openPopover(cell);
    });

    $('#popover').addEventListener('click', onPopoverClick);

    document.addEventListener('pointerdown', (e) => {
      if (!$('#popover').hidden && !e.target.closest('#popover') && !e.target.closest('.gcell')) {
        closePopover();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePopover();
    });

    window.addEventListener('scroll', closePopover, { passive: true });
    $('.grid-scroll').addEventListener('scroll', closePopover, { passive: true });

    $('#btn-auto').addEventListener('click', autoRun);
    $('#btn-clear-unlocked').addEventListener('click', clearUnlocked);
    $('#btn-print').addEventListener('click', () => window.print());

    const chk = $('#chk-compact');
    chk.checked = compact;
    chk.addEventListener('change', () => {
      compact = chk.checked;
      localStorage.setItem(COMPACT_KEY, compact ? '1' : '0');
      renderGrid();
    });
  }

  return { render, wire, clearReport: () => { lastReport = null; } };
})();
