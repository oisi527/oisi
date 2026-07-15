/* ============================================================
   ui-availability.js — 회원별 가능 시간 그리드 (드래그로 칠하기)
   ============================================================ */

const Availability = (() => {

  let memberId = null;
  let current = new Set();     // 편집 중인 슬롯 키
  let painting = false;
  let paintMode = true;        // true = 칠하기, false = 지우기

  /* ─────────── 열기 / 닫기 ─────────── */

  function open(id) {
    const m = Store.findMember(id);
    if (!m) return;

    memberId = id;
    current = new Set(m.availability);

    $('#avail-name').textContent = m.name;
    renderGrid();
    updateCount();
    closeCopyMenu();
    $('#modal-avail').showModal();
  }

  function close() {
    commit();
    $('#modal-avail').close();
    memberId = null;
    App.refresh();
  }

  function commit() {
    if (!memberId) return;
    Store.setAvailability(memberId, [...current]);
  }

  /* ─────────── 그리드 ─────────── */

  function renderGrid() {
    const grid = $('#avail-grid');
    const html = [headerRow()];

    for (let h = 0; h < 24; h++) {
      html.push(`<div class="gtime ${h === 12 ? 'gtime--noon' : ''}">${Store.label(h)}</div>`);
      for (let d = 0; d < 7; d++) {
        const k = Store.key(d, h);
        const cls = [
          'gcell', 'acell',
          Store.isOpen(d, h) ? '' : 'acell--closed',
          current.has(k) ? 'is-on' : ''
        ].filter(Boolean).join(' ');
        html.push(`<div class="${cls}" data-k="${k}" title="${Store.DAYS[d]} ${Store.range(h)}"></div>`);
      }
    }

    grid.innerHTML = html.join('');
  }

  function headerRow() {
    const cells = ['<div class="ghead ghead--corner"></div>'];
    for (let d = 0; d < 7; d++) {
      const tone = d === 5 ? 'ghead--sat' : d === 6 ? 'ghead--sun' : '';
      cells.push(`<div class="ghead ${tone}">${Store.DAYS[d]}</div>`);
    }
    return cells.join('');
  }

  function updateCount() {
    const inOpen = [...current].filter(k => {
      const { day, hour } = Store.parseKey(k);
      return Store.isOpen(day, hour);
    }).length;

    const el = $('#avail-count');
    el.textContent = current.size === inOpen
      ? `${current.size}칸`
      : `${current.size}칸 (운영시간 내 ${inOpen}칸)`;
  }

  function paint(cell) {
    const k = cell.dataset.k;
    if (!k) return;
    if (paintMode === current.has(k)) return;   // 이미 원하는 상태

    if (paintMode) { current.add(k); cell.classList.add('is-on'); }
    else { current.delete(k); cell.classList.remove('is-on'); }

    updateCount();
  }

  /* ─────────── 일괄 조작 ─────────── */

  function fillOpen() {
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (Store.isOpen(d, h)) current.add(Store.key(d, h));
      }
    }
    renderGrid();
    updateCount();
    commit();
  }

  function clearAll() {
    current.clear();
    renderGrid();
    updateCount();
    commit();
  }

  /* ─────────── 다른 회원에서 복사 ─────────── */

  let menuEl = null;

  function toggleCopyMenu() {
    if (menuEl) { closeCopyMenu(); return; }

    const others = Store.members().filter(m => m.id !== memberId && m.availability.length > 0);
    if (others.length === 0) {
      toast('가능 시간이 등록된 다른 회원이 없습니다.');
      return;
    }

    const btn = $('#btn-avail-copy');
    menuEl = document.createElement('div');
    menuEl.className = 'copy-menu';
    menuEl.innerHTML = others.map(m => `
      <button type="button" class="pop-item" data-id="${m.id}">
        <span class="pop-item__dot" style="background:${esc(m.color)}"></span>
        <span class="pop-item__name">${esc(m.name)}</span>
        <span class="pop-item__note">${m.availability.length}칸</span>
      </button>`).join('');

    menuEl.addEventListener('click', (e) => {
      const item = e.target.closest('.pop-item');
      if (!item) return;
      const src = Store.findMember(item.dataset.id);
      if (src) {
        current = new Set(src.availability);
        renderGrid();
        updateCount();
        commit();
        toast(`${src.name} 회원의 가능 시간을 복사했습니다.`);
      }
      closeCopyMenu();
    });

    $('#modal-avail .modal__box').appendChild(menuEl);
    menuEl.style.left = btn.offsetLeft + 'px';
    menuEl.style.top = (btn.offsetTop + btn.offsetHeight + 4) + 'px';
  }

  function closeCopyMenu() {
    menuEl?.remove();
    menuEl = null;
  }

  /* ─────────── 이벤트 ─────────── */

  function wire() {
    const grid = $('#avail-grid');

    grid.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.acell');
      if (!cell) return;
      e.preventDefault();
      painting = true;
      paintMode = !current.has(cell.dataset.k);
      paint(cell);
      grid.setPointerCapture(e.pointerId);
    });

    grid.addEventListener('pointermove', (e) => {
      if (!painting) return;
      // 포인터를 캡처했으므로 실제로 지나는 셀은 좌표로 찾는다.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest?.('.acell');
      if (cell) paint(cell);
    });

    const stop = () => {
      if (!painting) return;
      painting = false;
      commit();
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);

    $('#btn-avail-all').addEventListener('click', fillOpen);
    $('#btn-avail-none').addEventListener('click', clearAll);
    $('#btn-avail-copy').addEventListener('click', toggleCopyMenu);
    $('#btn-avail-close').addEventListener('click', close);

    // 모달 바깥(백드롭) 클릭 또는 ESC
    $('#modal-avail').addEventListener('click', (e) => {
      if (e.target.id === 'modal-avail') close();
      else if (menuEl && !e.target.closest('.copy-menu') && !e.target.closest('#btn-avail-copy')) closeCopyMenu();
    });

    $('#modal-avail').addEventListener('cancel', (e) => {
      e.preventDefault();
      close();
    });
  }

  return { open, wire, renderGrid };
})();
