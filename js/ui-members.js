/* ============================================================
   ui-members.js — 회원 등록 / 수정 / 삭제
   ============================================================ */

const Members = (() => {

  let editingId = null;      // null 이면 신규 등록
  let pickedColor = null;
  let filter = '';

  /* ─────────── 목록 ─────────── */

  function render() {
    const list = $('#member-list');
    const all = Store.members();
    const q = filter.trim().toLowerCase();

    const shown = q
      ? all.filter(m => m.name.toLowerCase().includes(q) || m.phone.includes(q))
      : all;

    if (all.length === 0) {
      list.innerHTML = `
        <div class="empty">
          <div class="empty__big">👤</div>
          <div><b>등록된 회원이 없습니다</b></div>
          <div>회원을 등록하고 가능한 시간을 표시하면 시간표를 자동으로 짜 드립니다.</div>
        </div>`;
      return;
    }

    if (shown.length === 0) {
      list.innerHTML = `<div class="empty">검색 결과가 없습니다.</div>`;
      return;
    }

    list.innerHTML = shown.map(card).join('');
  }

  function card(m) {
    const assigned = Store.assignedCount(m.id);
    const inOpen = m.availability.filter(k => {
      const { day, hour } = Store.parseKey(k);
      return Store.isOpen(day, hour);
    }).length;

    const full = assigned >= m.sessionsPerWeek && m.sessionsPerWeek > 0;
    const availTag = inOpen === 0
      ? `<span class="tag tag--warn">가능 시간 없음</span>`
      : `<span class="tag">가능 ${inOpen}칸</span>`;

    const schedTag = m.sessionsPerWeek === 0
      ? `<span class="tag">휴면</span>`
      : `<span class="tag ${full ? 'tag--ok' : 'tag--warn'}">배정 ${assigned}/${m.sessionsPerWeek}</span>`;

    return `
      <article class="member" style="--m-color:${esc(m.color)}">
        <div class="member__top">
          <div class="member__name">${esc(m.name)}</div>
        </div>

        <div class="member__tags">
          ${schedTag}
          ${availTag}
        </div>

        <div class="member__meta">
          <span>주 ${m.sessionsPerWeek}회${m.phone ? ' · ' + esc(m.phone) : ''}</span>
        </div>

        ${m.memo ? `<div class="member__memo">${esc(m.memo)}</div>` : ''}

        <div class="member__actions">
          <button class="btn btn--sm" data-act="avail" data-id="${m.id}">가능 시간</button>
          <button class="btn btn--sm" data-act="edit" data-id="${m.id}">수정</button>
          <button class="btn btn--sm btn--danger" data-act="del" data-id="${m.id}">삭제</button>
        </div>
      </article>`;
  }

  /* ─────────── 등록 / 수정 폼 ─────────── */

  function openForm(id = null) {
    editingId = id;
    const m = id ? Store.findMember(id) : null;

    $('#modal-member-title').textContent = m ? '회원 수정' : '회원 등록';
    $('#f-name').value = m ? m.name : '';
    $('#f-phone').value = m ? m.phone : '';
    $('#f-sessions').value = m ? m.sessionsPerWeek : 2;
    $('#f-memo').value = m ? m.memo : '';

    const used = new Set(Store.members().filter(x => x.id !== id).map(x => x.color));
    pickedColor = m ? m.color : (Store.COLORS.find(c => !used.has(c)) || Store.COLORS[0]);

    renderSwatches();
    $('#modal-member').showModal();
    $('#f-name').focus();
  }

  function renderSwatches() {
    $('#f-color').innerHTML = Store.COLORS.map(c => `
      <button type="button" class="swatch ${c === pickedColor ? 'is-on' : ''}"
              style="background:${c}" data-color="${c}" aria-label="색상 ${c}"></button>
    `).join('');
  }

  function submit(e) {
    if (e.submitter && e.submitter.value !== 'save') return;   // 취소

    const data = {
      name: $('#f-name').value.trim(),
      phone: $('#f-phone').value.trim(),
      sessionsPerWeek: Number($('#f-sessions').value) || 0,
      memo: $('#f-memo').value.trim(),
      color: pickedColor
    };

    if (!data.name) return;

    if (editingId) {
      Store.updateMember(editingId, data);
      toast(`${data.name} 회원 정보를 저장했습니다.`);
    } else {
      const m = Store.addMember(data);
      toast(`${data.name} 회원을 등록했습니다. 가능한 시간을 표시해 주세요.`);
      // 등록 직후 가능 시간을 바로 채우도록 유도한다.
      setTimeout(() => Availability.open(m.id), 260);
    }

    App.refresh();
  }

  function remove(id) {
    const m = Store.findMember(id);
    if (!m) return;
    const n = Store.assignedCount(m.id);
    const extra = n > 0 ? `\n시간표에 배정된 ${n}개 세션도 함께 삭제됩니다.` : '';
    if (!confirm(`'${m.name}' 회원을 삭제할까요?${extra}\n\n되돌릴 수 없습니다.`)) return;

    Store.removeMember(id);
    toast(`${m.name} 회원을 삭제했습니다.`);
    App.refresh();
  }

  /* ─────────── 이벤트 ─────────── */

  function wire() {
    $('#btn-add-member').addEventListener('click', () => openForm());

    $('#member-search').addEventListener('input', (e) => {
      filter = e.target.value;
      render();
    });

    $('#member-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const { act, id } = btn.dataset;
      if (act === 'avail') Availability.open(id);
      else if (act === 'edit') openForm(id);
      else if (act === 'del') remove(id);
    });

    $('#f-color').addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      pickedColor = sw.dataset.color;
      renderSwatches();
    });

    $('#form-member').addEventListener('submit', submit);
  }

  return { render, wire, openForm };
})();
