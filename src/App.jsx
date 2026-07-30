// ============================================================================
// 필라티쳐 — 레드팀 검수 반영 최종본 (v4, Production-Ready)
// 하단 Navigation Shell + [일정] + 서비스 계층 + 캘린더 동기화
// ----------------------------------------------------------------------------
// 아이콘: lucide-react
//
// ── v4 레드팀 수정 (P0 7건 + P1 9건 + P2 7건) ─────────────────────
//  P0-1·2·3  일정 수정·삭제 불가, 상담/휴무는 토스트뿐
//            → EditSheet 신설: 시·분·길이 변경, 그룹 정원 변경, 2단계 확인 삭제.
//              Google 로 내보낸 일정은 원격 이벤트·syncIndex 도 함께 정리.
//              상담·휴무 탭 = EditSheet 직결. repo.deleteLesson 이 파생 맵(privates/groups)까지 정리.
//  P0-4      일요일 없음(주6열 고정) → 설정 '일요일 표시' 토글(7열 모드, 협폭 기기 열 축소)
//  P0-5      노쇼 차감 미결정 건이 처리 큐 누락 → kind:"fee" 항목 추가(회원별 차감/비차감 즉결)
//  P0-6      회원 이름 입력마다 신규 생성(중복 오염) → 동명 기존 회원 자동 재사용
//  P0-7      그룹 '−' 가 미입력(null)→0명 기록 → null 이면 − 비활성, 체크 후 '미체크로 되돌리기'
//  P1-8      그룹 체크가 종료 전 금지 → 사전 체크 허용(시작 시 체크 관행 반영)
//  P1-9      진행 중 수업이 '다음 수업' 표기 → '진행 중'
//  P1-10     ink3 대비 3.2:1 AA 미달 → #6B7484(≈4.7:1)로 토큰 교체
//  P1-11     접기 바 20px 터치 미달 → 탭 판정 ±10px 확장
//  P1-12     등록 진입점 '빈 칸 탭'뿐(발견성·키보드 불가) → 더보기에 '일정 등록'
//  P1-13     분 00/30·길이 3종뿐 → 15분 단위 + 45/90분
//  P1-14     동기화 실패 무표시 → try/catch 실패 토스트
//  P1-15     현재선 분 경계 미정렬(최대 59초 지연) → 경계 정렬 후 인터벌
//  P1-16     iOS Safari 100vh 하단 잘림 → 100dvh 폴백(.app-h)
//  P2-17~23  '오늘' disabled / store.google 스냅샷 prop / 연결 아이콘 role="img" /
//            기록 방식 선택 '뒤로' / 큐 남은 건수 문구 / 그룹 정원 수정 / 삭제 파생정리 테스트
//  문서화     주 범위 밖 export 미동작(실연동 시 서버 워커) · reservedCount 는 예약 연동 전 한계 ·
//            단일 파일(볼트 이식 시 @pure 경계로 분리) · TSX/다크모드/i18n/오프셋 없는 로컬 ISO 는 의도적 보류
//
// ═══ v8: [체형] 탭 — 볼트 1단계 (촬영 등록·초안 저장, 실제 AI 미연동) ═══
//  · Codex 검수 보정: 사진 변경 시 ready→draft 복귀, 저장 성공 후 objectURL 교체·해제,
//    App 종료 시 URL 일괄 정리, 테넌트·불변 식별자 보호, completeAssessment 상태 변경 전용화,
//    상세 화면 이동 버튼 문구와 실제 동작 일치.
//  · 목록: 제목 '체형분석'+설명, 회원 검색, 필터(전체/작성 중/검토 필요/완료/비교 가능),
//    카드(이름·담당·최근 분석일·상태·촬영 방향 등록 상태·비교 가능), 이력 없는 회원도 표시+'첫 체형분석 시작'
//  · 시작: 회원 정보(이름·담당·최근 분석일·이전 횟수) + 방식 카드 2종(ai/manual, 단계 안내 문구) → '다음' 시 초안 생성
//  · 촬영 등록: 방향 3카드(미등록/등록 완료/교체/삭제, 파일 업로드 input capture, objectURL 미리보기·메타만 저장,
//    revokeObjectURL 관리, 방향별 촬영 가이드 3줄, 하단 체크 4항목=경고용) + 임시 저장 / 분석 준비 완료(3장 필수)
//  · 상태(§8): draft 작성 중 / ready_for_analysis 분석 대기 / processing 분석 중 / review_required 검토 필요 / completed 완료
//    — processing 이후 상태는 UI 인식만, 이번 단계에서 자동 생성하지 않음(가짜 AI 결과·점수 생성 금지)
//  · 상세: 회원·분석일·방식·상태·3방향 사진·결과 영역('아직 생성된 분석 결과가 없어요.')·강사 메모 저장,
//    draft=이어서 촬영/초안 삭제(2단계), ready=준비 완료 배지+사진 다시 확인
//  · 연결: 회원 상세 퀵 버튼·이력 → startAssessment(memberId)/analysisMemberId 복원, Repo 확장
//    (getAssessment/updateAssessment/deleteAssessmentDraft/completeAssessment, 초안 §10 구조·테넌트 유지)
//  · v7 전체 구현(Mock 관절 편집·측정·비교·카드)은 pilateacher-shell-schedule-v7-full.jsx 에 보존 — 2단계 재료
// ═══ v6: [회원] 탭 운영 기준 완성 (이번 단계) ═══
// [용어] UI 문구는 전부 '홀딩' (데이터값 "paused" 유지) · 상태 표기 활성/홀딩/보관 · '재등록 필요' 배지
// [목록] 전체 수 · 검색 · 필터 전체/개인/듀엣/홀딩/이용권 임박 · 정렬 5종(최근 수업/다음 예약/잔여 적은/만료 임박/이름)
//        카드: 이름·담당·유형·잔여·만료·다음 예약·주의 경고 아이콘·홀딩 배지·재등록 필요(잔여≤3 또는 만료 14일 이내)
// [상세] 요약(연락처·담당·유형·잔여·기간·마지막·다음) → 수업 목표/주의사항/최근 기록/체형분석 이력/상담 메모/
//        이용권 변경 이력(원장+홀딩 이력 병합)/회원 기본정보(정보 수정·홀딩 설정/해제) · 퀵바: 일정/기록/체형분석/메모
// [등록] 필수 이름·전화·담당(고정 '나')·유형·상품·총 횟수·시작일·만료일 + 선택 목표/주의/메모 · 동명이인 선택 유지
// [홀딩] HoldSheet: 시작·종료 예정·사유·만료 연장 여부/일수 · 예정 수업 있으면 안내만(자동 취소 금지)
//        해제 시 활성 전환 + 실제 기간·연장 내역을 holdHistory 로 보존(이용권 변경 이력에 병합 표시)
// [빈 상태 문구] "아직 작성된 수업 기록이 없어요." / "아직 체형분석 이력이 없어요."+"첫 체형분석 시작" /
//        "예정된 수업이 없어요." / "등록된 상담 메모가 없어요."
// ═══ v5: [회원] 탭 ═══
// [변경사항]
//  · 회원을 store 단일 출처로 이전(React state 제거) — makeMember/createMemberRepository(@pure)
//  · 회원 목록(검색·필터 전체/개인/듀엣/홀딩·등록)·회원 상세(요약+섹션 7종+하단 퀵바 4버튼)
//  · 일정↔회원 연결: 수업 시트 이름 탭→상세 / 상세→일정 등록(프리셋)·기록 작성(수업 선택)·체형분석 시작
//  · 이용권: 수동 조정(사유·확인 2단계)+원장(membershipLedger) — 출석/노쇼 차감도 원장 경유, 음수 클램프
//  · 소프트 삭제(보관)만 제공 — 수업·기록·원장·분석 이력 고아 방지
// [데이터 구조] Member{organizationId,studioId,status,lessonType,membership{...},cautions,goals,memos}
//  Ledger{delta,reason:lesson|noshow|manual_adjustment|refund|extension,lessonId,changedBy}
//  최근 수업/다음 예약/기록 목록은 저장하지 않고 lessons 에서 파생(memberLessonStats)
// [미구현 — 의도적 보류]
//  · 결제·재등록(이용권 신규 발급) / 회원 하드 삭제(금지) / 변화 요약 자동 생성(기록·분석 축적 후)
//  · 회원 검색 자동완성 픽커(일정 등록 시) / 체형분석 실제 측정·촬영 화면
// [체형분석 연결 지점] — 다음 단계에서 이 표식을 검색해 교체·연결
//  · (v7 교체 → v8 재구성) AnalysisPrep → BodyAssessmentTab 1단계 화면
//  · startAssessment(memberId)/analysisMemberId — v8에서 스펙 명칭으로 복원·실연결
//  · createBodyAssessmentRepository — createAssessmentDraft 로 초안 생성 후 measurements 채우기
//  · MemberDetail '체형분석 이력' 섹션 — 이력 항목 탭 시 상세 열람 연결
// ── v3 유지 사항 ──
//  Back 마운트1회+backRef · 액션바 형제버튼 · 큐 그룹 홀드 · Sheet(Escape/포커스복원/Tab트랩) ·
//  타이머 정리 · nav aria-current · null 가드 · WeekGrid memo+핸들러 안정화 · kbSafe · touch-action
//
// 보존: 주간표·날짜 이동·개인/그룹 표시·현재선(#FF3B30)·운영시간 동적 범위·빈 시간 접기·
//   하단 내비·접근성 목록·네이티브 훅(window.__pilateacher.voiceNote)
// 금지 준수(§7): 비공식 API 추측·스크래핑·키 하드코딩 없음. StudioMateProvider 는 자리만.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Users, Ruler, MoveHorizontal as MoreHorizontal, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, X, Mic, Pencil, Check, Play, Sparkles, List, Settings, FileText, BarChart3, Share2, BookOpen, Plus, Minus, CircleAlert as AlertCircle, RefreshCw, Link2, CalendarClock, CloudOff, Search, UserPlus, MessageSquarePlus, Camera } from "lucide-react";

/* ─────────────────────────── 디자인 토큰 (VDS 확정) ─────────────────────────── */
const T = {
  bg: "#F6F7F9", surface: "#FFFFFF", sunken: "#F1F3F6", lineFaint: "#EEF1F5",
  border: "#E6E9EF", borderStrong: "#D5DAE3",
  ink: "#1C2433", ink2: "#5E6673", ink3: "#6B7484", disabled: "#B6BDC9",   // P1-10: ink3 AA(≈4.7:1)
  a600: "#4C4399", a700: "#3E3781", a200: "#D9D7EE", a100: "#ECEBF7", a50: "#F5F4FB",
  good: "#2E7D5B", goodS: "#E7F2EC", warn: "#B45309", warnS: "#FAF0E1",
  bad: "#C2413B", badS: "#FAECEB",
  nowLine: "#FF3B30",        // 현재 시간선 전용 — 브랜드 보라와 구분, 변경 금지
  gcal: "#4285F4",           // Google 일정 구분 마크 전용
};

const IDC = ["#5E8FB4", "#4FA08F", "#8AA36B", "#B4915E", "#6FA3AD", "#7C8BA8", "#A8867C", "#98A0AE"];
const idColor = (id) => {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  return IDC[h % IDC.length];
};

const CSS = `
  .pt-scroll::-webkit-scrollbar{width:0;height:0}
  .tnum{font-variant-numeric:tabular-nums}
  button{-webkit-tap-highlight-color:transparent;touch-action:manipulation;background:transparent;border:none;cursor:pointer;font-family:inherit;color:inherit;padding:0}
  button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{
    outline:2px solid #4C4399;outline-offset:1px;border-radius:4px}
  input,select,textarea{font-family:inherit}
  .app-h{height:100vh}
  @supports (height:100dvh){.app-h{height:100dvh}}
  .sheet-in{animation:slideUp .22s cubic-bezier(.22,1,.36,1)}
  @keyframes slideUp{from{transform:translateY(14px);opacity:.6}to{transform:translateY(0);opacity:1}}
  @media (prefers-reduced-motion: reduce){
    .sheet-in{animation:fadeIn .12s linear}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    *{scroll-behavior:auto !important}
  }
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

/* ─────────────────────────── 유틸 ─────────────────────────── */
const pad = (n) => String(n).padStart(2, "0");
const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = new Date(d); const w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); x.setHours(0, 0, 0, 0); return x; };
const parseHM = (s) => { const p = String(s).split(":"); return +p[0] * 60 + +p[1]; };
const dowOf = (ds) => (new Date(ds + "T00:00:00").getDay() + 6) % 7;
const mmdd = (ds) => `${ds.slice(5, 7)}.${ds.slice(8, 10)}`;
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
/* 시트 안 입력이 모바일 키보드에 가리지 않게 */
const kbSafe = (e) => { try { setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 160); } catch (_) { /* noop */ } };

const ROW = 32, DENSE_ROW = 64, FOLD_H = 20, AXIS = 28, PADX = 12, MIN_COL = 44, EDGE_GUARD = 24;

/* ═══════════════════════════════════════════════════════════════════════════
 * @pure-start  — 데이터 모델 · 서비스 계층 (UI 무관, 테스트 대상)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 계층 (§12):  UI → Hooks/VM → Services → Repositories/Providers → (Mock|Firebase|Google)
 * 테넌트 (§3): 모든 핵심 데이터에 organizationId · studioId 포함.
 *
 * @typedef {"owner"|"organization_admin"|"studio_manager"|"instructor"|"staff"|"member"} UserRole
 * @typedef {"private"|"duet"|"group"|"consultation"|"personal_event"|"time_off"} LessonType
 *
 * @typedef {Object} Lesson                    — 수업 자체 (§5). 예약(Booking)과 분리 (§13)
 * @property {string} id
 * @property {string} organizationId
 * @property {string} studioId
 * @property {string} instructorId
 * @property {LessonType} type
 * @property {string} title
 * @property {string} startAt   ISO(로컬)  @property {string} endAt   @property {string} timezone
 * @property {"pilateacher"|"google"|"external_provider"} source
 * @property {string=} externalEventId
 * @property {"scheduled"|"completed"|"cancelled"} status
 * @property {SyncMetadata} sync
 *
 * @typedef {Object} PrivateLessonDetail       — 개인·듀엣 전용 (회원 단위 기록 유지)
 * @property {string} lessonId
 * @property {{memberId:string,status:"booked"|"done"|"noshow"|"cancel",deducted:boolean|null}[]} attendees
 * @property {string|null} record
 *
 * @typedef {Object} GroupLessonAttendance     — 그룹 전용 (§6: 인원수 중심, 명단 없음)
 * @property {string} lessonId
 * @property {number} capacity
 * @property {number|null} reservedCount       — null = 예약 정보 없음
 * @property {number|null} attendedCount       — ★ null = 미체크 / 0 = 참석 0명 (반드시 구분)
 * @property {number|null} noShowCount
 * @property {number} walkInCount
 * @property {"not_required_yet"|"needs_check"|"checked"} attendanceStatus
 * @property {string=} attendanceCheckedAt  @property {string=} attendanceCheckedBy
 *
 * @typedef {Object} SyncMetadata (§8)
 * @property {"pilateacher"|"google"|"external_provider"} source
 * @property {string=} externalCalendarId @property {string=} externalEventId
 * @property {string=} externalUpdatedAt  @property {string=} lastSyncedAt
 * @property {"local_only"|"synced"|"pending"|"conflict"|"error"} syncStatus
 * @property {string=} syncErrorCode
 *
 * Booking(§13)·Membership(§14)·LessonOutcome(§15)은 이번 범위에서 데이터 생성 없이
 * Repository 인터페이스 자리만 둔다 — 존재하지 않는 데이터를 만들지 않는다(§3).
 */

const TENANT = { organizationId: "org_demo", studioId: "studio_gangnam" };
const ME = "inst_me";
const TZ = "Asia/Seoul";

const isoAt = (dateS, min) => `${dateS}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;
/** Lesson(ISO) → 그리드 뷰 필드. 저장 모델은 ISO, 화면 계산만 분 단위. */
const viewOf = (l) => {
  const date = l.startAt.slice(0, 10);
  const start = parseHM(l.startAt.slice(11, 16));
  const end = parseHM(l.endAt.slice(11, 16));
  return { date, start, dur: Math.max(5, end - start) };
};

let SEQ = 0;
function makeLesson({ date, start, dur, type, title, source = "pilateacher", instructorId = ME,
  tenant = TENANT, externalEventId, externalCalendarId, externalUpdatedAt, status = "scheduled", id }) {
  const now = new Date().toISOString();
  return {
    id: id || `les_${Date.now().toString(36)}_${SEQ++}`,
    organizationId: tenant.organizationId, studioId: tenant.studioId, instructorId,
    type, title: title || "", startAt: isoAt(date, start), endAt: isoAt(date, start + dur),
    timezone: TZ, source, externalEventId,
    status, createdAt: now, updatedAt: now,
    sync: source === "google"
      ? { source, externalCalendarId, externalEventId, externalUpdatedAt, lastSyncedAt: now, syncStatus: "synced" }
      : { source: "pilateacher", syncStatus: "local_only" },
  };
}

/* ── 그룹 인원 파생 (§6) — null vs 0 구분이 핵심 ── */
function deriveGroupCounts(a) {
  const { reservedCount: r, attendedCount: at } = a;
  const walkInCount = at != null && r != null ? Math.max(0, at - r) : 0;
  const noShowCount = at != null && r != null ? Math.max(0, r - at) : null;
  return { ...a, walkInCount, noShowCount };
}
function groupPhase(a, ended) {
  if (a.attendedCount != null) return "checked";
  return ended ? "needs_check" : "not_required_yet";
}
function setAttended(a, n, by = ME) {
  const v = n == null ? null : Math.max(0, Math.min(99, Math.round(n)));
  const next = deriveGroupCounts({ ...a, attendedCount: v });
  next.attendanceStatus = v == null ? (next.attendanceStatus === "checked" ? "needs_check" : next.attendanceStatus) : "checked";
  if (v != null) { next.attendanceCheckedAt = new Date().toISOString(); next.attendanceCheckedBy = by; }
  return next;
}
/** 블록 라벨 (§6 카드 표기) */
function groupCardLabel(a, ended, wide) {
  const ph = groupPhase(a, ended);
  if (ph === "not_required_yet")
    return a.reservedCount != null
      ? (wide ? `예약 ${a.reservedCount}/${a.capacity}` : `${a.reservedCount}/${a.capacity}`)
      : (wide ? `정원 ${a.capacity}` : `${a.capacity}명`);
  if (ph === "needs_check") return "인원체크";
  return a.reservedCount != null
    ? (wide ? `참석 ${a.attendedCount}/${a.reservedCount}` : `${a.attendedCount}/${a.reservedCount}`)
    : (wide ? `참석 ${a.attendedCount}` : `${a.attendedCount}명`);
}

/* ── 개인·듀엣 파생 (기존 유지) ── */
const att = (d) => (d && d.attendees) || [];
function privateStatus(d) {
  const a = att(d);
  if (!a.length) return "booked";
  if (a.every((x) => x.status === "cancel")) return "cancel";
  if (a.every((x) => x.status === "booked")) return "booked";
  if (a.some((x) => x.status === "done")) return "done";
  if (a.every((x) => x.status === "noshow" || x.status === "cancel")) return "noshow";
  return "done";
}
const needsRecord = (l, d) => (l.type === "private" || l.type === "duet") && privateStatus(d) === "done" && !(d && d.record);
/** P0-5: 노쇼 차감 미결정 — 처리 큐 대상 */
const feePending = (l, d) => (l.type === "private" || l.type === "duet") &&
  att(d).some((a) => a.status === "noshow" && a.deducted === null);

/* ── 저장소 (In-Memory Store) ── */
function createStore() {
  return {
    lessons: /** @type {Lesson[]} */ ([]),
    privates: new Map(),   // lessonId → PrivateLessonDetail
    groups: new Map(),     // lessonId → GroupLessonAttendance
    members: new Map(),    // memberId → Member (v5 §2)
    membershipLedger: [],  // 이용권 변경 원장 (v5 §5 — 자동 임의 차감 금지, 명시 호출만)
    assessments: new Map(),// memberId → BodyAssessment[] (v5 §6 — 회원 데이터와 책임 분리)
    syncIndex: new Map(),  // externalEventId → lessonId  (§8 중복 생성 방지)
    google: {
      connected: false, account: "", calendars: [], selectedCalendarIds: [],
      importOn: true, exportOn: true, exportTypes: { private: true, duet: true, group: true, consultation: true, time_off: true },
      titleMode: "masked",   // §17: full | masked | generic
      lastSyncedAt: null,
      remote: [],            // Google 쪽 이벤트 (Mock 원격 저장소)
    },
  };
}

/* ── Repositories (§12) — Firebase 교체 지점은 이 두 팩토리만 ── */
function createLessonRepository(store) {
  return {
    /** @param {{organizationId:string,studioId:string,instructorId?:string,from:string,to:string}} p */
    async getLessons(p) {
      return store.lessons.filter((l) =>
        l.organizationId === p.organizationId && l.studioId === p.studioId &&
        (!p.instructorId || l.instructorId === p.instructorId || l.type === "personal_event") &&
        l.startAt < p.to && l.endAt > p.from);
    },
    async createLesson(input) {
      const l = makeLesson(input);
      store.lessons.push(l);
      if (l.type === "private" || l.type === "duet")
        store.privates.set(l.id, { lessonId: l.id, attendees: input.attendees || [], record: null });
      if (l.type === "group")
        store.groups.set(l.id, deriveGroupCounts({
          lessonId: l.id, capacity: input.capacity ?? 8, reservedCount: input.reservedCount ?? null,
          attendedCount: null, noShowCount: null, walkInCount: 0, attendanceStatus: "not_required_yet",
        }));
      return l;
    },
    async updateLesson(id, ch) {
      const i = store.lessons.findIndex((l) => l.id === id);
      if (i < 0) throw new Error("lesson not found");
      const next = { ...store.lessons[i], ...ch, updatedAt: new Date().toISOString() };
      if (next.sync && next.sync.syncStatus === "synced" && ch.startAt) next.sync = { ...next.sync, syncStatus: "pending" };
      store.lessons[i] = next;
      return next;
    },
    /** P2-23: 삭제 시 파생 데이터(개인 기록·그룹 출석)까지 정리 */
    async deleteLesson(id) {
      store.lessons = store.lessons.filter((l) => l.id !== id);
      store.privates.delete(id);
      store.groups.delete(id);
    },
    async getPrivateDetail(id) { return store.privates.get(id) || null; },
    async savePrivateDetail(d) { store.privates.set(d.lessonId, d); },
  };
}
function createAttendanceRepository(store) {
  return {
    async getGroupAttendance(lessonId) { return store.groups.get(lessonId) || null; },
    async saveGroupAttendance(a) { store.groups.set(a.lessonId, deriveGroupCounts(a)); },
  };
}
/* Booking·Membership Repository — 인터페이스 자리만 (§13·§14). 데이터 미생성. */
function createBookingRepository() {
  return { async getBookings() { return []; } };
}

/* ── v5 §2: 회원 ──
 * @typedef {Object} Member
 * @property {string} id  @property {string} organizationId  @property {string} studioId
 * @property {string} name  @property {string} phone
 * @property {"active"|"paused"|"inactive"} status   — inactive = 보관(소프트 삭제)
 * @property {"private"|"duet"|"mixed"} lessonType
 * @property {string} instructorId
 * @property {{productName:string,totalCount:number,remainingCount:number,startedAt:string,expiresAt:string|null}} membership
 * @property {string[]} cautions   — 운동 시 주의(의료 진단 아님)
 * @property {string[]} goals
 * @property {{id:string,text:string,createdAt:string}[]} memos — 상담 메모(§3-7 확장 필드)
 * lastLessonAt/nextLessonAt 는 Firebase 비정규화 대비 자리 — 화면 표시는 수업 데이터에서 파생(단일 출처).
 */
function makeMember(input) {
  const now = new Date().toISOString();
  const tenant = input.tenant || TENANT;
  const total = input.totalCount ?? 10;
  return {
    id: input.id || `mem_${Date.now().toString(36)}_${SEQ++}`,
    organizationId: tenant.organizationId, studioId: tenant.studioId,
    name: (input.name || "").trim(), phone: input.phone || "",
    status: input.status || "active",
    lessonType: input.lessonType || "private",
    instructorId: input.instructorId || ME,
    membership: {
      productName: input.productName || "개인 10회",
      totalCount: total,
      remainingCount: input.remainingCount ?? total,
      startedAt: input.startedAt || now.slice(0, 10),
      expiresAt: input.expiresAt || null,
    },
    cautions: input.cautions || [], goals: input.goals || [], memos: input.memos || [],
    hold: input.hold || null,            // v6: 현재 홀딩 { startDate, endDate, reason, extendDays, prevExpiresAt }
    holdHistory: input.holdHistory || [],// v6: 지난 홀딩 이력 (해제 시 적재 — 이용권 변경 이력에 병합 표시)
    lastLessonAt: null, nextLessonAt: null,
    createdAt: now, updatedAt: now,
  };
}

/** 날짜 문자열(YYYY-MM-DD) + n일 — pure 내부 전용 (외부 dstr/addDays 미의존) */
const addDaysStr = (s, n) => {
  const d = new Date(s + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function createMemberRepository(store) {
  return {
    /** 테넌트 필터 필수 — 타지점 회원 혼입 방지. inactive(보관)는 기본 제외. */
    async getMembers(p) {
      const out = [];
      store.members.forEach((m) => {
        if (m.organizationId !== p.organizationId || m.studioId !== p.studioId) return;
        if (!p.includeInactive && m.status === "inactive") return;
        out.push(m);
      });
      return out;
    },
    async getMember(id) { return store.members.get(id) || null; },
    /** 중복 방지: trim 후 정확 일치(활성·홀딩만). 동명이인 등록은 UI에서 명시 선택으로만. */
    async findByName(p) {
      const t = (p.name || "").trim();
      if (!t) return null;
      let hit = null;
      store.members.forEach((m) => {
        if (hit) return;
        if (m.organizationId === p.organizationId && m.studioId === p.studioId &&
            m.status !== "inactive" && m.name === t) hit = m;
      });
      return hit;
    },
    async createMember(input) {
      const m = makeMember(input);
      store.members.set(m.id, m);
      return m;
    },
    async updateMember(id, ch) {
      const m = store.members.get(id);
      if (!m) throw new Error("member not found");
      const next = { ...m, ...ch,
        membership: { ...m.membership, ...(ch.membership || {}) },
        updatedAt: new Date().toISOString() };
      store.members.set(id, next);
      return next;
    },
    /** 하드 삭제 금지 — 수업·기록·원장·분석 이력의 고아 방지. 보관(inactive) 전환만 제공. */
    async deactivateMember(id) { return this.updateMember(id, { status: "inactive" }); },
    /** v6 홀딩 시작 — 상태만 paused 로 바꾼다. 예정 수업 취소는 하지 않는다(사용자 직접 결정).
     *  연장 시 만료일을 extendDays 만큼 미루고 원래 만료일은 hold.prevExpiresAt 에 보존. */
    async setHold(memberId, { startDate, endDate, reason, extendDays }) {
      const m = store.members.get(memberId);
      if (!m) return null;
      const ext = Math.max(0, extendDays || 0);
      const prevExpiresAt = m.membership.expiresAt;
      const ch = { status: "paused",
        hold: { startDate, endDate, reason: reason || "", extendDays: ext, prevExpiresAt } };
      if (ext > 0 && prevExpiresAt) ch.membership = { expiresAt: addDaysStr(prevExpiresAt, ext) };
      return this.updateMember(memberId, ch);
    },
    /** v6 홀딩 해제 — 활성 전환, 실제 기간·연장 내역을 holdHistory 에 남긴다(만료일은 되돌리지 않음). */
    async releaseHold(memberId, todayStr) {
      const m = store.members.get(memberId);
      if (!m) return null;
      if (!m.hold) return this.updateMember(memberId, { status: "active" });
      const h = m.hold;
      const rec = { id: `hold_${Date.now().toString(36)}_${SEQ++}`,
        startDate: h.startDate, plannedEndDate: h.endDate, releasedAt: todayStr,
        reason: h.reason, extendDays: h.extendDays, createdAt: new Date().toISOString() };
      return this.updateMember(memberId, { status: "active", hold: null,
        holdHistory: [rec, ...(m.holdHistory || [])] });
    },
    /** v5 §5: 잔여 횟수 조정 — 음수 금지(0 클램프), 실제 반영분(delta)만 원장 기록.
     *  reason: "lesson"|"noshow"|"manual_adjustment"|"refund"|"extension"
     *  자동 임의 차감 없음: 출석/노쇼/수동 조정이 각각 사유와 함께 명시적으로 호출한다. */
    async adjustMembership(memberId, delta, reason, extra = {}) {
      const m = store.members.get(memberId);
      if (!m) return null;
      const cur = m.membership.remainingCount;
      const effective = delta < 0 ? Math.max(delta, -cur) : delta;
      if (effective === 0 && delta < 0) return { member: m, entry: null, blocked: true };
      const next = await this.updateMember(memberId, { membership: { remainingCount: cur + effective } });
      const entry = {
        id: `led_${Date.now().toString(36)}_${SEQ++}`,
        memberId, organizationId: m.organizationId, studioId: m.studioId,
        delta: effective, reason,
        lessonId: extra.lessonId || null, note: extra.note || "",
        changedBy: extra.changedBy || ME,
        createdAt: new Date().toISOString(),
      };
      store.membershipLedger.push(entry);
      return { member: next, entry, blocked: false };
    },
    async getMembershipLedger(memberId) {
      return store.membershipLedger.filter((e) => e.memberId === memberId)
        .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
  };
}

/* ── v5 §6: 체형분석 연결 인터페이스 — [체형분석 연결 지점]
 * 실제 분석 화면·측정은 다음 단계. 데이터 없으면 빈 배열/null — 가짜 결과 생성 금지.
 * 회원(members)과 분석(assessments)은 저장소·Repository 를 분리해 책임을 나눈다. */
function createBodyAssessmentRepository(store) {
  /* v8(볼트 1단계): §10 구조 — 회원 객체와 분리, 테넌트 조건 유지, 최신순 정렬.
   * 결과(measurements/summary)는 이 단계에서 생성하지 않는다(가짜 AI 결과 금지). */
  const byIdLoc = (id) => {
    let hit = null;
    store.assessments.forEach((list, mid) => {
      const idx = list.findIndex((a) => a.id === id);
      if (idx >= 0) {
        const a = list[idx];
        if (a.organizationId === TENANT.organizationId && a.studioId === TENANT.studioId)
          hit = { mid, idx, a };
      }
    });
    return hit;
  };
  return {
    /** 회원별 목록 — 최신순(desc) */
    async getAssessmentsByMember(memberId) {
      return [...(store.assessments.get(memberId) || [])]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async getLatestAssessment(memberId) {
      const list = await this.getAssessmentsByMember(memberId);
      return list[0] || null;
    },
    async getAssessment(id) {
      const hit = byIdLoc(id);
      return hit ? hit.a : null;
    },
    /** 테넌트 스코프 전체 — 다른 지점 데이터 미노출 */
    async listAll(tenant = TENANT) {
      const out = [];
      store.assessments.forEach((list) => list.forEach((a) => {
        if (a.organizationId === tenant.organizationId && a.studioId === tenant.studioId) out.push(a);
      }));
      return out;
    },
    /** 초안 생성 — mode("ai"|"manual") 포함, 사진·결과는 비움 */
    async createAssessmentDraft(memberId, mode = "ai") {
      const m = store.members.get(memberId);
      if (!m || m.organizationId !== TENANT.organizationId || m.studioId !== TENANT.studioId)
        throw new Error("현재 지점의 회원만 체형분석을 시작할 수 있습니다.");
      const now = new Date().toISOString();
      const draft = {
        id: `bas_${Date.now().toString(36)}_${SEQ++}`, memberId,
        organizationId: m.organizationId,
        studioId: m.studioId,
        mode, status: "draft",
        photos: { front: null, side: null, back: null },
        measurements: null, summary: null,
        instructorMemo: "",
        createdBy: ME,
        createdAt: now, updatedAt: now,
      };
      const list = store.assessments.get(memberId) || [];
      store.assessments.set(memberId, [...list, draft]);
      return draft;
    },
    /** 얕은 병합 업데이트(+updatedAt). photos 는 호출부가 통째 객체로 전달 */
    async updateAssessment(id, changes) {
      const hit = byIdLoc(id);
      if (!hit) return null;
      const safe = { ...(changes || {}) };
      ["id", "memberId", "organizationId", "studioId", "createdBy", "createdAt"]
        .forEach((key) => { delete safe[key]; });
      const next = { ...hit.a, ...safe, updatedAt: new Date().toISOString() };
      const list = store.assessments.get(hit.mid).slice();
      list[hit.idx] = next;
      store.assessments.set(hit.mid, list);
      return next;
    },
    /** 초안 삭제 — status "draft" 만 허용(완료·검토 데이터 보호) */
    async deleteAssessmentDraft(id) {
      const hit = byIdLoc(id);
      if (!hit || hit.a.status !== "draft") return false;
      const list = store.assessments.get(hit.mid).filter((a) => a.id !== id);
      store.assessments.set(hit.mid, list);
      return true;
    },
    /** 이번 단계: 상태 변경만 지원(결과 생성·임의 필드 주입 없음) */
    async completeAssessment(id) {
      return this.updateAssessment(id, { status: "completed" });
    },
  };
}

/** v5: 회원의 수업 파생 정보 — 최근 수업/다음 예약/기록 가능/최근 기록.
 *  저장 필드가 아니라 lessons 단일 출처에서 계산해 시간표와 어긋나지 않는다. */
function memberLessonStats(store, memberId, nowIso, tenant = TENANT) {
  let last = null, next = null;
  const recordable = [], records = [], upcoming = [];
  for (const l of store.lessons) {
    if (l.organizationId !== tenant.organizationId || l.studioId !== tenant.studioId) continue;
    if (l.type !== "private" && l.type !== "duet") continue;
    const d = store.privates.get(l.id); if (!d) continue;
    const a = (d.attendees || []).find((x) => x.memberId === memberId); if (!a) continue;
    if (l.endAt <= nowIso) {
      if (a.status === "done") {
        if (!last || l.startAt > last.startAt) last = l;
        if (d.record) records.push({ l, d }); else recordable.push({ l, d });
      }
    } else if (a.status === "booked") {
      if (!next || l.startAt < next.startAt) next = l;
      upcoming.push(l);                                  // v6: 홀딩 시 예정 수업 안내용
    }
  }
  const desc = (x, y) => (x.l.startAt < y.l.startAt ? 1 : -1);
  records.sort(desc); recordable.sort(desc);
  upcoming.sort((x, y) => (x.startAt < y.startAt ? -1 : 1));
  return { last, next, recordable, records, upcoming };
}



/* ── Providers (§7·§8) ──
 * interface ExternalScheduleProvider {
 *   providerId; providerName;
 *   connect(); disconnect();
 *   fetchLessons({studioId, from, to}): ExternalLesson[];
 *   fetchClassSummary?({externalClassId});
 *   createLesson?; updateLesson?; deleteLesson?;
 * }
 * StudioMateProvider: 공식 API 문서 확인 전까지 구현하지 않는다(§7 금지 준수).
 */
function createGoogleCalendarProvider(store) {
  return {
    providerId: "google", providerName: "Google Calendar",
    async connect() {
      store.google.connected = true;
      store.google.account = "instructor@gmail.com";
      store.google.calendars = [
        { id: "primary", name: "기본 캘린더" },
        { id: "family", name: "가족" },
      ];
      if (!store.google.selectedCalendarIds.length) store.google.selectedCalendarIds = ["primary"];
    },
    async disconnect() {
      // §17: 연결 해제 시 토큰 폐기 — Mock 에서는 상태 초기화로 표현
      store.google.connected = false; store.google.account = "";
      store.google.calendars = []; store.google.selectedCalendarIds = [];
    },
    /** Google → 필라티쳐 (읽기) */
    async fetchLessons({ from, to }) {
      return store.google.remote.filter((e) =>
        store.google.selectedCalendarIds.includes(e.calendarId) && e.startAt < to && e.endAt > from);
    },
    /** 필라티쳐 → Google (쓰기, Mock 원격 반영) */
    async createLesson(ev) {
      const externalEventId = `g_${ev.id}`;
      store.google.remote.push({ externalEventId, calendarId: "primary", title: ev.title,
        startAt: ev.startAt, endAt: ev.endAt, updatedAt: new Date().toISOString(), origin: "pilateacher" });
      return externalEventId;
    },
    async updateLesson(ev) {
      const r = store.google.remote.find((x) => x.externalEventId === ev.sync.externalEventId);
      if (r) { r.title = ev.title; r.startAt = ev.startAt; r.endAt = ev.endAt; r.updatedAt = new Date().toISOString(); }
    },
    async deleteLesson(externalEventId) {
      store.google.remote = store.google.remote.filter((x) => x.externalEventId !== externalEventId);
    },
  };
}
function createMockExternalProvider() {
  return {
    providerId: "mock", providerName: "외부 예약 서비스 (예시)",
    async connect() {}, async disconnect() {},
    async fetchLessons() { return []; },
    async fetchClassSummary() { return { capacity: 8, reservedCount: 6 }; },
  };
}

/* ── Calendar Sync Service (§8·§9) ── */
function createCalendarSyncService(store, provider, lessonRepo) {
  const exportTitle = (l, detail, memberNames) => {
    const mode = store.google.titleMode;
    if (l.type === "group") return "그룹수업";
    if (l.type === "consultation") return "상담";
    if (l.type === "time_off") return "휴무";
    if (mode === "generic") return "개인레슨";
    const names = memberNames || [];
    if (mode === "masked") return names.map((n) => (n.length > 1 ? n[0] + "○".repeat(n.length - 1) : n)).join(", ") || "개인레슨";
    return names.join(", ") || "개인레슨";   // §17: 민감정보 과다 노출 금지 → 기본은 masked
  };

  return {
    exportTitle,
    /** Google → 필라티쳐. externalEventId ↔ lessonId 매핑으로 중복 생성 방지. */
    async importFromGoogle(range) {
      if (!store.google.connected || !store.google.importOn) return { created: 0, updated: 0, conflicts: 0 };
      const events = await provider.fetchLessons({ studioId: TENANT.studioId, ...range });
      let created = 0, updated = 0, conflicts = 0;
      for (const ev of events) {
        if (ev.origin === "pilateacher") continue;             // 우리가 내보낸 일정 재수입 방지
        const mapped = store.syncIndex.get(ev.externalEventId);
        if (!mapped) {
          const v = { date: ev.startAt.slice(0, 10), start: parseHM(ev.startAt.slice(11, 16)),
            dur: Math.max(5, parseHM(ev.endAt.slice(11, 16)) - parseHM(ev.startAt.slice(11, 16))) };
          const l = makeLesson({ ...v, type: "personal_event", title: ev.title, source: "google",
            externalEventId: ev.externalEventId, externalCalendarId: ev.calendarId, externalUpdatedAt: ev.updatedAt });
          store.lessons.push(l);
          store.syncIndex.set(ev.externalEventId, l.id);
          created++;
        } else {
          const l = store.lessons.find((x) => x.id === mapped);
          if (!l) { store.syncIndex.delete(ev.externalEventId); continue; }
          const remoteChanged = ev.updatedAt > (l.sync.externalUpdatedAt || "");
          const localChanged = l.updatedAt > (l.sync.lastSyncedAt || "");
          if (remoteChanged && localChanged) {                 // §9: 자동 덮어쓰기 금지 → 충돌 보류
            l.sync = { ...l.sync, syncStatus: "conflict", externalUpdatedAt: ev.updatedAt };
            l._remoteSnapshot = { title: ev.title, startAt: ev.startAt, endAt: ev.endAt };
            conflicts++;
          } else if (remoteChanged) {
            l.title = ev.title; l.startAt = ev.startAt; l.endAt = ev.endAt;
            l.sync = { ...l.sync, externalUpdatedAt: ev.updatedAt, lastSyncedAt: new Date().toISOString(), syncStatus: "synced" };
            updated++;
          }
        }
      }
      store.google.lastSyncedAt = new Date().toISOString();
      return { created, updated, conflicts };
    },

    /** 필라티쳐 → Google. 이미 내보낸 일정은 update, 새 일정만 create. */
    async exportToGoogle(range, memberNamesOf) {
      if (!store.google.connected || !store.google.exportOn) return { created: 0, updated: 0 };
      let created = 0, updated = 0;
      const targets = store.lessons.filter((l) =>
        l.source === "pilateacher" && store.google.exportTypes[l.type] &&
        l.startAt < range.to && l.endAt > range.from && l.status !== "cancelled");
      for (const l of targets) {
        const detail = store.privates.get(l.id);
        const names = memberNamesOf ? memberNamesOf(detail) : [];
        const ev = { ...l, title: exportTitle(l, detail, names) };
        if (l.sync.externalEventId) {
          if (l.updatedAt > (l.sync.lastSyncedAt || "")) {
            await provider.updateLesson(ev); updated++;
            l.sync = { ...l.sync, lastSyncedAt: new Date().toISOString(), syncStatus: "synced" };
          }
        } else {
          const extId = await provider.createLesson(ev); created++;
          l.sync = { ...l.sync, externalEventId: extId, externalCalendarId: "primary",
            lastSyncedAt: new Date().toISOString(), syncStatus: "synced" };
          store.syncIndex.set(extId, l.id);
        }
      }
      store.google.lastSyncedAt = new Date().toISOString();
      return { created, updated };
    },

    /** §9 충돌 해결 — 사용자가 선택한 쪽으로만 정리 */
    async resolveConflict(lessonId, keep) {
      const l = store.lessons.find((x) => x.id === lessonId);
      if (!l || l.sync.syncStatus !== "conflict") return;
      if (keep === "google" && l._remoteSnapshot) {
        l.title = l._remoteSnapshot.title; l.startAt = l._remoteSnapshot.startAt; l.endAt = l._remoteSnapshot.endAt;
      } else if (keep === "pilateacher") {
        await provider.updateLesson(l);
      }
      delete l._remoteSnapshot;
      l.sync = { ...l.sync, syncStatus: "synced", lastSyncedAt: new Date().toISOString(),
        externalUpdatedAt: new Date().toISOString() };
      l.updatedAt = new Date().toISOString();
    },

    /** 일정 충돌 감지 — Google 개인 일정과 수업 겹침 */
    detectOverlaps(lessons) {
      const out = [];
      const g = lessons.filter((l) => l.type === "personal_event");
      const w = lessons.filter((l) => l.type !== "personal_event" && l.status !== "cancelled");
      for (const a of g) for (const b of w)
        if (a.startAt.slice(0, 10) === b.startAt.slice(0, 10) && a.startAt < b.endAt && b.startAt < a.endAt)
          out.push({ googleId: a.id, lessonId: b.id });
      return out;
    },
  };
}

/* ── 그리드 범위·레이아웃 (기존 유지) ── */
function gridRange(hours, views) {
  let lo = Math.max(0, Math.min(23, hours.open));
  let hi = Math.max(lo + 1, Math.min(24, hours.close));
  for (const v of views) {
    const sh = Math.floor(v.start / 60), eh = Math.ceil((v.start + v.dur) / 60);
    if (sh < lo) lo = sh;
    if (eh > hi) hi = eh;
  }
  return { lo, hi, count: hi - lo };
}
function buildLayout({ range, byHour, foldOn, protectHours, expanded }) {
  const { lo, hi } = range;
  const dense = new Set(), empty = new Set();
  for (let h = lo; h < hi; h++) {
    const list = byHour.get(h) || [];
    if (!list.length) empty.add(h);
    if (list.filter((v) => v.dur <= 30).length >= 2) dense.add(h);
  }
  const folds = [];
  if (foldOn) {
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const s = run[0], e = run[run.length - 1] + 1;
        if (!run.some((h) => protectHours.has(h)) && !expanded.has(s)) folds.push([s, e]);
      }
      run = [];
    };
    for (let h = lo; h < hi; h++) { if (empty.has(h)) run.push(h); else flush(); }
    flush();
  }
  const foldStart = new Map(folds.map(([s, e]) => [s, e]));
  const inFold = new Set();
  folds.forEach(([s, e]) => { for (let h = s + 1; h < e; h++) inFold.add(h); });
  const rows = []; let y = 0;
  for (let h = lo; h < hi; h++) {
    if (inFold.has(h)) { rows.push({ h, y, hh: 0, hidden: true }); continue; }
    if (foldStart.has(h)) { rows.push({ h, y, hh: FOLD_H, fold: [h, foldStart.get(h)] }); y += FOLD_H; continue; }
    const hh = dense.has(h) ? DENSE_ROW : ROW;
    rows.push({ h, y, hh, dense: dense.has(h) }); y += hh;
  }
  return { rows, total: y, lo, hi, byRow: new Map(rows.map((r) => [r.h, r])) };
}
const rowOf = (L, min) => L.byRow.get(Math.floor(min / 60));
function yOf(L, min) {
  const r = rowOf(L, min);
  if (!r) return 0;
  if (r.hidden || r.fold) return r.y;
  return r.y + ((min % 60) / 60) * r.hh;
}
function hOf(L, min, dur) {
  const r = rowOf(L, min);
  if (!r || r.hidden || r.fold) return 0;
  return Math.max(14, (dur / 60) * r.hh - 2);
}
function minuteAt(L, y) {
  for (const r of L.rows) {
    if (r.hidden) continue;
    if (y >= r.y && y < r.y + r.hh) {
      if (r.fold) return { min: r.h * 60, fold: r.fold };
      return { min: r.h * 60 + Math.floor(((y - r.y) / r.hh) * 60) };
    }
  }
  const last = L.rows.filter((r) => !r.hidden).pop();
  return { min: last ? last.h * 60 + 59 : L.lo * 60 };
}
/* @pure-end ═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────── Mock 시드 ─────────────────────────── */
/* v5 §2: 데모 회원 시드 — 스펙 구조(makeMember)로 생성. 수업 시드와 id 연결(m1~m8).
 * m9는 홀딩 필터·재등록 필요·수업 없음 데모용. 잔여·주의사항은 기존 데모값 승계. */
const MEMBER_SEED = [
  { id: "m1", name: "김도련", phone: "010-0000-0001", lessonType: "mixed", productName: "개인 30회", totalCount: 30, remainingCount: 24, exp: 45, cautions: ["어깨 통증", "골반 비대칭"], goals: ["어깨 가동범위 회복"] },
  { id: "m2", name: "박서연", phone: "010-0000-0002", lessonType: "mixed", productName: "개인 20회", totalCount: 20, remainingCount: 12, exp: 60, cautions: ["손목 약화"], goals: [] },
  { id: "m3", name: "이민지", phone: "010-0000-0003", lessonType: "mixed", productName: "개인 10회", totalCount: 10, remainingCount: 7, exp: 30, cautions: [], goals: ["코어 안정화"] },
  { id: "m4", name: "최지우", phone: "010-0000-0004", lessonType: "private", productName: "개인 10회", totalCount: 10, remainingCount: 3, exp: 12, cautions: ["허리 주의"], goals: [] },
  { id: "m5", name: "정하은", phone: "010-0000-0005", lessonType: "mixed", productName: "개인 20회", totalCount: 20, remainingCount: 15, exp: 70, cautions: [], goals: ["밸런스 향상"] },
  { id: "m6", name: "한유진", phone: "010-0000-0006", lessonType: "mixed", productName: "개인 10회", totalCount: 10, remainingCount: 9, exp: 55, cautions: ["무릎 과신전"], goals: [] },
  { id: "m7", name: "오소라", phone: "010-0000-0007", lessonType: "private", productName: "개인 40회", totalCount: 40, remainingCount: 31, exp: 90, cautions: [], goals: ["기초 체력"] },
  { id: "m8", name: "강다인", phone: "010-0000-0008", lessonType: "mixed", productName: "개인 10회", totalCount: 10, remainingCount: 5, exp: 25, cautions: ["거북목"], goals: [] },
  { id: "m9", name: "윤세아", phone: "010-0000-0009", lessonType: "private", productName: "개인 10회", totalCount: 10, remainingCount: 0, exp: -20, status: "paused", cautions: [], goals: [] },
];
function seedMembers(store, now) {
  for (const s of MEMBER_SEED) {
    store.members.set(s.id, makeMember({ ...s,
      startedAt: dstr(addDays(now, -30)),
      expiresAt: dstr(addDays(now, s.exp)) }));
  }
  // 홀딩 데모: m9 — 7일 전 시작, 7일 후 종료 예정, 연장 없음
  const p9 = store.members.get("m9");
  if (p9) store.members.set("m9", { ...p9, hold: {
    startDate: dstr(addDays(now, -7)), endDate: dstr(addDays(now, 7)),
    reason: "개인 사정", extendDays: 0, prevExpiresAt: p9.membership.expiresAt } });
  // 타지점 회원 — 회원 목록에 섞이면 안 됨 (§3 테넌트 격리 검증용, 이름도 동일하게 두어 중복탐색 격리 확인)
  store.members.set("mx_songpa", makeMember({ id: "mx_songpa", name: "김도련",
    tenant: { organizationId: "org_demo", studioId: "studio_songpa" } }));
}
const A = (ids, status = "booked", ded = null) => ids.map((id) => ({ memberId: id, status, deducted: ded }));

const TPL = [
  [["09:00", "private", ["m3"]], ["10:00", "group", 8, 6], ["11:00", "private", ["m7"]],
   ["14:00", "duet", ["m3", "m2"]], ["16:00", "private", ["m6"]], ["19:00", "private", ["m5"]], ["21:00", "private", ["m1"]]],
  [["10:00", "private", ["m2"]], ["11:00", "group", 6, 5], ["13:00", "private", ["m4"]],
   ["15:00", "duet", ["m5", "m6"]], ["18:00", "private", ["m8"]], ["20:00", "private", ["m7"]]],
  [["09:00", "private", ["m6"]], ["10:00", "private", ["m3"]], ["11:00", "group", 8, 7],
   ["14:00", "duet", ["m3", "m2"]], ["16:00", "p30", ["m4"]], ["16:30", "p30", ["m5"]],
   ["17:00", "p30", ["m8"]], ["17:30", "p30", ["m7"]], ["19:00", "private", ["m8"]], ["21:00", "private", ["m1"]]],
  [["10:00", "private", ["m5"]], ["13:00", "private", ["m7"]], ["16:00", "group", 4, null],
   ["18:00", "private", ["m4"]], ["20:00", "duet", ["m6", "m8"]]],
  [["09:00", "private", ["m2"]], ["11:00", "private", ["m8"]], ["14:00", "duet", ["m1", "m5"]],
   ["16:00", "private", ["m3"]], ["19:00", "private", ["m6"]], ["21:00", "private", ["m4"]]],
  [["09:00", "group", 8, 6], ["10:00", "private", ["m7"]], ["11:00", "private", ["m1"]], ["13:00", "duet", ["m3", "m8"]]],
];

async function seedStore(store, lessonRepo, now) {
  const m0 = mondayOf(now);
  const todayS = dstr(now);
  for (let off = -4; off <= 1; off++) {
    for (let d = 0; d < 6; d++) {
      const ds = dstr(addDays(m0, off * 7 + d));
      for (let i = 0; i < TPL[d].length; i++) {
        const [time, kind, x1, x2] = TPL[d][i];
        const start = parseHM(time);
        const dur = kind === "p30" ? 30 : 50;
        const type = kind === "group" ? "group" : kind === "duet" ? "duet" : "private";
        const endT = new Date(ds + "T00:00:00"); endT.setMinutes(start + dur);
        const past = endT < now;
        const l = await lessonRepo.createLesson({
          date: ds, start, dur, type,
          title: type === "group" ? "그룹수업" : "",
          capacity: type === "group" ? x1 : undefined,
          reservedCount: type === "group" ? x2 : undefined,
          attendees: type !== "group" ? A(x1, "booked") : undefined,
        });
        if (past && type !== "group") {
          const det = store.privates.get(l.id);
          if (ds === todayS && i === 1) det.attendees = A(x1, "noshow", null);
          else if (ds === todayS && i === 3) det.attendees = A(x1, "cancel");
          else { det.attendees = A(x1, "done", true); det.record = (i + d) % 3 === 0 ? null : "작성 완료"; }
        }
        if (past && type === "group") {
          // 지난 그룹: 오늘 것 하나는 '미체크' 로 남겨 needs_check 데모 (§6)
          if (!(ds === todayS)) {
            const g = store.groups.get(l.id);
            store.groups.set(l.id, setAttended(g, Math.max(0, (x2 ?? 4) - 1)));
          }
        }
      }
    }
  }
  // 다른 지점·다른 강사 데이터 — 화면에 섞이면 안 됨 (§3·테스트 시나리오)
  store.lessons.push(makeLesson({ date: todayS, start: 600, dur: 50, type: "private", title: "",
    tenant: { organizationId: "org_demo", studioId: "studio_songpa" } }));
  store.lessons.push(makeLesson({ date: todayS, start: 720, dur: 50, type: "private", title: "", instructorId: "inst_other" }));

  // Google 원격 이벤트 (Mock) — 연결 시 가져옴
  const tue = dstr(addDays(m0, 1));
  const fri = dstr(addDays(m0, 4));
  store.google.remote.push(
    { externalEventId: "gev_dentist", calendarId: "primary", title: "치과 예약",
      startAt: isoAt(tue, 12 * 60), endAt: isoAt(tue, 13 * 60), updatedAt: new Date(Date.now() - 864e5).toISOString() },
    { externalEventId: "gev_family", calendarId: "primary", title: "가족 저녁",
      startAt: isoAt(fri, 19 * 60), endAt: isoAt(fri, 20 * 60 + 30), updatedAt: new Date(Date.now() - 864e5).toISOString() },
  );
}

/* ─────────────────────────── Hooks (§12: VM 계층) ─────────────────────────── */
/** 현재 시간선 명세: 1분 갱신 + 진입 시 즉시 계산 + 백그라운드 복귀 시 재계산.
 *  P1-15: 인터벌을 분 경계에 정렬 — 실제 분이 바뀌는 순간 선이 이동한다.
 *  매초 리렌더링하지 않는다. 날짜가 바뀌면 now 갱신 → todayS 파생으로 오늘 컬럼 자동 재판단. */
function useCurrentTime(refreshMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    update();                                              // 화면 진입 시 즉시
    let timer = 0;
    const align = window.setTimeout(() => {
      update();
      timer = window.setInterval(update, refreshMs);
    }, refreshMs - (Date.now() % refreshMs));
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") update(); // 백그라운드 복귀 시 즉시
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(align);
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshMs]);
  return now;
}

/* ─────────────────────────── 공용 UI ─────────────────────────── */
function Btn({ kind = "secondary", grow, full, onClick, ariaLabel, disabled, children }) {
  const K = {
    primary: { background: disabled ? T.disabled : T.a600, color: "#FFFFFF", border: "1px solid transparent" },
    danger: { background: disabled ? T.disabled : T.bad, color: "#FFFFFF", border: "1px solid transparent" },
    secondary: { background: T.surface, color: T.ink, border: `1px solid ${T.borderStrong}` },
    ghost: { background: "transparent", color: T.a600, border: "1px solid transparent" },
    muted: { background: "transparent", color: T.ink2, border: "1px solid transparent" },
  }[kind];
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} disabled={disabled}
      className={`flex items-center justify-center gap-1 ${full ? "w-full" : ""}`}
      style={{ height: 48, borderRadius: 8, fontSize: 15, fontWeight: 500,
        padding: "0 14px", flex: grow ? 1 : undefined, opacity: disabled ? 0.6 : 1, ...K }}>
      {children}
    </button>
  );
}

/* Sheet: Escape 닫기 · 열림 포커스 이동 · 닫힘 포커스 복원 · Tab 순환 트랩 */
function Sheet({ title, sub, onClose, children, wide }) {
  const ref = useRef(null);
  const lastFocus = useRef(null);
  useEffect(() => {
    lastFocus.current = typeof document !== "undefined" ? document.activeElement : null;
    const t = setTimeout(() => ref.current && ref.current.focus(), 40);
    return () => {
      clearTimeout(t);
      const el = lastFocus.current;
      if (el && typeof el.focus === "function") { try { el.focus(); } catch (_) { /* noop */ } }
    };
  }, []);
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !ref.current) return;
    const nodes = ref.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="fixed inset-0" style={{ zIndex: 60 }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" style={{ background: "rgba(28,36,51,0.32)" }} onClick={onClose} />
      <div ref={ref} tabIndex={-1} onKeyDown={onKeyDown}
        className="absolute bottom-0 left-1/2 w-full flex flex-col sheet-in"
        style={{ transform: "translateX(-50%)", maxWidth: 420, maxHeight: wide ? "92%" : "86%",
          background: T.surface, borderRadius: "16px 16px 0 0", boxShadow: "0 -8px 24px rgba(28,36,51,0.12)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-start justify-between" style={{ padding: "16px 16px 6px" }}>
          <div className="min-w-0">
            <div style={{ fontSize: 17, fontWeight: 600, color: T.ink }}>{title}</div>
            {sub ? <div className="tnum" style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>{sub}</div> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="flex items-center justify-center shrink-0"
            style={{ width: 44, height: 44, marginTop: -6, marginRight: -8, borderRadius: 8, color: T.ink2 }}>
            <X size={18} />
          </button>
        </div>
        <div className="pt-scroll" style={{ overflowY: "auto", padding: "4px 16px 20px" }}>{children}</div>
      </div>
    </div>
  );
}

/* ── §6 그룹 인원 스테퍼 — 48px 타겟, 즉시 저장.
 * P0-7: 미입력(null) 상태에서 − 는 비활성 — 실수로 '참석 0명'이 기록되는 것을 차단. ── */
function CountStepper({ value, onChange, saved }) {
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState("");
  const minusOff = value == null;
  const commit = () => {
    setEditing(false);
    const n = parseInt(txt, 10);
    if (!Number.isNaN(n)) onChange(n);
  };
  return (
    <div className="flex items-center justify-center gap-2" style={{ padding: "4px 0" }}>
      <button type="button" aria-label="참석 인원 1명 줄이기" disabled={minusOff}
        onClick={() => { if (!minusOff) onChange(Math.max(0, value - 1)); }}
        className="flex items-center justify-center"
        style={{ width: 48, height: 48, borderRadius: 10, border: `1px solid ${T.borderStrong}`,
          color: T.ink, opacity: minusOff ? 0.35 : 1 }}>
        <Minus size={18} />
      </button>
      {editing ? (
        <input autoFocus inputMode="numeric" value={txt}
          onChange={(e) => setTxt(e.target.value.replace(/\D/g, ""))}
          onFocus={kbSafe} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          aria-label="참석 인원 직접 입력" className="tnum"
          style={{ width: 96, height: 48, textAlign: "center", fontSize: 20, fontWeight: 600,
            background: T.sunken, border: `1px solid ${T.a200}`, borderRadius: 10, color: T.ink }} />
      ) : (
        <button type="button"
          onClick={() => { setTxt(value == null ? "" : String(value)); setEditing(true); }}
          aria-label={`참석 ${value == null ? "미입력, 눌러서 직접 입력" : value + "명, 눌러서 직접 입력"}`}
          className="tnum" style={{ width: 96, height: 48, borderRadius: 10, background: T.sunken,
            border: `1px solid ${T.border}`, fontSize: value == null ? 14 : 18, fontWeight: 600,
            color: value == null ? T.ink2 : T.ink }}>
          {value == null ? "미입력" : `참석 ${value}명`}
        </button>
      )}
      <button type="button" aria-label="참석 인원 1명 늘리기"
        onClick={() => onChange((value ?? 0) + 1)}
        className="flex items-center justify-center"
        style={{ width: 48, height: 48, borderRadius: 10, border: `1px solid ${T.borderStrong}`, color: T.ink }}>
        <Plus size={18} />
      </button>
      <span aria-live="polite" className="flex items-center justify-center shrink-0"
        style={{ width: 24, color: T.good }}>
        {saved ? <Check size={16} aria-label="저장됨" /> : null}
      </span>
    </div>
  );
}

/* ─────────────────────────── 주간 시간표 (React.memo) ─────────────────────────── */
const WeekGrid = React.memo(function WeekGrid({
  L, range, days, todayS, viewByDay, members, detailOf, groupOf, nextId, nowMin, gridH,
  onPickLesson, onPickEmpty, onExpandFold, colWidths, lefts, sheetOpen, weekKey,
}) {
  const bodyRef = useRef(null);
  const ptr = useRef(null);
  const userScrolled = useRef(false);

  /* 자동 스크롤: 오늘 주 진입 시 현재선을 중앙 약간 위로. 수동 스크롤·시트 열림 시 금지. */
  useEffect(() => { userScrolled.current = false; }, [weekKey]);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || sheetOpen || userScrolled.current) return;
    if (!days.includes(todayS)) return;
    const target = yOf(L, nowMin) - el.clientHeight * 0.4;
    if (L.total > el.clientHeight) el.scrollTop = Math.max(0, Math.min(target, L.total - el.clientHeight));
  }, [weekKey, L.total]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolve = useCallback((cx, cy) => {
    const el = bodyRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top + el.scrollTop;
    if (x < AXIS + PADX) return null;
    let di = -1;
    for (let i = 0; i < colWidths.length; i++) {
      const l = AXIS + PADX + lefts[i];
      if (x >= l && x < l + colWidths[i]) { di = i; break; }
    }
    if (di < 0) return null;
    const hit = minuteAt(L, y);
    if (hit.fold) return { kind: "fold", start: hit.fold[0] };
    const date = days[di];
    const list = (viewByDay[date] || []).slice().sort((a, b) => a.v.start - b.v.start);
    const inside = list.find((x2) => hit.min >= x2.v.start && hit.min < x2.v.start + x2.v.dur);
    if (inside) return { kind: "lesson", lesson: inside.l };
    let best = null, bestPx = Infinity;
    for (const x2 of list) {
      const top = yOf(L, x2.v.start), bot = top + hOf(L, x2.v.start, x2.v.dur);
      const d = y < top ? top - y : y > bot ? y - bot : 0;
      if (d < bestPx) { bestPx = d; best = x2.l; }
    }
    if (best && bestPx <= 10) return { kind: "lesson", lesson: best };
    /* P1-11: 접기 바(20px)는 터치 타겟 미달 — 판정을 ±10px 확장 */
    for (const r2 of L.rows) {
      if (r2.fold) {
        const c = r2.y + r2.hh / 2;
        if (Math.abs(y - c) <= r2.hh / 2 + 10) return { kind: "fold", start: r2.fold[0] };
      }
    }
    const snapped = Math.max(range.lo * 60, Math.min(range.hi * 60 - 30, Math.floor(hit.min / 30) * 30));
    return { kind: "empty", date, min: snapped };
  }, [L, days, viewByDay, colWidths, lefts, range]);

  const onDown = (e) => {
    const el = bodyRef.current;
    const r = el ? el.getBoundingClientRect() : null;
    const nearEdge = r ? e.clientX - r.left < EDGE_GUARD : false;   // iOS 엣지 스와이프백 양보
    ptr.current = { x: e.clientX, y: e.clientY, axis: null, swiped: false, nearEdge };
  };
  const onMove = (e) => {
    const p = ptr.current; if (!p || p.nearEdge) return;
    if (!p.axis) {
      const dx = Math.abs(e.clientX - p.x), dy = Math.abs(e.clientY - p.y);
      if (dx + dy > 6) p.axis = dx > dy ? "x" : "y";
    }
  };
  const onUp = (e) => {
    const p = ptr.current; if (!p || p.nearEdge) return;
    const dx = e.clientX - p.x;
    if (p.axis === "x" && Math.abs(dx) > 56) { p.swiped = true; onPickEmpty.swipe(dx < 0 ? 1 : -1); }
  };
  const onClick = (e) => {
    const p = ptr.current; ptr.current = null;
    if (p && p.swiped) return;
    const hit = resolve(e.clientX, e.clientY);
    if (!hit) return;
    if (hit.kind === "fold") onExpandFold(hit.start);
    else if (hit.kind === "lesson") onPickLesson(hit.lesson);
    else onPickEmpty.create(hit.date, hit.min);
  };

  const tIdx = days.indexOf(todayS);
  const ended = (v, ds) => ds < todayS || (ds === todayS && v.start + v.dur <= nowMin);

  const blockOf = (l, v, w, isT) => {
    if (l.type === "personal_event") {
      return {
        label: w >= 56 ? l.title : l.title.slice(0, 3),
        style: { background: T.surface, color: T.ink2, border: `1px solid ${T.borderStrong}`,
          borderLeft: `3px solid ${T.gcal}` },
        icon: <CalendarDays size={9} color={T.gcal} className="shrink-0" />,
      };
    }
    if (l.type === "time_off") {
      return { label: "휴무", style: { color: T.ink2, border: `1px dashed ${T.borderStrong}`,
        background: "repeating-linear-gradient(135deg,#FAFBFC 0 4px,#F2F4F7 4px 8px)" } };
    }
    if (l.type === "consultation") {
      return { label: w >= 52 ? "상담" : "상", style: { background: "#E9EDF3", color: isT ? T.ink : T.ink2 } };
    }
    if (l.type === "group") {
      const g = groupOf(l.id);
      const isEnd = ended(v, l.startAt.slice(0, 10));
      const ph = g ? groupPhase(g, isEnd) : "not_required_yet";
      const label = g ? groupCardLabel(g, isEnd, w >= 60) : "그룹";
      if (ph === "needs_check")
        return { label, style: { background: T.sunken, color: T.ink2 }, dot: true };
      if (ph === "checked")
        return { label, style: { background: T.sunken, color: T.ink3 } };
      return { label, style: { background: "#E9EDF3", color: isT ? T.ink : T.ink2 },
        icon: <Users size={9} className="shrink-0" style={{ color: "inherit" }} /> };
    }
    const d = detailOf(l.id);
    const st = privateStatus(d);
    const first = members[att(d)[0]?.memberId];
    const full = first ? first.name : "회원";
    const nm = w >= 52 ? full : full.slice(-2);
    const label = l.type === "duet" && att(d).length > 1 ? `${nm}+1` : nm;
    const base = { label, memberId: first ? first.id : null };
    if (l.id === nextId) return { ...base, style: { background: T.a100, color: T.a600, border: `1.5px solid ${T.a600}` }, play: true };
    if (st === "cancel") return { ...base, style: { background: "transparent", color: T.ink2, border: `1px dashed ${T.borderStrong}`, textDecoration: "line-through" } };
    if (st === "noshow") return { ...base, style: { background: T.badS, color: T.bad } };
    if (st === "done") return { ...base, dim: true, dot: needsRecord(l, d),
      style: { background: T.sunken, color: T.ink2 } };
    return { ...base, style: { background: "#E9EDF3", color: isT ? T.ink : T.ink2 } };
  };

  return (
    <div ref={bodyRef} className="relative flex-1 min-h-0 pt-scroll"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onClick={onClick}
      onScroll={() => { userScrolled.current = true; }}
      style={{ overflowY: "auto", touchAction: "pan-y", background: T.surface, padding: `0 ${PADX}px` }}>
      <div className="relative" style={{ height: Math.max(L.total + 8, gridH) }}>
        {tIdx >= 0 ? (
          <div className="absolute" aria-hidden="true"
            style={{ top: 0, bottom: 0, left: AXIS + lefts[tIdx], width: colWidths[tIdx], background: T.a50 }} />
        ) : null}

        {L.rows.map((r) => {
          if (r.hidden) return null;
          if (r.fold) {
            return (
              <div key={r.h} className="absolute flex items-center justify-center gap-1"
                style={{ top: r.y, left: AXIS, right: 0, height: FOLD_H, borderRadius: 4,
                  border: `1px dashed ${T.borderStrong}`, fontSize: 10, fontWeight: 500, color: T.ink2,
                  background: "repeating-linear-gradient(135deg,#FAFBFC 0 5px,#F2F4F7 5px 10px)" }}>
                <ChevronDown size={11} />
                <span className="tnum">{pad(r.fold[0])}:00–{pad(r.fold[1])}:00 비어 있음 · 펼치기</span>
              </div>
            );
          }
          return (
            <React.Fragment key={r.h}>
              <div className="absolute left-0 right-0" aria-hidden="true"
                style={{ top: r.y, borderTop: `1px solid ${T.lineFaint}` }} />
              <div className="absolute tnum" style={{ top: r.y + 3, left: 0, width: AXIS - 6, textAlign: "right",
                fontSize: 10, fontWeight: 500, color: T.ink2 }}>{pad(r.h)}</div>
            </React.Fragment>
          );
        })}

        {colWidths.map((w, i) => (i > 0 ? (
          <div key={`v${i}`} className="absolute" aria-hidden="true"
            style={{ top: 0, bottom: 0, left: AXIS + lefts[i], borderLeft: `1px solid ${T.lineFaint}` }} />
        ) : null))}

        {days.map((ds, di) => (viewByDay[ds] || []).map(({ l, v }) => {
          const r = rowOf(L, v.start);
          if (!r || r.hidden || r.fold) return null;
          const isT = ds === todayS;
          const w = colWidths[di];
          const b = blockOf(l, v, w, isT);
          return (
            <div key={l.id} aria-hidden="true"
              className="absolute overflow-hidden flex items-center"
              style={{ left: AXIS + lefts[di] + 2, width: w - 4, top: yOf(L, v.start) + 1,
                height: hOf(L, v.start, v.dur), borderRadius: 4, padding: "0 4px", gap: 3, zIndex: 10,
                fontSize: w >= 52 ? 12 : 11, fontWeight: b.play ? 600 : 500,
                border: "1px solid transparent", ...b.style }}>
              {b.play ? <Play size={9} fill={T.a600} color={T.a600} className="shrink-0" /> : null}
              {b.icon || null}
              {b.memberId ? (
                <span className="shrink-0" style={{ width: 6, height: 6, borderRadius: 3,
                  background: idColor(b.memberId), opacity: b.dim ? 0.45 : 1 }} />
              ) : null}
              <span className="truncate" style={b.style.textDecoration ? { textDecoration: b.style.textDecoration } : null}>
                {b.label}
              </span>
              {b.dot ? (
                <span className="absolute" style={{ top: 2, right: 2, width: 6, height: 6, borderRadius: 3, background: T.a600 }} />
              ) : null}
            </div>
          );
        }))}

        {/* 현재 시간선 — #FF3B30 · 7px Dot · 1.5px · 오늘 컬럼에만 · 카드보다 위 · 분 단위 */}
        {tIdx >= 0 && nowMin >= range.lo * 60 && nowMin <= range.hi * 60 ? (
          <div className="absolute" aria-hidden="true"
            style={{ top: yOf(L, nowMin), left: AXIS + lefts[tIdx], width: colWidths[tIdx],
              zIndex: 20, pointerEvents: "none" }}>
            <div className="absolute" style={{ left: -3.5, top: -3.5, width: 7, height: 7,
              borderRadius: 3.5, background: T.nowLine }} />
            <div style={{ borderTop: `1.5px solid ${T.nowLine}` }} />
          </div>
        ) : null}
      </div>

      <div className="sr-only">
        <p>현재 시간 {hm(nowMin)}</p>
        {days.map((ds, i) => (
          <p key={ds}>
            {DOW[i]}요일 {mmdd(ds)} 일정 {(viewByDay[ds] || []).length}건.
            {(viewByDay[ds] || []).map(({ l, v }) => {
              if (l.type === "personal_event") return ` ${hm(v.start)} Google 일정 ${l.title}.`;
              if (l.type === "group") {
                const g = groupOf(l.id);
                return ` ${hm(v.start)} 그룹수업 ${g ? groupCardLabel(g, ended(v, ds), true) : ""}.`;
              }
              if (l.type === "time_off") return ` ${hm(v.start)} 휴무.`;
              if (l.type === "consultation") return ` ${hm(v.start)} 상담.`;
              const d = detailOf(l.id);
              return ` ${hm(v.start)} ${att(d).map((a) => members[a.memberId]?.name).filter(Boolean).join(", ")}.`;
            })}
          </p>
        ))}
        <p>자세한 조작은 목록 보기를 사용하세요. 새 일정 등록은 더보기의 일정 등록을 사용할 수 있습니다.</p>
      </div>
    </div>
  );
});

/* ─────────────────────────── 목록 보기 (접근성) ─────────────────────────── */
function ListSheet({ days, viewByDay, members, detailOf, groupOf, todayS, nowMin, onPick, onClose }) {
  return (
    <Sheet title="목록 보기" sub="키보드·스크린리더용 · 이번 주 전체" onClose={onClose} wide>
      <div className="flex flex-col" style={{ gap: 14 }}>
        {days.map((ds, i) => {
          const list = (viewByDay[ds] || []).slice().sort((a, b) => a.v.start - b.v.start);
          return (
            <section key={ds} aria-label={`${DOW[i]}요일 ${mmdd(ds)}`}>
              <h3 className="tnum" style={{ fontSize: 13, fontWeight: 600,
                color: ds === todayS ? T.a600 : T.ink2, marginBottom: 6 }}>
                {DOW[i]} {mmdd(ds)}{ds === todayS ? " · 오늘" : ""} · {list.length}건
              </h3>
              {!list.length ? <p style={{ fontSize: 13, color: T.ink2 }}>일정 없음</p> :
                list.map(({ l, v }) => {
                  const endd = ds < todayS || (ds === todayS && v.start + v.dur <= nowMin);
                  let name, sub2;
                  if (l.type === "personal_event") { name = l.title; sub2 = "Google 일정"; }
                  else if (l.type === "time_off") { name = "휴무"; sub2 = ""; }
                  else if (l.type === "consultation") { name = "상담"; sub2 = `${v.dur}분`; }
                  else if (l.type === "group") {
                    const g = groupOf(l.id);
                    name = "그룹수업"; sub2 = g ? groupCardLabel(g, endd, true) : "";
                  } else {
                    const d = detailOf(l.id);
                    name = att(d).map((a) => members[a.memberId]?.name).filter(Boolean).join(" · ");
                    sub2 = `${l.type === "duet" ? "듀엣" : "개인"} · ${v.dur}분${needsRecord(l, d) ? " · 기록 미작성" : ""}${feePending(l, d) ? " · 차감 미결정" : ""}`;
                  }
                  return (
                    <button type="button" key={l.id} onClick={() => onPick(l)}
                      className="w-full flex items-center gap-2 text-left"
                      aria-label={`${hm(v.start)} ${name} ${sub2}`}
                      style={{ minHeight: 48, padding: "8px 10px", marginBottom: 4, borderRadius: 8,
                        border: `1px solid ${T.border}`, background: T.surface }}>
                      <span className="tnum shrink-0" style={{ fontSize: 14, fontWeight: 600, color: T.ink, width: 44 }}>
                        {hm(v.start)}
                      </span>
                      <span className="flex-1 min-w-0 block">
                        <span className="block truncate" style={{ fontSize: 14, color: T.ink }}>
                          {l.type === "personal_event" ? <CalendarDays size={12} color={T.gcal} style={{ display: "inline", marginRight: 4 }} /> : null}
                          {name}
                        </span>
                        {sub2 ? <span className="block" style={{ fontSize: 12, color: T.ink2 }}>{sub2}</span> : null}
                      </span>
                      <ChevronRight size={16} color={T.ink2} className="shrink-0" />
                    </button>
                  );
                })}
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ── 시트 공용: 시간 변경·삭제 진입 행 (P0-1·2) ── */
function EditRow({ onEdit }) {
  return (
    <button type="button" onClick={onEdit}
      className="w-full flex items-center justify-between"
      style={{ minHeight: 40, marginBottom: 8, padding: "0 2px" }}>
      <span className="flex items-center gap-1.5" style={{ fontSize: 13, color: T.ink2 }}>
        <Pencil size={13} /> 시간 변경 · 삭제
      </span>
      <ChevronRight size={14} color={T.ink2} />
    </button>
  );
}

/* ─────────────────────────── 개인·듀엣 시트 ─────────────────────────── */
function LessonSheet({ lesson, view, detail, members, onClose, onEdit, onSetAttendee, onFee, onRecord, onNoComment, onVoice, onOpenMember }) {
  const [pickWrite, setPickWrite] = useState(false);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [seqOpen, setSeqOpen] = useState(false);
  useEffect(() => { setPickWrite(false); setWriting(false); setText(""); setSeqOpen(false); }, [lesson.id]);

  const list = att(detail);
  const st = privateStatus(detail);
  const notes = list.flatMap((a) => members[a.memberId]?.cautions || []).slice(0, 2);

  const StatusChips = ({ a }) => (
    <div className="flex gap-1 shrink-0">
      {a.status === "booked" ? (
        <>
          <button type="button" onClick={() => onSetAttendee(a.memberId, "done")} aria-label="출석"
            style={{ height: 34, padding: "0 10px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: T.a600, color: "#fff" }}>출석</button>
          <button type="button" onClick={() => onSetAttendee(a.memberId, "noshow")} aria-label="노쇼"
            style={{ height: 34, padding: "0 9px", borderRadius: 8, fontSize: 13, border: `1px solid ${T.borderStrong}`, color: T.ink }}>노쇼</button>
          <button type="button" onClick={() => onSetAttendee(a.memberId, "cancel")} aria-label="취소"
            style={{ height: 34, padding: "0 9px", borderRadius: 8, fontSize: 13, color: T.ink2 }}>취소</button>
        </>
      ) : a.status === "noshow" && a.deducted === null ? (
        <>
          <button type="button" onClick={() => onFee(a.memberId, true)}
            style={{ height: 34, padding: "0 10px", borderRadius: 8, fontSize: 13, border: `1px solid ${T.borderStrong}` }}>1회 차감</button>
          <button type="button" onClick={() => onFee(a.memberId, false)}
            style={{ height: 34, padding: "0 9px", borderRadius: 8, fontSize: 13, color: T.ink2 }}>차감 안 함</button>
        </>
      ) : (
        <span className="flex items-center gap-1" style={{ fontSize: 12, fontWeight: 500,
          color: a.status === "done" ? T.good : a.status === "noshow" ? T.bad : T.ink2 }}>
          {a.status === "done" ? <Check size={13} /> : null}
          {a.status === "done" ? (a.deducted ? "출석 · 차감" : "출석") :
            a.status === "noshow" ? (a.deducted ? "노쇼 · 차감" : "노쇼 · 차감 없음") : "취소"}
          <button type="button" onClick={() => onSetAttendee(a.memberId, "booked")}
            style={{ marginLeft: 4, fontSize: 12, color: T.ink2, textDecoration: "underline" }}>변경</button>
        </span>
      )}
    </div>
  );

  return (
    <Sheet title={`${hm(view.start)} ${lesson.type === "duet" ? "듀엣" : "개인레슨"}`}
      sub={`${DOW[dowOf(view.date)]} ${mmdd(view.date)} · ${view.dur}분`} onClose={onClose}>
      <EditRow onEdit={onEdit} />
      <div className="flex flex-col" style={{ gap: 6 }}>
        {list.map((a) => {
          const m = members[a.memberId];
          return (
            <div key={a.memberId} className="flex items-center gap-2"
              style={{ padding: "8px 10px", background: T.sunken, borderRadius: 8, border: `1px solid ${T.border}`,
                opacity: a.status === "cancel" ? 0.6 : 1 }}>
              <span className="shrink-0" style={{ width: 8, height: 8, borderRadius: 4, background: idColor(a.memberId) }} />
              <button type="button" onClick={() => onOpenMember(a.memberId)}
                className="flex-1 min-w-0 text-left" style={{ minHeight: 34 }}>
                <span className="block truncate" style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>{m ? m.name : "회원"}</span>
                <span className="block tnum" style={{ fontSize: 12,
                  color: m && m.membership.remainingCount <= 3 ? T.warn : T.ink2 }}>
                  잔여 {m ? m.membership.remainingCount : "-"}회{m && m.membership.remainingCount <= 3 ? " · 재등록 필요" : ""}
                </span>
              </button>
              <StatusChips a={a} />
            </div>
          );
        })}
      </div>

      {notes.length ? (
        <div className="flex flex-wrap gap-1" style={{ marginTop: 8 }}>
          {notes.map((nt) => (
            <span key={nt} className="flex items-center gap-1"
              style={{ fontSize: 12, fontWeight: 500, color: T.warn, background: T.warnS, borderRadius: 6, padding: "3px 8px" }}>
              <AlertCircle size={11} /> {nt}
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ borderTop: `1px solid ${T.border}`, margin: "14px 0" }} />

      {st === "done" ? (
        detail.record ? (
          <div style={{ fontSize: 13, color: T.ink2, background: T.sunken, borderRadius: 8, padding: "10px 12px" }}>{detail.record}</div>
        ) : writing ? (
          <div className="flex flex-col gap-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
              onFocus={kbSafe} aria-label="수업 기록" placeholder="오늘 수업 기록을 입력하세요"
              style={{ width: "100%", background: T.sunken, border: `1px solid ${T.border}`, borderRadius: 8,
                padding: 12, fontSize: 15, color: T.ink, resize: "none" }} />
            <Btn kind="primary" full onClick={() => onRecord(text)}>기록 저장</Btn>
          </div>
        ) : pickWrite ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Btn grow onClick={() => { if (!onVoice(lesson)) setWriting(true); }}><Mic size={16} /> AI 음성기록</Btn>
              <Btn grow onClick={() => setWriting(true)}><Pencil size={15} /> 직접 입력</Btn>
            </div>
            <Btn kind="muted" full onClick={() => setPickWrite(false)}>뒤로</Btn>
          </div>
        ) : (
          <div className="flex gap-2">
            <Btn kind="primary" grow onClick={() => setPickWrite(true)}>기록하기</Btn>
            <Btn kind="muted" onClick={onNoComment}>노코멘트</Btn>
          </div>
        )
      ) : (
        <p style={{ fontSize: 13, color: T.ink2 }}>
          {st === "booked" ? "출석을 처리하면 기록을 작성할 수 있습니다." :
            st === "noshow" ? "노쇼 처리된 수업입니다." : "취소된 수업입니다."}
        </p>
      )}

      <div style={{ borderTop: `1px solid ${T.border}`, margin: "14px 0" }} />
      <button type="button" onClick={() => setSeqOpen(!seqOpen)} aria-expanded={seqOpen}
        className="w-full flex items-center justify-between" style={{ minHeight: 46, padding: "4px 0" }}>
        <span className="flex items-center gap-2 text-left">
          <Sparkles size={15} color={T.a600} aria-hidden="true" />
          <span className="block">
            <span className="block" style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>AI 시퀀스 추천</span>
            <span className="block" style={{ fontSize: 12, color: T.ink2 }}>최근 기록과 주의사항 기반</span>
          </span>
        </span>
        {seqOpen ? <ChevronUp size={16} color={T.ink2} /> : <ChevronDown size={16} color={T.ink2} />}
      </button>
      {seqOpen ? (
        <div className="flex flex-col gap-2" style={{ paddingBottom: 4 }}>
          <div className="flex flex-wrap gap-1">
            {(notes.length ? ["어깨", "흉추", "골반"] : ["코어", "호흡"]).map((p) => (
              <span key={p} style={{ fontSize: 12, fontWeight: 500, color: T.a600, background: T.a100,
                border: `1px solid ${T.a200}`, borderRadius: 6, padding: "3px 8px" }}>{p}</span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: T.ink2 }}>
            {notes.length ? `최근 기록의 "${notes[0]}" 코멘트 기반 추천` : "최근 수행 기록 기반 기본 추천"}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

/* ─────────────────────────── §6 그룹 시트 ───────────────────────────
 * P1-8: 종료 전에도 체크 허용(시작 시 체크 관행).  P0-7: 체크 후 '미체크로 되돌리기'. */
function GroupSheet({ lesson, view, g, ended, onSave, onEdit, onClose }) {
  const [saved, setSaved] = useState(false);
  const savedT = useRef(null);
  useEffect(() => () => clearTimeout(savedT.current), []);
  const change = (n) => {
    onSave(setAttended(g, n));
    setSaved(true);
    clearTimeout(savedT.current);
    savedT.current = setTimeout(() => setSaved(false), 1400);
  };
  const ph = groupPhase(g, ended);

  return (
    <Sheet title={`${hm(view.start)} 그룹수업`}
      sub={`${DOW[dowOf(view.date)]} ${mmdd(view.date)} · ${view.dur}분 · 정원 ${g.capacity}명`} onClose={onClose}>
      <EditRow onEdit={onEdit} />
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3" style={{ background: T.sunken, borderRadius: 8,
          border: `1px solid ${T.border}`, padding: "10px 12px" }}>
          <div className="flex-1">
            <div className="tnum" style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>
              {g.reservedCount != null ? `예약 ${g.reservedCount} / 정원 ${g.capacity}` : `정원 ${g.capacity}명 · 예약 정보 없음`}
            </div>
            <div style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>
              {ph === "not_required_yet" ? "수업 전이에요 · 시작할 때 미리 체크해도 됩니다"
                : ph === "needs_check" ? "수업이 끝났습니다 · 인원 체크가 필요합니다"
                : g.attendanceCheckedAt ? `체크 완료 · ${g.attendanceCheckedAt.slice(11, 16)}` : "체크 완료"}
            </div>
          </div>
          {ph === "needs_check" ? (
            <span className="shrink-0" style={{ width: 8, height: 8, borderRadius: 4, background: T.a600 }} />
          ) : ph === "checked" ? <Check size={16} color={T.good} className="shrink-0" /> : null}
        </div>

        <CountStepper value={g.attendedCount} onChange={change} saved={saved} />
        {g.walkInCount > 0 ? (
          <p className="tnum" style={{ fontSize: 12, color: T.ink2, textAlign: "center" }}>
            현장 참여 {g.walkInCount}명 포함{g.noShowCount != null && g.noShowCount > 0 ? ` · 결석 ${g.noShowCount}명` : ""}
          </p>
        ) : g.noShowCount != null && g.attendedCount != null ? (
          <p className="tnum" style={{ fontSize: 12, color: T.ink2, textAlign: "center" }}>
            {g.noShowCount > 0 ? `결석 ${g.noShowCount}명` : "예약 인원 전원 참석"}
          </p>
        ) : null}
        <p style={{ fontSize: 12, color: T.ink2, textAlign: "center" }}>
          {g.attendedCount == null ? "인원을 입력하면 즉시 저장됩니다 · 회원 명단은 예약 연동 시 자동" : "변경 즉시 자동 저장됩니다"}
        </p>
        {ph === "checked" ? (
          <button type="button" onClick={() => onSave(setAttended(g, null))}
            style={{ fontSize: 12, color: T.ink2, textDecoration: "underline", minHeight: 32, alignSelf: "center" }}>
            미체크로 되돌리기
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ─────────────────────────── Google 일정 시트 ─────────────────────────── */
function GoogleEventSheet({ lesson, view, overlap, onClose }) {
  return (
    <Sheet title={lesson.title || "Google 일정"} sub={`${DOW[dowOf(view.date)]} ${mmdd(view.date)} · ${hm(view.start)}–${hm(view.start + view.dur)}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2" style={{ fontSize: 13, color: T.ink2 }}>
          <CalendarDays size={15} color={T.gcal} /> Google Calendar 일정입니다. 수정은 Google Calendar에서 해주세요.
        </div>
        {overlap ? (
          <div className="flex items-start gap-2" style={{ background: T.warnS, borderRadius: 8, padding: "10px 12px" }}>
            <AlertCircle size={15} color={T.warn} className="shrink-0" style={{ marginTop: 1 }} />
            <span style={{ fontSize: 13, color: T.warn }}>이 시간에 수업이 함께 잡혀 있습니다. 일정 충돌을 확인하세요.</span>
          </div>
        ) : null}
        <div className="tnum" style={{ fontSize: 12, color: T.ink3 }}>
          동기화 상태: {lesson.sync.syncStatus === "synced" ? "동기화됨" : lesson.sync.syncStatus}
          {lesson.sync.lastSyncedAt ? ` · 마지막 동기화 ${lesson.sync.lastSyncedAt.slice(11, 16)}` : ""}
        </div>
      </div>
    </Sheet>
  );
}

/* ─────────────────────────── P0-1·2·3 편집 시트 — 시간·정원 변경 + 2단계 삭제 ─────────────────────────── */
function EditSheet({ lesson, view, hours, group, onSave, onDelete, onClose }) {
  const TYPE_LABEL = { private: "개인레슨", duet: "듀엣", group: "그룹수업", consultation: "상담", time_off: "휴무" };
  const [h, setH] = useState(Math.floor(view.start / 60));
  const [m, setM] = useState(view.start % 60 - ((view.start % 60) % 15));
  const [dur, setDur] = useState(view.dur);
  const [cap, setCap] = useState(group ? group.capacity : 8);
  const [confirmDel, setConfirmDel] = useState(false);
  const input = { height: 44, width: "100%", background: T.sunken, border: `1px solid ${T.border}`,
    borderRadius: 8, padding: "0 12px", fontSize: 15, color: T.ink };
  const lab = (t2) => <div style={{ fontSize: 12, fontWeight: 500, color: T.ink2, marginBottom: 4 }}>{t2}</div>;
  const hourOpts = [];
  for (let x = hours.lo; x < hours.hi; x++) hourOpts.push(x);
  const durOpts = Array.from(new Set([30, 45, 50, 60, 90, view.dur])).sort((a, b) => a - b);
  const changed = h * 60 + m !== view.start || dur !== view.dur || (group && cap !== group.capacity);

  return (
    <Sheet title={`${TYPE_LABEL[lesson.type] || "일정"} 수정`}
      sub={`${DOW[dowOf(view.date)]} ${mmdd(view.date)} · 현재 ${hm(view.start)}–${hm(view.start + view.dur)}`}
      onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          {lab("시작 시간")}
          <div className="flex gap-2">
            <select value={h} onChange={(e) => setH(+e.target.value)} className="tnum" aria-label="시" style={{ ...input, flex: 1 }}>
              {hourOpts.map((x) => <option key={x} value={x}>{pad(x)}시</option>)}
            </select>
            <select value={m} onChange={(e) => setM(+e.target.value)} className="tnum" aria-label="분" style={{ ...input, flex: 1 }}>
              {[0, 15, 30, 45].map((x) => <option key={x} value={x}>{pad(x)}분</option>)}
            </select>
            <select value={dur} onChange={(e) => setDur(+e.target.value)} className="tnum" aria-label="길이" style={{ ...input, flex: 1 }}>
              {durOpts.map((x) => <option key={x} value={x}>{x}분</option>)}
            </select>
          </div>
        </div>
        {group ? (
          <div>
            {lab("정원")}
            <div className="flex gap-2">
              {Array.from(new Set([4, 6, 8, 10, group.capacity])).sort((a, b) => a - b).map((c) => (
                <button type="button" key={c} onClick={() => setCap(c)} aria-pressed={cap === c}
                  style={{ flex: 1, height: 40, borderRadius: 8, fontSize: 14, fontWeight: cap === c ? 600 : 500,
                    color: cap === c ? T.a600 : T.ink2, background: cap === c ? T.a100 : T.surface,
                    border: `1px solid ${cap === c ? T.a200 : T.borderStrong}` }}>{c}명</button>
              ))}
            </div>
          </div>
        ) : null}
        {lesson.sync && lesson.sync.externalEventId ? (
          <p style={{ fontSize: 12, color: T.ink2 }}>
            Google Calendar 로 내보낸 일정입니다. 변경·삭제 시 다음 동기화에서 원격에도 반영됩니다.
          </p>
        ) : null}
        <Btn kind="primary" full disabled={!changed}
          onClick={() => onSave({ start: h * 60 + m, dur, capacity: group ? cap : undefined })}>
          변경 저장
        </Btn>

        <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 4, paddingTop: 12 }}>
          {!confirmDel ? (
            <Btn kind="muted" full onClick={() => setConfirmDel(true)}>이 일정 삭제</Btn>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2" style={{ background: T.badS, borderRadius: 8, padding: "10px 12px" }}>
                <AlertCircle size={15} color={T.bad} className="shrink-0" style={{ marginTop: 1 }} />
                <span style={{ fontSize: 13, color: T.bad }}>
                  이 일정과 연결된 출석·기록 데이터가 함께 삭제됩니다. 되돌릴 수 없습니다.
                </span>
              </div>
              <div className="flex gap-2">
                <Btn kind="danger" grow onClick={onDelete}>삭제 확정</Btn>
                <Btn grow onClick={() => setConfirmDel(false)}>취소</Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ─────────────────────────── 등록 시트 (P1-13: 15분 단위 + 45/90분) ─────────────────────────── */
function RegisterSheet({ date, min, hours, preset, onClose, onCreate }) {
  const [type, setType] = useState("private");
  const [n1, setN1] = useState(preset ? preset.name : ""); const [n2, setN2] = useState("");
  const [cap, setCap] = useState(8);
  const [h, setH] = useState(Math.floor(min / 60));
  const [m, setM] = useState(min % 60 - ((min % 60) % 15));
  const [dur, setDur] = useState(50);
  const input = { height: 44, width: "100%", background: T.sunken, border: `1px solid ${T.border}`,
    borderRadius: 8, padding: "0 12px", fontSize: 15, color: T.ink };
  const lab = (t2) => <div style={{ fontSize: 12, fontWeight: 500, color: T.ink2, marginBottom: 4 }}>{t2}</div>;
  const seg = (v, cur, set, label) => (
    <button type="button" key={String(v)} onClick={() => set(v)} aria-pressed={cur === v}
      style={{ flex: 1, height: 40, borderRadius: 8, fontSize: 14, fontWeight: cur === v ? 600 : 500,
        color: cur === v ? T.a600 : T.ink2, background: cur === v ? T.a100 : T.surface,
        border: `1px solid ${cur === v ? T.a200 : T.borderStrong}` }}>{label}</button>
  );
  const hourOpts = [];
  for (let x = hours.lo; x < hours.hi; x++) hourOpts.push(x);

  return (
    <Sheet title="일정 등록" sub={`${DOW[dowOf(date)]} ${mmdd(date)}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          {lab("시작 시간")}
          <div className="flex gap-2">
            <select value={h} onChange={(e) => setH(+e.target.value)} className="tnum" aria-label="시" style={{ ...input, flex: 1 }}>
              {hourOpts.map((x) => <option key={x} value={x}>{pad(x)}시</option>)}
            </select>
            <select value={m} onChange={(e) => setM(+e.target.value)} className="tnum" aria-label="분" style={{ ...input, flex: 1 }}>
              {[0, 15, 30, 45].map((x) => <option key={x} value={x}>{pad(x)}분</option>)}
            </select>
            <select value={dur} onChange={(e) => setDur(+e.target.value)} className="tnum" aria-label="길이" style={{ ...input, flex: 1 }}>
              {[30, 45, 50, 60, 90].map((x) => <option key={x} value={x}>{x}분</option>)}
            </select>
          </div>
        </div>
        <div>
          {lab("유형")}
          <div className="flex gap-2">
            {seg("private", type, setType, "개인")}
            {seg("duet", type, setType, "듀엣")}
            {seg("group", type, setType, "그룹")}
          </div>
          <div className="flex gap-2" style={{ marginTop: 6 }}>
            {seg("consultation", type, setType, "상담")}
            {seg("time_off", type, setType, "휴무")}
          </div>
        </div>
        {type === "private" || type === "duet" ? (
          <div className="flex flex-col gap-2">
            {lab(type === "duet" ? "회원 2명 (같은 이름은 기존 회원으로 연결)" : "회원 (같은 이름은 기존 회원으로 연결)")}
            {preset ? (
              <p style={{ fontSize: 12, color: preset.paused ? T.warn : T.ink2, margin: 0 }}>
                {preset.paused
                  ? `홀딩 중인 회원 '${preset.name}'입니다 · 등록은 가능하며 홀딩 해제는 회원 상세에서 할 수 있어요`
                  : `기존 회원 '${preset.name}'으로 연결됩니다`}
              </p>
            ) : null}
            <input value={n1} onChange={(e) => setN1(e.target.value)} onFocus={kbSafe}
              placeholder="회원 이름" aria-label="회원 이름" style={input} />
            {type === "duet" ? (
              <input value={n2} onChange={(e) => setN2(e.target.value)} onFocus={kbSafe}
                placeholder="회원 이름 (2)" aria-label="회원 이름 2" style={input} />
            ) : null}
          </div>
        ) : type === "group" ? (
          <div>
            {lab("정원")}
            <div className="flex gap-2">{[4, 6, 8, 10].map((c) => seg(c, cap, setCap, `${c}명`))}</div>
            <p style={{ fontSize: 12, color: T.ink2, marginTop: 6 }}>
              그룹수업은 인원수로만 기록합니다. 예약 인원은 예약 시스템 연동 시 자동 반영됩니다.
            </p>
          </div>
        ) : null}
        <Btn kind="primary" full onClick={() => onCreate({ date, start: h * 60 + m, dur, type, names: [n1, n2], cap })}>
          등록
        </Btn>
      </div>
    </Sheet>
  );
}

/* ─────────────────────────── 처리 큐 ───────────────────────────
 * 기록: 저장 = 완결 → 자동 다음.  그룹: 홀드 + [다음 업무].  P0-5 노쇼 차감: 회원별 즉결. */
function QueueSheet({ items, members, getGroupItem, onSaveRecord, onNoComment, onVoice, onSaveGroup, onFee, onClose }) {
  const [heldId, setHeldId] = useState(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const savedT = useRef(null);
  useEffect(() => () => clearTimeout(savedT.current), []);

  const held = heldId ? getGroupItem(heldId) : null;         // 체크돼 큐에서 빠져도 계속 표시
  const cur = held || items[0] || null;
  const remaining = items.filter((x) => !held || x.l.id !== held.l.id).length;
  useEffect(() => { setWriting(false); setText(""); }, [cur ? cur.l.id : "none"]);

  const changeGroup = (item, n) => {
    onSaveGroup(item.l, setAttended(item.g, n));
    if (heldId !== item.l.id) setHeldId(item.l.id);
    setSaved(true);
    clearTimeout(savedT.current);
    savedT.current = setTimeout(() => setSaved(false), 1200);
  };

  return (
    <Sheet title="처리할 업무"
      sub={cur ? (held ? `이번 건 저장됨 · 남은 ${remaining}건` : `남은 ${items.length}건 · 최근 4주`) : null}
      onClose={onClose}>
      {!cur ? (
        <div className="flex flex-col gap-3">
          <p style={{ fontSize: 15, color: T.ink }}>최근 4주 기록·인원 체크·차감 결정을 모두 마쳤습니다.</p>
          <Btn kind="primary" full onClick={onClose}>닫기</Btn>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div style={{ background: T.sunken, borderRadius: 8, padding: "10px 12px", border: `1px solid ${T.border}` }}>
            <div className="tnum" style={{ fontSize: 13, color: T.ink2 }}>
              {DOW[dowOf(cur.v.date)]} {mmdd(cur.v.date)} · {hm(cur.v.start)}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.ink, marginTop: 2 }}>
              {cur.kind === "group" ? "그룹수업 · 인원 체크"
                : cur.kind === "fee" ? `${att(cur.d).map((a) => members[a.memberId]?.name).filter(Boolean).join(" · ")} · 노쇼 차감 결정`
                : att(cur.d).map((a) => members[a.memberId]?.name).filter(Boolean).join(" · ")}
            </div>
          </div>
          {cur.kind === "group" ? (
            <>
              <CountStepper value={cur.g.attendedCount} saved={saved}
                onChange={(n) => changeGroup(cur, n)} />
              {cur.g.walkInCount > 0 ? (
                <p className="tnum" style={{ fontSize: 12, color: T.ink2, textAlign: "center" }}>
                  현장 참여 {cur.g.walkInCount}명 포함
                </p>
              ) : null}
              {cur.g.attendedCount != null ? (
                <Btn kind="primary" full
                  onClick={() => { setHeldId(null); if (!remaining) onClose(); }}>
                  {remaining ? `다음 업무 (남은 ${remaining}건)` : "완료 · 닫기"}
                </Btn>
              ) : (
                <p style={{ fontSize: 12, color: T.ink2, textAlign: "center" }}>인원을 입력하면 즉시 저장됩니다</p>
              )}
            </>
          ) : cur.kind === "fee" ? (
            <>
              {att(cur.d).filter((a) => a.status === "noshow" && a.deducted === null).map((a) => {
                const mm = members[a.memberId];
                return (
                  <div key={a.memberId} className="flex items-center gap-2"
                    style={{ padding: "8px 10px", background: T.sunken, borderRadius: 8, border: `1px solid ${T.border}` }}>
                    <span className="flex-1 min-w-0 truncate" style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>
                      {mm ? mm.name : "회원"} <span style={{ fontWeight: 500, color: T.bad }}>· 노쇼</span>
                    </span>
                    <button type="button" onClick={() => onFee(cur.l, a.memberId, true)}
                      style={{ height: 36, padding: "0 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                        background: T.a600, color: "#fff" }}>1회 차감</button>
                    <button type="button" onClick={() => onFee(cur.l, a.memberId, false)}
                      style={{ height: 36, padding: "0 10px", borderRadius: 8, fontSize: 13,
                        border: `1px solid ${T.borderStrong}`, color: T.ink }}>차감 안 함</button>
                  </div>
                );
              })}
              <p style={{ fontSize: 12, color: T.ink2 }}>결정하면 다음 업무로 자동 이동합니다</p>
            </>
          ) : writing ? (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
                onFocus={kbSafe} aria-label="수업 기록" placeholder="수업 기록을 입력하세요"
                style={{ width: "100%", background: T.sunken, border: `1px solid ${T.border}`, borderRadius: 8,
                  padding: 12, fontSize: 15, color: T.ink, resize: "none" }} />
              <Btn kind="primary" full onClick={() => onSaveRecord(cur.l, text)}>기록 저장</Btn>
            </>
          ) : (
            <div className="flex gap-2">
              <Btn grow onClick={() => { if (!onVoice(cur.l)) setWriting(true); }}><Mic size={16} /> AI 음성기록</Btn>
              <Btn grow onClick={() => setWriting(true)}><Pencil size={15} /> 직접 입력</Btn>
              <Btn kind="muted" onClick={() => onNoComment(cur.l)}>노코멘트</Btn>
            </div>
          )}
          {cur.kind === "record" ? (
            <p style={{ fontSize: 12, color: T.ink2 }}>저장하면 다음 업무로 자동 이동합니다</p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

/* ─────────────────────────── 캘린더 연동 시트 (§8) ─────────────────────────── */
function CalendarSheet({ g, conflicts, onConnect, onDisconnect, onSyncNow, onToggle, onTitleMode, onPickConflict, onClose, syncing }) {
  const Row = ({ children }) => (
    <div className="flex items-center justify-between" style={{ minHeight: 48, borderBottom: `1px solid ${T.lineFaint}` }}>
      {children}
    </div>
  );
  const Toggle = ({ on, onClick, label }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className="shrink-0"
      style={{ width: 44, height: 26, borderRadius: 13, background: on ? T.a600 : T.borderStrong, position: "relative" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 10,
        background: "#fff", transition: "left .15s" }} />
    </button>
  );
  return (
    <Sheet title="Google Calendar 연동" onClose={onClose} wide>
      {!g.connected ? (
        <div className="flex flex-col gap-3">
          <p style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
            Google 일정을 시간표에 함께 표시하고, 필라티쳐 수업을 Google Calendar에 자동으로 만듭니다.
          </p>
          <Btn kind="primary" full onClick={onConnect}><Link2 size={15} /> Google 계정 연결</Btn>
          <p style={{ fontSize: 11, color: T.ink3 }}>데모: 실제 앱에서는 Google 로그인 창이 열립니다.</p>
        </div>
      ) : (
        <div className="flex flex-col">
          <Row>
            <span className="min-w-0">
              <span className="block" style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>{g.account}</span>
              <span className="block tnum" style={{ fontSize: 12, color: T.ink2 }}>
                {g.lastSyncedAt ? `마지막 동기화 ${g.lastSyncedAt.slice(11, 16)}` : "아직 동기화 안 함"}
              </span>
            </span>
            <button type="button" onClick={onSyncNow} disabled={syncing} aria-label="지금 동기화"
              className="flex items-center gap-1 shrink-0"
              style={{ height: 36, padding: "0 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                color: T.a600, border: `1px solid ${T.a200}`, background: T.a50, opacity: syncing ? 0.6 : 1 }}>
              <RefreshCw size={13} /> 지금 동기화
            </button>
          </Row>

          {conflicts.length ? (
            <Row>
              <span className="flex items-center gap-2" style={{ fontSize: 14, color: T.warn }}>
                <AlertCircle size={15} /> 동기화 충돌 {conflicts.length}건
              </span>
              <button type="button" onClick={() => onPickConflict(conflicts[0])}
                style={{ fontSize: 13, fontWeight: 600, color: T.a600, height: 44, padding: "0 8px" }}>해결하기</button>
            </Row>
          ) : null}

          <Row>
            <span style={{ fontSize: 14, color: T.ink }}>Google → 필라티쳐 (일정 가져오기)</span>
            <Toggle on={g.importOn} onClick={() => onToggle("importOn")} label="가져오기" />
          </Row>
          <Row>
            <span style={{ fontSize: 14, color: T.ink }}>필라티쳐 → Google (수업 내보내기)</span>
            <Toggle on={g.exportOn} onClick={() => onToggle("exportOn")} label="내보내기" />
          </Row>

          <div style={{ padding: "12px 0 4px" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.ink2, marginBottom: 6 }}>
              내보내는 제목 (개인정보 보호)
            </div>
            <div className="flex gap-2">
              {[["full", "회원명"], ["masked", "일부 마스킹"], ["generic", "개인레슨으로만"]].map(([v, label]) => (
                <button type="button" key={v} onClick={() => onTitleMode(v)} aria-pressed={g.titleMode === v}
                  style={{ flex: 1, height: 40, borderRadius: 8, fontSize: 13,
                    fontWeight: g.titleMode === v ? 600 : 500,
                    color: g.titleMode === v ? T.a600 : T.ink2,
                    background: g.titleMode === v ? T.a100 : T.surface,
                    border: `1px solid ${g.titleMode === v ? T.a200 : T.borderStrong}` }}>{label}</button>
              ))}
            </div>
          </div>

          <div style={{ paddingTop: 12 }}>
            <Btn kind="muted" full onClick={onDisconnect}><CloudOff size={15} /> 연결 해제 (토큰 폐기)</Btn>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function ScheduleSettingsSheet({ hours, setHours, foldOn, setFoldOn, sunOn, setSunOn, onOpenCalendar, onClose }) {
  const input = { height: 44, background: T.sunken, border: `1px solid ${T.border}`, borderRadius: 8,
    padding: "0 12px", fontSize: 15, color: T.ink, flex: 1 };
  const Switch = ({ on, onClick, label }) => (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} aria-label={label}
      className="shrink-0" style={{ marginTop: 2, width: 48, height: 28, borderRadius: 14,
        background: on ? T.a600 : T.borderStrong, position: "relative" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 22, height: 22,
        borderRadius: 11, background: "#fff", transition: "left .15s" }} />
    </button>
  );
  return (
    <Sheet title="일정 설정" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>센터 운영시간</div>
          <p style={{ fontSize: 12, color: T.ink2, margin: "4px 0 8px" }}>
            시간표가 이 범위로 자동 생성됩니다. 범위 밖 일정이 있으면 자동으로 넓혀 표시합니다.
          </p>
          <div className="flex items-center gap-2">
            <select value={hours.open} onChange={(e) => setHours({ ...hours, open: +e.target.value })}
              className="tnum" aria-label="운영 시작" style={input}>
              {Array.from({ length: 16 }).map((_, i) => <option key={i} value={i + 5}>{pad(i + 5)}:00</option>)}
            </select>
            <span style={{ color: T.ink2 }}>–</span>
            <select value={hours.close} onChange={(e) => setHours({ ...hours, close: +e.target.value })}
              className="tnum" aria-label="운영 종료" style={input}>
              {Array.from({ length: 17 }).map((_, i) => <option key={i} value={i + 8}>{pad(i + 8)}:00</option>)}
            </select>
          </div>
        </div>

        {/* P0-4: 일요일 수업 센터 지원 */}
        <div className="flex items-start gap-3" style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
          <div className="flex-1">
            <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>일요일 표시</div>
            <p style={{ fontSize: 12, color: T.ink2, marginTop: 4 }}>
              일요일 수업이 있는 센터용 7일 시간표입니다. 화면이 좁은 기기에서는 열이 조금 축소됩니다.
            </p>
          </div>
          <Switch on={sunOn} onClick={() => setSunOn(!sunOn)} label="일요일 표시" />
        </div>

        <div className="flex items-start gap-3" style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
          <div className="flex-1">
            <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>빈 시간 접기</div>
            <p style={{ fontSize: 12, color: T.ink2, marginTop: 4 }}>
              모든 요일이 비어 있는 2시간 이상 구간을 압축합니다. 현재 시각·다음 수업 구간은 접지 않습니다.
            </p>
          </div>
          <Switch on={foldOn} onClick={() => setFoldOn(!foldOn)} label="빈 시간 접기" />
        </div>

        <button type="button" onClick={onOpenCalendar} className="flex items-center justify-between"
          style={{ minHeight: 52, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
          <span className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>
            <CalendarClock size={17} color={T.ink2} /> Google Calendar 연동
          </span>
          <ChevronRight size={16} color={T.ink2} />
        </button>
      </div>
    </Sheet>
  );
}

function MoreSheet({ onClose, onGo, onSettings, onRegister }) {
  const rows = [
    { k: "일정 등록", d: "새 수업 · 상담 · 휴무 추가", I: Plus, act: onRegister },     // P1-12: 키보드·발견성 진입점
    { k: "기록", d: "회원별 수업·변화 기록", I: FileText },
    { k: "월간 리포트", d: "이달 수업 · 성과 · 예상 급여", I: BarChart3 },
    { k: "일정 설정", d: "운영시간 · 일요일 · 빈 시간 접기 · 캘린더", I: Settings, act: onSettings },
    { k: "데이터 인계 · 백업", d: "기기 이동 · 백업 파일", I: Share2 },
    { k: "오늘의 지식", d: "해부학 · 영양학 모아보기", I: BookOpen },
  ];
  return (
    <Sheet title="더보기" onClose={onClose}>
      <div className="flex flex-col">
        {rows.map(({ k, d, I, act }) => (
          <button type="button" key={k} onClick={() => (act ? act() : onGo(k))}
            className="flex items-center gap-3 text-left"
            style={{ minHeight: 56, borderBottom: `1px solid ${T.lineFaint}` }}>
            <I size={19} color={T.ink2} strokeWidth={1.6} className="shrink-0" />
            <span className="flex-1 min-w-0 block">
              <span className="block" style={{ fontSize: 15, fontWeight: 500, color: T.ink }}>{k}</span>
              <span className="block truncate" style={{ fontSize: 12, color: T.ink2 }}>{d}</span>
            </span>
            <ChevronRight size={16} color={T.ink2} className="shrink-0" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ═══════════════════════════ App Shell ═══════════════════════════ */
export default function App() {
  /* §12: 저장소·서비스는 UI 밖에서 조립 — Firebase 교체 시 이 블록만 바꾼다 */
  const infra = useRef(null);
  if (!infra.current) {
    const store = createStore();
    const lessonRepo = createLessonRepository(store);
    const attendanceRepo = createAttendanceRepository(store);
    const bookingRepo = createBookingRepository();
    const googleProvider = createGoogleCalendarProvider(store);
    const externalProvider = createMockExternalProvider();
    const syncService = createCalendarSyncService(store, googleProvider, lessonRepo);
    const memberRepo = createMemberRepository(store);
    const assessmentRepo = createBodyAssessmentRepository(store);
    infra.current = { store, lessonRepo, attendanceRepo, bookingRepo, memberRepo, assessmentRepo,
      googleProvider, externalProvider, syncService };
  }
  const { store, lessonRepo, attendanceRepo, memberRepo, assessmentRepo,
    googleProvider, syncService } = infra.current;

  const now = useCurrentTime();                          // 1분(경계 정렬) + visibilitychange
  const todayS = dstr(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const [ver, setVer] = useState(0);                     // store 변경 → 리렌더
  const bump = useCallback(() => setVer((v) => v + 1), []);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => { const n0 = new Date(); seedMembers(store, n0); await seedStore(store, lessonRepo, n0); setReady(true); })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [tab, setTab] = useState("schedule");
  /* v5: 회원은 store 단일 출처 — 스케줄 코드 호환용 id→Member 미러 맵 */
  const members = useMemo(() => {
    const o = {}; store.members.forEach((v, k) => { o[k] = v; }); return o;
  }, [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const [memberId, setMemberId] = useState(null);                 // 회원 탭: null=목록, id=상세
  /* v8 체형분석 화면 상태(§13) — list / mode_select / photo_capture / detail / complete */
  const [assessmentScreen, setAssessmentScreen] = useState("list");
  const [analysisMemberId, setAnalysisMemberId] = useState(null);
  const [activeAssessmentId, setActiveAssessmentId] = useState(null);
  const lastMemberRef = useRef(null);                             // 목록 복귀 시 포커스 복원용
  const [hours, setHours] = useState({ open: 9, close: 22 });
  const [foldOn, setFoldOn] = useState(true);
  const [sunOn, setSunOn] = useState(false);             // P0-4
  const [expanded, setExpanded] = useState(new Set());
  const [offset, setOffset] = useState(0);
  const [sheet, setSheet] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const toastT = useRef(null);
  useEffect(() => () => clearTimeout(toastT.current), []);
  const say = useCallback((m) => {
    setToast(m);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), 2400);
  }, []);

  /* Android 뒤로가기 — 마운트 1회 등록. 최신 상태는 ref 로 조회 → 히스토리 스택 증식 없음. */
  const backRef = useRef({ sheet: null, tab: "schedule", memberId: null, aScreen: "list" });
  useEffect(() => { backRef.current = { sheet, tab, memberId, aScreen: assessmentScreen }; },
    [sheet, tab, memberId, assessmentScreen]);
  useEffect(() => {
    const onBack = () => {
      const b = backRef.current;
      if (b.sheet) { setSheet(null); return true; }
      if (b.tab === "analysis" && b.aScreen !== "list") { setAssessmentScreen("list"); return true; } // v8: 분석 → 목록
      if (b.tab === "members" && b.memberId) { setMemberId(null); return true; }   // v5: 상세 → 목록
      if (b.tab !== "schedule") { setTab("schedule"); return true; }
      return false;
    };
    let remove = null;
    try {
      const cap = typeof window !== "undefined" && window.Capacitor;
      const plug = cap && cap.Plugins && cap.Plugins.App;
      if (plug && plug.addListener) {
        const h = plug.addListener("backButton", () => { if (!onBack()) plug.exitApp && plug.exitApp(); });
        remove = () => { h && h.remove ? h.remove() : (h && h.then && h.then((x) => x.remove())); };
      }
    } catch (e) { /* noop */ }
    const onPop = () => { if (onBack()) { try { window.history.pushState(null, ""); } catch (_) { /* noop */ } } };
    try { window.history.pushState(null, ""); window.addEventListener("popstate", onPop); } catch (_) { /* noop */ }
    return () => {
      try { window.removeEventListener("popstate", onPop); } catch (_) { /* noop */ }
      if (remove) remove();
    };
  }, []); // ← 마운트 1회

  /* ── VM: 이번 주 조회 (테넌트·강사 필터는 Repository 가 보장 §3·§4) ── */
  const nDays = sunOn ? 7 : 6;
  const monday = addDays(mondayOf(now), offset * 7);
  const days = useMemo(
    () => Array.from({ length: nDays }).map((_, i) => dstr(addDays(monday, i))),
    [todayS, offset, nDays]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekKey = days[0];
  const lastDay = days[days.length - 1];

  const [weekLessons, setWeekLessons] = useState([]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    lessonRepo.getLessons({
      ...TENANT, instructorId: ME,
      from: days[0] + "T00:00:00", to: lastDay + "T23:59:59",
    }).then((ls) => { if (live) setWeekLessons(ls); });
    return () => { live = false; };
  }, [ready, weekKey, ver, nDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const views = useMemo(() => weekLessons.map((l) => ({ l, v: viewOf(l) })), [weekLessons]);
  const viewByDay = useMemo(() => {
    const m = {};
    views.forEach((x) => { (m[x.v.date] = m[x.v.date] || []).push(x); });
    return m;
  }, [views]);

  const detailOf = useCallback((id) => store.privates.get(id) || null, [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupOf = useCallback((id) => store.groups.get(id) || null, [ver]);    // eslint-disable-line react-hooks/exhaustive-deps
  const getGroupItem = useCallback((id) => {
    const l = store.lessons.find((x) => x.id === id);
    if (!l || l.type !== "group") return null;
    const g = store.groups.get(id);
    if (!g) return null;
    return { kind: "group", l, v: viewOf(l), g };
  }, [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const googleState = useMemo(() => ({ ...store.google }), [ver]);             // P2-18: 변이 객체 스냅샷
  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── v5: 회원 파생 데이터 (단일 출처: store) ── */
  const nowIso = `${todayS}T${hm(nowMin)}:00`;
  const statsOf = useMemo(() => {
    const cache = new Map();
    return (id) => {
      if (!cache.has(id)) cache.set(id, memberLessonStats(store, id, nowIso));
      return cache.get(id);
    };
  }, [ver, nowIso]); // eslint-disable-line react-hooks/exhaustive-deps
  const memberList = useMemo(() => Object.values(members).filter((m) =>
    m.organizationId === TENANT.organizationId && m.studioId === TENANT.studioId && m.status !== "inactive"),
    [members]);
  const curM = memberId ? members[memberId] : null;
  const memberLedger = useMemo(() => memberId
    ? store.membershipLedger.filter((e) => e.memberId === memberId)
        .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    : [], [ver, memberId]); // eslint-disable-line react-hooks/exhaustive-deps
  const memberAssessments = useMemo(() => (memberId && store.assessments.get(memberId)) || [],
    [ver, memberId]); // eslint-disable-line react-hooks/exhaustive-deps
  const assessOf = useCallback((mid) => [...(store.assessments.get(mid) || [])]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  /* UI용 동기 중복 탐색 — 로직은 repo.findByName 과 동일(trim·정확 일치·inactive 제외·테넌트 격리) */
  const findDupe = useCallback((name) => {
    const t = (name || "").trim();
    if (!t) return null;
    return Object.values(members).find((m) =>
      m.organizationId === TENANT.organizationId && m.studioId === TENANT.studioId &&
      m.status !== "inactive" && m.name === t) || null;
  }, [members]);

  const range = useMemo(() => gridRange(hours, views.map((x) => x.v)), [hours, views]);
  const byHour = useMemo(() => {
    const m = new Map();
    views.forEach(({ v }) => {
      const h = Math.floor(v.start / 60);
      if (!m.has(h)) m.set(h, []);
      m.get(h).push(v);
    });
    return m;
  }, [views]);

  const endedOf = useCallback(
    (v, ds) => ds < todayS || (ds === todayS && v.start + v.dur <= nowMin), [todayS, nowMin]);

  /* 다음 수업 (오늘, 수업류만) */
  const next = useMemo(() => {
    const todays = (viewByDay[todayS] || []).filter(({ l }) =>
      ["private", "duet", "group", "consultation"].includes(l.type));
    const cand = todays
      .filter(({ l, v }) => {
        if (v.start + v.dur <= nowMin) return false;
        if (l.type === "group" || l.type === "consultation") return true;
        return privateStatus(detailOf(l.id)) === "booked";
      })
      .sort((a, b) => a.v.start - b.v.start);
    return cand[0] || null;
  }, [viewByDay, todayS, nowMin, detailOf]);

  /* 처리 큐: 미작성 기록 + 그룹 인원체크 + 노쇼 차감 결정 (최근 4주)
   * 규모 검토: 6주 시드 × 하루 30수업 ≈ 1,260건 선형 스캔/분 — 병목 아님.
   * Firebase 전환 시 needsRecord/needs_check/feePending 플래그 쿼리로 대체. */
  const queue = useMemo(() => {
    if (!ready) return [];
    const from = dstr(addDays(now, -28));
    const out = [];
    for (const l of store.lessons) {
      if (l.organizationId !== TENANT.organizationId || l.studioId !== TENANT.studioId || l.instructorId !== ME) continue;
      const v = viewOf(l);
      if (v.date < from || v.date > todayS) continue;
      if (!endedOf(v, v.date)) continue;
      if (l.type === "group") {
        const g = store.groups.get(l.id);
        if (g && groupPhase(g, true) === "needs_check") out.push({ kind: "group", l, v, g });
      } else if (l.type === "private" || l.type === "duet") {
        const d = store.privates.get(l.id);
        if (feePending(l, d)) out.push({ kind: "fee", l, v, d });          // P0-5
        if (needsRecord(l, d)) out.push({ kind: "record", l, v, d });
      }
    }
    return out.sort((a, b) => (a.v.date === b.v.date ? b.v.start - a.v.start : a.v.date < b.v.date ? 1 : -1));
  }, [ready, ver, todayS, nowMin, endedOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const conflicts = useMemo(
    () => store.lessons.filter((l) => l.sync && l.sync.syncStatus === "conflict"), [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlaps = useMemo(() => syncService.detectOverlaps(weekLessons), [weekLessons, syncService]);

  const protectHours = useMemo(() => {
    const s = new Set();
    if (days.includes(todayS)) s.add(Math.floor(nowMin / 60));    // 현재 시간 구간 접기 금지
    if (next) s.add(Math.floor(next.v.start / 60));
    return s;
  }, [weekKey, todayS, nowMin, next]); // eslint-disable-line react-hooks/exhaustive-deps

  const L = useMemo(() => buildLayout({ range, byHour, foldOn, protectHours, expanded }),
    [range, byHour, foldOn, protectHours, expanded]);

  /* 열 폭 — P0-4: 7일 모드에서는 최소 열폭 38px 허용 */
  const wrapRef = useRef(null);
  const gridWrapRef = useRef(null);
  const [cw, setCw] = useState(390);
  const [gridH, setGridH] = useState(0);
  useEffect(() => {
    const m = () => {
      if (wrapRef.current) setCw(wrapRef.current.clientWidth);
      if (gridWrapRef.current) setGridH(gridWrapRef.current.clientHeight);
    };
    m(); window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, [tab]);
  const usable = Math.max(220, cw - AXIS - PADX * 2);
  const tIdx = days.indexOf(todayS);
  const colWidths = useMemo(() => {
    const mc = nDays === 7 ? 38 : MIN_COL;
    const base = usable / nDays;
    if (tIdx < 0) return Array(nDays).fill(base);
    const tw = Math.min(base * 1.2, usable - (nDays - 1) * mc);
    const ow = (usable - tw) / (nDays - 1);
    if (ow < mc || tw < mc) return Array(nDays).fill(base);
    return Array.from({ length: nDays }, (_, i) => (i === tIdx ? tw : ow));
  }, [usable, tIdx, nDays]);
  const lefts = useMemo(() => { const a = []; let x = 0; for (const w of colWidths) { a.push(x); x += w; } return a; }, [colWidths]);

  /* ── 액션 (전부 useCallback 안정화) ── */
  /* v5 §5: 잔여 조정은 반드시 원장(adjustMembership) 경유 — 사유·수업 연결 기록, 음수 클램프.
   * deducted 플래그는 잔여 0이어도 유지(결정 기록) — 클램프 사실은 토스트로 표면화. */
  const setAttendee = useCallback(async (lesson, mid, status) => {
    const d = store.privates.get(lesson.id);
    if (!d) return;
    const prev = att(d).find((a) => a.memberId === mid);
    d.attendees = att(d).map((a) => a.memberId === mid
      ? { ...a, status, deducted: status === "done" ? true : null } : a);
    await lessonRepo.savePrivateDetail(d);
    let blocked = false;
    if (prev && prev.deducted && status !== "done")
      await memberRepo.adjustMembership(mid, 1, "lesson", { lessonId: lesson.id, note: "출석 변경 복원" });
    if (status === "done" && !(prev && prev.deducted)) {
      const r = await memberRepo.adjustMembership(mid, -1, "lesson", { lessonId: lesson.id });
      blocked = !!(r && r.blocked);
    }
    bump();
    if (status === "done") say(blocked ? "출석 처리 · 잔여 0회 — 재등록 필요" : "출석 처리 · 1회 차감");
    if (status === "cancel") say("수업 취소 · 차감 없음");
  }, [lessonRepo, memberRepo, bump, say]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFee = useCallback(async (lesson, mid, yes) => {
    const d = store.privates.get(lesson.id);
    if (!d) return;
    d.attendees = att(d).map((a) => a.memberId === mid ? { ...a, deducted: yes } : a);
    await lessonRepo.savePrivateDetail(d);
    let blocked = false;
    if (yes) {
      const r = await memberRepo.adjustMembership(mid, -1, "noshow", { lessonId: lesson.id });
      blocked = !!(r && r.blocked);
    }
    bump();
    say(yes ? (blocked ? "노쇼 처리 · 잔여 0회 — 차감 불가" : "노쇼 1회 차감") : "차감 없이 처리");
  }, [lessonRepo, memberRepo, bump, say]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRecord = useCallback(async (lesson, text) => {
    const d = store.privates.get(lesson.id);
    if (!d) return;
    d.record = (text || "").trim() || "작성 완료";
    await lessonRepo.savePrivateDetail(d);
    bump(); say("수업 기록 저장");
  }, [lessonRepo, bump, say]); // eslint-disable-line react-hooks/exhaustive-deps
  const noComment = useCallback(async (lesson) => {
    const d = store.privates.get(lesson.id);
    if (!d) return;
    d.record = "특이사항 없음";
    await lessonRepo.savePrivateDetail(d);
    bump(); say("노코멘트로 기록");
  }, [lessonRepo, bump, say]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveGroup = useCallback(async (lesson, g) => {
    await attendanceRepo.saveGroupAttendance(g);
    bump();
  }, [attendanceRepo, bump]);
  const onVoice = useCallback((lesson) => {
    try {
      const api = typeof window !== "undefined" && window.__pilateacher;
      if (api && typeof api.voiceNote === "function") { api.voiceNote(lesson); return true; }
    } catch (e) { /* noop */ }
    say("데모: 실제 앱에서는 기존 AI 음성기록이 열립니다");
    return false;
  }, [say]);
  /* P0-6/v5: 같은 이름은 memberRepo.findByName 으로 기존 회원 연결 — 중복 생성 방지.
   * 테넌트·inactive 필터는 repo 가 보장. 홀딩 중 회원 포함 등록은 허용하되 토스트로 안내(해제는 회원 상세에서). */
  const createLesson = useCallback(async ({ date, start, dur, type, names, cap }) => {
    let attendees, pausedIn = false;
    if (type === "private" || type === "duet") {
      const list = [];
      for (const raw of names) {
        const t = (raw || "").trim();
        if (!t) continue;
        const exist = await memberRepo.findByName({ ...TENANT, name: t });
        const mem = exist || await memberRepo.createMember({ name: t });  // 데모 기본 10회권
        if (!list.some((x) => x.id === mem.id)) list.push(mem);
      }
      if (!list.length) list.push(await memberRepo.createMember({ name: "회원" }));
      pausedIn = list.some((x) => x.status === "paused");
      attendees = list.map((x) => ({ memberId: x.id, status: "booked", deducted: null }));
    }
    await lessonRepo.createLesson({ date, start, dur, type,
      title: type === "group" ? "그룹수업" : type === "consultation" ? "상담" : type === "time_off" ? "휴무" : "",
      capacity: cap, reservedCount: null, attendees });
    bump(); setSheet(null);
    say(type === "group" ? `그룹수업 등록 (정원 ${cap}명)`
      : type === "time_off" ? "휴무 등록"
      : pausedIn ? "등록 완료 · 홀딩 중인 회원이 포함되어 있어요" : "등록되었습니다");
  }, [lessonRepo, memberRepo, bump, say]);
  /* P0-1: 시간·정원 변경 */
  const editLesson = useCallback(async ({ id, date, start, dur, capacity }) => {
    await lessonRepo.updateLesson(id, { startAt: isoAt(date, start), endAt: isoAt(date, start + dur) });
    if (capacity != null) {
      const g = store.groups.get(id);
      if (g) await attendanceRepo.saveGroupAttendance({ ...g, capacity });
    }
    bump(); setSheet(null); say("일정이 변경되었습니다");
  }, [lessonRepo, attendanceRepo, bump, say]); // eslint-disable-line react-hooks/exhaustive-deps
  /* P0-2: 삭제 — Google 로 내보낸 일정이면 원격·매핑까지 정리 */
  const removeLesson = useCallback(async (l) => {
    try {
      if (l.sync && l.sync.externalEventId) {
        await googleProvider.deleteLesson(l.sync.externalEventId);
        store.syncIndex.delete(l.sync.externalEventId);
      }
    } catch (e) { /* 원격 실패해도 로컬 삭제는 진행 */ }
    await lessonRepo.deleteLesson(l.id);
    bump(); setSheet(null); say("일정이 삭제되었습니다");
  }, [lessonRepo, googleProvider, bump, say]); // eslint-disable-line react-hooks/exhaustive-deps
  /* P1-14: 실패 표시 */
  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const range2 = { from: days[0] + "T00:00:00", to: lastDay + "T23:59:59" };
      const imp = await syncService.importFromGoogle(range2);
      const exp = await syncService.exportToGoogle(range2,
        (detail) => att(detail).map((a) => (members[a.memberId] || {}).name).filter(Boolean));
      bump();
      say(`동기화 완료 · 가져옴 ${imp.created + imp.updated} · 내보냄 ${exp.created + exp.updated}` +
        (imp.conflicts ? ` · 충돌 ${imp.conflicts}` : ""));
    } catch (e) {
      say("동기화 실패 · 잠시 후 다시 시도해주세요");
    } finally {
      setSyncing(false);
    }
  }, [days, lastDay, members, syncService, bump, say]);

  const expandFold = useCallback((startH) => setExpanded((p) => { const n = new Set(p); n.add(startH); return n; }), []);
  const openLesson = useCallback((l) => {
    if (l.type === "personal_event") setSheet({ kind: "gcal", id: l.id });
    else if (l.type === "group") setSheet({ kind: "group", id: l.id });
    else if (l.type === "private" || l.type === "duet") setSheet({ kind: "lesson", id: l.id });
    else setSheet({ kind: "edit", id: l.id });                       // P0-3: 상담·휴무 = 편집 직결
  }, []);
  const onPickEmpty = useMemo(() => ({
    create: (date, min) => setSheet({ kind: "register", date, min }),
    swipe: (dir) => { setOffset((o) => o + dir); setExpanded(new Set()); },
  }), []);
  /* P1-12: 더보기 → 일정 등록 (오늘 · 다음 30분 슬롯) */
  const openRegisterQuick = useCallback(() => {
    const base = Math.max(range.lo * 60, Math.min(range.hi * 60 - 30, Math.ceil((nowMin + 15) / 30) * 30));
    setSheet({ kind: "register", date: todayS, min: base });
  }, [range, nowMin, todayS]);

  /* ── v5: 회원 탭 액션 ── */
  const openMemberDetail = useCallback((id) => {
    lastMemberRef.current = id; setMemberId(id); setTab("members");
  }, []);
  /* ═══ v8 체형분석 1단계 핸들러 — 촬영 등록·초안 저장 흐름 ═══
   * 회원 선택 → 방식 선택 → 사진 등록(파일 업로드) → 임시 저장 / 분석 준비 완료.
   * 실제 AI 인식·측정·해석은 다음 단계(§ 다음 단계 연결 지점 주석 참조). */
  const baBusy = useRef(false);                      // 저장 중 중복 클릭 방지
  /* App 종료·개발 중 재마운트 시 남은 objectURL을 모두 해제한다. */
  useEffect(() => () => baRevokeAllPhotos(), []);
  const withBusy = useCallback(async (fn, failMsg) => {
    if (baBusy.current) return;
    baBusy.current = true;
    try { await fn(); }
    catch (e) { say(failMsg || "저장에 실패했어요 · 다시 시도해주세요"); }
    finally { baBusy.current = false; }
  }, [say]);
  /** 회원 상세 퀵 버튼·이력 빈 상태에서 진입 — 해당 회원 선택 상태로 시작 화면 */
  const startAssessment = useCallback((mid) => {
    setAnalysisMemberId(mid);
    setActiveAssessmentId(null);
    setAssessmentScreen("mode_select");
    setTab("analysis");
  }, []);
  const openAssessmentDetail = useCallback((aid) => {
    setActiveAssessmentId(aid);
    setAssessmentScreen("detail");
    setTab("analysis");
  }, []);
  const backToAssessmentList = useCallback(() => {
    setAssessmentScreen("list");
    setActiveAssessmentId(null);
  }, []);
  /** 방식 선택 후 '다음' — 이 시점에 초안 생성(§4) 후 촬영 화면으로 */
  const startCaptureWithMode = useCallback((mid, mode) => withBusy(async () => {
    const d = await assessmentRepo.createAssessmentDraft(mid, mode);
    bump();
    setActiveAssessmentId(d.id);
    setAssessmentScreen("photo_capture");
  }, "초안 생성에 실패했어요"), [assessmentRepo, bump, withBusy]);
  /** 사진 등록·교체 — File 객체는 저장하지 않고 objectURL + 메타데이터만(§5) */
  const upsertAssessmentPhoto = useCallback((aid, dir, file) => withBusy(async () => {
    const a = await assessmentRepo.getAssessment(aid);
    if (!a || !file) return;
    const previous = a.photos[dir];
    const meta = baMakePhotoMeta(dir, file);
    try {
      const saved = await assessmentRepo.updateAssessment(aid, {
        photos: { ...a.photos, [dir]: meta },
        ...(a.status === "ready_for_analysis" ? { status: "draft" } : {}),
      });
      if (!saved) throw new Error("체형분석 초안을 찾을 수 없습니다.");
    } catch (e) {
      baRevokePhoto(meta);
      throw e;
    }
    if (previous) baRevokePhoto(previous);             // 저장 성공 후 기존 URL 해제
    bump();
    say(`${BA_DIR_KO[dir]} 사진을 등록했어요`);
  }), [assessmentRepo, bump, say, withBusy]);
  const removeAssessmentPhoto = useCallback((aid, dir) => withBusy(async () => {
    const a = await assessmentRepo.getAssessment(aid);
    if (!a || !a.photos[dir]) return;
    const removed = a.photos[dir];
    const saved = await assessmentRepo.updateAssessment(aid, {
      photos: { ...a.photos, [dir]: null },
      ...(a.status === "ready_for_analysis" ? { status: "draft" } : {}),
    });
    if (!saved) throw new Error("체형분석 초안을 찾을 수 없습니다.");
    baRevokePhoto(removed);                            // 저장 성공 후 URL 해제
    bump();
    say(`${BA_DIR_KO[dir]} 사진을 삭제했어요`);
  }), [assessmentRepo, bump, say, withBusy]);
  /** 임시 저장 — 사진 상태는 이미 저장돼 있으므로 확인 토스트 후 목록 복귀(§7) */
  const tempSaveAssessment = useCallback(() => {
    say("체형분석 초안을 저장했어요.");
    backToAssessmentList();
  }, [say, backToAssessmentList]);
  /** 분석 준비 완료 — 3방향 모두 등록 시에만(버튼 활성 조건과 이중 방어) */
  const markReadyForAnalysis = useCallback((aid) => withBusy(async () => {
    const a = await assessmentRepo.getAssessment(aid);
    if (!a || BA_DIRS.some((d) => !a.photos[d])) {
      say("정면, 측면, 후면 사진을 모두 등록해주세요.");
      return;
    }
    await assessmentRepo.updateAssessment(aid, { status: "ready_for_analysis" });
    bump();
    setAssessmentScreen("complete");
  }), [assessmentRepo, bump, say, withBusy]);
  const resumeCapture = useCallback((a) => {
    setAnalysisMemberId(a.memberId);
    setActiveAssessmentId(a.id);
    setAssessmentScreen("photo_capture");
    setTab("analysis");
  }, []);
  /** 초안 삭제(2단계 확인은 상세 화면에서) — objectURL 정리 포함 */
  const deleteAssessmentDraft = useCallback((aid) => withBusy(async () => {
    const a = await assessmentRepo.getAssessment(aid);
    const okDel = await assessmentRepo.deleteAssessmentDraft(aid);
    if (okDel && a) BA_DIRS.forEach((d) => a.photos[d] && baRevokePhoto(a.photos[d]));
    bump();
    say(okDel ? "초안을 삭제했어요" : "초안만 삭제할 수 있어요");
    backToAssessmentList();
  }, "삭제에 실패했어요"), [assessmentRepo, bump, say, withBusy, backToAssessmentList]);
  const saveInstructorMemo = useCallback((aid, memo) => withBusy(async () => {
    await assessmentRepo.updateAssessment(aid, { instructorMemo: memo });
    bump();
    say("메모를 저장했어요");
  }), [assessmentRepo, bump, say, withBusy]);
  const registerMember = useCallback(async (input) => {
    const mem = await memberRepo.createMember(input);
    bump(); setSheet(null); say("회원이 등록되었습니다");
    openMemberDetail(mem.id);
  }, [memberRepo, bump, say, openMemberDetail]);
  const saveMember = useCallback(async (mid, ch) => {
    await memberRepo.updateMember(mid, ch);
    bump(); setSheet(null); say("회원 정보가 수정되었습니다");
  }, [memberRepo, bump, say]);
  /* 하드 삭제 금지 — 보관(inactive) 전환. 수업·기록·원장·분석 이력은 남는다(고아 방지). */
  const archiveMember = useCallback(async (mid) => {
    await memberRepo.deactivateMember(mid);
    bump(); setSheet(null); setMemberId(null);
    say("회원을 보관 처리했습니다 · 수업 기록은 유지됩니다");
  }, [memberRepo, bump, say]);
  /* v6: 홀딩 — 예정 수업은 자동 취소하지 않는다(HoldSheet 에서 안내만) */
  const holdMember = useCallback(async (mid, input) => {
    await memberRepo.setHold(mid, input);
    bump(); setSheet(null);
    say(input.extendDays > 0 ? `홀딩 시작 · 만료일 ${input.extendDays}일 연장` : "홀딩이 시작되었습니다");
  }, [memberRepo, bump, say]);
  const releaseHold = useCallback(async (mid) => {
    await memberRepo.releaseHold(mid, todayS);
    bump();
    say("홀딩 해제 · 활성으로 전환되었습니다");
  }, [memberRepo, bump, say, todayS]);
  const manualAdjust = useCallback(async (mid, delta, reason, note) => {
    const r = await memberRepo.adjustMembership(mid, delta, reason, { note, changedBy: ME });
    bump(); setSheet(null);
    say(r && r.blocked ? "잔여 0회 — 더 차감할 수 없습니다" : "이용권이 조정되었습니다");
  }, [memberRepo, bump, say]);
  const addMemo = useCallback(async (mid, text) => {
    const m = store.members.get(mid);
    if (!m) return;
    const memo = { id: `memo_${Date.now().toString(36)}`, text: text.trim(), createdAt: new Date().toISOString() };
    await memberRepo.updateMember(mid, { memos: [memo, ...(m.memos || [])] });
    bump(); setSheet(null); say("상담 메모가 저장되었습니다");
  }, [memberRepo, bump, say]); // eslint-disable-line react-hooks/exhaustive-deps
  /* §4: 수업 기록 작성 — 기록 가능한 수업 0건=안내, 1건=바로 열기, 여러 건=선택 시트 */
  const openRecordFlow = useCallback((mid) => {
    const s = statsOf(mid);
    if (!s.recordable.length) { say("기록 가능한 완료 수업이 없습니다"); return; }
    if (s.recordable.length === 1) setSheet({ kind: "lesson", id: s.recordable[0].l.id });
    else setSheet({ kind: "recpick" });
  }, [statsOf, say]);
  /* §4: 회원 상세 → 일정 등록 (해당 회원 미리 선택) */
  const openRegisterForMember = useCallback((mid) => {
    const base = Math.max(range.lo * 60, Math.min(range.hi * 60 - 30, Math.ceil((nowMin + 15) / 30) * 30));
    setSheet({ kind: "register", date: todayS, min: base, presetId: mid });
  }, [range, nowMin, todayS]);

  /* 액션바 — 진행 중/다음 수업 → 처리 큐 → 완료 (P1-9) */
  const ab = useMemo(() => {
    if (next) {
      const l = next.l;
      let name, sub;
      if (l.type === "group") {
        const g = groupOf(l.id);
        name = "그룹수업"; sub = g && g.reservedCount != null ? `예약 ${g.reservedCount}/${g.capacity}` : `정원 ${g ? g.capacity : "-"}`;
      } else if (l.type === "consultation") { name = "상담"; sub = ""; }
      else {
        const d = detailOf(l.id);
        name = att(d).map((a) => members[a.memberId]?.name).filter(Boolean).join(", ");
        sub = l.type === "duet" ? "듀엣" : "개인";
      }
      return { kind: "next", lesson: l, time: hm(next.v.start), name, sub,
        note: next.v.start <= nowMin ? "진행 중" : "다음 수업" };
    }
    if (queue.length) return { kind: "queue", name: `처리할 업무 ${queue.length}건`, note: "기록 · 인원체크 · 차감 결정" };
    return { kind: "clear", name: "이번 주 일정 완료", note: "빈 시간을 탭하거나 더보기에서 일정을 추가합니다" };
  }, [next, queue, members, detailOf, groupOf, nowMin]);

  const sheetLesson = sheet && ["lesson", "group", "gcal", "edit"].includes(sheet.kind)
    ? store.lessons.find((l) => l.id === sheet.id) : null;
  const sheetGroup = sheetLesson && (sheet.kind === "group" || (sheet.kind === "edit" && sheetLesson.type === "group"))
    ? groupOf(sheetLesson.id) : null;
  const conflictLesson = sheet && sheet.kind === "conflict"
    ? store.lessons.find((l) => l.id === sheet.id) : null;

  const NAV = [
    { k: "schedule", t: "일정", I: CalendarDays },
    { k: "members", t: "회원", I: Users },
    { k: "analysis", t: "체형", I: Ruler },
    { k: "more", t: "더보기", I: MoreHorizontal },
  ];

  return (
    <div className="w-full flex justify-center"
      style={{ minHeight: "100vh", background: T.sunken,
        fontFamily: 'Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif' }}>
      <style>{CSS}</style>
      <div className="w-full flex flex-col app-h" style={{ maxWidth: 420, background: T.bg, wordBreak: "keep-all" }}>

        {tab === "schedule" ? (
          <>
            <header className="flex items-center shrink-0" ref={wrapRef}
              style={{ height: 44, background: T.surface, borderBottom: `1px solid ${T.border}`,
                padding: "0 6px", paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "content-box" }}>
              <button type="button" aria-label="이전 주"
                onClick={() => { setOffset((o) => o - 1); setExpanded(new Set()); }}
                className="flex items-center justify-center" style={{ width: 40, height: 40, color: T.ink2 }}>
                <ChevronLeft size={19} />
              </button>
              <div className="tnum" style={{ fontSize: 13, fontWeight: 500, color: T.ink }}>
                {mmdd(days[0])}–{mmdd(lastDay)}
              </div>
              <button type="button" aria-label="다음 주"
                onClick={() => { setOffset((o) => o + 1); setExpanded(new Set()); }}
                className="flex items-center justify-center" style={{ width: 40, height: 40, color: T.ink2 }}>
                <ChevronRight size={19} />
              </button>
              {googleState.connected ? (
                <span role="img" aria-label="Google Calendar 연결됨" className="flex items-center" style={{ marginLeft: 2 }}>
                  <CalendarDays size={13} color={T.gcal} />
                </span>
              ) : null}
              <div className="flex-1" />
              <button type="button" onClick={() => { setOffset(0); setExpanded(new Set()); }}
                disabled={offset === 0} aria-label="오늘로 이동"
                style={{ height: 34, padding: "0 10px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  color: offset === 0 ? T.ink3 : T.a600, opacity: offset === 0 ? 0.55 : 1 }}>오늘</button>
              <button type="button" aria-label="목록 보기" onClick={() => setSheet({ kind: "list" })}
                className="flex items-center justify-center" style={{ width: 40, height: 40, color: T.ink2 }}>
                <List size={18} />
              </button>
              <button type="button" aria-label="더보기 메뉴" onClick={() => setSheet({ kind: "more" })}
                className="flex items-center justify-center" style={{ width: 40, height: 40, color: T.ink2 }}>
                <MoreHorizontal size={18} />
              </button>
            </header>

            <div className="flex shrink-0" style={{ height: 32, background: T.surface,
              borderBottom: `1px solid ${T.border}`, padding: `0 ${PADX}px` }}>
              <div style={{ width: AXIS }} />
              {days.map((ds, i) => {
                const isT = ds === todayS;
                return (
                  <div key={ds} className="flex flex-col items-center justify-center" style={{ width: colWidths[i] }}>
                    <span className="tnum" style={{ fontSize: 12, fontWeight: isT ? 600 : 500,
                      color: isT ? T.a600 : T.ink2 }}>{DOW[i]} {+ds.slice(8)}</span>
                    {isT ? <span aria-hidden="true" style={{ width: 16, height: 2, background: T.a600, borderRadius: 1, marginTop: 2 }} /> : null}
                  </div>
                );
              })}
            </div>

            <main className="flex-1 min-h-0 flex flex-col" ref={gridWrapRef}>
              {ready ? (
                <WeekGrid
                  L={L} range={range} days={days} todayS={todayS} viewByDay={viewByDay}
                  members={members} detailOf={detailOf} groupOf={groupOf}
                  nextId={next ? next.l.id : null} nowMin={nowMin} gridH={gridH}
                  colWidths={colWidths} lefts={lefts} sheetOpen={!!sheet} weekKey={weekKey}
                  onPickLesson={openLesson}
                  onPickEmpty={onPickEmpty}
                  onExpandFold={expandFold}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center" style={{ color: T.ink2, fontSize: 13 }}>
                  일정을 불러오는 중…
                </div>
              )}
            </main>

            {/* 액션바: 카드 컨테이너 + 형제 버튼(본체/배지) */}
            <div className="shrink-0" style={{ padding: "6px 12px 8px", background: T.bg }}>
              <div className="w-full flex items-center gap-2"
                style={{ height: 56, background: ab.kind === "queue" ? T.a50 : T.surface,
                  border: `1px solid ${ab.kind === "queue" ? T.a200 : T.border}`, borderRadius: 12,
                  boxShadow: "0 1px 4px rgba(28,36,51,0.06)", padding: "0 12px" }}>
                {ab.kind === "clear" ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="flex items-center justify-center shrink-0"
                      style={{ width: 22, height: 22, borderRadius: 11, background: T.a100, color: T.a600 }}>
                      <Check size={12} />
                    </span>
                    <span className="min-w-0 block">
                      <span className="block truncate" style={{ fontSize: 15, fontWeight: 600, color: T.ink2 }}>{ab.name}</span>
                      <span className="block truncate" style={{ fontSize: 11, color: T.ink2, marginTop: 1 }}>{ab.note}</span>
                    </span>
                  </div>
                ) : (
                  <button type="button"
                    onClick={() => {
                      if (ab.kind === "next") openLesson(ab.lesson);
                      else setSheet({ kind: "queue" });
                    }}
                    aria-label={ab.kind === "next" ? `${ab.note} ${ab.time} ${ab.name} 열기` : `${ab.name} 처리하기`}
                    className="flex items-center gap-2 text-left flex-1 min-w-0"
                    style={{ height: "100%" }}>
                    <span className="flex items-center justify-center shrink-0"
                      style={{ width: 22, height: 22, borderRadius: 11, background: T.a100, color: T.a600 }}>
                      {ab.kind === "queue" ? <Pencil size={11} /> : <Play size={10} fill={T.a600} />}
                    </span>
                    <span className="flex-1 min-w-0 block">
                      <span className="flex items-baseline gap-1.5">
                        {ab.time ? <span className="tnum shrink-0" style={{ fontSize: 17, fontWeight: 600, color: T.a600 }}>{ab.time}</span> : null}
                        <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>{ab.name}</span>
                        {ab.sub ? <span className="shrink-0 tnum" style={{ fontSize: 12, color: T.ink2 }}>· {ab.sub}</span> : null}
                      </span>
                      <span className="block truncate" style={{ fontSize: 11, color: T.ink2, marginTop: 1 }}>{ab.note}</span>
                    </span>
                  </button>
                )}
                {ab.kind === "next" && queue.length ? (
                  <button type="button" onClick={() => setSheet({ kind: "queue" })}
                    aria-label={`처리할 업무 ${queue.length}건 열기`}
                    className="flex items-center gap-1 shrink-0 tnum"
                    style={{ height: 28, padding: "0 9px", borderRadius: 7, background: T.a100, color: T.a600,
                      border: `1px solid ${T.a200}`, fontSize: 12, fontWeight: 600 }}>
                    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: T.a600 }} />
                    업무 {queue.length}
                  </button>
                ) : ab.kind === "queue" ? (
                  <span className="shrink-0" style={{ fontSize: 12, fontWeight: 600, color: T.a600 }}>지금 처리</span>
                ) : null}
              </div>
            </div>
          </>
        ) : tab === "members" ? (
          curM ? (
            <MemberDetail m={curM} stats={statsOf(curM.id)} ledger={memberLedger}
              assessments={memberAssessments} todayS={todayS}
              onBack={() => setMemberId(null)}
              onEdit={() => setSheet({ kind: "medit" })}
              onRecord={() => openRecordFlow(curM.id)}
              onRegisterLesson={() => openRegisterForMember(curM.id)}
              onAssess={() => startAssessment(curM.id)}
              onOpenAssessment={(aid) => openAssessmentDetail(aid)}
              onMembership={() => setSheet({ kind: "mship" })}
              onHold={() => setSheet({ kind: "hold" })}
              onRelease={() => releaseHold(curM.id)}
              onMemo={() => setSheet({ kind: "memo" })}
              onOpenLesson={(l) => setSheet({ kind: "lesson", id: l.id })} />
          ) : (
            <MemberList list={memberList} statsOf={statsOf} todayS={todayS}
              initialFocusId={lastMemberRef.current}
              onOpen={openMemberDetail}
              onRegister={() => setSheet({ kind: "mreg" })} />
          )
        ) : (
          /* v8 [체형] 탭 — §13 단일 화면 상태로 전환 */
          <BodyAssessmentTab
            screen={assessmentScreen}
            memberList={memberList}
            members={members}
            assessOf={assessOf}
            analysisMemberId={analysisMemberId}
            activeAssessmentId={activeAssessmentId}
            onStart={startAssessment}
            onOpenDetail={openAssessmentDetail}
            onBackToList={backToAssessmentList}
            onPickMode={startCaptureWithMode}
            onUpsertPhoto={upsertAssessmentPhoto}
            onRemovePhoto={removeAssessmentPhoto}
            onTempSave={tempSaveAssessment}
            onReady={markReadyForAnalysis}
            onResume={resumeCapture}
            onDeleteDraft={deleteAssessmentDraft}
            onSaveMemo={saveInstructorMemo}
            onOpenMember={(mid) => openMemberDetail(mid)} />
        )}

        <nav className="flex shrink-0" aria-label="주요 화면"
          style={{ height: 49, background: T.surface, borderTop: `1px solid ${T.border}`,
            paddingBottom: "env(safe-area-inset-bottom, 0px)", boxSizing: "content-box" }}>
          {NAV.map(({ k, t, I }) => {
            const on = tab === k;
            return (
              <button type="button" key={k} aria-current={on ? "page" : undefined} aria-label={t}
                onClick={() => { if (k === "more") setSheet({ kind: "more" }); else setTab(k); }}
                className="flex-1 flex flex-col items-center justify-center gap-0.5"
                style={{ color: on ? T.a600 : T.ink2 }}>
                <span className="relative flex items-center justify-center">
                  <I size={20} strokeWidth={on ? 2.2 : 1.7} />
                  {on ? <span aria-hidden="true" className="absolute"
                    style={{ bottom: -3, width: 18, height: 2, background: T.a600, borderRadius: 1 }} /> : null}
                </span>
                <span style={{ fontSize: 10, fontWeight: on ? 700 : 500 }}>{t}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── 시트 ── */}
      {sheetLesson && sheet.kind === "lesson" ? (
        <LessonSheet lesson={sheetLesson} view={viewOf(sheetLesson)} detail={detailOf(sheetLesson.id)}
          members={members} onClose={() => setSheet(null)}
          onEdit={() => setSheet({ kind: "edit", id: sheetLesson.id })}
          onSetAttendee={(mid, st) => setAttendee(sheetLesson, mid, st)}
          onFee={(mid, yes) => setFee(sheetLesson, mid, yes)}
          onRecord={(t2) => setRecord(sheetLesson, t2)}
          onNoComment={() => noComment(sheetLesson)}
          onVoice={onVoice}
          onOpenMember={(mid) => { setSheet(null); openMemberDetail(mid); }} />
      ) : null}

      {sheetLesson && sheet.kind === "group" && sheetGroup ? (
        <GroupSheet lesson={sheetLesson} view={viewOf(sheetLesson)} g={sheetGroup}
          ended={endedOf(viewOf(sheetLesson), viewOf(sheetLesson).date)}
          onSave={(g2) => saveGroup(sheetLesson, g2)}
          onEdit={() => setSheet({ kind: "edit", id: sheetLesson.id })}
          onClose={() => setSheet(null)} />
      ) : null}

      {sheetLesson && sheet.kind === "gcal" ? (
        <GoogleEventSheet lesson={sheetLesson} view={viewOf(sheetLesson)}
          overlap={overlaps.some((o) => o.googleId === sheetLesson.id)} onClose={() => setSheet(null)} />
      ) : null}

      {sheetLesson && sheet.kind === "edit" ? (
        <EditSheet lesson={sheetLesson} view={viewOf(sheetLesson)} hours={range} group={sheetGroup}
          onSave={(p) => editLesson({ id: sheetLesson.id, date: viewOf(sheetLesson).date, ...p })}
          onDelete={() => removeLesson(sheetLesson)}
          onClose={() => setSheet(null)} />
      ) : null}

      {sheet && sheet.kind === "register" ? (
        <RegisterSheet date={sheet.date} min={sheet.min} hours={range}
          preset={sheet.presetId && members[sheet.presetId]
            ? { name: members[sheet.presetId].name, paused: members[sheet.presetId].status === "paused" }
            : null}
          onClose={() => setSheet(null)} onCreate={createLesson} />
      ) : null}

      {/* ── v5: 회원 시트 ── */}
      {sheet && sheet.kind === "mreg" ? (
        <MemberRegisterSheet findDupe={findDupe} todayS={todayS}
          onOpenExisting={(id) => { setSheet(null); openMemberDetail(id); }}
          onCreate={registerMember} onClose={() => setSheet(null)} />
      ) : null}
      {sheet && sheet.kind === "hold" && curM ? (
        <HoldSheet m={curM} todayS={todayS} upcomingCount={statsOf(curM.id).upcoming.length}
          onConfirm={(input) => holdMember(curM.id, input)} onClose={() => setSheet(null)} />
      ) : null}
      {sheet && sheet.kind === "medit" && curM ? (
        <MemberEditSheet m={curM} findDupe={findDupe}
          onSave={(ch) => saveMember(curM.id, ch)}
          onArchive={() => archiveMember(curM.id)}
          onClose={() => setSheet(null)} />
      ) : null}
      {sheet && sheet.kind === "mship" && curM ? (
        <MembershipSheet m={curM}
          onAdjust={(delta, reason, note) => manualAdjust(curM.id, delta, reason, note)}
          onClose={() => setSheet(null)} />
      ) : null}
      {sheet && sheet.kind === "memo" && curM ? (
        <MemoSheet onSave={(t2) => addMemo(curM.id, t2)} onClose={() => setSheet(null)} />
      ) : null}
      {sheet && sheet.kind === "recpick" && curM ? (
        <RecordPickSheet recordable={statsOf(curM.id).recordable} members={members}
          onPick={(l) => setSheet({ kind: "lesson", id: l.id })} onClose={() => setSheet(null)} />
      ) : null}

      {sheet && sheet.kind === "queue" ? (
        <QueueSheet items={queue} members={members} getGroupItem={getGroupItem}
          onSaveRecord={(l, t2) => setRecord(l, t2)} onNoComment={(l) => noComment(l)} onVoice={onVoice}
          onSaveGroup={(l, g2) => saveGroup(l, g2)} onFee={(l, mid, yes) => setFee(l, mid, yes)}
          onClose={() => setSheet(null)} />
      ) : null}

      {sheet && sheet.kind === "list" ? (
        <ListSheet days={days} viewByDay={viewByDay} members={members} detailOf={detailOf} groupOf={groupOf}
          todayS={todayS} nowMin={nowMin} onPick={(l) => openLesson(l)} onClose={() => setSheet(null)} />
      ) : null}

      {sheet && sheet.kind === "more" ? (
        <MoreSheet onClose={() => setSheet(null)}
          onGo={(k) => { setSheet(null); say(`${k} · 기존 화면 연결 지점`); }}
          onSettings={() => setSheet({ kind: "settings" })}
          onRegister={openRegisterQuick} />
      ) : null}

      {sheet && sheet.kind === "settings" ? (
        <ScheduleSettingsSheet hours={hours} setHours={setHours} foldOn={foldOn} setFoldOn={setFoldOn}
          sunOn={sunOn} setSunOn={setSunOn}
          onOpenCalendar={() => setSheet({ kind: "calendar" })} onClose={() => setSheet(null)} />
      ) : null}

      {sheet && sheet.kind === "calendar" ? (
        <CalendarSheet g={googleState} conflicts={conflicts} syncing={syncing}
          onConnect={async () => { await googleProvider.connect(); bump(); await syncNow(); }}
          onDisconnect={async () => { await googleProvider.disconnect(); bump(); say("연결 해제 · 토큰 폐기"); }}
          onSyncNow={syncNow}
          onToggle={(k) => { store.google[k] = !store.google[k]; bump(); }}
          onTitleMode={(v) => { store.google.titleMode = v; bump(); }}
          onPickConflict={(l) => setSheet({ kind: "conflict", id: l.id })}
          onClose={() => setSheet(null)} />
      ) : null}

      {conflictLesson ? (
        <ConflictSheet lesson={conflictLesson}
          onResolve={async (keep) => { await syncService.resolveConflict(conflictLesson.id, keep); bump();
            setSheet({ kind: "calendar" }); say(keep === "google" ? "Google 내용으로 정리" : "필라티쳐 내용으로 정리"); }}
          onClose={() => setSheet({ kind: "calendar" })} />
      ) : null}

      {toast ? (
        <div className="fixed" role="status" aria-live="polite"
          style={{ bottom: 84, left: "50%", transform: "translateX(-50%)", zIndex: 70, background: T.ink,
            color: "#FFFFFF", fontSize: 13, fontWeight: 500, padding: "10px 16px", borderRadius: 8,
            maxWidth: 320, textAlign: "center" }}>{toast}</div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── §9 충돌 해결 시트 (null 가드) ─────────────────────────── */
function ConflictSheet({ lesson, onResolve, onClose }) {
  const [compare, setCompare] = useState(false);
  if (!lesson) return null;
  const r = lesson._remoteSnapshot || {};
  const row = (label, mine, theirs) => (
    <div key={label} style={{ fontSize: 13, borderBottom: `1px solid ${T.lineFaint}`, padding: "8px 0" }}>
      <div style={{ color: T.ink2, fontSize: 12, marginBottom: 2 }}>{label}</div>
      <div className="flex gap-2">
        <span className="flex-1" style={{ color: T.ink }}>{mine}</span>
        <span className="flex-1" style={{ color: T.gcal }}>{theirs}</span>
      </div>
    </div>
  );
  return (
    <Sheet title="동기화 충돌" sub="Google Calendar와 필라티쳐에서 모두 수정되었습니다" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <p style={{ fontSize: 14, color: T.ink }}>어느 내용을 유지할까요?</p>
        <Btn kind="primary" full onClick={() => onResolve("pilateacher")}>필라티쳐 내용 유지</Btn>
        <Btn full onClick={() => onResolve("google")}>Google Calendar 내용 유지</Btn>
        <Btn kind="muted" full onClick={() => setCompare(!compare)}>{compare ? "비교 닫기" : "변경 내용 비교"}</Btn>
        {compare ? (
          <div style={{ background: T.sunken, borderRadius: 8, padding: "4px 12px" }}>
            <div className="flex gap-2" style={{ fontSize: 11, color: T.ink3, padding: "6px 0 0" }}>
              <span className="flex-1">필라티쳐</span><span className="flex-1">Google</span>
            </div>
            {row("제목", lesson.title || "(없음)", r.title || "(없음)")}
            {row("시간", `${lesson.startAt.slice(11, 16)}–${lesson.endAt.slice(11, 16)}`,
              r.startAt ? `${r.startAt.slice(11, 16)}–${r.endAt.slice(11, 16)}` : "-")}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ═══════════════ v6: 회원 탭 컴포넌트 (운영 기준) ═══════════════ */
const INSTRUCTOR_NAME = { inst_me: "나" };                 // 강사 1인 = 1조직 (아키텍처 결정)
const LTYPE = { private: "개인", duet: "듀엣", mixed: "혼합" };
const STATUS_LABEL = { active: "활성", paused: "홀딩", inactive: "보관" };  // "paused" 데이터값 유지, UI는 홀딩
const LEDGER_REASON = { lesson: "수업 차감", noshow: "노쇼 차감",
  manual_adjustment: "수동 조정", refund: "환불", extension: "연장" };
const mmddOf = (iso) => `${+iso.slice(5, 7)}.${+iso.slice(8, 10)}`;
const hhmmOf = (iso) => iso.slice(11, 16);
const ymdDot = (s) => (s ? s.slice(0, 10).replace(/-/g, ".") : "");
/** 만료 D-day (null=만료일 없음) */
const ddayOf = (m, todayS) => m.membership.expiresAt == null ? null
  : Math.ceil((new Date(`${m.membership.expiresAt}T00:00:00`) - new Date(`${todayS}T00:00:00`)) / 864e5);
/** 재등록 필요: 잔여 3회 이하 또는 만료 14일 이내(지남 포함) */
const needsRenew = (m, todayS) => {
  const d = ddayOf(m, todayS);
  return m.membership.remainingCount <= 3 || (d != null && d <= 14);
};
const diffDaysStr = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 864e5);

const Sec = ({ title, actionLabel, onAction, children }) => (
  <section aria-label={title} style={{ marginTop: 18 }}>
    <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: T.ink2, margin: 0 }}>{title}</h3>
      {actionLabel ? (
        <button onClick={onAction} style={{ minHeight: 32, padding: "0 6px", fontSize: 12,
          fontWeight: 600, color: T.a600, background: "transparent", border: "none" }}>
          {actionLabel}
        </button>
      ) : null}
    </div>
    {children}
  </section>
);

function EmptyState({ msg, actionLabel, onAction }) {
  return (
    <div className="flex flex-col items-center gap-2" style={{ padding: "20px 12px" }}>
      <p style={{ fontSize: 13, color: T.ink2, textAlign: "center", lineHeight: 1.6, margin: 0, whiteSpace: "pre-line" }}>{msg}</p>
      {actionLabel ? (
        <button onClick={onAction} style={{ minHeight: 40, padding: "0 16px", borderRadius: 10,
          border: `1px solid ${T.border}`, background: T.surface, fontSize: 13, fontWeight: 600, color: T.a600 }}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/* ── 회원 목록 — 필터 5종 + 정렬 5종 ── */
function MemberList({ list, statsOf, todayS, initialFocusId, onOpen, onRegister }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");   // all | private | duet | paused | expiring
  const [sort, setSort] = useState("recent");    // recent | next | remain | expiry | name
  useEffect(() => {   // 상세 → 목록 복귀 시 직전 카드로 포커스 복원
    if (initialFocusId) {
      const el = document.getElementById(`mcard-${initialFocusId}`);
      if (el) el.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const t = q.trim();
  const nullsLast = (v) => (v == null ? "9999" : v);
  const shown = list
    .filter((m) => filter === "all" ? true
      : filter === "paused" ? m.status === "paused"
      : filter === "expiring" ? (() => { const d = ddayOf(m, todayS); return d != null && d <= 14; })()
      : filter === "private" ? (m.lessonType === "private" || m.lessonType === "mixed")
      : (m.lessonType === "duet" || m.lessonType === "mixed"))
    .filter((m) => !t || m.name.includes(t))
    .sort((a, b) => {
      const sa = statsOf(a.id), sb = statsOf(b.id);
      let c = 0;
      if (sort === "recent") c = String(nullsLast(sb.last && sb.last.startAt)).localeCompare(String(nullsLast(sa.last && sa.last.startAt)));
      else if (sort === "next") c = String(nullsLast(sa.next && sa.next.startAt)).localeCompare(String(nullsLast(sb.next && sb.next.startAt)));
      else if (sort === "remain") c = a.membership.remainingCount - b.membership.remainingCount;
      else if (sort === "expiry") c = (ddayOf(a, todayS) ?? 9999) - (ddayOf(b, todayS) ?? 9999);
      return c !== 0 ? c : a.name.localeCompare(b.name, "ko");
    });
  const seg = (v, label2) => (
    <button key={v} onClick={() => setFilter(v)} aria-pressed={filter === v}
      style={{ minHeight: 36, padding: "0 11px", borderRadius: 999, fontSize: 12, fontWeight: 600,
        border: `1px solid ${filter === v ? T.a600 : T.border}`,
        background: filter === v ? T.a50 : T.surface, color: filter === v ? T.a700 : T.ink2 }}>
      {label2}
    </button>
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 flex items-center" style={{ padding: "10px 14px 4px", gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.ink, margin: 0 }}>회원</h2>
        <span className="tnum" style={{ fontSize: 12, color: T.ink3 }}>전체 {list.length}명</span>
        <span className="flex-1" />
        <button onClick={onRegister} aria-label="회원 등록"
          className="flex items-center justify-center"
          style={{ width: 44, height: 44, borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface }}>
          <UserPlus size={18} color={T.a600} />
        </button>
      </header>
      <div className="shrink-0" style={{ padding: "6px 14px 0" }}>
        <div className="flex items-center" style={{ gap: 8, border: `1px solid ${T.border}`,
          borderRadius: 12, background: T.surface, padding: "0 12px", height: 44 }}>
          <Search size={16} color={T.ink3} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search"
            placeholder="회원 이름 검색" aria-label="회원 이름 검색"
            className="flex-1 min-w-0" style={{ border: "none", outline: "none",
              background: "transparent", fontSize: 14, color: T.ink, height: "100%" }} />
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: 6, padding: "8px 0" }}
          role="group" aria-label="회원 필터와 정렬">
          {seg("all", "전체")}{seg("private", "개인")}{seg("duet", "듀엣")}{seg("paused", "홀딩")}{seg("expiring", "이용권 임박")}
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬 기준"
            style={{ minHeight: 36, borderRadius: 999, fontSize: 12, fontWeight: 600, padding: "0 8px",
              border: `1px solid ${T.border}`, background: T.surface, color: T.ink2 }}>
            <option value="recent">최근 수업순</option>
            <option value="next">다음 예약순</option>
            <option value="remain">잔여 적은 순</option>
            <option value="expiry">만료 임박순</option>
            <option value="name">이름순</option>
          </select>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "2px 14px 14px" }}>
        {shown.length === 0 ? (
          list.length === 0
            ? <EmptyState msg="등록된 회원이 없어요." actionLabel="회원 등록" onAction={onRegister} />
            : t
              ? <EmptyState msg={`'${t}' 검색 결과가 없어요.`} />
              : <EmptyState msg={filter === "paused" ? "홀딩 중인 회원이 없어요."
                  : filter === "expiring" ? "이용권 임박 회원이 없어요." : "조건에 맞는 회원이 없어요."} />
        ) : shown.map((m) => {
          const s = statsOf(m.id);
          const remain = m.membership.remainingCount;
          const d = ddayOf(m, todayS);
          const renew = needsRenew(m, todayS);
          const holding = m.status === "paused";
          const instr = INSTRUCTOR_NAME[m.instructorId] || m.instructorId;
          const expTxt = d == null ? "만료일 없음" : d < 0 ? "만료 지남" : `만료 ${mmddOf(m.membership.expiresAt + "T")}`;
          const nextTxt = s.next ? `다음 ${mmddOf(s.next.startAt)} ${hhmmOf(s.next.startAt)}` : "예약 없음";
          const aria = `${m.name}, ${LTYPE[m.lessonType]}, 담당 ${instr}, 잔여 ${remain}회, ${expTxt}, ${nextTxt}` +
            `${holding ? ", 홀딩 중" : ""}${renew ? ", 재등록 필요" : ""}${m.cautions.length ? ", 주의사항 있음" : ""}`;
          return (
            <button key={m.id} id={`mcard-${m.id}`} onClick={() => onOpen(m.id)} aria-label={aria}
              className="w-full text-left" style={{ marginBottom: 8, padding: "12px 14px",
                borderRadius: 14, border: `1px solid ${holding ? T.borderStrong : T.border}`,
                background: holding ? T.sunken : T.surface, minHeight: 44 }}>
              <div className="flex items-center" style={{ gap: 6 }}>
                <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: T.ink, maxWidth: "42%" }}
                  title={m.name}>{m.name}</span>
                {m.cautions.length ? (
                  <AlertCircle size={13} color={T.warn} aria-hidden="true" className="shrink-0" />
                ) : null}
                {holding ? (
                  <span className="shrink-0" style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: T.ink3,
                    borderRadius: 6, padding: "2px 6px" }}>홀딩</span>
                ) : null}
                {renew ? (
                  <span className="shrink-0" style={{ fontSize: 10, fontWeight: 700, color: T.warn, background: T.warnS,
                    borderRadius: 6, padding: "2px 6px" }}>재등록 필요</span>
                ) : null}
                <span className="flex-1" />
                <span className="tnum shrink-0" style={{ fontSize: 13, fontWeight: 700,
                  color: renew ? T.warn : T.ink }}>잔여 {remain}회</span>
              </div>
              <div className="flex flex-wrap" style={{ gap: "2px 10px", marginTop: 5, fontSize: 12, color: T.ink2 }}>
                <span>담당 {instr}</span>
                <span>{LTYPE[m.lessonType]}</span>
                <span className="tnum">{expTxt}</span>
                <span className="tnum">{nextTxt}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── 회원 상세 — 요약 + 섹션 7종(스펙 순서) + 하단 퀵 액션 ── */
function MemberDetail({ m, stats, ledger, assessments, todayS, onBack, onEdit, onRecord,
  onRegisterLesson, onAssess, onOpenAssessment, onMembership, onHold, onRelease, onMemo, onOpenLesson }) {
  const nameRef = useRef(null);
  const [armRel, setArmRel] = useState(false);
  useEffect(() => { if (nameRef.current) nameRef.current.focus(); setArmRel(false); }, [m.id]);
  const ms = m.membership;
  const d = ddayOf(m, todayS);
  const holding = m.status === "paused";
  const renew = needsRenew(m, todayS);
  const instr = INSTRUCTOR_NAME[m.instructorId] || m.instructorId;
  const expTxt = ms.expiresAt == null ? "만료일 없음"
    : d < 0 ? `만료 지남 (${ymdDot(ms.expiresAt)})` : d === 0 ? "오늘 만료" : `${ymdDot(ms.expiresAt)} (D-${d})`;
  /* 이용권 변경 이력 + 홀딩 이력 병합 (둘 다 store 단일 출처) */
  const history = [
    ...ledger.map((e) => ({ kind: "ledger", at: e.createdAt, e })),
    ...(m.holdHistory || []).map((h) => ({ kind: "hold", at: h.createdAt, h })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const row = (label2, value, warn2, wrap) => (
    <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
      <span className="shrink-0" style={{ fontSize: 12, color: T.ink3 }}>{label2}</span>
      <span className={wrap ? "tnum" : "tnum truncate"} style={{ fontSize: 13, fontWeight: 600,
        textAlign: "right", color: warn2 ? T.warn : T.ink }}
        title={typeof value === "string" ? value : undefined}>{value}</span>
    </div>
  );
  const qbtn = (Icon, label2, onClick2) => (
    <button onClick={onClick2} aria-label={label2}
      className="flex-1 flex flex-col items-center justify-center"
      style={{ minHeight: 52, gap: 3, borderRadius: 12, background: T.surface, border: `1px solid ${T.border}` }}>
      <Icon size={17} color={T.a600} />
      <span style={{ fontSize: 10.5, fontWeight: 600, color: T.ink2 }}>{label2}</span>
    </button>
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 flex items-center" style={{ padding: "8px 8px 4px", gap: 4 }}>
        <button onClick={onBack} aria-label="회원 목록으로 돌아가기"
          className="flex items-center justify-center" style={{ width: 44, height: 44 }}>
          <ChevronLeft size={22} color={T.ink} />
        </button>
        <h2 ref={nameRef} tabIndex={-1} className="truncate"
          style={{ fontSize: 17, fontWeight: 700, color: T.ink, margin: 0, outline: "none", maxWidth: "50%" }}
          title={m.name}>{m.name}</h2>
        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px",
          color: holding ? "#fff" : T.a700, background: holding ? T.ink3 : T.a50 }}>
          {STATUS_LABEL[m.status] || m.status}
        </span>
        {renew ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: T.warn, background: T.warnS,
            borderRadius: 6, padding: "2px 8px" }}>재등록 필요</span>
        ) : null}
        <span className="flex-1" />
        <button onClick={onEdit} aria-label="회원 정보 수정"
          className="flex items-center justify-center" style={{ width: 44, height: 44 }}>
          <Pencil size={17} color={T.ink2} />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "4px 16px 16px" }}>
        <div style={{ borderRadius: 14, border: `1px solid ${T.border}`, background: T.surface,
          padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
          {row("연락처", m.phone || "미입력")}
          {row("담당 강사", instr)}
          {row("수업 유형", LTYPE[m.lessonType] || m.lessonType)}
          {row("잔여", `${ms.remainingCount} / ${ms.totalCount}회`, ms.remainingCount <= 3)}
          {row("시작일", ymdDot(ms.startedAt))}
          {row("만료일", expTxt, d != null && d <= 14)}
          {row("마지막 수업", stats.last ? `${mmddOf(stats.last.startAt)} ${hhmmOf(stats.last.startAt)}` : "없음")}
          {row("다음 예약", stats.next ? `${mmddOf(stats.next.startAt)} ${hhmmOf(stats.next.startAt)}` : "예정된 수업이 없어요.", false, true)}
        </div>
        {holding && m.hold ? (
          <div className="flex items-start" style={{ gap: 8, marginTop: 8, padding: "10px 12px",
            borderRadius: 12, border: `1px solid ${T.borderStrong}`, background: T.sunken }}>
            <AlertCircle size={15} color={T.ink2} className="shrink-0" style={{ marginTop: 1 }} />
            <p style={{ fontSize: 12.5, color: T.ink2, margin: 0, lineHeight: 1.5 }}>
              홀딩 중 · {ymdDot(m.hold.startDate)} ~ {ymdDot(m.hold.endDate)} 예정
              {m.hold.extendDays > 0 ? ` · 만료 +${m.hold.extendDays}일 연장됨` : ""}
              {m.hold.reason ? ` · ${m.hold.reason}` : ""}
            </p>
          </div>
        ) : null}

        <Sec title="수업 목표" actionLabel={m.goals.length ? "편집" : null} onAction={onEdit}>
          {m.goals.length ? (
            <div className="flex flex-wrap" style={{ gap: 6 }}>
              {m.goals.map((g, i) => (
                <span key={i} style={{ fontSize: 12, color: T.a700, background: T.a50,
                  borderRadius: 8, padding: "4px 10px" }}>{g}</span>
              ))}
            </div>
          ) : <EmptyState msg="등록된 수업 목표가 없어요." actionLabel="등록" onAction={onEdit} />}
        </Sec>

        <Sec title="운동 시 주의사항" actionLabel={m.cautions.length ? "편집" : null} onAction={onEdit}>
          {m.cautions.length ? (
            <div className="flex flex-wrap" style={{ gap: 6 }}>
              {m.cautions.map((c, i) => (
                <span key={i} style={{ fontSize: 12, color: T.warn, background: T.warnS,
                  borderRadius: 8, padding: "4px 10px" }}>{c}</span>
              ))}
            </div>
          ) : <EmptyState msg="등록된 주의사항이 없어요." actionLabel="등록" onAction={onEdit} />}
        </Sec>

        <Sec title="최근 수업 기록" actionLabel={stats.recordable.length ? "기록 작성" : null} onAction={onRecord}>
          {stats.records.length ? (
            <div className="flex flex-col" style={{ gap: 6 }}>
              {stats.records.slice(0, 3).map(({ l, d: dd }) => (
                <button key={l.id} onClick={() => onOpenLesson(l)}
                  aria-label={`${mmddOf(l.startAt)} 수업 기록 열기`}
                  className="w-full text-left" style={{ padding: "10px 12px", borderRadius: 12,
                    border: `1px solid ${T.border}`, background: T.surface, minHeight: 44 }}>
                  <span className="tnum" style={{ fontSize: 12, color: T.ink3 }}>
                    {mmddOf(l.startAt)} {hhmmOf(l.startAt)}
                  </span>
                  <p className="truncate" style={{ fontSize: 13, color: T.ink, margin: "2px 0 0" }}>{dd.record}</p>
                </button>
              ))}
            </div>
          ) : <EmptyState msg="아직 작성된 수업 기록이 없어요."
              actionLabel={stats.recordable.length ? "기록 작성" : null} onAction={onRecord} />}
        </Sec>

        <Sec title="체형분석 이력" actionLabel={assessments.length ? "새 분석" : null} onAction={onAssess}>
          {assessments.length ? (
            <div className="flex flex-col" style={{ gap: 6 }}>
              {assessments.map((a) => (
                <button key={a.id} onClick={() => onOpenAssessment(a.id)}
                  aria-label={`${mmddOf(a.createdAt)} ${BA_MODE_KO[a.mode] || a.mode} ${BA_STATUS_KO[a.status] || a.status} 상세보기`}
                  className="w-full text-left flex items-center" style={{ gap: 8, padding: "10px 12px",
                    borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface, minHeight: 48 }}>
                  <span className="tnum shrink-0" style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
                    {mmddOf(a.createdAt)}
                  </span>
                  <AssessmentStatusBadge status={a.status} />
                  <span className="shrink-0" style={{ fontSize: 11, color: T.ink2 }}>{BA_MODE_KO[a.mode] || a.mode}</span>
                  <span className="tnum shrink-0" style={{ fontSize: 11, color: T.ink3 }}>
                    촬영 {BA_DIRS.filter((d2) => a.photos && a.photos[d2]).length}/3
                  </span>
                  <span className="flex-1" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.a600 }}>상세보기</span>
                  <ChevronRight size={14} color={T.ink3} className="shrink-0" />
                </button>
              ))}
            </div>
          ) : <EmptyState msg="아직 체형분석 이력이 없어요." actionLabel="첫 체형분석 시작" onAction={onAssess} />}
        </Sec>

        <Sec title="상담 메모" actionLabel="추가" onAction={onMemo}>
          {(m.memos || []).length ? (
            <div className="flex flex-col" style={{ gap: 6 }}>
              {m.memos.slice(0, 3).map((mo) => (
                <div key={mo.id} style={{ padding: "10px 12px", borderRadius: 12,
                  border: `1px solid ${T.border}`, background: T.surface }}>
                  <span className="tnum" style={{ fontSize: 11, color: T.ink3 }}>{mmddOf(mo.createdAt)}</span>
                  <p style={{ fontSize: 13, color: T.ink, margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{mo.text}</p>
                </div>
              ))}
            </div>
          ) : <EmptyState msg="등록된 상담 메모가 없어요." actionLabel="메모 추가" onAction={onMemo} />}
        </Sec>

        <Sec title="이용권 변경 이력" actionLabel="관리" onAction={onMembership}>
          {history.length ? (
            <div className="flex flex-col" style={{ gap: 6 }}>
              {history.slice(0, 6).map((it) => it.kind === "ledger" ? (
                <div key={it.e.id} className="flex items-center" style={{ gap: 8, padding: "10px 12px",
                  borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface }}>
                  <span className="tnum shrink-0" style={{ fontSize: 13, fontWeight: 700,
                    color: it.e.delta > 0 ? T.good : T.ink }}>{it.e.delta > 0 ? `+${it.e.delta}` : it.e.delta}</span>
                  <span className="shrink-0" style={{ fontSize: 12, color: T.ink2 }}>{LEDGER_REASON[it.e.reason] || it.e.reason}</span>
                  <span className="truncate" style={{ fontSize: 12, color: T.ink3 }}>{it.e.note}</span>
                  <span className="flex-1" />
                  <span className="tnum shrink-0" style={{ fontSize: 11, color: T.ink3 }}>{mmddOf(it.e.createdAt)}</span>
                </div>
              ) : (
                <div key={it.h.id} className="flex items-center" style={{ gap: 8, padding: "10px 12px",
                  borderRadius: 12, border: `1px solid ${T.borderStrong}`, background: T.sunken }}>
                  <span className="shrink-0" style={{ fontSize: 12, fontWeight: 700, color: T.ink2 }}>홀딩</span>
                  <span className="tnum truncate" style={{ fontSize: 12, color: T.ink2 }}>
                    {ymdDot(it.h.startDate)}~{ymdDot(it.h.releasedAt)}
                    {it.h.extendDays > 0 ? ` · 만료 +${it.h.extendDays}일` : ""}
                    {it.h.reason ? ` · ${it.h.reason}` : ""}
                  </span>
                  <span className="flex-1" />
                  <span className="tnum shrink-0" style={{ fontSize: 11, color: T.ink3 }}>{mmddOf(it.h.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState msg="아직 변경 이력이 없어요." />}
        </Sec>

        <Sec title="회원 기본정보">
          <div style={{ borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface,
            padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {row("이름", m.name)}
            {row("연락처", m.phone || "미입력")}
            {row("담당 강사", instr)}
            {row("수업 유형", LTYPE[m.lessonType] || m.lessonType)}
            {row("상태", STATUS_LABEL[m.status] || m.status, holding)}
            {row("등록일", ymdDot(m.createdAt))}
          </div>
          <div className="flex" style={{ gap: 8, marginTop: 8 }}>
            <button onClick={onEdit}
              style={{ flex: 1, minHeight: 44, borderRadius: 10, fontSize: 13, fontWeight: 600,
                border: `1px solid ${T.border}`, background: T.surface, color: T.ink }}>
              정보 수정
            </button>
            {holding ? (
              <button onClick={() => (armRel ? (setArmRel(false), onRelease()) : setArmRel(true))}
                aria-label={armRel ? "홀딩 해제 확정" : "홀딩 해제"}
                style={{ flex: 1.4, minHeight: 44, borderRadius: 10, fontSize: 13, fontWeight: 600,
                  border: `1px solid ${armRel ? T.a600 : T.border}`,
                  background: armRel ? T.a50 : T.surface, color: T.a700 }}>
                {armRel ? "한 번 더 누르면 활성 전환 · 이력 기록" : "홀딩 해제"}
              </button>
            ) : (
              <button onClick={onHold}
                style={{ flex: 1, minHeight: 44, borderRadius: 10, fontSize: 13, fontWeight: 600,
                  border: `1px solid ${T.border}`, background: T.surface, color: T.a700 }}>
                홀딩 설정
              </button>
            )}
          </div>
        </Sec>
      </div>
      {/* 하단 고정 퀵 액션 — 한 손 조작 (상단 몰림 방지) */}
      <div className="shrink-0 flex" style={{ gap: 8, padding: "8px 12px",
        borderTop: `1px solid ${T.border}`, background: T.bg }}>
        {qbtn(Plus, "일정 등록", onRegisterLesson)}
        {qbtn(FileText, "수업 기록", onRecord)}
        {qbtn(Ruler, "체형분석", onAssess)}
        {qbtn(MessageSquarePlus, "메모 추가", onMemo)}
      </div>
    </div>
  );
}

/* ── 홀딩 설정 바텀시트 — 수업 자동 취소 없음, 예정 수업은 안내만 ── */
function HoldSheet({ m, todayS, upcomingCount, onConfirm, onClose }) {
  const [start, setStart] = useState(todayS);
  const [end, setEnd] = useState(addDaysStr(todayS, 14));
  const [reason, setReason] = useState("");
  const [extendOn, setExtendOn] = useState(true);
  const [days, setDays] = useState(14);
  const dur = diffDaysStr(start, end);
  const bad = dur < 0;
  const input = { height: 46, borderRadius: 12, border: `1px solid ${T.border}`, padding: "0 12px",
    fontSize: 14, background: T.surface, color: T.ink, width: "100%", boxSizing: "border-box" };
  const lab = (t2) => <p style={{ fontSize: 12, color: T.ink3, margin: "0 0 6px" }}>{t2}</p>;
  const setEnd2 = (v) => { setEnd(v); const dd = diffDaysStr(start, v); if (dd >= 0) setDays(dd); };
  return (
    <Sheet title="홀딩 설정" sub={`${m.name} · 확인 시 상태가 '홀딩'으로 바뀝니다`} onClose={onClose}>
      <div className="flex flex-col" style={{ gap: 12 }}>
        {upcomingCount > 0 ? (
          <div className="flex items-start" style={{ gap: 8, padding: "10px 12px",
            borderRadius: 12, border: `1px solid ${T.warn}`, background: T.warnS }}>
            <AlertCircle size={15} color={T.warn} className="shrink-0" style={{ marginTop: 1 }} />
            <p style={{ fontSize: 12.5, color: T.ink, margin: 0, lineHeight: 1.5 }}>
              예정된 수업이 {upcomingCount}건 있습니다. 홀딩은 수업을 자동으로 취소하지 않아요.
              취소가 필요하면 일정 탭에서 직접 처리해 주세요.
            </p>
          </div>
        ) : null}
        <div className="flex" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}>
            {lab("홀딩 시작일")}
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              aria-label="홀딩 시작일" className="tnum" style={input} />
          </div>
          <div style={{ flex: 1 }}>
            {lab("종료 예정일")}
            <input type="date" value={end} onChange={(e) => setEnd2(e.target.value)}
              aria-label="홀딩 종료 예정일" className="tnum" style={input} />
          </div>
        </div>
        {bad ? <p style={{ fontSize: 12, color: T.bad, margin: 0 }}>종료일이 시작일보다 빠릅니다</p>
          : <p className="tnum" style={{ fontSize: 12, color: T.ink3, margin: 0 }}>홀딩 기간 {dur}일</p>}
        <div>
          {lab("홀딩 사유")}
          <input value={reason} onChange={(e) => setReason(e.target.value)} onFocus={kbSafe}
            placeholder="예: 개인 사정 · 부상 · 여행" aria-label="홀딩 사유" style={input} />
        </div>
        <div>
          {lab("이용권 만료일 연장")}
          <div className="flex items-center" style={{ gap: 8 }}>
            {[[true, "연장"], [false, "연장 안 함"]].map(([v, l2]) => (
              <button key={String(v)} onClick={() => { setExtendOn(v); if (v && dur >= 0) setDays(dur); }}
                aria-pressed={extendOn === v}
                style={{ flex: 1, minHeight: 40, borderRadius: 10, fontSize: 13, fontWeight: 600,
                  border: `1px solid ${extendOn === v ? T.a600 : T.border}`,
                  background: extendOn === v ? T.a50 : T.surface, color: extendOn === v ? T.a700 : T.ink2 }}>
                {l2}
              </button>
            ))}
            <input value={days} disabled={!extendOn} inputMode="numeric" aria-label="연장 일수"
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} onFocus={kbSafe}
              className="tnum" style={{ ...input, width: 76, flex: "none", textAlign: "center",
                background: extendOn ? T.surface : T.sunken, color: extendOn ? T.ink : T.ink3 }} />
            <span style={{ fontSize: 13, color: T.ink2 }}>일</span>
          </div>
          {m.membership.expiresAt == null && extendOn ? (
            <p style={{ fontSize: 12, color: T.ink3, margin: "6px 0 0" }}>만료일이 없어 연장은 적용되지 않아요</p>
          ) : null}
        </div>
        <button onClick={() => !bad && onConfirm({ startDate: start, endDate: end, reason: reason.trim(),
            extendDays: extendOn ? Math.max(0, +days || 0) : 0 })}
          disabled={bad}
          style={{ minHeight: 50, borderRadius: 12, border: "none",
            background: bad ? T.sunken : T.a600, color: bad ? T.ink3 : "#fff",
            fontSize: 15, fontWeight: 700 }}>
          홀딩 시작
        </button>
        <p style={{ fontSize: 11.5, color: T.ink3, margin: 0, lineHeight: 1.5 }}>
          수업 기록·체형분석 이력은 그대로 보존됩니다 · 해제하면 실제 기간과 연장 내역이 이력에 남아요
        </p>
      </div>
    </Sheet>
  );
}

/* ── 회원 등록 — 필수: 이름·전화·담당(고정)·유형·상품·총 횟수·기간 / 선택: 목표·주의·메모 ── */
function MemberRegisterSheet({ findDupe, todayS, onOpenExisting, onCreate, onClose }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [ltype, setLtype] = useState("private"); const [total, setTotal] = useState(10);
  const [product, setProduct] = useState("개인 10회"); const [prodTouched, setProdTouched] = useState(false);
  const [startAt, setStartAt] = useState(todayS); const [expireAt, setExpireAt] = useState(addDaysStr(todayS, 90));
  const [goals, setGoals] = useState(""); const [cautions, setCautions] = useState(""); const [memoText, setMemoText] = useState("");
  const [err, setErr] = useState(""); const [dupe, setDupe] = useState(null);
  const autoName = (lt, tt) => `${LTYPE[lt]} ${tt}회`;
  const pickL = (v) => { setLtype(v); if (!prodTouched) setProduct(autoName(v, total)); };
  const pickT = (v) => { setTotal(v); if (!prodTouched) setProduct(autoName(ltype, v)); };
  const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const submit = (force) => {
    const t = name.trim();
    if (!t) { setErr("회원 이름을 입력해 주세요"); return; }
    if (!phone.trim()) { setErr("전화번호를 입력해 주세요"); return; }
    if (diffDaysStr(startAt, expireAt) < 0) { setErr("만료일이 시작일보다 빠릅니다"); return; }
    if (!force) {
      const hit = findDupe(t);
      if (hit) { setDupe(hit); return; }
    }
    onCreate({ name: t, phone: phone.trim(), lessonType: ltype,
      productName: product.trim() || autoName(ltype, total), totalCount: total,
      startedAt: startAt, expiresAt: expireAt,
      goals: lines(goals), cautions: lines(cautions),
      memos: memoText.trim()
        ? [{ id: `memo_${Date.now().toString(36)}`, text: memoText.trim(), createdAt: new Date().toISOString() }]
        : [] });
  };
  const input = { height: 46, borderRadius: 12, border: `1px solid ${T.border}`, padding: "0 12px",
    fontSize: 14, background: T.surface, color: T.ink, width: "100%", boxSizing: "border-box" };
  const ta = { minHeight: 64, borderRadius: 12, border: `1px solid ${T.border}`, padding: "10px 12px",
    fontSize: 14, background: T.surface, color: T.ink, resize: "vertical", width: "100%", boxSizing: "border-box" };
  const lab = (t2) => <p style={{ fontSize: 12, color: T.ink3, margin: "0 0 6px" }}>{t2}</p>;
  const seg = (cur, set2, v, label2) => (
    <button key={String(v)} onClick={() => set2(v)} aria-pressed={cur === v}
      style={{ flex: 1, minHeight: 40, borderRadius: 10, fontSize: 13, fontWeight: 600,
        border: `1px solid ${cur === v ? T.a600 : T.border}`,
        background: cur === v ? T.a50 : T.surface, color: cur === v ? T.a700 : T.ink2 }}>
      {label2}
    </button>
  );
  return (
    <Sheet title="회원 등록" onClose={onClose} wide>
      <div className="flex flex-col" style={{ gap: 12 }}>
        <input value={name} onChange={(e) => { setName(e.target.value); setDupe(null); setErr(""); }}
          onFocus={kbSafe} placeholder="회원 이름 (필수)" aria-label="회원 이름"
          style={{ ...input, borderColor: err && !name.trim() ? T.warn : T.border }} />
        {dupe ? (
          <div style={{ borderRadius: 12, border: `1px solid ${T.warn}`, background: T.warnS, padding: 12 }}>
            <p style={{ fontSize: 13, color: T.ink, margin: 0 }}>
              같은 이름의 회원 '{dupe.name}'(잔여 {dupe.membership.remainingCount}회)이 이미 있습니다.
            </p>
            <div className="flex" style={{ gap: 8, marginTop: 10 }}>
              <button onClick={() => onOpenExisting(dupe.id)}
                style={{ flex: 1, minHeight: 42, borderRadius: 10, border: "none",
                  background: T.a600, color: "#fff", fontSize: 13, fontWeight: 700 }}>
                기존 회원 열기
              </button>
              <button onClick={() => submit(true)}
                style={{ flex: 1, minHeight: 42, borderRadius: 10, border: `1px solid ${T.border}`,
                  background: T.surface, color: T.ink, fontSize: 13, fontWeight: 600 }}>
                동명이인으로 등록
              </button>
            </div>
          </div>
        ) : null}
        <input value={phone} onChange={(e) => { setPhone(e.target.value); setErr(""); }} onFocus={kbSafe}
          inputMode="tel" placeholder="전화번호 (필수)" aria-label="전화번호"
          style={{ ...input, borderColor: err && !phone.trim() ? T.warn : T.border }} />
        <div className="flex items-center justify-between" style={{ minHeight: 40, padding: "0 2px" }}>
          <span style={{ fontSize: 13, color: T.ink2 }}>담당 강사</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{INSTRUCTOR_NAME.inst_me}</span>
        </div>
        <div>
          {lab("수업 유형")}
          <div className="flex" style={{ gap: 8 }}>
            {seg(ltype, pickL, "private", "개인")}{seg(ltype, pickL, "duet", "듀엣")}{seg(ltype, pickL, "mixed", "혼합")}
          </div>
        </div>
        <div>
          {lab("이용권 상품 · 총 횟수")}
          <input value={product} onChange={(e) => { setProduct(e.target.value); setProdTouched(true); }}
            onFocus={kbSafe} aria-label="이용권 상품명" style={{ ...input, marginBottom: 8 }} />
          <div className="flex" style={{ gap: 8 }}>
            {seg(total, pickT, 10, "10회")}{seg(total, pickT, 20, "20회")}{seg(total, pickT, 30, "30회")}{seg(total, pickT, 50, "50회")}
          </div>
        </div>
        <div className="flex" style={{ gap: 8 }}>
          <div style={{ flex: 1 }}>
            {lab("시작일")}
            <input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)}
              aria-label="이용권 시작일" className="tnum" style={input} />
          </div>
          <div style={{ flex: 1 }}>
            {lab("만료일")}
            <input type="date" value={expireAt} onChange={(e) => { setExpireAt(e.target.value); setErr(""); }}
              aria-label="이용권 만료일" className="tnum" style={input} />
          </div>
        </div>
        <div>
          {lab("운동 목표 (선택 · 줄마다 1개)")}
          <textarea value={goals} onChange={(e) => setGoals(e.target.value)} onFocus={kbSafe}
            aria-label="운동 목표" style={ta} />
        </div>
        <div>
          {lab("주의사항 (선택 · 줄마다 1개)")}
          <textarea value={cautions} onChange={(e) => setCautions(e.target.value)} onFocus={kbSafe}
            aria-label="주의사항" style={ta} />
        </div>
        <div>
          {lab("상담 메모 (선택)")}
          <textarea value={memoText} onChange={(e) => setMemoText(e.target.value)} onFocus={kbSafe}
            aria-label="상담 메모" style={ta} />
        </div>
        {err ? <p style={{ fontSize: 12, color: T.warn, margin: 0 }}>{err}</p> : null}
        {dupe ? null : (
          <button onClick={() => submit(false)}
            style={{ minHeight: 50, borderRadius: 12, border: "none", background: T.a600,
              color: "#fff", fontSize: 15, fontWeight: 700 }}>
            등록
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ── 회원 정보 수정 — 상태 변경은 홀딩 설정/해제로만, 보관은 2단계 ── */
function MemberEditSheet({ m, findDupe, onSave, onArchive, onClose }) {
  const [name, setName] = useState(m.name); const [phone, setPhone] = useState(m.phone || "");
  const [ltype, setLtype] = useState(m.lessonType || "private");
  const [cautions, setCautions] = useState(m.cautions.join("\n"));
  const [goals, setGoals] = useState(m.goals.join("\n"));
  const [dupeWarn, setDupeWarn] = useState(false); const [armDel, setArmDel] = useState(false);
  const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const save = () => {
    const t = name.trim();
    if (!t) return;
    if (!dupeWarn && t !== m.name) {
      const hit = findDupe(t);
      if (hit && hit.id !== m.id) { setDupeWarn(true); return; }
    }
    onSave({ name: t, phone: phone.trim(), lessonType: ltype,
      cautions: lines(cautions), goals: lines(goals) });
  };
  const input = { height: 46, borderRadius: 12, border: `1px solid ${T.border}`, padding: "0 12px",
    fontSize: 14, background: T.surface, color: T.ink, width: "100%", boxSizing: "border-box" };
  const ta = { minHeight: 72, borderRadius: 12, border: `1px solid ${T.border}`, padding: "10px 12px",
    fontSize: 14, background: T.surface, color: T.ink, resize: "vertical", width: "100%", boxSizing: "border-box" };
  return (
    <Sheet title="회원 정보 수정" sub="상태 변경은 상세 화면의 홀딩 설정·해제에서" onClose={onClose}>
      <div className="flex flex-col" style={{ gap: 12 }}>
        <input value={name} onChange={(e) => { setName(e.target.value); setDupeWarn(false); }}
          onFocus={kbSafe} aria-label="회원 이름" style={input} />
        {dupeWarn ? (
          <p style={{ fontSize: 12, color: T.warn, margin: 0 }}>
            같은 이름의 회원이 이미 있습니다 · 저장을 한 번 더 누르면 동명이인으로 저장됩니다
          </p>
        ) : null}
        <input value={phone} onChange={(e) => setPhone(e.target.value)} onFocus={kbSafe}
          inputMode="tel" placeholder="전화번호" aria-label="전화번호" style={input} />
        <div className="flex" style={{ gap: 8 }} role="group" aria-label="수업 유형">
          {[["private", "개인"], ["duet", "듀엣"], ["mixed", "혼합"]].map(([v, l2]) => (
            <button key={v} onClick={() => setLtype(v)} aria-pressed={ltype === v}
              style={{ flex: 1, minHeight: 40, borderRadius: 10, fontSize: 13, fontWeight: 600,
                border: `1px solid ${ltype === v ? T.a600 : T.border}`,
                background: ltype === v ? T.a50 : T.surface, color: ltype === v ? T.a700 : T.ink2 }}>
              {l2}
            </button>
          ))}
        </div>
        <div>
          <p style={{ fontSize: 12, color: T.ink3, margin: "0 0 6px" }}>수업 목표 (줄마다 1개)</p>
          <textarea value={goals} onChange={(e) => setGoals(e.target.value)} onFocus={kbSafe}
            aria-label="수업 목표" style={ta} />
        </div>
        <div>
          <p style={{ fontSize: 12, color: T.ink3, margin: "0 0 6px" }}>운동 시 주의사항 (줄마다 1개)</p>
          <textarea value={cautions} onChange={(e) => setCautions(e.target.value)} onFocus={kbSafe}
            aria-label="운동 시 주의사항" style={ta} />
        </div>
        <button onClick={save} style={{ minHeight: 50, borderRadius: 12, border: "none",
          background: T.a600, color: "#fff", fontSize: 15, fontWeight: 700 }}>
          {dupeWarn ? "동명이인으로 저장" : "저장"}
        </button>
        <button onClick={() => (armDel ? onArchive() : setArmDel(true))}
          aria-label={armDel ? "보관 확정" : "회원 보관"}
          style={{ minHeight: 46, borderRadius: 12, fontSize: 13, fontWeight: 600,
            border: `1px solid ${armDel ? T.warn : T.border}`,
            background: armDel ? T.warnS : T.surface, color: T.warn }}>
          {armDel ? "한 번 더 누르면 보관됩니다 · 수업·이력은 유지" : "보관 (목록에서 숨김)"}
        </button>
      </div>
    </Sheet>
  );
}

/* ── 이용권 관리 — 수동 조정 + 사유 + 2단계 확인. 자동 차감은 일정에서만 연결 ── */
function MembershipSheet({ m, onAdjust, onClose }) {
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("manual_adjustment");
  const [note, setNote] = useState(""); const [confirm2, setConfirm2] = useState(false);
  const remain = m.membership.remainingCount;
  const canMinus = remain + delta > 0; const canPlus = delta < 99;
  const stepBtn = (label2, on2, ok) => (
    <button onClick={on2} disabled={!ok} aria-label={label2}
      style={{ width: 48, height: 48, borderRadius: 12, fontSize: 20, fontWeight: 700,
        border: `1px solid ${T.border}`, background: ok ? T.surface : T.sunken,
        color: ok ? T.ink : T.ink3 }}>
      {label2 === "잔여 늘리기" ? "+" : "−"}
    </button>
  );
  return (
    <Sheet title="이용권 관리" onClose={onClose}>
      <div className="flex flex-col" style={{ gap: 14 }}>
        <div style={{ borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface, padding: 12 }}>
          <p style={{ fontSize: 13, color: T.ink, margin: 0, fontWeight: 600 }}>{m.membership.productName}</p>
          <p className="tnum" style={{ fontSize: 12, color: T.ink2, margin: "4px 0 0" }}>
            잔여 {remain} / {m.membership.totalCount}회
            {m.membership.expiresAt ? ` · ${m.membership.expiresAt} 만료` : ""}
          </p>
        </div>
        <div className="flex items-center justify-center" style={{ gap: 16 }}>
          {stepBtn("잔여 줄이기", () => { setDelta((dd) => dd - 1); setConfirm2(false); }, canMinus)}
          <span className="tnum" style={{ fontSize: 22, fontWeight: 700, minWidth: 64, textAlign: "center",
            color: delta === 0 ? T.ink3 : delta > 0 ? T.good : T.warn }}>
            {delta > 0 ? `+${delta}` : delta}회
          </span>
          {stepBtn("잔여 늘리기", () => { setDelta((dd) => dd + 1); setConfirm2(false); }, canPlus)}
        </div>
        <div className="flex" style={{ gap: 8 }} role="group" aria-label="조정 사유">
          {[["manual_adjustment", "수동 조정"], ["extension", "연장"], ["refund", "환불"]].map(([v, l2]) => (
            <button key={v} onClick={() => { setReason(v); setConfirm2(false); }} aria-pressed={reason === v}
              style={{ flex: 1, minHeight: 40, borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                border: `1px solid ${reason === v ? T.a600 : T.border}`,
                background: reason === v ? T.a50 : T.surface, color: reason === v ? T.a700 : T.ink2 }}>
              {l2}
            </button>
          ))}
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} onFocus={kbSafe}
          placeholder="사유 메모 (선택)" aria-label="조정 사유 메모"
          style={{ height: 46, borderRadius: 12, border: `1px solid ${T.border}`, padding: "0 12px",
            fontSize: 14, background: T.surface, color: T.ink }} />
        {confirm2 ? (
          <div style={{ borderRadius: 12, border: `1px solid ${T.warn}`, background: T.warnS, padding: 12 }}>
            <p style={{ fontSize: 13, color: T.ink, margin: 0 }}>
              잔여 {remain}회 → <b className="tnum">{remain + delta}회</b> · {LEDGER_REASON[reason]}
            </p>
            <div className="flex" style={{ gap: 8, marginTop: 10 }}>
              <button onClick={() => onAdjust(delta, reason, note)}
                style={{ flex: 1, minHeight: 44, borderRadius: 10, border: "none",
                  background: T.a600, color: "#fff", fontSize: 14, fontWeight: 700 }}>
                변경 확정
              </button>
              <button onClick={() => setConfirm2(false)}
                style={{ flex: 1, minHeight: 44, borderRadius: 10, border: `1px solid ${T.border}`,
                  background: T.surface, color: T.ink, fontSize: 14, fontWeight: 600 }}>
                취소
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirm2(true)} disabled={delta === 0}
            style={{ minHeight: 50, borderRadius: 12, border: "none",
              background: delta === 0 ? T.sunken : T.a600, color: delta === 0 ? T.ink3 : "#fff",
              fontSize: 15, fontWeight: 700 }}>
            변경 내용 확인
          </button>
        )}
        <p style={{ fontSize: 11.5, color: T.ink3, margin: 0, lineHeight: 1.5 }}>
          수업 출석·노쇼 차감은 일정 화면에서 처리 시 자동으로 원장에 기록됩니다 · 여기서는 수동 조정만 합니다
        </p>
      </div>
    </Sheet>
  );
}

/* ── 상담 메모 ── */
function MemoSheet({ onSave, onClose }) {
  const [text, setText] = useState("");
  return (
    <Sheet title="상담 메모 추가" onClose={onClose}>
      <div className="flex flex-col" style={{ gap: 12 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onFocus={kbSafe}
          placeholder="상담 내용을 입력하세요" aria-label="상담 메모"
          style={{ minHeight: 120, borderRadius: 12, border: `1px solid ${T.border}`, padding: "10px 12px",
            fontSize: 14, background: T.surface, color: T.ink, resize: "vertical" }} />
        <button onClick={() => text.trim() && onSave(text)} disabled={!text.trim()}
          style={{ minHeight: 50, borderRadius: 12, border: "none",
            background: text.trim() ? T.a600 : T.sunken, color: text.trim() ? "#fff" : T.ink3,
            fontSize: 15, fontWeight: 700 }}>
          저장
        </button>
      </div>
    </Sheet>
  );
}

/* ── 기록할 수업 선택 ── */
function RecordPickSheet({ recordable, onPick, onClose }) {
  return (
    <Sheet title="기록할 수업 선택" onClose={onClose}>
      <div className="flex flex-col" style={{ gap: 8 }}>
        {recordable.length === 0 ? (
          <EmptyState msg="아직 작성된 수업 기록이 없어요." />
        ) : recordable.slice(0, 8).map(({ l }) => (
          <button key={l.id} onClick={() => onPick(l)}
            aria-label={`${mmddOf(l.startAt)} ${hhmmOf(l.startAt)} 수업 기록 작성`}
            className="w-full text-left flex items-center" style={{ gap: 10, padding: "12px 14px",
              borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface, minHeight: 48 }}>
            <span className="tnum" style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>
              {mmddOf(l.startAt)} {hhmmOf(l.startAt)}
            </span>
            <span style={{ fontSize: 12, color: T.ink3 }}>
              {l.type === "duet" ? "듀엣" : "개인"} · {Math.round((parseHM(l.endAt.slice(11, 16)) - parseHM(l.startAt.slice(11, 16))))}분
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ═══════════════ v8: [체형] 탭 컴포넌트 — 볼트 1단계 ═══════════════
 * 범위: 목록 → 방식 선택 → 촬영 등록(파일 업로드·objectURL 미리보기·메타만 저장) → 준비 완료 → 상세.
 * 이 단계에서는 어떤 분석 결과·측정값·점수도 생성하지 않는다.
 * [다음 단계 연결 지점] ready_for_analysis 초안에 AI 관절 인식·직접 수정 화면을 연결 (v7-full 참조) */
const BA_DIRS = ["front", "side", "back"];
const BA_DIR_KO = { front: "정면", side: "측면", back: "후면" };
const BA_MODE_KO = { ai: "AI 분석", manual: "직접 분석" };
const BA_STATUS_KO = { draft: "작성 중", ready_for_analysis: "분석 대기",
  processing: "분석 중", review_required: "검토 필요", completed: "완료" };
const BA_GUIDE = {
  front: ["카메라 정면 보기", "양발 간격 일정하게 유지", "팔은 몸 옆에 자연스럽게 위치"],
  side: ["카메라와 몸이 정확히 수직", "고개를 자연스럽게 유지", "발 위치가 보이도록 촬영"],
  back: ["등을 카메라 정면으로 유지", "양쪽 어깨와 골반이 보이도록 촬영", "머리부터 발끝까지 포함"],
};
const BA_CHECKS = ["전신이 화면에 포함되었나요?", "관절이 옷에 가려지지 않았나요?",
  "카메라가 기울어지지 않았나요?", "밝기가 충분한가요?"];
/* objectURL 대장 — 교체·삭제·초안 삭제 시 반드시 revoke (파일 객체는 저장하지 않음) */
const baUrlBook = new Map();
function baMakePhotoMeta(direction, file) {
  const id = `photo_${Date.now().toString(36)}_${SEQ++}`;
  const previewUrl = URL.createObjectURL(file);
  baUrlBook.set(id, previewUrl);
  return { id, direction, previewUrl, fileName: file.name || "이름 없는 파일",
    mimeType: file.type || "", size: file.size || 0, source: "upload",
    createdAt: new Date().toISOString() };
}
function baRevokePhoto(photo) {
  if (!photo) return;
  const u = baUrlBook.get(photo.id);
  if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* no-op */ } baUrlBook.delete(photo.id); }
}
function baRevokeAllPhotos() {
  baUrlBook.forEach((u) => {
    try { URL.revokeObjectURL(u); } catch (e) { /* no-op */ }
  });
  baUrlBook.clear();
}
const baPhotoCount = (a) => BA_DIRS.filter((d) => a.photos && a.photos[d]).length;
const baComparable = (list) => list.filter((a) => a.status === "completed").length >= 2;

function AssessmentStatusBadge({ status }) {
  const tone = status === "completed" ? { c: T.good, b: T.goodS }
    : status === "review_required" ? { c: T.warn, b: T.warnS }
    : status === "processing" ? { c: T.a700, b: T.a100 }
    : status === "ready_for_analysis" ? { c: T.a700, b: T.a50 }
    : { c: T.ink2, b: T.sunken };
  return (
    <span className="shrink-0" style={{ fontSize: 10, fontWeight: 700, borderRadius: 6,
      padding: "2px 7px", color: tone.c, background: tone.b }}>
      {BA_STATUS_KO[status] || status}
    </span>
  );
}

/* ── 목록: 전체 회원 + 분석 현황 ── */
function BodyAssessmentList({ memberList, assessOf, onStart, onOpenDetail }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | draft | review | done | comparable
  const t = q.trim();
  const rows = memberList
    .map((m) => {
      const list = assessOf(m.id);
      return { m, list, latest: list[0] || null, comparable: baComparable(list) };
    })
    .filter(({ m }) => !t || m.name.includes(t))
    .filter(({ latest, comparable }) => filter === "all" ? true
      : filter === "comparable" ? comparable
      : filter === "draft" ? !!latest && latest.status === "draft"
      : filter === "review" ? !!latest && latest.status === "review_required"
      : !!latest && latest.status === "completed")
    .sort((a, b) => String((b.latest && b.latest.updatedAt) || "").localeCompare(
      String((a.latest && a.latest.updatedAt) || "")) || a.m.name.localeCompare(b.m.name, "ko"));
  const seg = (v, l2) => (
    <button key={v} onClick={() => setFilter(v)} aria-pressed={filter === v}
      style={{ minHeight: 36, padding: "0 11px", borderRadius: 999, fontSize: 12, fontWeight: 600,
        border: `1px solid ${filter === v ? T.a600 : T.border}`,
        background: filter === v ? T.a50 : T.surface, color: filter === v ? T.a700 : T.ink2 }}>{l2}</button>
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0" style={{ padding: "10px 14px 0" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.ink, margin: 0 }}>체형분석</h2>
        <p style={{ fontSize: 12.5, color: T.ink3, margin: "3px 0 8px" }}>회원의 체형 변화를 기록하고 비교하세요.</p>
        <div className="flex items-center" style={{ gap: 8, border: `1px solid ${T.border}`,
          borderRadius: 12, background: T.surface, padding: "0 12px", height: 44 }}>
          <Search size={16} color={T.ink3} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search"
            placeholder="회원 이름 검색" aria-label="체형분석 회원 검색"
            className="flex-1 min-w-0" style={{ border: "none", outline: "none",
              background: "transparent", fontSize: 14, color: T.ink, height: "100%" }} />
        </div>
        <div className="flex flex-wrap" style={{ gap: 6, padding: "8px 0" }} role="group" aria-label="분석 상태 필터">
          {seg("all", "전체")}{seg("draft", "작성 중")}{seg("review", "검토 필요")}{seg("done", "완료")}{seg("comparable", "비교 가능")}
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "2px 14px 14px" }}>
        {rows.length === 0 ? (
          <EmptyState msg={t ? `'${t}' 검색 결과가 없어요.` : "조건에 맞는 회원이 없어요."} />
        ) : rows.map(({ m, list, latest, comparable }) => {
          const instr = INSTRUCTOR_NAME[m.instructorId] || m.instructorId;
          return (
            <div key={m.id} style={{ marginBottom: 8, padding: "12px 14px", borderRadius: 14,
              border: `1px solid ${T.border}`, background: T.surface }}>
              <button onClick={() => (latest ? onOpenDetail(latest.id) : onStart(m.id))}
                aria-label={latest
                  ? `${m.name}, 최근 ${mmddOf(latest.createdAt)}, ${BA_STATUS_KO[latest.status]}, 상세 열기`
                  : `${m.name}, 체형분석 이력 없음, 첫 체형분석 시작`}
                className="w-full text-left">
                <span className="flex items-center" style={{ gap: 6 }}>
                  <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: T.ink, maxWidth: "44%" }}
                    title={m.name}>{m.name}</span>
                  {latest ? <AssessmentStatusBadge status={latest.status} /> : null}
                  {comparable ? (
                    <span className="shrink-0" style={{ fontSize: 10, fontWeight: 700, color: T.a700,
                      background: T.a100, borderRadius: 6, padding: "2px 6px" }}>비교 가능</span>
                  ) : null}
                  <span className="flex-1" />
                  <ChevronRight size={15} color={T.ink3} className="shrink-0" />
                </span>
                {latest ? (
                  <span className="flex flex-wrap items-center" style={{ gap: "2px 10px", marginTop: 5,
                    fontSize: 12, color: T.ink2 }}>
                    <span>담당 {instr}</span>
                    <span className="tnum">최근 {mmddOf(latest.createdAt)}</span>
                    <span>{BA_MODE_KO[latest.mode] || latest.mode}</span>
                    <span className="flex items-center" style={{ gap: 4 }} aria-label={`촬영 등록 ${baPhotoCount(latest)}/3`}>
                      {BA_DIRS.map((d) => (
                        <span key={d} aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4,
                          background: latest.photos[d] ? T.a600 : T.borderStrong }} />
                      ))}
                      <span className="tnum" style={{ color: T.ink3 }}>{baPhotoCount(latest)}/3</span>
                    </span>
                  </span>
                ) : (
                  <span className="block" style={{ marginTop: 5, fontSize: 12, color: T.ink3 }}>
                    담당 {instr} · 아직 체형분석 이력이 없어요.
                  </span>
                )}
              </button>
              {latest ? null : (
                <button onClick={() => onStart(m.id)}
                  style={{ marginTop: 8, minHeight: 40, width: "100%", borderRadius: 10,
                    border: `1px solid ${T.a200}`, background: T.a50, color: T.a700,
                    fontSize: 13, fontWeight: 700 }}>
                  첫 체형분석 시작
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 방식 선택(§3) — '다음' 시점에 초안 생성(§4) ── */
function AssessmentModeSelect({ m, list, onNext, onBack, busyGuard }) {
  const [mode, setMode] = useState(null);            // "ai" | "manual"
  const latest = list[0] || null;
  const card = (v, title2, desc, stageNote) => (
    <button onClick={() => setMode(v)} aria-pressed={mode === v}
      className="w-full text-left" style={{ padding: 14, borderRadius: 14,
        border: `1.5px solid ${mode === v ? T.a600 : T.border}`,
        background: mode === v ? T.a50 : T.surface }}>
      <span className="flex items-center" style={{ gap: 8 }}>
        {v === "ai" ? <Sparkles size={16} color={T.a600} /> : <Pencil size={15} color={T.a600} />}
        <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{title2}</span>
        <span className="flex-1" />
        <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 10,
          border: `2px solid ${mode === v ? T.a600 : T.borderStrong}`,
          background: mode === v ? T.a600 : "transparent" }} />
      </span>
      <span className="block" style={{ fontSize: 12.5, color: T.ink2, marginTop: 6, lineHeight: 1.55 }}>{desc}</span>
      <span className="block" style={{ fontSize: 11.5, color: T.ink3, marginTop: 4 }}>{stageNote}</span>
    </button>
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 flex items-center" style={{ padding: "8px 8px 4px", gap: 4 }}>
        <button onClick={onBack} aria-label="체형 목록으로 돌아가기"
          className="flex items-center justify-center" style={{ width: 44, height: 44 }}>
          <ChevronLeft size={22} color={T.ink} />
        </button>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.ink, margin: 0 }}>체형분석 시작</h2>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col" style={{ padding: "4px 16px 16px", gap: 12 }}>
        <div style={{ borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface,
          padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px" }}>
          <span className="truncate" style={{ fontSize: 14, fontWeight: 700, color: T.ink }} title={m.name}>{m.name}</span>
          <span style={{ fontSize: 12, color: T.ink2, textAlign: "right" }}>담당 {INSTRUCTOR_NAME[m.instructorId] || m.instructorId}</span>
          <span className="tnum" style={{ fontSize: 12, color: T.ink2 }}>
            최근 분석 {latest ? mmddOf(latest.createdAt) : "없음"}
          </span>
          <span className="tnum" style={{ fontSize: 12, color: T.ink2, textAlign: "right" }}>이전 분석 {list.length}회</span>
        </div>
        {card("ai", "AI 분석",
          "사진을 등록하면 AI가 관절 위치와 체형 지표를 분석합니다.",
          "현재는 촬영 등록 및 분석 준비 단계입니다.")}
        {card("manual", "직접 분석",
          "강사가 직접 관절 위치와 측정값을 기록합니다.",
          "이번 단계에서는 측정 화면 이동 전 준비 상태까지 진행합니다.")}
      </div>
      <div className="shrink-0" style={{ padding: "8px 16px", borderTop: `1px solid ${T.border}`, background: T.bg }}>
        <button onClick={() => mode && !busyGuard.current && onNext(m.id, mode)} disabled={!mode}
          style={{ width: "100%", minHeight: 50, borderRadius: 12, border: "none",
            background: mode ? T.a600 : T.sunken, color: mode ? "#fff" : T.ink3,
            fontSize: 15, fontWeight: 700 }}>
          다음
        </button>
      </div>
    </div>
  );
}

/* ── 방향별 사진 카드(§5·§6) — 카드 전체 탭=업로드, 교체/삭제 분리 ── */
function AssessmentPhotoCard({ dir, photo, onFile, onRemove }) {
  const fileRef = useRef(null);
  const pick = () => fileRef.current && fileRef.current.click();
  const onChange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) onFile(dir, file);
  };
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${T.border}`, background: T.surface, padding: 12 }}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onChange}
        aria-label={`${BA_DIR_KO[dir]} 사진 파일 선택`} style={{ display: "none" }} />
      <div className="flex items-center" style={{ gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{BA_DIR_KO[dir]}</span>
        {photo ? (
          <span className="flex items-center shrink-0" style={{ gap: 3, fontSize: 10, fontWeight: 700,
            color: T.good, background: T.goodS, borderRadius: 6, padding: "2px 7px" }}>
            <Check size={11} /> 등록 완료
          </span>
        ) : (
          <span className="shrink-0" style={{ fontSize: 10, fontWeight: 700, color: T.ink2,
            background: T.sunken, borderRadius: 6, padding: "2px 7px" }}>미등록</span>
        )}
        <span className="flex-1" />
        {photo ? (
          <>
            <button onClick={pick} aria-label={`${BA_DIR_KO[dir]} 사진 교체`}
              style={{ minHeight: 34, padding: "0 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: `1px solid ${T.border}`, color: T.ink2 }}>교체</button>
            <button onClick={() => onRemove(dir)} aria-label={`${BA_DIR_KO[dir]} 사진 삭제`}
              style={{ minHeight: 34, padding: "0 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: `1px solid ${T.border}`, color: T.warn, marginLeft: 6 }}>삭제</button>
          </>
        ) : null}
      </div>
      {photo ? (
        <div className="flex" style={{ gap: 10, marginTop: 8 }}>
          <img src={photo.previewUrl} alt={`${BA_DIR_KO[dir]} 미리보기`}
            style={{ width: 72, height: 104, objectFit: "cover", borderRadius: 8,
              border: `1px solid ${T.border}`, background: T.sunken }} />
          <div className="flex-1 min-w-0">
            <p className="truncate" style={{ fontSize: 12, color: T.ink, margin: 0 }} title={photo.fileName}>
              {photo.fileName}
            </p>
            <p className="tnum" style={{ fontSize: 11, color: T.ink3, margin: "3px 0 0" }}>
              {(photo.size / 1024 / 1024).toFixed(1)}MB · {mmddOf(photo.createdAt)} 등록
            </p>
          </div>
        </div>
      ) : (
        <button onClick={pick} className="w-full flex items-center justify-center gap-2"
          aria-label={`${BA_DIR_KO[dir]} 사진 촬영 또는 불러오기`}
          style={{ marginTop: 10, minHeight: 84, borderRadius: 10,
            border: `1.5px dashed ${T.borderStrong}`, background: T.sunken,
            color: T.ink2, fontSize: 13, fontWeight: 600 }}>
          <Camera size={17} color={T.a600} /> 촬영 · 불러오기
        </button>
      )}
      <p style={{ fontSize: 11.5, color: T.ink3, margin: "8px 0 0", lineHeight: 1.6 }}>
        {BA_GUIDE[dir].map((g, i) => <span key={i}>· {g}<br /></span>)}
      </p>
    </div>
  );
}

/* ── 촬영 등록(§5~7) ── */
function AssessmentPhotoCapture({ a, onFile, onRemove, onTempSave, onReady, onBack, busyGuard }) {
  const done = baPhotoCount(a);
  const ready = done === 3;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 flex items-center" style={{ padding: "8px 8px 4px", gap: 4 }}>
        <button onClick={onBack} aria-label="체형 목록으로 돌아가기"
          className="flex items-center justify-center" style={{ width: 44, height: 44 }}>
          <ChevronLeft size={22} color={T.ink} />
        </button>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.ink, margin: 0 }}>체형 사진 등록</h2>
        <span className="tnum" style={{ fontSize: 12, color: T.ink3, marginLeft: 6 }}>{done}/3</span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col" style={{ padding: "0 16px 12px", gap: 10 }}>
        <p style={{ fontSize: 12.5, color: T.ink2, margin: 0 }}>정확한 비교를 위해 같은 위치와 거리에서 촬영해주세요.</p>
        {a.mode === "manual" ? (
          <p style={{ fontSize: 12, color: T.a700, background: T.a50, borderRadius: 10,
            padding: "8px 10px", margin: 0 }}>
            직접 분석 모드에서는 다음 단계에서 강사가 관절 위치와 측정값을 직접 입력합니다.
          </p>
        ) : null}
        {BA_DIRS.map((d) => (
          <AssessmentPhotoCard key={d} dir={d} photo={a.photos[d]} onFile={onFile} onRemove={onRemove} />
        ))}
        <div style={{ borderRadius: 12, border: `1px solid ${T.border}`, background: T.sunken, padding: "10px 12px" }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: T.ink2, margin: "0 0 4px" }}>저장 전에 확인해요</p>
          {BA_CHECKS.map((c, i) => (
            <p key={i} style={{ fontSize: 12, color: T.ink2, margin: "0 0 2px" }}>· {c}</p>
          ))}
        </div>
        {!ready ? (
          <p role="status" style={{ fontSize: 12, color: T.warn, margin: 0 }}>
            정면, 측면, 후면 사진을 모두 등록해주세요.
          </p>
        ) : null}
      </div>
      <div className="shrink-0 flex" style={{ gap: 8, padding: "8px 16px",
        borderTop: `1px solid ${T.border}`, background: T.bg }}>
        <button onClick={() => !busyGuard.current && onTempSave()}
          style={{ flex: 1, minHeight: 50, borderRadius: 12, border: `1px solid ${T.border}`,
            background: T.surface, color: T.ink2, fontSize: 14, fontWeight: 600 }}>
          임시 저장
        </button>
        <button onClick={() => ready && !busyGuard.current && onReady(a.id)} disabled={!ready}
          style={{ flex: 1.4, minHeight: 50, borderRadius: 12, border: "none",
            background: ready ? T.a600 : T.sunken, color: ready ? "#fff" : T.ink3,
            fontSize: 15, fontWeight: 700 }}>
          분석 준비 완료
        </button>
      </div>
    </div>
  );
}

/* ── 준비 완료 안내(§7) ── */
function AssessmentComplete({ a, onGoMember, onGoList }) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center" style={{ padding: 24, gap: 10 }}>
      <span className="flex items-center justify-center" aria-hidden="true"
        style={{ width: 56, height: 56, borderRadius: 28, background: T.a50 }}>
        <Check size={26} color={T.a600} />
      </span>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: T.ink, margin: 0 }}>분석 준비 완료</h2>
      <p style={{ fontSize: 13, color: T.ink2, textAlign: "center", lineHeight: 1.6, margin: 0 }}>
        사진 등록이 완료되었습니다.<br />다음 단계에서 AI 관절 인식과 직접 수정 기능을 연결할 수 있습니다.
      </p>
      <AssessmentStatusBadge status={a.status} />
      <div className="flex" style={{ gap: 8, marginTop: 8 }}>
        <button onClick={onGoMember}
          style={{ minHeight: 48, padding: "0 16px", borderRadius: 12, border: "none",
            background: T.a600, color: "#fff", fontSize: 14, fontWeight: 700 }}>
          회원 상세로 이동
        </button>
        <button onClick={onGoList}
          style={{ minHeight: 48, padding: "0 16px", borderRadius: 12, border: `1px solid ${T.border}`,
            background: T.surface, color: T.ink, fontSize: 14, fontWeight: 600 }}>
          체형 목록으로 이동
        </button>
      </div>
    </main>
  );
}

/* ── 상세(§9) — 결과 없음 문구 · 강사 메모 · 초안 2단계 삭제 ── */
function AssessmentDetail({ a, m, onResume, onDeleteDraft, onSaveMemo, onBack, busyGuard }) {
  const [memo, setMemo] = useState(a.instructorMemo || "");
  const [armDel, setArmDel] = useState(false);
  useEffect(() => { setMemo(a.instructorMemo || ""); setArmDel(false); }, [a.id]);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 flex items-center" style={{ padding: "8px 8px 4px", gap: 4 }}>
        <button onClick={onBack} aria-label="체형 목록으로 돌아가기"
          className="flex items-center justify-center" style={{ width: 44, height: 44 }}>
          <ChevronLeft size={22} color={T.ink} />
        </button>
        <h2 className="truncate" style={{ fontSize: 16, fontWeight: 700, color: T.ink, margin: 0, maxWidth: "48%" }}
          title={m.name}>{m.name}</h2>
        <AssessmentStatusBadge status={a.status} />
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "0 16px 16px" }}>
        <p className="tnum" style={{ fontSize: 12, color: T.ink3, margin: "0 0 10px" }}>
          분석일 {ymdDot(a.createdAt)} · {BA_MODE_KO[a.mode] || a.mode} · 촬영 {baPhotoCount(a)}/3
        </p>
        {a.status === "ready_for_analysis" ? (
          <div className="flex items-center" style={{ gap: 8, marginBottom: 10, padding: "10px 12px",
            borderRadius: 12, border: `1px solid ${T.a200}`, background: T.a50 }}>
            <Sparkles size={15} color={T.a600} className="shrink-0" />
            <p style={{ fontSize: 12.5, color: T.a700, fontWeight: 600, margin: 0 }}>
              AI 분석 준비 완료 — 다음 단계에서 관절 인식을 연결합니다.
            </p>
          </div>
        ) : null}
        <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
          {BA_DIRS.map((d) => (
            <figure key={d} className="flex-1 min-w-0" style={{ margin: 0, textAlign: "center" }}>
              {a.photos[d] ? (
                <img src={a.photos[d].previewUrl} alt={`${BA_DIR_KO[d]} 사진 미리보기`}
                  style={{ width: "100%", aspectRatio: "2 / 3", objectFit: "cover",
                    borderRadius: 10, border: `1px solid ${T.border}`, background: T.sunken }} />
              ) : (
                <div className="flex items-center justify-center"
                  style={{ width: "100%", aspectRatio: "2 / 3", borderRadius: 10,
                    border: `1.5px dashed ${T.borderStrong}`, background: T.sunken,
                    fontSize: 11, color: T.ink3 }}>미등록</div>
              )}
              <figcaption style={{ fontSize: 10.5, color: T.ink3, marginTop: 3 }}>{BA_DIR_KO[d]}</figcaption>
            </figure>
          ))}
        </div>
        <Sec title="분석 결과">
          {a.summary || a.measurements ? (
            <p style={{ fontSize: 13, color: T.ink, margin: 0, whiteSpace: "pre-wrap" }}>{a.summary || ""}</p>
          ) : (
            <EmptyState msg="아직 생성된 분석 결과가 없어요." />
          )}
        </Sec>
        <Sec title="강사 메모">
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} onFocus={kbSafe} rows={3}
            placeholder="촬영 특이사항, 다음 분석 참고 메모"
            aria-label="강사 메모"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${T.border}`,
              fontSize: 13, color: T.ink, background: T.surface, resize: "vertical", boxSizing: "border-box" }} />
          <button onClick={() => !busyGuard.current && onSaveMemo(a.id, memo.trim())}
            style={{ marginTop: 6, minHeight: 40, padding: "0 14px", borderRadius: 10,
              border: `1px solid ${T.border}`, background: T.surface, color: T.a700,
              fontSize: 13, fontWeight: 600 }}>
            메모 저장
          </button>
        </Sec>
        {a.status === "draft" ? (
          <div style={{ marginTop: 16 }}>
            <div className="flex" style={{ gap: 8 }}>
              <button onClick={() => onResume(a)}
                style={{ flex: 1.4, minHeight: 48, borderRadius: 12, border: "none",
                  background: T.a600, color: "#fff", fontSize: 14, fontWeight: 700 }}>
                촬영 이어서 하기
              </button>
              <button onClick={() => setArmDel(true)}
                style={{ flex: 1, minHeight: 48, borderRadius: 12, border: `1px solid ${T.border}`,
                  background: T.surface, color: T.warn, fontSize: 13, fontWeight: 600 }}>
                초안 삭제
              </button>
            </div>
            {armDel ? (
              <div role="alertdialog" aria-label="초안 삭제 확인"
                style={{ marginTop: 8, borderRadius: 12, border: `1px solid ${T.warn}`,
                  background: T.warnS, padding: 12 }}>
                <p style={{ fontSize: 13, color: T.ink, margin: 0 }}>이 초안을 삭제할까요?</p>
                <div className="flex" style={{ gap: 8, marginTop: 10 }}>
                  <button onClick={() => !busyGuard.current && onDeleteDraft(a.id)}
                    style={{ flex: 1, minHeight: 44, borderRadius: 10, border: "none",
                      background: T.warn, color: "#fff", fontSize: 13, fontWeight: 700 }}>
                    초안 삭제
                  </button>
                  <button onClick={() => setArmDel(false)}
                    style={{ flex: 1, minHeight: 44, borderRadius: 10, border: `1px solid ${T.border}`,
                      background: T.surface, color: T.ink, fontSize: 13, fontWeight: 600 }}>
                    취소
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : a.status === "ready_for_analysis" ? (
          <div className="flex" style={{ gap: 8, marginTop: 16 }}>
            <button onClick={() => onResume(a)}
              style={{ flex: 1, minHeight: 48, borderRadius: 12, border: `1px solid ${T.border}`,
                background: T.surface, color: T.ink, fontSize: 13, fontWeight: 600 }}>
              사진 다시 확인
            </button>
            <button onClick={onBack}
              style={{ flex: 1, minHeight: 48, borderRadius: 12, border: `1px solid ${T.border}`,
                background: T.surface, color: T.ink2, fontSize: 13, fontWeight: 600 }}>
              체형 목록으로 돌아가기
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── 탭 라우터(§13) ── */
function BodyAssessmentTab(props) {
  const { screen, memberList, members, assessOf, analysisMemberId, activeAssessmentId } = props;
  const busyGuard = useRef(false);                    // 표시용 가드(핸들러 내부 withBusy 와 이중)
  const findA = (aid) => {
    for (const mm of memberList) {
      const hit = assessOf(mm.id).find((x) => x.id === aid);
      if (hit) return hit;
    }
    return null;
  };
  if (screen === "mode_select" && analysisMemberId && members[analysisMemberId]) {
    return <AssessmentModeSelect m={members[analysisMemberId]} list={assessOf(analysisMemberId)}
      onNext={props.onPickMode} onBack={props.onBackToList} busyGuard={busyGuard} />;
  }
  const a = activeAssessmentId ? findA(activeAssessmentId) : null;
  if (screen === "photo_capture" && a) {
    return <AssessmentPhotoCapture a={a}
      onFile={(dir, file) => props.onUpsertPhoto(a.id, dir, file)}
      onRemove={(dir) => props.onRemovePhoto(a.id, dir)}
      onTempSave={props.onTempSave} onReady={props.onReady}
      onBack={props.onBackToList} busyGuard={busyGuard} />;
  }
  if (screen === "complete" && a) {
    return <AssessmentComplete a={a}
      onGoMember={() => props.onOpenMember(a.memberId)}
      onGoList={props.onBackToList} />;
  }
  if (screen === "detail" && a && members[a.memberId]) {
    return <AssessmentDetail a={a} m={members[a.memberId]}
      onResume={props.onResume} onDeleteDraft={props.onDeleteDraft}
      onSaveMemo={props.onSaveMemo} onBack={props.onBackToList} busyGuard={busyGuard} />;
  }
  return <BodyAssessmentList memberList={memberList} assessOf={assessOf}
    onStart={props.onStart} onOpenDetail={props.onOpenDetail} />;
}
