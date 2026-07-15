/* ============================================================
   ui-settings.js — 운영 시간 · 배정 규칙 · 데이터 관리
   ============================================================ */

const Settings = (() => {

  /* ─────────── 운영 시간 ─────────── */

  function render() {
    const { open, onePerDay, spread } = Store.get().settings;

    $('#openhours').innerHTML = open.map((o, d) => `
      <div class="oh ${o.enabled ? '' : 'is-off'}" data-day="${d}">
        <label class="switch">
          <input type="checkbox" data-field="enabled" ${o.enabled ? 'checked' : ''}>
          <span><b>${Store.DAYS[d]}요일</b></span>
        </label>
        <div class="oh__times">
          <select class="input" data-field="start">${hourOptions(0, 23, o.start)}</select>
          <span>부터</span>
          <select class="input" data-field="end">${hourOptions(1, 24, o.end)}</select>
          <span>까지</span>
        </div>
      </div>`).join('');

    $('#rule-one-per-day').checked = onePerDay;
    $('#rule-spread').checked = spread;
  }

  function hourOptions(from, to, selected) {
    let out = '';
    for (let h = from; h <= to; h++) {
      const label = h === 24 ? '24:00' : Store.label(h);
      out += `<option value="${h}" ${h === selected ? 'selected' : ''}>${label}</option>`;
    }
    return out;
  }

  function onOpenChange(e) {
    const field = e.target.dataset.field;
    if (!field) return;

    const row = e.target.closest('.oh');
    const d = Number(row.dataset.day);
    const cur = Store.get().settings.open[d];

    if (field === 'enabled') {
      Store.setOpen(d, { enabled: e.target.checked });
    } else {
      let start = cur.start, end = cur.end;
      if (field === 'start') start = Number(e.target.value);
      else end = Number(e.target.value);

      // 종료가 시작보다 앞서지 않도록 맞춘다.
      if (end <= start) {
        if (field === 'start') end = Math.min(24, start + 1);
        else start = Math.max(0, end - 1);
        toast('종료 시각은 시작 시각보다 뒤여야 합니다.');
      }
      Store.setOpen(d, { start, end });
    }

    render();
    App.refresh();
  }

  /* ─────────── 데이터 ─────────── */

  function exportFile() {
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

    a.href = url;
    a.download = `pt-스케줄-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('백업 파일을 내려받았습니다.');
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        Store.importJSON(reader.result);
        render();
        Timetable.clearReport();
        App.refresh();
        toast(`불러왔습니다. 회원 ${Store.members().length}명.`);
      } catch (err) {
        console.error(err);
        alert('파일을 읽지 못했습니다. 이 앱에서 내보낸 .json 파일인지 확인해 주세요.');
      }
    };
    reader.readAsText(file);
  }

  function reset() {
    if (!confirm('회원, 가능 시간, 시간표를 모두 지우고 처음 상태로 되돌립니다.\n\n되돌릴 수 없습니다. 계속할까요?')) return;
    if (!confirm('정말 전체 초기화할까요?')) return;

    Store.reset();
    render();
    Timetable.clearReport();
    App.refresh();
    toast('초기화했습니다.');
  }

  /* ─────────── 이벤트 ─────────── */

  function wire() {
    $('#openhours').addEventListener('change', onOpenChange);

    $('#rule-one-per-day').addEventListener('change', (e) => Store.setRule('onePerDay', e.target.checked));
    $('#rule-spread').addEventListener('change', (e) => Store.setRule('spread', e.target.checked));

    $('#btn-export').addEventListener('click', exportFile);
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importFile(file);
      e.target.value = '';
    });
    $('#btn-reset').addEventListener('click', reset);
  }

  return { render, wire };
})();
