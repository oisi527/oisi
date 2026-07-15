/* ============================================================
   scheduler.js — PT 시간표 자동 배정 엔진

   배정 문제를 최소비용 최대유량(min-cost max-flow)으로 푼다.

       출발 ──(주당 횟수)──▶ 회원 ──(하루 제한)──▶ 회원·요일 ──▶ 슬롯 ──(1명)──▶ 도착

   최대유량이므로 "배정 가능한 세션 수의 최대치"가 수학적으로 보장되고,
   최소비용이므로 그 안에서 분산·경합 선호도가 가장 좋은 조합이 선택된다.
   ============================================================ */

const Scheduler = (() => {

  const SPREAD_PENALTY = 200;   // 같은 요일에 세션이 겹칠 때마다 더해지는 비용
  const DEMAND_WEIGHT = 1;      // 경합이 심한 슬롯을 피하는 정도 (LCV)

  /* ─────────── 최소비용 최대유량 ─────────── */

  class MinCostFlow {
    constructor(n) {
      this.n = n;
      this.graph = Array.from({ length: n }, () => []);
      this.edges = [];
    }

    /** u→v 로 용량 cap, 단위비용 cost 인 간선을 추가하고 간선 id를 돌려준다. */
    addEdge(u, v, cap, cost) {
      const id = this.edges.length;
      this.graph[u].push(id);
      this.edges.push({ to: v, cap, cost, orig: cap });
      this.graph[v].push(id + 1);
      this.edges.push({ to: u, cap: 0, cost: -cost, orig: 0 });
      return id;
    }

    /** 간선에 실제로 흐른 유량 */
    flowOf(id) {
      return this.edges[id].orig - this.edges[id].cap;
    }

    run(source, sink) {
      const { n, edges, graph } = this;
      let totalFlow = 0;
      let totalCost = 0;

      for (;;) {
        // SPFA — 음수 비용(역방향 간선)이 있으므로 벨만-포드 계열을 쓴다.
        const dist = new Array(n).fill(Infinity);
        const inQueue = new Array(n).fill(false);
        const prevEdge = new Array(n).fill(-1);

        dist[source] = 0;
        const queue = [source];
        inQueue[source] = true;

        while (queue.length) {
          const u = queue.shift();
          inQueue[u] = false;
          for (const id of graph[u]) {
            const e = edges[id];
            if (e.cap <= 0) continue;
            const nd = dist[u] + e.cost;
            if (nd < dist[e.to] - 1e-9) {
              dist[e.to] = nd;
              prevEdge[e.to] = id;
              if (!inQueue[e.to]) {
                inQueue[e.to] = true;
                queue.push(e.to);
              }
            }
          }
        }

        if (dist[sink] === Infinity) break;   // 더 흘릴 경로가 없음

        // 경로의 병목 용량 찾기
        let push = Infinity;
        for (let v = sink; v !== source; ) {
          const id = prevEdge[v];
          push = Math.min(push, edges[id].cap);
          v = edges[id ^ 1].to;
        }

        // 흘리기
        for (let v = sink; v !== source; ) {
          const id = prevEdge[v];
          edges[id].cap -= push;
          edges[id ^ 1].cap += push;
          v = edges[id ^ 1].to;
        }

        totalFlow += push;
        totalCost += push * dist[sink];
      }

      return { flow: totalFlow, cost: totalCost };
    }
  }

  /* ─────────── 배정 ─────────── */

  /**
   * @param {object} state Store.get() 결과
   * @returns {{schedule: object, report: object}}
   */
  function run(state) {
    const { onePerDay, spread } = state.settings;

    // 1. 운영 중인 슬롯 목록
    const slotKeys = [];
    for (let d = 0; d < 7; d++) {
      const o = state.settings.open[d];
      if (!o.enabled) continue;
      for (let h = o.start; h < o.end; h++) slotKeys.push(Store.key(d, h));
    }

    // 2. 고정된 세션은 그대로 두고, 그 슬롯은 후보에서 제외한다.
    const schedule = {};
    const takenSlots = new Set();
    const lockedByMember = new Map();               // memberId → 고정 세션 수
    const lockedByMemberDay = new Map();            // `${memberId}|${day}` → 고정 세션 수

    for (const [k, s] of Object.entries(state.schedule)) {
      if (!s.locked) continue;
      schedule[k] = { memberId: s.memberId, locked: true };
      takenSlots.add(k);
      lockedByMember.set(s.memberId, (lockedByMember.get(s.memberId) || 0) + 1);
      const dk = `${s.memberId}|${Store.parseKey(k).day}`;
      lockedByMemberDay.set(dk, (lockedByMemberDay.get(dk) || 0) + 1);
    }

    const freeSlots = slotKeys.filter(k => !takenSlots.has(k));
    const slotIndex = new Map(freeSlots.map((k, i) => [k, i]));

    // 3. 아직 배정이 필요한 회원과 각자의 후보 슬롯
    const reqs = [];
    for (const m of state.members) {
      const already = lockedByMember.get(m.id) || 0;
      const need = m.sessionsPerWeek - already;
      const domain = m.availability.filter(k => slotIndex.has(k));
      if (need > 0) reqs.push({ member: m, need, domain, locked: already });
    }

    // 후보가 아예 없거나 필요 없는 회원을 빼고 나면 풀 것이 없을 수 있다.
    const active = reqs.filter(r => r.domain.length > 0);

    if (active.length === 0) {
      return { schedule, report: buildReport(state, schedule, reqs) };
    }

    // 4. 슬롯별 경합 정도 (몇 명이 이 슬롯을 원하는가)
    const demand = new Map();
    for (const r of active) {
      for (const k of r.domain) demand.set(k, (demand.get(k) || 0) + 1);
    }

    // 5. 그래프 구성
    const M = active.length;
    const S = freeSlots.length;

    const SOURCE = 0;
    const memberNode = (i) => 1 + i;
    const memberDayNode = (i, d) => 1 + M + i * 7 + d;
    const slotNode = (j) => 1 + M + M * 7 + j;
    const SINK = 1 + M + M * 7 + S;

    const mcf = new MinCostFlow(SINK + 1);
    const slotEdges = [];   // { id, memberId, slotKey }

    for (let i = 0; i < M; i++) {
      const r = active[i];
      mcf.addEdge(SOURCE, memberNode(i), r.need, 0);

      // 회원이 실제로 쓸 수 있는 요일만 연결
      const byDay = new Map();
      for (const k of r.domain) {
        const { day } = Store.parseKey(k);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(k);
      }

      for (const [day, keys] of byDay) {
        const usedToday = lockedByMemberDay.get(`${r.member.id}|${day}`) || 0;

        if (onePerDay) {
          // 하루 1회 — 이미 고정 세션이 있으면 그 요일은 닫힌다.
          const cap = Math.max(0, 1 - usedToday);
          if (cap === 0) continue;
          mcf.addEdge(memberNode(i), memberDayNode(i, day), cap, 0);
        } else if (spread) {
          // 같은 요일에 겹칠수록 비용이 커지는 계단식 간선 (볼록 비용)
          const maxHere = Math.min(r.need, keys.length);
          for (let j = 0; j < maxHere; j++) {
            mcf.addEdge(memberNode(i), memberDayNode(i, day), 1, SPREAD_PENALTY * (usedToday + j));
          }
        } else {
          mcf.addEdge(memberNode(i), memberDayNode(i, day), Math.min(r.need, keys.length), 0);
        }

        for (const k of keys) {
          const cost = DEMAND_WEIGHT * ((demand.get(k) || 1) - 1);
          const id = mcf.addEdge(memberDayNode(i, day), slotNode(slotIndex.get(k)), 1, cost);
          slotEdges.push({ id, memberId: r.member.id, slotKey: k });
        }
      }
    }

    for (let j = 0; j < S; j++) mcf.addEdge(slotNode(j), SINK, 1, 0);

    // 6. 풀기
    mcf.run(SOURCE, SINK);

    // 7. 결과 추출
    for (const { id, memberId, slotKey } of slotEdges) {
      if (mcf.flowOf(id) > 0) schedule[slotKey] = { memberId, locked: false };
    }

    return { schedule, report: buildReport(state, schedule, reqs) };
  }

  /* ─────────── 결과 리포트 ─────────── */

  function buildReport(state, schedule, reqs) {
    const got = new Map();
    for (const s of Object.values(schedule)) {
      got.set(s.memberId, (got.get(s.memberId) || 0) + 1);
    }

    const shortfalls = [];
    let wanted = 0;

    for (const m of state.members) {
      wanted += m.sessionsPerWeek;
      if (m.sessionsPerWeek === 0) continue;

      const have = got.get(m.id) || 0;
      if (have >= m.sessionsPerWeek) continue;

      const openAvail = m.availability.filter(k => {
        const { day, hour } = Store.parseKey(k);
        return Store.isOpen(day, hour);
      }).length;

      let reason;
      if (openAvail === 0) {
        reason = '운영 시간 안에 등록된 가능 시간이 없습니다';
      } else if (openAvail < m.sessionsPerWeek) {
        reason = `가능 시간이 ${openAvail}칸뿐이라 ${m.sessionsPerWeek}회를 채울 수 없습니다`;
      } else if (state.settings.onePerDay && availableDays(m) < m.sessionsPerWeek) {
        reason = `가능한 요일이 ${availableDays(m)}일뿐입니다 (하루 1회 규칙)`;
      } else {
        reason = '다른 회원과 시간대가 겹칩니다';
      }

      shortfalls.push({ name: m.name, need: m.sessionsPerWeek, got: have, reason });
    }

    return {
      assigned: Object.keys(schedule).length,
      wanted,
      shortfalls
    };
  }

  function availableDays(m) {
    const days = new Set();
    for (const k of m.availability) {
      const { day, hour } = Store.parseKey(k);
      if (Store.isOpen(day, hour)) days.add(day);
    }
    return days.size;
  }

  /* ─────────── 수동 편집 보조 ─────────── */

  /** 이 슬롯에 배정 가능한 회원 목록 (가능 시간 등록 여부 기준) */
  function candidatesFor(state, slotKey) {
    return state.members.filter(m => m.availability.includes(slotKey));
  }

  return { run, candidatesFor };
})();
