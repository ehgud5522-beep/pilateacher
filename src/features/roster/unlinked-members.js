/**
 * 센터에 등록되지 않은 회원 -- 기기에만 있는 회원 (2026-10-31). **순수 함수다.**
 *
 * ── 왜 생겼나 ──
 * 센터 계정에서도 회원 탭의 "회원 등록" 이 서버가 아니라 기기에만 회원을 만들었다.
 * 명부는 서버가 원본이라 그런 회원은 목록에서 빠지고(hideUnlinked), 앱을 껐다
 * 켜도 보이지 않았다. 그 버튼은 이제 센터 계정에서 없다 -- 등록은 더보기 →
 * 센터 회원 관리 한 곳이다.
 *
 * ── 이미 생긴 회원 ──
 * 지우지 않는다 (대표). 그 회원에게 수업기록 · 사진이 붙어 있을 수 있다. 하나씩:
 * - 센터 명부에 올린다 -- 같은 이름 · 연락처로 서버에 등록하면 명부가 연락처로
 *   이어 붙인다 (roster-bridge.js). 회원 id 는 바뀌지 않아 기록이 그대로 따라간다
 * - 기존 센터 회원과 잇는다 -- 기기 회원의 연락처를 그 회원의 것으로 맞춘다.
 *   명부는 **연락처로만** 잇는다 (이름으로는 잇지 않는다 -- 동명이인)
 */

import { normalizePhone } from "../../data/repositories/client-repository.js";
import { ROSTER_SOURCE } from "./roster-bridge.js";

const text = (value) => String(value ?? "").trim();

/**
 * 이을 수 있는 센터 회원: 아직 어느 기기 회원과도 이어지지 않았고 연락처가 있는 회원.
 * 이미 이어진 회원과 또 이으면 명부는 먼저 맞은 하나만 붙인다 -- 다른 하나의
 * 기록은 다시 "센터 미등록" 으로 떨어진다.
 */
export function linkCandidates(rosterMembers) {
  return (Array.isArray(rosterMembers) ? rosterMembers : [])
    .filter((member) => member?.rosterSource === ROSTER_SOURCE.ORG && normalizePhone(member?.phone))
    .sort((left, right) => text(left.name).localeCompare(text(right.name), "ko"));
}

/** 센터 명부에 올릴 수 있는가 -- 이름과 연락처가 있어야 한다. 없으면 무엇이 없는지. */
export function uploadReadiness(member) {
  if (!text(member?.name)) return { ready: false, missing: "name" };
  if (!normalizePhone(member?.phone)) return { ready: false, missing: "phone" };
  return { ready: true, missing: "" };
}

export const LINK_OUTCOME = Object.freeze({
  LINKED: "linked",
  MISSING: "missing",
  PHONE_TAKEN: "phone_taken",
});

/**
 * 기기 회원을 센터 회원과 잇는다 -- 연락처를 그 회원의 것으로 맞춘다.
 *
 * 다른 기기 회원이 이미 그 연락처를 쓰고 있으면 잇지 않는다. 명부는 같은 연락처의
 * 기기 회원 중 먼저 나온 하나만 붙이므로, 이으면 어느 쪽 기록이 붙을지 알 수 없다.
 *
 * @returns {{ outcome: string, members: any[] }}
 */
export function linkDeviceMember(members, deviceMemberId, client) {
  const list = Array.isArray(members) ? members : [];
  const phone = normalizePhone(client?.phone);
  const target = list.find((member) => member?.id === deviceMemberId);
  if (!target || !phone) return { outcome: LINK_OUTCOME.MISSING, members: list };
  const taken = list.some((member) => member?.id !== deviceMemberId && normalizePhone(member?.phone) === phone);
  if (taken) return { outcome: LINK_OUTCOME.PHONE_TAKEN, members: list };
  return {
    outcome: LINK_OUTCOME.LINKED,
    members: list.map((member) => (member.id === deviceMemberId ? { ...member, phone } : member)),
  };
}
