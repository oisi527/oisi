/* ============================================================
   app.js — 탭 전환 · 초기화
   ============================================================ */

const App = (() => {

  function switchTab(name) {
    $$('.tab').forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    $$('.panel').forEach(p => p.classList.toggle('is-active', p.id === `panel-${name}`));

    if (name === 'timetable') Timetable.render();
    else if (name === 'members') Members.render();
    else if (name === 'settings') Settings.render();
  }

  /** 데이터가 바뀐 뒤 화면 전체를 다시 그린다. */
  function refresh() {
    Timetable.render();
    Members.render();
  }

  function firstRun() {
    if (Store.members().length > 0) return;
    // 처음 켰을 때는 회원 탭이 할 일에 더 가깝다.
    switchTab('members');
  }

  function init() {
    Members.wire();
    Availability.wire();
    Timetable.wire();
    Settings.wire();

    $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    Settings.render();
    refresh();
    firstRun();
  }

  return { init, refresh, switchTab };
})();

document.addEventListener('DOMContentLoaded', App.init);
