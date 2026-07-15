/* ============================================================
   store.js — 데이터 모델 + localStorage 저장소
   ============================================================ */

const Store = (() => {
  const KEY = 'pt-scheduler:v1';

  const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

  const COLORS = [
    '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed',
    '#db2777', '#0891b2', '#65a30d', '#ea580c', '#4f46e5',
    '#be123c', '#0d9488'
  ];

  /** 슬롯 키: "요일-시" (예: 월요일 14시 → "0-14") */
  const key = (day, hour) => `${day}-${hour}`;

  const parseKey = (k) => {
    const [d, h] = k.split('-');
    return { day: +d, hour: +h };
  };

  const label = (hour) => `${String(hour).padStart(2, '0')}:00`;

  const range = (hour) => `${label(hour)}~${label((hour + 1) % 24)}`;

  function defaultState() {
    return {
      version: 1,
      settings: {
        open: DAYS.map((_, d) => ({
          enabled: d < 6,           // 일요일 기본 휴무
          start: 6,
          end: 22                   // 종료 시각 = 마지막 슬롯의 끝 (22시면 21~22시가 마지막)
        })),
        onePerDay: true,
        spread: true
      },
      members: [],
      schedule: {}                  // slotKey → { memberId, locked }
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('저장된 데이터를 읽지 못해 초기 상태로 시작합니다.', e);
      return defaultState();
    }
  }

  /** 저장본이 오래됐거나 손상됐을 때 기본값으로 메워 형태를 보장한다. */
  function migrate(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;

    const s = raw.settings || {};
    const open = Array.isArray(s.open) && s.open.length === 7 ? s.open : base.settings.open;

    return {
      version: 1,
      settings: {
        open: open.map((o, d) => ({
          enabled: typeof o?.enabled === 'boolean' ? o.enabled : base.settings.open[d].enabled,
          start: clampHour(o?.start, 6),
          end: clampHour(o?.end, 22, 24)
        })),
        onePerDay: s.onePerDay !== false,
        spread: s.spread !== false
      },
      members: Array.isArray(raw.members) ? raw.members.map(normalizeMember).filter(Boolean) : [],
      schedule: normalizeSchedule(raw.schedule)
    };
  }

  function clampHour(v, fallback, max = 23) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > max) return fallback;
    return n;
  }

  function normalizeMember(m, i) {
    if (!m || typeof m !== 'object' || !m.name) return null;
    return {
      id: String(m.id || uid()),
      name: String(m.name).slice(0, 20),
      phone: String(m.phone || '').slice(0, 20),
      sessionsPerWeek: clampHour(m.sessionsPerWeek, 2, 14),
      color: COLORS.includes(m.color) ? m.color : COLORS[i % COLORS.length],
      memo: String(m.memo || '').slice(0, 200),
      availability: Array.isArray(m.availability)
        ? [...new Set(m.availability.filter(isValidKey))]
        : []
    };
  }

  function isValidKey(k) {
    if (typeof k !== 'string') return false;
    const { day, hour } = parseKey(k);
    return Number.isInteger(day) && day >= 0 && day <= 6 &&
           Number.isInteger(hour) && hour >= 0 && hour <= 23;
  }

  function normalizeSchedule(sched) {
    const out = {};
    if (!sched || typeof sched !== 'object') return out;
    for (const [k, v] of Object.entries(sched)) {
      if (!isValidKey(k) || !v || !v.memberId) continue;
      out[k] = { memberId: String(v.memberId), locked: !!v.locked };
    }
    return out;
  }

  function uid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  let saveTimer = null;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        console.error('저장 실패', e);
        alert('저장에 실패했습니다. 브라우저 저장 공간이 가득 찼거나 시크릿 모드일 수 있습니다.');
      }
    }, 120);
  }

  /* ─────────── 조회 ─────────── */

  const get = () => state;
  const members = () => state.members;
  const findMember = (id) => state.members.find(m => m.id === id) || null;

  /** 해당 슬롯이 트레이너 운영 시간 안인가 */
  function isOpen(day, hour) {
    const o = state.settings.open[day];
    return !!o.enabled && hour >= o.start && hour < o.end;
  }

  /** 운영 중인 전체 슬롯 수 */
  function openSlotCount() {
    return state.settings.open.reduce(
      (sum, o) => sum + (o.enabled ? Math.max(0, o.end - o.start) : 0), 0
    );
  }

  /* ─────────── 회원 변경 ─────────── */

  function addMember(data) {
    const used = new Set(state.members.map(m => m.color));
    const color = data.color || COLORS.find(c => !used.has(c)) || COLORS[state.members.length % COLORS.length];
    const m = normalizeMember({ ...data, id: uid(), color, availability: [] }, state.members.length);
    state.members.push(m);
    save();
    return m;
  }

  function updateMember(id, patch) {
    const m = findMember(id);
    if (!m) return null;
    Object.assign(m, normalizeMember({ ...m, ...patch }, 0));
    save();
    return m;
  }

  function removeMember(id) {
    state.members = state.members.filter(m => m.id !== id);
    for (const [k, v] of Object.entries(state.schedule)) {
      if (v.memberId === id) delete state.schedule[k];
    }
    save();
  }

  function setAvailability(id, keys) {
    const m = findMember(id);
    if (!m) return;
    m.availability = [...new Set(keys.filter(isValidKey))];
    save();
  }

  /* ─────────── 시간표 변경 ─────────── */

  function assign(slotKey, memberId, locked = false) {
    if (!isValidKey(slotKey)) return;
    state.schedule[slotKey] = { memberId, locked };
    save();
  }

  function unassign(slotKey) {
    delete state.schedule[slotKey];
    save();
  }

  function toggleLock(slotKey) {
    const s = state.schedule[slotKey];
    if (!s) return;
    s.locked = !s.locked;
    save();
  }

  function move(fromKey, toKey) {
    const s = state.schedule[fromKey];
    if (!s || fromKey === toKey) return;
    const target = state.schedule[toKey];
    if (target) {
      // 두 세션 자리 맞바꾸기
      state.schedule[fromKey] = target;
      state.schedule[toKey] = s;
    } else {
      delete state.schedule[fromKey];
      state.schedule[toKey] = s;
    }
    save();
  }

  /** 고정되지 않은 배정을 모두 지운다. */
  function clearUnlocked() {
    for (const [k, v] of Object.entries(state.schedule)) {
      if (!v.locked) delete state.schedule[k];
    }
    save();
  }

  function replaceSchedule(next) {
    state.schedule = next;
    save();
  }

  /* ─────────── 설정 ─────────── */

  function setOpen(day, patch) {
    Object.assign(state.settings.open[day], patch);
    save();
  }

  function setRule(name, value) {
    state.settings[name] = value;
    save();
  }

  /* ─────────── 통계 ─────────── */

  /** 회원별 배정된 세션 수 */
  function assignedCount(memberId) {
    return Object.values(state.schedule).filter(s => s.memberId === memberId).length;
  }

  /* ─────────── 내보내기 / 불러오기 ─────────── */

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    state = migrate(parsed);
    save();
    return state;
  }

  function reset() {
    state = defaultState();
    save();
  }

  return {
    DAYS, COLORS, key, parseKey, label, range,
    get, members, findMember, isOpen, openSlotCount,
    addMember, updateMember, removeMember, setAvailability,
    assign, unassign, toggleLock, move, clearUnlocked, replaceSchedule,
    setOpen, setRule, assignedCount,
    exportJSON, importJSON, reset
  };
})();
