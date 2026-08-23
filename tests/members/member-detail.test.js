import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const start = source.indexOf("function ReferenceMemberDetail(");
const end = source.indexOf("\nfunction ChangeSummary(", start);
const detail = source.slice(start, end);

test("member detail follows the memory-first card order", () => {
  const headings = [
    "지난 수업",
    "반복해서 기록된 내용",
    "다음 확인",
    "최근 변화",
    "최근 수업 기록",
    "최신 체형분석",
    "현재 이용권",
    "이용권 변경 이력 및 상세 설정",
    "회원 기본정보",
  ];
  let cursor = -1;
  headings.forEach((heading) => {
    const next = detail.indexOf(heading);
    assert.ok(next > cursor, `${heading} must appear in the requested order`);
    cursor = next;
  });
});

test("member detail uses one compact empty memory state and keeps legacy data below memory", () => {
  assert.match(detail, /data-member-section="memory-first"/);
  assert.match(detail, /아직 작성된 수업 기록이 없습니다\./);
  assert.match(detail, /lessonNotes\.length > 0 && <Section title="최근 수업 기록"/);
  assert.ok(detail.indexOf("data-member-section=\"memory-first\"") < detail.indexOf("data-member-section=\"membership\""));
  assert.ok(detail.indexOf("최신 체형분석") < detail.indexOf("data-member-section=\"membership\""));
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
