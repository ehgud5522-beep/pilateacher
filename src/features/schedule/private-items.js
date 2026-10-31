/**
 * 본인 전용 일정 · 메모 동기화 (2026-10-31, 동기화 3단계). **순수 함수다.**
 *
 * ── 무엇을 ──
 * 센터 수업(lessons, 1 · 2단계)에 실리지 않는 것을 **그 계정 본인만 읽고 쓰는 자리**
 * `users/{uid}/scheduleItems/{itemId}` 에 둔다. 대표 · FC · 다른 강사 · 회원은 읽지 못한다.
 *
 * | 종류 (kind)   | itemId               | 담는 것 |
 * | personal      | sch_{일정 id}         | 상담 · 휴무 같은 개인 일정 |
 * | group         | sch_{일정 id}         | 회원 id 없이 인원만 적는 그룹 수업 (회원 앱에 나가지 않는다) |
 * | lessonMemo    | memo_{수업 id}        | 센터 수업에 붙는 강사 메모 |
 * | consultNote   | note_{메모 id}        | 회원별 상담 메모 |
 * | memberGoal    | goal_{센터 회원 id}   | 회원별 운동 목표 · 통증 및 주의사항 · 목표 체중 · 체지방 |
 *
 * 회원은 기기마다 id 가 다르다. 그래서 회원에 붙는 것은 **센터 회원 id(orgClientId)** 로
 * 잇는다. 센터 명부에 없는 기기 회원의 메모는 싣지 않는다 (그 회원은 센터에 올리거나 잇는다).
 *
 * ── 1 · 2단계와 같은 틀 ──
 * 수정 번호 · 충돌(서버가 이긴다) · 지우지 않고 표시(deletedAt) · 스위치(따로) · 처음
 * 받기 전 자동 스냅샷. 기기에 남기는 번호는 종류마다 따로다:
 * 일정 privateRevision · 수업 메모 memoRevision · 상담 메모 syncRevision · 목표 goalRevision.
 *
 * ── 받는 기간 ──
 * 날짜가 있는 것(일정 · 메모 · 상담 메모)은 **30일 전 ~ 60일 뒤**. 이보다 오래된 것은
 * 입력한 기기에만 남는다. 목표는 날짜가 없어 늘 받는다.
 */

import { normalizeEquipmentIds } from "./equipment.js";

const text = (value) => String(value ?? "").trim();
const attendeesOf = (entry) => (Array.isArray(entry?.attendees) ? entry.attendees : []);
const notesOf = (member) => (Array.isArray(member?.notes) ? member.notes : []);
const revisionOf = (value) => Math.max(0, Number(value) || 0);
const numberOr0 = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export const PRIVATE_KIND = Object.freeze({
  PERSONAL: "personal",
  GROUP: "group",
  LESSON_MEMO: "lessonMemo",
  CONSULT_NOTE: "consultNote",
  MEMBER_GOAL: "memberGoal",
});

export const PRIVATE_WINDOW = Object.freeze({ pastDays: 30, futureDays: 60 });

const pad = (number) => String(number).padStart(2, "0");
const isoDay = (at) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/** 받는 범위 (날짜 문자열). */
export function privateWindow(now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    from: isoDay(new Date(start.getTime() - PRIVATE_WINDOW.pastDays * day)),
    to: isoDay(new Date(start.getTime() + PRIVATE_WINDOW.futureDays * day)),
  };
}

const isGroupEntry = (entry) => !entry?.personal && text(entry?.type) === "그룹" && attendeesOf(entry).length === 0;

function rosterByMember(rosterMembers) {
  const byId = new Map();
  for (const member of Array.isArray(rosterMembers) ? rosterMembers : []) {
    if (text(member?.id)) byId.set(text(member.id), member);
  }
  return byId;
}

/**
 * 지금 기기 상태에서 서버에 둘 문서들. itemId → { itemId, data, baseRevision }.
 *
 * rosterMembers: 회원 (메모 · 목표가 붙은 기기 행). clientIdOf: 기기 회원 id → 센터 회원 id.
 * 앱은 기기 db 의 회원과 명부에서 만든 이 지도를 넘긴다 -- 기기 행에는 센터 회원 id 가 없을 수
 * 있고(연락처로 이어진다), 명부에만 있는 회원은 기기 행이 없다.
 *
 * @param {{ schedule: Array<any>, rosterMembers: Array<any>, clientIdOf?: Map<string, string> }} input
 */
export function privateDocuments({ schedule = [], rosterMembers = [], clientIdOf = null } = {}) {
  const out = new Map();
  const byMember = rosterByMember(rosterMembers);
  const clientIdFor = (memberId) => text(clientIdOf?.get(text(memberId))) || text(byMember.get(text(memberId))?.orgClientId);
  const put = (itemId, data, baseRevision) => out.set(itemId, { itemId, data: { itemId, ...data }, baseRevision: revisionOf(baseRevision) });

  for (const entry of Array.isArray(schedule) ? schedule : []) {
    const id = text(entry?.id);
    if (!id) continue;
    if (entry.personal) {
      put(`sch_${id}`, {
        kind: PRIVATE_KIND.PERSONAL, date: text(entry.date), start: text(entry.start), end: text(entry.end),
        title: text(entry.title), memo: String(entry.memo ?? ""),
      }, entry.privateRevision);
      continue;
    }
    if (isGroupEntry(entry)) {
      put(`sch_${id}`, {
        kind: PRIVATE_KIND.GROUP, date: text(entry.date), start: text(entry.start), end: text(entry.end),
        type: "그룹", room: text(entry.room), equipmentIds: normalizeEquipmentIds(entry.equipmentIds),
        groupCount: numberOr0(entry.groupCount), actualCount: numberOr0(entry.actualCount), noshowCount: numberOr0(entry.noshowCount),
        groupDone: Boolean(entry.groupDone), groupCancelled: Boolean(entry.groupCancelled), memo: String(entry.memo ?? ""),
      }, entry.privateRevision);
      continue;
    }
    /* 센터 수업(센터 회원이 있는 수업)의 강사 메모. 수업 자체는 lessons 가 맡는다. */
    const isCentreLesson = attendeesOf(entry).some((attendee) => clientIdFor(attendee?.memberId));
    if (isCentreLesson && (text(entry.memo) || entry.memoRevision)) {
      put(`memo_${id}`, { kind: PRIVATE_KIND.LESSON_MEMO, date: text(entry.date), lessonId: id, memo: String(entry.memo ?? "") }, entry.memoRevision);
    }
  }

  for (const member of byMember.values()) {
    const clientId = clientIdFor(member?.id);
    if (!clientId) continue;
    for (const note of notesOf(member)) {
      if (text(note?.type) !== "상담" || !text(note?.id)) continue;
      put(`note_${text(note.id)}`, {
        kind: PRIVATE_KIND.CONSULT_NOTE, date: text(note.date), noteId: text(note.id), clientId,
        body: String(note.body ?? ""), important: Boolean(note.important),
      }, note.syncRevision);
    }
    const focus = Array.isArray(member.focus) ? member.focus.map(text).filter(Boolean) : [];
    if (text(member.goal) || focus.length || numberOr0(member.goalWeight) || numberOr0(member.goalFat) || member.goalRevision) {
      put(`goal_${clientId}`, {
        kind: PRIVATE_KIND.MEMBER_GOAL, clientId, goal: String(member.goal ?? ""), focus,
        goalWeight: numberOr0(member.goalWeight), goalFat: numberOr0(member.goalFat),
      }, member.goalRevision);
    }
  }
  return out;
}

const fingerprint = (data) => JSON.stringify(data);

/**
 * 저장 전후를 견주어 서버에 쓸 것. 바뀐 것과 새 것은 그대로, 사라진 것은 지운 표시로.
 * 목표는 회원이 사라져도 지우지 않는다 (센터 회원은 지우지 않는다).
 * @returns {Array<{ itemId: string, data: object, baseRevision: number, deleted: boolean }>}
 */
export function privateChanges({ before, after }) {
  const out = [];
  for (const [itemId, document] of after) {
    const previous = before.get(itemId);
    if (previous && fingerprint(previous.data) === fingerprint(document.data)) continue;
    out.push({ ...document, deleted: false });
  }
  for (const [itemId, previous] of before) {
    if (after.has(itemId) || previous.data.kind === PRIVATE_KIND.MEMBER_GOAL) continue;
    out.push({ ...previous, deleted: true });
  }
  return out;
}

/** 서버 문서의 내용만 (번호 · 시각 · 기기 칸을 뺀다). */
const META_FIELDS = new Set(["revision", "updatedAt", "createdAt", "updatedDevice", "deletedAt", "id"]);
const contentOf = (doc) => Object.fromEntries(Object.entries(doc || {}).filter(([key]) => !META_FIELDS.has(key)));

/**
 * 서버의 본인 일정 · 메모를 기기에 합친다. 서버 번호가 기기가 본 번호와 다르면 서버를
 * 따른다. 아직 못 보낸 이 기기의 수정(pendingIds)은 건드리지 않는다. 기기의 다른 칸은 지킨다.
 *
 * @param {{
 *   schedule: Array<any>, members: Array<any>, docs: Array<any>, rosterMembers: Array<any>,
 *   pendingIds?: Iterable<string>, newMember?: (rosterMember: any) => any,
 * }} input
 */
export function mergePrivateItems(input) {
  const pending = new Set([...(input?.pendingIds || [])].map(text));
  const byClient = new Map();
  for (const member of Array.isArray(input?.rosterMembers) ? input.rosterMembers : []) {
    if (text(member?.orgClientId) && !byClient.has(text(member.orgClientId))) byClient.set(text(member.orgClientId), member);
  }
  const newMember = typeof input?.newMember === "function"
    ? input.newMember
    : (roster) => ({ id: roster.id, name: text(roster.name), phone: text(roster.phone), status: "active", notes: [], focus: [] });

  let schedule = Array.isArray(input?.schedule) ? [...input.schedule] : [];
  let members = Array.isArray(input?.members) ? [...input.members] : [];
  const summary = { added: 0, updated: 0, removed: 0, memos: 0, notes: 0, goals: 0 };
  const duplicates = [];
  const unmatchedClientIds = new Set();
  let changed = false;

  const memberRow = (clientId) => {
    const roster = byClient.get(clientId);
    if (!roster) { unmatchedClientIds.add(clientId); return null; }
    let index = members.findIndex((member) => text(member?.id) === text(roster.id));
    if (index < 0) { members.push(newMember(roster)); index = members.length - 1; changed = true; }
    return index;
  };

  for (const doc of Array.isArray(input?.docs) ? input.docs : []) {
    const itemId = text(doc?.itemId || doc?.id);
    if (!itemId || pending.has(itemId)) continue;
    const kind = text(doc?.kind);
    const serverRevision = revisionOf(doc?.revision);
    const deleted = Boolean(doc?.deletedAt);

    if (kind === PRIVATE_KIND.PERSONAL || kind === PRIVATE_KIND.GROUP) {
      const id = itemId.replace(/^sch_/, "");
      const index = schedule.findIndex((entry) => text(entry?.id) === id);
      const local = index >= 0 ? schedule[index] : null;
      if (local && revisionOf(local.privateRevision) === serverRevision) continue;
      if (deleted) {
        if (local) { schedule.splice(index, 1); summary.removed += 1; changed = true; }
        continue;
      }
      const fields = kind === PRIVATE_KIND.PERSONAL
        ? { personal: true, title: text(doc.title), date: text(doc.date), start: text(doc.start), end: text(doc.end), memo: String(doc.memo ?? ""), attendees: [] }
        : {
          type: "그룹", date: text(doc.date), start: text(doc.start), end: text(doc.end), room: text(doc.room),
          equipmentIds: normalizeEquipmentIds(doc.equipmentIds), groupCount: numberOr0(doc.groupCount),
          actualCount: numberOr0(doc.actualCount), noshowCount: numberOr0(doc.noshowCount),
          groupDone: Boolean(doc.groupDone), groupCancelled: Boolean(doc.groupCancelled), memo: String(doc.memo ?? ""), attendees: [],
        };
      if (local) {
        schedule[index] = { ...local, ...fields, privateRevision: serverRevision };
        summary.updated += 1;
      } else {
        const entry = { id, ...fields, privateRevision: serverRevision };
        const twin = schedule.find((other) => text(other?.id) !== id && text(other?.date) === entry.date && text(other?.start) === entry.start
          && (kind === PRIVATE_KIND.PERSONAL ? other?.personal && text(other?.title) === entry.title : isGroupEntry(other)));
        if (twin) duplicates.push({ serverId: id, localId: text(twin.id) });
        schedule.push(entry);
        summary.added += 1;
      }
      changed = true;
      continue;
    }

    if (kind === PRIVATE_KIND.LESSON_MEMO) {
      /* 그 수업이 아직 기기에 없으면 넘긴다 -- 실시간 반영이 다음에 다시 준다. */
      const index = schedule.findIndex((entry) => text(entry?.id) === text(doc.lessonId));
      if (index < 0 || revisionOf(schedule[index].memoRevision) === serverRevision) continue;
      schedule[index] = { ...schedule[index], memo: deleted ? "" : String(doc.memo ?? ""), memoRevision: serverRevision };
      summary.memos += 1;
      changed = true;
      continue;
    }

    if (kind === PRIVATE_KIND.CONSULT_NOTE) {
      const index = memberRow(text(doc.clientId));
      if (index === null) continue;
      const member = members[index];
      const notes = notesOf(member);
      const at = notes.findIndex((note) => text(note?.id) === text(doc.noteId));
      if (at >= 0 && revisionOf(notes[at].syncRevision) === serverRevision) continue;
      if (deleted) {
        if (at < 0) continue;
        members[index] = { ...member, notes: notes.filter((_, position) => position !== at) };
      } else {
        const note = { id: text(doc.noteId), type: "상담", date: text(doc.date), body: String(doc.body ?? ""), important: Boolean(doc.important), syncRevision: serverRevision };
        members[index] = { ...member, notes: at >= 0 ? notes.map((item, position) => (position === at ? { ...item, ...note } : item)) : [...notes, note] };
      }
      summary.notes += 1;
      changed = true;
      continue;
    }

    if (kind === PRIVATE_KIND.MEMBER_GOAL) {
      const index = memberRow(text(doc.clientId));
      if (index === null || revisionOf(members[index].goalRevision) === serverRevision) continue;
      const content = contentOf(doc);
      members[index] = {
        ...members[index], goal: String(content.goal ?? ""), focus: Array.isArray(content.focus) ? content.focus.map(text).filter(Boolean) : [],
        goalWeight: numberOr0(content.goalWeight), goalFat: numberOr0(content.goalFat), goalRevision: serverRevision,
      };
      summary.goals += 1;
      changed = true;
    }
  }

  return {
    schedule: changed ? schedule : input?.schedule || [],
    members: changed ? members : input?.members || [],
    changed, summary, duplicates, unmatchedClientIds: [...unmatchedClientIds],
  };
}

/** 쓴 결과의 번호를 기기에 적는다. 종류마다 자리가 다르다. */
export function applyPrivateRevisions({ schedule = [], members = [], results = [], documents = [], rosterMembers = [] }) {
  /* 회원 목표는 센터 회원 id 로 온다 -- 기기 회원 id 는 명부로 찾는다. */
  const memberIdOf = new Map((Array.isArray(rosterMembers) ? rosterMembers : [])
    .filter((member) => text(member?.orgClientId)).map((member) => [text(member.orgClientId), text(member.id)]));
  const kindOf = new Map((Array.isArray(documents) ? documents : []).map((document) => [document.itemId, document.data]));
  let nextSchedule = schedule;
  let nextMembers = members;
  for (const result of Array.isArray(results) ? results : []) {
    if (!["written", "unchanged"].includes(result?.outcome)) continue;
    const data = kindOf.get(result.itemId);
    if (!data) continue;
    const revision = Number(result.revision) || 0;
    if (data.kind === PRIVATE_KIND.PERSONAL || data.kind === PRIVATE_KIND.GROUP) {
      const id = result.itemId.replace(/^sch_/, "");
      nextSchedule = nextSchedule.map((entry) => (entry.id === id && entry.privateRevision !== revision ? { ...entry, privateRevision: revision } : entry));
    } else if (data.kind === PRIVATE_KIND.LESSON_MEMO) {
      nextSchedule = nextSchedule.map((entry) => (entry.id === data.lessonId && entry.memoRevision !== revision ? { ...entry, memoRevision: revision } : entry));
    } else if (data.kind === PRIVATE_KIND.CONSULT_NOTE) {
      nextMembers = nextMembers.map((member) => (notesOf(member).some((note) => note.id === data.noteId)
        ? { ...member, notes: notesOf(member).map((note) => (note.id === data.noteId ? { ...note, syncRevision: revision } : note)) }
        : member));
    } else if (data.kind === PRIVATE_KIND.MEMBER_GOAL) {
      const memberId = memberIdOf.get(data.clientId) || data.clientId;
      nextMembers = nextMembers.map((member) => (text(member.id) === memberId && member.goalRevision !== revision
        ? { ...member, goalRevision: revision } : member));
    }
  }
  return { schedule: nextSchedule, members: nextMembers };
}
