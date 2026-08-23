import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const start = source.indexOf("function ReferenceMemberDetail(");
const end = source.indexOf("\nfunction ChangeSummary(", start);
const detail = source.slice(start, end);

const requiredIndex = (needle) => {
  const index = detail.indexOf(needle);
  assert.notEqual(index, -1, `${needle} must exist in member detail`);
  return index;
};

test("member detail follows quick actions, summary, memory, then four management cards", () => {
  const orderedAnchors = [
    'aria-label="회원 빠른 실행"',
    'data-member-section="top-summary"',
    'data-member-section="memory-first"',
    'data-member-management-card="recent-lessons"',
    'data-member-management-card="posture"',
    'data-member-management-card="membership"',
    'data-member-management-card="basic-and-memos"',
  ];
  const positions = orderedAnchors.map(requiredIndex);
  positions.slice(1).forEach((position, index) => assert.ok(position > positions[index], `${orderedAnchors[index + 1]} must follow ${orderedAnchors[index]}`));
  ["최근 수업기록", "체형변화·사진", "이용권·결제", "기본정보·상담메모"].forEach((label) => assert.match(detail, new RegExp(label)));
});

test("member detail keeps the compact empty memory state and provenance dates", () => {
  assert.match(detail, /data-member-section="memory-first"/);
  assert.match(detail, /아직 작성된 수업 기록이 없습니다\./);
  assert.match(detail, /memoryDateLabel\(row\.date\)/);
  assert.match(detail, /memorySourceDate\(.*Memory\)/);
  assert.ok(requiredIndex('data-member-section="memory-first"') < requiredIndex('data-member-management-card="membership"'));
});

test("membership data and posture entry live inside their management cards", () => {
  const postureStart = requiredIndex('data-member-management-card="posture"');
  const membershipStart = requiredIndex('data-member-management-card="membership"');
  const basicStart = requiredIndex('data-member-management-card="basic-and-memos"');
  const postureCard = detail.slice(postureStart, membershipStart);
  const membershipCard = detail.slice(membershipStart, basicStart);
  ["새 체형분석", "과거 이력", "체형분석 과거 이력"].forEach((label) => assert.match(postureCard, new RegExp(label)));
  ["누적 등록 횟수", "이용권 만료일", "회원 회당 금액", "최근 수업일", "정규", "서비스"].forEach((label) => assert.match(membershipCard, new RegExp(label)));
  assert.doesNotMatch(detail.slice(0, membershipStart), /data-member-section="membership"/);
  assert.match(detail.slice(basicStart), /상담 및 중요 메모/);
  assert.match(detail.slice(basicStart), /회원 기본정보/);
});

test("member price keeps paid sessions policy and excludes service sessions", () => {
  assert.match(source, /const paidAvg = \(m\) => \{ const c = \(m\?\.payments \|\| \[\]\)\.reduce\(\(s, p\) => s \+ num\(p\?\.sessions\), 0\)/);
  assert.match(detail, /총 결제액을 정규 유료 횟수로 나눕니다/);
  assert.match(detail, /서비스 횟수는 제외합니다/);
  assert.match(detail, /강사 정산 단가/);
  assert.match(source, /canViewSettlement=\{!account\?\.role \|\| \["owner", "manager", "admin", "director"\]/);
});

test("member detail has scoped edits, confirmation states, and compact empty states", () => {
  assert.match(detail, /변경 전후를 확인해 주세요/);
  assert.match(detail, /확인 후 저장/);
  assert.match(detail, /saving === "basic"/);
  assert.match(detail, /role="alert"/);
  assert.match(detail, /등록된 상담 메모가 없습니다/);
  assert.match(detail, /아직 작성된 수업 기록이 없습니다/);
  assert.match(detail, /중요 메모로 상단 고정/);
  assert.match(detail, /instructorHistory: \[\{ id: uid\(\), date: todayISO\(\), before:/);
});

test("member-only actions are moved above content and do not duplicate bottom navigation", () => {
  assert.match(detail, /aria-label="회원 빠른 실행"/);
  assert.match(detail, /수업 기록/);
  assert.match(detail, /메모 추가/);
  assert.match(detail, /연락하기/);
  assert.doesNotMatch(detail, /absolute bottom-0 left-0 right-0 grid grid-cols-4/);
  assert.match(source, /<Tabs tab=\{tab\} setTab=\{goTab\} \/>/);
});
