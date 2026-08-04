/* Storage shim — Bolt 환경의 window.storage 가 없으면 localStorage 로 대체 */
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    get: (key, shared) => { if (shared) return Promise.reject(new Error("이 환경에서는 공유 저장소를 쓸 수 없습니다")); try { return Promise.resolve({ value: localStorage.getItem(key) }); } catch (e) { return Promise.resolve({ value: null }); } },
    set: (key, val, shared) => { if (shared) throw new Error("이 환경에서는 공유 저장소를 쓸 수 없습니다"); localStorage.setItem(key, String(val)); return Promise.resolve(); },
  };
}

import { useState, useEffect, useMemo, useRef, useCallback, Component } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { fbReady, fbSignInSocial, fbSignInEmail, fbSignUpEmail, fbSignOut, fbOnAuth, fbLoadProfile, fbSaveProfile, fbPushBackup, fbPullBackup } from "./lib/firebase";
import { runAppDualWrite } from "./data/dual-write/app-runtime";
import { Users, Settings as SettingsIcon, Search, ChevronRight, ChevronLeft, Plus, Camera, MessageSquare, Check, X, Trash2, ArrowLeft, Target, ClipboardList, RotateCcw, Sparkles, Copy, ArrowUpRight, ArrowDownRight, Loader as Loader2, Pencil, UserPlus, Activity, Ticket, Calendar, Clock, Bell, Download, TriangleAlert as AlertTriangle, LogOut, Mail, Star, Sun, Moon, Smartphone, Move, Crosshair, ChevronDown, ImagePlus, SlidersHorizontal, CalendarDays, ArrowUpDown, Minus, Upload, Link2, Users as Users2, Play } from "lucide-react";

/* ================= 토큰 · 테마 ================= */
const LIGHT = {
  page: "#F6F7F9", card: "#FFFFFF", soft: "#F1F3F6", line: "#E6E9EF",
  ink: "#1C2433", ink2: "#5E6673", sub: "#6B7484", faint: "#B6BDC9",
  primary: "#4C4399", primaryDark: "#3E3781", brand: "#4C4399", tint: "#ECEBF7", ring: "rgba(76,67,153,.24)",
  toast: "#1C2433",
  good: "#2E7D5B", goodS: "#E7F2EC", bad: "#C2413B", badS: "#FAECEB",
  warn: "#B45309", warnS: "#FAF0E1", mint: "#D9D7EE",
  lavender: "#4C4399", lavenderS: "#F5F4FB", sand: "#F1F3F6",
  shadow: "0 1px 4px rgba(28,36,51,.06)",
  grad: "#4C4399",
  gradSoft: "#F5F4FB",
  splash: "#F6F7F9",
  glow: "radial-gradient(circle, rgba(76,67,153,.12) 0%, transparent 68%)",
  scrim: "rgba(28,36,51,.46)", onBrand: "#FFFFFF", photo: "#171A1D",
};
const DARK = {
  page: "#171A22", card: "#20242E", soft: "#292E39", line: "#373D49",
  ink: "#F4F5F8", ink2: "#D6D9E0", sub: "#AEB4C0", faint: "#737B89",
  primary: "#B8B2E1", primaryDark: "#D2CEF0", brand: "#7068B6", tint: "#302E4A", ring: "rgba(184,178,225,.28)",
  toast: "#30373D",
  good: "#5FDCAE", goodS: "#16382A", bad: "#FF9A90", badS: "#3D1F1C",
  warn: "#E2BB74", warnS: "#3B3020", mint: "#55516F",
  lavender: "#B8B2E1", lavenderS: "#302E4A", sand: "#292E39",
  shadow: "0 0 0 1px rgba(255,255,255,.05), 0 14px 38px rgba(0,0,0,.45)",
  grad: "#7068B6",
  gradSoft: "#302E4A",
  splash: "#171A22",
  glow: "radial-gradient(circle, rgba(195,181,234,.28) 0%, rgba(112,221,214,.10) 45%, transparent 70%)",
  scrim: "rgba(0,0,0,0.66)", onBrand: "#FFFFFF", photo: "#0F0F14",
};
let THEME = "light";
let INK, INK2, SUB, FAINT, PRIMARY, TINT, RING, CANVAS, PAGE, CARD, LINE;
let GOOD, GOOD_S, BAD, BAD_S, WARN, WARN_S, MINT, LAVENDER, LAVENDER_S, SAND, SHADOW, GRAD, GRAD_SOFT, SPLASH_BG, GLOW, SCRIM, ON_BRAND;
let BRAND, BRAND_D, TOAST, PHOTO;
function applyTheme(mode) {
  if (PAGE && THEME === mode) return;
  const p = mode === "dark" ? DARK : LIGHT;
  THEME = mode;
  PAGE = p.page; CARD = p.card; CANVAS = p.soft; LINE = p.line;
  INK = p.ink; INK2 = p.ink2; SUB = p.sub; FAINT = p.faint;
  PRIMARY = p.primary; BRAND = p.brand; BRAND_D = p.primaryDark; TINT = p.tint; RING = p.ring; TOAST = p.toast; PHOTO = p.photo || "#000";
  GOOD = p.good; GOOD_S = p.goodS; BAD = p.bad; BAD_S = p.badS;
  WARN = p.warn; WARN_S = p.warnS; MINT = p.mint; LAVENDER = p.lavender; LAVENDER_S = p.lavenderS; SAND = p.sand;
  SHADOW = p.shadow; GRAD = p.grad; GRAD_SOFT = p.gradSoft;
  SPLASH_BG = p.splash; GLOW = p.glow; SCRIM = p.scrim; ON_BRAND = p.onBrand;

}
function paintThemeVars(mode) {
  if (typeof document !== "undefined") {
    const p = mode === "dark" ? DARK : LIGHT;
    const root = document.documentElement;
    const props = {
      "--page": p.page, "--card": p.card, "--canvas": p.soft, "--line": p.line,
      "--ink": p.ink, "--ink2": p.ink2, "--sub": p.sub, "--faint": p.faint,
      "--primary": p.primary, "--brand": p.brand, "--tint": p.tint, "--ring": p.ring,
      "--toast": p.toast, "--photo": p.photo || "#000",
      "--good": p.good, "--good-s": p.goodS, "--bad": p.bad, "--bad-s": p.badS,
      "--warn": p.warn, "--warn-s": p.warnS, "--mint": p.mint,
      "--lavender": p.lavender, "--lavender-s": p.lavenderS, "--sand": p.sand,
      "--shadow": p.shadow, "--grad": p.grad, "--grad-soft": p.gradSoft,
      "--splash-bg": p.splash, "--glow": p.glow, "--scrim": p.scrim, "--on-brand": p.onBrand,
      "--theme": mode,
    };
    Object.entries(props).forEach(([k, v]) => root.style.setProperty(k, v));
  }
}
applyTheme("light");
const MEMBER_DOT_COLORS = ["#5E8FB4", "#4FA08F", "#8AA36B", "#B4915E", "#6FA3AD", "#7C8BA8", "#A8867C", "#98A0AE"];
const idColor = (id) => {
  let hash = 0;
  for (let i = 0; i < String(id || "").length; i += 1) hash = (hash * 31 + String(id).charCodeAt(i)) >>> 0;
  return MEMBER_DOT_COLORS[hash % MEMBER_DOT_COLORS.length];
};
const THEME_KEY = "pilateacher_theme_v1";
const SCHEDULE_VIEW_KEY = "pilateacher_schedule_view_v1";
const sysDarkNow = () => {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); }
  catch (e) { return false; }
};

/* 파일이 실제로 교체됐는지 1초 만에 확인하는 표시 — 설정 탭 맨 아래에 뜬다 */
const APP_VER = "v83 · 2026-07-29";
const RELEASE_VERSION = String(import.meta.env?.VITE_APP_VERSION || "").trim();
const RELEASE_BUILD_NUMBER = String(import.meta.env?.VITE_BUILD_NUMBER || "").trim();
const RELEASE_COMMIT_SHORT = String(import.meta.env?.VITE_BUILD_COMMIT || "").trim().slice(0, 7);
const APP_BUILD_LABEL = RELEASE_VERSION && RELEASE_BUILD_NUMBER
  ? `${RELEASE_VERSION} (${RELEASE_BUILD_NUMBER})${RELEASE_COMMIT_SHORT ? ` · ${RELEASE_COMMIT_SHORT}` : ""}`
  : APP_VER;
try { if (typeof window !== "undefined") window.PILATEACHER_VER = APP_BUILD_LABEL; } catch (e) {}

const ACC_KEY = "pilateacher_accounts_v1";
const SES_KEY = "pilateacher_session_v1";
const dbKey = (id) => `pilateacher_db_${id}`;
const phKey = (id) => `pilateacher_photos_${id}`;

const METRICS = {
  weight: { key: "weight", label: "체중", unit: "kg", get color() { return PRIMARY; }, goodDir: -1 },
  smm: { key: "smm", label: "골격근량", unit: "kg", get color() { return GOOD; }, goodDir: 1 },
  fat: { key: "fat", label: "체지방률", unit: "%", get color() { return BAD; }, goodDir: -1 },
};
const toneOf = (k, d) => (Math.abs(d) < 0.05 ? "flat" : d * METRICS[k].goodDir > 0 ? "good" : "bad");
const toneColor = (t) => (t === "good" ? GOOD : t === "bad" ? BAD : SUB);
const uLabel = (k) => (METRICS[k].unit === "%" ? "%p" : METRICS[k].unit);

const VIEWS = [{ key: "front", label: "전면" }, { key: "side", label: "측면" }, { key: "back", label: "후면" }];
const CLASS_TYPES = ["개인레슨", "듀엣", "그룹"];
/* 수업료 기본값 — 회원마다 다르면 그 회원 값이 우선한다 */
const DEF_RATE = 25000;
const DEF_GROUP_RATE = 25000;
const rateBase = (st) => ({
  solo: Number(st?.payRate) > 0 ? Number(st.payRate) : DEF_RATE,
  group: Number(st?.groupRate) > 0 ? Number(st.groupRate) : DEF_GROUP_RATE,
});
/* 이 수업 1회로 강사가 받는 금액 */
const rateFor = (m, type, st) => {
  const base = rateBase(st);
  if (!m) return type === "그룹" ? base.group : base.solo;
  if (type === "그룹") return Number(m.groupRate) > 0 ? Number(m.groupRate) : base.group;
  return Number(m.payRate) > 0 ? Number(m.payRate) : base.solo;
};
const EQUIP_TYPES = ["리포머", "캐딜락", "체어", "바렐"];
const NON_CLASS_TYPES = ["상담", "인바디"];
const STATUS = {
  booked: { label: "예약", get color() { return PRIMARY; }, get bg() { return TINT; } },
  done: { label: "출석", get color() { return GOOD; }, get bg() { return GOOD_S; } },
  cancel: { label: "취소", get color() { return SUB; }, get bg() { return CANVAS; } },
  noshow: { label: "노쇼", get color() { return BAD; }, get bg() { return BAD_S; } },
};
const stOf = (k) => STATUS[k] || STATUS.booked;
const PROVIDERS = [
  { key: "kakao", label: "카카오로 시작하기", bg: "#FEE500", fg: "#191600" },
  { key: "naver", label: "네이버로 시작하기", bg: "#03C75A", fg: "#FFFFFF" },
  { key: "google", label: "Google로 시작하기", get bg() { return CARD; }, get fg() { return INK; }, get border() { return LINE; } },
  { key: "apple", label: "Apple로 시작하기", bg: "#000000", fg: "#FFFFFF" },
];
const PROVIDER_LABEL = { kakao: "카카오", naver: "네이버", google: "Google", apple: "Apple", email: "이메일" };
const DEFAULT_PERF = [
  { name: "코어 안정성", now: 50, prev: 50 }, { name: "척추 분절 가동성", now: 50, prev: 50 },
  { name: "고관절 유연성", now: 50, prev: 50 }, { name: "균형 · 정렬", now: 50, prev: 50 },
  { name: "근지구력", now: 50, prev: 50 },
];
const FOCUS_PRESETS = ["거북목", "라운드 숼더", "골반 전방경사", "골반 후방경사", "척추 측만", "흉추 후만", "요추 불안정성", "복직근 이개", "산후 회복", "무릎 정렬"];

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => isoOf(new Date());
const shift = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoOf(d); };
const dow = (iso) => ["일", "월", "화", "수", "목", "금", "토"][new Date(iso + "T00:00:00").getDay()];
/* ===== 대한민국 공휴일 =====
   양력 고정일은 해마다 자동, 음력(설날·추석·부처님오신날)과 대체공휴일은 표로 관리.
   해가 바뀌면 아래 LUNAR_HOL 에 그 해 날짜만 추가하면 됩니다. */
const SOLAR_HOL = {
  "01-01": "신정", "03-01": "삼일절", "05-05": "어린이날", "06-06": "현충일",
  "08-15": "광복절", "10-03": "개천절", "10-09": "한글날", "12-25": "성탄절",
};
const LUNAR_HOL = {
  "2026-02-16": "설날", "2026-02-17": "설날", "2026-02-18": "설날",
  "2026-03-02": "삼일절 대체", "2026-05-24": "부처님오신날", "2026-05-25": "부처님오신날 대체",
  "2026-08-17": "광복절 대체", "2026-09-24": "추석", "2026-09-25": "추석", "2026-09-26": "추석",
  "2026-10-05": "개천절 대체",
  "2027-02-06": "설날", "2027-02-07": "설날", "2027-02-08": "설날", "2027-02-09": "설날 대체",
  "2027-05-13": "부처님오신날", "2027-06-07": "현충일 대체", "2027-08-16": "광복절 대체",
  "2027-09-14": "추석", "2027-09-15": "추석", "2027-09-16": "추석",
  "2027-10-04": "개천절 대체", "2027-10-11": "한글날 대체", "2027-12-27": "성탄절 대체",
  "2028-01-26": "설날", "2028-01-27": "설날",
  "2028-10-02": "추석", "2028-10-04": "추석",
};
const holidayOf = (iso) => (iso ? LUNAR_HOL[iso] || SOLAR_HOL[iso.slice(5)] || null : null);
const dayIdx = (iso) => new Date(iso + "T00:00:00").getDay();
const isSat = (iso) => dayIdx(iso) === 6;
const isSun = (iso) => dayIdx(iso) === 0;
/* 공휴일 · 토 · 일 = 빨간날 */
const isRed = (iso) => !!holidayOf(iso) || isSat(iso) || isSun(iso);
const redInk = (iso, normal) => (isRed(iso) ? BAD : normal);
const monStart = (iso) => { const d = new Date(iso + "T00:00:00"); return shift(iso, -((d.getDay() + 6) % 7)); };
const dday = (iso) => Math.round((new Date(iso + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 864e5);
const ddaySafe = (iso) => { if (!iso) return null; const v = dday(iso); return Number.isFinite(v) ? v : null; };
const md = (iso) => (iso ? `${iso.slice(5, 7)}.${iso.slice(8, 10)}` : "");
const ymd = (iso) => (iso ? `${iso.slice(0, 4)}. ${iso.slice(5, 7)}. ${iso.slice(8, 10)}` : "");
const uid = () => Math.random().toString(36).slice(2, 9);
const weeksBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 6048e5));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const left = (m) => num(m?.regular) + num(m?.service);
const ptf = (p) => `translate(${p?.x || 0}%, ${p?.y || 0}%) scale(${p?.scale || 1}) rotate(${p?.rot || 0}deg)`;
const minOf = (hhmm) => Number(String(hhmm || "0:00").slice(0, 2)) * 60 + Number(String(hhmm || "0:00").slice(3, 5) || 0);
const addMin = (t, min) => {
  const [h, m] = String(t || "0:00").split(":").map(Number);
  const tot = Math.max(0, Math.min(23 * 60 + 59, (h || 0) * 60 + (m || 0) + min));
  return `${String(Math.floor(tot / 60)).padStart(2, "0")}:${String(tot % 60).padStart(2, "0")}`;
};

const deductOne = (members, memberId) => {
  const m = members.find((x) => x.id === memberId);
  if (!m) return { members, from: null };
  if ((m.regular || 0) > 0) return { members: members.map((x) => (x.id === m.id ? { ...x, regular: x.regular - 1 } : x)), from: "정규" };
  if ((m.service || 0) > 0) return { members: members.map((x) => (x.id === m.id ? { ...x, service: x.service - 1 } : x)), from: "서비스" };
  return { members, from: null };
};
const restoreOne = (members, memberId, from) => {
  const k = from === "정규" ? "regular" : "service";
  return members.map((m) => (m.id === memberId ? { ...m, [k]: (m[k] || 0) + 1 } : m));
};

const inbodyOf = (m) => (Array.isArray(m?.inbody) ? m.inbody : [])
  .filter((r) => r && r.date)
  .map((r) => ({ ...r, weight: num(r.weight), smm: num(r.smm), fat: num(r.fat) }))
  .sort((a, b) => (a.date > b.date ? 1 : -1));

const attendeesOf = (s) => {
  if (!s || typeof s !== "object") return [];
  if (Array.isArray(s.attendees) && s.attendees.length) return s.attendees.filter((a) => a && a.memberId);
  return s.memberId ? [{ memberId: s.memberId, status: s.status || "booked", deductFrom: s.deductFrom || null, noshowFee: s.noshowFee ?? null }] : [];
};
const isPersonalEvt = (s) => !!s?.personal;
const isEquipGroup = (s) => !isPersonalEvt(s) && attendeesOf(s).length === 0;
const attOf = (s, id) => attendeesOf(s).find((a) => a.memberId === id);
const hasMember = (s, id) => attendeesOf(s).some((a) => a.memberId === id);
const doneBy = (s, id) => attOf(s, id)?.status === "done";

const lastDoneOf = (schedule, memberId) => {
  const t = todayISO();
  const arr = (Array.isArray(schedule) ? schedule : []).filter((s) => s?.date && s.date <= t && doneBy(s, memberId)).map((s) => s.date).sort();
  return arr.length ? arr[arr.length - 1] : null;
};
const idleDaysOf = (schedule, m) => {
  const last = lastDoneOf(schedule, m.id) || m.startDate;
  if (!last) return null;
  return Math.max(0, -dday(last));
};

function paceOf(schedule, m) {
  const t = todayISO();
  const win = shift(t, -28);
  const start = m.startDate && m.startDate > win ? m.startDate : win;
  const days = Math.max(1, -dday(start));
  const done = (Array.isArray(schedule) ? schedule : []).filter((s) => s?.date && s.date > start && s.date <= t && doneBy(s, m.id)).length;
  const per = done > 0 ? done / Math.max(0.7, days / 7) : 0;
  const short = days < 28;
  const label = done === 0
    ? "출석 기록 없음 · 주 3회로 가정"
    : short
      ? `최근 ${days}일 기준 주 ${per.toFixed(1)}회 (한 달 미만 데이터)`
      : `최근 4주 기준 주 ${per.toFixed(1)}회`;
  return { per, use: per > 0 ? per : 3, days, done, short, label };
}

const addMonths = (iso, n) => { const d = new Date(iso + "T00:00:00"); const day = d.getDate(); d.setMonth(d.getMonth() + n); if (d.getDate() < day) d.setDate(0); return isoOf(d); };
const addMonth = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setMonth(d.getMonth() + n, 1); return isoOf(d); };
const monthKey = (iso) => iso.slice(0, 7);
const monthLabel = (iso) => `${iso.slice(0, 4)}년 ${Number(iso.slice(5, 7))}월`;
function monthStats(schedule, ym) {
  const st = { cls: 0, seats: 0, done: 0, noshow: 0, cancel: 0, booked: 0, group: 0 };
  (Array.isArray(schedule) ? schedule : []).filter((s) => s?.date && s.date.startsWith(ym)).forEach((s) => {
    st.cls += 1;
    if (attendeesOf(s).length > 1) st.group += 1;
    attendeesOf(s).forEach((a) => {
      st.seats += 1;
      if (a.status === "done") st.done += 1;
      else if (a.status === "noshow") st.noshow += 1;
      else if (a.status === "cancel") st.cancel += 1;
      else st.booked += 1;
    });
  });
  return st;
}
function monthGrid(iso) {
  const first = iso.slice(0, 8) + "01";
  const lead = (new Date(first + "T00:00:00").getDay() + 6) % 7;
  const start = shift(first, -lead);
  return Array.from({ length: 42 }, (_, i) => shift(start, i));
}

function attendanceOf(schedule, memberId) {
  const list = Array.isArray(schedule) ? schedule : [];
  const items = list.filter((s) => hasMember(s, memberId) && attOf(s, memberId)?.status !== "booked");
  const done = items.filter((s) => attOf(s, memberId)?.status === "done").length;
  const noshow = items.filter((s) => attOf(s, memberId)?.status === "noshow").length;
  const cancel = items.filter((s) => attOf(s, memberId)?.status === "cancel").length;
  const total = done + noshow + cancel;
  return { done, noshow, cancel, total, rate: total ? Math.round((done / total) * 100) : null };
}

function fileToThumb(file, max = 900) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject; img.src = r.result;
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}
/* ================= 사진 저장소 (IndexedDB) =================
   사진 실물은 IndexedDB 에 Blob 으로, 좌표·분석선만 기존 저장소에.
   화면에서 쓰는 p.src 는 blob: 주소로 그때그때 만들어 붙인다. */
const IDB_NAME = "pilateacher_photos";
const IDB_STORE = "blobs";
let idbP = null;
function idbOpen() {
  if (idbP) return idbP;
  idbP = new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") { rej(new Error("IndexedDB 미지원")); return; }
    const rq = indexedDB.open(IDB_NAME, 1);
    rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
    rq.onblocked = () => rej(new Error("IndexedDB blocked"));
  }).catch((e) => { idbP = null; throw e; });
  return idbP;
}
function idbRun(mode, fn) {
  return idbOpen().then((d) => new Promise((res, rej) => {
    let out;
    const tx = d.transaction(IDB_STORE, mode);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("aborted"));
    tx.oncomplete = () => res(out);
    const rq = fn(tx.objectStore(IDB_STORE));
    if (rq) rq.onsuccess = () => { out = rq.result; };
  }));
}
const blobPut = (k, b) => idbRun("readwrite", (s) => s.put(b, k));
const blobGet = (k) => idbRun("readonly", (s) => s.get(k));
const blobDel = (k) => idbRun("readwrite", (s) => s.delete(k));
const newBlobId = () => "b_" + Date.now().toString(36) + "_" + uid();

const blobToDataUrl = (b) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b);
});
const dataUrlToBlob = async (s) => (await fetch(s)).blob();

/* 원본을 문자열로 만들지 않고 바로 축소 · 사진 회전(EXIF)도 자동 보정 */
async function fileToBlob(file, max = 760, q = 0.7) {
  if (typeof createImageBitmap === "function") {
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) { try { bmp = await createImageBitmap(file); } catch (e2) { bmp = null; } }
    if (bmp) {
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * s));
      c.height = Math.max(1, Math.round(bmp.height * s));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      const out = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
      if (out) return out;
    }
  }
  return dataUrlToBlob(await fileToThumb(file, max));
}

const PHOTO_KEYS = ["front", "side", "back", "poses"];
const objUrls = new Map();
function revokeAllUrls() {
  objUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
  objUrls.clear();
}
function dropUrl(id) {
  const u = objUrls.get(id);
  if (u) { try { URL.revokeObjectURL(u); } catch (e) {} objUrls.delete(id); }
}
async function urlFor(blobId) {
  if (!blobId) return null;
  if (objUrls.has(blobId)) return objUrls.get(blobId);
  try {
    const b = await blobGet(blobId);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    objUrls.set(blobId, u);
    return u;
  } catch (e) { return null; }
}
const blobIdsOf = (ph) => {
  const out = [];
  PHOTO_KEYS.forEach((k) => (Array.isArray(ph?.[k]) ? ph[k] : []).forEach((p) => { if (p?.blobId) out.push(p.blobId); }));
  return out;
};
function forgetBlobs(ids) {
  (ids || []).forEach((id) => { dropUrl(id); blobDel(id).catch(() => {}); });
}
/* 저장 직전: 사진 실물(src)은 빼고 좌표·분석선만 남긴다 */
const stripSrc = (map) => {
  const out = {};
  Object.keys(map || {}).forEach((mid) => {
    const cur = map[mid] || {};
    const next = { ...cur };
    PHOTO_KEYS.forEach((k) => {
      if (!Array.isArray(cur[k])) return;
      next[k] = cur[k].map((p) => { const q = { ...p }; if (q.blobId) delete q.src; return q; });
    });
    out[mid] = next;
  });
  return out;
};
/* 불러올 때: 옛 base64 는 IndexedDB 로 이사시키고, 화면용 blob: 주소를 붙인다 */
async function adoptPhotos(map) {
  let changed = false;
  const out = {};
  for (const mid of Object.keys(map || {})) {
    const cur = map[mid] || {};
    const next = { ...cur };
    for (const k of PHOTO_KEYS) {
      if (!Array.isArray(cur[k])) continue;
      const arr = [];
      for (const p of cur[k]) {
        if (!p) continue;
        let q = p;
        if (!q.blobId && typeof q.src === "string" && q.src.slice(0, 5) === "data:") {
          try {
            const id = newBlobId();
            await blobPut(id, await dataUrlToBlob(q.src));
            q = { ...q, blobId: id };
            changed = true;
          } catch (e) {}
        }
        arr.push(q.blobId ? { ...q, src: (await urlFor(q.blobId)) || q.src || null } : q);
      }
      next[k] = arr;
    }
    out[mid] = next;
  }
  return { map: out, changed };
}
/* 백업·인계용: Blob 을 다시 base64 로 (다른 기기에서도 열리게) */
async function photosForExport(map) {
  const out = {};
  for (const mid of Object.keys(map || {})) {
    const cur = map[mid] || {};
    const next = { ...cur };
    for (const k of PHOTO_KEYS) {
      if (!Array.isArray(cur[k])) continue;
      const arr = [];
      for (const p of cur[k]) {
        const q = { ...p };
        if (q.blobId) {
          try { const b = await blobGet(q.blobId); if (b) q.src = await blobToDataUrl(b); } catch (e) {}
          delete q.blobId;
        }
        arr.push(q);
      }
      next[k] = arr;
    }
    out[mid] = next;
  }
  return out;
}

/* 아이폰·아이패드는 a[download] 가 사진 앱이 아니라 파일 앱으로 가므로 공유 시트를 써야 한다 */
const isIOS = () => {
  try {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch (e) { return false; }
};

/* 앱(Capacitor) 안인지 — 앱 웹뷰에서는 a[download] 가 동작하지 않는다 */
const inApp = () => {
  try { const c = window.Capacitor; return !!(c && typeof c.isNativePlatform === "function" && c.isNativePlatform()); }
  catch (e) { return false; }
};

/* 결과를 정직하게 돌려준다: shared | saved | cancel | manual | fail
   manual = 자동 저장이 막힌 환경 → 화면에 띄워 길게 눌러 저장하게 해야 함 */
async function exportCanvas(canvas, filename, title, saveOnly) {
  let blob = null;
  try { blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92)); } catch (e) {}
  if (!blob) return { how: "fail" };
  const P0 = (typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins) || null;
  /* 0) 갤러리에 바로 저장 (Media 플러그인) — '내 폰에 저장'일 때만 */
  if (saveOnly && P0 && P0.Media) {
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
      await P0.Media.savePhoto({ path: b64, albumIdentifier: undefined, fileName: filename });
      return { how: "gallery" };
    } catch (e) {}
  }
  /* 1) 캐패시터 공유 플러그인이 깔려 있으면 그걸 먼저 */
  try {
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (P && P.Share && P.Filesystem) {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
      const w = await P.Filesystem.writeFile({ path: filename, data: b64, directory: "CACHE" });
      await P.Share.share({ title, files: [w.uri] });
      return { how: "shared" };
    }
  } catch (e) {}
  /* 2) 브라우저 공유 */
  try {
    const file = new File([blob], filename, { type: "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return { how: "shared" };
    }
  } catch (e) { if (e && e.name === "AbortError") return { how: "cancel" }; }
  /* 3) 브라우저 다운로드 — 앱 웹뷰에서는 조용히 실패하므로 시도하지 않는다 */
  if (!inApp()) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return { how: "saved" };
    } catch (e) {}
  }
  /* 4) 클립보드 — 앱에서도 되는 경우가 많다. 복사해서 카톡에 붙여넣기 */
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const png = await new Promise((r) => canvas.toBlob(r, "image/png"));
      if (png) {
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": png })]);
        return { how: "copied" };
      }
    }
  } catch (e) {}
  return { how: "manual", url: canvas.toDataURL("image/jpeg", 0.92) };
}

async function shareCanvas(canvas, filename, title, onToast, saveOnly) {
  const r = await exportCanvas(canvas, filename, title, saveOnly);
  if (r.how === "fail") { onToast && onToast({ ok: false, msg: "이미지를 만들지 못했습니다." }); return false; }
  if (r.how === "saved") { onToast && onToast({ ok: true, msg: "이미지를 저장했습니다." }); return true; }
  if (r.how === "gallery") { onToast && onToast({ ok: true, msg: "사진 앱(갤러리)에 저장했습니다." }); return true; }
  if (r.how === "copied") { onToast && onToast({ ok: true, msg: "이미지를 복사했습니다. 카톡 등에 붙여넣기 하세요." }); return true; }
  if (r.how === "shared" || r.how === "cancel") return true;
  onToast && onToast({ ok: false, msg: "이 화면에서는 자동 저장이 막혀 있습니다. 사진을 길게 눌러 저장해 주세요." });
  return r;
}

async function composeBeforeAfter(before, after, memberName) {
  {
    const load = (src) => new Promise((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [b, a] = await Promise.all([load(before.src), load(after.src)]);
    const W = 900, H = 1200, GAP = 12, FOOT = 96;
    const c = document.createElement("canvas");
    c.width = W * 2 + GAP; c.height = H + FOOT;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0F0F14"; ctx.fillRect(0, 0, c.width, c.height);
    const cell = (img, p, x) => {
      ctx.save(); ctx.beginPath(); ctx.rect(x, 0, W, H); ctx.clip();
      const base = Math.max(W / img.width, H / img.height) * (p?.scale || 1);
      const dw = img.width * base, dh = img.height * base;
      const rot = ((p?.rot || 0) * Math.PI) / 180;
      ctx.translate(x + W / 2 + ((p?.x || 0) / 100) * W, H / 2 + ((p?.y || 0) / 100) * H);
      if (rot) ctx.rotate(rot);
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    };
    /* 화면에서 보던 중심선을 그대로 얹는다 */
    const guides = (x) => {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2;
      [22, 50, 78].forEach((t) => { ctx.beginPath(); ctx.moveTo(x, (H * t) / 100); ctx.lineTo(x + W, (H * t) / 100); ctx.stroke(); });
      ctx.strokeStyle = PRIMARY; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + W / 2, 0); ctx.lineTo(x + W / 2, H); ctx.stroke();
      ctx.restore();
    };
    /* 체형 분석에서 그린 선·각도를 사진 위에 그대로 얹는다 */
    const marksOn = (p, x) => {
      const list = Array.isArray(p?.marks) ? p.marks : [];
      if (!list.length) return;
      ctx.save(); ctx.beginPath(); ctx.rect(x, 0, W, H); ctx.clip();
      const P = (q) => ({ x: x + q.x * W, y: q.y * H });
      list.forEach((m) => {
        if (!m || !Array.isArray(m.pts) || !m.pts.length) return;
        const lw = Math.max(3, (m.width || 3) * 2.6);
        ctx.strokeStyle = m.color || "#F04438"; ctx.fillStyle = m.color || "#F04438";
        ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.lineJoin = "round";
        if (m.tool === "point") { const q = P(m.pts[0]); ctx.beginPath(); ctx.arc(q.x, q.y, lw + 5, 0, Math.PI * 2); ctx.fill(); return; }
        ctx.beginPath();
        if (m.tool === "hline") { const y = m.pts[0].y * H; ctx.moveTo(x, y); ctx.lineTo(x + W, y); }
        else if (m.tool === "vline") { const vx = x + m.pts[0].x * W; ctx.moveTo(vx, 0); ctx.lineTo(vx, H); }
        else m.pts.forEach((q, i) => { const r = P(q); if (i) ctx.lineTo(r.x, r.y); else ctx.moveTo(r.x, r.y); });
        ctx.stroke();
        if (m.tool === "angle" && m.pts.length === 2) {
          const A = P(m.pts[0]), B = P(m.pts[1]);
          [A, B].forEach((q) => { ctx.beginPath(); ctx.arc(q.x, q.y, lw + 4, 0, Math.PI * 2); ctx.fill(); });
          if (m.label) {
            const cx = (A.x + B.x) / 2, cy = (A.y + B.y) / 2 - 36;
            ctx.save();
            ctx.font = "700 30px Pretendard, -apple-system, sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const tw = ctx.measureText(String(m.label)).width;
            ctx.fillStyle = "rgba(10,10,16,.85)"; ctx.fillRect(cx - tw / 2 - 15, cy - 23, tw + 30, 46);
            ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 2; ctx.strokeRect(cx - tw / 2 - 15, cy - 23, tw + 30, 46);
            ctx.fillStyle = "#fff"; ctx.fillText(String(m.label), cx, cy);
            ctx.restore();
          }
        }
      });
      ctx.restore();
    };
    cell(b, before, 0); cell(a, after, W + GAP);
    guides(0); guides(W + GAP);
    marksOn(before, 0); marksOn(after, W + GAP);
    ctx.textBaseline = "middle";
    ctx.font = "700 38px Pretendard, -apple-system, sans-serif";
    const tag = (txt, x) => {
      const w = ctx.measureText(txt).width + 44;
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(x + 24, 24, w, 64);
      ctx.fillStyle = "#fff"; ctx.fillText(txt, x + 46, 57);
    };
    tag(`BEFORE  ${ymd(before.date)}`, 0);
    tag(`AFTER  ${ymd(after.date)}`, W + GAP);
    ctx.font = "700 34px Pretendard, -apple-system, sans-serif";
    ctx.fillStyle = "#A594FF";
    ctx.fillText(`${memberName || "회원"} · ${weeksBetween(before.date, after.date)}주 변화`, 28, H + FOOT / 2);
    return c;
  }
}
async function shareBeforeAfter(before, after, memberName, onToast, saveOnly) {
  try {
    const c = await composeBeforeAfter(before, after, memberName);
    return await shareCanvas(c, `비포애프터_${memberName || "회원"}_${todayISO()}.jpg`, "비포 & 애프터", onToast, saveOnly);
  } catch (e) { onToast && onToast({ ok: false, msg: "이미지를 만들지 못했습니다." }); return false; }
}

function blankMember(staff) {
  return {
    id: uid(), name: "", age: "", birth: "", duetWith: "", instructor: staff || "", goal: "", passName: "", phone: "",
    regular: 0, service: 0, total: 0, startDate: todayISO(), contractEnd: "", focus: [],
    status: "active", endedAt: "", endedReason: "", endedMemo: "",
    holdFrom: "", holdUntil: "", holdReason: "", payRate: 0, groupRate: 0, payments: [],
    goalWeight: 0, goalFat: 0, inbody: [], perf: DEFAULT_PERF.map((p) => ({ ...p })), notes: [],
  };
}
function buildReview(member, ai, bi) {
  const rec = inbodyOf(member);
  if (rec.length < 2) return null;
  const i1 = Math.max(0, Math.min(ai ?? 0, rec.length - 1));
  const i2 = Math.max(0, Math.min(bi ?? rec.length - 1, rec.length - 1));
  const [first, last] = i1 <= i2 ? [rec[i1], rec[i2]] : [rec[i2], rec[i1]];
  if (first === last) return null;
  const weeks = weeksBetween(first.date, last.date);
  const rows = Object.values(METRICS).map((m) => {
    const diff = +(last[m.key] - first[m.key]).toFixed(1);
    return { ...m, from: first[m.key], to: last[m.key], diff, tone: toneOf(m.key, diff) };
  });
  const perf = member.perf || [];
  const gains = perf.map((p) => ({ name: p.name, gain: p.now - p.prev }));
  const avgGain = Math.round(gains.reduce((s, p) => s + p.gain, 0) / (gains.length || 1));
  const best = [...gains].sort((a, b) => b.gain - a.gain)[0];
  const weak = [...perf].sort((a, b) => a.now - b.now)[0];
  const goods = [], cares = [];
  rows.forEach((r) => {
    const txt = `${r.label} ${r.diff > 0 ? "+" : ""}${r.diff}${uLabel(r.key)}`;
    if (r.tone === "good") goods.push(txt); else if (r.tone === "bad") cares.push(txt);
  });
  if (avgGain >= 8) goods.push(`운동 수행 능력 평균 +${avgGain}점`); else if (avgGain <= 2) cares.push("운동 수행 능력 정체 구간");
  if (best && best.gain >= 10) goods.push(`${best.name} +${best.gain}점`);
  if (weak && weak.now < 60) cares.push(`${weak.name} ${weak.now}점 (보완 필요)`);
  const score = goods.length - cares.length;
  const grade = score >= 3 ? { label: "아주 좋은 흐름", tone: "good" }
    : score >= 1 ? { label: "순조롭게 개선 중", tone: "good" }
    : score === 0 ? { label: "변화 관찰 구간", tone: "flat" } : { label: "점검이 필요한 구간", tone: "bad" };
  const fat = rows.find((r) => r.key === "fat"), smm = rows.find((r) => r.key === "smm");
  const headline = `${weeks}주간 체지방률 ${Math.abs(fat.diff)}%p ${fat.diff <= 0 ? "감소" : "증가"}, 골격근량 ${Math.abs(smm.diff)}kg ${smm.diff >= 0 ? "증가" : "감소"}로 ` +
    (fat.diff <= 0 && smm.diff >= 0 ? "근육은 지키면서 지방이 빠지는, 가장 이상적인 형태로 바뀌고 있습니다."
      : fat.diff <= 0 ? "지방은 줄었지만 근육량 유지가 과제입니다." : "체성분 관리 방향을 다시 점검할 시점입니다.");
  const perWeek = (last.weight - first.weight) / weeks;
  let eta = null;
  if (member.goalWeight && perWeek < -0.02 && last.weight > member.goalWeight)
    eta = Math.ceil((last.weight - member.goalWeight) / Math.abs(perWeek));
  const next = [];
  if (eta) next.push(`현재 속도라면 목표 체중 ${member.goalWeight}kg까지 약 ${eta}주 예상`);
  if (weak) next.push(`${weak.name} 집중 보완 프로그램 배정 권장`);
  if (left(member) <= 8) next.push(`잔여 ${left(member)}회 — 목표 달성 전 수강권 연장 상담 필요`);
  return { rows, grade, headline, goods, cares, next, weeks, avgGain, best, weak };
}
const T = todayISO();
const sampleDb = (center, staff) => ({
  settings: { center: center || "필라티쳐 스튜디오", staff: staff || "강사", payRate: DEF_RATE, groupRate: DEF_GROUP_RATE },
  schedule: [
    { id: "s1", memberId: "m1", date: shift(T, -2), start: "10:00", end: "10:50", type: "개인레슨", instructor: staff, room: "1번룸", memo: "", status: "done", deductFrom: "정규", noshowFee: null },
    { id: "s2", memberId: "m2", date: shift(T, -1), start: "11:00", end: "11:50", type: "듀엣", instructor: staff, room: "2번룸", memo: "", status: "noshow", deductFrom: null, noshowFee: null },
    { id: "s3", memberId: "m3", date: T, start: "09:00", end: "09:50", type: "개인레슨", instructor: staff, room: "1번룸", memo: "흉추 신전 위주", status: "booked", deductFrom: null, noshowFee: null },
    { id: "s4", date: T, start: "14:00", end: "14:50", type: "그룹", equip: "리포머", instructor: staff, room: "1번룸", memo: "", attendees: [], groupDone: false },
    { id: "s5", memberId: "m2", date: T, start: "18:00", end: "18:50", type: "듀엣", instructor: staff, room: "2번룸", memo: "", status: "booked", deductFrom: null, noshowFee: null },
    { id: "s6", memberId: "m3", date: shift(T, 1), start: "09:00", end: "09:50", type: "개인레슨", instructor: staff, room: "1번룸", memo: "", status: "booked", deductFrom: null, noshowFee: null },
    { id: "s7", date: shift(T, 2), start: "14:00", end: "14:50", type: "그룹", equip: "캐딜락", instructor: staff, room: "3번룸", memo: "", attendees: [], groupDone: false },
    { id: "s9", date: shift(T, 1), start: "19:00", end: "19:50", type: "그룹", equip: "체어", instructor: staff, room: "그룹룸", memo: "코어 집중", attendees: [], groupDone: false },
    { id: "s10", date: shift(T, -3), start: "19:00", end: "19:50", type: "그룹", equip: "바렐", instructor: staff, room: "그룹룸", memo: "", attendees: [], groupDone: true },
  ],
  members: [
    {
      id: "m1", name: "김지민", age: 34, instructor: staff, phone: "",
      goal: "체지방 감량 · 코어 강화", passName: "개인레슨 30회",
      regular: 13, service: 2, total: 30, startDate: "2026-04-20", contractEnd: shift(T, 34),
      focus: ["골반 전방경사", "라운드 숄더"], goalWeight: 54, goalFat: 24,
      inbody: [
        { date: "2026-04-20", weight: 58.4, smm: 21.8, fat: 32.1 },
        { date: "2026-05-04", weight: 57.9, smm: 22.0, fat: 31.2 },
        { date: "2026-05-18", weight: 57.2, smm: 22.4, fat: 30.0 },
        { date: "2026-06-01", weight: 56.8, smm: 22.7, fat: 29.1 },
        { date: "2026-06-15", weight: 56.3, smm: 22.9, fat: 28.2 },
        { date: "2026-06-29", weight: 55.9, smm: 23.2, fat: 27.3 },
        { date: "2026-07-13", weight: 55.6, smm: 23.4, fat: 26.4 },
      ],
      perf: [
        { name: "코어 안정성", now: 82, prev: 58 }, { name: "척추 분절 가동성", now: 74, prev: 45 },
        { name: "고관절 유연성", now: 68, prev: 50 }, { name: "균형 · 정렬", now: 79, prev: 61 },
        { name: "근지구력", now: 71, prev: 52 },
      ],
      notes: [
        { id: "n1", date: "2026-07-13", type: "개인레슨", instructor: staff, body: "리포머 롤다운 시 요추 분절 가동범위 증가. 숄더브릿지 3세트를 보조 없이 수행했습니다.", tags: [], deductFrom: "정규" },
        { id: "n3", date: "2026-06-29", type: "인바디", instructor: staff, body: "체지방률 27.3%로 첫 측정 대비 4.8%p 감소.", tags: [] },
        { id: "n6", date: "2026-06-01", type: "상담", instructor: staff, body: "8월 목표 체중 54kg으로 재설정, 주 3회 유지 권장.", tags: [] },
      ],
    },
    {
      id: "m2", name: "이서윤", age: 29, instructor: staff, phone: "",
      goal: "허리 통증 완화 · 자세 교정", passName: "듀엣 20회",
      regular: 2, service: 1, total: 20, startDate: "2026-04-27", contractEnd: shift(T, 9),
      focus: ["요추 불안정성"], goalWeight: 51, goalFat: 25,
      inbody: [
        { date: "2026-04-27", weight: 52.8, smm: 19.4, fat: 29.6 },
        { date: "2026-05-25", weight: 52.4, smm: 19.9, fat: 28.4 },
        { date: "2026-06-22", weight: 52.0, smm: 20.3, fat: 27.1 },
        { date: "2026-07-20", weight: 51.6, smm: 20.8, fat: 26.0 },
      ],
      perf: [
        { name: "코어 안정성", now: 66, prev: 40 }, { name: "척추 분절 가동성", now: 58, prev: 38 },
        { name: "고관절 유연성", now: 61, prev: 47 }, { name: "균형 · 정렬", now: 64, prev: 44 },
        { name: "근지구력", now: 55, prev: 41 },
      ],
      notes: [{ id: "n21", date: "2026-07-20", type: "듀엣", instructor: staff, body: "요추 통증 빈도가 주 3회에서 1회로 감소했다고 보고했습니다.", tags: [], deductFrom: "정규" }],
    },
    {
      id: "m3", name: "박준호", age: 41, instructor: staff, phone: "",
      goal: "체형 교정 · 근력 향상", passName: "개인레슨 20회",
      regular: 9, service: 2, total: 20, startDate: "2026-05-11", contractEnd: shift(T, 62),
      focus: ["거북목", "흉추 후만"], goalWeight: 74, goalFat: 18,
      inbody: [
        { date: "2026-05-11", weight: 78.6, smm: 32.1, fat: 24.8 },
        { date: "2026-06-08", weight: 77.4, smm: 32.8, fat: 23.1 },
        { date: "2026-07-06", weight: 76.2, smm: 33.5, fat: 21.4 },
      ],
      perf: [
        { name: "코어 안정성", now: 70, prev: 52 }, { name: "척추 분절 가동성", now: 55, prev: 36 },
        { name: "고관절 유연성", now: 48, prev: 35 }, { name: "균형 · 정렬", now: 62, prev: 48 },
        { name: "근지구력", now: 76, prev: 60 },
      ],
      notes: [{ id: "n31", date: "2026-07-06", type: "개인레슨", instructor: staff, body: "흉추 신전 범위가 확대되어 목 전방 이동 각도가 줄었습니다.", tags: [], deductFrom: "정규" }],
    },
  ],
});
function normalizeDb(data, staff) {
  const d = data && typeof data === "object" ? data : {};
  return {
    settings: { center: d.settings?.center ?? "", staff: d.settings?.staff ?? (staff || ""), payRate: Number(d.settings?.payRate) || DEF_RATE, groupRate: Number(d.settings?.groupRate) || DEF_GROUP_RATE, templates: Array.isArray(d.settings?.templates) ? d.settings.templates : [] },
    members: Array.isArray(d.members) ? d.members.filter(Boolean).map((m) => ({
      ...blankMember(staff), ...m,
      id: m.id || uid(),
      status: m.status === "ended" || m.status === "hold" ? m.status : "active",
      regular: Number(m.regular) || 0, service: Number(m.service) || 0, total: Number(m.total) || 0,
      focus: Array.isArray(m.focus) ? m.focus : [],
      perf: Array.isArray(m.perf) && m.perf.length ? m.perf : DEFAULT_PERF.map((x) => ({ ...x })),
      inbody: Array.isArray(m.inbody) ? m.inbody.filter((r) => r && r.date).map((r) => ({ ...r, id: r.id || uid() })) : [],
      notes: Array.isArray(m.notes) ? m.notes.filter(Boolean) : [],
      payments: Array.isArray(m.payments) ? m.payments.filter(Boolean) : [],
    })) : [],
    schedule: Array.isArray(d.schedule) ? d.schedule.filter((x) => x && x.date).map((x) => ({
      ...x,
      attendees: Array.isArray(x.attendees) && x.attendees.length
        ? x.attendees.filter((a) => a && a.memberId).map((a) => ({ ...a, status: STATUS[a.status] ? a.status : "booked" }))
        : x.memberId ? [{ memberId: x.memberId, status: STATUS[x.status] ? x.status : "booked", deductFrom: x.deductFrom || null, noshowFee: x.noshowFee ?? null }] : [],
    })).filter((x) => x.attendees.length || x.equip || x.personal) : [],
  };
}
const emptyDb = (center, staff) => ({ settings: { center: center || "", staff: staff || "", payRate: DEF_RATE, groupRate: DEF_GROUP_RATE }, schedule: [], members: [] });
/* ================= 공통 UI ================= */
class Guard extends Component {
  constructor(p) { super(p); this.state = { err: null, info: "" }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    const line = (info?.componentStack || "").trim().split("\n")[0] || "";
    this.setState({ info: line.trim() });
  }
  render() {
    if (this.state.err) {
      const label = this.props.label || "이 부분";
      const msg = String(this.state.err?.message || this.state.err);
      const full = `[${label}] ${msg} ${this.state.info}`;
      return (
        <div className="rounded-3xl bg-white p-5" style={{ boxShadow: SHADOW }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} style={{ color: BAD }} />
            <p className="text-sm font-extrabold" style={{ color: INK }}>{label}을(를) 표시하지 못했습니다</p>
          </div>
          <p className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: CANVAS, color: SUB, wordBreak: "break-all" }}>{msg}</p>
          {this.state.info && <p className="mt-1 text-xs" style={{ color: FAINT }}>{this.state.info}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={() => this.setState({ err: null, info: "" })} className="flex-1 rounded-2xl py-2.5 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>다시 시도</button>
            <button onClick={() => { try { navigator.clipboard.writeText(full); } catch (e) {} }} className="rounded-2xl px-4 py-2.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>오류 복사</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const Card = ({ children, className = "" }) => (
  <section className={`rounded-xl bg-white ${className}`} style={{ boxShadow: SHADOW, border: `1px solid ${LINE}` }}>{children}</section>
);
const Sub = ({ children, className = "" }) => <p className={`text-xs ${className}`} style={{ color: SUB }}>{children}</p>;
const inputCls = "h-11 w-full rounded-[10px] border-0 bg-slate-50 px-3.5 text-sm outline-none ring-1 ring-slate-200 focus:ring-2";
const Field = ({ label, hint, children }) => (
  <div>
    <div className="mb-1.5 flex items-baseline gap-2">
      <p className="text-xs font-bold" style={{ color: SUB }}>{label}</p>
      {hint && <span className="text-xs" style={{ color: FAINT }}>{hint}</span>}
    </div>
    {children}
  </div>
);
function DeltaChip({ metricKey, diff }) {
  const t = toneOf(metricKey, diff), c = toneColor(t);
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums" style={{ color: c, backgroundColor: `${c}14` }}>
      {t !== "flat" && <Icon size={12} strokeWidth={2.6} />}{Math.abs(diff).toFixed(1)}{uLabel(metricKey)}
    </span>
  );
}
const PrimaryBtn = ({ children, onClick, disabled, tone = PRIMARY }) => (
  <button onClick={onClick} disabled={disabled}
    className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-extrabold text-white disabled:opacity-40"
    style={{ background: tone === PRIMARY ? GRAD : tone }}>{children}</button>
);
function Avatar({ src, name, size = 48, radius = 16, ring }) {
  const st = {
    width: size, height: size, borderRadius: radius,
    boxShadow: ring ? `0 0 0 2px ${CARD}, 0 0 0 3px ${RING}` : undefined,
  };
  if (src) return <img src={src} alt={name || "프로필"} className="shrink-0 object-cover" style={st} />;
  return (
    <span className="flex shrink-0 items-center justify-center font-extrabold text-white"
      style={{ ...st, background: GRAD, fontSize: Math.round(size * 0.4) }}>{(name || "?").slice(0, 1)}</span>
  );
}

function SelectBox({ value, onChange, children, disabled }) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} disabled={disabled} className={inputCls}
        style={{ appearance: "none", WebkitAppearance: "none", MozAppearance: "none", paddingLeft: 36, opacity: disabled ? 0.5 : 1 }}>
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: SUB }} />
    </div>
  );
}

const to12 = (hhmm) => {
  const h = Number((hhmm || "10:00").slice(0, 2)), m = Number((hhmm || "10:00").slice(3, 5)) || 0;
  return { ap: h < 12 ? "AM" : "PM", h12: h % 12 === 0 ? 12 : h % 12, m };
};
const to24 = (ap, h12, m) => {
  let h = h12 % 12;
  if (ap === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const hm = (h, m) => `${String(Math.max(0, Math.min(23, h))).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
function TimePick({ value, onChange }) {
  const h24 = Number((value || "10:00").slice(0, 2));
  const m = Number((value || "10:00").slice(3, 5)) || 0;
  const ap = h24 < 12 ? "AM" : "PM";
  const setAp = (k) => onChange(hm(k === "AM" ? (h24 >= 12 ? h24 - 12 : h24) : (h24 < 12 ? h24 + 12 : h24), m));
  const hours = ap === "AM" ? Array.from({ length: 12 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => i + 12);
  return (
    <div className="flex gap-1.5">
      <div className="flex shrink-0 gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
        {[{ k: "AM", l: "오전" }, { k: "PM", l: "오후" }].map((o) => (
          <button key={o.k} type="button" onClick={() => setAp(o.k)}
            aria-pressed={ap === o.k}
            className="rounded-xl px-2.5 py-2 text-xs font-extrabold"
            style={ap === o.k
              ? { backgroundColor: BRAND, color: "#fff", boxShadow: `0 2px 8px ${RING}` }
              : { backgroundColor: "transparent", color: SUB }}>{o.l}</button>
        ))}
      </div>
      <div className="min-w-0 flex-1"><SelectBox value={h24} onChange={(e) => onChange(hm(Number(e.target.value), m))}>
        {hours.map((x) => <option key={x} value={x}>{String(x).padStart(2, "0")}시</option>)}
      </SelectBox></div>
      <div className="min-w-0 flex-1"><SelectBox value={m} onChange={(e) => onChange(hm(h24, Number(e.target.value)))}>
        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((x) => <option key={x} value={x}>{String(x).padStart(2, "0")}분</option>)}
      </SelectBox></div>
    </div>
  );
}

/* 안드로이드 하드웨어 뒤로가기로 겹쳐진 화면을 닫는다.
   ⚠️ 브라우저·미리보기(iframe)에서는 켜지 않는다. 히스토리 스택이 우리 것이 아니라
   back() 이 시트가 아니라 페이지 자체를 되돌려 앱이 재시작된다. */
const BACK_OK = (() => {
  try {
    if (typeof window === "undefined") return false;
    const cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true;
    return false;
  } catch (e) { return false; }
})();
const backStack = [];
let backSwallow = 0, backSeq = 0;
function useBackClose(open, close) {
  useEffect(() => {
    if (!open || !BACK_OK) return;
    const token = ++backSeq;
    const bornAt = Date.now();
    const entry = { close, token };
    backStack.push(entry);
    let pushed = false;
    try { window.history.pushState({ ptk: token }, ""); pushed = true; } catch (e) {}
    let done = false;
    const onPop = () => {
      if (backSwallow > 0) { backSwallow -= 1; return; }
      if (done) return;
      if (backStack[backStack.length - 1] !== entry) return;
      if (Date.now() - bornAt < 400) return;
      done = true;
      const i = backStack.indexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
      try { close(); } catch (e) {}
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      const i = backStack.indexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
      /* 우리가 넣은 칸이 아직 맨 위일 때만 되돌린다 — 아니면 페이지가 통째로 뒤로 간다 */
      let mine = false;
      try { mine = !!(window.history.state && window.history.state.ptk === token); } catch (e) {}
      if (!done && pushed && mine) { backSwallow += 1; try { window.history.back(); } catch (e) {} }
    };
  }, [open]);
}

/* 전체화면 편집 중에는 뒤 배경이 안 밀리게.
   iOS 는 overflow:hidden 만으로는 안 막혀서 position:fixed 까지 써야 한다. */
let lockDepth = 0, lockY = 0, lockPrev = null;
function useScrollLock() {
  useEffect(() => {
    const b = document.body, d = document.documentElement;
    if (lockDepth === 0) {
      lockY = window.scrollY || window.pageYOffset || 0;
      lockPrev = { ov: b.style.overflow, dov: d.style.overflow, pos: b.style.position, top: b.style.top, w: b.style.width, ob: b.style.overscrollBehavior };
      b.style.overflow = "hidden"; d.style.overflow = "hidden"; b.style.overscrollBehavior = "none";
      b.style.position = "fixed"; b.style.top = `-${lockY}px`; b.style.width = "100%";
    }
    lockDepth += 1;
    return () => {
      lockDepth -= 1;
      if (lockDepth > 0) return;
      lockDepth = 0;
      if (lockPrev) {
        b.style.overflow = lockPrev.ov; d.style.overflow = lockPrev.dov; b.style.overscrollBehavior = lockPrev.ob;
        b.style.position = lockPrev.pos; b.style.top = lockPrev.top; b.style.width = lockPrev.w;
        lockPrev = null;
      }
      try { window.scrollTo(0, lockY); } catch (e) {}
    };
  }, []);
}

function Sheet({ title, sub, subtitle, onClose, children, wide = false }) {
  const panelRef = useRef(null);
  const lastFocus = useRef(null);
  useBackClose(true, onClose);
  useScrollLock();
  useEffect(() => {
    lastFocus.current = typeof document !== "undefined" ? document.activeElement : null;
    const timer = setTimeout(() => panelRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      try { lastFocus.current?.focus?.(); } catch (e) {}
    };
  }, []);
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = panelRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const secondary = sub || subtitle;
  return (
    <div className="fixed inset-0" style={{ zIndex: 60 }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" style={{ background: "rgba(28,36,51,0.32)" }} onClick={onClose} />
      <section ref={panelRef} tabIndex={-1} onKeyDown={onKeyDown}
        className="sheet-in absolute bottom-0 left-1/2 flex w-full flex-col bg-white"
        style={{ transform: "translateX(-50%)", maxWidth: 420, maxHeight: wide ? "92dvh" : "86dvh",
          borderRadius: "16px 16px 0 0", boxShadow: "0 -8px 24px rgba(28,36,51,0.12)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-start justify-between" style={{ padding: "16px 16px 6px" }}>
          <div className="min-w-0">
            <h3 style={{ fontSize: 17, lineHeight: 1.35, fontWeight: 600, color: INK }}>{title}</h3>
            {secondary ? <p className="tabular-nums" style={{ fontSize: 12, color: INK2, marginTop: 2 }}>{secondary}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex shrink-0 items-center justify-center"
            style={{ width: 44, height: 44, marginTop: -6, marginRight: -8, borderRadius: 8, color: INK2 }}>
            <X size={18} />
          </button>
        </div>
        <div className="pt-scroll" style={{ overflowY: "auto", padding: "4px 16px 20px" }}>{children}</div>
      </section>
    </div>
  );
}
function ScheduleBottomSheet({ title, subtitle, onClose, returnFocusRef, children }) {
  const panelRef = useRef(null);
  const returnFocus = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useBackClose(true, onClose);
  useScrollLock();
  useEffect(() => {
    returnFocus.current = returnFocusRef?.current || document.activeElement;
    const panel = panelRef.current;
    const focusable = () => [...(panel?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
    const first = focusable()[0];
    if (first) requestAnimationFrame(() => first.focus());
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const a = items[0], b = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const target = returnFocus.current;
      requestAnimationFrame(() => { try { target?.focus?.(); } catch (e) {} });
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: SCRIM }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="schedule-sheet-title"
        className="w-full overflow-y-auto bg-white"
        style={{ maxWidth: 420, maxHeight: "92dvh", borderRadius: "16px 16px 0 0",
          boxShadow: "0 -8px 24px rgba(28,36,51,.12)", padding: "16px 16px calc(20px + env(safe-area-inset-bottom, 0px))" }}>
        <div className="mb-2 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="schedule-sheet-title" style={{ fontSize: 17, fontWeight: 600, color: INK }}>{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs" style={{ color: SUB }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="닫기" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ marginTop: -6, marginRight: -8, color: SUB }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function GuideOverlay({ strong = false }) {
  const c = strong ? BRAND : RING;
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-y-0 left-1/2 w-px" style={{ backgroundColor: c }} />
      {[22, 50, 78].map((t) => <div key={t} className="absolute inset-x-0" style={{ top: `${t}%`, height: 1, backgroundColor: "rgba(255,255,255,0.5)" }} />)}
    </div>
  );
}
const Logo = ({ size = 64, radius = 0.24 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="필라티쳐"
    style={{ borderRadius: size * radius, display: "block", boxShadow: `0 18px 40px ${RING}, 0 4px 10px ${RING}` }}>
    <defs>
      <linearGradient id="ptg" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stopColor="#5D55AA" />
        <stop offset="100%" stopColor={BRAND} />
      </linearGradient>
      <linearGradient id="ptGloss" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.38" />
        <stop offset="70%" stopColor="#FFFFFF" stopOpacity="0" />
      </linearGradient>
    </defs>
    <rect width="100" height="100" rx={100 * radius} fill="url(#ptg)" />
    <rect width="100" height="54" rx={100 * radius} fill="url(#ptGloss)" />
    <g stroke="#FFFFFF" strokeLinecap="round" strokeOpacity="0.4">
      <line x1="8" y1="50" x2="92" y2="50" strokeWidth="1.2" strokeDasharray="3.5 3.5" />
      <line x1="50" y1="8" x2="50" y2="92" strokeWidth="1.2" strokeDasharray="3.5 3.5" />
    </g>
    <path fillRule="evenodd" fill="#FFFFFF"
      d="M34.5 24 H50.5 a15 15 0 0 1 0 30 H46 V76 H34.5 Z M46 34 h4.5 a5 5 0 0 1 0 10 H46 Z" />
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <g stroke={BRAND} strokeWidth="9">
        <path d="M69 42 L62 31" />
        <path d="M69 42 H83" />
        <path d="M69 42 V57" />
        <path d="M69 57 L63.5 71.5 M69 57 L74.5 71.5" />
      </g>
      <g stroke="#FFFFFF" strokeWidth="4.5">
        <path d="M69 42 L62 31" />
        <path d="M69 42 H83" />
        <path d="M69 42 V57" />
        <path d="M69 57 L63.5 71.5 M69 57 L74.5 71.5" />
      </g>
    </g>
    <circle cx="69" cy="29.5" r="7" fill={LAVENDER} />
    <circle cx="69" cy="29.5" r="5.8" fill="#FFFFFF" />
    <g fill={BRAND} stroke="#FFFFFF" strokeWidth="1.6">
      {[[62, 31], [83, 42], [69, 42], [69, 57], [63.5, 71.5], [74.5, 71.5]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" />
      ))}
    </g>
  </svg>
);
/* ===== 인사말 =====
   응원 3 : 지식 1 비율로 뜬다. 응원은 시간대·요일에 맞게, 최근에 나온 건 피한다. */
const greetKey = (h) => (h < 6 ? "late" : h < 9 ? "dawn" : h < 11 ? "morning" : h < 14 ? "noon" : h < 17 ? "afternoon" : h < 20 ? "evening" : h < 23 ? "night" : "late");

const CHEER = {
  dawn: [
    "첫 수업 전 5분, 오늘 만날 회원님 기록 한 번만 훑고 가세요",
    "새벽엔 관절이 굳어 있습니다. 워밍업을 평소보다 길게 잡아 주세요",
    "이 시간에 나오는 회원은 의지가 강합니다. 그만큼 잘 따라옵니다",
    "강사님 몸부터 한 번 풀고 시작해요. 시범도 운동입니다",
    "오늘의 첫 큐잉이 하루 수업의 톤을 정합니다",
    "이른 아침 수업일수록 회원 컨디션을 먼저 물어봐 주세요",
    "오늘 첫 회원의 이름과 목표를 떠올리며 들어가 보세요",
    "새벽 수업 후 강사님 아침도 꼭 챙기세요",
  ],
  morning: [
    "오전 회원은 가동범위부터 천천히 열어 주세요",
    "어제 못 적은 코멘트, 지금이 제일 기억이 선명할 때입니다",
    "이름을 부르며 시작하면 회원의 집중도가 달라집니다",
    "오늘 한 명에게만이라도 '지난번보다 좋아졌다'고 말해 주세요",
    "수업 전 30초, 오늘 무엇을 볼지 정하고 들어가면 흐름이 삽니다",
    "오전에는 설명보다 시범이 빨리 통합니다",
    "지난 수업에서 아팠다고 한 부위, 오늘 먼저 확인해 주세요",
    "잘한 동작 하나를 짚어 주면 회원은 그걸 기억하고 갑니다",
  ],
  noon: [
    "오전 수업 하느라 애쓰셨어요. 물 한 잔 하고 가요",
    "식사 직후 회원은 복부 압박이 부담스러울 수 있습니다",
    "잠깐 앉아서 어깨 한 번 돌리고 가세요",
    "오전에 잘 됐던 동작 하나만 적어두면 오후가 편해집니다",
    "여기까지 오신 것만으로 오늘 절반은 하셨습니다",
    "점심 전 수업은 저혈당을 조심하세요. 어지럼 호소가 있으면 바로 앉히기",
    "오전 회원 중 잔여가 얼마 안 남은 분이 있었는지 한 번 보세요",
    "이 시간에 5분만 앉아 쉬면 오후 수업이 달라집니다",
  ],
  afternoon: [
    "나른한 시간대엔 템포를 살짝 올려 보세요",
    "오후 회원은 종일 앉아 있다 옵니다. 흉추부터 열어 주세요",
    "지금 기지개 한 번. 강사님 허리도 소중합니다",
    "남은 수업을 미리 훑어두면 전환이 매끄러워집니다",
    "집중이 떨어질 땐 동작을 줄이고 큐잉을 늘려 보세요",
    "졸린 시간엔 호흡을 크게 쓰는 동작부터 넣어 보세요",
    "오후 회원에게는 손목·목 스트레칭을 먼저 권해 보세요",
    "지금까지 한 수업 중 기록 안 남긴 게 있는지 확인해 보세요",
  ],
  evening: [
    "퇴근길 회원은 목·어깨가 굳어 있습니다. 상부부터 풀어 주세요",
    "가장 바쁜 시간이죠. 호흡 한 번 고르고 들어가요",
    "저녁 회원은 피로가 쌓여 있습니다. 강도보다 정렬에 집중하세요",
    "오늘 제일 잘 됐던 수업 하나만 떠올려 보세요",
    "지친 회원에게는 '오늘 나온 것만으로 잘했다'는 말이 큽니다",
    "저녁 회원은 배고픈 상태일 수 있습니다. 무리한 강도는 피하세요",
    "하루 종일 서 계셨습니다. 다음 수업 전에 한 번 앉으세요",
    "마지막 두 수업이 하루 인상을 결정합니다",
  ],
  night: [
    "늦은 수업은 마무리를 이완으로. 교감신경이 올라가면 잠을 방해합니다",
    "오늘 코멘트를 자기 전에 남기면 내일이 가벼워집니다",
    "긴 하루였습니다. 마지막 회원까지 잘 마무리해요",
    "오늘 몇 사람의 몸을 바꿔 놓으셨습니다",
    "수업이 끝나면 강사님 몸도 한 번 정리해 주세요",
    "야간 수업은 조명을 조금 낮추면 회원이 더 이완합니다",
    "오늘 노쇼·취소가 있었다면 이유를 한 줄만 남겨 두세요",
    "내일 첫 수업만 확인해 두고 마무리해요",
  ],
  late: [
    "이 시간까지 정리 중이시라면, 내일의 강사님이 고마워할 겁니다",
    "오늘은 충분히 하셨어요. 나머지는 내일에 맡겨요",
    "수면도 회복 훈련입니다. 강사님부터 지키세요",
    "고생 많았습니다. 오늘 밤은 포근하게 마무리해요",
    "회복 없이는 근육도 실력도 자라지 않습니다",
    "지금 정리보다 잠이 더 중요할 수 있습니다",
    "내일 아침의 나를 위해 오늘은 여기까지",
  ],
  satAM: [
    "토요일 오전만 지나면 이번 주가 끝납니다",
    "주말 회원은 여유가 있어요. 평소보다 한 동작 더 가 보세요",
    "오늘 점심이면 마무리입니다. 컨디션 잘 챙기세요",
    "주말 아침 몸은 더 굳어 있습니다. 준비 운동을 넉넉히",
    "이번 주 마지막 수업들입니다. 조금만 더 힘내요",
    "주말 오전은 회원 컨디션이 가장 좋은 시간대입니다",
    "이번 주 못 만난 회원이 있는지 한 번 보세요",
  ],
  satPM: [
    "이번 주 수업 마감. 남은 주말은 강사님 시간입니다",
    "한 주 동안 여러 사람의 자세를 바꿔 놓으셨습니다",
    "오늘만큼은 강사님 몸도 쉬게 해 주세요",
    "한 주를 잘 닫았습니다. 다음 주는 월요일에 생각해요",
    "이번 주 기록이 비어 있는 회원만 한 번 확인하고 마쳐요",
    "주말 오후엔 강사님 몸도 한 번 풀어 주세요",
    "이번 주 사진이나 인바디를 남긴 회원이 있었나요",
  ],
  sun: [
    "내일 만날 회원님 기록만 훑어봐도 월요일이 가벼워집니다",
    "일요일은 회복하는 날. 강사님 몸도 쉬어야 합니다",
    "다음 주 회원님들을 미리 그려 보는 시간, 이게 강사님의 강점이 됩니다",
    "월요일이 가벼워지는 방법은 하나예요. 내일 수업을 미리 보는 것",
    "이번 주 잔여가 적은 회원만 미리 봐 두면 한 주가 편합니다",
    "쉬는 것도 일의 일부입니다. 오늘은 비워 두세요",
    "다음 주 첫 수업 회원의 목표만 떠올려 보세요",
  ],
};

/* 해부학 · 필라테스 지식 (전체의 1/4 확률로 등장) */
const KNOW = [
  "복횡근은 허리를 코르셋처럼 감싸는 가장 깊은 복근입니다. 숨을 내쉴 때 먼저 켜집니다",
  "요방형근이 짧아지면 그쪽 골반이 올라갑니다. 사이드 벤드 좌우 차이를 보세요",
  "중둔근이 약하면 걸을 때 골반이 흔들립니다. 사이드 라잉 시리즈가 지름길입니다",
  "흉추는 원래 뒤로 굽은 뼈입니다. 문제는 굽은 게 아니라 안 펴지는 것입니다",
  "장요근은 척추와 다리를 잇는 유일한 근육입니다. 오래 앉으면 여기부터 짧아집니다",
  "견갑골은 뼈에 거의 붙어 있지 않습니다. 주변 근육이 자리를 잡아 줍니다",
  "필라테스 호흡은 갈비뼈를 옆으로 넓히는 측방 호흡입니다. 배를 부풀리지 않습니다",
  "파워하우스는 골반저근·복횡근·다열근·횡격막을 묶어 부르는 말입니다",
  "다열근은 척추뼈를 하나씩 잇는 작은 근육입니다. 롤다운이 부드러우면 살아 있는 겁니다",
  "골반저근은 숨을 내쉴 때 함께 올라옵니다. 따로 힘주지 않아도 됩니다",
  "전거근이 약하면 팔을 올릴 때 견갑골이 날개처럼 뜹니다",
  "햄스트링이 짧으면 숙일 때 허리가 대신 굽습니다. 유연성만의 문제가 아닐 수 있습니다",
  "고관절 굴곡은 대략 120도까지입니다. 그 이상은 골반이 따라 움직인 것입니다",
  "어깨를 180도 올릴 때 그중 60도는 견갑골이 회전해 만듭니다",
  "조셉 필라테스는 이것을 '컨트롤로지'라 불렀습니다. 힘이 아니라 통제입니다",
  "코어는 배가 아니라 통입니다. 위는 횡격막, 아래는 골반저근",
  "리포머 스프링은 무거울수록 어려운 게 아닙니다. 동작에 따라 보조가 되기도 합니다",
  "척추 중립은 곧게 편 상태가 아니라 원래 곡선을 유지한 상태입니다",
  "발 아치가 무너지면 무릎이 안으로 들어옵니다. 스쿼트 교정은 발에서 시작할 때가 많습니다",
  "통증이 있는 자리가 원인인 경우는 드뭅니다. 위아래 관절을 함께 보세요",
  "대둔근은 몸에서 가장 큰 근육이지만 앉아 있으면 가장 먼저 잠듭니다",
  "목뼈는 머리 무게 5kg 을 받칩니다. 15도만 숙여도 12kg 으로 늘어납니다",
  "복직근 이개는 산후에 흔합니다. 크런치보다 복횡근 활성이 먼저입니다",
  "관절 가동범위는 근육만의 문제가 아닙니다. 신경이 안전하다고 느껴야 열립니다",
];

const cheerPool = () => {
  const now = new Date(), day = now.getDay(), h = now.getHours();
  if (day === 0) return CHEER.sun;
  if (day === 6 && h >= 6) return h < 14 ? CHEER.satAM : CHEER.satPM;
  return CHEER[greetKey(h)] || CHEER.morning;
};

/* 최근 나온 문구를 기억해 두고 겹치지 않게 고른다 */
const GREET_SEEN = "pilateacher_greet_v1";
function pickGreet() {
  let seen = [];
  try { const v = window.localStorage.getItem(GREET_SEEN); if (v) seen = JSON.parse(v) || []; } catch (e) { seen = []; }
  const know = Math.random() < 0.25;
  const pool = know ? KNOW : cheerPool();
  /* 이 묶음에서 최근에 나온 것들은 빼고 고른다. 항상 두 개 이상은 남겨 둔다 */
  const keep = Math.max(3, pool.length - 2);
  const mine = seen.filter((x) => pool.indexOf(x) >= 0).slice(0, keep);
  let fresh = pool.filter((x) => mine.indexOf(x) < 0);
  if (!fresh.length) fresh = pool;
  const text = fresh[Math.floor(Math.random() * fresh.length)];
  try {
    const next = [text, ...seen.filter((x) => x !== text)].slice(0, 80);
    window.localStorage.setItem(GREET_SEEN, JSON.stringify(next));
  } catch (e) {}
  return text;
}
let GREET_NOW = "";
try { GREET_NOW = pickGreet(); } catch (e) { GREET_NOW = CHEER.morning[0]; }
const greetLine = () => GREET_NOW;

const DAILY_LINES = [
  "기록이 쌓이면 회원은 남습니다",
  "오늘 남긴 코멘트가 3개월 뒤 재등록이 됩니다",
  "숫자로 보여주면 회원은 확신합니다",
  "변화는 사진 두 장이면 증명됩니다",
  "출석률이 곧 회원의 신뢰입니다",
  "오늘의 1분 기록이 내일의 상담을 만듭니다",
  "잘 가르치는 강사는 잘 기록합니다",
];
const dailyLine = () => DAILY_LINES[new Date().getDate() % DAILY_LINES.length];

const NOTE_TEMPLATES = {
  "코어 · 안정성": ["코어 안정성 향상", "플랭크 60초 무보조 유지", "복부 압력 조절 안정", "골반 흔들림 감소"],
  "척추 · 가동성": ["요추 분절 가동범위 증가", "흉추 신전 각도 개선", "롤다운 부드럽게 수행", "척추 중립 유지 가능"],
  "골반 · 하체": ["골반 정렬 개선", "고관절 굴곡근 단축 관찰", "둔근 활성도 향상", "무릎 정렬 안정적"],
  "어깨 · 상체": ["견갑 안정성 향상", "라운드 숄더 완화", "목 전방 이동 감소", "승모근 과사용 줄어듦"],
  "호흡 · 인지": ["측방 호흡 전환 성공", "복횡근 인지 향상", "동작 중 호흡 유지 가능"],
  "컨디션 · 통증": ["통증 없이 전 동작 수행", "허리 불편감 호소 — 강도 조절", "컨디션 저하로 강도 낮춤", "생리 주기로 저강도 진행"],
  "다음 계획": ["다음 시간 난이도 상향 예정", "보완 운동 추가 배정", "동일 프로그램 반복 예정", "재평가 후 프로그램 조정"],
};

const restLabel = (idle) => (idle === null ? "첫 수업 전" : idle === 0 ? "오늘 수업" : `운동 안 한 지 ${idle}일`);

const isEnded = (m) => m?.status === "ended";
const isHold = (m) => m?.status === "hold";
const isActive = (m) => !isEnded(m) && !isHold(m);
/* 생년월일이 있으면 나이를 계산하고, 없으면 직접 적은 나이를 쓴다 */
const ageFromBirth = (b) => {
  if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const d = new Date(b + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a -= 1;
  return a >= 0 && a < 130 ? a : null;
};
const ageOf = (m) => {
  const a = ageFromBirth(m?.birth);
  if (a !== null) return a;
  const n = num(m?.age);
  return n > 0 ? n : null;
};
/* 이름을 아직 안 적은 회원 = 작성 중 */
const isDraft = (m) => !String(m?.name || "").trim();
/* 이름도 기록도 전혀 없는, 안전하게 지울 수 있는 회원 */
const isBlankDraft = (m) => isDraft(m) && left(m) === 0 && !num(m?.total)
  && !(m?.payments || []).length && !(m?.inbody || []).length && !(m?.notes || []).length;
const won = (n) => (Number(n) || 0).toLocaleString("ko-KR");
const paidTotal = (m) => (m?.payments || []).reduce((s, p) => s + num(p?.amount), 0);
const paidCount = (m) => (m?.payments || []).reduce((s, p) => s + num(p?.sessions) + num(p?.service), 0);
const paidAvg = (m) => { const c = (m?.payments || []).reduce((s, p) => s + num(p?.sessions), 0); return c ? Math.round(paidTotal(m) / c) : 0; };
const INBODY_EXTRA = [
  { k: "fatMass", l: "체지방량", u: "kg" }, { k: "bmi", l: "BMI", u: "" },
  { k: "bmr", l: "기초대사량", u: "kcal" }, { k: "visceral", l: "내장지방", u: "레벨" },
  { k: "score", l: "인바디 점수", u: "점" },
];
function Splash() {
  return (
    <div className="fixed inset-0 z-50 overflow-hidden" style={{ background: SPLASH_BG }}>
      <div className="pointer-events-none absolute" style={{
        width: 560, height: 560, left: "50%", top: "40%", transform: "translate(-50%,-50%)",
        background: GLOW,
      }} />
      <div className="relative flex h-full flex-col items-center justify-center px-8">
        <div className="splash-pop relative">
          <span className="ring1 absolute" style={{ inset: -24, borderRadius: 40, border: `1px solid ${RING}` }} />
          <span className="ring2 absolute" style={{ inset: -46, borderRadius: 56, border: `1px solid ${RING}` }} />
          <Logo size={108} />
        </div>
        <h1 className="splash-fade mt-8 text-4xl font-extrabold" style={{ color: INK, letterSpacing: "-0.045em" }}>필라티쳐</h1>
        <div className="splash-fade mt-4 h-px w-12" style={{ backgroundColor: RING }} />
        <p className="splash-fade2 mt-4 text-sm font-extrabold" style={{ color: PRIMARY, letterSpacing: "0.02em" }}>강사를 위한 전문 회원 관리</p>
        <p className="splash-fade2 mt-1.5 text-xs font-medium" style={{ color: SUB }}>오늘의 수업이 회원의 변화가 됩니다</p>
      </div>
      <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-3">
        <div className="h-1 w-32 overflow-hidden rounded-full" style={{ backgroundColor: LINE }}>
          <div className="loadbar h-full rounded-full" style={{ backgroundColor: BRAND }} />
        </div>
        <p className="splash-fade2 text-xs" style={{ color: FAINT }}>PILATEACHER</p>
      </div>
    </div>
  );
}

function AuthScreen({ accounts, onLogin, onSignup, onToast }) {
  const [mode, setMode] = useState("main");
  const [emailTab, setEmailTab] = useState("login");
  const [auto, setAuto] = useState(true);
  const [signup, setSignup] = useState(null);
  const [f, setF] = useState({ name: "", email: "", pw: "", center: "", phone: "" });

  const [busy, setBusy] = useState(false);
  const handleSocial = async (provider) => {
    if (fbReady) {
      if (provider !== "google" && provider !== "apple") {
        onToast({ ok: false, msg: "지금은 Google \u00b7 Apple \u00b7 \uc774\uba54\uc77c\ub85c\ub9cc \ub85c\uadf8\uc778\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4." });
        return;
      }
      setBusy(true);
      try {
        const u = await fbSignInSocial(provider);
        const prof = await fbLoadProfile(u.id);
        if (prof && prof.center) onLogin({ ...u, ...prof, id: u.id }, auto);
        else setSignup({ ...u, provider, center: "", phone: "", fb: true });
      } catch (e) {
        onToast({ ok: false, msg: e && e.code === "auth/popup-closed-by-user" ? "\ub85c\uadf8\uc778\uc744 \ucde8\uc18c\ud588\uc2b5\ub2c8\ub2e4." : "\ub85c\uadf8\uc778\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4. \uc7a0\uc2dc \ub4a4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694." });
      }
      setBusy(false);
      return;
    }
    const exist = accounts.find((a) => a.provider === provider);
    if (exist) { onLogin(exist, auto); return; }
    setSignup({ provider, name: "", email: "", center: "", phone: "" });
  };

  return (
    <div className="min-h-screen" style={{ background: SPLASH_BG }}>
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-8 pt-16">
        <div className="flex flex-col items-center">
          <Logo size={88} />
          <h1 className="mt-5 text-3xl font-extrabold" style={{ color: INK, letterSpacing: "-0.04em" }}>필라티쳐</h1>
          <p className="mt-2 text-sm font-extrabold" style={{ color: PRIMARY }}>강사를 위한 전문 회원 관리</p>
          <p className="mt-1 text-xs" style={{ color: SUB }}>수업 · 체형 변화 · 재등록을 한 화면에서</p>
        </div>

        <div className="mt-10 flex-1">
          {mode === "main" ? (
            <div className="space-y-2">
              {PROVIDERS.map((p) => (
                <button key={p.key} onClick={() => handleSocial(p.key)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-extrabold"
                  style={{ backgroundColor: p.bg, color: p.fg, border: p.border ? `1px solid ${p.border}` : "none" }}>
                  {p.label}
                </button>
              ))}
              <div className="flex items-center gap-3 py-3">
                <div className="h-px flex-1" style={{ backgroundColor: LINE }} />
                <span className="text-xs font-bold" style={{ color: SUB }}>또는</span>
                <div className="h-px flex-1" style={{ backgroundColor: LINE }} />
              </div>
              <button onClick={() => setMode("email")}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-extrabold"
                style={{ backgroundColor: CANVAS, color: INK }}>
                <Mail size={16} /> 이메일로 시작하기
              </button>
            </div>
          ) : (
            <div>
              <div className="flex gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
                {[{ k: "login", l: "로그인" }, { k: "signup", l: "회원가입" }].map((t) => (
                  <button key={t.k} onClick={() => setEmailTab(t.k)} className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                    style={emailTab === t.k ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{t.l}</button>
                ))}
              </div>
              <div className="mt-4 space-y-3">
                {emailTab === "signup" && (
                  <>
                    <Field label="강사 이름"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예) 박서연" className={inputCls} /></Field>
                    <Field label="센터명"><input value={f.center} onChange={(e) => setF({ ...f, center: e.target.value })} placeholder="예) 필라티쳐 강남점" className={inputCls} /></Field>
                    <Field label="연락처" hint="선택"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="010-" className={inputCls} /></Field>
                  </>
                )}
                <Field label="이메일"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="teacher@studio.com" className={inputCls} /></Field>
                <Field label="비밀번호"><input type="password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} placeholder="6자 이상" className={inputCls} /></Field>
                <PrimaryBtn
                  disabled={busy || (emailTab === "signup" ? !(f.name && f.email && f.pw.length >= 6 && f.center) : !(f.email && f.pw))}
                  onClick={async () => {
                    if (fbReady) {
                      setBusy(true);
                      try {
                        if (emailTab === "signup") {
                          const u = await fbSignUpEmail(f.email, f.pw, f.name);
                          onSignup({ ...u, provider: "email", name: f.name, email: f.email, center: f.center, phone: f.phone, fb: true }, auto);
                        } else {
                          const u = await fbSignInEmail(f.email, f.pw);
                          const prof = await fbLoadProfile(u.id);
                          if (prof && prof.center) onLogin({ ...u, ...prof, id: u.id }, auto);
                          else setSignup({ ...u, provider: "email", center: "", phone: "", fb: true });
                        }
                      } catch (e) {
                        const c = (e && e.code) || "";
                        onToast({ ok: false, msg:
                          c === "auth/email-already-in-use" ? "\uc774\ubbf8 \uac00\uc785\ub41c \uc774\uba54\uc77c\uc785\ub2c8\ub2e4."
                          : c === "auth/weak-password" ? "\ube44\ubc00\ubc88\ud638\ub97c 6\uc790 \uc774\uc0c1\uc73c\ub85c \ub9cc\ub4e4\uc5b4 \uc8fc\uc138\uc694."
                          : c === "auth/invalid-email" ? "\uc774\uba54\uc77c \ud615\uc2dd\uc774 \uc62c\ubc14\ub974\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4."
                          : "\uc774\uba54\uc77c \ub610\ub294 \ube44\ubc00\ubc88\ud638\uac00 \ub9de\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4." });
                      }
                      setBusy(false);
                      return;
                    }
                    if (emailTab === "signup") {
                      if (accounts.some((a) => a.email === f.email)) { onToast({ ok: false, msg: "이미 가입된 이메일입니다." }); return; }
                      onSignup({ provider: "email", name: f.name, email: f.email, pw: f.pw, center: f.center, phone: f.phone }, auto);
                    } else {
                      const acc = accounts.find((a) => a.email === f.email && a.pw === f.pw);
                      if (!acc) { onToast({ ok: false, msg: "이메일 또는 비밀번호가 맞지 않습니다." }); return; }
                      onLogin(acc, auto);
                    }
                  }}>
                  {emailTab === "signup" ? "가입하고 시작하기" : "로그인"}
                </PrimaryBtn>
                <button onClick={() => setMode("main")} className="w-full py-2 text-xs font-bold" style={{ color: SUB }}>다른 방법으로 로그인</button>
              </div>
            </div>
          )}

          <button onClick={() => setAuto((v) => !v)} className="mt-5 flex w-full items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md"
              style={auto ? { backgroundColor: BRAND } : { backgroundColor: CARD, border: `1px solid ${LINE}` }}>
              {auto && <Check size={13} color="#fff" />}
            </span>
            <span className="text-sm font-bold" style={{ color: INK }}>자동 로그인</span>
            <span className="ml-auto text-xs" style={{ color: SUB }}>다음부터 바로 시작합니다</span>
          </button>

          {!fbReady && accounts.length > 0 && (
            <div className="mt-6">
              <Sub>최근 로그인</Sub>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {accounts.map((a) => (
                  <button key={a.id} onClick={() => onLogin(a, auto)} className="flex items-center gap-1.5 rounded-full py-2 pl-2 pr-3" style={{ backgroundColor: CARD, boxShadow: SHADOW }}>
                    <Avatar src={a.photo} name={a.name} size={24} radius={12} />
                    <span className="text-xs font-bold" style={{ color: INK }}>{a.name}</span>
                    <span className="text-xs" style={{ color: SUB }}>{PROVIDER_LABEL[a.provider]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs leading-relaxed" style={{ color: FAINT }}>
          {fbReady ? "회원 사진은 이 기기에만 저장되며 외부로 전송되지 않습니다." : "회원 정보와 사진은 이 기기에만 저장되며 외부 서버로 전송되지 않습니다."}<br />
          로그인하면 이용약관 및 개인정보 처리방침에 동의하게 됩니다.
        </p>
      </div>

      {signup && (
        <Sheet title={`${PROVIDER_LABEL[signup.provider]} 계정으로 가입`} onClose={() => setSignup(null)}>
          <div className="space-y-3">
            <Sub>처음 로그인이라 강사 정보를 등록합니다. 여기 입력한 내용이 앱 안에 그대로 표시됩니다.</Sub>
            <Field label="강사 이름"><input value={signup.name} onChange={(e) => setSignup({ ...signup, name: e.target.value })} placeholder="예) 박서연" className={inputCls} /></Field>
            <Field label="센터명"><input value={signup.center} onChange={(e) => setSignup({ ...signup, center: e.target.value })} placeholder="예) 필라티쳐 강남점" className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="이메일"><input value={signup.email} onChange={(e) => setSignup({ ...signup, email: e.target.value })} placeholder="teacher@studio.com" className={inputCls} disabled={!!signup.fb} /></Field>
              <Field label="연락처" hint="선택"><input value={signup.phone} onChange={(e) => setSignup({ ...signup, phone: e.target.value })} placeholder="010-" className={inputCls} /></Field>
            </div>
            <PrimaryBtn disabled={!(signup.name && signup.center)} onClick={() => onSignup(signup, auto)}>가입하고 시작하기</PrimaryBtn>
          </div>
        </Sheet>
      )}
    </div>
  );
}
function Header({ settings, account, alertCount, onProfile, onAlerts }) {
  return (
    <header className="bg-white" style={{ borderBottom: `1px solid ${LINE}` }}>
      <div className="mx-auto flex items-center gap-2.5 px-3" style={{ height: 44, maxWidth: 420 }}>
        <Logo size={26} radius={0.24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold" style={{ color: INK, maxWidth: "100%" }}>{settings.center || "필라티쳐"}</p>
          <Sub className="truncate">{account?.name ? `${account.name} 강사` : "체형 변화 · 재등록 관리"}</Sub>
        </div>
        {alertCount > 0 && (
          <button onClick={onAlerts} aria-label={`재등록 상담이 필요한 회원 ${alertCount}명 보기`}
            className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-extrabold" style={{ backgroundColor: BAD_S, color: BAD }}>
            <Bell size={13} /> 재등록 {alertCount}
          </button>
        )}
        <button onClick={onProfile} className="shrink-0" aria-label="내 프로필">
          <Avatar src={account?.photo} name={account?.name} size={30} radius={10} ring />
        </button>
      </div>
    </header>
  );
}
function Tabs({ tab, setTab }) {
  const items = [
    { key: "schedule", label: "일정", icon: Calendar }, { key: "members", label: "회원", icon: Users },
    { key: "analysis", label: "체형분석", icon: Activity }, { key: "settings", label: "설정", icon: SettingsIcon },
  ];
  return (
    <nav className="safe-tab z-40 flex shrink-0" aria-label="주요 메뉴"
      style={{ height: 49, boxSizing: "content-box", borderTop: `1px solid ${LINE}`, backgroundColor: CARD }}>
      <div className="flex h-[49px] w-full items-center">
        {items.map((it) => {
          const on = tab === it.key, Icon = it.icon;
          return (
            <button key={it.key} type="button" aria-current={on ? "page" : undefined} onClick={() => setTab(it.key)} className="relative flex h-[49px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium"
              style={{ color: on ? BRAND : SUB }}>
              <span className="relative flex items-center justify-center">
                <Icon size={20} strokeWidth={on ? 2.2 : 1.7} />
                {on && <span aria-hidden="true" className="absolute" style={{ bottom: -3, width: 18, height: 2, borderRadius: 1, backgroundColor: BRAND }} />}
              </span>
              <span style={{ fontWeight: on ? 700 : 500 }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* 알림을 미뤄둔 회원 — 그 날짜까지 골든타임에서 숨긴다 */
const isSnoozed = (m) => !!(m?.snoozeUntil && dday(m.snoozeUntil) > 0);

/* 수강권 흔적이 하나라도 있으면 '등록한 적 있는 회원' */
const everRegistered = (m) => !!(
  (m?.passName && String(m.passName).trim()) ||
  left(m) > 0 ||
  (m?.payments || []).length > 0 ||
  num(m?.total) > 0 ||
  (m?.contractEnd && String(m.contractEnd).trim())
);

/* 잔여가 다 떨어진 회원 — 재등록 상담이 이미 지났거나 종료 처리가 필요한 사람 */
function spentMembers(members, schedule) {
  return members.filter((m) => {
    if (isEnded(m) || isHold(m)) return false;
    if (left(m) > 0) return false;
    if (!everRegistered(m) && !attendanceOf(schedule, m.id).done) return false;
    return true;
  });
}
function detectAlerts(members, schedule) {
  const out = [];
  members.forEach((m) => {
    if (isEnded(m)) return;
    if (isSnoozed(m)) return;
    const att = attendanceOf(schedule, m.id);
    /* 등록 이력도 출석 기록도 없는 빈 회원은 재등록 대상이 아니다 */
    if (!everRegistered(m) && !att.done) return;
    if (isHold(m)) {
      const d = ddaySafe(m.holdUntil);
      if (d !== null && d <= 3)
        out.push({ member: m, kind: "return", rest: left(m), d, att, reasons: [d < 0 ? `수업 재개 예정 ${Math.abs(d)}일 경과` : `수업 재개 D-${d}`], urgency: 25 + Math.max(0, 3 - d) });
      return;
    }
    const rest = left(m);
    /* 잔여가 0이면 이미 소진된 상태 — 골든타임(소진 전에 잡는 알림)에서는 뺀다.
       대신 아래 spent 로 따로 세어 '정리 필요'로 보여 준다. */
    if (rest <= 0) return;
    const d = ddaySafe(m.contractEnd);
    const pc = paceOf(schedule, m);
    const pace = pc.use;
    const wks = rest > 0 ? rest / pace : 0;
    const reasons = [];
    if (rest > 0 && wks <= 4) reasons.push(`${pc.short && pc.done ? `${pc.days}일 기준` : "주"} ${pace.toFixed(1)}회 · 약 ${Math.max(1, Math.round(wks))}주 뒤 소진`);
    if (rest < 10) reasons.push(`잔여 ${rest}회`);
    if (d !== null && d < 30) reasons.push(d < 0 ? `만료 ${Math.abs(d)}일 경과` : `만료 D-${d}`);
    if (!reasons.length) return;
    const urgency = (10 - Math.min(rest, 10)) * 3 + (d !== null ? Math.max(0, 30 - d) / 2 : 0) + (wks ? Math.max(0, 4 - wks) * 6 : 0);
    out.push({ member: m, kind: "renew", rest, d, wks, pace, pc, reasons, att, urgency });
  });
  return out.sort((a, b) => b.urgency - a.urgency);
}
function AlertCenter({ alerts, spent, onOpenMember, onBrief, onSnooze, snoozedCount, onUnsnoozeAll }) {
  const [open, setOpen] = useState(false);
  const spentN = (spent || []).length;
  if (!alerts.length && !snoozedCount && !spentN) return null;
  return (
    <section className="mb-3 overflow-hidden rounded-3xl" style={{ background: `linear-gradient(150deg, ${BAD_S} 0%, ${CARD} 55%)`, border: `1px solid ${LINE}`, boxShadow: SHADOW }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3.5 text-left">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: BAD_S }}><Bell size={16} style={{ color: BAD }} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-extrabold" style={{ color: INK }}>재등록 골든타임</h3>
          <Sub className="truncate">{alerts.length ? `지금 연락해야 할 회원 ${alerts.length}명` : spentN ? `잔여를 다 쓴 회원 ${spentN}명` : "지금 연락할 회원은 없습니다"}</Sub>
        </div>
        {alerts.length > 0 && !open && (
          <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: BAD_S, color: BAD }}>{alerts.length}</span>
        )}
        <span className="shrink-0 text-xs font-extrabold" style={{ color: PRIMARY }}>{open ? "접기" : "보기"}</span>
        <ChevronRight size={16} className="shrink-0" style={{ color: PRIMARY, transform: open ? "rotate(90deg)" : "none", transition: "transform .18s ease" }} />
      </button>
      {open && spentN > 0 && (
        <div className="px-4 pb-3">
          <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
            <p className="text-xs font-extrabold" style={{ color: INK }}>잔여를 다 쓴 회원 {spentN}명</p>
            <Sub className="mt-0.5 block">재등록을 했거나, 더 안 나오면 종료로 바꿔 주세요</Sub>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(spent || []).slice(0, 12).map((m) => (
                <button key={m.id} onClick={() => onOpenMember(m.id)} className="rounded-full bg-white px-2.5 py-1.5 text-xs font-bold" style={{ color: INK }}>
                  {m.name || "이름 미입력"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {snoozedCount > 0 && (
        <div className="flex items-center gap-2 px-4 pb-3">
          <Sub className="min-w-0 flex-1">알림을 미뤄둔 회원 {snoozedCount}명</Sub>
          <button onClick={onUnsnoozeAll} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-extrabold" style={{ color: PRIMARY }}>다시 보기</button>
        </div>
      )}
      {open && alerts.length > 0 && (
        <div className="flex gap-3 overflow-x-auto px-4 pb-4">
          {alerts.map((a) => {
            const urgent = a.rest <= 3;
            return (
              <div key={a.member.id} className="w-64 shrink-0 rounded-2xl p-4" style={{ backgroundColor: CANVAS }}>
                <div className="flex items-center gap-2">
                  <button onClick={() => onOpenMember(a.member.id)} className="text-sm font-extrabold" style={{ color: INK }}>{a.member.name || "이름 미입력"}</button>
                  <span className="rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: urgent ? BAD_S : WARN_S, color: urgent ? BAD : WARN }}>{a.reasons[0]}</span>
                </div>
                <div className="mt-2 flex items-end gap-3">
                  <div><Sub>잔여</Sub><p className="text-2xl font-extrabold tabular-nums" style={{ color: urgent ? BAD : INK }}>{a.rest}회</p></div>
                  {a.d !== null && <div><Sub>만료</Sub><p className="text-2xl font-extrabold tabular-nums" style={{ color: a.d <= 7 ? BAD : INK }}>{a.d < 0 ? `+${Math.abs(a.d)}` : `D-${a.d}`}</p></div>}
                  {a.kind === "renew" && a.wks > 0 && <div><Sub>소진예상</Sub><p className="text-2xl font-extrabold tabular-nums" style={{ color: a.wks <= 4 ? BAD : INK }}>{Math.max(1, Math.round(a.wks))}주</p></div>}
                </div>
                <Sub className="mt-1 truncate">{a.member.passName || "수강권 미입력"} · {a.member.instructor}</Sub>
                <button onClick={() => onBrief(a)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>
                  <Sparkles size={13} /> AI 재등록 브리핑 생성
                </button>
                <div className="mt-1.5 flex gap-1.5">
                  {[7, 30].map((n) => (
                    <button key={n} onClick={() => onSnooze && onSnooze(a.member.id, n)}
                      className="flex-1 rounded-xl bg-white py-2 text-xs font-bold" style={{ color: SUB }}>{n}일 숨기기</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
function SalesBriefModal({ alert, onClose, onToast }) {
  const { member, rest, d, att } = alert;
  const r = useMemo(() => buildReview(member), [member]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const fallback = useCallback(() => {
    const fat = r?.rows.find((x) => x.key === "fat"), smm = r?.rows.find((x) => x.key === "smm");
    return `${member.name} 회원님, 지난 ${r ? r.weeks : 0}주 동안 ` +
      (fat && smm ? `체지방률이 ${Math.abs(fat.diff)}%p 줄고 골격근량이 ${Math.abs(smm.diff)}kg 늘었습니다. ` : "체형이 꾸준히 개선됐습니다. ") +
      (r && r.best ? `수행 능력도 평균 ${r.avgGain}점 올랐고, 특히 ${r.best.name}이 크게 좋아졌습니다. ` : "") +
      (att.rate !== null ? `출석률 ${att.rate}%로 성실하게 참여해 주신 결과입니다. ` : "") +
      `지금이 변화 속도가 가장 빠른 구간인데 수강권이 ${rest}회 남았습니다. ` +
      (r?.weak ? `다음 3개월은 ${r.weak.name} 보완에 집중해 목표까지 마무리하시길 권해 드립니다.` : "흐름이 끊기지 않게 이어가시길 권해 드립니다.");
  }, [member, r, att, rest]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6", max_tokens: 1000,
            messages: [{ role: "user", content: "너는 필라테스 스튜디오의 베테랑 강사다. 아래 데이터로 재등록 상담에서 회원에게 직접 말할 멘트를 써라.\n조건: 5~6문장 존댓말. ①숫자 근거로 성과 인정 → ②지금 멈추면 아까운 이유 → ③다음 3개월 제안. 압박·과장 금지, 마크다운 없이 한 문단.\n\n" + JSON.stringify({ 회원: member.name, 목표: member.goal, 잔여: rest, 만료D: d, 출석: att, 체성분: r?.rows.map((x) => `${x.label} ${x.from}→${x.to}`), 수행능력: (member.perf || []).map((p) => `${p.name} ${p.prev}→${p.now}`) }) }],
          }),
        });
        const data = await res.json();
        const t = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        if (alive) setText(t || fallback());
      } catch (e) { if (alive) setText(fallback()); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [member.id]);

  return (
    <Sheet title={`${member.name} 재등록 브리핑`} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2">
        {[{ l: "잔여", v: `${rest}회`, c: rest <= 3 ? BAD : INK },
          { l: "만료", v: d === null ? "-" : d < 0 ? `+${Math.abs(d)}일` : `D-${d}`, c: d !== null && d <= 7 ? BAD : INK },
          { l: "출석률", v: att.rate === null ? "-" : `${att.rate}%`, c: INK }].map((x) => (
          <div key={x.l} className="rounded-2xl p-3 text-center" style={{ backgroundColor: CANVAS }}>
            <Sub>{x.l}</Sub><p className="text-lg font-extrabold tabular-nums" style={{ color: x.c }}>{x.v}</p>
          </div>
        ))}
      </div>
      {r && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
          {r.rows.map((x) => (
            <div key={x.key} className="text-center">
              <Sub>{x.label}</Sub>
              <p className="text-sm font-extrabold tabular-nums" style={{ color: INK }}>{x.from} → {x.to}</p>
              <p className="text-xs font-bold" style={{ color: toneColor(x.tone) }}>{x.diff > 0 ? "+" : ""}{x.diff}{uLabel(x.key)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-2xl p-4" style={{ backgroundColor: TINT }}>
        <p className="text-xs font-extrabold" style={{ color: PRIMARY }}>상담 멘트</p>
        {loading ? <p className="mt-2 flex items-center gap-2 text-sm" style={{ color: SUB }}><Loader2 size={14} className="animate-spin" /> 회원 데이터를 분석하는 중…</p>
          : <p className="mt-2 text-sm leading-relaxed" style={{ color: INK }}>{text}</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <button disabled={loading} onClick={async () => {
          try { await navigator.clipboard.writeText(text); onToast({ ok: true, msg: "멘트를 복사했습니다." }); }
          catch (e) { onToast({ ok: false, msg: "복사하지 못했습니다." }); }
        }} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-extrabold text-white disabled:opacity-40" style={{ backgroundColor: BRAND }}>
          <Copy size={14} /> 멘트 복사
        </button>
        <button onClick={onClose} className="rounded-2xl px-5 py-3 text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>닫기</button>
      </div>
    </Sheet>
  );
}
function SchedAttendeeRow({ s, a, members, onStatus, onNoshowFee }) {
  const m = members.find((x) => x.id === a.memberId);
  const nm = m?.name || "삭제된 회원";
  const st = stOf(a.status);
  return (
    <div className="rounded-xl bg-white p-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-extrabold" style={{ color: INK }}>{nm}</span>
        {m && (left(m) > 0
          ? <Sub>잔여 {left(m)}회</Sub>
          : <span className="rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: BAD_S, color: BAD }}>잔여 0</span>)}
        <span className="rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {a.status !== "done"
          ? <button onClick={() => onStatus(s.id, "done", a.memberId)} className="rounded-full px-2.5 py-1 text-xs font-extrabold text-white" style={{ backgroundColor: GOOD }}>출석</button>
          : <button onClick={() => onStatus(s.id, "booked", a.memberId)} className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>출석 취소</button>}
        {a.status !== "noshow" && <button onClick={() => onStatus(s.id, "noshow", a.memberId)} className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: CANVAS, color: BAD }}>노쇼</button>}
        {a.status !== "cancel" && <button onClick={() => onStatus(s.id, "cancel", a.memberId)} className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>수업 취소</button>}
        {a.deductFrom && <span className="self-center text-xs font-bold" style={{ color: SUB }}>{a.deductFrom} −1회</span>}
      </div>
      {a.status === "noshow" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg p-2" style={{ backgroundColor: BAD_S }}>
          {a.noshowFee == null ? (
            <>
              <span className="text-xs font-bold" style={{ color: INK }}>노쇼 차감할까요?</span>
              <button onClick={() => onNoshowFee(s.id, true, a.memberId)} className="rounded-full px-2.5 py-1 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>1회 차감</button>
              <button onClick={() => onNoshowFee(s.id, false, a.memberId)} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold" style={{ color: SUB }}>다음으로</button>
            </>
          ) : a.noshowFee ? (
            <>
              <span className="rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: CARD, color: BAD }}>{a.deductFrom || "정규"} 1회 차감됨</span>
              <button onClick={() => onNoshowFee(s.id, false, a.memberId)} className="text-xs font-bold" style={{ color: SUB }}>차감 취소</button>
            </>
          ) : (
            <>
              <span className="text-xs font-bold" style={{ color: SUB }}>차감 없이 기록</span>
              <button onClick={() => onNoshowFee(s.id, true, a.memberId)} className="text-xs font-extrabold" style={{ color: BAD }}>1회 차감하기</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* 일간·주간·월간 목록용 한 줄 요약 — 출석 처리는 '오늘 수업' 에서만 한다 */
function SchedLine({ s, members, onEdit }) {
  const nameOf = (id) => members.find((m) => m.id === id)?.name || "삭제된 회원";
  const pv = isPersonalEvt(s);
  const list = attendeesOf(s);
  const eq = isEquipGroup(s);
  const settled = pv ? true : eq ? !!s.groupDone || !!s.groupCancelled : list.length > 0 && list.every((a) => a.status !== "booked");
  const st = pv ? { label: "내 일정", color: MINT, bg: CANVAS }
    : eq ? (s.groupCancelled ? { label: "취소", color: BAD, bg: BAD_S } : s.groupDone ? { label: "완료", color: GOOD, bg: GOOD_S } : { label: "예정", color: PRIMARY, bg: TINT })
    : list.length > 1 ? { label: `${list.filter((a) => a.status === "done").length}/${list.length} 출석`, color: settled ? GOOD : PRIMARY, bg: settled ? GOOD_S : TINT }
    : stOf(list[0]?.status);
  const edge = pv ? MINT : s.groupCancelled ? BAD : settled ? GOOD : PRIMARY;
  const title = pv ? (s.title || "내 일정") : eq
    ? `${s.equip || "기구"} 그룹 · ${num(s.groupCount) > 0 ? `예정 ${num(s.groupCount)}명` : "인원 미입력"}`
    : list.map((a) => nameOf(a.memberId)).join(", ") || "회원 없음";
  return (
    <button onClick={() => onEdit(s)} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left"
      style={{ backgroundColor: settled ? CANVAS : CARD, borderLeft: `4px solid ${edge}`, border: `1px solid ${settled ? "transparent" : LINE}`, borderLeftWidth: 4, borderLeftColor: edge, opacity: settled ? 0.72 : 1 }}>
      <span className="w-11 shrink-0 text-xs font-extrabold tabular-nums" style={{ color: settled ? SUB : edge }}>{s.start}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-extrabold" style={{ color: INK, textDecoration: st.label === "취소" ? "line-through" : "none" }}>{title}</span>
      <span className="hidden shrink-0 text-xs sm:inline" style={{ color: SUB }}>{pv ? "" : eq ? "그룹" : s.type}</span>
      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
      <Pencil size={12} className="shrink-0" style={{ color: FAINT }} />
    </button>
  );
}

function SchedItem({ s, members, del, setDel, setEditing, onStatus, onNoshowFee, onGroupDone, onDelete }) {
  const nameOf = (id) => members.find((m) => m.id === id)?.name || "삭제된 회원";
  if (isPersonalEvt(s)) return (
    <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS, borderLeft: `4px solid ${MINT}` }}>
      <div className="flex items-center gap-2">
        <div className="w-14 shrink-0">
          <p className="text-sm font-extrabold tabular-nums" style={{ color: MINT }}>{s.start}</p>
          <Sub>{s.end}</Sub>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold" style={{ color: INK }}>{s.title || "내 일정"}</p>
          <Sub className="truncate">{s.memo || "개인 일정"}</Sub>
        </div>
        <button onClick={() => setEditing(s)} className="rounded-full bg-white px-2.5 py-1.5" style={{ color: SUB }}><Pencil size={12} /></button>
        <button onClick={() => onDelete(s.id)} className="rounded-full bg-white px-2.5 py-1.5" style={{ color: FAINT }}><Trash2 size={12} /></button>
      </div>
    </div>
  );
  const list = attendeesOf(s);
  const eq = isEquipGroup(s);
  const group = list.length > 1 || s.type === "그룹";
  const doneN = list.filter((a) => a.status === "done").length;
  return (
    <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
      <div className="flex items-center gap-2">
        <div className="w-14 shrink-0">
          <p className="text-sm font-extrabold tabular-nums" style={{ color: INK }}>{s.start}</p>
          <Sub>{s.end}</Sub>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold" style={{ color: INK }}>
            {eq ? `그룹 · ${s.equip || "기구 미선택"}` : group ? `${s.type} · ${list.length}명` : nameOf(list[0]?.memberId)}
          </p>
          <Sub className="truncate">
            {eq ? [s.instructor, s.room].filter(Boolean).join(" · ") : group ? list.map((a) => nameOf(a.memberId)).join(", ") : [s.type, s.instructor, s.room].filter(Boolean).join(" · ")}
          </Sub>
        </div>
        {eq
          ? <span className="rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: s.groupDone ? GOOD_S : TINT, color: s.groupDone ? GOOD : PRIMARY }}>{s.groupDone ? "완료" : "예정"}</span>
          : group
          ? <span className="rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: doneN ? GOOD_S : TINT, color: doneN ? GOOD : PRIMARY }}>출석 {doneN}/{list.length}</span>
          : <span className="rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: stOf(list[0]?.status).bg, color: stOf(list[0]?.status).color }}>{stOf(list[0]?.status).label}</span>}
      </div>
      {s.memo && <p className="mt-1.5 text-xs" style={{ color: INK2 }}>{s.memo}</p>}
      {eq ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-white p-2.5">
          <span className="text-sm font-extrabold" style={{ color: INK }}>{s.equip || "기구 미선택"} 그룹 수업</span>
          {s.groupDone ? (
            <>
              <span className="rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: GOOD_S, color: GOOD }}>진행 완료 · 이달 누적 +1</span>
              <button onClick={() => onGroupDone && onGroupDone(s.id, false)} className="ml-auto text-xs font-bold" style={{ color: SUB }}>완료 취소</button>
            </>
          ) : (
            <button onClick={() => onGroupDone && onGroupDone(s.id, true)} className="ml-auto rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: GOOD }}>진행 완료</button>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {list.map((a) => <SchedAttendeeRow key={a.memberId} s={s} a={a} members={members} onStatus={onStatus} onNoshowFee={onNoshowFee} />)}
        </div>
      )}
      <div className="mt-2 flex gap-1.5">
        <button onClick={() => setEditing(s)} className="ml-auto rounded-full bg-white px-2.5 py-1.5" style={{ color: SUB }}><Pencil size={12} /></button>
        <button onClick={() => setDel(s.id)} className="rounded-full bg-white px-2.5 py-1.5" style={{ color: FAINT }}><Trash2 size={12} /></button>
      </div>
      {del === s.id && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl p-2.5" style={{ backgroundColor: BAD_S }}>
          <AlertTriangle size={13} style={{ color: BAD }} />
          <span className="text-xs font-bold" style={{ color: INK }}>{s.start} 수업을 삭제할까요?</span>
          <button onClick={() => { onDelete(s.id); setDel(null); }} className="rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>삭제</button>
          <button onClick={() => setDel(null)} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold" style={{ color: SUB }}>취소</button>
        </div>
      )}
    </div>
  );
}

function ScheduleManager({ db, photos, onSave, onDelete, onStatus, onStatusAll, onNoshowFee, onGroupDone, onNoComment, onSaveNote, onToast, onSettings, memberPresetId, onConsumeMemberPreset }) {
  const initialDisplay = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(SCHEDULE_VIEW_KEY) || "null") || {}; }
    catch (e) { return {}; }
  }, []);
  const [foldEmpty, setFoldEmpty] = useState(initialDisplay.foldEmpty !== false);
  const [showSunday, setShowSunday] = useState(initialDisplay.showSunday === true);
  const [displaySettings, setDisplaySettings] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const scheduleTriggerRef = useRef(null);
  const queueTriggerRef = useRef(null);
  const [cursor, setCursor] = useState(todayISO());
  const [editing, setEditing] = useState(null);
  const [del, setDel] = useState(null);
  const [drag, setDrag] = useState(0);
  const [anim, setAnim] = useState(true);
  const x0 = useRef(null);
  useEffect(() => {
    if (!memberPresetId) return;
    const target = db.members.find((m) => m.id === memberPresetId);
    if (!target) { onConsumeMemberPreset?.(); return; }
    setCursor(todayISO());
    setEditing({ id: null, memberIds: [target.id], date: todayISO(), start: "10:00", dur: 50, type: "개인레슨", instructor: db.settings.staff, room: "", memo: "" });
    onConsumeMemberPreset?.();
  }, [memberPresetId]);
  useEffect(() => {
    try { localStorage.setItem(SCHEDULE_VIEW_KEY, JSON.stringify({ foldEmpty, showSunday })); } catch (e) {}
  }, [foldEmpty, showSunday]);

  const nameOf = (id) => db.members.find((m) => m.id === id)?.name || "삭제된 회원";
  const memberOf = (id) => db.members.find((m) => m.id === id);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => shift(monStart(cursor), i)), [cursor]);
  const byDate = (d) => db.schedule.filter((s) => s.date === d).sort((a, b) => a.start.localeCompare(b.start));
  const seatsOn = (d) => byDate(d).reduce((n, s) => n + attendeesOf(s).length, 0);
  const ym = monthKey(cursor);
  const stat = useMemo(() => monthStats(db.schedule, ym), [db.schedule, ym]);
  /* 이번 달 예상 급여 — 완료된 수업의 회원별 수업료를 더한다 */
  const monthPay = useMemo(() => {
    const cm = monthKey(todayISO());
    let sum = 0;
    db.schedule.forEach((s) => {
      if (!s?.date || !s.date.startsWith(cm) || isPersonalEvt(s)) return;
      if (isEquipGroup(s)) { if (s.groupDone) sum += rateBase(db.settings).group; return; }
      attendeesOf(s).forEach((a) => {
        if (!a.deductFrom) return;
        sum += rateFor(db.members.find((x) => x.id === a.memberId), s.type, db.settings);
      });
    });
    return sum;
  }, [db.schedule, db.members, db.settings]);
  const monthDone = useMemo(() => {
    const cm = monthKey(todayISO());
    return db.schedule.filter((s) => s?.date && s.date.startsWith(cm) && (isEquipGroup(s) ? !!s.groupDone : attendeesOf(s).some((a) => a.deductFrom))).length;
  }, [db.schedule]);

  const sundayHasLessons = db.schedule.some((s) => s?.date === week[6]);
  const visibleDays = showSunday || sundayHasLessons ? week : week.slice(0, 6);
  const liveEditing = editing?.id ? (db.schedule.find((s) => s.id === editing.id) || editing) : editing;
  const step = (dir) => setCursor(shift(cursor, 7 * dir));
  const onStart = (e) => { x0.current = e.touches[0].clientX; setAnim(false); };
  const onMove = (e) => {
    if (x0.current === null) return;
    const dx = e.touches[0].clientX - x0.current;
    setDrag(Math.max(-150, Math.min(150, dx)));
  };
  const onEnd = () => {
    if (x0.current === null) return;
    const dx = drag; x0.current = null;
    if (Math.abs(dx) < 55) { setAnim(true); setDrag(0); return; }
    const dir = dx < 0 ? 1 : -1;
    setAnim(true); setDrag(dir * -190);
    setTimeout(() => {
      step(dir);
      setAnim(false); setDrag(dir * 190);
      requestAnimationFrame(() => requestAnimationFrame(() => { setAnim(true); setDrag(0); }));
    }, 160);
  };
  const slide = { transform: `translateX(${drag}px)`, transition: anim ? "transform .18s cubic-bezier(.25,.8,.3,1), opacity .18s ease" : "none", opacity: 1 - Math.min(0.45, Math.abs(drag) / 340) };

  const itemProps = { members: db.members, del, setDel, setEditing, onStatus, onNoshowFee, onGroupDone, onDelete };

  const T0 = todayISO();
  const [parked, setParked] = useState({});
  const todayRows = useMemo(() => {
    const out = [];
    db.schedule.filter((s) => s.date === T0).sort((a, b) => a.start.localeCompare(b.start)).forEach((s) => {
      if (isPersonalEvt(s)) { out.push({ key: s.id, kind: "personal", sid: s.id, start: s.start, end: s.end, title: s.title, memo: s.memo, s }); return; }
      if (isEquipGroup(s)) { out.push({ key: s.id, kind: "equip", sid: s.id, start: s.start, end: s.end, type: s.type, equip: s.equip, done: !!s.groupDone, s }); return; }
      const list = attendeesOf(s);
      /* 듀엣처럼 두 명 이상이면 한 카드로 묶어 한 회원처럼 다룬다 */
      if (list.length > 1) { out.push({ key: s.id, kind: "multi", sid: s.id, start: s.start, end: s.end, type: s.type, list, s }); return; }
      list.forEach((a) => out.push({ key: `${s.id}:${a.memberId}`, kind: "member", id: a.memberId, sid: s.id, start: s.start, end: s.end, type: s.type, status: a.status, fee: a.noshowFee, deductFrom: a.deductFrom, s }));
    });
    return out;
  }, [db.schedule]);

  const [peek, setPeek] = useState(1);
  const T1 = shift(T0, peek);
  const tomorrowRows = useMemo(() => {
    const out = [];
    db.schedule.filter((s) => s.date === T1).sort((a, b) => a.start.localeCompare(b.start)).forEach((s) => {
      if (isPersonalEvt(s)) { out.push({ key: s.id, kind: "personal", start: s.start, title: s.title }); return; }
      if (isEquipGroup(s)) { out.push({ key: s.id, kind: "equip", start: s.start, equip: s.equip }); return; }
      attendeesOf(s).forEach((a) => out.push({ key: `${s.id}:${a.memberId}`, kind: "member", id: a.memberId, start: s.start, type: s.type }));
    });
    return out;
  }, [db.schedule, T1]);

  const [solo, setSolo] = useState({});
  /* 수업을 처리하면 목록 순서가 바뀐다 — 올라오는 카드에 튕기는 느낌을 준다 */
  const [bump, setBump] = useState(0);
  const bumped = () => setBump((v) => v + 1);
  const doStatus = (...a) => { bumped(); onStatus(...a); };
  const doStatusAll = (...a) => { bumped(); onStatusAll && onStatusAll(...a); };
  const doGroupDone = (...a) => { bumped(); onGroupDone(...a); };
  const isSettled = (r) => {
    if (r.kind === "personal") return true;
    if (r.kind === "equip") return r.done || !!r.s?.groupCancelled;
    if (r.kind === "multi") return r.list.every((a) => a.status !== "booked" && (a.status !== "noshow" || a.noshowFee != null));
    if (r.status === "cancel") return true;
    if (r.status === "noshow") return r.fee != null;
    if (r.status === "done") return (memberOf(r.id)?.notes || []).some((x) => x?.sid === r.sid);
    return false;
  };
  const canPark = (r) => isSettled(r) || !!parked[r.key];
  const sortedRows = useMemo(() => {
    const down = todayRows.filter((r) => parked[r.key]);
    const up = todayRows.filter((r) => !parked[r.key]);
    return [...up, ...down];
  }, [todayRows, parked]);
  const parkedCount = todayRows.filter((r) => parked[r.key]).length;
  const todayCls = db.schedule.filter((s) => s.date === T0 && !isPersonalEvt(s)).length;
  const todayStat = useMemo(() => {
    const st = { done: 0, booked: 0, noshow: 0, cancel: 0 };
    db.schedule.filter((s) => s?.date === T0 && !isPersonalEvt(s)).forEach((s) => {
      if (isEquipGroup(s)) { st[s.groupCancelled ? "cancel" : s.groupDone ? "done" : "booked"] += 1; return; }
      attendeesOf(s).forEach((a) => {
        if (a.status === "done") st.done += 1;
        else if (a.status === "noshow") st.noshow += 1;
        else if (a.status === "cancel") st.cancel += 1;
        else st.booked += 1;
      });
    });
    return st;
  }, [db.schedule, T0]);
  /* 지난달 같은 날까지 완료 수업 — 비교용 */
  const lastMonthSame = useMemo(() => {
    const d = new Date(T0 + "T00:00:00");
    const day = d.getDate();
    const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const pm = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
    let n = 0;
    db.schedule.forEach((s) => {
      if (!s?.date || !s.date.startsWith(pm) || isPersonalEvt(s)) return;
      if (Number(s.date.slice(8, 10)) > day) return;
      if (isEquipGroup(s)) { if (s.groupDone) n += 1; return; }
      n += attendeesOf(s).filter((a) => a.deductFrom).length;
    });
    return n;
  }, [db.schedule, T0]);
  const doneRows = db.schedule
    .filter((s) => s?.date === T0 && !isPersonalEvt(s) && !isEquipGroup(s))
    .flatMap((s) => attendeesOf(s).filter((a) => a.status === "done").map((a) => ({ id: a.memberId, sid: s.id })));
  const unwrittenRows = doneRows.filter((r) => !(memberOf(r.id)?.notes || []).some((x) => x?.sid === r.sid));
  const unwritten = unwrittenRows.length;
  const firstUnwritten = unwrittenRows[0] || null;
  const nextTarget0 = nextTarget(db.schedule, db.members);
  const taskQueue = useMemo(() => {
    const endDate = todayISO();
    const startDate = shift(endDate, -27);
    const out = [];
    db.schedule
      .filter((s) => s?.date >= startDate && s.date <= endDate && !isPersonalEvt(s))
      .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
      .forEach((s) => {
        const end = s.end || addMin(s.start || "00:00", Number(s.dur) || 50);
        if (new Date(`${s.date}T${end}:00`).getTime() > Date.now()) return;
        if (isEquipGroup(s)) {
          if (!s.groupCancelled && (s.actualCount === undefined || s.actualCount === null || s.actualCount === "")) {
            out.push({ key: `group:${s.id}`, kind: "group", s });
          }
          return;
        }
        attendeesOf(s).forEach((a) => {
          const m = memberOf(a.memberId);
          if (a.status === "done" && !(m?.notes || []).some((n) => n?.sid === s.id)) {
            out.push({ key: `note:${s.id}:${a.memberId}`, kind: "note", s, a, m });
          }
          if (a.status === "noshow" && a.noshowFee == null) {
            out.push({ key: `noshow:${s.id}:${a.memberId}`, kind: "noshow", s, a, m });
          }
        });
      });
    return out;
  }, [db.schedule, db.members]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ─── 상단 헤더: 주 범위 + 이동 + 오늘 + 등록 ─── */}
      <div className="shrink-0 flex items-center gap-1 px-2" style={{ height: 44, backgroundColor: CARD, borderBottom: `1px solid ${LINE}` }}>
        <button onClick={() => step(-1)} className="flex items-center justify-center" style={{ width: 36, height: 36, color: SUB }}>
          <ChevronLeft size={18} />
        </button>
        <p className="min-w-0 flex-1 text-center text-sm font-semibold tabular-nums" style={{ color: INK }}>
          {md(visibleDays[0])}~{md(visibleDays[visibleDays.length - 1])}
        </p>
        <button onClick={() => step(1)} className="flex items-center justify-center" style={{ width: 36, height: 36, color: SUB }}>
          <ChevronRight size={18} />
        </button>
        <button onClick={() => setCursor(todayISO())} className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold"
          style={{ color: cursor === T0 ? SUB : PRIMARY, opacity: cursor === T0 ? 0.5 : 1 }}>오늘</button>
        <button type="button" aria-label="일정 목록" onClick={() => setListOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center" style={{ color: SUB }}>
          <ClipboardList size={18} />
        </button>
        <button onClick={() => setDisplaySettings(true)} aria-label="일정 표시 설정"
          className="flex h-10 w-10 shrink-0 items-center justify-center" style={{ color: SUB }}>
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {/* ─── 메인 시간표 영역 (flex-1, 내부 스크롤) ─── */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ backgroundColor: CARD }}>
        <WeekGrid days={visibleDays} byDate={byDate} nameOf={nameOf} memberOf={(id) => db.members.find((m) => m.id === id)} cursor={cursor} foldEmpty={foldEmpty}
          onOpen={(s, trigger) => { scheduleTriggerRef.current = trigger; setEditing(s); }}
          onNew={(date, start, dur, trigger) => { scheduleTriggerRef.current = trigger; setEditing({ id: null, memberIds: [], date, start, dur: dur || 50, type: "개인레슨", instructor: db.settings.staff, room: "", memo: "" }); }} />
      </div>

      {/* ─── 하단 고정 업무 요약 ─── */}
      <div className="shrink-0" style={{ padding: "6px 12px 8px", backgroundColor: PAGE }}>
        <button onClick={(e) => { if (taskQueue.length) { queueTriggerRef.current = e.currentTarget; setQueueOpen(true); } }} disabled={!taskQueue.length}
          className="flex h-14 w-full items-center gap-3 rounded-xl px-3 text-left disabled:opacity-80"
          style={{ backgroundColor: taskQueue.length ? "#F5F4FB" : CARD, border: `1px solid ${taskQueue.length ? "#D5D1EB" : LINE}`, boxShadow: "0 1px 4px rgba(28,36,51,.06)" }}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: taskQueue.length ? TINT : GOOD_S }}>
            {taskQueue.length ? <Pencil size={14} style={{ color: PRIMARY }} /> : <Check size={14} style={{ color: GOOD }} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold" style={{ color: INK }}>{taskQueue.length ? `처리할 업무 ${taskQueue.length}건` : "남은 수업 없음"}</span>
            <span className="block text-xs" style={{ color: SUB }}>{taskQueue.length ? "기록 · 인원체크 · 차감 결정" : "처리할 업무가 없습니다"}</span>
          </span>
          {taskQueue.length > 0 && <span className="shrink-0 text-xs font-extrabold" style={{ color: PRIMARY }}>지금 처리</span>}
        </button>
      </div>

      {editing && <ScheduleForm draft={liveEditing} members={db.members} schedule={db.schedule} photos={photos} returnFocusRef={scheduleTriggerRef} onClose={() => setEditing(null)}
        onSubmit={(v) => { onSave(v); setEditing(null); }} onDelete={(id) => { onDelete(id); setEditing(null); }}
        onStatus={onStatus} onStatusAll={onStatusAll} onNoshowFee={onNoshowFee} onGroupDone={onGroupDone}
        onNoComment={onNoComment} onSaveNote={onSaveNote} />}
      {queueOpen && (
        <ScheduleQueueSheet tasks={taskQueue} members={db.members} returnFocusRef={queueTriggerRef} onClose={() => setQueueOpen(false)}
          onNoComment={onNoComment} onSaveNote={onSaveNote}
          onNoshowFee={onNoshowFee} onSaveSchedule={onSave} />
      )}
      {displaySettings && (
        <Sheet title="일정 표시 설정" onClose={() => setDisplaySettings(false)}>
          <div className="space-y-2">
            {[
              { label: "빈 시간 접기", value: foldEmpty, set: setFoldEmpty },
              { label: "일요일 표시", value: showSunday, set: setShowSunday },
            ].map((item) => (
              <button key={item.label} onClick={() => item.set(!item.value)}
                className="flex h-12 w-full items-center rounded-xl px-3 text-left" style={{ border: `1px solid ${LINE}`, backgroundColor: CARD }}>
                <span className="text-sm font-bold" style={{ color: INK }}>{item.label}</span>
                <span className="ml-auto flex h-6 w-10 items-center rounded-full p-0.5" style={{ backgroundColor: item.value ? BRAND : LINE }}>
                  <span className="h-5 w-5 rounded-full bg-white transition-transform" style={{ transform: item.value ? "translateX(16px)" : "none" }} />
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {listOpen && (
        <Sheet title="이번 주 일정" sub={`${md(visibleDays[0])}~${md(visibleDays[visibleDays.length - 1])}`} onClose={() => setListOpen(false)} wide>
          <div className="space-y-3">
            {visibleDays.map((date) => {
              const rows = byDate(date);
              return (
                <section key={date}>
                  <p className="mb-1.5 text-xs font-semibold tabular-nums" style={{ color: date === todayISO() ? PRIMARY : SUB }}>{dow(date)} {md(date)}</p>
                  {rows.length ? rows.map((s) => (
                    <button key={s.id} type="button" onClick={(e) => { scheduleTriggerRef.current = e.currentTarget; setListOpen(false); setEditing(s); }}
                      className="mb-1 flex h-11 w-full items-center gap-2 rounded-lg px-3 text-left"
                      style={{ backgroundColor: CANVAS, border: `1px solid ${LINE}` }}>
                      <span className="shrink-0 text-xs font-semibold tabular-nums" style={{ color: PRIMARY }}>{s.start}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: INK }}>
                        {isPersonalEvt(s) ? s.title : isEquipGroup(s) ? `${s.equip || "그룹"} · ${num(s.groupCount) || 0}명` : attendeesOf(s).map((a) => nameOf(a.memberId)).join(" · ")}
                      </span>
                      <ChevronRight size={14} style={{ color: SUB }} />
                    </button>
                  )) : <p className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: CANVAS, color: SUB }}>일정 없음</p>}
                </section>
              );
            })}
          </div>
        </Sheet>
      )}
    </div>
  );
}
const SWIPE_GO = 58, SWIPE_MAX = 88;
function SwipeRow({ children, down, enabled, onPark, onUnpark }) {
  const box = useRef(null), tag = useRef(null), g = useRef(null);
  const paint = (dx, spring) => {
    const n = box.current; if (!n) return;
    n.style.transition = spring ? "transform .38s cubic-bezier(.22,1,.36,1)" : "";
    n.style.transform = dx ? `translate3d(${dx}px,0,0)` : "translate3d(0,0,0)";
    if (tag.current) {
      const t = Math.min(1, Math.abs(dx) / SWIPE_GO);
      tag.current.style.opacity = String(t);
      tag.current.style.transform = `scale(${0.9 + t * 0.1})`;
    }
  };
  const start = (e) => {
    if (!enabled || e.pointerType === "mouse" && e.button !== 0) return;
    g.current = { x: e.clientX, y: e.clientY, axis: null, dx: 0 };
    const n = box.current; if (n) n.style.transition = "";
  };
  const move = (e) => {
    const s = g.current; if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (s.axis === "x") e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (s.axis !== "x") return;
    const dir = down ? 1 : -1;
    const v = dx * dir;
    s.dx = v <= 0 ? 0 : (v > SWIPE_MAX ? SWIPE_MAX + (v - SWIPE_MAX) * 0.22 : v) * dir;
    paint(s.dx, false);
  };
  const end = () => {
    const s = g.current; if (!s) return;
    g.current = null;
    const hit = Math.abs(s.dx) >= SWIPE_GO;
    paint(0, true);
    if (hit) (down ? onUnpark : onPark)();
  };
  return (
    <div className="relative select-none" style={{ opacity: down ? 0.6 : 1, transition: "opacity .2s ease" }}>
      {enabled && (
        <div ref={tag} className="pointer-events-none absolute inset-0 flex items-center rounded-2xl px-4"
          style={{ backgroundColor: down ? GOOD_S : TINT, justifyContent: down ? "flex-start" : "flex-end", opacity: 0 }}>
          <span className="text-xs font-extrabold" style={{ color: down ? GOOD : PRIMARY }}>{down ? "되돌리기" : "정리하기"}</span>
        </div>
      )}
      <div ref={box} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        style={{ touchAction: "pan-y", willChange: "transform" }}>
        {children}
      </div>
    </div>
  );
}

const AXIS = 28, GRID_PAD_X = 12, GRID_H0 = 8, GRID_H1 = 23, GRID_ROW = 64, GRID_FOLD = 20;
const hourLabel = (h) => `${String(h).padStart(2, "0")}시`;

function WeekGrid({ days, byDate, nameOf, memberOf, cursor, onOpen, onNew, foldEmpty = true }) {
  const rows = GRID_H1 - GRID_H0 + 1;
  const top0 = GRID_H0 * 60;
  /* 빈 칸을 위아래로 훑으면 그 시간만큼 일정이 잡힌다 (30분 단위) */
  /* 지금 시각 표시선 — 1분마다 갱신 */
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  useEffect(() => {
    const t = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()); }, 60000);
    return () => clearInterval(t);
  }, []);
  const showNow = nowMin >= top0 && nowMin <= GRID_H1 * 60 + 59;
  const activeHours = useMemo(() => {
    const out = new Set();
    days.forEach((d) => byDate(d).forEach((s) => {
      const start = Math.max(GRID_H0, Math.floor(minOf(s.start) / 60));
      const end = Math.min(GRID_H1, Math.floor(Math.max(minOf(s.start), minOf(s.end) - 1) / 60));
      for (let h = start; h <= end; h += 1) out.add(h);
    }));
    if (days.includes(todayISO())) out.add(Math.floor(nowMin / 60));
    return out;
  }, [days, byDate, nowMin]);
  const heightOf = (hour) => (!foldEmpty || activeHours.has(hour) ? GRID_ROW : GRID_FOLD);
  const topOf = (minutes) => {
    const clamped = Math.max(top0, Math.min((GRID_H1 + 1) * 60, minutes));
    const hour = Math.floor(clamped / 60);
    let y = 0;
    for (let h = GRID_H0; h < Math.min(hour, GRID_H1 + 1); h += 1) y += heightOf(h);
    if (hour <= GRID_H1) y += ((clamped % 60) / 60) * heightOf(hour);
    return y;
  };
  const totalHeight = Array.from({ length: rows }, (_, i) => heightOf(GRID_H0 + i)).reduce((a, b) => a + b, 0);
  const nowTop = topOf(nowMin);
  const nowKey = `${todayISO()} ${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`;
  const nextId = days.flatMap((d) => byDate(d)).filter((s) => !isPersonalEvt(s) && `${s.date} ${s.start}` >= nowKey)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))[0]?.id || null;
  const slotAt = (e, el) => {
    const r = el.getBoundingClientRect();
    const y = Math.max(0, Math.min(r.height - 1, e.clientY - r.top));
    let acc = 0;
    for (let h = GRID_H0; h <= GRID_H1; h += 1) {
      const hh = heightOf(h);
      if (y < acc + hh) return { hour: h, half: y - acc >= hh / 2 ? 1 : 0 };
      acc += hh;
    }
    return { hour: GRID_H1, half: 1 };
  };
  /* 빈 칸을 누르면 그 시간대(30분)로 등록 창이 열린다 */
  const tapNew = (d, e) => {
    e.currentTarget.focus();
    const k = slotAt(e, e.currentTarget);
    const startMin = k.hour * 60 + k.half * 30;
    const start = `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`;
    onNew(d, start, 30, e.currentTarget);
  };
  const blocksOf = (d) => byDate(d).filter((s) => {
    const a = minOf(s.start), b = minOf(s.end) || a + 50;
    return b > top0 && a < (GRID_H1 + 1) * 60;
  }).map((s) => {
    const st = Math.max(minOf(s.start), top0);
    const en = Math.min(minOf(s.end) || st + 50, (GRID_H1 + 1) * 60);
    const pv = isPersonalEvt(s);
    const eq = isEquipGroup(s);
    const list = attendeesOf(s);
    const label = pv ? (s.title || "내 일정") : eq
      ? ((s.groupDone || num(s.actualCount) > 0) && num(s.groupCount) > 0 ? `참석 ${num(s.actualCount) || 0}/${num(s.groupCount)}` : `${s.equip || "그룹"}${num(s.groupCount) ? ` ${num(s.groupCount)}명` : ""}`)
      : list.length > 1 ? `${nameOf(list[0]?.memberId)}+${list.length - 1}` : nameOf(list[0]?.memberId);
    const groupPeople = num(s.groupCount);
    const done = pv ? false : eq ? !!s.groupDone : list.length > 0 && list.every((a) => a.status !== "booked");
    const status = list[0]?.status || "booked";
    const needsRecord = !pv && !eq && list.some((a) => a.status === "done" && !(memberOf?.(a.memberId)?.notes || []).some((n) => n?.sid === s.id));
    return { s, top: topOf(st), h: Math.max(20, topOf(en) - topOf(st) - 2), label, done, cancelled: (eq && !!s.groupCancelled) || status === "cancel", noshow: status === "noshow", eq, pv, next: s.id === nextId, needsRecord, groupPeople };
  }).filter((b) => b.top >= -GRID_ROW && b.top < totalHeight);

  return (
    <div className="h-full" style={{ padding: `0 ${GRID_PAD_X}px`, backgroundColor: CARD }}>
      <div style={{ borderBottom: `1px solid ${LINE}` }}>
        <div style={{ width: "100%" }}>
          <div className="sticky top-0 z-10 grid" style={{ gridTemplateColumns: `${AXIS}px repeat(${days.length}, minmax(0, 1fr))`, backgroundColor: CARD, borderBottom: `1px solid ${LINE}` }}>
            <div />
            {days.map((d) => {
              const today = d === todayISO(), on = d === cursor;
              return (
                <div key={d} className="min-w-0 py-1.5 text-center" style={{ borderLeft: `1px solid ${LINE}`, backgroundColor: today ? TINT : "transparent" }}>
                  <p className="font-extrabold" style={{ fontSize: 11, color: today ? PRIMARY : redInk(d, SUB) }}>{dow(d)}</p>
                  <p className="font-extrabold tabular-nums" style={{ fontSize: 13, color: today ? PRIMARY : redInk(d, on ? INK : SUB) }}>{Number(d.slice(8, 10))}</p>
                </div>
              );
            })}
          </div>
          <div className="relative grid" style={{ gridTemplateColumns: `${AXIS}px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div style={{ height: totalHeight }}>
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex items-start justify-end pr-1 pt-0.5" style={{ height: heightOf(GRID_H0 + i), borderTop: i ? `1px solid ${LINE}` : "none" }}>
                  <span className="font-bold tabular-nums" style={{ color: FAINT, fontSize: 9 }}>{hourLabel(GRID_H0 + i)}</span>
                </div>
              ))}
            </div>
            {days.map((d) => (
              <div key={d} tabIndex={-1} className="relative min-w-0 overflow-hidden"
                style={{ height: totalHeight, borderLeft: `1px solid ${LINE}`, backgroundColor: d === todayISO() ? TINT : "transparent" }}
                onClick={(e) => tapNew(d, e)}>
                {Array.from({ length: rows }, (_, i) => (
                  <div key={i} style={{ height: heightOf(GRID_H0 + i), borderTop: i ? `1px solid ${LINE}` : "none" }}>
                    <div style={{ height: heightOf(GRID_H0 + i) / 2, borderBottom: `1px dashed ${LINE}` }} />
                  </div>
                ))}
                {d === todayISO() && showNow && (
                  <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: nowTop }}>
                    <div style={{ height: 2, backgroundColor: "#FF3B30", boxShadow: "0 0 5px rgba(255,59,48,.35)" }} />
                    <div style={{ position: "absolute", left: -4, top: -3, width: 8, height: 8, borderRadius: 8, backgroundColor: "#FF3B30" }} />
                  </div>
                )}
                {blocksOf(d).map((b) => (
                  <button key={b.s.id} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onOpen(b.s, e.currentTarget); }}
                    className="absolute left-0.5 right-0.5 flex min-w-0 items-center gap-0.5 overflow-hidden px-1 text-left"
                    style={{ top: b.top + 1, height: Math.max(18, b.h - 1), borderRadius: 4,
                      background: b.pv ? CARD : b.cancelled ? "transparent" : b.noshow ? BAD_S : b.done ? CANVAS : b.next ? TINT : "#E9EDF3",
                      border: b.next ? `1.5px solid ${BRAND}` : b.cancelled ? "1px dashed #D5DAE3" : b.pv ? `1px solid #D5DAE3` : "1px solid transparent",
                      borderLeft: b.pv ? `3px solid ${BRAND}` : undefined,
                      color: b.noshow ? BAD : b.next ? BRAND : b.done || b.cancelled ? INK2 : d === todayISO() ? INK : INK2,
                      fontSize: 11, fontWeight: b.next ? 600 : 500 }}>
                    {b.next && <Play size={8} fill={BRAND} className="shrink-0" />}
                    {!b.pv && !b.eq && <span className="shrink-0" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: idColor(attendeesOf(b.s)[0]?.memberId), opacity: b.done ? .45 : 1 }} />}
                    <span className="truncate" style={{ textDecoration: b.cancelled ? "line-through" : "none" }}>{b.label}</span>
                    {b.needsRecord && <span className="absolute" style={{ top: 2, right: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND }} />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleForm({ draft, members, schedule, photos, returnFocusRef, onClose, onSubmit, onDelete, onStatus, onStatusAll, onNoshowFee, onGroupDone, onNoComment, onSaveNote }) {
  const currentIds = draft.memberIds || attendeesOf(draft).map((a) => a.memberId).filter(Boolean);
  const initialKind = draft.personal
    ? (draft.title === "상담" ? "consult" : "off")
    : draft.type === "그룹" ? "group" : draft.type === "듀엣" || currentIds.length > 1 ? "duet" : "solo";
  const duration = draft.dur || (draft.start && draft.end ? Math.max(10, minOf(draft.end) - minOf(draft.start)) : 50);
  const [kind, setKind] = useState(initialKind);
  const [f, setF] = useState({ ...draft, start: draft.start || "10:00", dur: duration, groupCount: draft.groupCount ?? "" });
  const [memberIds, setMemberIds] = useState(currentIds);
  const [memberNames, setMemberNames] = useState(currentIds.map((id) => members.find((m) => m.id === id)?.name || ""));
  const [del, setDel] = useState(false);
  const [editingInfo, setEditingInfo] = useState(!draft.id);
  const [activeMemberId, setActiveMemberId] = useState(currentIds[0] || "");
  const [recordMode, setRecordMode] = useState(null);
  const [recordBody, setRecordBody] = useState("");
  const isGroup = kind === "group";
  const isDuet = kind === "duet";
  const isMemberLesson = kind === "solo" || isDuet;
  const activeMember = members.find((m) => m.id === activeMemberId) || null;
  const activeAttendee = attendeesOf(draft).find((a) => a.memberId === activeMemberId) || null;
  const advice = useMemo(() => seqAdvice(activeMember, schedule, photos), [activeMember, schedule, photos]);
  const latestNote = (activeMember?.notes || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0] || null;
  const hour = Number((f.start || "10:00").slice(0, 2));
  const minute = Number((f.start || "10:00").slice(3, 5));
  const durationOptions = [...new Set([30, 50, 60, 80, Number(f.dur)].filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  const setTime = (h, m) => setF((x) => ({ ...x, start: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` }));
  const updateMemberName = (slot, value) => {
    const names = [...memberNames]; names[slot] = value; setMemberNames(names);
    const matches = members.filter((m) => isActive(m) && (m.name || "").trim() === value.trim());
    const ids = [...memberIds]; ids[slot] = matches.length === 1 ? matches[0].id : ""; setMemberIds(ids);
  };
  const neededSlots = isDuet ? 2 : isMemberLesson ? 1 : 0;
  const chosenIds = memberIds.slice(0, neededSlots).filter(Boolean);
  const unresolved = isMemberLesson && memberNames.slice(0, neededSlots).some((name, i) => {
    if (!name?.trim()) return true;
    return !memberIds[i];
  });
  const duplicateChoice = isDuet && chosenIds.length === 2 && chosenIds[0] === chosenIds[1];
  const ambiguousName = memberNames.slice(0, neededSlots).find((name, i) => name?.trim() && !memberIds[i] && members.filter((m) => isActive(m) && (m.name || "").trim() === name.trim()).length > 1);
  const prevIds = new Set(attendeesOf(draft).map((a) => a.memberId));
  const noRest = chosenIds.filter((id) => !prevIds.has(id)).map((id) => members.find((m) => m.id === id)).filter((m) => m && left(m) <= 0);
  const myStart = minOf(f.start), myEnd = myStart + (Number(f.dur) || 50);
  const clashes = (schedule || []).filter((s) => s?.date === f.date && s.id !== draft.id).filter((s) => {
    const a = minOf(s.start), b = minOf(s.end) || a + 50;
    return myStart < b && a < myEnd;
  });
  const ready = !!f.date && !!f.start && (!isMemberLesson || (chosenIds.length === neededSlots && !unresolved && !duplicateChoice))
    && (!isGroup || num(f.groupCount) > 0) && noRest.length === 0;
  const submit = () => {
    const previous = attendeesOf(draft);
    const personal = kind === "consult" || kind === "off";
    onSubmit({
      id: draft.id || uid(), date: f.date, start: f.start, end: addMin(f.start, Number(f.dur) || 50),
      type: personal ? "개인일정" : isGroup ? "그룹" : isDuet ? "듀엣" : "개인레슨",
      instructor: personal ? "" : (f.instructor || ""), room: personal ? "" : (f.room || ""), memo: f.memo || "",
      equip: isGroup ? (f.equip || "그룹") : null,
      groupCount: isGroup ? num(f.groupCount) : undefined,
      actualCount: isGroup ? draft.actualCount : undefined,
      noshowCount: isGroup ? draft.noshowCount : undefined,
      groupDone: isGroup ? !!draft.groupDone : undefined,
      groupCancelled: isGroup ? !!draft.groupCancelled : undefined,
      attendees: isMemberLesson ? chosenIds.map((id) => previous.find((a) => a.memberId === id) || { memberId: id, status: "booked", deductFrom: null, noshowFee: null }) : [],
      personal: personal || undefined,
      title: personal ? (kind === "consult" ? "상담" : (draft.personal && draft.title && draft.title !== "상담" ? draft.title : "휴무")) : undefined,
    });
  };
  const memberListId = `schedule-member-list-${draft.id || "new"}`;
  return (
    <ScheduleBottomSheet title={draft.id ? (isMemberLesson ? "수업 관리" : "일정 수정") : "일정 등록"} subtitle={`${dow(f.date)} ${f.date?.slice(5).replace("-", ".") || ""}${draft.id ? ` · ${draft.start}~${draft.end || addMin(draft.start, Number(draft.dur) || 50)}` : ""}`} returnFocusRef={returnFocusRef} onClose={onClose}>
      <div className="space-y-4">
        {draft.id && !editingInfo && (
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: CANVAS, border: `1px solid ${LINE}` }}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold" style={{ color: INK }}>{draft.personal ? draft.title : isGroup ? `그룹 · 정원 ${num(draft.groupCount)}명` : `${draft.type} · ${attendeesOf(draft).length}명`}</p>
              <p className="mt-0.5 text-xs tabular-nums" style={{ color: SUB }}>{draft.start}~{draft.end || addMin(draft.start, Number(draft.dur) || 50)}</p>
            </div>
            <button onClick={() => setEditingInfo(true)} className="shrink-0 rounded-lg px-3 py-2 text-xs font-extrabold" style={{ backgroundColor: CARD, color: PRIMARY, border: `1px solid ${LINE}` }}>일정 정보 수정</button>
          </div>
        )}
        {editingInfo && <>
        <div>
          <p className="mb-1.5 text-xs font-bold" style={{ color: SUB }}>시작 시간</p>
          <div className="grid grid-cols-3 gap-2">
            <select aria-label="시" value={hour} onChange={(e) => setTime(Number(e.target.value), minute)} className={inputCls}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}시</option>)}
            </select>
            <select aria-label="분" value={minute} onChange={(e) => setTime(hour, Number(e.target.value))} className={inputCls}>
              {[0, 10, 20, 30, 40, 50].map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}분</option>)}
            </select>
            <select aria-label="수업 길이" value={f.dur} onChange={(e) => setF({ ...f, dur: Number(e.target.value) })} className={inputCls}>
              {durationOptions.map((d) => <option key={d} value={d}>{d}분</option>)}
            </select>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold" style={{ color: SUB }}>유형</p>
          <div className="grid grid-cols-6 gap-2">
            {[
              { k: "solo", l: "개인", span: 2 }, { k: "duet", l: "듀엣", span: 2 }, { k: "group", l: "그룹", span: 2 },
              { k: "consult", l: "상담", span: 3 }, { k: "off", l: "휴무", span: 3 },
            ].map((o) => (
              <button key={o.k} onClick={() => setKind(o.k)} className="h-11 rounded-lg text-sm font-bold"
                style={{ gridColumn: `span ${o.span}`, backgroundColor: kind === o.k ? TINT : CARD, color: kind === o.k ? PRIMARY : SUB, border: `1px solid ${kind === o.k ? "#D9D7EE" : LINE}` }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
        {isMemberLesson && (
          <div>
            <p className="mb-1.5 text-xs font-bold" style={{ color: SUB }}>회원 {isDuet ? "(두 명 모두 입력)" : "(같은 이름은 기존 회원으로 연결)"}</p>
            <div className={`grid gap-2 ${isDuet ? "grid-cols-2" : "grid-cols-1"}`}>
              {Array.from({ length: neededSlots }, (_, slot) => (
                <input key={slot} autoFocus={slot === 0} list={memberListId} value={memberNames[slot] || ""}
                  onChange={(e) => updateMemberName(slot, e.target.value)} placeholder={isDuet ? `회원 ${slot + 1} 이름` : "회원 이름"} className={inputCls} />
              ))}
            </div>
            <datalist id={memberListId}>{[...new Set(members.filter(isActive).map((m) => m.name).filter(Boolean))].map((name) => <option key={name} value={name} />)}</datalist>
          </div>
        )}
        {isGroup && (
          <Field label="정원"><input autoFocus inputMode="numeric" value={f.groupCount} onChange={(e) => setF({ ...f, groupCount: e.target.value.replace(/[^0-9]/g, "") })} placeholder="예) 6" className={inputCls} /></Field>
        )}
        <div className="min-h-[18px] text-xs font-bold" style={{ color: noRest.length || unresolved || duplicateChoice ? BAD : clashes.length ? WARN : SUB }}>
          {noRest.length > 0 ? `${noRest.map((m) => m.name).join(", ")} 회원은 잔여 횟수가 없어 등록할 수 없습니다.`
            : ambiguousName ? `‘${ambiguousName}’ 동명이인이 있습니다. 회원 상세에서 대상을 확인해 주세요.`
              : duplicateChoice ? "듀엣 회원은 서로 달라야 합니다."
                : unresolved && memberNames.some((n) => n?.trim()) ? "등록된 회원 이름과 정확히 일치해야 합니다."
                  : clashes.length ? "같은 시간에 다른 일정이 있습니다. 겹쳐서 등록됩니다."
                    : ""}
        </div>
        <button onClick={submit} disabled={!ready} className="flex h-12 w-full items-center justify-center rounded-lg text-sm font-extrabold text-white disabled:opacity-35" style={{ backgroundColor: PRIMARY }}>
          {draft.id ? "수정 저장" : "등록"}
        </button>
        </>}
        {draft.id && !isGroup && isMemberLesson && attendeesOf(draft).length > 0 && (
          <div className="space-y-3 border-t pt-3" style={{ borderColor: LINE }}>
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              {attendeesOf(draft).map((a) => {
                const m = members.find((x) => x.id === a.memberId);
                const active = a.memberId === activeMemberId;
                return (
                  <button key={a.memberId} onClick={() => { setActiveMemberId(a.memberId); setRecordMode(null); setRecordBody(""); }}
                    className="min-w-[132px] flex-1 rounded-xl p-3 text-left"
                    style={{ backgroundColor: active ? TINT : CANVAS, border: `1px solid ${active ? "#D9D7EE" : LINE}` }}>
                    <p className="truncate text-sm font-extrabold" style={{ color: active ? PRIMARY : INK }}>{m?.name || "삭제된 회원"}</p>
                    <p className="mt-0.5 text-xs" style={{ color: SUB }}>잔여 {left(m)}회{m?.contractEnd ? ` · ${m.contractEnd.slice(5).replace("-", ".")}까지` : ""}</p>
                  </button>
                );
              })}
            </div>

            {activeMember && activeAttendee && (
              <>
                <div className="rounded-xl p-3" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold" style={{ color: INK }}>{activeMember.name}</p>
                      <p className="mt-0.5 text-xs" style={{ color: SUB }}>{activeMember.goal || "목표 미입력"}</p>
                    </div>
                    <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: stOf(activeAttendee.status).bg, color: stOf(activeAttendee.status).color }}>{stOf(activeAttendee.status).label}</span>
                  </div>
                  {(activeMember.focus || []).length > 0 && <p className="mt-2 text-xs leading-relaxed" style={{ color: WARN }}>주의 · {(activeMember.focus || []).join(" · ")}</p>}
                  {latestNote && <p className="mt-2 line-clamp-2 text-xs leading-relaxed" style={{ color: INK2 }}>최근 기록 · {latestNote.body}</p>}
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-extrabold" style={{ color: INK }}>출석 · 차감</p>
                  <div className="grid grid-cols-4 gap-1">
                    {[{ k: "done", l: "출석" }, { k: "noshow", l: "노쇼" }, { k: "cancel", l: "취소" }, { k: "booked", l: "예정" }].map((o) => (
                      <button key={o.k} onClick={() => onStatus?.(draft.id, o.k, activeMemberId)} className="h-9 rounded-lg text-xs font-bold"
                        style={activeAttendee.status === o.k ? { backgroundColor: stOf(o.k).color, color: "#fff" } : { backgroundColor: CANVAS, color: SUB }}>{o.l}</button>
                    ))}
                  </div>
                  {activeAttendee.status === "done" && <p className="mt-1.5 text-xs font-bold" style={{ color: activeAttendee.deductFrom ? GOOD : SUB }}>{activeAttendee.deductFrom ? `${activeAttendee.deductFrom} 1회 차감 완료` : "차감 없이 출석 기록"}</p>}
                  {activeAttendee.status === "noshow" && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button onClick={() => onNoshowFee?.(draft.id, true, activeMemberId)} className="h-9 rounded-lg text-xs font-extrabold" style={activeAttendee.noshowFee === true ? { backgroundColor: BAD, color: "#fff" } : { backgroundColor: BAD_S, color: BAD }}>차감</button>
                      <button onClick={() => onNoshowFee?.(draft.id, false, activeMemberId)} className="h-9 rounded-lg text-xs font-extrabold" style={activeAttendee.noshowFee === false ? { backgroundColor: BRAND, color: "#fff" } : { backgroundColor: CANVAS, color: SUB }}>비차감</button>
                    </div>
                  )}
                </div>

                <div className="rounded-xl p-3" style={{ backgroundColor: "#F5F4FB", border: "1px solid #D9D7EE" }}>
                  <div className="flex items-center gap-1.5"><Sparkles size={14} style={{ color: PRIMARY }} /><p className="text-xs font-extrabold" style={{ color: PRIMARY }}>AI 수업 추천</p></div>
                  {advice?.first ? <p className="mt-1.5 text-xs leading-relaxed" style={{ color: INK }}>첫 수업입니다. 목표와 주의사항을 확인하고 기본 움직임을 평가해 보세요.</p>
                    : <p className="mt-1.5 text-xs leading-relaxed" style={{ color: INK }}>{advice?.kws?.length ? `${advice.kws.join(" · ")} 중심으로 진행해 보세요.` : "최근 기록과 회원 목표를 확인해 수업 강도를 조절해 주세요."}{advice?.why?.length ? ` 근거: ${advice.why.join(" · ")}` : ""}</p>}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => setRecordMode(recordMode === "voice" ? null : "voice")} className="flex h-11 items-center justify-center gap-1 rounded-lg text-xs font-extrabold" style={{ backgroundColor: recordMode === "voice" ? TINT : CARD, color: recordMode === "voice" ? PRIMARY : INK, border: `1px solid ${LINE}` }}><Smartphone size={13} /> AI 음성</button>
                  <button onClick={() => setRecordMode(recordMode === "write" ? null : "write")} className="flex h-11 items-center justify-center gap-1 rounded-lg text-xs font-extrabold" style={{ backgroundColor: recordMode === "write" ? TINT : CARD, color: recordMode === "write" ? PRIMARY : INK, border: `1px solid ${LINE}` }}><Pencil size={13} /> 기록하기</button>
                  <button onClick={() => { onNoComment?.(activeMemberId, draft.type, draft.id); onClose(); }} className="h-11 rounded-lg text-xs font-extrabold" style={{ color: SUB }}>노코멘트</button>
                </div>

                {recordMode && (
                  <div className="space-y-2 rounded-xl p-3" style={{ backgroundColor: CANVAS }}>
                    {recordMode === "voice" && <VoiceNote onApply={(text) => setRecordBody((body) => body.trim() ? `${body.trim()}\n${text}` : text)} />}
                    <textarea rows={4} value={recordBody} onChange={(e) => setRecordBody(e.target.value)} placeholder="수업 내용과 회원 반응을 기록하세요" className={`${inputCls} h-auto resize-none py-3 leading-relaxed`} />
                    <button disabled={!recordBody.trim()} onClick={() => { onSaveNote?.(activeMemberId, draft.type, draft.id, recordBody.trim()); onClose(); }} className="h-11 w-full rounded-lg text-xs font-extrabold text-white disabled:opacity-35" style={{ backgroundColor: PRIMARY }}>기록 저장</button>
                  </div>
                )}
              </>
            )}

            {attendeesOf(draft).length > 1 && (
              <div className="grid grid-cols-3 gap-1">
                {[{ k: "done", l: "전체 출석" }, { k: "noshow", l: "전체 노쇼" }, { k: "cancel", l: "전체 취소" }].map((o) => (
                  <button key={o.k} onClick={() => onStatusAll?.(draft.id, o.k)} className="h-9 rounded-lg text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>{o.l}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {draft.id && isGroup && (
          <div className="grid grid-cols-3 gap-1 border-t pt-3" style={{ borderColor: LINE }}>
            <button onClick={() => { onGroupDone?.(draft.id, true); onClose(); }} className="h-9 rounded-lg text-xs font-bold text-white" style={{ backgroundColor: GOOD }}>완료</button>
            <button onClick={() => { onGroupDone?.(draft.id, false); onClose(); }} className="h-9 rounded-lg text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>예정</button>
            <button onClick={() => { onGroupDone?.(draft.id, "cancelled"); onClose(); }} className="h-9 rounded-lg text-xs font-bold" style={{ backgroundColor: BAD_S, color: BAD }}>취소</button>
          </div>
        )}
        {draft.id && onDelete && (del ? (
          <div className="flex items-center gap-2 rounded-lg p-2.5" style={{ backgroundColor: BAD_S }}>
            <span className="min-w-0 flex-1 text-xs font-bold" style={{ color: BAD }}>이 일정을 삭제할까요?</span>
            <button onClick={() => { onDelete(draft.id); onClose(); }} className="rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ backgroundColor: BAD }}>삭제</button>
            <button onClick={() => setDel(false)} className="rounded-lg px-3 py-2 text-xs font-bold" style={{ color: SUB }}>취소</button>
          </div>
        ) : draft.id ? (
          <button onClick={() => setDel(true)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}><Trash2 size={13} /> 일정 삭제</button>
        ) : null)}
      </div>
    </ScheduleBottomSheet>
  );
}

function ScheduleQueueSheet({ tasks, members, returnFocusRef, onClose, onNoComment, onSaveNote, onNoshowFee, onSaveSchedule }) {
  const task = tasks[0] || null;
  const [groupCount, setGroupCount] = useState(0);
  const [lastGroup, setLastGroup] = useState(null);
  const [recordMode, setRecordMode] = useState(null);
  const [recordBody, setRecordBody] = useState("");
  useEffect(() => {
    if (task?.kind === "group") setGroupCount(num(task.s.actualCount ?? task.s.groupCount ?? 0));
    setRecordMode(null);
    setRecordBody("");
  }, [task?.key]);
  const memberName = task?.m?.name || members.find((m) => m.id === task?.a?.memberId)?.name || "회원";
  const targetName = task?.kind === "group" ? "그룹수업" : memberName;
  return (
    <ScheduleBottomSheet title="처리할 업무" subtitle={`남은 ${tasks.length}건 · 최근 4주`} returnFocusRef={returnFocusRef} onClose={onClose}>
      {!task ? (
        <div className="py-8 text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: GOOD_S }}><Check size={18} style={{ color: GOOD }} /></span>
          <p className="mt-3 text-sm font-extrabold" style={{ color: INK }}>남은 수업 없음</p>
          {lastGroup && <button onClick={() => { onSaveSchedule?.({ ...lastGroup, actualCount: undefined, groupDone: false }); setLastGroup(null); }} className="mt-2 text-xs font-extrabold" style={{ color: GOOD }}>방금 저장한 그룹 인원을 미체크로 되돌리기</button>}
          <button onClick={onClose} className="mt-4 h-10 rounded-lg px-5 text-xs font-extrabold" style={{ backgroundColor: CANVAS, color: SUB }}>닫기</button>
        </div>
      ) : (
        <div className="space-y-3">
          {lastGroup && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: GOOD_S }}>
              <span className="min-w-0 flex-1 text-xs font-bold" style={{ color: GOOD }}>그룹 인원을 저장했습니다.</span>
              <button onClick={() => { onSaveSchedule?.({ ...lastGroup, actualCount: undefined, groupDone: false }); setLastGroup(null); }} className="shrink-0 text-xs font-extrabold" style={{ color: GOOD }}>미체크로 되돌리기</button>
            </div>
          )}
          <div className="rounded-xl px-3 py-3" style={{ backgroundColor: CANVAS, border: `1px solid ${LINE}` }}>
            <p className="text-xs font-bold tabular-nums" style={{ color: PRIMARY }}>{dow(task.s.date)} {task.s.date?.slice(5).replace("-", ".")} · {task.s.start}</p>
            <p className="mt-1 truncate text-base font-extrabold" style={{ color: INK }}>{targetName}</p>
          </div>

          {task.kind === "note" && (
            <div>
              <p className="mb-2 text-xs" style={{ color: SUB }}>저장하면 다음 업무로 자동 이동합니다</p>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setRecordMode(recordMode === "voice" ? null : "voice")} className="flex h-12 items-center justify-center gap-1 rounded-lg text-xs font-extrabold" style={{ backgroundColor: recordMode === "voice" ? TINT : CARD, border: `1px solid ${LINE}`, color: recordMode === "voice" ? PRIMARY : INK }}><Smartphone size={14} /> AI 음성기록</button>
                <button onClick={() => setRecordMode(recordMode === "write" ? null : "write")} className="flex h-12 items-center justify-center gap-1 rounded-lg text-xs font-extrabold" style={{ backgroundColor: recordMode === "write" ? TINT : CARD, border: `1px solid ${LINE}`, color: recordMode === "write" ? PRIMARY : INK }}><Pencil size={14} /> 직접 입력</button>
                <button onClick={() => onNoComment?.(task.a.memberId, task.s.type, task.s.id)} className="h-12 rounded-lg text-xs font-extrabold" style={{ color: SUB }}>노코멘트</button>
              </div>
              {recordMode && (
                <div className="mt-3 space-y-2 rounded-xl p-3" style={{ backgroundColor: CANVAS }}>
                  {recordMode === "voice" && <VoiceNote onApply={(text) => setRecordBody((body) => body.trim() ? `${body.trim()}\n${text}` : text)} />}
                  <textarea rows={4} value={recordBody} onChange={(e) => setRecordBody(e.target.value)} placeholder="수업 내용과 회원 반응을 기록하세요" className={`${inputCls} h-auto resize-none py-3 leading-relaxed`} />
                  <button disabled={!recordBody.trim()} onClick={() => onSaveNote?.(task.a.memberId, task.s.type, task.s.id, recordBody.trim())} className="h-11 w-full rounded-lg text-xs font-extrabold text-white disabled:opacity-35" style={{ backgroundColor: PRIMARY }}>기록 저장</button>
                </div>
              )}
            </div>
          )}

          {task.kind === "group" && (
            <div>
              <p className="mb-2 text-xs font-bold" style={{ color: SUB }}>참석 인원</p>
              <div className="flex items-center gap-2">
                <button aria-label="참석 인원 줄이기" onClick={() => setGroupCount((n) => Math.max(0, n - 1))} className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: CANVAS, border: `1px solid ${LINE}` }}><Minus size={16} /></button>
                <span className="flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg text-lg font-extrabold tabular-nums" style={{ backgroundColor: CANVAS, color: INK }}>{groupCount}명</span>
                <button aria-label="참석 인원 늘리기" onClick={() => setGroupCount((n) => Math.min(num(task.s.groupCount) || 99, n + 1))} className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: CANVAS, border: `1px solid ${LINE}` }}><Plus size={16} /></button>
              </div>
              <button onClick={() => { setLastGroup(task.s); onSaveSchedule?.({ ...task.s, actualCount: groupCount, groupDone: true, groupCancelled: false }); }} className="mt-3 h-12 w-full rounded-lg text-sm font-extrabold text-white" style={{ backgroundColor: PRIMARY }}>저장</button>
            </div>
          )}

          {task.kind === "noshow" && (
            <div>
              <p className="mb-2 text-xs font-bold" style={{ color: SUB }}>노쇼 수강권 차감 여부</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onNoshowFee?.(task.s.id, true, task.a.memberId)} className="h-12 rounded-lg text-sm font-extrabold text-white" style={{ backgroundColor: BAD }}>차감</button>
                <button onClick={() => onNoshowFee?.(task.s.id, false, task.a.memberId)} className="h-12 rounded-lg text-sm font-extrabold" style={{ backgroundColor: CANVAS, color: SUB, border: `1px solid ${LINE}` }}>비차감</button>
              </div>
            </div>
          )}
        </div>
      )}
    </ScheduleBottomSheet>
  );
}

const PEN_COLORS = ["#C2413B", "#2E7D5B", "#4C4399", "#8A84C4", "#FFFFFF", "#1C2433"];
function coverDraw(ctx, img, w, h, tf) {
  const base = Math.max(w / img.width, h / img.height);
  const s = base * (tf?.scale || 1);
  const dw = img.width * s, dh = img.height * s;
  const rot = ((tf?.rot || 0) * Math.PI) / 180;
  ctx.save();
  ctx.translate(w / 2 + ((tf?.x || 0) / 100) * w, h / 2 + ((tf?.y || 0) / 100) * h);
  if (rot) ctx.rotate(rot);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}
function angleOf(p1, p2) {
  const [a, b] = p1.x <= p2.x ? [p1, p2] : [p2, p1];
  return +((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toFixed(1);
}
function angleLabel(part, deg, mirror) {
  if (Math.abs(deg) < 0.3) return `${part} 수평 (0°)`;
  let higher = deg > 0 ? "좌" : "우";
  if (mirror) higher = higher === "좌" ? "우" : "좌";
  return `${part} ${Math.abs(deg).toFixed(1)}° · ${higher}측 높음`;
}
function PostureCanvas({ photo, label, onClose, onSave, onToast, fresh }) {
  const wrapRef = useRef(null), canvasRef = useRef(null), imgRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [marks, setMarks] = useState(photo.marks || []);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(null);
  const [tool, setTool] = useState("angle");
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(3);
  const [grid, setGrid] = useState(true);
  const [ruler, setRuler] = useState(null);
  const rulerDrag = useRef(null);
  /* 두 손가락으로 자를 옮기고 돌린다 */
  const ptrs = useRef(new Map());
  const gest = useRef(null);
  /* 자가 꺼져 있으면 두 손가락은 사진 확대·이동 */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pinch = useRef(null);
  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const exportingRef = useRef(false);
  const [shot, setShot] = useState(null);
  useBackClose(true, onClose);
  useScrollLock();

  useEffect(() => {
    const img = new window.Image();
    if (!String(photo.src || "").startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; setSize((s) => ({ ...s })); };
    img.src = photo.src;
  }, [photo.src]);

  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current, c = canvasRef.current;
      if (!el || !c) return;
      const w = el.clientWidth, h = el.clientHeight, dpr = window.devicePixelRatio || 1;
      c.width = w * dpr; c.height = h * dpr;
      c.style.width = `${w}px`; c.style.height = `${h}px`;
      setSize({ w, h });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const degText = (deg) => `${Math.abs(deg).toFixed(1)}°`;

  /* ---- 자(눈금자) 기하 ---- */
  const rulerGeom = (w, h) => {
    if (!ruler) return null;
    const C = { x: ruler.cx * w, y: ruler.cy * h };
    const rad = (ruler.deg * Math.PI) / 180;
    return { C, rad, u: { x: Math.cos(rad), y: Math.sin(rad) }, n: { x: -Math.sin(rad), y: Math.cos(rad) }, L: Math.hypot(w, h) * 1.3 };
  };
  const toLocal = (g, P) => { const dx = P.x - g.C.x, dy = P.y - g.C.y; return { x: dx * g.u.x + dy * g.u.y, y: dx * g.n.x + dy * g.n.y }; };
  /* 자를 켜면 '윗변'에서만 그릴 수 있다.
     실제 자처럼 — 자 몸통과 그 아래에는 아무것도 그어지지 않고,
     윗변 근처에 찍은 점은 자 선 위로 딱 붙는다. */
  const rulerZone = (p) => {
    const c = canvasRef.current;
    if (!c || !ruler) return { ok: true, pt: p };
    const r = c.getBoundingClientRect(), w = r.width, h = r.height;
    const g = rulerGeom(w, h);
    const lp = toLocal(g, { x: p.x * w, y: p.y * h });
    if (lp.y >= -1) return { ok: false, pt: p, lp };      /* 자 몸통과 그 아래 — 금지 */
    if (lp.y < -140) return { ok: true, pt: p, lp };       /* 자에서 멀면 자유롭게 */
    return { ok: true, snap: true, lp, pt: { x: (g.C.x + lp.x * g.u.x) / w, y: (g.C.y + lp.x * g.u.y) / h } };
  };
  const snapPt = (p) => rulerZone(p).pt;

  const drawMark = (ctx, m, w, h) => {
    const P = (p) => ({ x: p.x * w, y: p.y * h });
    ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = m.width;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (m.tool === "point") {
      const p = P(m.pts[0]);
      ctx.beginPath(); ctx.arc(p.x, p.y, m.width + 3, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, m.width + 9, 0, Math.PI * 2); ctx.stroke();
      return;
    }
    ctx.beginPath();
    if (m.tool === "hline") { const y = m.pts[0].y * h; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    else if (m.tool === "vline") { const x = m.pts[0].x * w; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    else m.pts.forEach((p, i) => { const q = P(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.stroke();
    if (m.tool === "angle" && m.pts.length === 2) {
      const a = P(m.pts[0]), b = P(m.pts[1]);
      const baseY = a.x <= b.x ? a.y : b.y;
      ctx.save(); ctx.setLineDash([5, 5]); ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(Math.min(a.x, b.x) - 20, baseY); ctx.lineTo(Math.max(a.x, b.x) + 20, baseY); ctx.stroke(); ctx.restore();
      [a, b].forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, m.width + 2, 0, Math.PI * 2); ctx.fill(); });
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 - 14;
      ctx.font = "bold 13px Pretendard, sans-serif";
      const tw = ctx.measureText(m.label || "").width;
      ctx.fillStyle = "rgba(10,10,16,0.8)"; ctx.fillRect(cx - tw / 2 - 7, cy - 15, tw + 14, 22);
      ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1; ctx.strokeRect(cx - tw / 2 - 7, cy - 15, tw + 14, 22);
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(m.label || "", cx, cy + 1);
    }
  };

  const drawRuler = (ctx, w, h) => {
    const g = rulerGeom(w, h); if (!g) return;
    const rx = Math.min(150, g.L / 2 - 30);
    ctx.save();
    ctx.translate(g.C.x, g.C.y); ctx.rotate(g.rad);
    ctx.fillStyle = "rgba(16,16,24,0.94)";
    ctx.fillRect(-g.L / 2, 0, g.L, 56);
    ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-g.L / 2, 0); ctx.lineTo(g.L / 2, 0); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1;
    for (let x = Math.ceil(-g.L / 2 / 24) * 24; x <= g.L / 2; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, x % 120 === 0 ? 16 : 9); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 26, 15, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1.5; ctx.stroke();
    [-5, 0, 5].forEach((dx) => { ctx.beginPath(); ctx.arc(dx, 26, 1.6, 0, Math.PI * 2); ctx.fillStyle = "#17171F"; ctx.fill(); });
    ctx.beginPath(); ctx.arc(rx, 26, 13, 0, Math.PI * 2); ctx.fillStyle = PRIMARY; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(rx, 26, 5.5, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    let a = ((g.rad * 180 / Math.PI) % 180 + 180) % 180; if (a > 90) a -= 180;
    const t = `${Math.abs(a).toFixed(1)}°`;
    ctx.font = "bold 12px Pretendard, sans-serif";
    const tw = ctx.measureText(t).width;
    ctx.fillStyle = "rgba(10,10,16,0.85)"; ctx.fillRect(-60 - tw / 2 - 6, 17, tw + 12, 18);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(t, -60, 30);
    ctx.restore();
  };

  const draw = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"), dpr = window.devicePixelRatio || 1;
    const w = c.width / dpr, h = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    if (imgRef.current) coverDraw(ctx, imgRef.current, w, h, photo);
    if (grid) {
      ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 1;
      for (let i = 1; i < 10; i++) {
        ctx.beginPath(); ctx.moveTo((w / 10) * i, 0); ctx.lineTo((w / 10) * i, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (h / 10) * i); ctx.lineTo(w, (h / 10) * i); ctx.stroke();
      }
      ctx.strokeStyle = PRIMARY; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke(); ctx.restore();
    }
    marks.forEach((m) => drawMark(ctx, m, w, h));
    if (draft) drawMark(ctx, draft, w, h);
    if (pending && !draft) drawMark(ctx, { tool: "point", color, width, pts: [pending] }, w, h);
    if (ruler && !exportingRef.current) drawRuler(ctx, w, h);
  }, [marks, draft, pending, grid, ruler, color, width, photo, size]);
  useEffect(() => { draw(); }, [draw]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const down = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    /* 손가락이 둘 — 자가 켜져 있으면 자 조절, 꺼져 있으면 사진 확대 */
    if (ptrs.current.size === 2 && !ruler) {
      const [a, b] = [...ptrs.current.values()];
      setDraft(null);
      pinch.current = {
        d0: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        z0: zoom, px: pan.x, py: pan.y,
      };
      return;
    }
    if (ptrs.current.size === 2 && ruler) {
      const [p1, p2] = [...ptrs.current.values()];
      setDraft(null);
      rulerDrag.current = null;
      gest.current = {
        mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2,
        ang: (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI,
        cx: ruler.cx, cy: ruler.cy, deg: ruler.deg,
      };
      return;
    }
    if (ptrs.current.size > 1) return;
    const raw = pos(e);
    if (ruler) {
      const rct = canvasRef.current.getBoundingClientRect();
      const g = rulerGeom(rct.width, rct.height);
      const P = { x: raw.x * rct.width, y: raw.y * rct.height };
      const lp = toLocal(g, P);
      const rx = Math.min(150, g.L / 2 - 30);
      if (Math.hypot(lp.x - rx, lp.y - 26) < 26) { rulerDrag.current = { mode: "rot", a0: Math.atan2(P.y - g.C.y, P.x - g.C.x) - g.rad }; return; }
      /* 자 몸통과 그 아래에서는 절대 그어지지 않는다 — 누르면 자를 옮긴다 */
      if (lp.y >= -1) { rulerDrag.current = { mode: "move", dx: P.x - g.C.x, dy: P.y - g.C.y }; return; }
    }
    const p = ruler ? snapPt(raw) : raw;
    if (tool === "hline" || tool === "vline") { setDraft({ id: uid(), tool, color, width, pts: [p] }); return; }
    if (tool === "angle") {
      if (!pending) { setDraft({ id: uid(), tool: "point", color, width, pts: [p] }); return; }
      setDraft({ id: uid(), tool: "angle", color, width, pts: [pending, p], label: degText(angleOf(pending, p)) });
      return;
    }
    setDraft({ id: uid(), tool, color, width, pts: [p, p], label: "" });
  };
  const move = (e) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && ptrs.current.size >= 2 && !ruler) {
      const el = canvasRef.current; if (!el) return;
      const [a, b] = [...ptrs.current.values()];
      const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const g = pinch.current;
      setZoom(Math.min(5, Math.max(1, g.z0 * (d / g.d0))));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      setPan({ x: g.px + (mx - g.mx), y: g.py + (my - g.my) });
      return;
    }
    if (gest.current && ptrs.current.size >= 2 && ruler) {
      const el = canvasRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const [p1, p2] = [...ptrs.current.values()];
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const ang = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
      const g = gest.current;
      setRuler({
        cx: Math.min(0.98, Math.max(0.02, g.cx + (mx - g.mx) / r.width)),
        cy: Math.min(0.98, Math.max(0.02, g.cy + (my - g.my) / r.height)),
        deg: g.deg + (ang - g.ang),
      });
      return;
    }
    if (ptrs.current.size > 1) return;
    const raw = pos(e);
    if (rulerDrag.current && ruler) {
      const rct = canvasRef.current.getBoundingClientRect();
      const P = { x: raw.x * rct.width, y: raw.y * rct.height };
      const d = rulerDrag.current;
      if (d.mode === "move") setRuler((r) => ({ ...r, cx: Math.min(0.98, Math.max(0.02, (P.x - d.dx) / rct.width)), cy: Math.min(0.98, Math.max(0.02, (P.y - d.dy) / rct.height)) }));
      else setRuler((r) => ({ ...r, deg: ((Math.atan2(P.y - r.cy * rct.height, P.x - r.cx * rct.width) - d.a0) * 180) / Math.PI }));
      return;
    }
    if (!draft) return;
    /* 자 몸통·아래를 지나가는 동안에는 선이 이어지지 않는다 */
    if (ruler) { const z = rulerZone(raw); if (!z.ok) return; }
    const p = ruler ? snapPt(raw) : raw;
    setDraft((d) => {
      if (!d) return d;
      if (d.tool === "hline" || d.tool === "vline" || d.tool === "point") return { ...d, pts: [p] };
      if (d.tool === "pen") return { ...d, pts: [...d.pts, p] };
      return { ...d, pts: [d.pts[0], p], label: d.tool === "angle" ? degText(angleOf(d.pts[0], p)) : "" };
    });
  };
  const up = (e) => {
    if (e && e.pointerId != null) ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) { gest.current = null; pinch.current = null; }
    if (zoom <= 1.02 && (pan.x !== 0 || pan.y !== 0)) setPan({ x: 0, y: 0 });
    if (ptrs.current.size >= 1 && gest.current === null && !draft) return;
    if (rulerDrag.current) { rulerDrag.current = null; return; }
    if (!draft) return;
    const d = draft; setDraft(null);
    if (d.tool === "point") { setPending(d.pts[0]); return; }
    if (d.tool === "hline" || d.tool === "vline") { setMarks((m) => [...m, d]); return; }
    if (d.tool === "angle") {
      if (Math.hypot(d.pts[1].x - d.pts[0].x, d.pts[1].y - d.pts[0].y) < 0.02) return;
      const deg = angleOf(d.pts[0], d.pts[1]);
      setMarks((m) => [...m, { ...d, angle: deg, label: degText(deg) }]);
      setPending(null);
      return;
    }
    if (d.tool !== "pen" && Math.hypot(d.pts[1].x - d.pts[0].x, d.pts[1].y - d.pts[0].y) < 0.02) return;
    setMarks((m) => [...m, d]);
  };
  const pickTool = (k) => { setTool(k); setPending(null); setDraft(null); };
  const download = async () => {
    exportingRef.current = true; draw();
    let snap = null;
    try { snap = canvasRef.current.toDataURL("image/jpeg", 0.92); } catch (e) {}
    const ok = await shareCanvas(canvasRef.current, `체형분석_${label}_${todayISO()}.jpg`, "체형 분석", onToast);
    exportingRef.current = false; draw();
    if (!ok && snap) setShot(snap);
  };

  return (
    <div className="safe-all fixed inset-0 z-50 flex flex-col bg-photo">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
        <p className="text-sm font-bold text-white">체형 분석 · {label}</p>
        <button onClick={() => { onSave(marks); onClose(); }} className="rounded-full px-4 py-2 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}>저장</button>
      </div>
      {fresh && (
        <p className="mx-4 mb-1 rounded-xl px-3 py-2 text-center text-xs font-bold text-white" style={{ backgroundColor: PRIMARY }}>
          사진이 등록됐습니다 · 지금 바로 각도를 재 보세요. 저장하면 사진에 함께 남습니다 (건너뛰려면 왼쪽 위 X)
        </p>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center px-3">
        <div ref={wrapRef} className="relative overflow-hidden rounded-2xl" style={{ aspectRatio: "3 / 4", maxHeight: "100%", maxWidth: "min(100%, 540px)", width: "100%" }}>
          <canvas ref={canvasRef} className="absolute inset-0 touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }} />
          {zoom > 1.02 && (
            <button onClick={resetZoom} className="absolute right-2 top-2 rounded-full px-3 py-1.5 text-xs font-extrabold"
              style={{ backgroundColor: "rgba(255,255,255,.92)", color: "#17171F" }}>{zoom.toFixed(1)}× · 원래대로</button>
          )}
        </div>
      </div>
      <div className="space-y-2 px-3 pb-5 pt-3">
        <div className="flex gap-1.5 overflow-x-auto">
          {[{ k: "angle", l: "각도" }, { k: "line", l: "직선" }, { k: "pen", l: "펜" }, { k: "hline", l: "수평선" }, { k: "vline", l: "수직선" }].map((t) => (
            <button key={t.k} onClick={() => pickTool(t.k)} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold"
              style={tool === t.k ? { backgroundColor: BRAND, color: "#fff" } : { backgroundColor: "rgba(255,255,255,0.15)", color: "#fff" }}>{t.l}</button>
          ))}
          <button onClick={() => setRuler((r) => { if (r) return null; setTool("pen"); setPending(null); setDraft(null); return { cx: 0.5, cy: 0.45, deg: 0 }; })} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold"
            style={{ backgroundColor: ruler ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.15)", color: ruler ? "#17171F" : "#fff" }}>자</button>
          <button onClick={() => setGrid((g) => !g)} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold"
            style={{ backgroundColor: grid ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.15)", color: grid ? "#17171F" : "#fff" }}>격자</button>
        </div>
        {(tool === "hline" || tool === "vline") && (
          <p className="text-xs font-semibold text-white opacity-80">화면을 누른 채로 위치를 옮기고, 손을 떼면 선이 그려집니다.</p>
        )}
        {tool === "angle" && (
          <p className="text-xs font-semibold text-white opacity-80">
            {pending ? "두 번째 점을 찍으면 두 점을 잇는 선의 각도가 나옵니다" : "점을 한 번 찍고, 이어서 다음 점을 찍으면 수평 대비 각도가 표시됩니다"}
          </p>
        )}
        {ruler && (
          <p className="text-xs font-semibold text-white opacity-80">자 <b>윗변</b>을 따라서만 그어집니다 · 자 몸통과 아래쪽은 그어지지 않습니다 · 두 손가락으로 옮기고 돌리세요</p>
        )}
        <div className="flex items-center gap-2">
          {PEN_COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className="h-7 w-7 rounded-full"
              style={{ backgroundColor: c, border: color === c ? `3px solid ${PRIMARY}` : "2px solid rgba(255,255,255,0.4)" }} />
          ))}
          <input type="range" min="1" max="10" value={width} onChange={(e) => setWidth(Number(e.target.value))} className="ml-2 flex-1" style={{ accentColor: PRIMARY, touchAction: "none" }} />
          <span className="w-6 text-center text-xs font-bold text-white">{width}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { if (pending) { setPending(null); return; } setMarks((m) => m.slice(0, -1)); }} className="flex flex-1 items-center justify-center gap-1 rounded-2xl py-2.5 text-xs font-bold text-white" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><RotateCcw size={13} /> 뒤로</button>
          <button onClick={() => { setMarks([]); setPending(null); }} className="flex flex-1 items-center justify-center gap-1 rounded-2xl py-2.5 text-xs font-bold text-white" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><Trash2 size={13} /> 전체 지우기</button>
          <button onClick={download} className="flex flex-1 items-center justify-center gap-1 rounded-2xl py-2.5 text-xs font-bold text-white" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><Download size={13} /> 공유</button>
        </div>
        {!ruler && <p className="text-center text-xs text-white opacity-60">두 손가락으로 벌리면 사진이 확대됩니다</p>}
        <p className="text-center text-xs text-white opacity-60">
          {tool === "angle" ? "점 두 개를 이으면 각도가 표시됩니다 · 자를 켜면 반듯하게 찍기 쉬워요" : "화면을 드래그해 그리세요"}
        </p>
      </div>
      {shot && (
        <div className="safe-all fixed inset-0 z-50 flex items-center justify-center p-6" style={{ backgroundColor: "rgba(0,0,0,0.85)" }} onClick={() => setShot(null)}>
          <div className="text-center">
            <img src={shot} alt="분석 결과" className="mx-auto rounded-2xl" style={{ maxHeight: "70vh" }} />
            <p className="mt-3 text-xs text-white opacity-70">자동 저장이 막힌 기기에서는 이미지를 길게 눌러 저장하세요</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MemberList({ members, selectedId, onSelect, onAdd, onOpenFav, favCount, schedule, draftCount, onCleanDrafts }) {
  const [q, setQ] = useState("");
  const [cleanAsk, setCleanAsk] = useState(false);
  const [seg, setSeg] = useState("all");
  const [todayOnly, setTodayOnly] = useState(false);
  const [sortBy, setSortBy] = useState("default");
  const todayMap = useMemo(() => {
    const map = {};
    (schedule || []).filter((s) => s?.date === todayISO()).sort((a, b) => a.start.localeCompare(b.start)).forEach((s) => {
      attendeesOf(s).forEach((a) => { if (!map[a.memberId]) map[a.memberId] = { start: s.start, type: s.type, status: a.status }; });
    });
    return map;
  }, [schedule]);
  const todayCount = members.filter((m) => todayMap[m.id]).length;
  const holdCount = members.filter((m) => isHold(m)).length;
  const individualCount = members.filter((m) => isActive(m) && !m.duetWith).length;
  const duetCount = members.filter((m) => isActive(m) && !!m.duetWith).length;
  const expiringCount = members.filter((m) => isActive(m) && (left(m) <= 3 || (ddaySafe(m.contractEnd) ?? 999) <= 14)).length;
  /* 듀엣 짝을 항상 바로 아래에 붙인다 */
  const pairUp = (arr) => {
    const byId = {}; arr.forEach((m) => { byId[m.id] = m; });
    const out = [], used = new Set();
    arr.forEach((m) => {
      if (used.has(m.id)) return;
      out.push(m); used.add(m.id);
      const p = m.duetWith && byId[m.duetWith];
      if (p && !used.has(p.id)) { out.push(p); used.add(p.id); }
    });
    return out;
  };
  const filtered = pairUp(members
    .filter((m) => {
      if (seg === "individual") return isActive(m) && !m.duetWith;
      if (seg === "duet") return isActive(m) && !!m.duetWith;
      if (seg === "hold") return isHold(m);
      if (seg === "expiring") return isActive(m) && (left(m) <= 3 || (ddaySafe(m.contractEnd) ?? 999) <= 14);
      return true;
    })
    .filter((m) => (todayOnly ? !!todayMap[m.id] : true))
    .filter((m) => (m.name || "").includes(q) || (m.goal || "").includes(q) || (m.instructor || "").includes(q))
    .sort((a, b) => {
      if (sortBy === "leftDesc") return left(b) - left(a);
      if (sortBy === "leftAsc") return left(a) - left(b);
      const ta = todayMap[a.id]?.start, tb = todayMap[b.id]?.start;
      if (ta && tb) return ta.localeCompare(tb);
      if (ta) return -1;
      if (tb) return 1;
      return 0;
    }));
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-3.5" style={{ color: SUB }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회원명 · 목표 · 강사 검색"
            className="h-11 w-full rounded-xl border-0 bg-white pl-10 pr-3 text-sm outline-none"
            style={{ border: `1px solid ${LINE}`, boxShadow: "0 1px 2px rgba(20,20,43,.04)" }} />
        </div>
        <button onClick={onAdd} className="flex h-11 items-center gap-1 rounded-xl px-4 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}><UserPlus size={16} /> 추가</button>
      </div>
      {draftCount > 0 && (cleanAsk ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3" style={{ backgroundColor: BAD_S }}>
          <AlertTriangle size={15} style={{ color: BAD }} />
          <span className="min-w-0 flex-1 text-sm font-bold" style={{ color: INK }}>이름도 기록도 없는 회원 {draftCount}명을 지울까요?</span>
          <button onClick={() => { onCleanDrafts && onCleanDrafts(); setCleanAsk(false); }} className="rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>정리</button>
          <button onClick={() => setCleanAsk(false)} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold" style={{ color: SUB }}>취소</button>
        </div>
      ) : (
        <button onClick={() => setCleanAsk(true)} className="flex w-full items-center gap-2 rounded-2xl px-4 py-3" style={{ backgroundColor: WARN_S }}>
          <Pencil size={15} className="shrink-0" style={{ color: WARN }} />
          <span className="min-w-0 flex-1 text-left text-sm font-bold" style={{ color: INK }}>작성 중인 회원 {draftCount}명 · 이름이 비어 있습니다</span>
          <span className="shrink-0 text-xs font-extrabold" style={{ color: WARN }}>정리하기</span>
        </button>
      ))}
      {todayCount > 0 && (
        <button onClick={() => setTodayOnly((v) => !v)} className="flex h-10 w-full items-center gap-2 rounded-xl px-3"
          style={todayOnly ? { backgroundColor: BRAND, color: "#fff" } : { backgroundColor: CARD, color: INK, border: `1px solid ${LINE}` }}>
          <Calendar size={15} style={{ color: todayOnly ? "#fff" : PRIMARY }} />
          <span className="text-sm font-extrabold">오늘 수업 회원 {todayCount}명</span>
          <span className="ml-auto text-xs font-bold" style={{ color: todayOnly ? "rgba(255,255,255,0.8)" : SUB }}>
            {todayOnly ? "전체 보기" : "이 회원만 보기"}
          </span>
        </button>
      )}
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl bg-white p-1" style={{ border: `1px solid ${LINE}` }}>
          {[
            { k: "all", l: "전체", n: members.length },
            { k: "individual", l: "개인", n: individualCount },
            { k: "duet", l: "듀엣", n: duetCount },
            { k: "hold", l: "홀딩", n: holdCount },
            { k: "expiring", l: "이용권 임박", n: expiringCount },
          ].map((o) => (
            <button key={o.k} onClick={() => setSeg(o.k)} className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-xs font-bold"
              style={seg === o.k ? { backgroundColor: TINT, color: BRAND } : { color: SUB }}>
              {o.l} <span className="tabular-nums">{o.n}</span>
            </button>
          ))}
        </div>
        <button onClick={onOpenFav} className="flex h-10 items-center gap-1 rounded-xl bg-white px-3 text-xs font-bold" style={{ color: favCount ? WARN : SUB, border: `1px solid ${LINE}` }}>
          <Star size={14} fill={favCount ? WARN : "none"} /> 즐겨찾기 {favCount || 0}
        </button>
      </div>
      {filtered.length > 1 && (
        <button onClick={() => setSortBy((s) => (s === "default" ? "leftDesc" : s === "leftDesc" ? "leftAsc" : "default"))}
          className="flex h-10 w-full items-center gap-2 rounded-xl px-3"
          style={sortBy === "default" ? { backgroundColor: CARD, border: `1px solid ${LINE}` } : { backgroundColor: TINT, border: `1px solid ${PRIMARY}33` }}>
          <ArrowUpDown size={14} style={{ color: PRIMARY }} />
          <span className="text-xs font-extrabold" style={{ color: sortBy === "default" ? INK : PRIMARY }}>
            {sortBy === "leftDesc" ? "잔여 횟수 많은 순" : sortBy === "leftAsc" ? "잔여 횟수 적은 순" : "기본 순서 (오늘 수업 먼저)"}
          </span>
          <span className="ml-auto text-xs font-bold" style={{ color: SUB }}>
            {sortBy === "default" ? "많은 순으로" : sortBy === "leftDesc" ? "적은 순으로" : "기본으로"}
          </span>
        </button>
      )}
      {filtered.length === 0 && (
        <Card className="p-8 text-center">
          {members.length === 0 ? (
            <>
              <Users size={22} className="mx-auto" style={{ color: FAINT }} />
              <p className="mt-2 text-sm font-bold" style={{ color: INK }}>등록된 회원이 없습니다.</p>
              <Sub className="mt-1">오른쪽 위 '추가'를 눌러 첫 회원을 등록해 주세요.</Sub>
            </>
          ) : q ? (
            <>
              <p className="text-sm font-bold" style={{ color: INK }}>'{q}' 검색 결과가 없습니다.</p>
              <button onClick={() => setQ("")} className="mt-3 rounded-2xl px-4 py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>검색 지우기</button>
            </>
          ) : (
            <>
              <p className="text-sm font-bold" style={{ color: INK }}>
                {seg === "hold" ? "홀딩 중인 회원이 없습니다." : seg === "expiring" ? "이용권 만료가 임박한 회원이 없습니다." : "조건에 맞는 회원이 없습니다."}
              </p>
              <Sub className="mt-1">다른 상태에 회원이 있습니다. 눌러서 이동하세요.</Sub>
              <div className="mt-3 flex justify-center gap-1.5">
                {[{ k: "all", l: "전체", n: members.length }, { k: "hold", l: "홀딩", n: holdCount }]
                  .filter((o) => o.k !== seg && o.n > 0)
                  .map((o) => (
                    <button key={o.k} onClick={() => setSeg(o.k)} className="rounded-2xl px-4 py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>
                      {o.l} {o.n}명 보기
                    </button>
                  ))}
              </div>
            </>
          )}
        </Card>
      )}
      {filtered.map((m) => {
        const on = m.id === selectedId, total = left(m), low = total <= 3;
        const lastD = lastDoneOf(schedule, m.id);
        const idle = lastD ? Math.max(0, -dday(lastD)) : null;
        const idleC = idle === null ? SUB : idle >= 5 ? BAD : idle >= 3 ? WARN : GOOD;
        const d = ddaySafe(m.contractEnd);
        return (
          <button key={m.id} onClick={() => onSelect(m.id)} className="w-full rounded-xl bg-white p-3 text-left"
            style={{ border: `1px solid ${on ? PRIMARY : LINE}`, boxShadow: on ? `0 0 0 1px ${PRIMARY}` : SHADOW }}>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>{(m.name || "?").slice(0, 1)}</div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate font-extrabold" style={{ color: isDraft(m) ? SUB : INK }}>
                  {isDraft(m) ? "작성 중" : m.name} {ageOf(m) !== null ? <span className="text-xs font-medium" style={{ color: SUB }}>{ageOf(m)}세</span> : null}
                  {m.duetWith && members.some((x) => x.id === m.duetWith) && (
                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-xs font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>
                      듀엣 · {members.find((x) => x.id === m.duetWith)?.name || "짝"}
                    </span>
                  )}
                </p>
                {todayMap[m.id]
                  ? <p className="truncate text-xs font-extrabold" style={{ color: PRIMARY }}>오늘 {todayMap[m.id].start} · {todayMap[m.id].type}</p>
                  : <Sub className="truncate">{m.goal || "목표 미입력"}</Sub>}
              </div>
              <div className="text-right">
                <p className="text-sm font-extrabold tabular-nums" style={{ color: low ? BAD : INK }}>{total}회</p>
                <Sub>정규 {num(m.regular)} · 서비스 {num(m.service)}</Sub>
              </div>
              <ChevronRight size={16} style={{ color: FAINT }} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: CANVAS }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, (total / (num(m.total) || total || 1)) * 100))}%`, backgroundColor: low ? BAD : PRIMARY }} />
              </div>
              {isEnded(m) && <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>종료{m.endedAt ? ` ${md(m.endedAt)}` : ""}</span>}
              {isHold(m) && <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: WARN_S, color: WARN }}>홀딩{m.holdUntil ? ` · 복귀 ${md(m.holdUntil)}` : ""}</span>}
              {isActive(m) && d !== null && d <= 14 && <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: WARN_S, color: WARN }}>{d < 0 ? "만료" : `D-${d}`}</span>}
              {!isEnded(m) && (isHold(m)
                ? <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>홀딩 중</span>
                : idle === null
                  ? <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>첫 수업 전</span>
                  : <span className="rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: `${idleC}14`, color: idleC }}>
                      {restLabel(idle)}
                    </span>)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
function ReferenceMemberList({ members, schedule, onSelect, onAdd }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [registerOpen, setRegisterOpen] = useState(false);
  const realMembers = members.filter((m) => !isDraft(m));
  const nextOf = (memberId) => (schedule || [])
    .filter((s) => hasMember(s, memberId) && `${s.date} ${s.start}` >= `${todayISO()} 00:00`)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))[0] || null;
  const matchFilter = (m) => {
    if (filter === "private") return isActive(m) && !m.duetWith;
    if (filter === "duet") return isActive(m) && !!m.duetWith;
    if (filter === "hold") return isHold(m);
    if (filter === "renew") return isActive(m) && (left(m) <= 3 || (ddaySafe(m.contractEnd) ?? 999) <= 14);
    return true;
  };
  const list = realMembers.filter(matchFilter)
    .filter((m) => !q.trim() || (m.name || "").includes(q.trim()) || (m.phone || "").includes(q.trim()))
    .sort((a, b) => {
      if (sort === "remaining") return left(a) - left(b);
      if (sort === "expiry") return String(a.contractEnd || "9999").localeCompare(String(b.contractEnd || "9999"));
      if (sort === "recent") return String(b.notes?.[0]?.date || "").localeCompare(String(a.notes?.[0]?.date || ""));
      return String(a.name || "").localeCompare(String(b.name || ""), "ko");
    });
  const filters = [
    { k: "all", l: "전체" }, { k: "private", l: "개인" }, { k: "duet", l: "듀엣" },
    { k: "hold", l: "홀딩" }, { k: "renew", l: "이용권 임박" },
  ];
  const countOf = (k) => realMembers.filter((m) => {
    if (k === "all") return true;
    if (k === "private") return isActive(m) && !m.duetWith;
    if (k === "duet") return isActive(m) && !!m.duetWith;
    if (k === "hold") return isHold(m);
    return isActive(m) && (left(m) <= 3 || (ddaySafe(m.contractEnd) ?? 999) <= 14);
  }).length;
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ backgroundColor: PAGE }}>
      <header className="flex shrink-0 items-center" style={{ height: 52, padding: "0 14px", backgroundColor: CARD, borderBottom: `1px solid ${LINE}` }}>
        <div className="min-w-0 flex-1"><h1 style={{ fontSize: 18, fontWeight: 600, color: INK }}>회원</h1><p style={{ fontSize: 11, color: SUB }}>전체 {realMembers.length}명</p></div>
        <button type="button" onClick={() => setRegisterOpen(true)} className="flex items-center gap-1 text-white"
          style={{ height: 36, padding: "0 12px", borderRadius: 8, backgroundColor: BRAND, fontSize: 13, fontWeight: 600 }}><Plus size={15} />추가</button>
      </header>
      <div className="shrink-0" style={{ padding: "10px 12px 8px", backgroundColor: CARD, borderBottom: `1px solid ${LINE}` }}>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: SUB }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회원 이름 또는 연락처 검색" className="w-full border-0 pl-9 pr-3 text-sm outline-none"
            style={{ height: 40, borderRadius: 8, backgroundColor: CANVAS, color: INK }} />
        </div>
        <div className="mt-2 flex items-center gap-1 overflow-x-auto">
          {filters.map((o) => <button type="button" key={o.k} onClick={() => setFilter(o.k)} className="shrink-0"
            style={{ height: 32, padding: "0 10px", borderRadius: 16, fontSize: 12, fontWeight: 600,
              backgroundColor: filter === o.k ? TINT : CARD, color: filter === o.k ? BRAND : SUB,
              border: `1px solid ${filter === o.k ? "#D5D1EB" : LINE}` }}>{o.l} <span className="tabular-nums">{countOf(o.k)}</span></button>)}
          <label className="ml-auto flex shrink-0 items-center gap-1" style={{ color: SUB }}><ArrowUpDown size={13} />
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="border-0 bg-transparent p-0 text-xs font-semibold outline-none" style={{ color: SUB }}>
              <option value="name">이름순</option><option value="remaining">잔여 적은순</option><option value="expiry">만료 임박순</option><option value="recent">최근 기록순</option>
            </select>
          </label>
        </div>
      </div>
      <div className="pt-scroll min-h-0 flex-1 overflow-y-auto" style={{ padding: "10px 12px 16px" }}>
        {!list.length && <div className="py-12 text-center"><Users size={22} className="mx-auto" style={{ color: FAINT }} /><p className="mt-2 text-sm font-semibold" style={{ color: INK }}>{q ? "검색 결과가 없습니다" : "조건에 맞는 회원이 없습니다"}</p></div>}
        {list.map((m) => {
          const remaining = left(m), expiry = ddaySafe(m.contractEnd), next = nextOf(m.id);
          const renew = isActive(m) && (remaining <= 3 || (expiry !== null && expiry <= 14));
          return (
            <button type="button" key={m.id} onClick={() => onSelect(m.id)} className="mb-2 w-full text-left"
              style={{ padding: "12px 14px", borderRadius: 14, backgroundColor: CARD, border: `1px solid ${LINE}`, boxShadow: "0 1px 4px rgba(28,36,51,.05)" }}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5"><p className="truncate" style={{ fontSize: 15, fontWeight: 600, color: INK }}>{m.name}</p>
                    {isHold(m) && <span style={{ padding: "2px 6px", borderRadius: 5, fontSize: 10, fontWeight: 600, backgroundColor: WARN_S, color: WARN }}>홀딩</span>}
                    {isEnded(m) && <span style={{ padding: "2px 6px", borderRadius: 5, fontSize: 10, fontWeight: 600, backgroundColor: CANVAS, color: SUB }}>종료</span>}
                    {renew && <span style={{ padding: "2px 6px", borderRadius: 5, fontSize: 10, fontWeight: 600, backgroundColor: BAD_S, color: BAD }}>재등록 필요</span>}
                  </div>
                  <p className="mt-1 truncate" style={{ fontSize: 12, color: SUB }}>{m.instructor || "담당 미지정"} · {m.duetWith ? "듀엣" : "개인"}</p>
                </div>
                <div className="shrink-0 text-right"><p className="tabular-nums" style={{ fontSize: 17, lineHeight: 1, fontWeight: 600, color: remaining <= 3 ? BAD : INK }}>{remaining}<span style={{ fontSize: 11 }}>회</span></p><p style={{ marginTop: 3, fontSize: 10, color: SUB }}>잔여</p></div>
                <ChevronRight size={16} style={{ color: FAINT }} />
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-2" style={{ paddingTop: 8, borderTop: `1px solid ${LINE}` }}>
                <span className="truncate" style={{ fontSize: 11, color: SUB }}>만료 {m.contractEnd ? ymd(m.contractEnd) : "미설정"}</span><span style={{ color: LINE }}>·</span>
                <span className="min-w-0 flex-1 truncate" style={{ fontSize: 11, color: next ? INK2 : SUB }}>다음 예약 {next ? `${md(next.date)} ${next.start}` : "없음"}</span>
              </div>
            </button>
          );
        })}
      </div>
      {registerOpen && <MemberRegisterSheet members={realMembers} onClose={() => setRegisterOpen(false)}
        onOpenExisting={(id) => { setRegisterOpen(false); onSelect(id); }}
        onCreate={(v) => { onAdd(v); setRegisterOpen(false); }} />}
    </div>
  );
}

function MemberRegisterSheet({ members, onOpenExisting, onClose, onCreate }) {
  const [f, setF] = useState({ name: "", phone: "", lessonType: "private", goal: "", focus: "", memo: "", passName: "개인 10회", regular: "10", startDate: todayISO(), contractEnd: shift(todayISO(), 90) });
  const [error, setError] = useState("");
  const submit = () => {
    const name = f.name.trim(), phone = f.phone.replace(/\D/g, "");
    if (!name) { setError("회원 이름을 입력해 주세요."); return; }
    const duplicate = (members || []).find((m) => String(m.name || "").trim() === name
      && (!phone || String(m.phone || "").replace(/\D/g, "") === phone));
    if (duplicate) { setError("같은 회원이 이미 등록되어 있습니다."); return; }
    const count = num(f.regular);
    onCreate({ name, phone: f.phone.trim(), lessonType: f.lessonType, goal: f.goal.trim(),
      focus: f.focus.split("\n").map((x) => x.trim()).filter(Boolean), passName: f.passName.trim(),
      regular: count, total: count, startDate: f.startDate, contractEnd: f.contractEnd,
      notes: f.memo.trim() ? [{ id: uid(), date: todayISO(), type: "상담", body: f.memo.trim(), tags: [] }] : [] });
  };
  return (
    <Sheet title="회원 등록" sub="필수 정보를 입력하면 실제 회원 데이터로 저장됩니다" onClose={onClose} wide>
      <div className="space-y-3">
        <Field label="회원 이름"><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></Field>
        <Field label="연락처"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={inputCls} /></Field>
        <Field label="수업 유형"><div className="grid grid-cols-3 gap-1">{[{k:"private",l:"개인"},{k:"duet",l:"듀엣"},{k:"group",l:"그룹"}].map((o) => <button type="button" key={o.k} onClick={() => setF({ ...f, lessonType: o.k, passName: `${o.l} ${f.regular || 0}회` })} style={{ height: 38, borderRadius: 8, border: `1px solid ${f.lessonType === o.k ? BRAND : LINE}`, backgroundColor: f.lessonType === o.k ? TINT : CARD, color: f.lessonType === o.k ? BRAND_D : SUB, fontSize: 12, fontWeight: 600 }}>{o.l}</button>)}</div></Field>
        <Field label="목표"><input value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} className={inputCls} /></Field>
        <Field label="주의사항" hint="한 줄에 하나"><textarea rows={2} value={f.focus} onChange={(e) => setF({ ...f, focus: e.target.value })} className={`${inputCls} h-auto resize-none py-2.5`} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="이용권"><input value={f.passName} onChange={(e) => setF({ ...f, passName: e.target.value })} className={inputCls} /></Field><Field label="총 횟수"><input inputMode="numeric" value={f.regular} onChange={(e) => setF({ ...f, regular: e.target.value.replace(/\D/g, "") })} className={inputCls} /></Field></div>
        <div className="grid grid-cols-2 gap-2"><Field label="시작일"><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className={inputCls} /></Field><Field label="만료일"><input type="date" value={f.contractEnd} onChange={(e) => setF({ ...f, contractEnd: e.target.value })} className={inputCls} /></Field></div>
        <Field label="상담 메모"><textarea rows={2} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} className={`${inputCls} h-auto resize-none py-2.5`} /></Field>
        {error && <div className="flex items-center gap-2" style={{ padding: "9px 10px", borderRadius: 8, backgroundColor: WARN_S, color: WARN, fontSize: 12 }}><AlertCircle size={14} />{error}{error.includes("이미") && <button type="button" className="ml-auto font-semibold" onClick={() => { const name = f.name.trim(), phone = f.phone.replace(/\D/g, ""); const d = (members || []).find((m) => String(m.name || "").trim() === name && (!phone || String(m.phone || "").replace(/\D/g, "") === phone)); if (d) onOpenExisting(d.id); }}>기존 회원 열기</button>}</div>}
        <button type="button" disabled={!f.name.trim() || !num(f.regular)} onClick={submit} className="w-full text-sm font-semibold text-white disabled:opacity-40" style={{ height: 48, borderRadius: 8, backgroundColor: BRAND }}>회원 등록</button>
      </div>
    </Sheet>
  );
}

function ReferenceMemberDetail({ member, schedule, photos, onBack, onPatch, onSaveNote, onSchedule, onAssess }) {
  const [sheet, setSheet] = useState(null);
  const [edit, setEdit] = useState({});
  const [memo, setMemo] = useState("");
  const [pass, setPass] = useState({ name: "", count: "", end: "" });
  const [hold, setHold] = useState({ start: todayISO(), end: shift(todayISO(), 14), reason: "", extend: true });
  const [releaseArmed, setReleaseArmed] = useState(false);
  const lessons = (schedule || []).filter((s) => hasMember(s, member.id)).sort((a, b) => `${b.date} ${b.start}`.localeCompare(`${a.date} ${a.start}`));
  const notes = [...(member.notes || [])].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const assessments = (photos?.poses || []).filter((p) => p && p.metrics).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const next = lessons.filter((s) => `${s.date} ${s.start}` >= `${todayISO()} 00:00`).sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))[0] || null;
  const openEdit = () => { setEdit({ name: member.name || "", phone: member.phone || "", birth: member.birth || "", goal: member.goal || "", focus: (member.focus || []).join(", ") }); setSheet("edit"); };
  const holdHistory = member.holdHistory || [];
  const sectionStyle = { backgroundColor: CARD, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px" };
  const Section = ({ title, action, children }) => <section style={sectionStyle}><div className="mb-2 flex items-center gap-2"><h2 className="min-w-0 flex-1" style={{ fontSize: 14, fontWeight: 600, color: INK }}>{title}</h2>{action}</div>{children}</section>;
  return (
    <div className="relative flex h-full min-h-0 flex-col" style={{ backgroundColor: PAGE }}>
      <header className="flex shrink-0 items-center" style={{ height: 52, padding: "0 8px", backgroundColor: CARD, borderBottom: `1px solid ${LINE}` }}>
        <button type="button" onClick={onBack} aria-label="회원 목록" className="flex h-11 w-11 items-center justify-center" style={{ color: SUB }}><ChevronLeft size={19} /></button>
        <div className="min-w-0 flex-1"><h1 className="truncate" style={{ fontSize: 17, fontWeight: 600, color: INK }}>{member.name || "이름 미입력"}</h1><p style={{ fontSize: 11, color: SUB }}>{isHold(member) ? "홀딩" : isEnded(member) ? "종료" : "활성"} · 담당 {member.instructor || "미지정"}</p></div>
        <button type="button" onClick={openEdit} style={{ height: 36, padding: "0 10px", borderRadius: 8, color: BRAND, fontSize: 13, fontWeight: 600 }}><Pencil size={14} className="inline" /> 수정</button>
      </header>
      <main className="pt-scroll min-h-0 flex-1 overflow-y-auto" style={{ padding: "10px 12px 76px" }}>
        <div className="space-y-2">
          <section style={{ ...sectionStyle, backgroundColor: TINT, borderColor: "#D5D1EB" }}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center" style={{ borderRadius: 10, backgroundColor: BRAND, color: "#fff", fontSize: 16, fontWeight: 700 }}>{(member.name || "?").slice(0, 1)}</div>
              <div className="min-w-0 flex-1"><p style={{ fontSize: 15, fontWeight: 600, color: INK }}>{member.passName || "이용권 미등록"}</p><p className="mt-0.5 truncate" style={{ fontSize: 11, color: SUB }}>{next ? `다음 예약 ${md(next.date)} ${next.start}` : "다음 예약 없음"}</p></div>
              <div className="text-right"><p className="tabular-nums" style={{ fontSize: 22, lineHeight: 1, fontWeight: 600, color: left(member) <= 3 ? BAD : BRAND }}>{left(member)}<span style={{ fontSize: 11 }}>회</span></p><p style={{ marginTop: 4, fontSize: 10, color: SUB }}>{member.contractEnd ? `${ymd(member.contractEnd)}까지` : "만료일 미설정"}</p></div>
            </div>
          </section>
          <Section title="목표"><p style={{ fontSize: 13, lineHeight: 1.55, color: member.goal ? INK2 : SUB }}>{member.goal || "등록된 목표가 없습니다"}</p></Section>
          <Section title="주의사항"><div className="flex flex-wrap gap-1">{(member.focus || []).length ? member.focus.map((x) => <span key={x} style={{ padding: "4px 8px", borderRadius: 6, backgroundColor: WARN_S, color: WARN, fontSize: 11, fontWeight: 600 }}>{x}</span>) : <p style={{ fontSize: 12, color: SUB }}>등록된 주의사항이 없습니다</p>}</div></Section>
          <Section title="최근 기록" action={<button type="button" onClick={() => { setMemo(""); setSheet("record"); }} style={{ fontSize: 12, fontWeight: 600, color: BRAND }}>기록하기</button>}>
            {notes.length ? notes.slice(0, 3).map((n) => <div key={n.id} style={{ padding: "8px 0", borderTop: `1px solid ${LINE}` }}><p style={{ fontSize: 11, color: SUB }}>{ymd(n.date)} · {n.type || "기록"}</p><p className="mt-1 line-clamp-2" style={{ fontSize: 13, lineHeight: 1.45, color: INK2 }}>{n.body}</p></div>) : <p style={{ fontSize: 12, color: SUB }}>아직 기록이 없습니다</p>}
          </Section>
          <Section title="수업 이력">
            {lessons.length ? lessons.slice(0, 5).map((s) => { const a = attOf(s, member.id); return <div key={s.id} className="flex items-center gap-2" style={{ padding: "7px 0", borderTop: `1px solid ${LINE}` }}><span className="tabular-nums" style={{ fontSize: 11, color: SUB }}>{ymd(s.date)} {s.start}</span><span className="min-w-0 flex-1 truncate" style={{ fontSize: 12, color: INK2 }}>{s.type}</span><span style={{ fontSize: 11, fontWeight: 600, color: stOf(a?.status).color }}>{stOf(a?.status).label}</span></div>; }) : <p style={{ fontSize: 12, color: SUB }}>수업 이력이 없습니다</p>}
          </Section>
          <Section title="체형분석 이력" action={<button type="button" onClick={onAssess} style={{ fontSize: 12, fontWeight: 600, color: BRAND }}>새 분석</button>}>
            {assessments.length ? assessments.slice(0, 3).map((a) => <button type="button" key={a.id} onClick={onAssess} className="flex w-full items-center gap-2 text-left" style={{ padding: "8px 0", borderTop: `1px solid ${LINE}` }}><Activity size={14} style={{ color: BRAND }} /><span className="min-w-0 flex-1 truncate" style={{ fontSize: 12, color: INK2 }}>{ymd(a.date)} · {a.view === "front" ? "전면" : a.view === "side" ? "측면" : "후면"}</span><ChevronRight size={13} style={{ color: SUB }} /></button>) : <p style={{ fontSize: 12, color: SUB }}>저장된 분석이 없습니다</p>}
          </Section>
          <Section title="상담 메모" action={<button type="button" onClick={() => { setMemo(""); setSheet("memo"); }} style={{ fontSize: 12, fontWeight: 600, color: BRAND }}>메모 추가</button>}>
            {notes.filter((n) => n.type === "상담").slice(0, 3).map((n) => <p key={n.id} style={{ padding: "7px 0", borderTop: `1px solid ${LINE}`, fontSize: 12, lineHeight: 1.5, color: INK2 }}>{n.body}</p>)}
            {!notes.some((n) => n.type === "상담") && <p style={{ fontSize: 12, color: SUB }}>등록된 상담 메모가 없습니다</p>}
          </Section>
          <Section title="이용권 변경 이력" action={<button type="button" onClick={() => { setPass({ name: member.passName || "", count: "", end: member.contractEnd || "" }); setSheet("membership"); }} style={{ fontSize: 12, fontWeight: 600, color: BRAND }}>이용권 변경</button>}>
            {(member.payments || []).length ? member.payments.slice(0, 4).map((p) => <div key={p.id || `${p.date}-${p.amount}`} className="flex items-center gap-2" style={{ padding: "7px 0", borderTop: `1px solid ${LINE}` }}><span className="min-w-0 flex-1 truncate" style={{ fontSize: 12, color: INK2 }}>{ymd(p.date)} · {p.name || p.passName || "이용권"}</span><span className="tabular-nums" style={{ fontSize: 12, fontWeight: 600, color: INK }}>{num(p.count || p.sessions)}회</span></div>) : <p style={{ fontSize: 12, color: SUB }}>저장된 변경 이력이 없습니다</p>}
            {holdHistory.slice(0, 4).map((h) => <div key={h.id} className="flex items-center gap-2" style={{ padding: "7px 0", borderTop: `1px solid ${LINE}`, backgroundColor: CANVAS }}><span style={{ padding: "2px 6px", borderRadius: 5, color: INK2, fontSize: 10, fontWeight: 600 }}>홀딩</span><span className="min-w-0 flex-1 truncate" style={{ fontSize: 11, color: INK2 }}>{ymd(h.startDate)} ~ {ymd(h.releasedAt || h.endDate)}{h.extendDays ? ` · 만료 +${h.extendDays}일` : ""}</span></div>)}
          </Section>
          <Section title="회원 기본정보">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">{[["이름", member.name || "-"], ["연락처", member.phone || "-"], ["수업 유형", member.lessonType === "duet" ? "듀엣" : member.lessonType === "group" ? "그룹" : "개인"], ["상태", isHold(member) ? "홀딩" : isEnded(member) ? "종료" : "활성"]].map(([k,v]) => <div key={k}><p style={{ fontSize: 10, color: SUB }}>{k}</p><p className="truncate" style={{ marginTop: 2, fontSize: 12, color: INK }}>{v}</p></div>)}</div>
            {isHold(member) && <div className="mt-2 flex items-start gap-2" style={{ padding: "9px 10px", borderRadius: 8, backgroundColor: CANVAS }}><AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: SUB }} /><p style={{ fontSize: 11, lineHeight: 1.5, color: INK2 }}>{ymd(member.holdFrom)} ~ {ymd(member.holdUntil)}{member.holdReason ? ` · ${member.holdReason}` : ""}</p></div>}
            <div className="mt-2 flex gap-2"><button type="button" onClick={openEdit} style={{ flex: 1, height: 42, borderRadius: 8, border: `1px solid ${LINE}`, color: INK2, fontSize: 12, fontWeight: 600 }}>정보 수정</button>{isHold(member) ? <button type="button" onClick={() => { if (!releaseArmed) { setReleaseArmed(true); return; } const releasedAt = todayISO(); onPatch({ status: "active", holdFrom: "", holdUntil: "", holdReason: "", holdHistory: [{ id: uid(), startDate: member.holdFrom, endDate: member.holdUntil, releasedAt, reason: member.holdReason, extendDays: num(member.holdExtendDays), createdAt: releasedAt }, ...holdHistory] }); setReleaseArmed(false); }} style={{ flex: 1.35, height: 42, borderRadius: 8, border: `1px solid ${releaseArmed ? BRAND : LINE}`, backgroundColor: releaseArmed ? TINT : CARD, color: BRAND_D, fontSize: 12, fontWeight: 600 }}>{releaseArmed ? "한 번 더 눌러 홀딩 해제" : "홀딩 해제"}</button> : <button type="button" onClick={() => { setHold({ start: todayISO(), end: shift(todayISO(), 14), reason: "", extend: true }); setSheet("hold"); }} style={{ flex: 1, height: 42, borderRadius: 8, border: `1px solid ${LINE}`, color: BRAND_D, fontSize: 12, fontWeight: 600 }}>홀딩 설정</button>}</div>
          </Section>
        </div>
      </main>
      <div className="absolute bottom-0 left-0 right-0 grid grid-cols-4" style={{ height: 58, padding: "6px 10px", backgroundColor: CARD, borderTop: `1px solid ${LINE}` }}>
        {[{ l: "일정", I: CalendarDays, fn: onSchedule }, { l: "기록", I: Pencil, fn: () => { setMemo(""); setSheet("record"); } }, { l: "체형분석", I: Activity, fn: onAssess }, { l: "메모", I: MessageSquare, fn: () => { setMemo(""); setSheet("memo"); } }].map(({ l, I, fn }) => <button type="button" key={l} onClick={fn} className="flex flex-col items-center justify-center gap-0.5" style={{ color: BRAND, fontSize: 10, fontWeight: 600 }}><I size={17} />{l}</button>)}
      </div>
      {sheet === "edit" && <Sheet title="회원 정보 수정" onClose={() => setSheet(null)} wide><div className="space-y-3">
        <Field label="이름"><input value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputCls} /></Field><Field label="연락처"><input value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} className={inputCls} /></Field><Field label="생년월일"><input type="date" value={edit.birth || ""} onChange={(e) => setEdit({ ...edit, birth: e.target.value })} className={inputCls} /></Field><Field label="목표"><textarea rows={3} value={edit.goal || ""} onChange={(e) => setEdit({ ...edit, goal: e.target.value })} className={`${inputCls} h-auto py-3`} /></Field><Field label="주의사항" hint="쉼표로 구분"><input value={edit.focus || ""} onChange={(e) => setEdit({ ...edit, focus: e.target.value })} className={inputCls} /></Field>
        <button type="button" disabled={!String(edit.name || "").trim()} onClick={() => { onPatch({ ...edit, name: edit.name.trim(), focus: String(edit.focus || "").split(",").map((x) => x.trim()).filter(Boolean) }); setSheet(null); }} className="w-full text-sm font-semibold text-white disabled:opacity-40" style={{ height: 48, borderRadius: 8, backgroundColor: BRAND }}>저장</button>
      </div></Sheet>}
      {sheet === "hold" && <Sheet title="홀딩 설정" sub={`${member.name} · 수업 기록과 분석 이력은 유지됩니다`} onClose={() => setSheet(null)}><div className="space-y-3">
        <div className="grid grid-cols-2 gap-2"><Field label="홀딩 시작일"><input type="date" value={hold.start} onChange={(e) => setHold({ ...hold, start: e.target.value })} className={inputCls} /></Field><Field label="종료 예정일"><input type="date" value={hold.end} onChange={(e) => setHold({ ...hold, end: e.target.value })} className={inputCls} /></Field></div>
        <Field label="홀딩 사유"><input value={hold.reason} onChange={(e) => setHold({ ...hold, reason: e.target.value })} placeholder="예: 개인 사정 · 부상 · 여행" className={inputCls} /></Field>
        <button type="button" onClick={() => setHold({ ...hold, extend: !hold.extend })} className="flex w-full items-center justify-between" style={{ height: 42, padding: "0 12px", borderRadius: 8, border: `1px solid ${hold.extend ? BRAND : LINE}`, backgroundColor: hold.extend ? TINT : CARD, color: hold.extend ? BRAND_D : INK2, fontSize: 12, fontWeight: 600 }}><span>이용권 만료일 연장</span><span>{hold.extend ? "연장" : "연장 안 함"}</span></button>
        <p style={{ fontSize: 11, lineHeight: 1.5, color: SUB }}>홀딩은 예정된 수업을 자동 취소하지 않습니다. 일정 탭에서 직접 확인해 주세요.</p>
        <button type="button" disabled={!hold.start || !hold.end || hold.end < hold.start} onClick={() => { const days = Math.max(0, Math.round((new Date(`${hold.end}T00:00:00`).getTime() - new Date(`${hold.start}T00:00:00`).getTime()) / 86400000)); onPatch({ status: "hold", holdFrom: hold.start, holdUntil: hold.end, holdReason: hold.reason.trim(), holdExtendDays: hold.extend ? days : 0, contractEnd: hold.extend && member.contractEnd ? shift(member.contractEnd, days) : member.contractEnd }); setSheet(null); }} className="w-full text-sm font-semibold text-white disabled:opacity-40" style={{ height: 48, borderRadius: 8, backgroundColor: BRAND }}>홀딩 시작</button>
      </div></Sheet>}
      {(sheet === "memo" || sheet === "record") && <Sheet title={sheet === "memo" ? "상담 메모" : "수업 기록"} onClose={() => setSheet(null)}><div className="space-y-2">{sheet === "record" && <VoiceNote onApply={(text) => setMemo((v) => v ? `${v}\n${text}` : text)} />}<textarea autoFocus rows={5} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="내용을 입력하세요" className={`${inputCls} h-auto resize-none py-3`} /><button type="button" disabled={!memo.trim()} onClick={() => { onSaveNote(sheet === "memo" ? "상담" : "개인레슨", memo.trim()); setSheet(null); }} className="w-full text-sm font-semibold text-white disabled:opacity-40" style={{ height: 48, borderRadius: 8, backgroundColor: BRAND }}>저장</button></div></Sheet>}
      {sheet === "membership" && <Sheet title="이용권 변경" onClose={() => setSheet(null)}><div className="space-y-3"><Field label="이용권 이름"><input value={pass.name} onChange={(e) => setPass({ ...pass, name: e.target.value })} className={inputCls} /></Field><div className="grid grid-cols-2 gap-2"><Field label="추가 횟수"><input inputMode="numeric" value={pass.count} onChange={(e) => setPass({ ...pass, count: e.target.value.replace(/\D/g, "") })} className={inputCls} /></Field><Field label="만료일"><input type="date" value={pass.end} onChange={(e) => setPass({ ...pass, end: e.target.value })} className={inputCls} /></Field></div><button type="button" disabled={!num(pass.count)} onClick={() => { const count = num(pass.count); onPatch({ passName: pass.name, regular: num(member.regular) + count, total: num(member.total) + count, contractEnd: pass.end, payments: [{ id: uid(), date: todayISO(), name: pass.name, count }, ...(member.payments || [])] }); setSheet(null); }} className="w-full text-sm font-semibold text-white disabled:opacity-40" style={{ height: 48, borderRadius: 8, backgroundColor: BRAND }}>변경 저장</button></div></Sheet>}
    </div>
  );
}

function ChangeSummary({ member, onGo }) {
  const rec = inbodyOf(member);
  const n = rec.length;
  if (n === 0)
    return (
      <button onClick={onGo} className="w-full rounded-2xl p-4 text-left" style={{ background: GRAD }}>
        <p className="text-sm font-extrabold text-white">첫 인바디 측정값을 입력해 주세요</p>
        <p className="mt-1 text-xs text-white opacity-70">기록 탭 → 인바디에서 등록하면 여기에 변화가 표시됩니다</p>
      </button>
    );
  const first = rec[0], last = rec[n - 1];
  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: BRAND }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-white opacity-70">{ymd(first.date)} → {ymd(last.date)}</p>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-extrabold" style={{ color: PRIMARY }}>{n === 1 ? "첫 측정" : `${weeksBetween(first.date, last.date)}주 변화`}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {Object.values(METRICS).map((m) => {
          const diff = +(last[m.key] - first[m.key]).toFixed(1);
          const t = toneOf(m.key, diff);
          const c = t === "good" ? GOOD : t === "bad" ? BAD : LINE;
          return (
            <div key={m.key} className="rounded-xl p-3" style={{ backgroundColor: "rgba(255,255,255,0.12)" }}>
              <p className="text-xs font-bold text-white opacity-80">{m.label}</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">{last[m.key]}<span className="ml-0.5 text-xs opacity-70">{m.unit}</span></p>
              {n > 1 && (
                <>
                  <p className="mt-1 text-xs font-extrabold tabular-nums" style={{ color: c }}>{diff > 0 ? "▲" : diff < 0 ? "▼" : "－"} {Math.abs(diff).toFixed(1)}{uLabel(m.key)}</p>
                  <p className="text-xs text-white opacity-50">시작 {first[m.key]}</p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl bg-white px-3 py-2" style={{ boxShadow: SHADOW }}>
      <p className="mb-1 text-xs" style={{ color: SUB }}>{label}</p>
      {payload.map((p) => <p key={p.dataKey} className="text-xs font-bold tabular-nums" style={{ color: p.color }}>{METRICS[p.dataKey]?.label} {p.value}{METRICS[p.dataKey]?.unit}</p>)}
    </div>
  );
}
function InbodyChart({ member }) {
  const [on, setOn] = useState({ weight: true, smm: true, fat: true });
  const data = useMemo(() => inbodyOf(member).map((r) => ({ ...r, label: md(r.date) })), [member.inbody]);
  if (data.length < 2) return <Card className="p-5"><h3 className="font-extrabold" style={{ color: INK }}>인바디 변화 추이</h3><Sub className="mt-1">측정값이 2회 이상 쌓이면 그래프가 그려집니다. (현재 {data.length}회)</Sub></Card>;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-extrabold" style={{ color: INK }}>인바디 변화 추이</h3><Sub>{data.length}회 측정</Sub></div>
        <div className="flex gap-1.5">
          {Object.values(METRICS).map((m) => (
            <button key={m.key} onClick={() => setOn((s) => ({ ...s, [m.key]: !s[m.key] }))} className="rounded-full px-3 py-1.5 text-xs font-bold"
              style={on[m.key] ? { backgroundColor: m.color, color: "#fff" } : { backgroundColor: CANVAS, color: SUB }}>{m.label}</button>
          ))}
        </div>
      </div>
      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid stroke={LINE} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: SUB }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="kg" domain={["auto", "auto"]} tick={{ fontSize: 11, fill: SUB }} axisLine={false} tickLine={false} width={44} />
            <YAxis yAxisId="pct" orientation="right" domain={["auto", "auto"]} tick={{ fontSize: 11, fill: SUB }} axisLine={false} tickLine={false} width={36} />
            <Tooltip content={<ChartTooltip />} />
            {!!member.goalWeight && on.weight && (
              <ReferenceLine yAxisId="kg" y={num(member.goalWeight)} stroke={PRIMARY} strokeDasharray="4 4" strokeOpacity={0.45}
                label={{ value: `목표 ${num(member.goalWeight)}kg`, position: "insideTopLeft", fontSize: 10, fill: PRIMARY }} />
            )}
            {on.weight && <Line yAxisId="kg" type="monotone" dataKey="weight" stroke={PRIMARY} strokeWidth={2.5} dot={{ r: 3, fill: CARD, strokeWidth: 2 }} />}
            {on.smm && <Line yAxisId="kg" type="monotone" dataKey="smm" stroke={GOOD} strokeWidth={2.5} dot={{ r: 3, fill: CARD, strokeWidth: 2 }} />}
            {on.fat && <Line yAxisId="pct" type="monotone" dataKey="fat" stroke={BAD} strokeWidth={2.5} dot={{ r: 3, fill: CARD, strokeWidth: 2 }} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4">
        <Sub>왼쪽 축 kg · 오른쪽 축 %</Sub>
        <span className="text-xs font-bold" style={{ color: GOOD }}>● 근육 ↑ 좋음</span>
        <span className="text-xs font-bold" style={{ color: BAD }}>● 체중 · 지방 ↑ 주의</span>
      </div>
    </Card>
  );
}
function AlignSheet({ src, ghost, init, title, onSave, onCancel, ghostEditable, mainName, ghostName }) {
  const [which, setWhich] = useState("main");
  const [m, setM] = useState({ x: num(init?.x) || 0, y: num(init?.y) || 0, scale: num(init?.scale) || 1, rot: num(init?.rot) || 0 });
  const [g, setG] = useState({ x: num(ghost?.x) || 0, y: num(ghost?.y) || 0, scale: num(ghost?.scale) || 1, rot: num(ghost?.rot) || 0 });
  const [op, setOp] = useState(0);
  useBackClose(true, onCancel);
  useScrollLock();
  const twoWay = !!(ghost && ghostEditable);
  const onGhost = twoWay && which === "ghost";
  /* 상대 사진을 실제로 건드렸을 때만 같이 저장한다 */
  const gDirty = twoWay && (g.x !== (num(ghost?.x) || 0) || g.y !== (num(ghost?.y) || 0)
    || g.scale !== (num(ghost?.scale) || 1) || g.rot !== (num(ghost?.rot) || 0));
  /* 사진 원본 비율이 3:4 가 아니면 저장 프레임에서 잘린다 — 얼마나 줄여야 다 들어오는지 계산 */
  const [nat, setNat] = useState(null);
  const FR = 3 / 4;
  const fitScale = nat && nat.w && nat.h
    ? Math.min(FR / nat.w, 1 / nat.h) / Math.max(FR / nat.w, 1 / nat.h)
    : 1;
  const offRatio = nat && nat.w && nat.h ? Math.abs(nat.w / nat.h - FR) > 0.02 : false;
  const marked = (init?.marks?.length || 0) + (onGhost ? (ghost?.marks?.length || 0) : 0);
  const cur = onGhost ? g : m;
  const setCur = (p) => (onGhost ? setG((v) => ({ ...v, ...p })) : setM((v) => ({ ...v, ...p })));
  const rows = [
    { k: "x", l: "좌 · 우", min: -40, max: 40, step: 1 },
    { k: "y", l: "위 · 아래", min: -40, max: 40, step: 1 },
    { k: "scale", l: "확대", min: 0.35, max: 2, step: 0.02 },
    { k: "rot", l: "기울기", min: -20, max: 20, step: 0.5 },
  ];
  return (
    <div className="safe-all fixed inset-0 z-50 flex flex-col bg-photo" style={{ overscrollBehavior: "contain", touchAction: "none" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onCancel} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
        <p className="text-sm font-bold text-white">{title || "중심선 맞추기"}</p>
        <button onClick={() => onSave(m, gDirty ? g : null)} className="rounded-full px-4 py-2 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}>저장</button>
      </div>
      {twoWay && (
        <div className="mx-4 mb-1 flex gap-1 rounded-2xl p-1" style={{ backgroundColor: "rgba(255,255,255,0.12)" }}>
          {[{ k: "ghost", l: ghostName || "비포" }, { k: "main", l: mainName || "애프터" }].map((o) => (
            <button key={o.k} onClick={() => setWhich(o.k)} className="flex-1 rounded-xl py-2 text-xs font-extrabold"
              style={which === o.k ? { backgroundColor: BRAND, color: "#fff" } : { color: "rgba(255,255,255,0.7)" }}>{o.l} 맞추기</button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="relative overflow-hidden rounded-2xl bg-photo" style={{ aspectRatio: "3 / 4", maxHeight: "100%", maxWidth: "min(100%, 540px)", width: "100%" }}>
          <img src={src} alt="촬영본" onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: ptf(m), opacity: onGhost ? 0.45 : 1 }} />
          {ghost && <img src={ghost.src} alt="이전" className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: onGhost ? 1 : op / 100, transform: ptf(twoWay ? g : ghost) }} />}
          <GuideOverlay strong />
        </div>
      </div>
      <div className="space-y-2 px-4 pb-6 pt-3">
        {twoWay && <p className="text-center text-xs font-bold text-white opacity-60">지금 {onGhost ? (ghostName || "비포") : (mainName || "애프터")} 사진을 맞추는 중입니다</p>}
        {marked > 0 && <p className="text-center text-xs font-bold" style={{ color: WARN }}>이 사진에 분석선 {marked}개가 있습니다. 위치를 바꾸면 선이 몸에서 어긋납니다.</p>}
        {!onGhost && offRatio && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: "rgba(247,144,9,.22)" }}>
            <AlertTriangle size={14} style={{ color: WARN }} />
            <span className="min-w-0 flex-1 text-xs font-bold text-white">이 사진은 3:4 가 아니라 {nat.w > nat.h * FR ? "좌우가" : "위아래가"} 잘립니다</span>
            <button onClick={() => setCur({ x: 0, y: 0, scale: Math.max(0.35, Math.round(fitScale * 100) / 100) })}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ backgroundColor: "#fff", color: "#17171F" }}>전체 담기</button>
          </div>
        )}
        {rows.map((r) => {
          const n100 = Math.round(((cur[r.k] - r.min) / (r.max - r.min)) * 100);
          return (
            <div key={r.k} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs font-bold text-white opacity-70">{r.l}</span>
              <input type="range" min={r.min} max={r.max} step={r.step} value={cur[r.k]}
                onChange={(e) => setCur({ [r.k]: Number(e.target.value) })} className="min-w-0 flex-1" style={{ accentColor: PRIMARY, touchAction: "none" }} />
              <span className="w-9 shrink-0 rounded-lg py-1 text-center text-xs font-extrabold tabular-nums text-white" style={{ backgroundColor: "rgba(255,255,255,0.16)" }}>{n100}</span>
              <button onClick={() => setCur({ [r.k]: r.k === "scale" ? 1 : 0 })} className="w-8 shrink-0 rounded-lg py-1 text-center text-xs font-bold text-white" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>↺</button>
            </div>
          );
        })}
        <p className="text-center text-xs text-white opacity-50">숫자는 0~100 · 좌우·위아래·기울기는 50이 가운데입니다</p>
        {ghost && !onGhost && (
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs font-bold text-white opacity-70">이전 사진</span>
            <input type="range" min="0" max="80" value={op} onChange={(e) => setOp(Number(e.target.value))} className="w-full" style={{ accentColor: PRIMARY, touchAction: "none" }} />
          </div>
        )}
      </div>
    </div>
  );
}
/* 사진 위에 저장된 분석선을 그대로 얹는다 (캔버스와 같은 3:4 기준) */
const MK_W = 300, MK_H = 400;
/* iOS 에서 사진을 길게 눌렀을 때 뜨는 '사진 저장/공유' 팝업을 막는다 */
const NOPRESS = { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" };
const IMGP = { draggable: false, onContextMenu: (e) => e.preventDefault() };
function MarkLayer({ marks, hideLabel }) {
  const list = Array.isArray(marks) ? marks.filter((m) => m && Array.isArray(m.pts) && m.pts.length) : [];
  if (!list.length) return null;
  return (
    <svg viewBox={`0 0 ${MK_W} ${MK_H}`} className="pointer-events-none absolute inset-0 h-full w-full">
      {list.map((m, i) => {
        const P = (p) => ({ x: p.x * MK_W, y: p.y * MK_H });
        const w = Math.max(0.8, (m.width || 3) * 0.5);
        if (m.tool === "hline") { const y = m.pts[0].y * MK_H; return <line key={i} x1="0" y1={y} x2={MK_W} y2={y} stroke={m.color} strokeWidth={w} />; }
        if (m.tool === "vline") { const x = m.pts[0].x * MK_W; return <line key={i} x1={x} y1="0" x2={x} y2={MK_H} stroke={m.color} strokeWidth={w} />; }
        if (m.tool === "point") { const q = P(m.pts[0]); return <circle key={i} cx={q.x} cy={q.y} r={w + 1.5} fill={m.color} />; }
        const pts = m.pts.map(P);
        const d = pts.map((q, j) => `${j ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(" ");
        const a = pts[0], b = pts[pts.length - 1];
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 - 9;
        const lab = m.tool === "angle" && m.label && !hideLabel ? String(m.label) : "";
        const tw = lab.length * 5.2 + 9;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={m.color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
            {m.tool === "angle" && pts.length === 2 && pts.map((q, j) => <circle key={j} cx={q.x} cy={q.y} r={w + 1.2} fill={m.color} />)}
            {lab && (
              <g>
                <rect x={cx - tw / 2} y={cy - 7.5} width={tw} height={12} rx="4" fill="rgba(10,10,16,0.82)" stroke="rgba(255,255,255,0.55)" strokeWidth="0.6" />
                <text x={cx} y={cy + 1.2} textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">{lab}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Shot({ p, label, guides }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-photo" style={{ aspectRatio: "3 / 4" }}>
      <img {...IMGP} src={p.src} alt={label} className="absolute inset-0 h-full w-full object-cover" style={{ transform: ptf(p), ...NOPRESS }} />
      <MarkLayer marks={p.marks} hideLabel />
      {guides && <GuideOverlay />}
      <span className="absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-xs text-white" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>{ymd(p.date)}</span>
      {p.marks?.length > 0 && <span className="absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: BRAND }}>분석 {p.marks.length}</span>}
    </div>
  );
}
function EmptyShot({ slot, label, onCam, onAlbum }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl" style={{ aspectRatio: "3 / 4", backgroundColor: CANVAS }}>
      <img src="/215736080-dotted-line-in-the-shape-of-a-person copy.jpg" alt="" aria-hidden="true"
        className="w-3/5 max-w-[140px]"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
        style={THEME === "dark" ? { mixBlendMode: "screen", filter: "invert(1)", opacity: 0.45 } : { mixBlendMode: "multiply", opacity: 0.9 }} />
      <button onClick={() => onCam(slot)} className="flex flex-col items-center gap-1">
        <Camera size={22} style={{ color: PRIMARY }} /><span className="text-xs font-bold" style={{ color: PRIMARY }}>{label} 촬영하기</span>
      </button>
      <button onClick={() => onAlbum(slot)} className="text-xs font-bold" style={{ color: SUB }}>불러오기</button>
    </div>
  );
}
function ShotBar({ slot, onCam }) {
  return (
    <button onClick={() => onCam(slot)} className="flex w-full items-center justify-center gap-1 rounded-xl py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>
      <Camera size={13} /> 촬영하기
    </button>
  );
}

function PhotoCompare({ member, photos, briefing, onSavePhoto, onRemove, onSaveMarks, onAdjust, onToast, onSaveSet }) {
  const [view, setView] = useState("front");
  const [mode, setMode] = useState("side");
  const [cmp, setCmp] = useState("curtain");
  const [del, setDel] = useState(null);
  const [flip, setFlip] = useState(false);
  const [t, setT] = useState(50);
  const boxRef = useRef(null);
  const dragRef = useRef(false);
  /* 두 손가락으로 사진 확대 — 한 손가락은 커튼 이동 */
  const [cz, setCz] = useState(1);
  const [cp, setCp] = useState({ x: 0, y: 0 });
  const cPtr = useRef(new Map());
  const cPinch = useRef(null);
  const resetCz = () => { setCz(1); setCp({ x: 0, y: 0 }); };
  const moveCurtain = (e) => {
    const el = boxRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setT(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
  };
  const [guides, setGuides] = useState(true);
  const [pending, setPending] = useState(null);
  const [posture, setPosture] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const camRef = useRef(null), albumRef = useRef(null), slotRef = useRef("after");
  const list = (photos?.[view] || []).filter((p) => p && p.src);
  const before = list[0] || null;
  const after = list.length > 1 ? list[list.length - 1] : null;
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const openPreview = async () => {
    if (!before || !after) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const c = await composeBeforeAfter(before, after, member?.name);
      setPreview({ canvas: c, url: c.toDataURL("image/jpeg", 0.9) });
    } catch (e) { onToast && onToast({ ok: false, msg: "이미지를 만들지 못했습니다." }); }
    setLoading(false);
  };
  const doExport = async (saveOnly) => {
    if (!preview) return;
    const name = `비포애프터_${member?.name || "회원"}_${todayISO()}.jpg`;
    const r = await exportCanvas(preview.canvas, name, "비포 & 애프터", saveOnly);
    if (r.how === "fail") { onToast && onToast({ ok: false, msg: "이미지를 만들지 못했습니다." }); return; }
    if (r.how === "manual") {
      /* 자동 저장이 막힌 환경 — 화면은 그대로 두고 길게 눌러 저장하도록 안내 */
      setPreview((p) => (p ? { ...p, manual: true } : p));
      onToast && onToast({ ok: false, msg: "자동 저장이 막힌 환경입니다. 사진을 길게 눌러 저장해 주세요." });
      return;
    }
    if (r.how === "saved") onToast && onToast({ ok: true, msg: "이미지를 저장했습니다." });
    if (r.how === "gallery") onToast && onToast({ ok: true, msg: "사진 앱(갤러리)에 저장했습니다." });
    if (r.how === "copied") onToast && onToast({ ok: true, msg: "이미지를 복사했습니다. 카톡 등에 붙여넣기 하세요." });
    setPreview(null);
  };
  const pick = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      /* 큰 사진은 줄이는 데 몇 초 걸린다 — 화면을 잠깐 쉬게 해서 로딩 표시가 실제로 그려지게 한다 */
      await new Promise((r) => setTimeout(r, 30));
      const blob = await fileToBlob(file);
      setPending({ blob, src: URL.createObjectURL(blob), slot: slotRef.current });
    } catch (e) { onToast && onToast({ ok: false, msg: "사진을 읽지 못했습니다." }); }
    setLoading(false);
  };
  const closePending = () => setPending((p) => { if (p?.src) { try { URL.revokeObjectURL(p.src); } catch (e) {} } return null; });
  const open = (slot, ref) => { slotRef.current = slot; ref.current?.click(); };
  const onCam = (slot) => open(slot, camRef);
  const onAlbum = (slot) => open(slot, albumRef);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: GRAD }}>
            <Camera size={16} color="#fff" />
          </span>
          <div className="min-w-0">
            <h3 className="font-extrabold" style={{ color: INK }}>비포애프터 분석</h3>
            <Sub>중심선 정렬 · 회원 동의 후 촬영, 이 기기에만 저장</Sub>
          </div>
        </div>
        <div className="flex gap-1 rounded-full p-1" style={{ backgroundColor: CANVAS }}>
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)} className="rounded-full px-3 py-1.5 text-xs font-bold"
              style={view === v.key ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{v.label}</button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
        {[{ k: "side", l: "나란히 보기" }, { k: "overlay", l: "겹쳐 비교" }].map((o) => (
          <button key={o.k} onClick={() => setMode(o.k)} className="flex-1 rounded-xl py-2 text-xs font-bold"
            style={mode === o.k ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{o.l}</button>
        ))}
      </div>
      {mode === "overlay" && (
        <div className="mt-4">
          {before && after ? (
            <>
              <div className="mb-2 flex gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
                {[{ k: "curtain", l: "커튼" }, { k: "flip", l: "꾹 눌러 전환" }].map((o) => (
                  <button key={o.k} onClick={() => setCmp(o.k)} className="flex-1 rounded-xl py-2 text-xs font-extrabold"
                    style={cmp === o.k ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 2px 6px rgba(20,20,43,.18)" } : { color: INK2 }}>{o.l}</button>
                ))}
              </div>
              <div ref={boxRef} className="relative overflow-hidden rounded-2xl bg-photo" style={{ aspectRatio: "3 / 4", ...NOPRESS }}>
                <div className="absolute inset-0" style={{ transform: `translate(${cp.x}px, ${cp.y}px) scale(${cz})`, transformOrigin: "center center" }}>
                {cmp === "flip" ? (
                  <>
                    <img {...IMGP} src={(flip ? after : before).src} alt={flip ? "애프터" : "비포"} className="absolute inset-0 h-full w-full object-cover" style={{ transform: ptf(flip ? after : before) }} />
                    <MarkLayer marks={(flip ? after : before).marks} hideLabel />
                  </>
                ) : (
                  <>
                    <img {...IMGP} src={before.src} alt="비포" className="absolute inset-0 h-full w-full object-cover" style={{ transform: ptf(before) }} />
                    <MarkLayer marks={before.marks} hideLabel />
                    <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${t}%)` }}>
                      <img {...IMGP} src={after.src} alt="애프터" className="absolute inset-0 h-full w-full object-cover" style={{ transform: ptf(after) }} />
                      <MarkLayer marks={after.marks} hideLabel />
                    </div>
                    <div className="pointer-events-none absolute inset-y-0" style={{ left: `${t}%`, width: 2, backgroundColor: "#fff", boxShadow: "0 0 8px rgba(0,0,0,.6)" }} />
                  </>
                )}
                </div>
                {guides && <GuideOverlay />}
                {/* 손가락을 받는 전용 레이어 — 사진 위에서 길게 눌러도 iOS 저장 팝업이 안 뜬다 */}
                <div className="absolute inset-0 z-10" style={{ touchAction: "none", ...NOPRESS }}
                  onContextMenu={(e) => e.preventDefault()}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    cPtr.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    if (cPtr.current.size === 2) {
                      const [a, b] = [...cPtr.current.values()];
                      dragRef.current = false; setFlip(false);
                      cPinch.current = { d0: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z0: cz, px: cp.x, py: cp.y };
                      return;
                    }
                    if (cPtr.current.size > 1) return;
                    if (cmp === "flip") setFlip(true);
                    else { dragRef.current = true; moveCurtain(e); }
                  }}
                  onPointerMove={(e) => {
                    if (cPtr.current.has(e.pointerId)) cPtr.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    if (cPinch.current && cPtr.current.size >= 2) {
                      e.preventDefault();
                      const [a, b] = [...cPtr.current.values()];
                      const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
                      const g = cPinch.current;
                      setCz(Math.min(5, Math.max(1, g.z0 * (d / g.d0))));
                      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                      setCp({ x: g.px + (mx - g.mx), y: g.py + (my - g.my) });
                      return;
                    }
                    if (cPtr.current.size > 1) return;
                    if (cmp === "curtain" && dragRef.current) { e.preventDefault(); moveCurtain(e); }
                  }}
                  onPointerUp={(e) => {
                    if (e && e.pointerId != null) cPtr.current.delete(e.pointerId);
                    if (cPtr.current.size < 2) cPinch.current = null;
                    if (cz <= 1.02 && (cp.x !== 0 || cp.y !== 0)) setCp({ x: 0, y: 0 });
                    if (cPtr.current.size >= 1) return;
                    setFlip(false); dragRef.current = false;
                  }}
                  onPointerCancel={() => { cPtr.current.clear(); cPinch.current = null; setFlip(false); dragRef.current = false; }} />
                {cz > 1.02 && (
                  <button onClick={resetCz} className="absolute right-2 top-2 z-20 rounded-full px-3 py-1.5 text-xs font-extrabold"
                    style={{ backgroundColor: "rgba(255,255,255,.92)", color: "#17171F" }}>{cz.toFixed(1)}× · 원래대로</button>
                )}
                <span className="pointer-events-none absolute left-3 top-3 z-20 rounded-full px-2.5 py-1 text-xs font-extrabold text-white" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
                  {cmp === "flip" ? (flip ? `AFTER ${ymd(after.date)}` : `BEFORE ${ymd(before.date)}`) : `BEFORE ${ymd(before.date)}`}
                </span>
                {cmp === "curtain" && (
                  <span className="pointer-events-none absolute right-3 top-3 z-20 rounded-full px-2.5 py-1 text-xs font-extrabold text-white" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>AFTER {ymd(after.date)}</span>
                )}
              </div>
              <input type="range" min="0" max="100" value={t} onChange={(e) => setT(Number(e.target.value))}
                className={`mt-2 w-full ${cmp === "curtain" ? "" : "hidden"}`} style={{ accentColor: PRIMARY }} aria-label="커튼 위치" />
              <p className="mt-1 text-center text-xs font-semibold" style={{ color: SUB }}>
                {cmp === "curtain" ? "사진을 좌우로 밀거나 아래 막대로 옮기세요 · 두 손가락으로 확대됩니다"
                  : "사진을 꾹 누르면 애프터, 손을 떼면 비포 · 달라진 부분이 움직임으로 보입니다"}
              </p>
            </>
          ) : (
            <div className="flex gap-3">
              {before ? <div className="min-w-0 flex-1"><Shot p={before} label="비포" guides={guides} /></div> : <EmptyShot slot="before" label="비포" onCam={onCam} onAlbum={onAlbum} />}
              {after ? <div className="min-w-0 flex-1"><Shot p={after} label="애프터" guides={guides} /></div> : <EmptyShot slot="after" label="애프터" onCam={onCam} onAlbum={onAlbum} />}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => setGuides((g) => !g)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: guides ? TINT : CANVAS, color: guides ? PRIMARY : SUB }}>중심선 {guides ? "켜짐" : "꺼짐"}</button>
            {before && <button onClick={() => setPosture({ p: before, label: "BEFORE" })} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: INK }}>비포 분석</button>}
            {after && <button onClick={() => setPosture({ p: after, label: "AFTER" })} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>애프터 분석</button>}
            {before && !briefing && (
              <button onClick={() => setDel({ id: before.id, label: "비포" })} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}><Trash2 size={12} /> 비포 삭제</button>
            )}
            {after && !briefing && (
              <button onClick={() => setDel({ id: after.id, label: "애프터" })} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}><Trash2 size={12} /> 애프터 삭제</button>
            )}
          </div>
          {del && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: BAD_S }}>
              <AlertTriangle size={14} style={{ color: BAD }} />
              <span className="min-w-0 flex-1 text-xs font-bold" style={{ color: INK }}>{del.label} 사진을 삭제할까요? 되돌릴 수 없습니다.</span>
              <button onClick={() => { onRemove(view, del.id); setDel(null); }} className="rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>삭제</button>
              <button onClick={() => setDel(null)} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold" style={{ color: SUB }}>취소</button>
            </div>
          )}
          {before && after && <Sub className="mt-1.5">보낸 이미지는 회수할 수 없습니다. 회원 본인에게만 보내 주세요.</Sub>}
          {!briefing && (
            <div className="mt-2 space-y-1.5">
              {before && after && <ShotBar slot="after" onCam={onCam} />}
              {(before || after) && (
                <div className="flex gap-1.5">
                  {before && <button onClick={() => setAdjust({ p: before, label: "비포" })} className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}><SlidersHorizontal size={12} /> 비포 사진 조정</button>}
                  {after && <button onClick={() => setAdjust({ p: after, label: "애프터" })} className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}><SlidersHorizontal size={12} /> 애프터 사진 조정</button>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {mode === "side" && (
        <div className="mt-4 flex gap-3">
          {[{ p: before, label: "BEFORE", slot: "before" }, { p: after, label: "AFTER", slot: "after" }].map((s) => (
            <div key={s.slot} className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-extrabold" style={{ color: s.slot === "after" ? PRIMARY : SUB }}>{s.label}</span>
                {s.p && !briefing && <button onClick={() => onRemove(view, s.p.id)} aria-label="사진 삭제" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ color: SUB, backgroundColor: CANVAS }}><Trash2 size={13} /></button>}
              </div>
              {s.p ? (
                <>
                  <Shot p={s.p} label={s.label} guides={guides} />
                  <button onClick={() => setPosture({ p: s.p, label: s.label })} className="mt-2 w-full rounded-xl py-2 text-xs font-bold" style={{ backgroundColor: CANVAS, color: PRIMARY }}>체형 분석</button>
                  {!briefing && (
                    <button onClick={() => setAdjust({ p: s.p, label: s.label === "BEFORE" ? "비포" : "애프터" })} className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
                      <SlidersHorizontal size={12} /> 사진 조정
                    </button>
                  )}
                </>
              ) : <EmptyShot slot={s.slot} label={s.label === "BEFORE" ? "비포" : "애프터"} onCam={onCam} onAlbum={onAlbum} />}
              {!briefing && s.p && <div className="mt-1.5"><ShotBar slot={s.slot} onCam={onCam} /></div>}
            </div>
          ))}
        </div>
      )}
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pick(f); }} />
      <input ref={albumRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pick(f); }} />
      {before && after && (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {!briefing && (
            <button onClick={() => onSaveSet && onSaveSet(view, before.id, after.id)}
              className="flex flex-col items-center justify-center gap-1 rounded-2xl py-2.5 text-xs font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>
              <Star size={15} /> 모음에 저장
            </button>
          )}
          <button onClick={() => openPreview()}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl py-2.5 text-xs font-extrabold" style={{ backgroundColor: CANVAS, color: INK, border: `1px solid ${LINE}` }}>
            <Download size={15} /> 내 폰에 저장
          </button>
          <button onClick={() => openPreview()}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl py-2.5 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>
            <Upload size={15} /> 회원에게 보내기
          </button>
        </div>
      )}
      {before && after && <Sub className="mt-1.5 block">누르면 만들어질 이미지를 먼저 보여 드립니다</Sub>}

      {preview && (
        <div className="safe-all fixed inset-0 z-50 flex flex-col bg-photo">
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={() => setPreview(null)} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
            <p className="text-sm font-bold text-white">이렇게 저장됩니다</p>
            <span style={{ width: 34 }} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
            <img src={preview.url} alt="미리보기" className="block h-auto rounded-2xl"
              style={{ maxWidth: "min(100%, 760px)", maxHeight: "68%", width: "auto", objectFit: "contain" }} />
            <p className="mt-3 text-center text-xs" style={{ color: "rgba(255,255,255,.7)", maxWidth: 760 }}>
              {preview.manual
                ? "위 사진을 2초간 길게 누르면 '이미지 저장' 이 뜹니다 · 안 뜨면 설정 탭 맨 아래 안내를 봐 주세요"
                : "사진을 길게 눌러도 저장됩니다 · 마음에 안 들면 닫고 사진 조정에서 고치세요"}
            </p>
          </div>
          <div className="flex gap-2 px-4 pb-5 pt-3">
            <button onClick={() => doExport(true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3.5 text-sm font-extrabold" style={{ backgroundColor: "rgba(255,255,255,0.92)", color: "#17171F" }}>
              <Download size={16} /> 내 폰에 저장
            </button>
            <button onClick={() => doExport(false)} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3.5 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}>
              <Upload size={16} /> 회원에게 보내기
            </button>
          </div>
        </div>
      )}
      {loading && (
        <div className="safe-all fixed inset-0 z-50 flex items-center justify-center px-6" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
          <div className="flex max-w-full flex-col items-center gap-3 rounded-3xl px-8 py-7" style={{ backgroundColor: CARD }}>
            <Loader2 size={26} className="animate-spin" style={{ color: PRIMARY }} />
            <p className="text-sm font-extrabold" style={{ color: INK }}>사진을 불러오는 중…</p>
            <Sub>큰 사진은 몇 초 걸릴 수 있어요</Sub>
          </div>
        </div>
      )}
      {pending && (() => {
        const gp = pending.slot === "after" ? before : after;
        const isAfter = pending.slot === "after";
        return (
          <AlignSheet src={pending.src} ghost={gp} ghostEditable={!!gp}
            mainName={isAfter ? "애프터" : "비포"} ghostName={isAfter ? "비포" : "애프터"}
            onCancel={closePending}
            onSave={async (tf, gtf) => {
              const shot = await onSavePhoto(view, pending.blob, pending.slot, tf, gp && gtf ? gp.id : null, gtf);
              closePending();
              if (shot) setPosture({ p: shot, label: isAfter ? "AFTER" : "BEFORE", fresh: true });
            }} />
        );
      })()}
      {adjust && (() => {
        const gp = adjust.p.id === before?.id ? after : before;
        const other = adjust.label === "비포" ? "애프터" : "비포";
        return (
          <AlignSheet src={adjust.p.src} init={adjust.p} title={`${adjust.label} 사진 조정`}
            ghost={gp} ghostEditable={!!gp} mainName={adjust.label} ghostName={other}
            onCancel={() => setAdjust(null)}
            onSave={(tf, gtf) => { onAdjust && onAdjust(view, adjust.p.id, tf, gp && gtf ? gp.id : null, gtf); setAdjust(null); }} />
        );
      })()}
      {posture && <PostureCanvas photo={posture.p} label={posture.label} fresh={posture.fresh} onToast={onToast} onClose={() => setPosture(null)} onSave={(marks) => onSaveMarks(view, posture.p.id, marks)} />}
    </Card>
  );
}
function PerformancePanel({ member, onGo, briefing }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div><h3 className="font-extrabold" style={{ color: INK }}>운동 수행 능력</h3><Sub>회색 눈금 = 첫 평가 · 색 막대 = 현재</Sub></div>
        {!briefing && <button onClick={onGo} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}><Pencil size={12} /> 평가 입력</button>}
      </div>
      <div className="mt-4 space-y-3.5">
        {(member.perf || []).map((p, i) => {
          const gain = p.now - p.prev, c = gain > 0 ? GOOD : gain < 0 ? BAD : SUB;
          return (
            <div key={p.name + i}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold" style={{ color: INK }}>{p.name}</span>
                <span className="text-sm font-extrabold tabular-nums" style={{ color: INK }}>{p.now}<span className="ml-1 text-xs" style={{ color: c }}>{gain > 0 ? "+" : ""}{gain}</span></span>
              </div>
              <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full" style={{ backgroundColor: CANVAS }}>
                <div className="h-full rounded-full" style={{ width: `${p.now}%`, backgroundColor: gain >= 0 ? GOOD : BAD }} />
                <span className="absolute top-0 h-full w-0.5" style={{ left: `${p.prev}%`, backgroundColor: FAINT }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
function Timeline({ member, briefing, onDelete }) {
  const [filter, setFilter] = useState("전체");
  const sorted = useMemo(() => (Array.isArray(member.notes) ? member.notes : []).filter((n) => n && n.id).sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1)), [member.notes]);
  const shown = sorted.filter((n) => {
    if (filter === "전체") return true;
    if (filter === "인바디") return n.type === "인바디";
    if (filter === "상담") return n.type === "상담";
    return !NON_CLASS_TYPES.includes(n.type);
  });
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-extrabold" style={{ color: INK }}>수업 코멘트 기록</h3><Sub>총 {sorted.length}건</Sub></div>
        <div className="flex gap-1">
          {["전체", "수업", "인바디", "상담"].map((c) => (
            <button key={c} onClick={() => setFilter(c)} className="rounded-full px-2.5 py-1.5 text-xs font-bold"
              style={filter === c ? { backgroundColor: TINT, color: PRIMARY } : { backgroundColor: CANVAS, color: SUB }}>{c}</button>
          ))}
        </div>
      </div>
      <div className="mt-4 max-h-96 overflow-y-auto pr-1">
        <ol className="relative space-y-4 pl-5" style={{ borderLeft: "1px solid #ECECF2" }}>
          {shown.map((n) => (
            <li key={n.id} className="relative">
              <span className="absolute -left-7 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ backgroundColor: n.type === "인바디" ? BAD : PRIMARY }} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold tabular-nums" style={{ color: INK }}>{ymd(n.date)}</span>
                <span className="rounded-md px-1.5 py-0.5 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>{n.type}</span>
                <span className="text-xs" style={{ color: SUB }}>{n.instructor}</span>
                {!briefing && <button onClick={() => onDelete(n.id)} className="ml-auto" style={{ color: FAINT }}><X size={13} /></button>}
              </div>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: INK2 }}>{n.body}</p>
            </li>
          ))}
          {shown.length === 0 && <li className="py-6 text-center text-sm" style={{ color: SUB }}>기록이 없습니다.</li>}
        </ol>
      </div>
    </Card>
  );
}
function LessonHistory({ member, schedule }) {
  const rows = useMemo(() => (Array.isArray(schedule) ? schedule : [])
    .filter((s) => s && !isPersonalEvt(s))
    .map((s) => {
      const attendee = attendeesOf(s).find((a) => a.memberId === member.id);
      if (!attendee) return null;
      const note = (member.notes || []).find((n) => n?.sid === s.id);
      return { s, attendee, note };
    })
    .filter(Boolean)
    .sort((a, b) => `${b.s.date || ""} ${b.s.start || ""}`.localeCompare(`${a.s.date || ""} ${a.s.start || ""}`)),
  [schedule, member.id, member.notes]);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <div><h3 className="font-extrabold" style={{ color: INK }}>수업 이력</h3><Sub>실제 일정에 연결된 수업 {rows.length}건</Sub></div>
        <Calendar size={16} style={{ color: PRIMARY }} />
      </div>
      <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
        {rows.map(({ s, attendee, note }) => {
          const state = stOf(attendee.status);
          const summary = note?.body || s.memo || "";
          return (
            <div key={`${s.id}:${attendee.memberId}`} className="rounded-xl p-3" style={{ backgroundColor: CANVAS, border: `1px solid ${LINE}` }}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold tabular-nums" style={{ color: INK }}>{ymd(s.date)} · {s.start}{s.end ? `~${s.end}` : ""}</span>
                <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: state.bg, color: state.color }}>{state.label}</span>
                <span className="ml-auto text-xs font-bold" style={{ color: note ? GOOD : WARN }}>{note ? "기록 작성" : "미작성"}</span>
              </div>
              <p className="mt-1 text-xs font-bold" style={{ color: PRIMARY }}>{s.type || "수업"}{s.instructor ? ` · ${s.instructor}` : ""}</p>
              {summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed" style={{ color: INK2 }}>{summary}</p>}
            </div>
          );
        })}
        {rows.length === 0 && <Sub className="block py-6 text-center">이 회원과 연결된 수업 이력이 없습니다.</Sub>}
      </div>
    </Card>
  );
}
function localReview(kind, member, r, att, pc) {
  const find = (k) => (r.rows || []).find((x) => x.key === k);
  const w = find("weight"), sm = find("smm"), ft = find("fat");
  const moves = [
    w && `체중 ${w.from}kg → ${w.to}kg`,
    sm && `골격근량 ${sm.from}kg → ${sm.to}kg`,
    ft && `체지방률 ${ft.from}% → ${ft.to}%`,
  ].filter(Boolean).join(", ");
  const attTxt = att.rate === null ? "출석 기록이 아직 쌓이는 중입니다" : `출석률 ${att.rate}%`;
  const rest = left(member);
  const dl = ddaySafe(member.contractEnd);
  if (kind === "member") {
    return [
      `${member.name} 회원님, 지난 ${r.weeks}주 변화를 정리해 드릴게요.`,
      moves ? `${moves}로 움직였습니다.` : "",
      r.goods.length ? `특히 ${r.goods[0]} 부분이 눈에 띄게 좋아졌어요.` : "지표가 큰 흔들림 없이 유지되고 있어요.",
      r.best && r.best.gain > 0 ? `운동 수행 능력에서는 ${r.best.name}이 ${r.best.gain}점 올랐습니다.` : "",
      `${attTxt}, ${pc.label}.`,
      r.cares.length
        ? `다음 구간은 ${r.cares[0]} 쪽을 함께 잡아 보겠습니다. 지금 페이스면 충분히 따라옵니다.`
        : `다음 구간은 ${r.weak ? r.weak.name : "약한 동작"}을 한 단계 올려 보겠습니다.`,
    ].filter(Boolean).join(" ");
  }
  return [
    `· 페이스 — ${pc.label} / ${attTxt}` + (att.rate === null ? "" : ` (출석 ${att.done} · 노쇼 ${att.noshow} · 취소 ${att.cancel})`),
    `· 지표 — ${moves || "체성분 변화 없음"}${r.cares.length ? ` / 보완 우선순위: ${r.cares.join(", ")}` : " / 지표 전반 양호"}`,
    `· 다음 4주 — ${r.weak ? `${r.weak.name}(현재 ${r.weak.now}점) 보완 세트를 매 수업 앞단에 배치` : "현재 프로그램 유지 후 재평가"}` + (r.avgGain <= 2 ? " · 수행능력 정체 구간이라 난이도 재설계 필요" : ""),
    `· 재등록 — 잔여 ${rest}회` + (dl === null ? "" : dl >= 0 ? ` · 만료 D-${dl}` : ` · 만료 ${-dl}일 지남`) +
      (rest <= 10 || (dl !== null && dl <= 30) ? " → 지금이 상담 타이밍. 이번 성과 브리핑과 함께 제안" : " → 다음 측정 때 성과와 함께 자연스럽게 안내"),
  ].join("\n");
}
function OverallReview({ member, briefing, onToast, schedule }) {
  const rec = inbodyOf(member);
  const [ai, setAi] = useState(0);
  const [bi, setBi] = useState(Math.max(0, rec.length - 1));
  useEffect(() => { setAi(0); setBi(Math.max(0, rec.length - 1)); }, [member.id, rec.length]);
  const r = useMemo(() => buildReview(member, ai, bi), [member, ai, bi]);
  const att = useMemo(() => attendanceOf(schedule, member.id), [schedule, member.id]);
  const pc = useMemo(() => paceOf(schedule, member), [schedule, member]);
  const [tab, setTab] = useState("member");
  const [txt, setTxt] = useState({ member: "", coach: "" });
  const [loading, setLoading] = useState(false);
  useEffect(() => { setTxt({ member: "", coach: "" }); }, [member.id]);
  const pickA = (i) => { setAi(i); if (i === bi) setBi(i === rec.length - 1 ? Math.max(0, i - 1) : Math.min(rec.length - 1, i + 1)); };
  const pickB = (i) => { setBi(i); if (i === ai) setAi(i === 0 ? Math.min(rec.length - 1, i + 1) : Math.max(0, i - 1)); };
  const picker = rec.length >= 2 && (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Field label="기준 측정일">
        <select value={ai} onChange={(e) => pickA(Number(e.target.value))} className={inputCls}>
          {rec.map((x, i) => <option key={x.date + i} value={i}>{ymd(x.date)}</option>)}
        </select>
      </Field>
      <Field label="비교 측정일">
        <select value={bi} onChange={(e) => pickB(Number(e.target.value))} className={inputCls}>
          {rec.map((x, i) => <option key={x.date + i} value={i}>{ymd(x.date)}</option>)}
        </select>
      </Field>
    </div>
  );
  if (rec.length < 2)
    return <Card className="p-5"><h3 className="font-extrabold" style={{ color: INK }}>종합 평가</h3><Sub className="mt-1">인바디 측정이 2회 이상 쌓이면 비교 구간을 골라 평가할 수 있습니다.</Sub></Card>;
  if (!r)
    return (
      <Card className="p-5">
        <h3 className="font-extrabold" style={{ color: INK }}>종합 평가</h3>
        <Sub className="mt-1">서로 다른 두 측정일을 선택해 주세요.</Sub>
        {picker}
        <button onClick={() => { setAi(0); setBi(Math.max(0, rec.length - 1)); }}
          className="mt-3 rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>전체 구간으로</button>
      </Card>
    );
  const gc = r.grade.tone === "good" ? GOOD : r.grade.tone === "bad" ? BAD : SUB;
  const composeLocal = (kind) => localReview(kind, member, r, att, pc);
  const make = async (kind) => {
    setLoading(true);
    const payload = {
      회원: member.name, 목표: member.goal, 비교구간: `${r.weeks}주`,
      체성분: r.rows.map((x) => `${x.label} ${x.from}→${x.to} (${x.diff > 0 ? "+" : ""}${x.diff}${uLabel(x.key)})`),
      수행능력: (member.perf || []).map((p) => `${p.name} ${p.prev}→${p.now}`),
      출석률: att.rate === null ? "기록 없음" : `${att.rate}% (출석 ${att.done} · 노쇼 ${att.noshow} · 취소 ${att.cancel})`,
      운동페이스: pc.label,
      잔여횟수: left(member),
      좋아진점: r.goods, 관리필요: r.cares,
    };
    const prompt = kind === "member"
      ? "너는 필라테스 베테랑 강사다. 아래 데이터로 '회원에게 직접 읽어줄' 멘트를 써라.\n조건: 4~5문장 존댓말 한 문단. 숫자 근거로 성과를 인정 → 지금의 운동 페이스 평가 → 다음 목표 한 가지 제안. 압박·과장 금지, 마크다운 금지."
      : "너는 필라테스 스튜디오 수석 강사다. 아래 데이터로 '담당 강사가 볼 내부 코칭 노트'를 써라.\n조건: 마크다운 없이 각 줄을 '· '로 시작하는 4줄. ①현재 페이스·출석 진단 ②체성분/수행능력에서 우선 보완할 포인트 ③다음 4주 프로그램 구성 제안 ④재등록·이탈 리스크와 대응 타이밍.";
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: prompt + "\n\n" + JSON.stringify(payload) }] }),
      });
      const d = await res.json();
      const t = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!t) throw new Error("empty");
      setTxt((x) => ({ ...x, [kind]: t }));
      onToast({ ok: true, msg: kind === "coach" ? "코칭노트를 만들었습니다." : "회원용 멘트를 만들었습니다." });
    } catch (e) {
      setTxt((x) => ({ ...x, [kind]: composeLocal(kind) }));
      onToast({ ok: true, msg: "지금 기록으로 만들었습니다. 다시 만들기를 누르면 새로 씁니다." });
    }
    finally { setLoading(false); }
  };
  return (
    <Card>
      <div className="px-5 pt-5">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold" style={{ color: INK }}>종합 평가</h3>
          <span className="rounded-full px-3 py-1 text-xs font-extrabold" style={{ backgroundColor: `${gc}14`, color: gc }}>{r.grade.label}</span>
        </div>
        {picker}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[{ l: "비교 기간", v: `${r.weeks}주`, c: INK },
            { l: "출석률", v: att.rate === null ? "-" : `${att.rate}%`, c: att.rate !== null && att.rate < 70 ? BAD : INK },
            { l: "운동 페이스", v: pc.done ? `주 ${pc.per.toFixed(1)}회` : "기록 없음", c: pc.done ? INK : SUB }].map((x) => (
            <div key={x.l} className="rounded-2xl p-3 text-center" style={{ backgroundColor: CANVAS }}>
              <Sub>{x.l}</Sub><p className="text-base font-extrabold tabular-nums" style={{ color: x.c }}>{x.v}</p>
            </div>
          ))}
        </div>
        <Sub className="mt-1">{pc.label}</Sub>
        <p className="mt-3 text-sm font-semibold leading-relaxed" style={{ color: INK }}>{member.name} 회원님은 {r.headline}</p>
      </div>
      <div className="mt-4 grid gap-2 px-5 sm:grid-cols-2">
        <div className="rounded-2xl p-4" style={{ backgroundColor: GOOD_S }}>
          <p className="text-xs font-extrabold" style={{ color: GOOD }}>좋아진 점</p>
          <ul className="mt-2 space-y-1">
            {r.goods.length ? r.goods.map((g) => <li key={g} className="flex items-start gap-1.5 text-sm font-semibold" style={{ color: INK }}><Check size={14} style={{ color: GOOD, marginTop: 2 }} /> {g}</li>) : <li className="text-sm" style={{ color: SUB }}>이 구간에는 뚜렷한 개선 지표가 없습니다.</li>}
          </ul>
        </div>
        <div className="rounded-2xl p-4" style={{ backgroundColor: BAD_S }}>
          <p className="text-xs font-extrabold" style={{ color: BAD }}>관리가 필요한 점</p>
          <ul className="mt-2 space-y-1">
            {r.cares.length ? r.cares.map((c) => <li key={c} className="flex items-start gap-1.5 text-sm font-semibold" style={{ color: INK }}><X size={14} style={{ color: BAD, marginTop: 2 }} /> {c}</li>) : <li className="text-sm" style={{ color: SUB }}>지표 전반이 목표 방향으로 움직이고 있습니다.</li>}
          </ul>
        </div>
      </div>
      {!briefing && r.next.length > 0 && (
        <div className="mt-3 px-5">
          <div className="rounded-2xl p-4" style={{ backgroundColor: CANVAS }}>
            <p className="text-xs font-extrabold" style={{ color: SUB }}>다음 단계 제안 · 상담 포인트</p>
            <ul className="mt-2 space-y-1">{r.next.map((n) => <li key={n} className="flex items-start gap-1.5 text-sm font-semibold" style={{ color: INK }}><Target size={14} style={{ color: PRIMARY, marginTop: 2 }} /> {n}</li>)}</ul>
          </div>
        </div>
      )}
      <div className="p-5">
        <div className="flex gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
          {[{ k: "member", l: "회원용 멘트" }, { k: "coach", l: "강사용 코칭노트" }].map((o) => (
            <button key={o.k} onClick={() => setTab(o.k)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-extrabold"
              style={tab === o.k
                ? { background: GRAD, color: "#fff", boxShadow: `0 4px 12px ${RING}`, border: "1px solid transparent" }
                : { backgroundColor: CARD, color: INK, border: `1px solid ${LINE}` }}>
              {o.k === "coach" ? <ClipboardList size={15} /> : <MessageSquare size={15} />} {o.l}
            </button>
          ))}
        </div>
        {txt[tab] ? (
          <div className="mt-3 rounded-2xl p-4" style={{ backgroundColor: tab === "coach" ? CANVAS : TINT }}>
            <p className="text-xs font-extrabold" style={{ color: tab === "coach" ? INK : PRIMARY }}>{tab === "coach" ? "강사 전용 · 회원에게 보여주지 마세요" : "회원 브리핑 멘트"}</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed" style={{ color: INK }}>{txt[tab]}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={async () => { try { await navigator.clipboard.writeText(txt[tab]); onToast({ ok: true, msg: "복사했습니다." }); } catch (e) { onToast({ ok: false, msg: "복사하지 못했습니다." }); } }}
                className="flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-bold" style={{ color: PRIMARY }}><Copy size={13} /> 복사</button>
              <button onClick={() => make(tab)} className="rounded-full bg-white px-3 py-2 text-xs font-bold" style={{ color: SUB }}>다시 만들기</button>
              <button onClick={() => setTxt((x) => ({ ...x, [tab]: "" }))} className="ml-auto flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-bold" style={{ color: SUB }}><ArrowLeft size={13} /> 되돌아가기</button>
            </div>
          </div>
        ) : (
          <button onClick={() => make(tab)} disabled={loading}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-3.5 text-sm font-extrabold text-white disabled:opacity-60"
            style={{ backgroundColor: tab === "coach" ? INK : PRIMARY }}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? "분석 중" : tab === "coach" ? "강사용 코칭노트 만들기" : "회원용 멘트 만들기"}
          </button>
        )}
      </div>
    </Card>
  );
}
function SetThumb({ p }) {
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl bg-photo" style={{ aspectRatio: "3 / 4" }}>
      <img {...IMGP} src={p.src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ transform: ptf(p), ...NOPRESS }} />
    </div>
  );
}
function SetViewer({ item, onClose, onToggleFav }) {
  const [t, setT] = useState(100);
  const [side, setSide] = useState(false);
  useBackClose(true, onClose);
  const { before, after, set, memberName } = item || {};
  if (!before || !after || !set) return null;
  const weeks = weeksBetween(before.date, after.date);
  return (
    <div className="safe-all fixed inset-0 z-50 flex flex-col bg-photo">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
        <p className="text-sm font-bold text-white">{memberName} · {VIEWS.find((v) => v.key === set.view)?.label} · {weeks}주</p>
        <button onClick={() => onToggleFav(set.id)} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}>
          <Star size={18} color={set.fav ? WARN : "#fff"} fill={set.fav ? WARN : "none"} />
        </button>
      </div>
      <div className="flex-1 px-4">
        {side ? (
          <div className="mx-auto flex h-full gap-2" style={{ maxWidth: "min(100%, 1100px)" }}>
            <SetThumb p={before} /><SetThumb p={after} />
          </div>
        ) : (
          <div className="relative mx-auto h-full overflow-hidden rounded-2xl bg-photo" style={{ maxWidth: "min(100%, 900px)" }}>
            <img src={before.src} alt="비포" className="absolute inset-0 h-full w-full object-cover" style={{ transform: ptf(before) }} />
            <img src={after.src} alt="애프터" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: t / 100, transform: ptf(after) }} />
            <GuideOverlay />
            <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-extrabold text-white" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
              {t < 50 ? `BEFORE ${ymd(before.date)}` : `AFTER ${ymd(after.date)}`}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-2 px-4 pb-6 pt-3">
        {!side && <input type="range" min="0" max="100" value={t} onChange={(e) => setT(Number(e.target.value))} className="w-full" style={{ accentColor: PRIMARY, touchAction: "none" }} />}
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white opacity-70">{ymd(before.date)}</span>
          <button onClick={() => setSide((v) => !v)} className="rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}>
            {side ? "겹쳐 보기" : "나란히 보기"}
          </button>
          <span className="text-xs font-bold text-white opacity-70">{ymd(after.date)}</span>
        </div>
      </div>
    </div>
  );
}
function useSets(photos) {
  return useMemo(() => (photos?.sets || []).map((s) => {
    const list = photos[s.view] || [];
    return { set: s, before: list.find((p) => p.id === s.beforeId), after: list.find((p) => p.id === s.afterId) };
  }).filter((x) => x.before && x.after), [photos]);
}
function BeforeAfterSets({ memberName, photos, onToggleFav, onDelete }) {
  const [favOnly, setFavOnly] = useState(false);
  const [open, setOpen] = useState(null);
  const sets = useSets(photos);
  if (!sets.length) return null;
  const shown = favOnly ? sets.filter((x) => x.set.fav) : sets;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div><h3 className="font-extrabold" style={{ color: INK }}>비포 & 애프터 모음</h3><Sub>{sets.length}세트 저장됨</Sub></div>
        <button onClick={() => setFavOnly((v) => !v)} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold"
          style={favOnly ? { backgroundColor: WARN_S, color: WARN } : { backgroundColor: CANVAS, color: SUB }}>
          <Star size={13} fill={favOnly ? WARN : "none"} /> 즐겨찾기
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {shown.map((x) => (
          <div key={x.set.id} className="flex items-center gap-3 rounded-2xl p-2.5" style={{ backgroundColor: CANVAS }}>
            <button onClick={() => setOpen({ ...x, memberName })} className="flex w-20 shrink-0 gap-1">
              <SetThumb p={x.before} /><SetThumb p={x.after} />
            </button>
            <button onClick={() => setOpen({ ...x, memberName })} className="min-w-0 flex-1 text-left">
              <p className="text-sm font-extrabold" style={{ color: INK }}>
                {VIEWS.find((v) => v.key === x.set.view)?.label} · {weeksBetween(x.before.date, x.after.date)}주 변화
              </p>
              <Sub>{md(x.before.date)} → {md(x.after.date)}</Sub>
            </button>
            <button onClick={() => onToggleFav(x.set.id)} className="rounded-full p-2">
              <Star size={16} color={x.set.fav ? WARN : FAINT} fill={x.set.fav ? WARN : "none"} />
            </button>
            <button onClick={() => onDelete(x.set.id)} className="rounded-full p-2" style={{ color: FAINT }}><Trash2 size={14} /></button>
          </div>
        ))}
        {shown.length === 0 && <Sub className="py-4 text-center">즐겨찾기한 세트가 없습니다. ★를 눌러 등록해 주세요.</Sub>}
      </div>
      {open && <SetViewer item={open} onClose={() => setOpen(null)} onToggleFav={onToggleFav} />}
    </Card>
  );
}
function FavSetsModal({ items, onClose, onToggleFav, onOpenMember }) {
  const [open, setOpen] = useState(null);
  return (
    <Sheet title={`즐겨찾기 비포 & 애프터 ${items.length}건`} onClose={onClose}>
      {items.length === 0 ? (
        <div className="py-10 text-center">
          <Star size={22} className="mx-auto" style={{ color: FAINT }} />
          <Sub className="mt-2">아직 즐겨찾기한 세트가 없습니다.</Sub>
          <Sub>회원 상세 → 비포 & 애프터 모음에서 ★를 눌러 보세요.</Sub>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((x) => (
            <div key={x.set.id} className="flex items-center gap-3 rounded-2xl p-2.5" style={{ backgroundColor: CANVAS }}>
              <button onClick={() => setOpen({ ...x, memberName: x.member.name })} className="flex w-20 shrink-0 gap-1">
                <SetThumb p={x.before} /><SetThumb p={x.after} />
              </button>
              <button onClick={() => setOpen({ ...x, memberName: x.member.name })} className="min-w-0 flex-1 text-left">
                <p className="text-sm font-extrabold" style={{ color: INK }}>{x.member.name} · {VIEWS.find((v) => v.key === x.set.view)?.label}</p>
                <Sub>{md(x.before.date)} → {md(x.after.date)} · {weeksBetween(x.before.date, x.after.date)}주</Sub>
              </button>
              <button onClick={() => { onOpenMember(x.member.id); onClose(); }} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CARD, color: PRIMARY }}>회원</button>
              <button onClick={() => onToggleFav(x.member.id, x.set.id)} className="rounded-full p-2"><Star size={16} color={WARN} fill={WARN} /></button>
            </div>
          ))}
        </div>
      )}
      {open && <SetViewer item={open} onClose={() => setOpen(null)} onToggleFav={(sid) => onToggleFav(open.member.id, sid)} />}
    </Sheet>
  );
}
const MP_VER = "0.10.14";
const MP_LIB = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`,
  `https://unpkg.com/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`,
];
const MP_WASM = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`,
  `https://unpkg.com/@mediapipe/tasks-vision@${MP_VER}/wasm`,
];
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
let mpPromise = null;
function loadLandmarker() {
  if (mpPromise) return mpPromise;
  mpPromise = (async () => {
    let dyn = null;
    try { dyn = new Function("u", "return import(u)"); } catch (e) { dyn = null; }
    let vision = null, wasmBase = MP_WASM[0];
    for (let i = 0; i < MP_LIB.length; i++) {
      try {
        const mod = dyn ? await dyn(MP_LIB[i]) : await import(MP_LIB[i]);
        if (mod && mod.FilesetResolver && mod.PoseLandmarker) { vision = mod; wasmBase = MP_WASM[i]; break; }
      } catch (e) {}
    }
    if (!vision) throw new Error("lib");
    const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
    const make = (delegate) =>
      vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate },
        runningMode: "IMAGE", numPoses: 1,
        minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4,
      });
    try { return await make("GPU"); } catch (e) { return await make("CPU"); }
  })().catch((e) => { mpPromise = null; throw e; });
  return mpPromise;
}
const MP_IDX = {
  nose: 0, earL: 7, earR: 8, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankL: 27, ankR: 28, footL: 31, footR: 32,
};
const PART_KO = { ear: "귀", sh: "어깨", hip: "골반", knee: "무릎", ank: "발목" };
function jointName(key, view) {
  if (view !== "front") return PART_KO[key] || key;
  const part = PART_KO[key.slice(0, -1)];
  return part ? `${key.endsWith("L") ? "왼" : "오른"}${part}` : key;
}
function manualHint(key, view) {
  if (view !== "front") return `${PART_KO[key] || key}를 눌러주세요`;
  const part = PART_KO[key.slice(0, -1)] || key, isL = key.endsWith("L");
  return `회원 기준 ${isL ? "왼쪽" : "오른쪽"} ${part} — 화면에서는 ${isL ? "오른쪽" : "왼쪽"}입니다`;
}
const MANUAL_FRONT = ["earL", "earR", "shL", "shR", "hipL", "hipR", "kneeL", "kneeR", "ankL", "ankR"];
const MANUAL_SIDE = ["ear", "sh", "hip", "knee", "ank"];
const D2 = 180 / Math.PI;
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
function lineDeg(a, b) {
  const [p, q] = a.x <= b.x ? [a, b] : [b, a];
  return Math.atan2(q.y - p.y, q.x - p.x) * D2;
}
function vertDeg(from, to) {
  return Math.atan2(to.x - from.x, Math.max(1e-6, Math.abs(from.y - to.y))) * D2;
}
function bendDeg(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / m));
  return 180 - Math.acos(cos) * D2;
}
function xDev(a, c, b) {
  const t = (b.y - a.y) / ((c.y - a.y) || 1e-6);
  return b.x - (a.x + (c.x - a.x) * t);
}
const midOf = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const LV_COLOR = { get good() { return GOOD; }, get warn() { return WARN; }, get bad() { return BAD; } };
const LV_TEXT = { good: "양호", warn: "주의", bad: "교정 필요" };
const lvDown = (v, ok, warn) => (v <= ok ? "good" : v <= warn ? "warn" : "bad");
const lvUp = (v, ok, warn) => (v >= ok ? "good" : v >= warn ? "warn" : "bad");
const LV_RANK = { good: 0, warn: 1, bad: 2 };
function analyzePose(raw, { view, W, H, floorFix }) {
  const P = {};
  Object.keys(raw || {}).forEach((k) => {
    const p = raw[k];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) P[k] = { x: p.x * W, y: p.y * H, score: p.score ?? 1 };
  });
  const has = (...ks) => ks.every((k) => P[k]);
  const items = [], notes = [];
  if (view === "front") {
    if (!has("shL", "shR", "hipL", "hipR")) return { items: [], notes: ["어깨·골반이 인식되지 않았습니다."], floor: 0 };
    const floor = has("ankL", "ankR") ? lineDeg(P.ankL, P.ankR) : 0;
    const fix = floorFix ? floor : 0;
    const sh = lineDeg(P.shL, P.shR) - fix;
    const hip = lineDeg(P.hipL, P.hipR) - fix;
    const shHigh = P.shL.y < P.shR.y ? "왼쪽" : "오른쪽";
    const hipHigh = P.hipL.y < P.hipR.y ? "왼쪽" : "오른쪽";
    items.push({ key: "shoulder", label: "어깨 틀어짐 각도", value: Math.abs(r1(sh)), unit: "°", level: lvDown(Math.abs(sh), 2, 4), at: midOf(P.shL, P.shR), up: -1, dir: Math.abs(sh) < 0.3 ? "수평" : `${shHigh} 높음`, desc: Math.abs(sh) < 0.3 ? "좌우 어깨 높이가 거의 같습니다." : `${shHigh} 어깨가 ${Math.abs(r1(sh))}° 올라가 있습니다.`, tip: `${shHigh} 상부승모근·견갑거근 이완 → 반대쪽 하부승모근·전거근 강화` });
    items.push({ key: "pelvis", label: "골반 비대칭 각도", value: Math.abs(r1(hip)), unit: "°", level: lvDown(Math.abs(hip), 2, 4), at: midOf(P.hipL, P.hipR), up: 1, dir: Math.abs(hip) < 0.3 ? "수평" : `${hipHigh} 높음`, desc: Math.abs(hip) < 0.3 ? "좌우 골반 높이가 거의 같습니다." : `${hipHigh} 골반이 ${Math.abs(r1(hip))}° 올라가 있습니다.`, tip: `${hipHigh} 요방형근 이완 → 반대쪽 중둔근 활성 (사이드 라잉 시리즈)` });
    const twist = Math.abs(sh - hip);
    items.push({ key: "twist", label: "어깨-골반 기울기 차", value: r1(twist), unit: "°", level: lvDown(twist, 2, 5), at: midOf(midOf(P.shL, P.shR), midOf(P.hipL, P.hipR)), up: 0, skipBadge: true, dir: twist < 1 ? "정렬 양호" : sh * hip < 0 ? "반대로 기움" : "같은 방향", desc: `어깨선과 골반선의 기울기가 ${r1(twist)}° 차이 납니다.${sh * hip < 0 ? " 두 선이 서로 반대로 기운 형태로, 측만 성향을 함께 확인해 보세요." : ""}`, tip: "짧아진 쪽 측면 라인(요방형근·광배근) 이완 후 반대쪽 측면 강화 · 사이드 벤드 좌우 비교" });
    if (has("kneeL", "kneeR", "ankL", "ankR")) {
      const midX = (P.hipL.x + P.hipR.x) / 2;
      const legs = ["L", "R"].map((s) => {
        const hipP = P["hip" + s], kneeP = P["knee" + s], ankP = P["ank" + s];
        const dev = bendDeg(hipP, kneeP, ankP);
        const dx = xDev(hipP, ankP, kneeP);
        const inward = (midX - kneeP.x) * dx > 0;
        return { s, ko: s === "L" ? "왼쪽" : "오른쪽", dev: r1(dev), inward, at: kneeP };
      });
      const worst = legs[0].dev >= legs[1].dev ? legs[0] : legs[1];
      const shape = worst.dev < 3 ? "정렬 양호" : worst.inward ? "X다리 성향" : "O다리 성향";
      items.push({ key: "knee", label: "무릎 정렬 각도", value: worst.dev, unit: "°", level: lvDown(worst.dev, 3, 6), at: worst.at, up: -1, dir: shape, desc: `왼쪽 ${legs[0].dev}° · 오른쪽 ${legs[1].dev}° — ${shape}`, tip: worst.dev < 3 ? "현재 정렬 유지 · 스쿼트 시 무릎-2번 발가락 정렬 큐잉" : worst.inward ? "중둔근·고관절 외회전근 강화, 발 아치 지지" : "내전근·족부 회내 컨트롤, 스쿼트 무릎 궤적 교정" });
    }
    if (has("earL", "earR")) {
      const head = lineDeg(P.earL, P.earR) - fix;
      const hh = P.earL.y < P.earR.y ? "왼쪽" : "오른쪽";
      items.push({ key: "head", label: "머리 기울기", value: Math.abs(r1(head)), unit: "°", level: lvDown(Math.abs(head), 2, 4), at: midOf(P.earL, P.earR), up: -1, dir: Math.abs(head) < 0.3 ? "수평" : `${hh} 기움`, desc: `귀 높이가 ${Math.abs(r1(head))}° 차이 납니다.`, tip: `${hh} 사각근·흉쇄유돌근 이완 · 턱 당기기(chin tuck) 병행` });
    }
    if (has("ankL", "ankR")) {
      const shW = Math.abs(P.shL.x - P.shR.x) || 1;
      const fr = floorFix ? (floor * Math.PI) / 180 : 0;
      const dSh = midOf(P.shL, P.shR), dAn = midOf(P.ankL, P.ankR);
      const off = (dSh.x - dAn.x) * Math.cos(fr) + (dSh.y - dAn.y) * Math.sin(fr);
      const dirL = Math.sign(P.shL.x - P.shR.x) || 1;
      const pct = Math.abs(Math.round((off / shW) * 100));
      if (pct >= 4 && !(Math.abs(floor) > 1.5 && !floorFix))
        notes.push(`좌우 무게중심: 상체 중심이 발 중심보다 어깨너비의 ${pct}%만큼 ${off * dirL > 0 ? "왼쪽" : "오른쪽"}으로 치우쳐 있습니다.`);
      if (Math.abs(floor) > 1.5)
        notes.push(`바닥선(발목)이 ${Math.abs(r1(floor))}° 기울어 있습니다 — 촬영 각도 영향일 수 있어 '바닥선 보정'을 켜고 다시 확인해 보세요.`);
    }
    return { items, notes, floor: r1(floor) };
  }
  const pick = (a, b) => {
    const pa = P[a], pb = P[b];
    if (pa && pb) return (pa.score ?? 1) >= (pb.score ?? 1) ? pa : pb;
    return pa || pb || null;
  };
  const ear = P.ear || pick("earL", "earR");
  const sh = P.sh || pick("shL", "shR");
  const hip = P.hip || pick("hipL", "hipR");
  const knee = P.knee || pick("kneeL", "kneeR");
  const ank = P.ank || pick("ankL", "ankR");
  if (!(ear && sh && hip)) return { items: [], notes: ["귀·어깨·골반이 인식되지 않았습니다."], floor: 0 };
  let face = P.nose ? Math.sign(P.nose.x - sh.x) : Math.sign(ear.x - sh.x);
  if (!face) face = 1;
  const fw = (v) => (v * face > 0 ? "앞쪽" : "뒤쪽");
  const fha = vertDeg(sh, ear);
  items.push({ key: "fha", label: "거북목(머리 전방 이동)", value: Math.abs(r1(fha)), unit: "°", level: lvDown(Math.abs(fha), 7, 15), at: midOf(ear, sh), up: -1, dir: Math.abs(fha) < 3 ? "정렬 양호" : `머리가 ${fw(fha)}`, desc: `귀가 어깨 수직선보다 ${Math.abs(r1(fha))}° ${fw(fha)}에 있습니다. 7° 이내면 양호, 15°를 넘으면 전방 두부 자세로 봅니다.`, tip: "턱 당기기(chin tuck) 10회 × 3 · 흉추 신전 가동 · 모니터/베개 높이 점검" });
  const lean = vertDeg(hip, sh);
  items.push({ key: "trunk", label: "몸통 기울기", value: Math.abs(r1(lean)), unit: "°", level: lvDown(Math.abs(lean), 3, 6), at: midOf(hip, sh), up: 0, dir: Math.abs(lean) < 1 ? "수직 정렬" : `${fw(lean)}으로 기움`, desc: `골반-어깨 선이 수직에서 ${Math.abs(r1(lean))}° 벗어나 있습니다.`, tip: "복부 심부근 활성 + 흉요추 분절 컨트롤 (footwork·bridging 큐잉)" });
  if (knee && ank) {
    const dev = bendDeg(hip, knee, ank);
    const dx = xDev(hip, ank, knee);
    const back = dx * face < 0;
    items.push({ key: "kneeSide", label: back ? "무릎 과신전(반장슬)" : "무릎 굴곡", value: r1(dev), unit: "°", level: lvDown(dev, 3, 6), at: knee, up: -1, dir: dev < 2 ? "중립" : back ? "뒤로 밀림" : "앞으로 굽음", desc: `고관절-발목 선 대비 무릎이 ${r1(dev)}° ${back ? "뒤" : "앞"}으로 벗어나 있습니다.`, tip: back ? "무릎 살짝 풀고 서기(soft knee) · 햄스트링·종아리 이완, 대퇴사두 편심 강화" : "고관절 신전 가동 확보 · 장요근 이완 후 둔근 활성" });
    const glob = vertDeg(ank, ear);
    items.push({ key: "align", label: "전신 수직 정렬", value: Math.abs(r1(glob)), unit: "°", level: lvDown(Math.abs(glob), 4, 8), at: ank, up: -1, skipBadge: true, dir: Math.abs(glob) < 1 ? "정렬 양호" : `머리가 ${fw(glob)}`, desc: `복사뼈에서 올린 수직선 대비 귀가 ${Math.abs(r1(glob))}° ${fw(glob)}에 있습니다.`, tip: "발-골반-흉곽-머리 스택 재정렬 (벽 서기 30초 × 3)" });
  }
  notes.push("측면 골반 전·후방 경사는 사진 관절점만으로는 정확히 계산할 수 없어 제외했습니다. 촉진(ASIS·PSIS)으로 확인해 주세요.");
  return { items, notes, floor: 0 };
}
function poseComment(member, view, res) {
  const bad = res.items.filter((i) => i.level !== "good").sort((a, b) => LV_RANK[b.level] - LV_RANK[a.level]);
  const head = `[${view === "front" ? "전면" : view === "side" ? "측면" : "후면"} 체형 분석] `;
  if (!bad.length) return head + "주요 지표가 모두 정상 범위입니다. 현재 정렬을 유지하는 방향으로 진행합니다.";
  const t = bad.slice(0, 2);
  const facts = t.map((i) => `${i.label} ${i.value}${i.unit}(${i.dir})`).join(", ");
  return `${head}${facts}. 오늘 수업은 ${t[0].tip} 위주로 진행하겠습니다.`;
}
function badge(ctx, x, y, text, color, up, placed, W, H) {
  ctx.font = "700 15px Pretendard, -apple-system, sans-serif";
  const w = ctx.measureText(text).width + 22, h = 30;
  const cands = up < 0
    ? [[x - w / 2, y - h - 16], [x - w / 2, y + 16], [x + 16, y - h / 2], [x - w - 16, y - h / 2], [x - w / 2, y - h - 52]]
    : [[x - w / 2, y + 16], [x - w / 2, y - h - 16], [x + 16, y - h / 2], [x - w - 16, y - h / 2], [x - w / 2, y + 52]];
  let box = null;
  for (const [bx, by] of cands) {
    const r = { x: Math.max(6, Math.min(W - w - 6, bx)), y: Math.max(6, Math.min(H - h - 6, by)), w, h };
    const hit = placed.some((p) => !(p.x + p.w + 4 < r.x || r.x + r.w + 4 < p.x || p.y + p.h + 4 < r.y || r.y + r.h + 4 < p.y));
    if (!hit) { box = r; break; }
  }
  if (!box) box = { x: Math.max(6, Math.min(W - w - 6, x - w / 2)), y: Math.max(6, Math.min(H - h - 6, y - h - 16)), w, h };
  placed.push(box);
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.75;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(box.x + box.w / 2, box.y + box.h / 2); ctx.stroke();
  ctx.globalAlpha = 1;
  const r = 15;
  ctx.beginPath();
  ctx.moveTo(box.x + r, box.y);
  ctx.arcTo(box.x + box.w, box.y, box.x + box.w, box.y + box.h, r);
  ctx.arcTo(box.x + box.w, box.y + box.h, box.x, box.y + box.h, r);
  ctx.arcTo(box.x, box.y + box.h, box.x, box.y, r);
  ctx.arcTo(box.x, box.y, box.x + box.w, box.y, r);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2 + 1);
  ctx.restore();
}
const BONES_FRONT = [["shL", "shR"], ["hipL", "hipR"], ["shL", "hipL"], ["shR", "hipR"], ["hipL", "kneeL"], ["kneeL", "ankL"], ["hipR", "kneeR"], ["kneeR", "ankR"], ["shL", "elL"], ["elL", "wrL"], ["shR", "elR"], ["elR", "wrR"], ["earL", "earR"]];
const BONES_SIDE = [["ear", "sh"], ["sh", "hip"], ["hip", "knee"], ["knee", "ank"]];
/* 접힌 상태에서 보여줄 분석 예시 그림 (실제 회원 사진이 아님) */
function PoseMock() {
  return (
    <svg viewBox="0 0 96 128" width="72" height="96" className="shrink-0" style={{ borderRadius: 12, background: "#14141C" }} aria-hidden="true">
      <line x1="48" y1="6" x2="48" y2="122" stroke="rgba(255,255,255,.22)" strokeWidth="1" strokeDasharray="3 3" />
      <circle cx="48" cy="22" r="8" fill="none" stroke={MINT} strokeWidth="2" />
      <path d="M34 40 L62 37" stroke="#F04438" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M36 74 L60 72" stroke="#F79009" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M48 40 L48 74" stroke={LAVENDER} strokeWidth="2" />
      <path d="M38 74 L36 104 M58 72 L60 104" stroke={LAVENDER} strokeWidth="2" strokeLinecap="round" />
      <path d="M36 104 L34 118 M60 104 L62 118" stroke={LAVENDER} strokeWidth="2" strokeLinecap="round" />
      {[[34, 40], [62, 37], [36, 74], [60, 72], [36, 104], [60, 104]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill="#fff" />
      ))}
      <rect x="6" y="44" width="34" height="13" rx="6" fill="#F04438" />
      <text x="23" y="53.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">어깨 3.2°</text>
      <rect x="54" y="80" width="36" height="13" rx="6" fill="#F79009" />
      <text x="72" y="89.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">골반 1.8°</text>
    </svg>
  );
}

/* 저장해 둔 체형 분석을 다시 크게 보는 화면 */

/* ================= 결과 카드 (마케팅용 비포/애프터) ================= */
const CARD_COLORS = [
  { k: "white", c: "#FFFFFF", name: "흰색" },
  { k: "yellow", c: "#FFD43B", name: "노랑" },
  { k: "lavender", c: "#8A84C4", name: "라벤더" },
  { k: "red", c: "#FF5A5A", name: "빨강" },
  { k: "green", c: "#2FD07A", name: "초록" },
  { k: "sky", c: "#4CC3FF", name: "하늘" },
];
/* 항목 → 원을 그릴 관절 (정면/측면) */
const CARD_JOINTS = {
  shoulder: ["shL", "shR"], pelvis: ["hipL", "hipR"], knee: ["kneeL", "kneeR"],
  head: ["earL", "earR"], twist: ["shL", "shR"],
  fha: ["ear"], trunk: ["sh", "hip"], kneeSide: ["knee"], align: ["sh", "hip", "knee"],
};
const CARD_SHORT = { shoulder: "어깨", pelvis: "골반", knee: "무릎", head: "머리", twist: "어깨 회전", fha: "거북목", trunk: "몸통 기울기", kneeSide: "무릎(측면)", align: "정렬" };

async function loadImg(src) {
  return new Promise((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
/* cover 로 채우고, 정규좌표(0~1) → 그린 영역 좌표로 변환하는 함수를 돌려준다 */
function drawCover(ctx, im, x, y, w, h) {
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  const sc = Math.max(w / iw, h / ih);
  const dw = iw * sc, dh = ih * sc;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(im, dx, dy, dw, dh); ctx.restore();
  return (p) => ({ x: dx + p.x * dw, y: dy + p.y * dh });
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function cardChip(ctx, text, cx, cy, opt) {
  const { font = "700 24px Pretendard, -apple-system, sans-serif", pad = 14, bg = "rgba(20,20,28,.82)", fg = "#fff" } = opt || {};
  ctx.save(); ctx.font = font;
  const w = ctx.measureText(text).width + pad * 2, h = 40;
  const x = Math.max(8, Math.min(cx - w / 2, (opt?.maxX ?? 1e9) - w - 8));
  roundRect(ctx, x, cy - h / 2, w, h, 10);
  ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(text, x + pad, cy + 1);
  ctx.restore();
  return { x, w, h };
}

async function composeResultCard({ bRec, aRec, bSrc, aSrc, keys, colors, texts, centerName }) {
  const W = 1080, GAP = 14, PW = (W - GAP) / 2, PH = Math.round(PW * 4 / 3);
  const PANEL = 336, TOP = 66;
  const H = TOP + PH + PANEL;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#F4F2EE"; ctx.fillRect(0, 0, W, H);

  const [bIm, aIm] = await Promise.all([loadImg(bSrc), loadImg(aSrc)]);
  const mapB = drawCover(ctx, bIm, 0, TOP, PW, PH);
  const mapA = drawCover(ctx, aIm, PW + GAP, TOP, PW, PH);

  /* BEFORE / AFTER 헤더 */
  const head = (label, x0) => {
    ctx.save(); ctx.font = "800 30px Pretendard, -apple-system, sans-serif";
    const tw = ctx.measureText(label).width + 44;
    roundRect(ctx, x0 + PW / 2 - tw / 2, TOP - 48, tw, 44, 12);
    ctx.fillStyle = "#2A2A32"; ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x0 + PW / 2, TOP - 25);
    ctx.restore();
  };
  head("BEFORE", 0); head("AFTER", PW + GAP);

  /* 가운데 화살표 원 */
  ctx.save();
  ctx.beginPath(); ctx.arc(W / 2, TOP + PH / 2, 34, 0, Math.PI * 2);
  ctx.fillStyle = "#2A2A32"; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(W / 2 - 6, TOP + PH / 2 - 11); ctx.lineTo(W / 2 + 7, TOP + PH / 2); ctx.lineTo(W / 2 - 6, TOP + PH / 2 + 11); ctx.stroke();
  ctx.restore();

  /* 항목별 점선 원 + 라벨 */
  const drawMarks = (rec, map, x0, color, isAfter) => {
    const pts = rec?.pts || {};
    const mFor = (k) => (rec?.metrics || []).find((m) => m.key === k);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, TOP, PW, PH); ctx.clip();
    keys.forEach((k, i) => {
      const joints = (CARD_JOINTS[k] || []).map((j) => pts[j]).filter(Boolean);
      if (!joints.length) return;
      ctx.strokeStyle = color; ctx.lineWidth = 4;
      ctx.setLineDash(isAfter ? [] : [9, 8]);
      joints.forEach((p) => {
        const q = map(p);
        ctx.beginPath(); ctx.arc(q.x, q.y, 44, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.setLineDash([]);
      const mid = joints.reduce((s, p) => ({ x: s.x + p.x / joints.length, y: s.y + p.y / joints.length }), { x: 0, y: 0 });
      const q = map(mid);
      const m = mFor(k);
      const txt = isAfter
        ? `${CARD_SHORT[k] || k} ${m ? `${m.value}${m.unit}` : ""} 개선`.trim()
        : `${CARD_SHORT[k] || k} ${m ? `${m.value}${m.unit}` : ""}`.trim();
      cardChip(ctx, txt, q.x, Math.max(TOP + 30, q.y - 74 - (i % 2) * 6), { bg: "rgba(20,20,28,.8)", fg: color === "#FFFFFF" ? "#fff" : color, maxX: x0 + PW });
    });
    ctx.restore();
  };
  drawMarks(bRec, mapB, 0, colors.b, false);
  drawMarks(aRec, mapA, PW + GAP, colors.a, true);

  /* 하단 패널 */
  const py = TOP + PH;
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, py, W, PANEL);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#17171F"; ctx.font = "800 40px Pretendard, -apple-system, sans-serif";
  ctx.fillText(texts.title, W / 2, py + 56, W - 60);
  ctx.textAlign = "left"; ctx.font = "600 27px Pretendard, -apple-system, sans-serif";
  const checks = [texts.c1, texts.c2].filter((t) => t && t.trim());
  checks.forEach((t, i) => {
    const y = py + 112 + i * 46;
    ctx.fillStyle = "#FFD43B"; roundRect(ctx, 84, y - 13, 26, 26, 6); ctx.fill();
    ctx.strokeStyle = "#7A5C00"; ctx.lineWidth = 3.4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(90, y); ctx.lineTo(96, y + 6); ctx.lineTo(105, y - 6); ctx.stroke();
    ctx.fillStyle = "#2A2A32"; ctx.fillText(t, 124, y + 1, W - 200);
  });
  if (texts.close && texts.close.trim()) {
    ctx.font = "800 26px Pretendard, -apple-system, sans-serif";
    const tw = Math.min(W - 80, ctx.measureText(texts.close).width + 56);
    roundRect(ctx, W / 2 - tw / 2, py + 210, tw, 52, 14);
    ctx.fillStyle = "#FFF1BF"; ctx.fill();
    ctx.fillStyle = "#3A2E00"; ctx.textAlign = "center";
    ctx.fillText(texts.close, W / 2, py + 237, W - 120);
  }
  ctx.strokeStyle = "#D8D5CE"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(120, py + 296); ctx.lineTo(W / 2 - 110, py + 296);
  ctx.moveTo(W / 2 + 110, py + 296); ctx.lineTo(W - 120, py + 296); ctx.stroke();
  ctx.fillStyle = "#6E6A62"; ctx.font = "700 22px Pretendard, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText((centerName || "PILATEACHER").toUpperCase(), W / 2, py + 297);
  return c;
}

/* 받침 유무로 이/가 를 고른다 — "틀어짐이", "비대칭이" */
const josa = (w, a, b) => {
  const ch = (w || "").charCodeAt((w || "").length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return w + a;
  return w + (((ch - 0xac00) % 28) ? a : b);
};
/* 개선 문구 자동 초안 */
function cardDrafts(bRec, aRec, keys) {
  const g = (rec, k) => (rec?.metrics || []).find((m) => m.key === k);
  const lines = [];
  keys.forEach((k) => {
    const b = g(bRec, k), a = g(aRec, k);
    if (b && a && Number.isFinite(b.value) && Number.isFinite(a.value) && a.value < b.value) {
      lines.push(`${josa(b.label.replace(" 각도", ""), "이", "가")} ${b.value}${b.unit} → ${a.value}${a.unit}로 개선되었습니다.`);
    } else if (a) {
      lines.push(`${a.label.replace(" 각도", "")} ${a.value}${a.unit} · 좋은 정렬을 유지하고 있습니다.`);
    }
  });
  const names = keys.map((k) => CARD_SHORT[k] || k).slice(0, 2).join("·");
  return {
    title: names ? `${names} 정렬 개선으로 바디라인이 달라졌어요!` : "체형이 이렇게 달라졌어요!",
    c1: lines[0] || "",
    c2: lines[1] || "",
    close: "가동성을 높이고, 근육의 균형을 바로잡는 것이 바른 체형의 시작입니다.",
  };
}

function ResultCardMaker({ member, saved, centerName, onToast, onGoAnalyze }) {
  const [open, setOpen] = useState(false);
  const usable = saved.filter((p) => p && p.pts && (p.cleanBlobId || p.blobId));
  const [bId, setBId] = useState(null);
  const [aId, setAId] = useState(null);
  const bRec = usable.find((p) => p.id === bId) || usable[usable.length - 1] || null;
  const aRec = usable.find((p) => p.id === aId) || (usable[0] && usable[0] !== bRec ? usable[0] : null);
  const both = bRec && aRec && bRec.id !== aRec.id;
  const commonKeys = both
    ? Object.keys(CARD_JOINTS).filter((k) => (bRec.metrics || []).some((m) => m.key === k) && (aRec.metrics || []).some((m) => m.key === k))
    : [];
  const [sel, setSel] = useState(null);
  const keys = sel || commonKeys.filter((k) => {
    const b = (bRec?.metrics || []).find((m) => m.key === k);
    return b && b.level !== "good";
  }).slice(0, 3);
  const [cb, setCb] = useState("#FFFFFF");
  const [ca, setCa] = useState("#FFD43B");
  const drafts = useMemo(() => (both ? cardDrafts(bRec, aRec, keys) : { title: "", c1: "", c2: "", close: "" }), [bId, aId, JSON.stringify(keys)]);
  const [txt, setTxt] = useState(null);
  const T = txt || drafts;
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  /* 색·문구·항목을 바꾸면 미리보기가 알아서 다시 그려진다 */
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!both || !keys.length) { setLive(null); return; }
    let alive = true;
    const id = setTimeout(async () => {
      try {
        const bSrc = (await urlFor(bRec.cleanBlobId || bRec.blobId)) || bRec.src;
        const aSrc = (await urlFor(aRec.cleanBlobId || aRec.blobId)) || aRec.src;
        if (!bSrc || !aSrc || !alive) return;
        const canvas = await composeResultCard({ bRec, aRec, bSrc, aSrc, keys, colors: { b: cb, a: ca }, texts: T, centerName });
        if (alive) setLive(canvas.toDataURL("image/jpeg", 0.72));
      } catch (e) {}
    }, 350);
    return () => { alive = false; clearTimeout(id); };
  }, [both, bRec?.id, aRec?.id, JSON.stringify(keys), cb, ca, T.title, T.c1, T.c2, T.close, centerName]);

  const build = async () => {
    if (!both) return;
    setBusy(true);
    try {
      const bSrc = (await urlFor(bRec.cleanBlobId || bRec.blobId)) || bRec.src;
      const aSrc = (await urlFor(aRec.cleanBlobId || aRec.blobId)) || aRec.src;
      if (!bSrc || !aSrc) throw new Error("no image");
      const canvas = await composeResultCard({ bRec, aRec, bSrc, aSrc, keys, colors: { b: cb, a: ca }, texts: T, centerName });
      setPreview({ canvas, url: canvas.toDataURL("image/jpeg", 0.9) });
    } catch (e) { onToast?.({ ok: false, msg: "카드를 만들지 못했습니다. 분석을 다시 저장해 보세요." }); }
    setBusy(false);
  };
  const doExport = async (saveOnly) => {
    if (!preview) return;
    const r = await exportCanvas(preview.canvas, `결과카드_${member?.name || "회원"}_${todayISO()}.jpg`, "체형 변화 카드", saveOnly);
    if (r.how === "fail") { onToast?.({ ok: false, msg: "이미지를 만들지 못했습니다." }); return; }
    if (r.how === "manual") { setPreview((p) => (p ? { ...p, manual: true } : p)); onToast?.({ ok: false, msg: "자동 저장이 막힌 환경입니다. 사진을 길게 눌러 저장해 주세요." }); return; }
    if (r.how === "saved") onToast?.({ ok: true, msg: "카드를 저장했습니다." });
    if (r.how === "gallery") onToast?.({ ok: true, msg: "사진 앱(갤러리)에 저장했습니다." });
    if (r.how === "copied") onToast?.({ ok: true, msg: "카드를 복사했습니다. 카톡 등에 붙여넣기 하세요." });
    setPreview(null);
  };

  const pickRec = (p, slot) => {
    if (slot === "b") { setBId(p.id); if (aId === p.id) setAId(null); }
    else { setAId(p.id); if (bId === p.id) setBId(null); }
    setSel(null); setTxt(null);
  };
  const dateOf = (p) => (p?.date || "").slice(5).replace("-", ".");

  return (
    <Card className="p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: GRAD }}><Star size={16} color="#fff" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold" style={{ color: INK }}>결과 카드 만들기</h3>
          <Sub>비포·애프터 분석을 골라 회원용 카드로</Sub>
        </div>
        <ChevronDown size={16} style={{ color: SUB, transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {usable.length < 2 ? (
            <div className="rounded-2xl p-4" style={{ backgroundColor: CANVAS }}>
              <p className="text-sm font-extrabold" style={{ color: INK }}>비포·애프터 사진이 둘 다 있어야 만들 수 있어요</p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: INK2 }}>
                <b style={{ color: PRIMARY }}>AI 체형 분석</b>에서 <b style={{ color: INK }}>비포 사진 1장</b>과 <b style={{ color: INK }}>애프터 사진 1장</b>을 각각 분석·저장하면
                여기서 자동으로 비교 카드가 만들어집니다. (지금 {usable.length}장)
              </p>
              {saved.length > usable.length && (
                <p className="mt-1 text-xs" style={{ color: WARN }}>예전에 저장한 분석은 관절 정보가 없어 카드에 못 씁니다 · 새로 분석해 주세요</p>
              )}
              {onGoAnalyze && (
                <button onClick={onGoAnalyze} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-extrabold text-white" style={{ background: GRAD }}>
                  <Camera size={15} /> 지금 사진 찍고 분석하기
                </button>
              )}
            </div>
          ) : (
            <>
              {both && (
                <div>
                  {live ? (
                    <button onClick={build} className="block w-full">
                      <img src={live} alt="실시간 미리보기" className="w-full rounded-2xl" style={{ boxShadow: SHADOW }} {...IMGP} />
                      <Sub className="mt-1 block text-center">아래에서 사진·색·문구를 바꾸면 바로 반영됩니다 · 누르면 크게 보고 저장</Sub>
                    </button>
                  ) : keys.length ? (
                    <div className="flex items-center justify-center gap-2 rounded-2xl py-10" style={{ backgroundColor: CANVAS }}>
                      <Loader2 size={16} className="animate-spin" style={{ color: PRIMARY }} /><Sub>미리보기 만드는 중…</Sub>
                    </div>
                  ) : (
                    <Sub className="block rounded-2xl py-10 text-center" style={{ backgroundColor: CANVAS }}>아래에서 보여줄 항목을 1개 이상 고르세요</Sub>
                  )}
                </div>
              )}
              {[{ slot: "b", label: "BEFORE", cur: bRec }, { slot: "a", label: "AFTER", cur: aRec }].map(({ slot, label, cur }) => (
                <div key={slot}>
                  <p className="mb-1 text-xs font-extrabold" style={{ color: SUB }}>{label} 사진 고르기 <span className="font-bold" style={{ color: PRIMARY }}>{usable.length}장 중</span></p>
                  <div className="flex flex-wrap gap-1.5">
                    {usable.map((p) => (
                      <button key={p.id} onClick={() => pickRec(p, slot)} className="rounded-full px-3 py-1.5 text-xs font-extrabold"
                        style={cur?.id === p.id ? { background: GRAD, color: "#fff" } : { backgroundColor: CANVAS, color: INK }}>
                        {dateOf(p)} · {p.view === "front" ? "전면" : p.view === "side" ? "측면" : "후면"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {both && bRec.view !== aRec.view && <Sub className="block" >⚠️ 두 분석의 방향(전면/측면/후면)이 다릅니다 · 같은 방향끼리 골라야 비교가 맞아요</Sub>}
              {both && (
                <>
                  <div>
                    <p className="mb-1 text-xs font-extrabold" style={{ color: SUB }}>보여줄 항목</p>
                    <div className="flex flex-wrap gap-1.5">
                      {commonKeys.map((k) => (
                        <button key={k} onClick={() => { const cur = new Set(keys); cur.has(k) ? cur.delete(k) : cur.add(k); setSel([...cur]); setTxt(null); }}
                          className="rounded-full px-3 py-1.5 text-xs font-extrabold"
                          style={keys.includes(k) ? { backgroundColor: TINT, color: PRIMARY, boxShadow: `inset 0 0 0 1.5px ${PRIMARY}` } : { backgroundColor: CANVAS, color: SUB }}>
                          {CARD_SHORT[k] || k}
                        </button>
                      ))}
                    </div>
                  </div>
                  {[{ l: "BEFORE 표시 색", v: cb, set: setCb }, { l: "AFTER 표시 색", v: ca, set: setCa }].map(({ l, v, set }) => (
                    <div key={l}>
                      <p className="mb-1 text-xs font-extrabold" style={{ color: SUB }}>{l}</p>
                      <div className="flex gap-2">
                        {CARD_COLORS.map((o) => (
                          <button key={o.k} onClick={() => set(o.c)} aria-label={o.name}
                            className="h-8 w-8 rounded-full"
                            style={{ backgroundColor: o.c, border: o.c === "#FFFFFF" ? `1px solid ${LINE}` : "none", boxShadow: v === o.c ? `0 0 0 3px ${CARD}, 0 0 0 5px ${PRIMARY}` : "none" }} />
                        ))}
                      </div>
                    </div>
                  ))}
                  {[{ k: "title", l: "제목" }, { k: "c1", l: "체크 문장 1" }, { k: "c2", l: "체크 문장 2" }, { k: "close", l: "마무리 문장" }].map(({ k, l }) => (
                    <Field key={k} label={l} hint="자동 초안 · 고쳐 쓸 수 있어요">
                      <input value={T[k]} onChange={(e) => setTxt({ ...T, [k]: e.target.value })} className={inputCls} />
                    </Field>
                  ))}
                  <PrimaryBtn disabled={busy || !keys.length} onClick={build}>
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} 크게 보고 저장하기
                  </PrimaryBtn>
                  {!keys.length && <Sub className="block text-center">보여줄 항목을 1개 이상 고르세요</Sub>}
                </>
              )}
            </>
          )}
        </div>
      )}
      {preview && (
        <div className="safe-all fixed inset-0 z-50 flex flex-col bg-photo">
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={() => setPreview(null)} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
            <p className="text-sm font-bold text-white">이렇게 만들어집니다</p>
            <span style={{ width: 34 }} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
            <img src={preview.url} alt="결과 카드" className="block h-auto rounded-2xl" style={{ maxWidth: "min(100%, 640px)", maxHeight: "72%", objectFit: "contain" }} {...IMGP} />
            <p className="mt-3 text-center text-xs" style={{ color: "rgba(255,255,255,.7)" }}>
              {preview.manual ? "위 사진을 길게 눌러 저장하세요" : "마음에 안 들면 닫고 색·문구를 바꿔 보세요"}
            </p>
          </div>
          <div className="flex gap-2 px-4 pb-5 pt-3">
            <button onClick={() => doExport(true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3.5 text-sm font-extrabold" style={{ backgroundColor: "rgba(255,255,255,0.92)", color: "#17171F" }}>
              <Download size={16} /> 내 폰에 저장
            </button>
            <button onClick={() => doExport(false)} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3.5 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}>
              <Upload size={16} /> 회원에게 보내기
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SavedPoseViewer({ rec, memberName, onClose, onToast }) {
  useBackClose(true, onClose);
  useScrollLock();
  return (
    <div className="safe-all fixed inset-0 z-50 flex flex-col bg-photo">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
        <p className="text-sm font-bold text-white">{memberName || "회원"} · {ymd(rec.date)} · {rec.view === "front" ? "전면" : rec.view === "side" ? "측면" : "후면"}</p>
        <button onClick={async () => {
          try { await navigator.clipboard.writeText(rec.comment || ""); onToast?.({ ok: true, msg: "코멘트를 복사했습니다." }); }
          catch (e) { onToast?.({ ok: false, msg: "복사하지 못했습니다." }); }
        }} className="rounded-full px-3 py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>코멘트 복사</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {rec.src
          ? <img src={rec.src} alt="분석 결과" className="mx-auto rounded-2xl" style={{ maxWidth: "min(100%, 620px)" }} />
          : <div className="mx-auto rounded-2xl px-4 py-10 text-center" style={{ maxWidth: 620, backgroundColor: "rgba(255,255,255,0.08)" }}>
              <p className="text-sm font-bold text-white">이 분석은 이미지가 남아 있지 않습니다</p>
              <p className="mt-1 text-xs text-white opacity-60">다른 기기에서 만든 기록이거나 저장 공간이 부족했던 경우입니다. 수치는 아래에 그대로 있습니다.</p>
            </div>}
        <div className="mx-auto mt-3 space-y-2" style={{ maxWidth: 620 }}>
          {(rec.metrics || []).map((m, i) => (
            <div key={i} className="flex items-center gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: LV_COLOR[m.level] || SUB }} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">{m.label}</span>
              <span className="text-base font-extrabold tabular-nums" style={{ color: LV_COLOR[m.level] || "#fff" }}>{m.value}{m.unit}</span>
              <span className="shrink-0 text-xs font-bold text-white opacity-70">{m.dir}</span>
            </div>
          ))}
          {rec.comment && (
            <div className="rounded-xl px-3 py-3" style={{ backgroundColor: "rgba(76,67,153,.18)" }}>
              <p className="text-xs font-extrabold text-white opacity-80">저장된 코멘트</p>
              <p className="mt-1 text-sm leading-relaxed text-white">{rec.comment}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PoseAnalyzer({ member, photos, onSavePose, onDeletePose, onSaveCaptureDraft, onToast, onSaved, roleLabel, embedded = false, initialSavedId = null }) {
  const [engine, setEngine] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState(null);
  const [pts, setPts] = useState(null);
  const [view, setView] = useState("front");
  const [analysisMethod, setAnalysisMethod] = useState(null);
  const [captureTarget, setCaptureTarget] = useState("front");
  const [capturePhotos, setCapturePhotos] = useState({ front: null, side: null, back: null });
  const [draftSaved, setDraftSaved] = useState({});
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const [analyzedViews, setAnalyzedViews] = useState({});
  const analysisMemberId = useRef(member?.id || null);
  const [mirror, setMirror] = useState(false);
  const [floorFix, setFloorFix] = useState(false);
  const [showSkel, setShowSkel] = useState(true);
  const [showNum, setShowNum] = useState(true);
  const [manual, setManual] = useState(null);
  const [choice, setChoice] = useState(false);  /* 사진 직후: AI / 직접 이지선다 */
  /* 관절을 정확히 찍으려면 확대가 필요하다 — 두 손가락으로 자유롭게 */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pz = useRef(new Map());
  const pinch = useRef(null);
  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const [faceDir, setFaceDir] = useState(1);
  const [open, setOpen] = useState(embedded);
  const [seeSaved, setSeeSaved] = useState(null);
  const [hot, setHot] = useState(null);
  const canvasRef = useRef(null), imgRef = useRef(null), dragRef = useRef(null);
  const camRef = useRef(null), albumRef = useRef(null);
  const saved = (photos?.poses || []).filter((p) => p && p.metrics);
  const analysisRole = useRef(saved.length === 0 ? "before" : "after");
  const captureViews = VIEWS;
  const capturesComplete = captureViews.every(({ key }) => !!capturePhotos[key]);
  const poseView = view === "back" ? "front" : view;

  useEffect(() => {
    if (initialSavedId) setSeeSaved(saved.find((p) => p.id === initialSavedId) || null);
  }, [initialSavedId, member?.id]);

  useEffect(() => {
    if (!open || engine !== "idle") return;
    let alive = true;
    setEngine("loading");
    loadLandmarker().then(() => { if (alive) setEngine("ready"); }).catch(() => { if (alive) setEngine("manual"); });
    return () => { alive = false; };
  }, [open, engine]);

  const res = useMemo(() => {
    if (!pts || !img) return null;
    const P = { ...pts };
    if (mirror && poseView === "front") {
      ["ear", "sh", "hip", "knee", "ank", "el", "wr", "foot"].forEach((b) => {
        const L = b + "L", R = b + "R";
        if (P[L] || P[R]) { const t = P[L]; P[L] = P[R]; P[R] = t; }
      });
    }
    if (poseView === "side" && !P.nose) P.nose = { x: (P.ear?.x ?? 0.5) + faceDir * 0.05, y: P.ear?.y ?? 0.2, score: 1 };
    return analyzePose(P, { view: poseView, W: img.w, H: img.h, floorFix });
  }, [pts, img, poseView, mirror, floorFix, faceDir]);

  const draw = useCallback(() => {
    const c = canvasRef.current, im = imgRef.current;
    if (!c || !im || !img) return;
    c.width = img.w; c.height = img.h;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0, c.width, c.height);
    if (!pts) return;
    const S = (p) => ({ x: p.x * c.width, y: p.y * c.height });
    const bones = poseView === "front" ? BONES_FRONT : BONES_SIDE;
    const k = Math.max(1, c.width / 520);
    if (showSkel) {
      ctx.save(); ctx.setLineDash([8 * k, 8 * k]); ctx.lineWidth = 1.6 * k; ctx.strokeStyle = "rgba(255,255,255,.75)";
      const hline = (p) => { const q = S(p); ctx.beginPath(); ctx.moveTo(0, q.y); ctx.lineTo(c.width, q.y); ctx.stroke(); };
      const vline = (p) => { const q = S(p); ctx.beginPath(); ctx.moveTo(q.x, 0); ctx.lineTo(q.x, c.height); ctx.stroke(); };
      if (poseView === "front") {
        if (pts.shL && pts.shR) hline(midOf(pts.shL, pts.shR));
        if (pts.hipL && pts.hipR) hline(midOf(pts.hipL, pts.hipR));
        if (pts.ankL && pts.ankR) vline(midOf(pts.ankL, pts.ankR));
      } else if (pts.ank) vline(pts.ank);
      ctx.restore();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      bones.forEach(([a, b]) => {
        if (!pts[a] || !pts[b]) return;
        const p = S(pts[a]), q = S(pts[b]);
        ctx.save();
        ctx.strokeStyle = "rgba(76,67,153,.25)"; ctx.lineWidth = 9 * k;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.strokeStyle = BRAND; ctx.lineWidth = 3.2 * k;
        ctx.shadowColor = "rgba(76,67,153,.35)"; ctx.shadowBlur = 10 * k;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.restore();
      });
      Object.keys(pts).forEach((key) => {
        const p = S(pts[key]);
        const on = hot === key;
        const r = (on ? 11 : 7) * k;
        ctx.save();
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6);
        halo.addColorStop(0, on ? "rgba(76,67,153,.46)" : "rgba(76,67,153,.25)");
        halo.addColorStop(1, "rgba(76,67,153,0)");
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2); ctx.fill();
        if (on) { ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.4 * k; ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2); ctx.stroke(); }
        ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 6 * k;
        ctx.fillStyle = "rgba(255,255,255,.98)"; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = BRAND; ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.46, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
      if (hot && pts[hot]) {
        const p = S(pts[hot]);
        ctx.save();
        ctx.setLineDash([6 * k, 7 * k]); ctx.lineWidth = 1.2 * k; ctx.strokeStyle = "rgba(255,255,255,.55)";
        ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(c.width, p.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, c.height); ctx.stroke();
        ctx.restore();
        const R = Math.round(Math.min(c.width, c.height) * 0.14), Z = 2.6;
        const cx = p.x < c.width / 2 ? c.width - R - 14 * k : R + 14 * k;
        const cy = R + 14 * k;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 22;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = "#000"; ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(im, p.x - R / Z, p.y - R / Z, (2 * R) / Z, (2 * R) / Z, cx - R, cy - R, 2 * R, 2 * R);
        ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
        ctx.strokeStyle = LAVENDER; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,.92)"; ctx.lineWidth = 3; ctx.stroke();
        const name = jointName(hot, poseView);
        ctx.font = `700 ${13 * k}px Pretendard, -apple-system, sans-serif`;
        const tw = ctx.measureText(name).width, bw = tw + 18 * k, bh = 26 * k;
        const bx = Math.max(6, Math.min(c.width - bw - 6, cx - bw / 2)), by = cy + R + 10 * k;
        ctx.fillStyle = "rgba(17,17,31,.86)";
        ctx.beginPath();
        const rr = bh / 2;
        ctx.moveTo(bx + rr, by); ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr); ctx.arcTo(bx, by + bh, bx, by, rr);
        ctx.arcTo(bx, by, bx + bw, by, rr); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(name, bx + bw / 2, by + bh / 2 + 1);
      }
    }
    if (showNum && res) {
      const placed = [];
      res.items.filter((i) => !i.skipBadge).forEach((i) => {
        badge(ctx, i.at.x * (c.width / img.w), i.at.y * (c.height / img.h), `${i.label.replace(/\(.*\)/, "").trim()} ${i.value}${i.unit}`, LV_COLOR[i.level], i.up ?? -1, placed, c.width, c.height);
      });
    }
  }, [img, pts, poseView, showSkel, showNum, res, hot]);
  useEffect(() => { draw(); }, [draw]);

  const pickFile = async (file) => {
    if (!file) return;
    setBusy(true); setPts(null);
    try {
      const blob = await fileToBlob(file, 1000);
      const src = URL.createObjectURL(blob);
      const im = new window.Image();
      im.onload = async () => {
        const captured = { src, blob, w: im.naturalWidth, h: im.naturalHeight, element: im };
        setCapturePhotos((prev) => {
          const old = prev[captureTarget];
          if (old?.src?.startsWith("blob:")) { try { URL.revokeObjectURL(old.src); } catch (e) {} }
          return { ...prev, [captureTarget]: captured };
        });
        setDraftSaved((prev) => ({ ...prev, [captureTarget]: false }));
        setBusy(false);
        const nextTarget = captureViews.find(({ key }) => key !== captureTarget && !capturePhotos[key]);
        if (nextTarget) setCaptureTarget(nextTarget.key);
      };
      im.onerror = () => { setBusy(false); try { URL.revokeObjectURL(src); } catch (e) {} onToast?.({ ok: false, msg: "사진을 읽지 못했습니다." }); };
      im.src = src;
    } catch (e) { setBusy(false); onToast?.({ ok: false, msg: "사진을 읽지 못했습니다." }); }
  };
  const detect = async (im, requestedView = view) => {
    try {
      const lm = await loadLandmarker();
      const out = lm.detect(im);
      const marks = out?.landmarks?.[0];
      if (!marks || !marks.length) { onToast?.({ ok: false, msg: "사람을 찾지 못했습니다. 관절을 직접 지정해 주세요." }); return false; }
      const next = {};
      Object.keys(MP_IDX).forEach((k) => {
        const m = marks[MP_IDX[k]];
        if (m) next[k] = { x: m.x, y: m.y, score: m.visibility ?? 1 };
      });
      if (!(next.shL && next.shR && next.hipL && next.hipR)) {
        onToast?.({ ok: false, msg: "전신이 다 나오지 않았습니다. 머리부터 발끝까지 나온 사진을 올려주세요." });
        return false;
      }
      if (requestedView === "side") {
        const s = (a, b) => ((next[a]?.score ?? 0) >= (next[b]?.score ?? 0) ? next[a] : next[b]);
        next.ear = s("earL", "earR"); next.sh = s("shL", "shR"); next.hip = s("hipL", "hipR");
        next.knee = s("kneeL", "kneeR"); next.ank = s("ankL", "ankR");
        setView("side");
        setFaceDir(next.nose && next.sh ? (next.nose.x >= next.sh.x ? 1 : -1) : 1);
      } else setView(requestedView);
      setPts(next); setManual(null); setEngine("ready");
      onToast?.({ ok: true, msg: `관절 ${Object.keys(next).length}개를 인식했습니다.` });
      return true;
    } catch (e) { setEngine("manual"); return false; }
  };
  const startManual = (v) => {
    const vv = v || view;
    setView(vv); setPts({});
    setManual({ seq: vv === "side" ? MANUAL_SIDE : MANUAL_FRONT, i: 0 });
  };
  const beginCapturedAnalysis = async (nextView = "front") => {
    if (!capturesComplete) {
      onToast?.({ ok: false, msg: "전면·측면·후면 사진을 모두 촬영해 주세요." });
      return;
    }
    if (analysisMemberId.current !== member?.id) {
      onToast?.({ ok: false, msg: "분석 대상 회원이 변경되어 진행할 수 없습니다." });
      return;
    }
    const captured = capturePhotos[nextView];
    if (!captured?.element) return;
    setBusy(true);
    setAnalysisStarted(true);
    setCaptureTarget(nextView);
    setView(nextView);
    setPts(null);
    setManual(null);
    setChoice(false);
    imgRef.current = captured.element;
    setImg({ src: captured.src, w: captured.w, h: captured.h });
    if (analysisMethod === "manual") {
      startManual(nextView);
      setBusy(false);
      return;
    }
    const ok = await detect(captured.element, nextView);
    setBusy(false);
    if (!ok) {
      onToast?.({ ok: false, msg: `${VIEWS.find((v) => v.key === nextView)?.label} 관절을 찾지 못했습니다. 직접 찍기로 전환합니다.` });
      startManual(nextView);
    }
  };
  const saveCaptureDraft = async () => {
    if (!capturesComplete || !onSaveCaptureDraft) return;
    if (analysisMemberId.current !== member?.id) {
      onToast?.({ ok: false, msg: "분석 대상 회원이 변경되어 초안을 저장하지 않았습니다." });
      return;
    }
    setBusy(true);
    try {
      const pending = Object.fromEntries(captureViews
        .filter(({ key }) => !draftSaved[key] && capturePhotos[key]?.blob)
        .map(({ key }) => [key, capturePhotos[key].blob]));
      await onSaveCaptureDraft(pending);
      setDraftSaved({ front: true, side: true, back: true });
      onToast?.({ ok: true, msg: "3방향 촬영 초안을 회원 사진 기록에 저장했습니다." });
    } finally { setBusy(false); }
  };
  const toNorm = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch (e) {} };
  const onDown = (e) => {
    if (!img) return;
    pz.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    /* 손가락이 둘이면 관절을 찍지 않고 확대·이동으로 전환 */
    if (pz.current.size === 2) {
      const [a, b] = [...pz.current.values()];
      dragRef.current = null; setHot(null);
      pinch.current = {
        d0: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        z0: zoom, px: pan.x, py: pan.y,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (pz.current.size > 1) return;
    const n = toNorm(e);
    let near = null, best = 0.055;
    Object.keys(pts || {}).forEach((k) => {
      const d = Math.hypot(pts[k].x - n.x, pts[k].y - n.y);
      if (d < best) { best = d; near = k; }
    });
    if (near) { dragRef.current = near; setHot(near); buzz(8); e.currentTarget.setPointerCapture?.(e.pointerId); return; }
    if (manual && manual.i < manual.seq.length) {
      const key = manual.seq[manual.i];
      setPts((p) => ({ ...(p || {}), [key]: { x: n.x, y: n.y, score: 1 } }));
      setManual((m) => ({ ...m, i: m.i + 1 }));
      dragRef.current = key; setHot(key); buzz(6);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
  };
  const onMove = (e) => {
    if (pz.current.has(e.pointerId)) pz.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pz.current.size >= 2) {
      e.preventDefault?.();
      const [a, b] = [...pz.current.values()];
      const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const g = pinch.current;
      const z = Math.min(5, Math.max(1, g.z0 * (d / g.d0)));
      setZoom(z);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      setPan({ x: g.px + (mx - g.mx), y: g.py + (my - g.my) });
      return;
    }
    if (pz.current.size > 1) return;
    if (!dragRef.current) return;
    e.preventDefault?.();
    const n = toNorm(e);
    setPts((p) => ({ ...p, [dragRef.current]: { ...p[dragRef.current], x: n.x, y: n.y } }));
  };
  const onUp = (e) => {
    if (e && e.pointerId != null) pz.current.delete(e.pointerId);
    if (pz.current.size < 2) pinch.current = null;
    if (zoom <= 1.02 && (pan.x !== 0 || pan.y !== 0)) setPan({ x: 0, y: 0 });
    if (pz.current.size >= 1) return;
    if (dragRef.current) buzz(4);
    dragRef.current = null; setHot(null);
  };
  const undoPoint = () => {
    if (!manual || manual.i === 0) return;
    const key = manual.seq[manual.i - 1];
    setPts((p) => { const q = { ...(p || {}) }; delete q[key]; return q; });
    setManual((m) => ({ ...m, i: m.i - 1 }));
  };
  const download = () => shareCanvas(canvasRef.current, `${member?.name || "회원"}_체형분석_${todayISO()}.jpg`, "체형 분석", onToast);
  /* 분석 화면(뼈대·각도 포함)을 이미지로 내보낸다 */
  const shot = async (saveOnly = true) => {
    const c = canvasRef.current; if (!c) return;
    const name = `체형분석_${member?.name || "회원"}_${todayISO()}.jpg`;
    const r = await exportCanvas(c, name, "체형 분석", saveOnly);
    if (r.how === "fail") { onToast?.({ ok: false, msg: "이미지를 만들지 못했습니다." }); return; }
    if (r.how === "manual") { onToast?.({ ok: false, msg: "자동 저장이 막힌 환경입니다. 아래 사진을 길게 눌러 저장해 주세요." }); return; }
    if (r.how === "gallery") onToast?.({ ok: true, msg: "사진 앱(갤러리)에 저장했습니다." });
    if (r.how === "saved") onToast?.({ ok: true, msg: "이미지를 저장했습니다." });
    if (r.how === "copied") onToast?.({ ok: true, msg: "이미지를 복사했습니다." });
  };
  const save = async () => {
    if (!res || !res.items.length) return;
    if (analysisMemberId.current !== member?.id) {
      onToast?.({ ok: false, msg: "분석 대상 회원이 변경되어 저장하지 않았습니다." });
      return;
    }
    let blob = null, cleanBlob = null;
    try {
      const c = document.createElement("canvas");
      const s = Math.min(1, 520 / Math.max(canvasRef.current.width, canvasRef.current.height));
      c.width = Math.round(canvasRef.current.width * s); c.height = Math.round(canvasRef.current.height * s);
      c.getContext("2d").drawImage(canvasRef.current, 0, 0, c.width, c.height);
      blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.72));
    } catch (e) {}
    try {
      /* 결과 카드용 — 뼈대 없는 원본을 따로 담는다 */
      const c2 = document.createElement("canvas"), im = imgRef.current;
      const s2 = Math.min(1, 760 / Math.max(im.naturalWidth, im.naturalHeight));
      c2.width = Math.round(im.naturalWidth * s2); c2.height = Math.round(im.naturalHeight * s2);
      c2.getContext("2d").drawImage(im, 0, 0, c2.width, c2.height);
      cleanBlob = await new Promise((r) => c2.toBlob(r, "image/jpeg", 0.8));
    } catch (e) {}
    const slim = {};
    Object.keys(pts || {}).forEach((k) => { const p = pts[k]; if (p) slim[k] = { x: r3(p.x), y: r3(p.y) }; });
    await onSavePose?.({
      id: uid(), date: todayISO(), view, memberId: analysisMemberId.current, blob, cleanBlob, pts: slim, mirror,
      metrics: res.items.map((i) => ({ key: i.key, label: i.label, value: i.value, unit: i.unit, level: i.level, dir: i.dir })),
      comment: poseComment(member, view, res),
    });
    const nextAnalyzed = { ...analyzedViews, [view]: true };
    setAnalyzedViews(nextAnalyzed);
    setPts(null); setManual(null); setChoice(false); setZoom(1); setPan({ x: 0, y: 0 });
    onToast?.({ ok: true, msg: `${roleLabel || "분석"}을 저장했습니다.` });
    const nextView = captureViews.find(({ key }) => !nextAnalyzed[key])?.key;
    if (nextView) {
      await beginCapturedAnalysis(nextView);
    } else {
      setImg(null);
      setAnalysisStarted(false);
      setAnalysisMethod(null);
      setAnalyzedViews({});
      setCapturePhotos({ front: null, side: null, back: null });
      setCaptureTarget("front");
      onSaved?.(analysisRole.current);
    }
  };
  const copy = async () => {
    const txt = poseComment(member, view, res);
    try { await navigator.clipboard.writeText(txt); onToast?.({ ok: true, msg: "코멘트를 복사했습니다." }); }
    catch (e) { onToast?.({ ok: false, msg: "복사가 지원되지 않는 환경입니다." }); }
  };
  const worst = res ? [...res.items].sort((a, b) => LV_RANK[b.level] - LV_RANK[a.level] || b.value - a.value)[0] : null;
  const history = saved.filter((s) => s.view === view);
  const trend = (key) => {
    const list = history.filter((h) => h.metrics.some((m) => m.key === key)).slice(0, 6);
    if (list.length < 2) return null;
    const now = list[0].metrics.find((m) => m.key === key).value;
    const old = list[list.length - 1].metrics.find((m) => m.key === key).value;
    return { diff: r1(now - old), from: list[list.length - 1].date };
  };
  return (
    <Card className={embedded ? "p-3" : "p-5"}>
      {!embedded && <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: GRAD }}>
          <Activity size={16} color="#fff" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold" style={{ color: INK }}>AI 체형 분석</span>
          <Sub>전면·측면·후면 사진으로 관절 정렬을 확인</Sub>
        </span>
        {saved.length > 0 && <span className="rounded-full px-2 py-1 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>{saved.length}건</span>}
        <ChevronRight size={16} style={{ color: SUB, transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
      </button>}
      {!embedded && !open && (
        <button onClick={() => setOpen(true)} className="mt-3 flex w-full items-center gap-3 rounded-2xl p-3 text-left" style={{ background: GRAD_SOFT, border: `1px solid ${LINE}` }}>
          <PoseMock />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold" style={{ color: INK }}>이렇게 나옵니다</span>
            <span className="mt-1 block text-xs leading-relaxed" style={{ color: INK2 }}>
              전신 사진을 올리면 어깨 · 골반 · 무릎을 찾아 좌우 기울기를 각도로 재고, 보완 운동까지 알려 줍니다.
            </span>
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: BRAND, color: "#fff" }}>
              사진 올리고 분석하기
            </span>
          </span>
        </button>
      )}
      {open && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
            <p className="text-xs font-bold" style={{ color: SUB }}>분석 대상</p>
            <p className="mt-0.5 text-sm font-extrabold" style={{ color: INK }}>{member?.name || "회원"}</p>
          </div>
          {!analysisMethod && (
          <div className="grid gap-2">
              <button onClick={() => setAnalysisMethod("ai")} className="p-3.5 text-left" style={{ borderRadius: 14, backgroundColor: LAVENDER_S, border: `1.5px solid ${LAVENDER}` }}>
                <p className="flex items-center gap-1.5 text-[15px] font-bold" style={{ color: INK }}><Sparkles size={15} style={{ color: LAVENDER }} /> AI 체형분석</p>
                <Sub className="mt-1">3방향 촬영 후 관절을 자동 추출하고 직접 보정합니다.</Sub>
              </button>
              <button onClick={() => setAnalysisMethod("manual")} className="p-3.5 text-left" style={{ borderRadius: 14, backgroundColor: CARD, border: `1.5px solid ${LINE}` }}>
                <p className="flex items-center gap-1.5 text-[15px] font-bold" style={{ color: INK }}><Crosshair size={15} style={{ color: BRAND }} /> 직접 체형분석</p>
                <Sub className="mt-1">3방향 촬영 후 관절 포인트를 순서대로 직접 입력합니다.</Sub>
              </button>
            </div>
          )}
          {analysisMethod && !analysisStarted && (
            <>
              <div className="flex items-center"><h2 style={{ fontSize: 16, fontWeight: 700, color: INK }}>체형 사진 등록</h2><span className="ml-2 tabular-nums" style={{ fontSize: 12, color: SUB }}>{captureViews.filter(({ key }) => !!capturePhotos[key]).length}/3</span></div>
              <p style={{ marginTop: -6, fontSize: 12.5, color: INK2 }}>정확한 비교를 위해 같은 위치와 거리에서 촬영해주세요.</p>
              <div className="flex flex-col gap-2.5">
                {captureViews.map((capture) => {
                  const photo = capturePhotos[capture.key];
                  const guide = {
                    front: ["양발 간격을 맞추고 정면을 바라봐 주세요", "머리부터 발끝까지 전신이 보이게 촬영해 주세요"],
                    side: ["카메라에 어깨와 골반의 옆선이 보이게 서 주세요", "고개를 들거나 숙이지 말고 자연스럽게 바라봐 주세요"],
                    back: ["등과 양쪽 발뒤꿈치가 모두 보이게 서 주세요", "전면과 같은 거리와 높이에서 촬영해 주세요"],
                  }[capture.key];
                  return (
                    <div key={capture.key} style={{ padding: 12, borderRadius: 14, backgroundColor: CARD, border: `1px solid ${captureTarget === capture.key ? BRAND : LINE}` }}>
                      <div className="flex items-center gap-1.5"><h3 style={{ fontSize: 14, fontWeight: 700, color: INK }}>{capture.label}</h3><span className="flex items-center gap-1" style={{ padding: "2px 7px", borderRadius: 6, backgroundColor: photo ? GOOD_S : CANVAS, color: photo ? GOOD : INK2, fontSize: 10, fontWeight: 700 }}>{photo && <Check size={11} />}{photo ? "등록 완료" : "미등록"}</span><span className="flex-1" />
                        {photo && <><button type="button" onClick={() => { setCaptureTarget(capture.key); albumRef.current?.click(); }} disabled={busy} style={{ minHeight: 34, padding: "0 10px", borderRadius: 8, border: `1px solid ${LINE}`, color: INK2, fontSize: 12, fontWeight: 600 }}>교체</button><button type="button" onClick={() => {
                               if (photo.src?.startsWith("blob:")) { try { URL.revokeObjectURL(photo.src); } catch (e) {} }
                               setCapturePhotos((prev) => ({ ...prev, [capture.key]: null }));
                               setDraftSaved((prev) => ({ ...prev, [capture.key]: false }));
                               setCaptureTarget(capture.key);
                            }} disabled={busy} style={{ minHeight: 34, padding: "0 10px", borderRadius: 8, border: `1px solid ${LINE}`, color: BAD, fontSize: 12, fontWeight: 600 }}>삭제</button></>}
                      </div>
                      {photo ? <div className="mt-2 flex gap-2.5"><img src={photo.src} alt={`${capture.label} 촬영 사진`} className="object-cover" style={{ width: 72, height: 104, borderRadius: 8, border: `1px solid ${LINE}`, backgroundColor: PHOTO }} /><div className="min-w-0 flex-1"><p className="truncate" style={{ fontSize: 12, color: INK }}>촬영 사진</p><button type="button" onClick={() => { setCaptureTarget(capture.key); camRef.current?.click(); }} className="mt-2" style={{ minHeight: 34, padding: "0 10px", borderRadius: 8, backgroundColor: TINT, color: BRAND_D, fontSize: 12, fontWeight: 600 }}>재촬영</button></div></div>
                        : <button type="button" onClick={() => { setCaptureTarget(capture.key); camRef.current?.click(); }} disabled={busy} className="mt-2.5 flex w-full items-center justify-center gap-2" style={{ minHeight: 84, borderRadius: 10, border: `1.5px dashed #D5DAE3`, backgroundColor: CANVAS, color: INK2, fontSize: 13, fontWeight: 600 }}><Camera size={17} style={{ color: BRAND }} />촬영 · 불러오기</button>}
                      <p style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.6, color: SUB }}>{guide.map((line) => <span key={line}>· {line}<br /></span>)}</p>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-2xl p-4" style={{ backgroundColor: CANVAS }}>
                <p className="text-sm font-bold" style={{ color: INK }}>촬영 가이드</p>
                <ul className="mt-2 space-y-1 text-xs leading-relaxed" style={{ color: SUB }}>
                  <li>· 발끝부터 머리끝까지 전신이 들어가게, 카메라는 골반 높이에서 수평으로</li>
                  <li>· 몸에 붙는 옷 · 맨발 · 벽에서 30cm 떨어져 전면·측면·후면으로 자연스럽게 서기</li>
                  <li>· 세 방향을 같은 자리·같은 거리에서 촬영하고 사진을 확인해 주세요</li>
                </ul>
              </div>
              <button onClick={saveCaptureDraft} disabled={!captureViews.some(({ key }) => !!capturePhotos[key]) || busy || !onSaveCaptureDraft}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-bold disabled:opacity-40"
                style={{ backgroundColor: CARD, color: PRIMARY, border: `1px solid ${LINE}` }}>
                <Download size={14} /> {captureViews.every(({ key }) => draftSaved[key]) ? "촬영 초안 저장됨" : "촬영 초안 저장"}
              </button>
              <button onClick={() => beginCapturedAnalysis("front")} disabled={!capturesComplete || busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3.5 text-sm font-extrabold text-white disabled:opacity-40" style={{ background: GRAD }}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : analysisMethod === "ai" ? <Sparkles size={15} /> : <Crosshair size={15} />}
                {capturesComplete ? `${analysisMethod === "ai" ? "AI 관절 추출" : "직접 입력"} 시작` : "전면·측면·후면 촬영을 완료해 주세요"}
              </button>
            </>
          )}
          <input ref={albumRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickFile(f); }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickFile(f); }} />
          {analysisStarted && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5" style={{ background: GRAD_SOFT }}>
              <span className="text-xs font-extrabold" style={{ color: PRIMARY }}>{VIEWS.find((v) => v.key === view)?.label} 분석</span>
              {engine === "loading" && <><Loader2 size={13} className="animate-spin" style={{ color: PRIMARY }} /><Sub>AI 관절 인식 모델을 불러오는 중…</Sub></>}
              {engine === "ready" && <><Sparkles size={13} style={{ color: PRIMARY }} /><span className="text-xs font-bold" style={{ color: PRIMARY }}>AI 자동 인식 사용 가능</span></>}
              {engine === "manual" && <><AlertTriangle size={13} style={{ color: WARN }} /><span className="text-xs font-bold" style={{ color: WARN }}>수동 지정 모드로 계산합니다</span></>}
              {img && !manual && <button onClick={() => startManual(view)} className="ml-auto rounded-xl px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: PRIMARY }}>관절 직접 찍기</button>}
              {img && analysisMethod === "ai" && engine === "ready" && (
                <button onClick={() => beginCapturedAnalysis(view)} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>AI로 다시 인식</button>
              )}
            </div>
          )}
          {img && (
            <>
              <div className="flex items-center gap-2">
                <Sub className="min-w-0 flex-1">두 손가락으로 벌리면 확대 · 오므리면 축소 · 확대한 채로 밀어서 이동</Sub>
                {zoom > 1.02 && (
                  <button onClick={resetZoom} className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>
                    {zoom.toFixed(1)}× · 원래대로
                  </button>
                )}
              </div>
              <div className="relative overflow-hidden rounded-2xl bg-photo" style={{ touchAction: "none" }}>
                <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                  className="block w-full touch-none"
                  style={{ height: "auto", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }} />
                {choice && !busy && !pts && !manual && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-6" style={{ backgroundColor: "rgba(10,10,16,.72)" }}>
                    <p className="text-sm font-extrabold text-white">어떻게 분석할까요?</p>
                    <button disabled={engine !== "ready"}
                      onClick={async () => { setChoice(false); setBusy(true); const ok = await detect(imgRef.current); setBusy(false); if (!ok) { onToast?.({ ok: false, msg: "AI가 관절을 찾지 못했습니다. 직접 찍기로 전환합니다." }); startManual(); } }}
                      className="w-full max-w-xs rounded-2xl px-4 py-4 text-left" style={{ backgroundColor: engine === "ready" ? CARD : "rgba(255,255,255,.25)", opacity: engine === "ready" ? 1 : 0.75 }}>
                      <p className="flex items-center gap-1.5 text-sm font-extrabold" style={{ color: engine === "ready" ? PRIMARY : "#fff" }}><Sparkles size={15} /> AI 자동 분석</p>
                      <p className="mt-0.5 text-xs" style={{ color: engine === "ready" ? SUB : "rgba(255,255,255,.85)" }}>
                        {engine === "ready" ? "관절을 자동으로 찾고, 틀린 점만 손으로 고칩니다" : engine === "loading" ? "AI 준비 중입니다 · 아래 직접 분석은 바로 가능해요" : "이 환경에선 AI를 쓸 수 없어요 · 직접 분석으로 진행하세요"}
                      </p>
                    </button>
                    <button onClick={() => { setChoice(false); startManual(); }}
                      className="w-full max-w-xs rounded-2xl px-4 py-4 text-left" style={{ backgroundColor: CARD }}>
                      <p className="flex items-center gap-1.5 text-sm font-extrabold" style={{ color: INK }}><Crosshair size={15} /> 직접 분석하기</p>
                      <p className="mt-0.5 text-xs" style={{ color: SUB }}>AI 없이 점을 순서대로 직접 찍습니다</p>
                    </button>
                  </div>
                )}
                {manual && manual.i < manual.seq.length && (
                  <>
                    <div className="absolute inset-x-0 top-0 flex justify-center gap-1 p-3">
                      {manual.seq.map((s, idx) => (
                        <span key={s} className="h-1 flex-1 rounded-full transition-all"
                          style={{ backgroundColor: idx < manual.i ? MINT : idx === manual.i ? "#fff" : "rgba(255,255,255,.28)", maxWidth: 26 }} />
                      ))}
                    </div>
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
                      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl px-3 py-2.5"
                        style={{ backgroundColor: "rgba(17,17,31,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,.14)" }}>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: GRAD }}>
                          <Crosshair size={14} color="#fff" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-extrabold text-white">{manualHint(manual.seq[manual.i], poseView)}</span>
                          <span className="block text-xs" style={{ color: "rgba(255,255,255,.6)" }}>{manual.i + 1} / {manual.seq.length} · 찍은 뒤 끌어서 미세 조정</span>
                        </span>
                        {manual.i > 0 && (
                          <button onClick={undoPoint} className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: "rgba(255,255,255,.16)" }}>이전</button>
                        )}
                        <button onClick={() => setManual(null)} className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-bold" style={{ backgroundColor: "rgba(255,255,255,.16)", color: "rgba(255,255,255,.75)" }}>중단</button>
                      </div>
                    </div>
                  </>
                )}
                {pts && Object.keys(pts).length > 0 && !manual && (
                  <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold text-white"
                    style={{ backgroundColor: "rgba(17,17,31,.55)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}>
                    <Move size={11} /> 점을 끌어 보정
                  </span>
                )}
              </div>
              {pts && (
                <button onClick={save} className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3.5 text-sm font-extrabold text-white" style={{ background: GRAD, boxShadow: SHADOW }}>
                  <Check size={16} /> {roleLabel ? `${roleLabel} 저장하기` : "이 분석 저장하기"}
                </button>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex gap-1 rounded-full p-1" style={{ backgroundColor: CANVAS }}>
                  {VIEWS.map((v) => (
                    <button key={v.key} onClick={() => beginCapturedAnalysis(v.key)} className="rounded-full px-3 py-1.5 text-xs font-bold"
                      style={view === v.key ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: analyzedViews[v.key] ? GOOD : SUB }}>
                      {v.label}{analyzedViews[v.key] ? " ✓" : ""}
                    </button>
                  ))}
                </div>
                {poseView === "front" && (
                  <>
                    <button onClick={() => setMirror((m) => !m)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: mirror ? TINT : CANVAS, color: mirror ? PRIMARY : SUB }}>좌우 바꿈</button>
                    <button onClick={() => setFloorFix((f) => !f)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: floorFix ? TINT : CANVAS, color: floorFix ? PRIMARY : SUB }}>바닥선 보정 {floorFix ? "켜짐" : "꺼짐"}</button>
                  </>
                )}
                {poseView === "side" && (
                  <button onClick={() => setFaceDir((d) => -d)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>얼굴 방향 {faceDir > 0 ? "→" : "←"}</button>
                )}
                <button onClick={() => setShowSkel((s) => !s)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: showSkel ? TINT : CANVAS, color: showSkel ? PRIMARY : SUB }}>뼈대</button>
                <button onClick={() => setShowNum((s) => !s)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: showNum ? TINT : CANVAS, color: showNum ? PRIMARY : SUB }}>수치</button>
                <button onClick={download} className="ml-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: INK }}><Download size={12} /> 공유</button>
              </div>
              <Sub>관절을 끌면 확대경이 뜨고, 손을 떼는 즉시 각도가 다시 계산됩니다.</Sub>
            </>
          )}
          {res && res.items.length > 0 && (
            <>
              <div className="space-y-2">
                {res.items.map((i) => {
                  const t = trend(i.key);
                  return (
                    <div key={i.key} className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: LV_COLOR[i.level] }} />
                        <span className="min-w-0 flex-1 truncate text-sm font-extrabold" style={{ color: INK }}>{i.label}</span>
                        <span className="text-base font-extrabold tabular-nums" style={{ color: LV_COLOR[i.level] }}>{i.value}{i.unit}</span>
                        <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: `${LV_COLOR[i.level]}1A`, color: LV_COLOR[i.level] }}>{LV_TEXT[i.level]}</span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: INK2 }}>{i.desc}</p>
                      <p className="mt-1 text-xs font-bold" style={{ color: PRIMARY }}>→ {i.tip}</p>
                      {t && (
                        <p className="mt-1 text-xs font-bold tabular-nums" style={{ color: i.goodHigh ? (t.diff >= 0 ? GOOD : BAD) : (t.diff <= 0 ? GOOD : BAD) }}>
                          {ymd(t.from)} 대비 {t.diff > 0 ? "+" : ""}{t.diff}{i.unit}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              {res.notes.map((n, k) => (
                <div key={k} className="flex gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: WARN_S }}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: WARN }} />
                  <p className="text-xs leading-relaxed" style={{ color: INK2 }}>{n}</p>
                </div>
              ))}
              <div className="rounded-2xl p-4" style={{ background: GRAD_SOFT }}>
                <p className="text-xs font-extrabold" style={{ color: PRIMARY }}>오늘의 우선 개선 포인트</p>
                <p className="mt-1 text-sm font-extrabold" style={{ color: INK }}>
                  {worst && worst.level !== "good" ? `${worst.label} ${worst.value}${worst.unit} · ${worst.dir}` : "주요 지표 모두 정상 범위"}
                </p>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: INK2 }}>{poseComment(member, view, res)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={save} className="flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-extrabold text-white" style={{ background: GRAD }}>
                    <Check size={14} /> 분석 결과 저장
                  </button>
                  <button onClick={() => shot()} className="flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold" style={{ color: INK }}>
                    <Download size={14} /> 갤러리 저장
                  </button>
                  <button onClick={() => shot(false)} className="flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold" style={{ color: BRAND }}>
                    <Upload size={14} /> 공유하기
                  </button>
                  <button onClick={copy} className="flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold" style={{ color: PRIMARY }}>
                    <Copy size={14} /> 코멘트 복사
                  </button>
                </div>
              </div>
            </>
          )}
          {saved.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-extrabold" style={{ color: SUB }}>저장된 분석 {saved.length}건 · 눌러서 크게 보기</p>
              <div className="space-y-2">
                {saved.slice(0, 6).map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-2xl p-2" style={{ backgroundColor: CANVAS }}>
                    <button onClick={() => setSeeSaved(s)} className="h-14 w-14 shrink-0 overflow-hidden rounded-xl" style={{ backgroundColor: "#14141C" }}>
                      {s.src ? <img src={s.src} alt="" className="h-full w-full object-cover" /> : <Activity size={16} style={{ color: PRIMARY, margin: "0 auto" }} />}
                    </button>
                    <button onClick={() => setSeeSaved(s)} className="min-w-0 flex-1 text-left">
                      <p className="text-xs font-extrabold" style={{ color: INK }}>{ymd(s.date)} · {s.view === "front" ? "전면" : s.view === "side" ? "측면" : "후면"}</p>
                      <p className="mt-0.5 truncate text-xs tabular-nums" style={{ color: SUB }}>
                        {s.metrics.slice(0, 3).map((m) => `${m.label.replace(/\(.*\)/, "").trim()} ${m.value}${m.unit}`).join(" · ")}
                      </p>
                    </button>
                    <button onClick={() => onDeletePose?.(s.id)} aria-label="분석 삭제" style={{ color: FAINT }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {seeSaved && (
            <SavedPoseViewer rec={seeSaved} onClose={() => setSeeSaved(null)} onToast={onToast} />
          )}
        </div>
      )}
    </Card>
  );
}

/* ================= 오늘의 시퀀스 (유튜브 · 검증 채널만) =================
   키는 반드시 구글 클라우드에서 "HTTP 리퍼러 제한"을 걸어 두어야 한다:
   pilateacher.com/*, *.vercel.app/*, https://localhost/* (앱), http://localhost:*
   제한을 걸면 코드에 들어 있어도 남이 못 쓴다. */
const YT_KEY = import.meta.env.VITE_YOUTUBE_API_KEY || "";
const YT_CHANNELS = ["@pilatesua", "@onlypilates", "@pilamincho", "@pt3885", "@theclassicpilates", "@pila_hyeonj"];
/* 주차 번호 — 월요일 시작 기준이라 한 주 안에서는 바뀌지 않는다 */
const weekNo = (d) => {
  const t = new Date(d + "T00:00:00");
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));   /* 그 주 월요일로 */
  return Math.round(t.getTime() / 604800000);
};
const YT_KEYWORDS = ["리포머", "캐딜락", "체어", "바렐", "라운드숄더", "거북목", "골반", "코어", "척추", "스트레칭", "하체", "어깨"];
const YT_CACHE_KEY = "pt_yt_cache_v3";

async function ytGet(path, params) {
  const q = new URLSearchParams({ ...params, key: YT_KEY }).toString();
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${q}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const msg = j?.error?.message || `HTTP ${r.status}`; const e = new Error(msg); e.reason = j?.error?.errors?.[0]?.reason; throw e; }
  return j;
}
const ytCacheRead = () => { try { return JSON.parse(localStorage.getItem(YT_CACHE_KEY)) || {}; } catch (e) { return {}; } };
const ytCacheWrite = (c) => { try { localStorage.setItem(YT_CACHE_KEY, JSON.stringify(c)); } catch (e) {} };

/* 채널 핸들 → 업로드 목록 ID (한 번만 알아내면 계속 씀) */
async function ytResolveChannels() {
  const c = ytCacheRead();
  c.ch = c.ch || {};
  for (const h of YT_CHANNELS) {
    if (c.ch[h]?.uploads) continue;
    const j = await ytGet("channels", { part: "contentDetails,snippet", forHandle: h });
    const it = j.items && j.items[0];
    if (it) c.ch[h] = { id: it.id, name: it.snippet?.title || h, uploads: it.contentDetails?.relatedPlaylists?.uploads };
  }
  ytCacheWrite(c);
  return c.ch;
}
/* 하루 한 번, 채널마다 최근 영상을 모아 둔다 (검색보다 훨씬 싼 호출) */
async function ytLoadPool() {
  const c = ytCacheRead();
  const today = todayISO();
  if (c.poolDay === today && Array.isArray(c.pool) && c.pool.length) return c.pool;
  const ch = await ytResolveChannels();
  const pool = [];
  for (const h of Object.keys(ch)) {
    const up = ch[h]?.uploads; if (!up) continue;
    try {
      const j = await ytGet("playlistItems", { part: "snippet", playlistId: up, maxResults: "15" });
      (j.items || []).forEach((it) => {
        const sn = it.snippet || {};
        const vid = sn.resourceId?.videoId; if (!vid) return;
        pool.push({
          id: vid, title: sn.title || "", desc: (sn.description || "").slice(0, 2000),
          thumb: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || "",
          ch: ch[h].name, at: sn.publishedAt || "",
        });
      });
    } catch (e) {}
  }
  if (pool.length) { c.pool = pool; c.poolDay = today; ytCacheWrite(c); }
  return pool;
}
/* 키워드가 모음에 없으면 그때만 검색 API 를 쓴다 (채널 안에서만) */
async function ytSearchKw(kw) {
  const c = ytCacheRead();
  c.q = c.q || {};
  const ck = `${todayISO()}|${kw}`;
  if (Array.isArray(c.q[ck])) return c.q[ck];
  const ch = await ytResolveChannels();
  const out = [];
  for (const h of Object.keys(ch).slice(0, 3)) {
    try {
      const j = await ytGet("search", { part: "snippet", channelId: ch[h].id, q: kw, type: "video", maxResults: "3", videoEmbeddable: "true" });
      (j.items || []).forEach((it) => {
        const vid = it.id?.videoId; if (!vid) return;
        out.push({ id: vid, title: it.snippet?.title || "", desc: "", thumb: it.snippet?.thumbnails?.medium?.url || "", ch: ch[h].name, at: it.snippet?.publishedAt || "" });
      });
    } catch (e) {}
  }
  c.q[ck] = out; ytCacheWrite(c);
  return out;
}
const ytFilter = (pool, kw) => pool.filter((v) => (v.title + " " + v.desc).toLowerCase().includes(kw.toLowerCase()));

/* ===== 타임스탬프 ===== */
const secToClock = (n) => {
  const t = Math.max(0, Math.floor(n));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s2 = t % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s2).padStart(2, "0")}`;
};
/* 유튜브 설명란의 "02:15 풋워크" 같은 줄을 챕터로 뽑는다 */
function parseChapters(desc) {
  const out = [];
  String(desc || "").split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    const m = line.match(/^[\[\(]?(\d{1,2}):(\d{2})(?::(\d{2}))?[\]\)]?\s*[-–—~:.)\]]*\s*(.*)$/);
    if (!m) return;
    const a = Number(m[1]), b = Number(m[2]), c = m[3] ? Number(m[3]) : null;
    if (b > 59 || (c !== null && c > 59)) return;
    const t = c !== null ? a * 3600 + b * 60 + c : a * 60 + b;
    const label = (m[4] || "").trim().replace(/^[-–—~:.]+\s*/, "");
    if (!label) return;
    if (out.some((x) => x.t === t)) return;
    out.push({ t, label: label.slice(0, 40) });
  });
  return out.sort((x, y) => x.t - y.t).slice(0, 20);
}
const YT_MARK_KEY = "pt_yt_marks_v1";
const marksRead = () => { try { return JSON.parse(localStorage.getItem(YT_MARK_KEY)) || {}; } catch (e) { return {}; } };
const marksWrite = (o) => { try { localStorage.setItem(YT_MARK_KEY, JSON.stringify(o)); } catch (e) {} };

/* 유튜브 플레이어 API — 되면 현재 위치를 읽어 저장할 수 있다. 안 되면 일반 iframe 으로 폴백 */
let ytApiP = null;
function ytApiReady() {
  if (ytApiP) return ytApiP;
  ytApiP = new Promise((res) => {
    if (typeof window === "undefined") return res(null);
    if (window.YT && window.YT.Player) return res(window.YT);
    const done = () => res(window.YT && window.YT.Player ? window.YT : null);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch (e) {} done(); };
    if (!document.getElementById("yt-iframe-api")) {
      const sc = document.createElement("script");
      sc.id = "yt-iframe-api"; sc.src = "https://www.youtube.com/iframe_api";
      sc.onerror = () => res(null);
      document.head.appendChild(sc);
    }
    setTimeout(done, 6000);
  });
  return ytApiP;
}

/* 체형 태그·코멘트·분석 지표에 나오는 말 → 시퀀스 키워드 */
const KW_HINTS = [
  { kw: "라운드숄더", hit: ["라운드", "숄더", "어깨 말림", "굽은 등", "흉추 후만"] },
  { kw: "거북목", hit: ["거북목", "전방두부", "목 전방", "일자목"] },
  { kw: "골반", hit: ["골반", "전방경사", "후방경사", "비대칭", "요추"] },
  { kw: "코어", hit: ["코어", "복부", "복횡근", "불안정"] },
  { kw: "척추", hit: ["척추", "측만", "흉추", "신전"] },
  { kw: "하체", hit: ["무릎", "하체", "둔근", "다리", "발목", "x자", "o자"] },
  { kw: "어깨", hit: ["어깨", "견갑", "회전근개", "충돌"] },
  { kw: "스트레칭", hit: ["뭉침", "근육통", "통증", "긴장", "유연"] },
];
/* 지난 수업 기록에서 오늘 무엇을 다룰지 뽑아낸다 */
function seqAdvice(member, schedule, photos) {
  if (!member) return null;
  const notes = (member.notes || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const att = attendanceOf(schedule, member.id);
  const first = notes.length === 0 && (!att || !att.done);
  if (first) return { first: true, name: member.name || "회원" };
  const last = notes[0] || null;
  const poses = (photos?.[member.id]?.poses || []).filter((p) => p && p.metrics);
  const bad = (poses[0]?.metrics || []).filter((m) => m.level !== "good").map((m) => m.label);
  const text = [
    ...(member.focus || []),
    last?.body || "",
    ...bad,
  ].join(" ").toLowerCase();
  const kws = [];
  KW_HINTS.forEach((h) => { if (h.hit.some((w) => text.includes(w.toLowerCase()))) kws.push(h.kw); });
  return {
    first: false,
    name: member.name || "회원",
    kws: kws.slice(0, 3),
    last,
    why: (member.focus || []).slice(0, 2).concat(bad.slice(0, 2)).slice(0, 3),
  };
}

/* 이번 달 나의 성과 — 완료 타임·예상 급여·목표 진행률·지난달 대비 */
function MonthPerfCard({ done, pay, goal, lastSame, onGoal }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(String(goal || ""));
  const g = Number(goal) || 0;
  const pct = g > 0 ? Math.min(100, Math.round((done / g) * 100)) : null;
  const diff = done - lastSame;
  const diffPct = lastSame > 0 ? Math.round((diff / lastSame) * 100) : null;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: GRAD }}><Sparkles size={16} color="#fff" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold" style={{ color: INK }}>이번 달 나의 성과</h3>
          <Sub>완료한 수업 기준입니다</Sub>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
          <p className="text-xs font-bold" style={{ color: SUB }}>완료한 수업</p>
          <p className="text-xl font-extrabold tabular-nums" style={{ color: INK }}>{done}<span className="text-sm"> 타임</span></p>
        </div>
        <div className="rounded-2xl px-3 py-2.5" style={{ backgroundColor: TINT }}>
          <p className="text-xs font-bold" style={{ color: PRIMARY }}>이번 달 예상 급여</p>
          <p className="truncate text-xl font-extrabold tabular-nums" style={{ color: PRIMARY }}>₩{won(pay)}</p>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: SUB }}>
            {g > 0 ? <>목표 <b style={{ color: INK }}>{g}타임</b> 중 <b style={{ color: PRIMARY }}>{pct}%</b></> : "이번 달 목표를 정해 보세요"}
          </span>
          <span className="flex-1" />
          <button onClick={() => { setV(String(g || "")); setEdit((x) => !x); }} className="rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: CANVAS, color: PRIMARY }}>
            {g > 0 ? "목표 수정" : "목표 정하기"}
          </button>
        </div>
        {edit ? (
          <div className="mt-2 flex gap-1.5">
            <input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))} placeholder="80"
              className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-extrabold outline-none" style={{ backgroundColor: CANVAS, color: INK }} />
            <button onClick={() => { onGoal(Number(v) || 0); setEdit(false); }} className="rounded-xl px-4 py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>저장</button>
          </div>
        ) : g > 0 ? (
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: CANVAS }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: GRAD, transition: "width .5s ease" }} />
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-1.5 rounded-2xl px-3 py-2.5" style={{ backgroundColor: diff >= 0 ? GOOD_S : CANVAS }}>
        {diff >= 0 ? <ArrowUpRight size={14} style={{ color: GOOD }} /> : <ArrowDownRight size={14} style={{ color: SUB }} />}
        <p className="min-w-0 flex-1 text-xs font-bold" style={{ color: INK }}>
          지난달 같은 날 대비 <b style={{ color: diff >= 0 ? GOOD : SUB }}>{diff >= 0 ? "+" : ""}{diff}타임</b>
          {diffPct !== null && <span style={{ color: SUB }}> · {diffPct >= 0 ? "+" : ""}{diffPct}%</span>}
        </p>
      </div>
    </Card>
  );
}

/* 오늘 아직 처리 안 된 가장 이른 수업 — 시퀀스 카드와 같은 기준을 쓴다 */
function nextTarget(schedule, members) {
  const T = todayISO();
  const rows = (schedule || [])
    .filter((s) => s?.date === T && !isPersonalEvt(s) && !isEquipGroup(s))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  for (const s of rows) {
    const a = attendeesOf(s).find((x) => !x.deductFrom && x.status !== "noshow" && x.status !== "cancel");
    if (a) { const m = (members || []).find((x) => x.id === a.memberId); if (m) return { m, s, a }; }
  }
  return null;
}

function NextClassCard({ members, schedule, photos, onStatus, onOpenMember, onWriteNote, onNoshowFee, onNoComment, onVoiceNote }) {
  const target = useMemo(() => nextTarget(schedule, members), [schedule, members]);
  const adv = useMemo(() => seqAdvice(target?.m, schedule, photos), [target, schedule, photos]);
  /* null → 출석/노쇼/취소 · done → 기록 여부 · rec → 기록 방법 · noshow → 차감 여부 */
  const [step, setStep] = useState(null);
  const [held, setHeld] = useState(null);
  useEffect(() => { setStep(null); setHeld(null); }, [target?.s?.id, target?.m?.id]);
  if (!target) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: GOOD_S }}><Check size={16} style={{ color: GOOD }} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold" style={{ color: INK }}>다음 수업 브리핑</h3>
            <Sub>오늘 남은 수업이 없습니다</Sub>
          </div>
        </div>
      </Card>
    );
  }
  const { m, s } = target;
  const rest = left(m);
  const cautions = [...(m.focus || [])];
  const poses = (photos?.[m.id]?.poses || []).filter((p) => p && p.metrics);
  (poses[0]?.metrics || []).filter((x) => x.level === "bad").forEach((x) => cautions.push(x.label.replace(" 각도", "")));
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: GRAD }}><Target size={16} color="#fff" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-extrabold" style={{ color: INK }}>다음 수업 · {s.start} {s.type}</h3>
          <Sub>{s.room || "룸 미지정"}</Sub>
        </div>
      </div>
      <button onClick={() => onOpenMember && onOpenMember(m.id)} className="mt-3 flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left" style={{ backgroundColor: CANVAS }}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold" style={{ color: INK }}>{m.name || "이름 미입력"} 회원님</p>
          <Sub>{rest > 0 ? `잔여 ${rest}회` : "잔여 없음"}{ageOf(m) !== null ? ` · ${ageOf(m)}세` : ""}</Sub>
        </div>
        <ChevronRight size={15} style={{ color: FAINT }} />
      </button>
      {cautions.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 rounded-2xl px-3 py-2.5" style={{ backgroundColor: WARN_S }}>
          <AlertTriangle size={13} style={{ color: WARN, marginTop: 2 }} />
          <p className="min-w-0 flex-1 text-xs font-bold leading-relaxed" style={{ color: INK }}>{cautions.slice(0, 4).join(" · ")}</p>
        </div>
      )}
      {adv && !adv.first && adv.last?.body && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed" style={{ color: INK2 }}>지난 일지: {adv.last.body}</p>
      )}
      {adv && adv.first && (
        <button onClick={() => onWriteNote && onWriteNote(m.id, s.id)} className="mt-2 flex w-full items-center gap-1.5 rounded-2xl px-3 py-2.5" style={{ backgroundColor: TINT }}>
          <Pencil size={13} style={{ color: PRIMARY }} />
          <span className="text-xs font-extrabold" style={{ color: PRIMARY }}>첫 수업입니다 · 일지를 기록해 주세요</span>
        </button>
      )}
      {step === null && (
        <div className="mt-3 grid min-w-0 grid-cols-3 gap-1.5">
          <button onClick={() => { onStatus(s.id, "done", m.id); setHeld({ s, m }); setStep("done"); }} className="rounded-2xl py-2.5 text-xs font-extrabold text-white" style={{ backgroundColor: GOOD }}>출석</button>
          <button onClick={() => { onStatus(s.id, "noshow", m.id); setHeld({ s, m }); setStep("noshow"); }} className="rounded-2xl py-2.5 text-xs font-extrabold" style={{ backgroundColor: BAD_S, color: BAD }}>노쇼</button>
          <button onClick={() => onStatus(s.id, "cancel", m.id)} className="rounded-2xl py-2.5 text-xs font-extrabold" style={{ backgroundColor: CANVAS, color: SUB }}>취소</button>
        </div>
      )}
      {step === "done" && held && (
        <div className="mt-3 rounded-2xl p-3" style={{ backgroundColor: GOOD_S }}>
          <p className="text-xs font-extrabold" style={{ color: INK }}>✓ 출석 처리했습니다 · 오늘 수업을 기록할까요?</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button onClick={() => setStep("rec")} className="flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-xs font-extrabold text-white" style={{ background: GRAD }}>
              <Pencil size={13} /> 기록하기
            </button>
            <button onClick={() => { onNoComment && onNoComment(held.m.id, held.s.type, held.s.id); setStep(null); }}
              className="rounded-2xl py-2.5 text-xs font-extrabold" style={{ backgroundColor: CARD, color: SUB }}>노코멘트</button>
          </div>
        </div>
      )}
      {step === "rec" && held && (
        <div className="mt-3 rounded-2xl p-3" style={{ backgroundColor: TINT }}>
          <p className="text-xs font-extrabold" style={{ color: PRIMARY }}>어떻게 기록할까요?</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button onClick={() => { onVoiceNote && onVoiceNote(held.m.id, held.s.id); setStep(null); }}
              className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-xs font-extrabold text-white" style={{ background: GRAD }}>
              <Smartphone size={13} /> AI 음성 기록
            </button>
            <button onClick={() => { onWriteNote && onWriteNote(held.m.id, held.s.id); setStep(null); }}
              className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-xs font-extrabold" style={{ backgroundColor: CARD, color: INK }}>
              <Pencil size={13} /> 직접 기록
            </button>
          </div>
          <button onClick={() => setStep("done")} className="mt-1.5 w-full text-xs font-bold" style={{ color: SUB }}>뒤로</button>
        </div>
      )}
      {step === "noshow" && held && (
        <div className="mt-3 rounded-2xl p-3" style={{ backgroundColor: BAD_S }}>
          <p className="text-xs font-extrabold" style={{ color: INK }}>노쇼 처리했습니다 · 수강권을 차감할까요?</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button onClick={() => { onNoshowFee && onNoshowFee(held.s.id, true, held.m.id); setStep(null); }}
              className="rounded-2xl py-2.5 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>1회 차감</button>
            <button onClick={() => { onNoshowFee && onNoshowFee(held.s.id, false, held.m.id); setStep(null); }}
              className="rounded-2xl py-2.5 text-xs font-extrabold" style={{ backgroundColor: CARD, color: SUB }}>차감 없음</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function VideoPlayer({ video, onClose, onToast }) {
  const boxRef = useRef(null);
  const playerRef = useRef(null);
  const [api, setApi] = useState(false);
  const [marks, setMarks] = useState(() => marksRead()[video.id] || []);
  const [adding, setAdding] = useState(null);   /* { t, label } */
  const chapters = useMemo(() => parseChapters(video.desc), [video.id]);
  const all = useMemo(() => {
    const seen = new Set(); const out = [];
    [...marks.map((m) => ({ ...m, mine: true })), ...chapters].forEach((c) => {
      if (seen.has(c.t)) return; seen.add(c.t); out.push(c);
    });
    return out.sort((a, b) => a.t - b.t);
  }, [marks, chapters]);

  useEffect(() => {
    let alive = true;
    ytApiReady().then((YT) => {
      if (!alive || !YT || !boxRef.current) return;
      try {
        playerRef.current = new YT.Player(boxRef.current, {
          videoId: video.id,
          playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
          events: { onReady: () => { if (alive) setApi(true); } },
        });
      } catch (e) {}
    });
    return () => { alive = false; try { playerRef.current?.destroy(); } catch (e) {} };
  }, [video.id]);

  const seek = (t) => {
    const p = playerRef.current;
    if (p && p.seekTo) { try { p.seekTo(t, true); p.playVideo && p.playVideo(); return; } catch (e) {} }
    const f = document.getElementById("yt-fallback");
    if (f) f.src = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&start=${t}`;
  };
  const saveMark = (t, label) => {
    const next = [...marks.filter((m) => m.t !== t), { t, label: (label || "").trim() || secToClock(t) }].sort((a, b) => a.t - b.t).slice(0, 30);
    setMarks(next);
    const all2 = marksRead(); all2[video.id] = next; marksWrite(all2);
    setAdding(null);
    onToast && onToast({ ok: true, msg: `${secToClock(t)} 저장했습니다.` });
  };
  const delMark = (t) => {
    const next = marks.filter((m) => m.t !== t);
    setMarks(next);
    const all2 = marksRead(); all2[video.id] = next; marksWrite(all2);
  };
  const grabNow = () => {
    const p = playerRef.current;
    let t = 0;
    try { t = Math.floor(p?.getCurrentTime?.() || 0); } catch (e) {}
    setAdding({ t, label: "" });
  };

  return (
    <div className="safe-all fixed inset-0 z-50 flex flex-col bg-photo">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
        <p className="mx-2 min-w-0 flex-1 truncate text-center text-sm font-bold text-white">{video.title}</p>
        <span style={{ width: 34 }} />
      </div>
      <div className="px-3">
        <div className="mx-auto w-full overflow-hidden rounded-2xl" style={{ maxWidth: 860, aspectRatio: "16 / 9", backgroundColor: "#000" }}>
          <div ref={boxRef} className="h-full w-full">
            <iframe id="yt-fallback" title={video.title} src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`}
              className="h-full w-full" style={{ border: 0 }} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pt-3">
        <div className="mx-auto" style={{ maxWidth: 860 }}>
          <div className="flex items-center gap-2">
            <p className="text-xs font-extrabold text-white">동작 구간 {all.length > 0 && <span style={{ opacity: 0.6 }}>{all.length}개</span>}</p>
            <span className="flex-1" />
            {api ? (
              <button onClick={grabNow} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>
                <Plus size={12} /> 지금 위치 저장
              </button>
            ) : (
              <button onClick={() => setAdding({ t: 0, label: "" })} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ backgroundColor: "rgba(255,255,255,.16)", color: "#fff" }}>
                <Plus size={12} /> 구간 직접 추가
              </button>
            )}
          </div>
          {adding && (
            <div className="mt-2 rounded-2xl p-3" style={{ backgroundColor: "rgba(255,255,255,.12)" }}>
              <div className="flex items-center gap-1.5">
                <input inputMode="numeric" value={Math.floor(adding.t / 60)} onChange={(e) => setAdding({ ...adding, t: (Number(e.target.value.replace(/[^0-9]/g, "")) || 0) * 60 + (adding.t % 60) })}
                  className="w-14 rounded-xl px-2 py-2 text-center text-sm font-extrabold" style={{ backgroundColor: "#fff", color: "#17171F" }} />
                <span className="text-sm font-extrabold text-white">분</span>
                <input inputMode="numeric" value={adding.t % 60} onChange={(e) => setAdding({ ...adding, t: Math.floor(adding.t / 60) * 60 + Math.min(59, Number(e.target.value.replace(/[^0-9]/g, "")) || 0) })}
                  className="w-14 rounded-xl px-2 py-2 text-center text-sm font-extrabold" style={{ backgroundColor: "#fff", color: "#17171F" }} />
                <span className="text-sm font-extrabold text-white">초</span>
              </div>
              <input value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} placeholder="예) 리포머 풋워크"
                className="mt-2 w-full rounded-xl px-3 py-2 text-sm" style={{ backgroundColor: "#fff", color: "#17171F" }} />
              <div className="mt-2 flex gap-1.5">
                <button onClick={() => setAdding(null)} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ backgroundColor: "rgba(255,255,255,.18)", color: "#fff" }}>취소</button>
                <button onClick={() => saveMark(adding.t, adding.label)} className="flex-1 rounded-xl py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>저장</button>
              </div>
            </div>
          )}
          {all.length === 0 && !adding && (
            <p className="mt-2 text-xs" style={{ color: "rgba(255,255,255,.6)" }}>
              이 영상에는 구간 정보가 없습니다 · 자주 쓰는 동작 시점을 저장해 두면 다음부터 바로 그 지점부터 재생됩니다
            </p>
          )}
          <div className="mt-2 space-y-1.5 pb-4">
            {all.map((c) => (
              <div key={c.t} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: "rgba(255,255,255,.1)" }}>
                <button onClick={() => seek(c.t)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums" style={{ backgroundColor: c.mine ? BRAND : "rgba(255,255,255,.2)", color: "#fff" }}>{secToClock(c.t)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-bold text-white">{c.label}</span>
                </button>
                {c.mine && <button onClick={() => delMark(c.t)} className="shrink-0 p-1"><Trash2 size={13} color="rgba(255,255,255,.6)" /></button>}
              </div>
            ))}
          </div>
          <p className="pb-4 text-center text-xs" style={{ color: "rgba(255,255,255,.5)" }}>영상 저작권은 해당 채널에 있습니다 · 유튜브 공식 재생기로 재생됩니다</p>
        </div>
      </div>
    </div>
  );
}

function SequenceCard({ members, schedule, photos, onWriteNote, onToast, compact }) {
  const [open, setOpen] = useState(true);
  /* 날짜에 따라 오늘의 기본 키워드가 돌아간다 */
  const dayIdx = useMemo(() => { const d = new Date(); return (d.getFullYear() + d.getMonth() + d.getDate()) % YT_KEYWORDS.length; }, []);
  const [kw, setKw] = useState(YT_KEYWORDS[dayIdx]);
  const [pool, setPool] = useState(null);
  const [extra, setExtra] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [play, setPlay] = useState(null);
  /* 오늘 아직 안 한 수업 중 가장 이른 회원을 기준으로 삼는다 */
  const target = useMemo(() => nextTarget(schedule, members), [schedule, members]);
  const adv = useMemo(() => seqAdvice(target?.m, schedule, photos), [target, schedule, photos]);
  const [manualKw, setManualKw] = useState(false);
  /* 이 회원 기록에서 나온 항목을 맨 앞으로 */
  const orderedKw = useMemo(() => {
    const rec = (adv && !adv.first && adv.kws) || [];
    return [...rec, ...YT_KEYWORDS.filter((k) => !rec.includes(k))];
  }, [adv]);
  useEffect(() => {
    if (!manualKw && adv && !adv.first && adv.kws?.length) setKw(adv.kws[0]);
  }, [adv, manualKw]);
  useEffect(() => {
    let ok = true;
    (async () => {
      try { const p = await ytLoadPool(); if (ok) setPool(p); }
      catch (e) { if (ok) setErr(e); }
    })();
    return () => { ok = false; };
  }, []);
  useEffect(() => {
    let ok = true;
    setExtra([]);
    if (!pool) return;
    if (ytFilter(pool, kw).length >= 2) return;
    setBusy(true);
    ytSearchKw(kw).then((r) => { if (ok) setExtra(r); }).catch(() => {}).finally(() => { if (ok) setBusy(false); });
    return () => { ok = false; };
  }, [kw, pool]);
  /* 이번 주 채널 — 6개를 주마다 돌아가며 */
  const weekCh = useMemo(() => {
    const names = [...new Set((pool || []).map((v) => v.ch).filter(Boolean))];
    if (!names.length) return null;
    return names[weekNo(todayISO()) % names.length];
  }, [pool]);
  const vids = useMemo(() => {
    const seen = new Set(); const out = [];
    [...ytFilter(pool || [], kw), ...extra].forEach((v) => { if (!seen.has(v.id)) { seen.add(v.id); out.push(v); } });
    const sorted = out.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    /* 이번 주 채널을 앞으로 올리되, 모자라면 다른 채널로 채운다 */
    const mine = weekCh ? sorted.filter((v) => v.ch === weekCh) : [];
    const rest = weekCh ? sorted.filter((v) => v.ch !== weekCh) : sorted;
    return [...mine, ...rest].slice(0, 2);
  }, [pool, extra, kw, weekCh]);
  return (
    <Card className="p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: GRAD }}><Sparkles size={16} color="#fff" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold" style={{ color: INK }}>오늘의 시퀀스</h3>
          <Sub>{weekCh ? <>이번 주 채널 · <b style={{ color: PRIMARY }}>{weekCh}</b></> : "검증된 필라테스 채널에서 골라 드립니다"}</Sub>
        </div>
        <ChevronDown size={16} style={{ color: SUB, transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {adv && adv.first && (
            <div className="rounded-2xl px-3 py-3" style={{ backgroundColor: TINT }}>
              <p className="text-sm font-extrabold" style={{ color: PRIMARY }}>{adv.name} 회원님 첫 수업입니다</p>
              <p className="mt-0.5 text-xs leading-relaxed" style={{ color: INK2 }}>
                지난 기록이 없어 추천할 근거가 없습니다. <b style={{ color: INK }}>첫 수업 일지를 기록해 주세요.</b> 다음부터 그 내용을 보고 시퀀스를 골라 드립니다.
              </p>
              {onWriteNote && (
                <button onClick={() => onWriteNote(target.m.id, target.s.id)} className="mt-2 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>
                  <Pencil size={12} /> 첫 수업 일지 쓰기
                </button>
              )}
            </div>
          )}
          {adv && !adv.first && (
            <div className="rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
              <p className="text-xs font-extrabold" style={{ color: INK }}>
                {adv.name} 회원님 {adv.kws?.length ? <>· 지난 기록 기준 <b style={{ color: PRIMARY }}>{adv.kws.join(" · ")}</b> 추천</> : "· 지난 기록에서 특별한 항목은 없었습니다"}
              </p>
              {adv.why?.length > 0 && <Sub className="mt-0.5 block truncate">근거: {adv.why.join(" · ")}</Sub>}
              {adv.last?.body && <Sub className="mt-0.5 block line-clamp-2">지난 일지: {adv.last.body}</Sub>}
            </div>
          )}
          <div className="-mx-1 flex min-w-0 max-w-full gap-1.5 overflow-x-auto px-1 pb-1">
            {orderedKw.map((k) => (
              <button key={k} onClick={() => { setManualKw(true); setKw(k); }} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-extrabold"
                style={kw === k ? { background: GRAD, color: "#fff" }
                  : (adv?.kws || []).includes(k) ? { backgroundColor: TINT, color: PRIMARY } : { backgroundColor: CANVAS, color: SUB }}>
                {(adv?.kws || []).includes(k) && kw !== k && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PRIMARY }} />}{k}
              </button>
            ))}
          </div>
          {err && (
            <Sub className="block rounded-2xl px-3 py-3">
              영상을 불러오지 못했습니다{String(err.reason) === "forbidden" || /referer|referrer|API key/i.test(String(err.message)) ? " · 유튜브 키의 리퍼러 제한에 이 주소를 추가해 주세요" : " · 네트워크를 확인해 주세요"}
            </Sub>
          )}
          {!err && !pool && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin" style={{ color: PRIMARY }} /></div>}
          {!err && pool && vids.length === 0 && !busy && <Sub className="block py-3 text-center">'{kw}' 영상이 아직 없습니다 · 다른 키워드를 눌러 보세요</Sub>}
          {busy && <Sub className="block text-center">'{kw}' 영상을 채널에서 찾는 중…</Sub>}
          <div className="grid grid-cols-2 gap-2">
            {vids.map((v) => (
              <button key={v.id} onClick={() => setPlay(v)} className="text-left">
                <div className="relative overflow-hidden rounded-2xl bg-photo" style={{ aspectRatio: "16 / 9" }}>
                  {v.thumb && <img src={v.thumb} alt="" className="h-full w-full object-cover" {...IMGP} />}
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(0,0,0,.55)" }}>
                      <span style={{ width: 0, height: 0, borderTop: "7px solid transparent", borderBottom: "7px solid transparent", borderLeft: "11px solid #fff", marginLeft: 3 }} />
                    </span>
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs font-bold leading-snug" style={{ color: INK }}>{v.title}</p>
                <Sub className="block truncate text-xs">{v.ch}</Sub>
              </button>
            ))}
          </div>
        </div>
      )}
      {play && <VideoPlayer video={play} onClose={() => setPlay(null)} onToast={onToast} />}
    </Card>
  );
}

/* 저장된 분석 썸네일 — blobId 는 비동기라 여기서 불러온다 */
function PoseThumb({ rec }) {
  const [src, setSrc] = useState(rec?.src || null);
  useEffect(() => {
    let ok = true;
    (async () => {
      const u = await urlFor(rec?.cleanBlobId || rec?.blobId);
      if (ok && u) setSrc(u);
    })();
    return () => { ok = false; };
  }, [rec?.id]);
  if (!src) return <div className="h-16 w-12 shrink-0 rounded-xl" style={{ backgroundColor: CANVAS }} />;
  return <img src={src} alt="" className="h-16 w-12 shrink-0 rounded-xl object-cover" {...IMGP} />;
}

/* 접었다 펴는 묶음 — 화면이 길어지지 않게 */
function Fold({ label, hint, open: init, children }) {
  const [open, setOpen] = useState(!!init);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-2xl px-4 py-3" style={{ backgroundColor: CARD, boxShadow: SHADOW }}>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-extrabold" style={{ color: INK }}>{label}</span>
          {hint && <span className="block text-xs" style={{ color: SUB }}>{hint}</span>}
        </span>
        <ChevronDown size={16} style={{ color: SUB, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/* 체형분석 탭 — 전 회원의 최근 분석을 한눈에 */
function AnalysisTab({ members, photos, selectedId, onSelect, onOpen, onToast, hub, doneSignal, onConsumeDone }) {
  const [q, setQ] = useState("");
  const pick = selectedId || null;
  const setPick = (id) => onSelect?.(id || null);
  const [viewing, setViewing] = useState(null);
  const rows = useMemo(() => {
    return members
      .filter((m) => !isDraft(m))
      .map((m) => {
        const poses = (photos[m.id]?.poses || []).filter((p) => p && p.metrics);
        return { m, last: poses[0] || null, count: poses.length };
      })
      .filter((r) => !q.trim() || (r.m.name || "").includes(q.trim()))
      .sort((a, b) => {
        if (!!b.last - !!a.last) return !!b.last - !!a.last;
        return (b.last?.date || "").localeCompare(a.last?.date || "");
      });
  }, [members, photos, q]);
  const done = rows.filter((r) => r.last).length;
  const levelDot = { good: GOOD, warn: WARN, bad: BAD };
  /* 비포만 있고 애프터가 없는 회원 = 애프터 촬영 대상 */
  const [cardFor, setCardFor] = useState(null);
  useEffect(() => {
    if (!doneSignal) return;
    /* 비포를 찍었으면 목록으로 · 애프터를 찍었으면 결과 카드로 이어 준다 */
    if (doneSignal.mode === "after") setCardFor(doneSignal.id);
    setPick(null);
    onConsumeDone && onConsumeDone();
  }, [doneSignal]);
  const records = useMemo(
    () => rows.flatMap(({ m }) => (photos[m.id]?.poses || [])
      .filter((p) => p && p.id && p.metrics)
      .map((rec) => ({ m, rec })))
      .sort((a, b) => `${b.rec.date || ""}:${b.rec.id}`.localeCompare(`${a.rec.date || ""}:${a.rec.id}`)),
    [rows, photos],
  );
  const openedRecord = viewing
    ? records.find(({ m, rec }) => m.id === viewing.memberId && rec.id === viewing.poseId)
    : null;
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: TINT }}><Activity size={18} style={{ color: PRIMARY }} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-extrabold" style={{ color: INK }}>체형분석</h2>
            <Sub>촬영부터 결과 카드까지 한 흐름으로 관리합니다</Sub>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-1.5 text-center">
            <div className="rounded-xl px-3 py-1.5" style={{ backgroundColor: TINT }}>
              <p className="text-sm font-extrabold tabular-nums" style={{ color: PRIMARY }}>{done}</p><Sub>분석 완료</Sub>
            </div>
            <div className="rounded-xl px-3 py-1.5" style={{ backgroundColor: CANVAS }}>
              <p className="text-sm font-extrabold tabular-nums" style={{ color: INK }}>{Math.max(0, rows.length - done)}</p><Sub>분석 전</Sub>
            </div>
          </div>
        </div>
        <div className="relative mt-4">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: SUB }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회원 이름 검색"
            className="h-10 w-full rounded-xl border-0 pl-10 pr-3 text-sm outline-none"
            style={{ backgroundColor: CANVAS, color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }} />
        </div>
        <div className="-mx-1 mt-2 max-h-32 overflow-y-auto px-1">
          <div className="flex flex-wrap gap-1">
            {rows.map(({ m, count }) => (
              <button key={m.id} onClick={() => setPick(pick === m.id ? null : m.id)} className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-extrabold"
                style={pick === m.id ? { backgroundColor: PRIMARY, color: "#fff" }
                  : count === 0 ? { backgroundColor: TINT, color: PRIMARY } : { backgroundColor: CANVAS, color: INK }}>
                {m.name || "이름 미입력"}
                <span className="font-bold" style={{ opacity: 0.65 }}>{count === 0 ? "· 분석 전" : `· ${count}건`}</span>
              </button>
            ))}
            {rows.length === 0 && <Sub className="py-3">회원이 없습니다</Sub>}
          </div>
        </div>
      </Card>
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          {[
            { n: "1", t: "사진 촬영", d: "전면 · 측면 · 후면", i: Camera },
            { n: "2", t: "AI 분석", d: "관절 · 각도", i: Sparkles },
            { n: "3", t: "결과 카드", d: "비포 · 애프터", i: ClipboardList },
          ].map((x, idx) => {
            const Icon = x.i;
            return (
              <div key={x.n} className="relative flex min-w-0 flex-1 items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: idx === 0 && pick ? PRIMARY : TINT, color: idx === 0 && pick ? "#fff" : PRIMARY }}>
                  <Icon size={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-extrabold" style={{ color: INK }}>{x.n}. {x.t}</p>
                  <Sub className="truncate">{x.d}</Sub>
                </div>
                {idx < 2 && <ChevronRight size={14} className="ml-auto shrink-0" style={{ color: FAINT }} />}
              </div>
            );
          })}
        </div>
        {!pick && <div className="mt-3 rounded-xl px-3 py-2 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>위에서 회원을 선택하면 촬영과 분석 도구가 열립니다.</div>}
      </Card>
      {cardFor && hub && !pick && (
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-extrabold" style={{ color: PRIMARY }}>
              애프터 저장 완료 · 이제 결과 카드를 만드세요
            </p>
            <button onClick={() => setCardFor(null)} className="shrink-0 rounded-full p-1.5" style={{ backgroundColor: CANVAS }}><X size={13} style={{ color: SUB }} /></button>
          </div>
          {hub(cardFor)}
        </div>
      )}
      {pick && hub && (
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-extrabold" style={{ color: INK }}>
              {members.find((m) => m.id === pick)?.name || "회원"} 님 분석
            </p>
            <button onClick={() => onOpen(pick)} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ backgroundColor: CANVAS, color: PRIMARY }}>회원 상세로</button>
            <button onClick={() => setPick(null)} className="shrink-0 rounded-full p-1.5" style={{ backgroundColor: CANVAS }}><X size={13} style={{ color: SUB }} /></button>
          </div>
          {hub(pick)}
        </div>
      )}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: TINT }}><Users size={16} style={{ color: PRIMARY }} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold" style={{ color: INK }}>{pick ? "선택 회원 분석 기록" : "회원 분석 목록"}</h3>
            <Sub>{pick ? `${members.find((m) => m.id === pick)?.name || "회원"} 님의 저장된 분석` : <>{members.filter((m) => !isDraft(m)).length}명 중 <b style={{ color: PRIMARY }}>{done}명</b> 분석 완료</>}</Sub>
          </div>
        </div>

      </Card>
      {rows.length === 0 && <Card className="p-8 text-center"><Sub>회원이 없습니다</Sub></Card>}
      {(pick ? records.filter(({ m }) => m.id === pick) : records).map(({ m, rec }) => (
        <button key={`${m.id}:${rec.id}`} onClick={() => setViewing({ memberId: m.id, poseId: rec.id })} className="w-full text-left">
          <Card className="flex items-center gap-3 p-3">
            <PoseThumb rec={rec} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-extrabold" style={{ color: INK }}>
                {m.name || "이름 미입력"}
                {ageOf(m) !== null && <span className="text-xs font-medium" style={{ color: SUB }}>{ageOf(m)}세</span>}
              </p>
              <Sub className="block">{ymd(rec.date)} · {rec.view === "front" ? "전면" : rec.view === "side" ? "측면" : "후면"}</Sub>
              <div className="mt-1 flex flex-wrap gap-1">
                {(rec.metrics || []).slice(0, 3).map((x) => (
                  <span key={x.key} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: INK2 }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: levelDot[x.level] || SUB }} />
                    {x.label.replace(" 각도", "")} {x.value}{x.unit}
                  </span>
                ))}
              </div>
            </div>
            <ChevronRight size={16} style={{ color: FAINT }} />
          </Card>
        </button>
      ))}
      {records.length === 0 && rows.length > 0 && <Card className="p-6 text-center"><Sub>저장된 분석 기록이 없습니다. 위에서 회원을 선택해 첫 분석을 시작하세요.</Sub></Card>}
      {openedRecord && (
        <SavedPoseViewer rec={openedRecord.rec} memberName={openedRecord.m.name} onClose={() => setViewing(null)} onToast={onToast} />
      )}
    </div>
  );
}

function ReferenceAnalysisTab({ members, photos, selectedId, selectedPoseId, onSelect, hub }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const allRows = members.filter((m) => !isDraft(m)).map((m) => {
    const ph = photos[m.id] || {};
    const poses = (ph.poses || []).filter((p) => p && p.metrics);
    const last = poses[0] || null;
    const lastDate = last?.date || "";
    const lastViews = new Set(poses.filter((p) => p.date === lastDate).map((p) => p.view));
    const draftCount = ["front", "side", "back"].filter((d) => (ph[d] || []).length > 0).length;
    const completedDates = new Set(poses.map((p) => p.date)).size;
    return { m, poses, last, lastViews, draftCount, comparable: completedDates >= 2,
      status: poses.some((p) => p.reviewRequired) ? "review" : last ? "done" : draftCount ? "draft" : "none" };
  });
  const rows = allRows.filter((x) => (!q.trim() || (x.m.name || "").includes(q.trim()))
    && (filter === "all" || filter === "comparable" ? (filter === "all" || x.comparable) : x.status === filter))
    .sort((a, b) => String(b.last?.date || "").localeCompare(String(a.last?.date || "")) || String(a.m.name).localeCompare(String(b.m.name), "ko"));
  const member = members.find((m) => m.id === selectedId) || null;
  if (member) {
    return (
      <div className="flex h-full min-h-0 flex-col" style={{ backgroundColor: PAGE }}>
        <header className="flex shrink-0 items-center" style={{ height: 52, padding: "0 8px", backgroundColor: CARD, borderBottom: `1px solid ${LINE}` }}>
          <button type="button" onClick={() => onSelect(null)} aria-label="체형분석 목록" className="flex h-11 w-11 items-center justify-center" style={{ color: SUB }}><ChevronLeft size={19} /></button>
           <div className="min-w-0 flex-1"><h1 className="truncate" style={{ fontSize: 17, fontWeight: 700, color: INK }}>{member.name} 체형분석</h1></div>
        </header>
        <main className="pt-scroll min-h-0 flex-1 overflow-y-auto" style={{ padding: "10px 12px 18px" }}>{hub(member.id, selectedPoseId)}</main>
      </div>
    );
  }
  const done = allRows.filter((r) => r.last).length;
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ backgroundColor: PAGE }}>
      <header className="shrink-0" style={{ padding: "10px 14px 0", backgroundColor: PAGE }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: INK }}>체형분석</h1>
        <p style={{ marginTop: 3, marginBottom: 8, fontSize: 12.5, color: SUB }}>회원의 체형 변화를 기록하고 비교하세요.</p>
        <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: SUB }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회원 이름 검색" className="w-full pl-9 pr-3 text-sm outline-none" style={{ height: 44, borderRadius: 12, border: `1px solid ${LINE}`, backgroundColor: CARD, color: INK }} /></div>
        <div className="flex flex-wrap gap-1.5 py-2">{[{k:"all",l:"전체"},{k:"draft",l:"작성 중"},{k:"review",l:"검토 필요"},{k:"done",l:"완료"},{k:"comparable",l:"비교 가능"}].map((o) => <button type="button" key={o.k} onClick={() => setFilter(o.k)} className="shrink-0" style={{ minHeight: 36, padding: "0 11px", borderRadius: 999, border: `1px solid ${filter === o.k ? BRAND : LINE}`, backgroundColor: filter === o.k ? LAVENDER_S : CARD, color: filter === o.k ? BRAND_D : INK2, fontSize: 12, fontWeight: 600 }}>{o.l}</button>)}</div>
      </header>
      <main className="pt-scroll min-h-0 flex-1 overflow-y-auto" style={{ padding: "2px 14px 18px" }}>
        {!rows.length && <div className="py-12 text-center"><Activity size={22} className="mx-auto" style={{ color: FAINT }} /><p className="mt-2 text-sm font-semibold" style={{ color: INK }}>조건에 맞는 회원이 없습니다</p></div>}
        {rows.map(({ m, poses, last, lastViews, draftCount, comparable, status }) => <div key={m.id} className="mb-2" style={{ padding: "11px 12px", borderRadius: 14, backgroundColor: CARD, border: `1px solid ${LINE}` }}><button type="button" onClick={() => onSelect(m.id, last?.id || null)} className="flex w-full items-center gap-2 text-left">
          <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="block max-w-[44%] truncate" style={{ fontSize: 14, fontWeight: 600, color: INK }}>{m.name}</span>{status !== "none" && <span style={{ padding: "2px 6px", borderRadius: 6, backgroundColor: status === "review" ? WARN_S : status === "done" ? GOOD_S : CANVAS, color: status === "review" ? WARN : status === "done" ? GOOD : INK2, fontSize: 10, fontWeight: 600 }}>{status === "review" ? "검토 필요" : status === "done" ? "완료" : "작성 중"}</span>}{comparable && <span style={{ padding: "2px 6px", borderRadius: 6, backgroundColor: TINT, color: BRAND_D, fontSize: 10, fontWeight: 600 }}>비교 가능</span>}</span><span className="mt-1 flex items-center gap-2" style={{ fontSize: 11, color: SUB }}><span>{last ? `최근 ${ymd(last.date)}` : "아직 체형분석 이력이 없어요"}</span><span className="flex items-center gap-1" aria-label={`촬영 등록 ${last ? lastViews.size : draftCount}/3`}>{["front","side","back"].map((d) => <i key={d} aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: (last ? lastViews.has(d) : (photos[m.id]?.[d] || []).length > 0) ? BRAND : "#D5DAE3" }} />)}<span>{last ? lastViews.size : draftCount}/3</span></span>{last && <span>저장 {poses.length}건</span>}</span></span>
          <ChevronRight size={15} style={{ color: FAINT }} />
        </button>{!last && <button type="button" onClick={() => onSelect(m.id, null)} className="mt-2 w-full" style={{ height: 38, borderRadius: 8, border: `1px solid #D5D1EB`, backgroundColor: TINT, color: BRAND_D, fontSize: 12, fontWeight: 600 }}>첫 체형분석 시작</button>}</div>)}
      </main>
    </div>
  );
}

/* 인바디 요약과 그래프는 같은 데이터라 한 카드로 합친다 */
function InbodyPanel({ member, onGo }) {
  const [graph, setGraph] = useState(false);
  return (
    <div className="space-y-2">
      <ChangeSummary member={member} onGo={onGo} />
      <button onClick={() => setGraph((v) => !v)} className="flex w-full items-center gap-2 rounded-2xl px-4 py-2.5" style={{ backgroundColor: CARD, boxShadow: SHADOW }}>
        <Activity size={14} style={{ color: PRIMARY }} />
        <span className="text-xs font-extrabold" style={{ color: INK }}>인바디 그래프</span>
        <span className="flex-1" />
        <ChevronDown size={14} style={{ color: SUB, transform: graph ? "rotate(180deg)" : "none" }} />
      </button>
      {graph && <InbodyChart member={member} />}
    </div>
  );
}

/* 사진·체형 관련 4개를 한 카드 안 탭으로 묶는다 (스크롤 단축) */
function PhotoHub(p) {
  const TABS = [
    { k: "pose", l: "AI 체형 분석" },
    { k: "card", l: "결과 카드" },
    { k: "compare", l: "비포·애프터" },
    { k: "sets", l: "사진 모음" },
  ];
  const [tab, setTab] = useState(p.initialTab || "pose");
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className="shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-extrabold"
            style={tab === t.k ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{t.l}</button>
        ))}
      </div>
      {tab === "compare" && <Guard label="비포애프터 분석"><PhotoCompare member={p.member} photos={p.photos} briefing={p.briefing} onSavePhoto={p.onSavePhoto} onRemove={p.onRemovePhoto} onSaveMarks={p.onSaveMarks} onAdjust={p.onAdjustPhoto} onToast={p.onToast} onSaveSet={p.onSaveSet} /></Guard>}
      {tab === "pose" && <Guard label="AI 체형 분석"><PoseAnalyzer member={p.member} photos={p.photos} onSavePose={p.onSavePose} onDeletePose={p.onDeletePose} onSaveCaptureDraft={p.onSaveCaptureDraft} onToast={p.onToast} onSaved={p.onSaved} roleLabel={p.roleLabel} /></Guard>}
      {tab === "card" && <Guard label="결과 카드"><ResultCardMaker member={p.member} saved={(p.photos?.poses || []).filter((x) => x && x.metrics)} centerName={p.centerName} onToast={p.onToast} onGoAnalyze={() => setTab("pose")} /></Guard>}
      {tab === "sets" && <Guard label="사진 모음"><BeforeAfterSets memberName={p.member.name} photos={p.photos} onToggleFav={p.onToggleFav} onDelete={p.onDeleteSet} /></Guard>}
    </div>
  );
}

function Dashboard({ member, photos, schedule, onBack, briefing, onSavePhoto, onRemovePhoto, onSaveMarks, onAdjustPhoto, onDeleteNote, onToast, goRecord, onToggleFav, onDeleteSet, onBrief, onSavePose, onDeletePose, onSaveSet, centerName, goAnalysis }) {
  const total = left(member), low = total <= 3;
  const att = attendanceOf(schedule, member.id);
  const d = ddaySafe(member.contractEnd);
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 py-1 text-sm font-bold md:hidden" style={{ color: SUB }}><ArrowLeft size={16} /> 목록</button>
      <Guard label="회원 요약">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold text-white" style={{ background: GRAD }}>{(member.name || "?").slice(0, 1)}</div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold" style={{ color: isDraft(member) ? SUB : INK }}>{isDraft(member) ? "이름을 입력해 주세요" : `${member.name} 회원님`}</h2>
            <Sub>{ageOf(member) !== null ? `${ageOf(member)}세 · ` : ""}담당 {member.instructor || "-"}{att.rate !== null ? ` · 출석률 ${att.rate}%` : ""}</Sub>
          </div>
          <div className="rounded-xl px-3 py-2 text-center" style={{ backgroundColor: low ? BAD_S : CANVAS }}>
            <Sub>총 잔여</Sub>
            <p className="text-lg font-extrabold tabular-nums" style={{ color: low ? BAD : INK }}>{total}회</p>
            <Sub>정규 {member.regular} · 서비스 {member.service}</Sub>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {member.goal && <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}><Target size={12} /> {member.goal}</span>}
          {(member.focus || []).map((f) => <span key={f} className="rounded-full px-2.5 py-1 text-xs" style={{ backgroundColor: CANVAS, color: SUB }}>{f}</span>)}
          {d !== null && <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: d <= 14 ? WARN_S : CANVAS, color: d <= 14 ? WARN : SUB }}>만료 {d < 0 ? `${Math.abs(d)}일 경과` : `D-${d}`}</span>}
          {!briefing && <button onClick={() => goRecord("info")} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: CANVAS, color: PRIMARY }}><Pencil size={11} /> 정보 수정</button>}
        </div>
        {!briefing && paidTotal(member) > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
            <Ticket size={13} style={{ color: PRIMARY }} />
            <span className="text-sm font-extrabold tabular-nums" style={{ color: INK }}>누적 결제 ₩{won(paidTotal(member))}</span>
            <span className="text-xs" style={{ color: SUB }}>등록 {(member.payments || []).length}건 · 총 {paidCount(member)}회 · 회당 평균 ₩{won(paidAvg(member))}</span>
          </div>
        )}
      </Card>
      </Guard>
      {isHold(member) && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: WARN_S, color: WARN }}>홀딩 중</span>
            <Sub>{member.holdFrom ? `${ymd(member.holdFrom)} 부터` : "시작일 미입력"}{member.holdUntil ? ` · 복귀 예정 ${ymd(member.holdUntil)}` : ""}{member.holdReason ? ` · ${member.holdReason}` : ""}</Sub>
            {!briefing && <button onClick={() => goRecord("info")} className="ml-auto rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: PRIMARY }}>상태 변경</button>}
          </div>
        </Card>
      )}
      {isEnded(member) && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: BAD_S, color: BAD }}>종료 회원</span>
            <Sub>{member.endedAt ? `${ymd(member.endedAt)} 종료` : "종료일 미입력"}{member.endedReason ? ` · ${member.endedReason}` : ""}</Sub>
            <button onClick={() => onBrief(member)} className="ml-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>
              <Sparkles size={12} /> 재등록 브리핑
            </button>
          </div>
          {member.endedMemo && <p className="mt-2 text-sm" style={{ color: INK2 }}>{member.endedMemo}</p>}
        </Card>
      )}
      <Guard label="인바디"><InbodyPanel member={member} onGo={() => goRecord("inbody")} /></Guard>
      <Guard label="체형분석 안내">
        <Card className="p-4">
          <button onClick={() => goAnalysis && goAnalysis()} className="flex w-full items-center gap-3 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: GRAD }}><Activity size={18} color="#fff" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold" style={{ color: INK }}>체형분석 · 결과 카드</p>
              <Sub>사진 촬영과 카드 만들기는 <b style={{ color: PRIMARY }}>체형분석 탭</b>에서</Sub>
            </div>
            <span className="shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>
              {(photos?.poses || []).filter((p) => p && p.metrics).length}건
            </span>
            <ChevronRight size={16} style={{ color: FAINT }} />
          </button>
        </Card>
      </Guard>
      <Guard label="수업 이력"><LessonHistory member={member} schedule={schedule} /></Guard>
      <Guard label="코멘트 기록"><Timeline member={member} briefing={briefing} onDelete={onDeleteNote} /></Guard>
      <Guard label="종합 평가"><OverallReview member={member} briefing={briefing} onToast={onToast} schedule={schedule} /></Guard>
    </div>
  );
}
function RecordTab({ db, selectedId, setSelectedId, section, setSection, onSaveInbody, onDeleteInbody, onSaveNote, onPatch, onDelete, onToast, onSettings, onLeaveNote, backHint, locked, voiceHint, onVoiceSeen }) {
  const [openInfo, setOpenInfo] = useState(false);
  const members = db.members;
  const member = members.find((m) => m.id === selectedId) || members[0];
  if (!member) return <Card className="p-8 text-center"><p className="text-sm font-bold">회원을 먼저 추가해 주세요.</p></Card>;
  const nb = inbodyOf(member);
  const last = nb[nb.length - 1] || null;
  const SECTIONS = [
    { k: "inbody", l: "인바디", icon: Activity }, { k: "note", l: "코멘트", icon: MessageSquare },
    { k: "perf", l: "수행능력", icon: Target }, { k: "info", l: "회원정보", icon: Ticket },
  ];
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-4">
        {!locked && <Field label="기록할 회원">
          <div className="relative w-full" style={{ maxWidth: "100%" }}>
            <select value={member.id} onChange={(e) => setSelectedId(e.target.value)}
              className="block w-full min-w-0 max-w-full truncate rounded-2xl border-0 py-3.5 pl-11 pr-10 text-sm font-extrabold outline-none"
              style={{ appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
                backgroundColor: TINT, color: PRIMARY, boxShadow: `inset 0 0 0 2px ${PRIMARY}`,
                textOverflow: "ellipsis", maxWidth: "100%", boxSizing: "border-box" }}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name || "이름 미입력"}{isEnded(m) ? " (종료)" : ""} · {left(m) > 0 ? `잔여 ${left(m)}회` : "잔여 없음"}</option>)}
            </select>
            <Users size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: PRIMARY }} />
            <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" style={{ color: PRIMARY }} />
          </div>
        </Field>}
        <button onClick={() => setOpenInfo((v) => !v)} aria-expanded={openInfo}
          className="mt-2 flex w-full items-center gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
          <span className="min-w-0 flex-1 truncate text-left text-xs font-bold" style={{ color: INK }}>
            {member.goal || (member.passName ? member.passName : "목표 · 수강권 미입력")}
          </span>
          <span className="shrink-0 text-xs font-bold" style={{ color: PRIMARY }}>{openInfo ? "접기" : "자세히"}</span>
          <ChevronDown size={14} className="shrink-0" style={{ color: PRIMARY, transform: openInfo ? "rotate(180deg)" : "none", transition: "transform .18s ease" }} />
        </button>
        {openInfo && (
          <div className="mt-2 rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
            <div className="grid grid-cols-2 gap-2">
              {[
                { l: "상태", v: isEnded(member) ? "종료" : isHold(member) ? "홀딩" : "진행중" },
                { l: "담당 강사", v: member.instructor || "-" },
                { l: "연락처", v: member.phone || "-" },
                { l: "나이", v: ageOf(member) !== null ? `${ageOf(member)}세${member.birth ? ` (${ymd(member.birth)})` : ""}` : "-" },
                { l: "수강권", v: member.passName || "-" },
                { l: "잔여 내역", v: `정규 ${num(member.regular)} · 서비스 ${num(member.service)}` },
                { l: "시작일", v: member.startDate ? ymd(member.startDate) : "-" },
                { l: "만료일", v: member.contractEnd ? `${ymd(member.contractEnd)}${ddaySafe(member.contractEnd) === null ? "" : ddaySafe(member.contractEnd) >= 0 ? ` (D-${ddaySafe(member.contractEnd)})` : ` (${-ddaySafe(member.contractEnd)}일 지남)`}` : "-" },
              ].map((x) => (
                <div key={x.l} className="min-w-0 rounded-xl bg-white px-3 py-2">
                  <p className="text-xs" style={{ color: SUB }}>{x.l}</p>
                  <p className="truncate text-xs font-extrabold" style={{ color: INK }}>{x.v}</p>
                </div>
              ))}
            </div>
            {(member.focus || []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(member.focus || []).map((x) => <span key={x} className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>{x}</span>)}
              </div>
            )}
            {last && <p className="mt-2 text-xs font-bold tabular-nums" style={{ color: INK2 }}>최근 인바디 {ymd(last.date)} · {last.weight}kg · 근육 {last.smm}kg · 지방 {last.fat}%</p>}
          </div>
        )}
        <p className="mb-1.5 mt-4 text-xs font-bold" style={{ color: SUB }}>무엇을 기록할까요?</p>
        <div className="flex gap-1.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon, on = section === s.k;
            return (
              <button key={s.k} onClick={() => { setSection(s.k); onLeaveNote && onLeaveNote(); }}
                className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-2xl px-1 py-3 text-xs font-extrabold"
                style={on
                  ? { background: GRAD, color: "#fff", boxShadow: `0 4px 12px ${RING}`, border: "1px solid transparent" }
                  : { backgroundColor: CANVAS, color: INK2, border: `1px solid ${LINE}` }}>
                <Icon size={17} /> {s.l}
              </button>
            );
          })}
        </div>
      </Card>
      {section === "inbody" && <InbodyForm member={member} last={last} onSave={onSaveInbody} onDelete={onDeleteInbody} onPatch={onPatch} onToast={onToast} />}
      {section === "note" && <NoteForm member={member} schedule={db.schedule} onSave={onSaveNote} settings={db.settings} onSettings={onSettings} backHint={backHint} voiceHint={voiceHint} onVoiceSeen={onVoiceSeen} />}
      {section === "perf" && <PerfForm member={member} onPatch={onPatch} onToast={onToast} />}
      {section === "info" && <InfoForm member={member} members={members} onPatch={onPatch} onDelete={onDelete} onToast={onToast} />}
    </div>
  );
}
const QR_FIELDS = [
  { k: "weight", keys: ["weight", "wt", "체중", "몸무게"], min: 20, max: 300 },
  { k: "smm", keys: ["smm", "muscle", "skeletalmuscle", "skeletalmusclemass", "골격근량", "근육량"], min: 5, max: 100 },
  { k: "fat", keys: ["pbf", "bfp", "percentbodyfat", "bodyfatpercentage", "fatpercent", "체지방률", "체지방율"], min: 1, max: 80 },
  { k: "fatMass", keys: ["bfm", "fatmass", "bodyfatmass", "체지방량"], min: 1, max: 150 },
  { k: "bmi", keys: ["bmi", "체질량지수"], min: 5, max: 80 },
  { k: "bmr", keys: ["bmr", "basalmetabolicrate", "기초대사량"], min: 400, max: 4000 },
  { k: "visceral", keys: ["vfl", "vfa", "visceralfat", "visceralfatlevel", "내장지방", "내장지방레벨"], min: 1, max: 40 },
  { k: "score", keys: ["score", "inbodyscore", "인바디점수"], min: 1, max: 120 },
];
const QR_LABEL = { weight: "체중", smm: "골격근량", fat: "체지방률", fatMass: "체지방량", bmi: "BMI", bmr: "기초대사량", visceral: "내장지방", score: "인바디 점수" };
const qrNorm = (v) => String(v || "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

function InbodyForm({ member, last, onSave, onDelete, onPatch, onToast }) {
  const [f, setF] = useState({ date: todayISO(), weight: "", smm: "", fat: "", fatMass: "", bmi: "", bmr: "", visceral: "", score: "", memo: "" });
  const [more, setMore] = useState(false);
  const [g, setG] = useState({ goalWeight: member.goalWeight || "", goalFat: member.goalFat || "" });
  useEffect(() => { setG({ goalWeight: member.goalWeight || "", goalFat: member.goalFat || "" }); }, [member.id]);
  const gDirty = String(g.goalWeight || "") !== String(member.goalWeight || "") || String(g.goalFat || "") !== String(member.goalFat || "");
  const ready = f.weight && f.smm && f.fat;
  const preview = ready && last ? ["weight", "smm", "fat"].map((k) => ({ k, d: +(parseFloat(f[k]) - last[k]).toFixed(1) })) : null;
  const numVal = (v) => (v === "" || v === undefined ? undefined : Number(v));
  return (
    <>
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: TINT }}><Target size={14} style={{ color: PRIMARY }} /></span>
          <div><h3 className="font-extrabold" style={{ color: INK }}>인바디 목표</h3><Sub>그래프 목표선과 종합 평가에 사용됩니다</Sub></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Field label="목표 체중 kg"><input inputMode="decimal" value={g.goalWeight} onChange={(e) => setG({ ...g, goalWeight: e.target.value })} placeholder="예) 54" className={inputCls} /></Field>
          <Field label="목표 체지방률 %"><input inputMode="decimal" value={g.goalFat} onChange={(e) => setG({ ...g, goalFat: e.target.value })} placeholder="예) 24" className={inputCls} /></Field>
        </div>
        <button disabled={!gDirty} onClick={() => { onPatch(member.id, { goalWeight: Number(g.goalWeight) || 0, goalFat: Number(g.goalFat) || 0 }); onToast({ ok: true, msg: "인바디 목표를 저장했습니다." }); }}
          className="mt-3 w-full rounded-2xl py-3 text-sm font-extrabold text-white"
          style={{ backgroundColor: gDirty ? PRIMARY : FAINT }}>
          {gDirty ? "목표 저장하기" : "저장됨 · 변경사항 없음"}
        </button>
      </Card>
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: GOOD_S }}><Activity size={14} style={{ color: GOOD }} /></span>
          <div className="min-w-0 flex-1"><h3 className="font-extrabold" style={{ color: INK }}>인바디 측정 기록지</h3><Sub>기본 3항목은 필수, 상세 항목은 선택입니다</Sub></div>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="측정일"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="체중 kg"><input inputMode="decimal" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} placeholder={last ? String(last.weight) : "0.0"} className={inputCls} /></Field>
            <Field label="골격근량 kg"><input inputMode="decimal" value={f.smm} onChange={(e) => setF({ ...f, smm: e.target.value })} placeholder={last ? String(last.smm) : "0.0"} className={inputCls} /></Field>
            <Field label="체지방률 %"><input inputMode="decimal" value={f.fat} onChange={(e) => setF({ ...f, fat: e.target.value })} placeholder={last ? String(last.fat) : "0.0"} className={inputCls} /></Field>
          </div>
          <button onClick={() => setMore((v) => !v)} className="flex w-full items-center justify-between rounded-2xl px-4 py-2.5" style={{ backgroundColor: CANVAS }}>
            <span className="text-xs font-bold" style={{ color: INK }}>상세 항목 {more ? "접기" : "입력"} (체지방량 · BMI · 기초대사량 · 내장지방 · 점수)</span>
            <ChevronRight size={14} style={{ color: SUB, transform: more ? "rotate(90deg)" : "none" }} />
          </button>
          {more && (
            <div className="grid grid-cols-3 gap-2">
              {INBODY_EXTRA.map((x) => (
                <Field key={x.k} label={`${x.l}${x.u ? ` ${x.u}` : ""}`}>
                  <input inputMode="decimal" value={f[x.k]} onChange={(e) => setF({ ...f, [x.k]: e.target.value })} placeholder={last && last[x.k] ? String(last[x.k]) : "-"} className={inputCls} />
                </Field>
              ))}
            </div>
          )}
          {more && <Field label="측정 메모" hint="선택"><input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="예) 생리 주기 · 식사 직후 측정" className={inputCls} /></Field>}
          {preview && (
            <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl py-3" style={{ backgroundColor: CANVAS }}>
              <Sub>직전 대비</Sub>
              {preview.map((x) => <span key={x.k} className="flex items-center gap-1"><span className="text-xs font-bold" style={{ color: SUB }}>{METRICS[x.k].label}</span><DeltaChip metricKey={x.k} diff={x.d} /></span>)}
            </div>
          )}
          <PrimaryBtn disabled={!ready} onClick={() => {
            onSave(member.id, {
              date: f.date, weight: +f.weight, smm: +f.smm, fat: +f.fat,
              fatMass: numVal(f.fatMass), bmi: numVal(f.bmi), bmr: numVal(f.bmr), visceral: numVal(f.visceral), score: numVal(f.score),
              memo: f.memo || undefined,
            });
            setF({ date: todayISO(), weight: "", smm: "", fat: "", fatMass: "", bmi: "", bmr: "", visceral: "", score: "", memo: "" });
          }}>
            <Plus size={16} /> 측정값 저장
          </PrimaryBtn>
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="font-extrabold" style={{ color: INK }}>측정 기록 ({inbodyOf(member).length}회)</h3>
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {[...inbodyOf(member)].reverse().map((r) => (
            <div key={r.id || `${r.date}-${r.weight}-${r.fat}`} className="rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold tabular-nums" style={{ color: INK }}>{ymd(r.date)}</span>
                <span className="text-xs tabular-nums" style={{ color: SUB }}>{r.weight}kg · 근육 {r.smm}kg · 지방 {r.fat}%</span>
                <button onClick={() => onDelete(member.id, r.id || r.date)} className="ml-auto" style={{ color: FAINT }}><Trash2 size={13} /></button>
              </div>
              {INBODY_EXTRA.some((x) => r[x.k] !== undefined) && (
                <p className="mt-1 text-xs tabular-nums" style={{ color: SUB }}>
                  {INBODY_EXTRA.filter((x) => r[x.k] !== undefined).map((x) => `${x.l} ${r[x.k]}${x.u}`).join(" · ")}
                </p>
              )}
              {r.memo && <p className="mt-1 text-xs" style={{ color: INK2 }}>{r.memo}</p>}
            </div>
          ))}
          {inbodyOf(member).length === 0 && <Sub>아직 측정 기록이 없습니다.</Sub>}
        </div>
      </Card>
          </>
  );
}
/* ===== 음성으로 일지 쓰기 =====
   브라우저 기본 음성 인식(Web Speech API)을 쓴다. 서버가 필요 없어 무료다.
   안 되는 기기에서는 버튼이 나오지 않는다. */
const nativeSTT = () => { try { return (window.Capacitor?.Plugins?.SpeechRecognition) || null; } catch (e) { return null; } };
/* 앱에서는 네이티브 플러그인, 브라우저에서는 Web Speech API */
const sttOK = () => typeof window !== "undefined" && (!!nativeSTT() || !!(window.SpeechRecognition || window.webkitSpeechRecognition));
/* 말한 내용을 항목별로 갈라 준다 */
/* 순서가 곧 우선순위 — 부위는 거의 모든 문장에 나오므로 맨 뒤에 둔다 */
const STT_RULES = [
  { k: "통증·주의", hit: ["통증", "아프", "불편", "저림", "당김", "뻐근", "무리", "주의", "조심", "부상", "염증", "결림"] },
  { k: "다음 계획", hit: ["다음", "차시", "이어서", "숙제", "과제", "집에서", "홈트", "권장", "추천", "계획", "하겠습니다", "예정"] },
  { k: "수행·변화", hit: ["가동", "안정", "향상", "개선", "좋아", "늘었", "줄었", "유지", "정체", "가능", "어려", "버거", "수월", "강화", "회복"] },
  { k: "부위·관찰", hit: ["어깨", "골반", "무릎", "허리", "요추", "흉추", "경추", "목", "발목", "고관절", "척추", "손목", "둔근", "햄스트링", "코어", "복부"] },
];
function sttSplit(text) {
  const out = { "통증·주의": [], "다음 계획": [], "수행·변화": [], "부위·관찰": [], "기타": [] };
  String(text || "")
    .split(/(?<=[.!?])\s+|[,·]\s*|\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((sen) => {
      const hit = STT_RULES.find((r) => r.hit.some((w) => sen.includes(w)));
      out[hit ? hit.k : "기타"].push(sen);
    });
  return out;
}
/* 분류 결과를 일지 문장으로 정리 */
function sttCompose(groups) {
  const order = ["통증·주의", "수행·변화", "부위·관찰", "다음 계획", "기타"];
  return order
    .filter((k) => groups[k] && groups[k].length)
    .map((k) => `[${k}] ${groups[k].join(", ")}`)
    .join("\n");
}

function VoiceNote({ onApply, highlight, onSeen }) {
  const [on, setOn] = useState(false);
  const [text, setText] = useState("");
  const boxRef = useRef(null);
  useEffect(() => {
    if (!highlight || !boxRef.current) return;
    try { boxRef.current.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
    const t = setTimeout(() => onSeen && onSeen(), 2600);
    return () => clearTimeout(t);
  }, [highlight]);
  const [err, setErr] = useState("");
  const recRef = useRef(null);
  const groups = useMemo(() => sttSplit(text), [text]);
  const start = async () => {
    const NS = nativeSTT();
    if (NS) {
      try {
        const perm = await NS.checkPermissions?.().catch(() => null);
        if (!perm || perm.speechRecognition !== "granted") {
          const req = await NS.requestPermissions?.().catch(() => null);
          if (req && req.speechRecognition !== "granted") { setErr("마이크·음성 인식 권한을 허용해 주세요"); return; }
        }
        setErr(""); setOn(true);
        NS.addListener?.("partialResults", (d) => {
          const t = (d?.matches && d.matches[0]) || "";
          if (t) setText((p) => (p ? p.split(" ⟨")[0] : "") + " ⟨" + t + "⟩");
        });
        const r = await NS.start({ language: "ko-KR", partialResults: true, popup: false });
        const got = (r?.matches && r.matches[0]) || "";
        setText((p) => (p ? p.split(" ⟨")[0] : "").trim() + (got ? (p ? " " : "") + got : ""));
        setOn(false);
        recRef.current = { native: true, stop: () => NS.stop?.() };
        return;
      } catch (e) { setErr("음성 인식을 시작하지 못했습니다"); setOn(false); return; }
    }
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) { setErr("이 기기에서는 음성 인식을 쓸 수 없습니다"); return; }
    try {
      const r = new R();
      r.lang = "ko-KR"; r.continuous = true; r.interimResults = true;
      let fixed = text ? text + " " : "";
      r.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) fixed += t + " "; else live += t;
        }
        setText((fixed + live).trim());
      };
      r.onerror = (e) => { setErr(e?.error === "not-allowed" ? "마이크 권한을 허용해 주세요" : "인식이 중단됐습니다"); setOn(false); };
      r.onend = () => setOn(false);
      recRef.current = r; setErr(""); setOn(true); r.start();
    } catch (e) { setErr("음성 인식을 시작하지 못했습니다"); }
  };
  const stop = () => { try { const NS = nativeSTT(); if (NS) NS.stop?.(); else recRef.current?.stop(); } catch (e) {} setOn(false); };
  useEffect(() => () => { try { recRef.current?.stop(); } catch (e) {} }, []);
  if (!sttOK()) return null;
  const filled = Object.keys(groups).filter((k) => groups[k].length);
  return (
    <div ref={boxRef} className="rounded-2xl p-3" style={{ backgroundColor: CANVAS, boxShadow: highlight ? `0 0 0 2.5px ${PRIMARY}` : "none", transition: "box-shadow .4s ease" }}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs font-extrabold" style={{ color: INK }}>음성으로 일지 쓰기</p>
        <button onClick={on ? stop : start} className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold text-white"
          style={{ backgroundColor: on ? BAD : BRAND }}>
          {on ? <><span className="h-2 w-2 animate-pulse rounded-full bg-white" /> 듣는 중 · 멈추기</> : <><Smartphone size={12} /> 말하기 시작</>}
        </button>
      </div>
      {!text && !on && (
        <Sub className="mt-1.5 block leading-relaxed">
          이렇게 말해 보세요 —<br />
          "오른쪽 어깨 가동범위가 좋아졌습니다. 허리 통증은 없다고 하셨고요. 코어 안정성 향상됐습니다. 다음 시간에는 흉추 신전 이어서 하겠습니다."
        </Sub>
      )}
      {err && <Sub className="mt-1.5 block" style={{ color: BAD }}>{err}</Sub>}
      {text && (
        <>
          <p className="mt-2 rounded-xl px-3 py-2 text-sm leading-relaxed" style={{ backgroundColor: CARD, color: INK }}>{text}</p>
          {filled.length > 0 && (
            <div className="mt-2 space-y-1">
              {filled.map((k) => (
                <div key={k} className="flex items-start gap-1.5">
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>{k}</span>
                  <span className="min-w-0 flex-1 text-xs" style={{ color: INK2 }}>{groups[k].join(", ")}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => { setText(""); setErr(""); }} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ backgroundColor: CARD, color: SUB }}>지우기</button>
            <button onClick={() => { onApply(sttCompose(groups)); setText(""); }} className="flex-1 rounded-xl py-2 text-xs font-extrabold text-white" style={{ background: GRAD }}>
              정리해서 일지에 넣기
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function NoteForm({ member, schedule, onSave, settings, onSettings, backHint, voiceHint, onVoiceSeen }) {
  const [n, setN] = useState({ date: todayISO(), type: "개인레슨", body: "", tags: "" });
  const [group, setGroup] = useState("코어 · 안정성");
  const [adding, setAdding] = useState(false);
  const [newTpl, setNewTpl] = useState("");
  const mine = Array.isArray(settings?.templates) ? settings.templates : [];
  const groups = [...Object.keys(NOTE_TEMPLATES), "내 문구"];
  const chips = group === "내 문구" ? mine : NOTE_TEMPLATES[group] || [];
  const put = (t) => setN((x) => ({ ...x, body: x.body.trim() ? `${x.body.replace(/[\s,]*$/, "")}, ${t}` : t }));
  const saveTpl = () => {
    const v = newTpl.trim();
    if (!v || mine.includes(v)) { setNewTpl(""); setAdding(false); return; }
    onSettings && onSettings({ ...settings, templates: [...mine, v] });
    setNewTpl(""); setAdding(false); setGroup("내 문구");
  };
  const delTpl = (t) => onSettings && onSettings({ ...settings, templates: mine.filter((x) => x !== t) });
  return (
    <Card className="p-5">
      <h3 className="font-extrabold" style={{ color: INK }}>수업 코멘트 작성</h3>
      <Sub>기록만 남습니다. 수강권 차감은 스케줄에서 '출석'을 누를 때만 이뤄집니다</Sub>
      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="수업일"><input type="date" value={n.date} onChange={(e) => setN({ ...n, date: e.target.value })} className={inputCls} /></Field>
          <Field label="수업 종류">
            <select value={n.type} onChange={(e) => setN({ ...n, type: e.target.value })} className={inputCls}>
              {CLASS_TYPES.concat(NON_CLASS_TYPES).map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-extrabold" style={{ color: INK }}>자주 쓰는 문구</p>
            <button onClick={() => { setAdding((v) => !v); setGroup("내 문구"); }} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-bold" style={{ color: PRIMARY }}>
              <Plus size={11} /> 내 문구
            </button>
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {groups.map((g) => (
              <button key={g} onClick={() => setGroup(g)} className="whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-bold"
                style={group === g ? { backgroundColor: BRAND, color: "#fff" } : { backgroundColor: CARD, color: SUB }}>
                {g}{g === "내 문구" && mine.length ? ` ${mine.length}` : ""}
              </button>
            ))}
          </div>
          {adding && (
            <div className="mt-2 flex gap-1.5">
              <input value={newTpl} onChange={(e) => setNewTpl(e.target.value)} placeholder="자주 쓰는 문구를 입력하세요"
                className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm outline-none ring-1 ring-slate-200 focus:ring-2" />
              <button onClick={saveTpl} className="shrink-0 rounded-xl px-3 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>추가</button>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1.5" style={{ boxShadow: "0 1px 2px rgba(20,20,43,.06)" }}>
                <button onClick={() => put(t)} className="text-xs font-bold" style={{ color: INK }}>{t}</button>
                {group === "내 문구" && <button onClick={() => delTpl(t)} style={{ color: FAINT }}><X size={11} /></button>}
              </span>
            ))}
            {chips.length === 0 && <Sub>'내 문구' 버튼으로 자주 쓰는 표현을 저장해 두세요.</Sub>}
          </div>
        </div>
        <VoiceNote highlight={voiceHint} onSeen={onVoiceSeen} onApply={(t) => setN((x) => ({ ...x, body: x.body.trim() ? `${x.body.trim()}\n${t}` : t }))} />
        <Field label="피드백 내용" hint={`${n.body.length}자`}>
          <textarea rows={5} value={n.body} onChange={(e) => setN({ ...n, body: e.target.value })}
            placeholder="위 문구를 눌러 채우거나 직접 입력하세요" className={`${inputCls} resize-none leading-relaxed`} />
        </Field>
        {n.body && (
          <button onClick={() => setN({ ...n, body: "" })} className="text-xs font-bold" style={{ color: SUB }}>내용 지우기</button>
        )}
        <Field label="태그" hint="쉼표로 구분 · 선택">
          <input value={n.tags} onChange={(e) => setN({ ...n, tags: e.target.value })} placeholder="코어, 가동성" className={inputCls} />
        </Field>
        {backHint && (
          <div className="flex items-center gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: TINT }}>
            <CalendarDays size={14} className="shrink-0" style={{ color: PRIMARY }} />
            <span className="text-xs font-bold" style={{ color: INK }}>저장하면 오늘 일정으로 돌아갑니다 · 다음 회원을 이어서 처리하세요</span>
          </div>
        )}
        <PrimaryBtn disabled={!n.body.trim()} onClick={() => {
          onSave(member.id, {
            id: uid(), date: n.date, type: n.type, instructor: member.instructor, body: n.body.trim(),
            tags: n.tags.split(",").map((t) => t.trim()).filter(Boolean),
          });
          setN({ ...n, body: "", tags: "" });
        }}>
          <MessageSquare size={16} /> 코멘트 저장
        </PrimaryBtn>
      </div>
    </Card>
  );
}


const clampScore = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

function PerfForm({ member, onPatch, onToast }) {
  const [newName, setNewName] = useState("");
  const [rows, setRows] = useState(() => (Array.isArray(member.perf) ? member.perf.map((p) => ({ ...p })) : []));
  const [del, setDel] = useState(null);
  useEffect(() => { setRows(Array.isArray(member.perf) ? member.perf.map((p) => ({ ...p })) : []); setDel(null); }, [member.id]);
  const base = Array.isArray(member.perf) ? member.perf : [];
  const dirty = JSON.stringify(rows) !== JSON.stringify(base);
  const set = (i, key, val) => setRows((r) => r.map((p, idx) => (idx === i ? { ...p, [key]: key === "name" ? val : clampScore(val) } : p)));
  const save = () => { onPatch(member.id, { perf: rows }); onToast && onToast({ ok: true, msg: "수행 능력 평가를 저장했습니다." }); };
  return (
    <>
      <Card className="p-5">
        <h3 className="font-extrabold" style={{ color: INK }}>운동 수행 능력 평가</h3>
        <Sub>0~100점 · 회색 눈금 = 첫 평가 · 수정 후 맨 아래 '저장하기'를 눌러야 반영됩니다</Sub>
        <div className="mt-4 space-y-4">
          {rows.map((p, i) => {
            const gain = p.now - p.prev;
            return (
              <div key={i} className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
                <div className="flex items-center gap-2">
                  <input value={p.name} onChange={(e) => set(i, "name", e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" style={{ color: INK }} />
                  <span className="shrink-0 whitespace-nowrap text-sm font-extrabold tabular-nums" style={{ color: INK }}>{p.now}<span className="ml-1 text-xs" style={{ color: gain > 0 ? GOOD : gain < 0 ? BAD : SUB }}>{gain > 0 ? "+" : ""}{gain}</span></span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => set(i, "now", Number(p.now) - 1)} aria-label={`${p.name} 1점 내리기`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: CARD, color: INK }}><Minus size={14} /></button>
                  <input type="range" min="0" max="100" value={p.now} onChange={(e) => set(i, "now", e.target.value)} className="min-w-0 flex-1" style={{ accentColor: GOOD }} />
                  <button onClick={() => set(i, "now", Number(p.now) + 1)} aria-label={`${p.name} 1점 올리기`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: CARD, color: INK }}><Plus size={14} /></button>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs" style={{ color: SUB }}>첫 평가</span>
                  <input inputMode="numeric" value={p.prev} onChange={(e) => set(i, "prev", e.target.value)} className="w-14 rounded-lg bg-white px-2 py-1 text-center text-xs font-bold outline-none" />
                  <span className="text-xs" style={{ color: SUB }}>현재</span>
                  <input inputMode="numeric" value={p.now} onChange={(e) => set(i, "now", e.target.value)} className="w-14 rounded-lg bg-white px-2 py-1 text-center text-xs font-bold outline-none" />
                  <button onClick={() => setDel(i)} aria-label={`${p.name} 항목 삭제`}
                    className="ml-auto flex h-8 items-center gap-1 rounded-full px-3 text-xs font-bold" style={{ color: SUB, backgroundColor: CARD }}><Trash2 size={13} /> 항목 삭제</button>
                </div>
                {del === i && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl p-2.5" style={{ backgroundColor: BAD_S }}>
                    <AlertTriangle size={13} style={{ color: BAD }} />
                    <span className="min-w-0 flex-1 text-xs font-bold" style={{ color: INK }}>'{p.name || "이 항목"}'을(를) 지울까요?</span>
                    <button onClick={() => { setRows((r) => r.filter((_, idx) => idx !== i)); setDel(null); }} className="rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>삭제</button>
                    <button onClick={() => setDel(null)} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold" style={{ color: SUB }}>취소</button>
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && <Sub className="py-4 text-center">평가 항목이 없습니다. 아래에서 추가해 주세요.</Sub>}
          <div className="flex gap-2 pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="평가 항목 추가" className={inputCls} />
            <button onClick={() => { if (!newName.trim()) return; setRows((r) => [...r, { name: newName.trim(), now: 50, prev: 50 }]); setNewName(""); }}
              aria-label="평가 항목 추가" className="flex shrink-0 items-center gap-1 rounded-2xl px-4 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}><Plus size={16} /> 추가</button>
          </div>
        </div>
      </Card>
      <div className="safe-b sticky bottom-0 z-10 pt-2">
        <button onClick={save} disabled={!dirty}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-4 text-sm font-extrabold text-white"
          style={{ backgroundColor: dirty ? PRIMARY : FAINT, boxShadow: SHADOW }}>
          <Check size={16} /> {dirty ? "변경사항 저장하기" : "저장됨 · 변경사항 없음"}
        </button>
      </div>
    </>
  );
}

const INFO_FIELDS = ["name", "age", "birth", "duetWith", "instructor", "phone", "goal", "focus", "passName", "payRate", "groupRate", "regular", "service", "total", "startDate", "contractEnd", "status", "endedAt", "endedReason", "endedMemo", "holdFrom", "holdUntil", "holdReason"];

function PaymentSheet({ member, onClose, onSubmit }) {
  const [f, setF] = useState({
    date: todayISO(), name: member.passName || "", sessions: "", service: "0", amount: "",
    method: "카드", end: member.contractEnd || "", memo: "",
    payRate: member.payRate ? String(member.payRate) : "",
    groupRate: member.groupRate ? String(member.groupRate) : "",
  });
  const [months, setMonths] = useState(0);
  const [more, setMore] = useState(false);
  const n = Number(f.sessions) || 0, amt = Number(f.amount) || 0;
  const unit = n > 0 && amt > 0 ? Math.round(amt / n) : 0;
  const onlyNum = (v) => v.replace(/[^0-9]/g, "");
  /* 회당 수업료를 넣으면 총액이, 총액을 넣으면 회당이 서로 채워진다 */
  const setUnitPrice = (v) => {
    const u = Number(onlyNum(v)) || 0;
    setF((p) => ({ ...p, payRate: onlyNum(v), amount: u > 0 && (Number(p.sessions) || 0) > 0 ? String(u * Number(p.sessions)) : p.amount }));
  };
  const setSessions = (v) => {
    const c = Number(onlyNum(v)) || 0, u = Number(f.payRate) || 0;
    setF((p) => ({ ...p, sessions: onlyNum(v), amount: u > 0 && c > 0 ? String(u * c) : p.amount }));
  };
  const setAmount = (v) => {
    const a = Number(onlyNum(v)) || 0, c = Number(f.sessions) || 0;
    setF((p) => ({ ...p, amount: onlyNum(v), payRate: a > 0 && c > 0 ? String(Math.round(a / c)) : p.payRate }));
  };
  const addMonthsBtn = (k) => {
    const m = Math.max(0, months + k);
    setMonths(m);
    setF((p) => ({ ...p, end: m > 0 ? addMonths(p.date, m) : "" }));
  };
  return (
    <Sheet title="수강권 등록" onClose={onClose}>
      <div className="space-y-3">
        <Field label="수강권 이름"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예) 개인레슨 30회" className={inputCls} /></Field>
        <Field label="정규 횟수"><input inputMode="numeric" value={f.sessions} onChange={(e) => setSessions(e.target.value)} placeholder="30" className={inputCls} /></Field>
        <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
          <p className="mb-2 text-xs font-extrabold" style={{ color: INK }}>이 회원 수업료 <span className="font-bold" style={{ color: SUB }}>· 비워 두면 설정의 기본값</span></p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="개인 1회당 원">
              <input inputMode="numeric" value={f.payRate} onChange={(e) => setUnitPrice(e.target.value)} placeholder="40000" className={inputCls} />
            </Field>
            <Field label="그룹 1회당 원" hint="선택">
              <input inputMode="numeric" value={f.groupRate} onChange={(e) => setF({ ...f, groupRate: onlyNum(e.target.value) })} placeholder="20000" className={inputCls} />
            </Field>
          </div>
          <Sub className="mt-1 block">개인 1회당 × 정규 횟수 = 총 결제 금액이 자동으로 채워집니다</Sub>
        </div>
        <Field label="총 결제 금액 원"><input inputMode="numeric" value={f.amount} onChange={(e) => setAmount(e.target.value)} placeholder="2100000" className={inputCls} /></Field>
        <div className="flex gap-1.5">
          {[100000, 500000, 1000000].map((v) => (
            <button key={v} onClick={() => setF({ ...f, amount: String((Number(f.amount) || 0) + v) })} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>+{won(v)}</button>
          ))}
          <button onClick={() => setF({ ...f, amount: "" })} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>지우기</button>
        </div>
        <div className="rounded-2xl p-4 text-center" style={{ backgroundColor: TINT }}>
          <Sub>결제 금액</Sub>
          <p className="text-2xl font-extrabold tabular-nums" style={{ color: PRIMARY }}>₩{won(amt)}</p>
          <Sub>{n > 0 ? `정규 ${n}회${Number(f.service) ? ` + 서비스 ${f.service}회` : ""} · 회당 ₩${won(unit)}` : "정규 횟수를 입력하면 회당 단가가 계산됩니다"}</Sub>
        </div>
        <Field label="유효기간" hint="누를 때마다 더해집니다">
          <div className="flex gap-1.5">
            {[1, 3, 6, 12].map((k) => (
              <button key={k} onClick={() => addMonthsBtn(k)} className="flex-1 rounded-xl py-2 text-xs font-bold"
                style={{ backgroundColor: CANVAS, color: SUB }}>+{k}개월</button>
            ))}
            <button onClick={() => { setMonths(0); setF({ ...f, end: "" }); }} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>지우기</button>
          </div>
          {months > 0 && <Sub className="mt-1 block">총 <b style={{ color: PRIMARY }}>{months}개월</b> · 만료일 {ymd(f.end)}</Sub>}
        </Field>
        <button onClick={() => setMore((v) => !v)} className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
          <span className="text-xs font-extrabold" style={{ color: INK }}>자세히</span>
          <Sub className="min-w-0 flex-1 truncate text-left">등록일 · 결제수단 · 서비스 횟수 · 만료일 · 메모</Sub>
          <ChevronDown size={14} style={{ color: SUB, transform: more ? "rotate(180deg)" : "none" }} />
        </button>
        {more && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="등록일"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} /></Field>
              <Field label="결제 수단">
                <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} className={inputCls}>
                  {["카드", "현금", "계좌이체", "기타"].map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="서비스 횟수"><input inputMode="numeric" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} placeholder="0" className={inputCls} /></Field>
              <Field label="만료일"><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="메모" hint="선택"><input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="예) 재등록 할인" className={inputCls} /></Field>
          </div>
        )}
        <PrimaryBtn disabled={!(n > 0 && amt > 0)} onClick={() => onSubmit({
          id: uid(), date: f.date, name: f.name || "수강권", sessions: n, service: Number(f.service) || 0,
          amount: amt, unit, method: f.method, end: f.end, memo: f.memo,
          payRate: Number(f.payRate) || 0, groupRate: Number(f.groupRate) || 0,
        })}>
          <Ticket size={16} /> 등록하고 잔여 횟수에 더하기
        </PrimaryBtn>
      </div>
    </Sheet>
  );
}
/* 년·월·일을 같은 크기 세 칸으로 — 기본 날짜 입력기는 년도 칸이 너무 좁다 */
function BirthPick({ value, onChange }) {
  const [y, m, d] = String(value || "").split("-");
  const nowY = new Date().getFullYear();
  const years = Array.from({ length: 90 }, (_, i) => nowY - i);
  const set = (ny, nm, nd) => {
    if (!ny || !nm || !nd) { onChange(""); return; }
    const last = new Date(Number(ny), Number(nm), 0).getDate();
    const dd = Math.min(Number(nd), last);
    onChange(`${ny}-${String(nm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
  };
  const days = y && m ? new Date(Number(y), Number(m), 0).getDate() : 31;
  const box = "w-full min-w-0 rounded-2xl border-0 py-3 pl-3 pr-3 text-center text-sm font-bold outline-none ring-1 ring-slate-200 focus:ring-2";
  /* 안드로이드 웹뷰는 select 글자를 회색으로 덮어써서 안 보이는 경우가 있다 */
  const wrap = {
    appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
    backgroundColor: CANVAS, color: INK, WebkitTextFillColor: INK, opacity: 1,
  };
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {[
        { k: "y", v: y || "", ph: "년", list: years, unit: "년" },
        { k: "m", v: m ? String(Number(m)) : "", ph: "월", list: Array.from({ length: 12 }, (_, i) => i + 1), unit: "월" },
        { k: "d", v: d ? String(Number(d)) : "", ph: "일", list: Array.from({ length: days }, (_, i) => i + 1), unit: "일" },
      ].map((o) => (
        <div key={o.k} className="relative min-w-0">
          <select value={o.v} className={box} style={wrap}
            onChange={(e) => {
              const nv = e.target.value;
              set(o.k === "y" ? nv : y, o.k === "m" ? nv : m, o.k === "d" ? nv : d);
            }}>
            <option value="">{o.ph}</option>
            {o.list.map((n) => <option key={n} value={n}>{n}{o.unit}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

function InfoForm({ member, members, onPatch, onDelete, onToast }) {
  const [d, setD] = useState(member);
  const [tag, setTag] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pay, setPay] = useState(false);
  const [hist, setHist] = useState(false);
  const [delPay, setDelPay] = useState(null);
  useEffect(() => { setD(member); }, [member.id]);
  const S = (p) => setD((x) => ({ ...x, ...p }));
  const dirty = INFO_FIELDS.some((k) => JSON.stringify(d[k] ?? "") !== JSON.stringify(member[k] ?? ""));
  const save = () => {
    const p = {};
    INFO_FIELDS.forEach((k) => { p[k] = d[k]; });
    /* 듀엣은 서로를 가리켜야 목록에서 함께 움직인다 */
    onPatch(member.id, p, { duetPrev: member.duetWith || "", duetNext: d.duetWith || "" });
    onToast({ ok: true, msg: "회원 정보를 저장했습니다." });
  };
  const addTag = (t) => { const v = (t || "").trim(); if (!v || (d.focus || []).includes(v)) return; S({ focus: [...(d.focus || []), v] }); setTag(""); };
  const st = isEnded(d) ? "ended" : isHold(d) ? "hold" : "active";
  const addPayment = (rec) => {
    const patch = {
      payments: [rec, ...(member.payments || [])],
      regular: (member.regular || 0) + rec.sessions,
      service: (member.service || 0) + rec.service,
      total: (member.total || 0) + rec.sessions + rec.service,
      passName: rec.name,
    };
    if (rec.payRate > 0) patch.payRate = rec.payRate;
    if (rec.groupRate > 0) patch.groupRate = rec.groupRate;
    if (rec.end) patch.contractEnd = rec.end;
    onPatch(member.id, patch);
    setD((x) => ({ ...x, ...patch }));
    setPay(false);
    onToast({ ok: true, msg: `${rec.name} ${rec.sessions}회 · ₩${won(rec.amount)} 등록` });
  };
  const removePayment = (id) => {
    const rec = (member.payments || []).find((x) => x.id === id);
    if (!rec) return;
    const patch = {
      payments: (member.payments || []).filter((x) => x.id !== id),
      regular: Math.max(0, (member.regular || 0) - rec.sessions),
      service: Math.max(0, (member.service || 0) - rec.service),
      total: Math.max(0, (member.total || 0) - rec.sessions - rec.service),
    };
    onPatch(member.id, patch);
    setD((x) => ({ ...x, ...patch }));
    setDelPay(null);
    onToast({ ok: true, msg: "등록 내역을 삭제하고 잔여를 되돌렸습니다." });
  };
  return (
    <>
      <Card className="p-5">
        <h3 className="font-extrabold" style={{ color: INK }}>회원 정보</h3>
        <Sub>수정 후 맨 아래 '저장하기'를 눌러야 반영됩니다</Sub>
        <div className="mt-4 space-y-3">
          <Field label="이름"><input value={d.name} onChange={(e) => S({ name: e.target.value })} className={inputCls} /></Field>
          <Field label="생년월일" hint={ageFromBirth(d.birth) !== null ? `만 ${ageFromBirth(d.birth)}세` : "선택"}>
            <BirthPick value={d.birth || ""} onChange={(v) => S({ birth: v })} />
          </Field>
          {ageFromBirth(d.birth) === null && (
            <Field label="나이" hint="생년월일을 넣으면 자동으로 계산됩니다">
              <input inputMode="numeric" value={d.age} onChange={(e) => S({ age: e.target.value })} placeholder="예) 34" className={inputCls} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="담당 강사"><input value={d.instructor} onChange={(e) => S({ instructor: e.target.value })} className={inputCls} /></Field>
            <Field label="연락처" hint="선택"><input value={d.phone || ""} onChange={(e) => S({ phone: e.target.value })} placeholder="010-" className={inputCls} /></Field>
          </div>
          <Field label="듀엣 짝" hint="정해두면 회원 목록에서 항상 붙어서 보입니다">
            <SelectBox value={d.duetWith || ""} onChange={(e) => S({ duetWith: e.target.value })}>
              <option value="">없음 (개인)</option>
              {(members || []).filter((m) => m.id !== member.id && isActive(m))
                .map((m) => <option key={m.id} value={m.id}>{m.name || "이름 미입력"}</option>)}
            </SelectBox>
          </Field>
          <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
            <p className="mb-2 text-xs font-extrabold" style={{ color: INK }}>이 회원 개인수업료 <span className="font-bold" style={{ color: SUB }}>· 비워 두면 설정의 기본값</span></p>
            <Field label="개인 1회당 원">
              <input inputMode="numeric" value={d.payRate || ""} placeholder="기본값 사용"
                onChange={(e) => S({ payRate: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })} className={inputCls} />
            </Field>
            <Sub className="mt-1 block">그룹 수업료는 설정 → 내 수업료 기본값에서 한 번에 정합니다</Sub>
          </div>
          <Field label="목표" hint="이름 아래 보라색 태그"><input value={d.goal} onChange={(e) => S({ goal: e.target.value })} placeholder="예) 체지방 감량 · 코어 강화" className={inputCls} /></Field>
          <Field label="체형 · 상태 태그">
            <div className="flex flex-wrap gap-1.5">
              {(d.focus || []).map((x) => (
                <span key={x} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>
                  {x}<button onClick={() => S({ focus: d.focus.filter((y) => y !== x) })}><X size={11} /></button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="직접 입력 후 추가" className={inputCls} />
              <button onClick={() => addTag(tag)} className="shrink-0 rounded-2xl px-4 text-white" style={{ backgroundColor: BRAND }}><Plus size={16} /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {FOCUS_PRESETS.filter((x) => !(d.focus || []).includes(x)).map((x) => (
                <button key={x} onClick={() => addTag(x)} className="rounded-full px-2.5 py-1 text-xs" style={{ backgroundColor: CANVAS, color: SUB }}>+ {x}</button>
              ))}
            </div>
          </Field>
        </div>
      </Card>
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div><h3 className="font-extrabold" style={{ color: INK }}>수강권 · 결제</h3><Sub>등록할 때마다 잔여 횟수가 자동으로 더해집니다</Sub></div>
          <button onClick={() => setPay(true)} className="flex items-center gap-1 rounded-full px-3 py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>
            <Plus size={13} /> 수강권 등록
          </button>
        </div>
        <div className="mt-4 rounded-2xl p-4" style={{ backgroundColor: TOAST }}>
          <p className="text-xs font-bold text-white opacity-70">누적 결제 금액</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums text-white">₩{won(paidTotal(member))}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-xs font-bold" style={{ color: "#A9B6FF" }}>등록 {(member.payments || []).length}건</span>
            <span className="text-xs font-bold" style={{ color: "#A9B6FF" }}>총 {paidCount(member)}회 구매</span>
            <span className="text-xs font-bold" style={{ color: "#A9B6FF" }}>회당 평균 ₩{won(paidAvg(member))}</span>
          </div>
        </div>
        <button onClick={() => setHist(true)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold"
          style={{ backgroundColor: CANVAS, color: INK }}>
          <ClipboardList size={15} style={{ color: PRIMARY }} /> 결제 내역 보기 ({(member.payments || []).length}건)
        </button>
        <div className="mt-4 space-y-3">
          <Sub>현재 잔여 (직접 수정도 가능)</Sub>
          <div className="grid grid-cols-3 gap-2">
            <Field label="정규 잔여"><input inputMode="numeric" value={d.regular} onChange={(e) => S({ regular: Math.max(0, parseInt(e.target.value || "0", 10)) })} className={inputCls} /></Field>
            <Field label="서비스 잔여"><input inputMode="numeric" value={d.service} onChange={(e) => S({ service: Math.max(0, parseInt(e.target.value || "0", 10)) })} className={inputCls} /></Field>
            <Field label="등록 총 횟수"><input inputMode="numeric" value={d.total} onChange={(e) => S({ total: Math.max(0, parseInt(e.target.value || "0", 10)) })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="시작일"><input type="date" value={d.startDate} onChange={(e) => S({ startDate: e.target.value })} className={inputCls} /></Field>
            <Field label="만료일"><input type="date" value={d.contractEnd || ""} onChange={(e) => S({ contractEnd: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="rounded-2xl p-4 text-center" style={{ backgroundColor: TINT }}>
            <Sub>총 잔여 횟수</Sub>
            <p className="text-2xl font-extrabold tabular-nums" style={{ color: PRIMARY }}>{(d.regular || 0) + (d.service || 0)}회</p>
            <Sub>정규 {d.regular} · 서비스 {d.service}</Sub>
          </div>
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="font-extrabold" style={{ color: INK }}>회원 상태</h3>
        <Sub>회원 목록이 이 상태에 따라 3개 탭으로 나뉩니다</Sub>
        <div className="mt-3 flex gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
          {[{ k: "active", l: "진행중", c: PRIMARY }, { k: "hold", l: "홀딩", c: WARN }, { k: "ended", l: "종료", c: BAD }].map((o) => (
            <button key={o.k} onClick={() => S(
              o.k === "ended" ? { status: "ended", endedAt: d.endedAt || todayISO() }
                : o.k === "hold" ? { status: "hold", holdFrom: d.holdFrom || todayISO() }
                : { status: "active" })}
              className="flex-1 rounded-xl py-2.5 text-sm font-bold"
              style={st === o.k ? { backgroundColor: CARD, color: o.c, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{o.l}</button>
          ))}
        </div>
        {st === "hold" && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="홀딩 시작일"><input type="date" value={d.holdFrom || ""} onChange={(e) => S({ holdFrom: e.target.value })} className={inputCls} /></Field>
              <Field label="복귀 예정일" hint="알림 기준"><input type="date" value={d.holdUntil || ""} onChange={(e) => S({ holdUntil: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="홀딩 사유">
              <select value={d.holdReason || "개인 사정"} onChange={(e) => S({ holdReason: e.target.value })} className={inputCls}>
                {["개인 사정", "부상 · 통증", "임신 · 출산", "출장 · 여행", "질병", "기타"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
          </div>
        )}
        {st === "ended" && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="종료일"><input type="date" value={d.endedAt || ""} onChange={(e) => S({ endedAt: e.target.value })} className={inputCls} /></Field>
              <Field label="종료 사유">
                <select value={d.endedReason || "수강권 만료"} onChange={(e) => S({ endedReason: e.target.value })} className={inputCls}>
                  {["수강권 만료", "개인 사정", "이사 · 이직", "가격 부담", "효과 미흡", "타 센터 이동", "기타"].map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
            </div>
            <Field label="종료 메모" hint="재등록 상담 때 참고"><input value={d.endedMemo || ""} onChange={(e) => S({ endedMemo: e.target.value })} placeholder="예) 9월 복귀 희망" className={inputCls} /></Field>
          </div>
        )}
      </Card>
      <Card className="p-5">
        {!confirm ? (
          <button onClick={() => setConfirm(true)} className="flex items-center gap-1.5 text-sm font-bold" style={{ color: SUB }}><Trash2 size={14} /> 회원 삭제</button>
        ) : (
          <div>
            <p className="text-sm font-bold" style={{ color: BAD }}>{member.name || "이 회원"}의 모든 기록이 삭제됩니다.</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => { onDelete(member.id); setConfirm(false); }} className="rounded-xl px-4 py-2 text-sm font-extrabold text-white" style={{ backgroundColor: BAD }}>삭제</button>
              <button onClick={() => setConfirm(false)} className="rounded-xl px-4 py-2 text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>취소</button>
            </div>
          </div>
        )}
      </Card>
      <div className="safe-b sticky bottom-0 z-10 pt-2">
        <button onClick={save} disabled={!dirty}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-4 text-sm font-extrabold text-white"
          style={{ backgroundColor: dirty ? PRIMARY : FAINT, boxShadow: SHADOW }}>
          <Check size={16} /> {dirty ? "변경사항 저장하기" : "저장됨 · 변경사항 없음"}
        </button>
      </div>
      {pay && <PaymentSheet member={member} onClose={() => setPay(false)} onSubmit={addPayment} />}
      {hist && (
        <Sheet title={`${member.name || "회원"} 결제 내역`} onClose={() => setHist(false)}>
          <div className="rounded-2xl p-4" style={{ backgroundColor: TOAST }}>
            <p className="text-xs font-bold text-white opacity-70">누적 결제 금액</p>
            <p className="mt-1 text-3xl font-extrabold tabular-nums text-white">₩{won(paidTotal(member))}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-xs font-bold" style={{ color: "#A9B6FF" }}>등록 {(member.payments || []).length}건</span>
              <span className="text-xs font-bold" style={{ color: "#A9B6FF" }}>총 {paidCount(member)}회 구매</span>
              <span className="text-xs font-bold" style={{ color: "#A9B6FF" }}>회당 평균 ₩{won(paidAvg(member))}</span>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {(member.payments || []).map((r) => (
              <div key={r.id} className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold tabular-nums" style={{ color: INK }}>{ymd(r.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-bold" style={{ color: INK }}>{r.name}</span>
                  <span className="text-sm font-extrabold tabular-nums" style={{ color: PRIMARY }}>₩{won(r.amount)}</span>
                  <button onClick={() => setDelPay(r.id)} style={{ color: FAINT }}><Trash2 size={13} /></button>
                </div>
                <Sub className="mt-0.5">정규 {r.sessions}회{r.service ? ` + 서비스 ${r.service}회` : ""} · 회당 ₩{won(r.unit)} · {r.method}{r.memo ? ` · ${r.memo}` : ""}</Sub>
                {delPay === r.id && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl p-2" style={{ backgroundColor: BAD_S }}>
                    <span className="text-xs font-bold" style={{ color: INK }}>삭제하고 잔여를 되돌릴까요?</span>
                    <button onClick={() => removePayment(r.id)} className="ml-auto rounded-full px-3 py-1 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>삭제</button>
                    <button onClick={() => setDelPay(null)} className="rounded-full bg-white px-3 py-1 text-xs font-bold" style={{ color: SUB }}>취소</button>
                  </div>
                )}
              </div>
            ))}
            {(member.payments || []).length === 0 && (
              <div className="py-8 text-center">
                <Ticket size={20} className="mx-auto" style={{ color: FAINT }} />
                <Sub className="mt-2">등록 이력이 없습니다. '수강권 등록'으로 첫 결제를 기록해 보세요.</Sub>
              </div>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
const HANDOFF_ABC = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const handoffId = () => {
  let v = "";
  for (let i = 0; i < 8; i++) v += HANDOFF_ABC[Math.floor(Math.random() * HANDOFF_ABC.length)];
  return v.slice(0, 4) + "-" + v.slice(4);
};
const normCode = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8);
const fmtCode = (v) => { const x = normCode(v); return x.length > 4 ? x.slice(0, 4) + "-" + x.slice(4) : x; };
const handoffKey = (code) => "pilateacher_handoff_" + normCode(code);
const packHandoff = (db, photos, withPhotos, from) => JSON.stringify({
  app: "pilateacher", kind: "handoff", ver: 1, at: new Date().toISOString(),
  from: from || "", center: (db && db.settings && db.settings.center) || "",
  members: (db && db.members) || [], schedule: (db && db.schedule) || [],
  photos: withPhotos ? (photos || {}) : {},
});
function readHandoff(text) {
  let d = null;
  try { d = JSON.parse(String(text || "").trim()); } catch (e) { return null; }
  if (!d || d.kind !== "handoff" || !Array.isArray(d.members)) return null;
  return d;
}
function mergeHandoff(cur, inc, staff) {
  const members = [...((cur && cur.members) || [])];
  ((inc && inc.members) || []).forEach((m) => {
    if (!m || !m.id) return;
    const i = members.findIndex((x) => x.id === m.id);
    if (i >= 0) members[i] = m; else members.push(m);
  });
  const schedule = [...((cur && cur.schedule) || [])];
  ((inc && inc.schedule) || []).forEach((x0) => {
    if (!x0 || !x0.id) return;
    const i = schedule.findIndex((x) => x.id === x0.id);
    if (i >= 0) schedule[i] = x0; else schedule.push(x0);
  });
  return normalizeDb({ settings: cur.settings, members, schedule }, staff);
}
const packSize = (t) => (String(t || "").length / 1048576).toFixed(1);

function HandoffCard({ db, photos, account, onImport, onToast }) {
  const [mode, setMode] = useState(null);
  const [withPhotos, setWithPhotos] = useState(false);
  const [pack, setPack] = useState(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [paste, setPaste] = useState("");
  const [inc, setInc] = useState(null);
  const [err, setErr] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const copy = async (t, msg) => {
    try { await navigator.clipboard.writeText(t); onToast({ ok: true, msg }); }
    catch (e) { onToast({ ok: false, msg: "복사하지 못했습니다. 길게 눌러 직접 복사해 주세요." }); }
  };
  const exportAll = async () => {
    try {
      const text = packHandoff(db, await photosForExport(photos), true, account && account.name);
      const blob = new Blob([text], { type: "application/json" });
      const filename = `필라티쳐_백업_${todayISO()}.json`;
      try {
        const file = new File([blob], filename, { type: "application/json" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "필라티쳐 백업" });
          return;
        }
      } catch (e) {}
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast({ ok: true, msg: "백업 파일을 저장했습니다." });
    } catch (e) { onToast({ ok: false, msg: "백업 파일을 만들지 못했습니다." }); }
  };
  const importFile = async (file) => {
    if (!file) return;
    setErr(""); setInc(null); setConfirmAll(false);
    try {
      const d = readHandoff(await file.text());
      if (!d) { setErr("필라티쳐 백업 파일이 아닙니다. 내보내기로 만든 .json 파일을 골라 주세요."); return; }
      setInc(d);
    } catch (e) { setErr("파일을 읽지 못했습니다."); }
  };
  const make = async () => {
    setBusy(true); setErr("");
    let text = packHandoff(db, withPhotos ? await photosForExport(photos) : {}, withPhotos, account && account.name);
    if (withPhotos && text.length > 4.5 * 1048576) {
      text = packHandoff(db, {}, false, account && account.name);
      onToast({ ok: false, msg: "사진 용량이 커서 사진은 빼고 만들었습니다." });
    }
    const c = handoffId();
    let shared = false;
    try { await window.storage.set(handoffKey(c), text, true); shared = true; } catch (e) {}
    if (!shared) {
      try { await window.storage.set(handoffKey(c), text); }
      catch (e) { onToast({ ok: false, msg: "저장 공간이 부족합니다. 아래 '인계 코드 전체 복사'로 전달해 주세요." }); }
    }
    setPack({ code: c, text, shared });
    setBusy(false);
  };
  const take = async () => {
    setBusy(true); setErr(""); setInc(null); setConfirmAll(false);
    const key = handoffKey(code);
    let val = null;
    try { const r = await window.storage.get(key, true); if (r && r.value) val = r.value; } catch (e) {}
    if (!val) { try { const r = await window.storage.get(key); if (r && r.value) val = r.value; } catch (e) {} }
    const d = readHandoff(val);
    if (!d) setErr("이 번호로 받을 자료를 찾지 못했습니다. 번호를 확인하거나, 아래에 인계 코드 텍스트를 붙여넣어 주세요.");
    else setInc(d);
    setBusy(false);
  };
  const readPaste = () => {
    setErr(""); setConfirmAll(false);
    const d = readHandoff(paste);
    if (!d) { setInc(null); setErr("인계 코드 형식이 아닙니다. 넘겨주신 분이 복사한 코드 전체를 붙여넣어 주세요."); return; }
    setInc(d);
  };
  const apply = (how) => {
    onImport(inc, how);
    setInc(null); setPaste(""); setCode(""); setMode(null); setConfirmAll(false);
  };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: TINT }}><Users2 size={14} style={{ color: PRIMARY }} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold" style={{ color: INK }}>회원 인계 · DB 넘기기</h3>
          <Sub>담당이 바뀔 때 회원 · 수업 기록을 통째로 주고받습니다</Sub>
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        <button onClick={() => { setMode(mode === "give" ? null : "give"); setPack(null); }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-extrabold"
          style={mode === "give" ? { background: GRAD, color: "#fff" } : { backgroundColor: CANVAS, color: INK }}>
          <Upload size={14} /> 내 자료 넘기기
        </button>
        <button onClick={() => { setMode(mode === "take" ? null : "take"); setInc(null); setErr(""); }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-extrabold"
          style={mode === "take" ? { background: GRAD, color: "#fff" } : { backgroundColor: CANVAS, color: INK }}>
          <Download size={14} /> 번호로 받아오기
        </button>
      </div>
      {mode === "give" && (
        <div className="mt-3 space-y-3">
          <button onClick={() => setWithPhotos((v) => !v)} className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: withPhotos ? BRAND : CARD, border: `1px solid ${withPhotos ? BRAND : LINE}` }}>
              {withPhotos && <Check size={12} color="#fff" />}
            </span>
            <span className="min-w-0 flex-1 text-left text-xs font-bold" style={{ color: INK }}>비포애프터 사진도 함께 넘기기</span>
            <Sub>용량이 커집니다</Sub>
          </button>
          <button onClick={make} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3.5 text-sm font-extrabold text-white disabled:opacity-60" style={{ backgroundColor: BRAND }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Ticket size={15} />} 인계 코드 만들기
          </button>
          <button onClick={exportAll} className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold" style={{ backgroundColor: CANVAS, color: INK }}>
            <Download size={14} /> 백업 파일로 내보내기 (.json)
          </button>
          <Sub>기기가 바뀌거나 고장 났을 때 되살리는 유일한 방법입니다. 일주일에 한 번은 내보내 두세요.</Sub>
          {pack && (
            <div className="rounded-2xl p-4" style={{ backgroundColor: TINT }}>
              <Sub>인계 번호</Sub>
              <p className="mt-0.5 text-3xl font-extrabold tabular-nums tracking-widest" style={{ color: PRIMARY }}>{pack.code}</p>
              <p className="mt-2 text-xs font-bold" style={{ color: INK }}>
                회원 {(db.members || []).length}명 · 수업 {(db.schedule || []).length}건{withPhotos ? " · 사진 포함" : ""} · {packSize(pack.text)}MB
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button onClick={() => copy(pack.code, "인계 번호를 복사했습니다.")} className="flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-extrabold" style={{ color: PRIMARY }}><Copy size={12} /> 번호 복사</button>
                <button onClick={() => copy(pack.text, "인계 코드를 복사했습니다. 메시지로 보내 주세요.")} className="flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-bold" style={{ color: INK }}><Copy size={12} /> 인계 코드 전체 복사</button>
              </div>
              <Sub className="mt-2">
                {pack.shared ? "같은 앱을 쓰는 기기면 번호만 알려 주세요. 다른 기기라면 " : "이 번호는 이 기기에만 저장됩니다. 받는 분에게는 "}
                '인계 코드 전체 복사'로 보낸 내용을 상대가 붙여넣으면 됩니다.
                코드 안에 회원 이름·연락처·기록이 그대로 들어 있으니 받는 분에게만 전달해 주세요.
              </Sub>
            </div>
          )}
        </div>
      )}
      {mode === "take" && (
        <div className="mt-3 space-y-3">
          <Field label="인계 번호" hint="예) ABCD-2345">
            <div className="flex gap-1.5">
              <input value={code} onChange={(e) => setCode(fmtCode(e.target.value))} placeholder="ABCD-2345" className={inputCls} style={{ letterSpacing: "0.12em" }} />
              <button onClick={take} disabled={busy || normCode(code).length < 8} className="shrink-0 rounded-2xl px-4 text-sm font-extrabold text-white disabled:opacity-50" style={{ backgroundColor: BRAND }}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : "받기"}
              </button>
            </div>
          </Field>
          <Field label="또는 인계 코드 붙여넣기" hint="다른 기기에서 받을 때">
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder='{"app":"pilateacher", ...' className={inputCls} style={{ resize: "none" }} />
          </Field>
          <Field label="또는 백업 파일 열기" hint=".json 파일">
            <input type="file" accept=".json,application/json" className={inputCls}
              onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importFile(f); }} />
          </Field>
          <button onClick={readPaste} disabled={!paste.trim()} className="w-full rounded-2xl py-3 text-sm font-bold disabled:opacity-50" style={{ backgroundColor: CANVAS, color: INK }}>붙여넣은 코드 확인</button>
          {err && <p className="rounded-2xl px-3 py-2.5 text-xs font-bold" style={{ backgroundColor: BAD_S, color: BAD }}>{err}</p>}
          {inc && (
            <div className="rounded-2xl p-4" style={{ backgroundColor: CANVAS }}>
              <p className="text-sm font-extrabold" style={{ color: INK }}>{inc.from || "이름 미기재"} 강사님이 보낸 자료</p>
              <Sub className="mt-1">
                {inc.center ? `${inc.center} · ` : ""}회원 {(inc.members || []).length}명 · 수업 {(inc.schedule || []).length}건
                {inc.photos && Object.keys(inc.photos).length ? " · 사진 포함" : ""}
                {inc.at ? ` · ${ymd(String(inc.at).slice(0, 10))} 생성` : ""}
              </Sub>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button onClick={() => apply("merge")} className="flex-1 rounded-2xl py-3 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>내 회원에 합치기</button>
                <button onClick={() => setConfirmAll(true)} className="flex-1 rounded-2xl py-3 text-xs font-bold" style={{ backgroundColor: CARD, color: BAD }}>전부 덮어쓰기</button>
              </div>
              {confirmAll && (
                <div className="mt-2 rounded-2xl p-3" style={{ backgroundColor: BAD_S }}>
                  <p className="text-xs font-bold" style={{ color: INK }}>지금 이 기기의 회원 {(db.members || []).length}명이 지워지고 받은 자료로 바뀝니다.</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => apply("replace")} className="rounded-xl px-4 py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>덮어쓰기</button>
                    <button onClick={() => setConfirmAll(false)} className="rounded-xl bg-white px-4 py-2 text-xs font-bold" style={{ color: SUB }}>취소</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
function SettingsTab({ db, photos, account, savedAt, demoMode, onChangeSettings, onChangePhoto, onReset, onClear, onLogout, onToast, themePref, onChangeTheme, onImport }) {
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const camRef = useRef(null), albumRef = useRef(null);
  const pickPhoto = async (file) => {
    if (!file) return;
    setBusy(true);
    try { onChangePhoto(await fileToThumb(file, 320)); }
    catch (e) { onToast?.({ ok: false, msg: "사진을 불러오지 못했습니다." }); }
    setBusy(false);
  };
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: TINT }}><Users size={15} style={{ color: PRIMARY }} /></span>
          <div><h3 className="font-extrabold" style={{ color: INK }}>내 계정</h3><Sub>프로필과 로그인 정보를 관리합니다</Sub></div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => albumRef.current?.click()} className="relative shrink-0" aria-label="프로필 사진 변경">
            <Avatar src={account?.photo} name={account?.name} size={52} radius={16} />
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white" style={{ background: GRAD }}>
              {busy ? <Loader2 size={11} color="#fff" className="animate-spin" /> : <Camera size={11} color="#fff" />}
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold" style={{ color: INK }}>{account?.name}</p>
            <Sub className="truncate">{account?.email || "이메일 미등록"}</Sub>
          </div>
          <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: SAND, color: INK2 }}>{PROVIDER_LABEL[account?.provider]}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button onClick={() => albumRef.current?.click()} className="flex h-9 items-center rounded-xl px-3 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>
            사진 {account?.photo ? "변경" : "등록"}
          </button>
          <button onClick={() => camRef.current?.click()} className="flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
            <Camera size={12} /> 촬영
          </button>
          {account?.photo && (
            <button onClick={() => onChangePhoto(null)} className="flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
              <Trash2 size={12} /> 사진 삭제
            </button>
          )}
          <span className="w-full"><Sub>회원 앱·상담 화면에 함께 보이는 사진입니다. 얼굴이 잘 보이는 정사각 사진을 권합니다.</Sub></span>
        </div>
        <input ref={albumRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickPhoto(f); }} />
        <input ref={camRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickPhoto(f); }} />
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-xl p-2.5" style={{ backgroundColor: SAND }}><Sub>센터</Sub><p className="truncate text-sm font-extrabold" style={{ color: INK }}>{account?.center || "-"}</p></div>
          <div className="rounded-xl p-2.5" style={{ backgroundColor: SAND }}><Sub>연락처</Sub><p className="truncate text-sm font-extrabold" style={{ color: INK }}>{account?.phone || "-"}</p></div>
          <div className="rounded-xl p-2.5" style={{ backgroundColor: SAND }}><Sub>가입일</Sub><p className="text-sm font-extrabold tabular-nums" style={{ color: INK }}>{ymd(account?.joinedAt)}</p></div>
          <div className="rounded-xl p-2.5" style={{ backgroundColor: SAND }}><Sub>관리 회원</Sub><p className="text-sm font-extrabold tabular-nums" style={{ color: INK }}>{db.members.length}명</p></div>
        </div>
        <button onClick={onLogout} className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
          <LogOut size={14} /> 로그아웃
        </button>
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: TINT }}><Sun size={15} style={{ color: PRIMARY }} /></span>
          <div><h3 className="font-extrabold" style={{ color: INK }}>화면 테마</h3><Sub>기기 설정 또는 원하는 화면을 선택합니다</Sub></div>
        </div>
        <div className="mt-3 flex gap-1 rounded-xl p-1" style={{ backgroundColor: CANVAS }}>
          {[{ k: "system", l: "폰 설정", i: Smartphone }, { k: "light", l: "라이트", i: Sun }, { k: "dark", l: "다크", i: Moon }].map((o) => {
            const on = themePref === o.k, Icon = o.i;
            return (
              <button key={o.k} onClick={() => onChangeTheme(o.k)} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-bold"
                style={on ? { backgroundColor: PRIMARY, color: "#fff" } : { color: SUB }}>
                <Icon size={14} /> {o.l}
              </button>
            );
          })}
        </div>
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: TINT }}><SettingsIcon size={15} style={{ color: PRIMARY }} /></span>
          <div><h3 className="font-extrabold" style={{ color: INK }}>센터 정보</h3><Sub>일정과 회원 관리에 사용할 기본값입니다</Sub></div>
        </div>
        <div className="mt-3 space-y-3">
          <Field label="센터명"><input value={db.settings.center} onChange={(e) => onChangeSettings({ ...db.settings, center: e.target.value })} className={inputCls} /></Field>
          <div className="rounded-xl p-3" style={{ backgroundColor: CANVAS }}>
            <p className="text-xs font-extrabold" style={{ color: INK }}>내 수업료 기본값</p>
            <Sub className="mb-2 block">회원마다 다르면 그 회원 정보에서 따로 넣으세요 · 비워 두면 이 값을 씁니다</Sub>
            <div className="grid grid-cols-2 gap-2">
              <Field label="개인 1회당 원">
                <input inputMode="numeric" value={db.settings.payRate ?? DEF_RATE} placeholder={String(DEF_RATE)}
                  onChange={(e) => onChangeSettings({ ...db.settings, payRate: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })} className={inputCls} />
              </Field>
              <Field label="그룹 1회당 원">
                <input inputMode="numeric" value={db.settings.groupRate ?? DEF_GROUP_RATE} placeholder={String(DEF_GROUP_RATE)}
                  onChange={(e) => onChangeSettings({ ...db.settings, groupRate: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })} className={inputCls} />
              </Field>
            </div>
          </div>
          <Field label="기본 담당자" hint="수업 등록 시 자동 입력"><input value={db.settings.staff} onChange={(e) => onChangeSettings({ ...db.settings, staff: e.target.value })} className={inputCls} /></Field>
        </div>
      </Card>
      <HandoffCard db={db} photos={photos} account={account} onImport={onImport} onToast={onToast} />
      <Card className="p-4">
        <h3 className="font-extrabold" style={{ color: INK }}>데이터</h3>
        <Sub className="mt-2">계정별로 기기에 저장됩니다. 아래 표시는 확인 가능한 로컬 상태이며 클라우드 동기화 완료를 의미하지 않습니다.</Sub>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl p-2.5" style={{ backgroundColor: CANVAS }}>
            <Sub>기기 저장</Sub>
            <p className="text-xs font-extrabold" style={{ color: savedAt instanceof Date ? GOOD : SUB }}>{savedAt instanceof Date ? "저장됨" : "변경 없음"}</p>
            {savedAt instanceof Date && <p className="text-xs tabular-nums" style={{ color: SUB }}>{savedAt.getHours()}:{String(savedAt.getMinutes()).padStart(2, "0")}</p>}
          </div>
          <div className="rounded-xl p-2.5" style={{ backgroundColor: CANVAS }}>
            <Sub>로그인</Sub>
            <p className="text-xs font-extrabold" style={{ color: account ? GOOD : WARN }}>{account ? "로그인됨" : "로그인 안 됨"}</p>
          </div>
          <div className="rounded-xl p-2.5" style={{ backgroundColor: CANVAS }}>
            <Sub>Firebase</Sub>
            <p className="text-xs font-extrabold" style={{ color: fbReady ? GOOD : SUB }}>{fbReady ? "사용 가능" : "사용 안 함"}</p>
          </div>
        </div>
        {demoMode && (
          <div className="mt-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: WARN_S, border: `1px solid ${WARN}` }}>
            <p className="text-xs font-extrabold" style={{ color: WARN }}>개발·데모 데이터 사용 중</p>
            <p className="mt-0.5 text-xs" style={{ color: INK2 }}>Firebase를 사용하지 않는 환경에서 생성된 예시 회원과 일정입니다. 실제 운영 데이터가 아닙니다.</p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setConfirm("clear")} className="flex h-10 items-center rounded-xl px-4 text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>모든 회원 초기화</button>
          {!fbReady && (
            <button onClick={() => setConfirm("reset")} className="flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
              <RotateCcw size={14} /> 데모 데이터로 되돌리기
            </button>
          )}
        </div>
        {confirm && (
          <div className="mt-3 rounded-2xl p-4" style={{ backgroundColor: BAD_S }}>
            <p className="text-sm font-bold" style={{ color: BAD }}>{confirm === "clear" ? "이 계정의 회원 · 스케줄이 모두 지워집니다." : "회원 데이터를 처음 상태로 되돌립니다. 입력한 내용은 사라집니다."}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => { confirm === "clear" ? onClear() : onReset(); setConfirm(null); }} className="rounded-xl px-4 py-2 text-sm font-extrabold text-white" style={{ backgroundColor: BAD }}>진행</button>
              <button onClick={() => setConfirm(null)} className="rounded-xl bg-white px-4 py-2 text-sm font-bold" style={{ color: SUB }}>취소</button>
            </div>
          </div>
        )}
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: CANVAS }}><Smartphone size={14} style={{ color: SUB }} /></span>
          <h3 className="font-extrabold" style={{ color: INK }}>개인정보 안내</h3>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed" style={{ color: INK2 }}>
          {fbReady
            ? <>회원 <b style={{ color: INK }}>사진은 이 기기 안에만</b> 저장되며 외부로 전송하지 않습니다. 회원 이름 · 수업 · 기록은 기기 교체와 분실에 대비해 <b style={{ color: INK }}>본인 계정으로 암호화 보관</b>됩니다.</>
            : <>회원 정보 · 사진 · 기록은 <b style={{ color: INK }}>이 기기 안에만</b> 저장됩니다. 외부 서버로 전송하거나 보관하지 않습니다.</>}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: INK2 }}>
          {fbReady
            ? <>같은 계정으로 새 기기에서 로그인하면 회원 기록이 자동으로 돌아옵니다. 다만 <b style={{ color: INK }}>사진은 돌아오지 않습니다.</b> 사진까지 지키려면 아래 백업 파일을 받아 두세요.</>
            : <>그래서 기기를 잃어버리거나 앱을 지우면 <b style={{ color: INK }}>되살릴 수 없습니다.</b> 위 '회원 인계 · DB 넘기기'에서 정기적으로 백업해 두세요.</>}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: INK2 }}>
          회원 사진은 회원 동의를 받은 뒤 촬영해 주세요. 회원이 삭제를 요청하면 이 앱에서 그 회원을 삭제하는 것으로 사진까지 함께 지워집니다.
        </p>
        {inApp() && !(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) && (
          <div className="mt-3 rounded-2xl p-3" style={{ backgroundColor: WARN_S }}>
            <p className="text-xs font-extrabold" style={{ color: WARN }}>사진 저장 · 공유가 막혀 있습니다</p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: INK2 }}>
              앱에 공유 기능이 아직 안 들어가 있어 버튼으로 저장되지 않습니다.
              지금은 <b style={{ color: INK }}>미리보기 사진을 길게 눌러</b> 저장하거나, 브라우저(pilateacher.com)에서 저장해 주세요.
              다음 업데이트에 포함하면 버튼 한 번으로 됩니다.
            </p>
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: CANVAS }}>
          <span className="text-xs font-bold" style={{ color: SUB }}>앱 버전</span>
          <span className="ml-auto text-xs font-extrabold tabular-nums" style={{ color: PRIMARY }}>{APP_BUILD_LABEL}</span>
        </div>
      </Card>
    </div>
  );
}
function ReferenceSettingsTab({ db, account, savedAt, onChangeSettings, onChangePhoto, onLogout, onToast, themePref, onChangeTheme }) {
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef(null), albumRef = useRef(null);
  const pickPhoto = async (file) => {
    if (!file) return;
    setBusy(true);
    try { onChangePhoto(await fileToThumb(file, 320)); }
    catch (e) { onToast?.({ ok: false, msg: "사진을 불러오지 못했습니다." }); }
    finally { setBusy(false); }
  };
  const sectionStyle = { backgroundColor: CARD, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px" };
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ backgroundColor: PAGE }}>
      <header className="flex shrink-0 items-center" style={{ height: 52, padding: "0 14px", backgroundColor: CARD, borderBottom: `1px solid ${LINE}` }}><h1 style={{ fontSize: 18, fontWeight: 600, color: INK }}>설정</h1></header>
      <main className="pt-scroll min-h-0 flex-1 overflow-y-auto" style={{ padding: "10px 12px 18px" }}>
        <div className="space-y-2">
          <section style={sectionStyle}>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => albumRef.current?.click()} className="relative shrink-0" aria-label="프로필 사진 변경"><Avatar src={account?.photo} name={account?.name} size={48} radius={12} /><span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: BRAND, color: "#fff" }}>{busy ? <Loader2 size={10} className="animate-spin" /> : <Camera size={10} />}</span></button>
              <div className="min-w-0 flex-1"><h2 className="truncate" style={{ fontSize: 15, fontWeight: 600, color: INK }}>{account?.name || "계정"}</h2><p className="mt-0.5 truncate" style={{ fontSize: 11, color: SUB }}>{account?.email || "이메일 미등록"}</p><p className="mt-0.5 truncate" style={{ fontSize: 11, color: SUB }}>{PROVIDER_LABEL[account?.provider] || "로그인"} 계정</p></div>
              <button type="button" onClick={onLogout} className="flex items-center gap-1" style={{ height: 36, padding: "0 10px", borderRadius: 8, backgroundColor: CANVAS, color: SUB, fontSize: 12, fontWeight: 600 }}><LogOut size={13} />로그아웃</button>
            </div>
            <div className="mt-3 flex gap-1.5"><button type="button" onClick={() => albumRef.current?.click()} style={{ height: 34, padding: "0 10px", borderRadius: 8, backgroundColor: TINT, color: BRAND, fontSize: 12, fontWeight: 600 }}>사진 {account?.photo ? "변경" : "등록"}</button><button type="button" onClick={() => cameraRef.current?.click()} style={{ height: 34, padding: "0 10px", borderRadius: 8, backgroundColor: CANVAS, color: SUB, fontSize: 12, fontWeight: 600 }}>촬영</button>{account?.photo && <button type="button" onClick={() => onChangePhoto(null)} style={{ height: 34, padding: "0 10px", borderRadius: 8, color: SUB, fontSize: 12 }}>삭제</button>}</div>
            <input ref={albumRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickPhoto(f); }} /><input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickPhoto(f); }} />
          </section>
          <section style={sectionStyle}>
            <div className="mb-3"><h2 style={{ fontSize: 14, fontWeight: 600, color: INK }}>화면 테마</h2><p style={{ marginTop: 2, fontSize: 11, color: SUB }}>기기 설정 또는 원하는 화면을 선택합니다</p></div>
            <div className="grid grid-cols-3 gap-1" style={{ padding: 3, borderRadius: 10, backgroundColor: CANVAS }}>{[{k:"system",l:"폰 설정",I:Smartphone},{k:"light",l:"라이트",I:Sun},{k:"dark",l:"다크",I:Moon}].map(({k,l,I}) => <button type="button" key={k} onClick={() => onChangeTheme(k)} className="flex items-center justify-center gap-1" style={{ height: 38, borderRadius: 8, backgroundColor: themePref === k ? CARD : "transparent", boxShadow: themePref === k ? "0 1px 3px rgba(28,36,51,.08)" : "none", color: themePref === k ? BRAND : SUB, fontSize: 12, fontWeight: themePref === k ? 600 : 500 }}><I size={13} />{l}</button>)}</div>
          </section>
          <section style={sectionStyle}>
            <div className="mb-3"><h2 style={{ fontSize: 14, fontWeight: 600, color: INK }}>센터 정보</h2><p style={{ marginTop: 2, fontSize: 11, color: SUB }}>일정과 회원 관리에 사용할 실제 기본값입니다</p></div>
            <div className="space-y-3"><Field label="센터명"><input value={db.settings.center} onChange={(e) => onChangeSettings({ ...db.settings, center: e.target.value })} className={inputCls} /></Field><Field label="기본 담당자"><input value={db.settings.staff} onChange={(e) => onChangeSettings({ ...db.settings, staff: e.target.value })} className={inputCls} /></Field><div className="grid grid-cols-2 gap-2"><Field label="개인 1회당 원"><input inputMode="numeric" value={db.settings.payRate ?? DEF_RATE} onChange={(e) => onChangeSettings({ ...db.settings, payRate: num(e.target.value.replace(/\D/g, "")) })} className={inputCls} /></Field><Field label="그룹 1회당 원"><input inputMode="numeric" value={db.settings.groupRate ?? DEF_GROUP_RATE} onChange={(e) => onChangeSettings({ ...db.settings, groupRate: num(e.target.value.replace(/\D/g, "")) })} className={inputCls} /></Field></div></div>
          </section>
          <section style={sectionStyle}>
            <div className="mb-3"><h2 style={{ fontSize: 14, fontWeight: 600, color: INK }}>데이터 상태</h2><p style={{ marginTop: 2, fontSize: 11, color: SUB }}>확인 가능한 실제 연결 상태만 표시합니다</p></div>
            <div className="grid grid-cols-3 gap-2">{[
              { l: "기기 저장", v: savedAt instanceof Date ? "저장됨" : "변경 없음", c: savedAt instanceof Date ? GOOD : SUB },
              { l: "로그인", v: account ? "로그인됨" : "로그인 안 됨", c: account ? GOOD : WARN },
              { l: "Firebase", v: fbReady ? "연결 가능" : "미사용", c: fbReady ? GOOD : SUB },
            ].map((x) => <div key={x.l} style={{ padding: "9px 8px", borderRadius: 8, backgroundColor: CANVAS }}><p style={{ fontSize: 10, color: SUB }}>{x.l}</p><p className="mt-1 truncate" style={{ fontSize: 11, fontWeight: 600, color: x.c }}>{x.v}</p></div>)}</div>
            <div className="mt-3 flex items-center" style={{ paddingTop: 10, borderTop: `1px solid ${LINE}` }}><span style={{ fontSize: 11, color: SUB }}>앱 버전</span><span className="ml-auto tabular-nums" style={{ fontSize: 11, fontWeight: 600, color: BRAND }}>{APP_BUILD_LABEL}</span></div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState("splash");
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState(null);
  const [db, setDb] = useState(emptyDb("", ""));
  const [photos, setPhotos] = useState({});
  const [tab, setTab] = useState("schedule");
  const [section, setSection] = useState("inbody");
  const [selectedId, setSelectedId] = useState(null);
  const [analysisMemberId, setAnalysisMemberId] = useState(null);
  const [analysisRecordId, setAnalysisRecordId] = useState(null);
  const [scheduleMemberId, setScheduleMemberId] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [mobileView, setMobileView] = useState("list");
  const briefing = false;
  const [savedAt, setSavedAt] = useState(null);
  const [toast, setToast] = useState(null);
  const [brief, setBrief] = useState(null);
  const [favOpen, setFavOpen] = useState(false);
  const [themePref, setThemePref] = useState("system");
  const [sysDark, setSysDark] = useState(sysDarkNow());
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch (e) { return; }
    if (!mq) return;
    const on = () => setSysDark(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  const themeMode = themePref === "dark" || (themePref === "system" && sysDark) ? "dark" : "light";
  applyTheme(themeMode);
  useEffect(() => { paintThemeVars(themeMode); }, [themeMode]);
  const changeTheme = (pref) => {
    setThemePref(pref);
    try { const p = window.storage.set(THEME_KEY, pref); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  };

  /* 키보드가 올라오면 입력칸이 가려진다 — 초점이 간 칸을 화면 가운데로 올려 준다 */
  useEffect(() => {
    const onFocusIn = (e) => {
      const el = e.target;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || "")) return;
      if (el.type === "range" || el.type === "file" || el.type === "checkbox") return;
      setTimeout(() => { try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (err) {} }, 320);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    let alive = true;
    let cleanup = null;
    (async () => {
      let accs = [];
      try { const r = await window.storage.get(ACC_KEY); if (r?.value) accs = JSON.parse(r.value); } catch (e) {}
      accs = Array.isArray(accs) ? accs.filter((a) => a && typeof a === "object").map((a) => ({ ...a, id: a.id || uid() })) : [];
      let ses = null;
      try { const r = await window.storage.get(SES_KEY); if (r?.value) ses = JSON.parse(r.value); } catch (e) {}
      try { const r = await window.storage.get(THEME_KEY); if (r?.value && alive) setThemePref(r.value); } catch (e) {}
      if (!alive) return;
      setAccounts(accs);
      if (fbReady) {
        let first = true;
        const off = fbOnAuth(async (u) => {
          if (!alive) return;
          if (!u) { if (first) { first = false; setTimeout(() => alive && setPhase("auth"), 1400); } else { setPhase("auth"); } return; }
          const prof = await fbLoadProfile(u.id);
          const acc = { ...u, ...(prof || {}), id: u.id };
          if (!alive) return;
          if (!acc.center) { if (first) { first = false; setTimeout(() => alive && setPhase("auth"), 1400); } else setPhase("auth"); return; }
          await loadAccount(acc);
          if (!alive) return;
          const wait = first ? 1400 : 0;
          first = false;
          setTimeout(() => alive && setPhase("app"), wait);
        });
        cleanup = off;
        return;
      }
      const auto = ses?.auto && accs.find((a) => a.id === ses.accountId);
      setTimeout(async () => {
        if (!alive) return;
        if (auto) { await loadAccount(auto); setPhase("app"); }
        else setPhase("auth");
      }, 1400);
    })();
    return () => { alive = false; if (cleanup) { try { cleanup(); } catch (e) {} } };
  }, []);

  const loadAccount = async (acc) => {
    revokeAllUrls();
    setAccount(acc);
    let data = null, ph = {}, restored = false;
    try { const r = await window.storage.get(dbKey(acc.id)); if (r?.value) data = JSON.parse(r.value); } catch (e) {}
    try { const r = await window.storage.get(phKey(acc.id)); if (r?.value) ph = JSON.parse(r.value); } catch (e) {}
    if (fbReady && (!data || !(Array.isArray(data.members) && data.members.length))) {
      try {
        const cloud = await fbPullBackup(acc.id);
        if (cloud && cloud.data && Array.isArray(cloud.data.members) && cloud.data.members.length) {
          data = cloud.data;
          restored = true;
          try { await window.storage.set(dbKey(acc.id), JSON.stringify(data)); } catch (e) {}
        }
      } catch (e) {}
    }
    const useDemo = !data && !fbReady;
    if (!data) data = fbReady ? emptyDb(acc.center, acc.name) : sampleDb(acc.center, acc.name);
    data = normalizeDb(data, acc.name);
    if (!data.settings.center) data.settings.center = acc.center || "";
    setDb(data);
    setDemoMode(useDemo);
    let hyd = ph && typeof ph === "object" ? ph : {};
    try {
      const a = await adoptPhotos(hyd);
      hyd = a.map;
      if (a.changed) { try { await window.storage.set(phKey(acc.id), JSON.stringify(stripSrc(hyd))); } catch (e) {} }
    } catch (e) {}
    setPhotos(hyd);
    setSelectedId(data.members[0]?.id || null);
    setAnalysisMemberId(null);
    setTab("schedule");
    if (restored) setToast({ ok: true, msg: `\ud074\ub77c\uc6b0\ub4dc\uc5d0\uc11c \ud68c\uc6d0 ${data.members.length}\uba85\uc744 \ubcf5\uad6c\ud588\uc2b5\ub2c8\ub2e4. \uc0ac\uc9c4\uc740 \uc774\uc804 \uae30\uae30\uc5d0\ub9cc \uc788\uc2b5\ub2c8\ub2e4.` });
  };

  const persistAccounts = async (list) => {
    setAccounts(list);
    try { await window.storage.set(ACC_KEY, JSON.stringify(list)); } catch (e) {}
  };
  const persistSession = async (accId, auto) => {
    try { await window.storage.set(SES_KEY, JSON.stringify({ accountId: accId, auto })); } catch (e) {}
  };
  const handleLogin = async (acc, auto) => {
    if (!fbReady) await persistSession(acc.id, auto);
    await loadAccount(acc);
    setPhase("app");
    setToast({ ok: true, msg: `${acc.name} 강사님, 환영합니다.` });
  };
  const handleSignup = async (info, auto) => {
    const acc = info.fb ? { joinedAt: todayISO(), ...info } : { id: uid(), joinedAt: todayISO(), ...info };
    if (acc.fb) delete acc.fb;
    if (acc.pw) delete acc.pw;
    if (fbReady) {
      try { await fbSaveProfile(acc.id, { name: acc.name, center: acc.center, phone: acc.phone || "", email: acc.email || "", photo: acc.photo || "", provider: acc.provider, joinedAt: acc.joinedAt }); } catch (e) {}
    } else {
      await persistAccounts([...accounts, acc]);
      await persistSession(acc.id, auto);
    }
    await loadAccount(acc);
    setPhase("app");
    setToast({ ok: true, msg: "가입이 완료됐습니다. 설정 탭에서 내 정보를 볼 수 있어요." });
  };
  const changePhoto = async (src) => {
    if (!account) return;
    const next = { ...account, photo: src || undefined };
    setAccount(next);
    if (fbReady) { try { await fbSaveProfile(next.id, { photo: src || "" }); } catch (e) {} }
    else await persistAccounts(accounts.map((a) => (a.id === next.id ? next : a)));
    setToast({ ok: true, msg: src ? "프로필 사진을 저장했습니다." : "프로필 사진을 삭제했습니다." });
  };
  const handleLogout = async () => {
    if (fbReady) { try { await fbSignOut(); } catch (e) {} }
    try { await window.storage.set(SES_KEY, JSON.stringify({ accountId: null, auto: false })); } catch (e) {}
    revokeAllUrls();
    setAccount(null); setPhase("auth"); setDb(emptyDb("", "")); setPhotos({});
  };

  const cloudTimer = useRef(null);
  const cloudPending = useRef(null);
  const queueCloud = useCallback((uidStr, data) => {
    if (!fbReady || !uidStr) return;
    cloudPending.current = { uid: uidStr, data };
    if (cloudTimer.current) clearTimeout(cloudTimer.current);
    cloudTimer.current = setTimeout(async () => {
      const p = cloudPending.current;
      cloudPending.current = null; cloudTimer.current = null;
      if (!p) return;
      try { await fbPushBackup(p.uid, p.data); } catch (e) {}
    }, 3000);
  }, []);
  useEffect(() => () => { if (cloudTimer.current) clearTimeout(cloudTimer.current); }, []);

  const saveDb = useCallback(async (next, dualWrite) => {
    const prev = db;
    setDb(next);
    if (!account) return;
    try {
      const legacyWrite = async () => {
        await window.storage.set(dbKey(account.id), JSON.stringify(next));
        setSavedAt(new Date());
        queueCloud(account.id, next);
      };
      if (dualWrite) await runAppDualWrite(account, dualWrite, legacyWrite);
      else await legacyWrite();
      return true;
    }
    catch (e) { setDb(prev); setToast({ ok: false, msg: "저장하지 못했습니다. 방금 입력한 내용을 다시 확인해 주세요." }); }
  }, [account, db, queueCloud]);
  const savePhotos = useCallback(async (next) => {
    const prev = photos;
    setPhotos(next);
    if (!account) return;
    try { await window.storage.set(phKey(account.id), JSON.stringify(stripSrc(next))); setSavedAt(new Date()); }
    catch (e) { setPhotos(prev); setToast({ ok: false, msg: "저장 공간이 가득 찼습니다. 오래된 사진을 지운 뒤 다시 찍어 주세요." }); }
  }, [account, photos]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const patch = (id, p, duet) => {
    let members = db.members.map((m) => (m.id === id ? { ...m, ...p } : m));
    if (duet) {
      const { duetPrev, duetNext } = duet;
      /* 짝을 바꾸면 옛 짝의 연결을 끊고 새 짝에 나를 걸어 준다 */
      if (duetPrev && duetPrev !== duetNext) members = members.map((m) => (m.id === duetPrev ? { ...m, duetWith: "" } : m));
      if (duetNext) members = members.map((m) => {
        if (m.id === duetNext) return { ...m, duetWith: id };
        if (m.id !== id && m.duetWith === duetNext) return { ...m, duetWith: "" };
        return m;
      });
    }
    const changed = members.find((m) => m.id === id);
    saveDb({ ...db, members }, changed && {
      entityType: "client", entityId: id, operation: "update", payload: changed,
    });
  };
  const member = db.members.find((m) => m.id === selectedId) || db.members[0];
  const alerts = useMemo(() => detectAlerts(db.members, db.schedule), [db.members, db.schedule]);
  const spent = useMemo(() => spentMembers(db.members, db.schedule), [db.members, db.schedule]);
  const goTab = (k) => { if (k === "members") setMobileView("list"); setTab(k); };
  const [detailTab, setDetailTab] = useState("summary");   /* 회원 상세 안: 요약 / 기록 입력 */
  const [analysisDone, setAnalysisDone] = useState(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const goRecord = (sec) => { setNoteBack(false); setSection(sec); setDetailTab("record"); setTab("members"); setMobileView("detail"); };
  /* 일정 탭에서 '기록하기'로 들어왔으면 저장 후 다시 일정으로 돌려보낸다 */
  const [noteBack, setNoteBack] = useState(false);
  const [noteSid, setNoteSid] = useState(null);
  const saveScheduleComment = (id, type, sid, body) => {
    const text = String(body || "").trim();
    if (!text) return;
    setNoteBack(false);
    const target = db.members.find((m) => m.id === id);
    if (!target) { setToast({ ok: false, msg: "회원을 찾을 수 없습니다." }); return; }
    const note = { id: uid(), date: todayISO(), sid: sid || undefined, type: type || "개인레슨", instructor: target.instructor, body: text, tags: [], deductFrom: null };
    saveDb({ ...db, members: db.members.map((m) => (m.id === id ? { ...m, notes: [note, ...(m.notes || [])] } : m)) });
    setToast({ ok: true, msg: text === "특이사항 없음" ? "특이사항 없음으로 기록했습니다." : `${target.name || "회원"} 기록을 저장했습니다.` });
  };
  const noComment = (id, type, sid) => saveScheduleComment(id, type, sid, "특이사항 없음");

  const saveSchedule = (item) => {
    const prev = db.schedule.find((s) => s.id === item.id);
    let members = db.members;
    if (prev) {
      const keep = new Set(attendeesOf(item).map((a) => a.memberId));
      attendeesOf(prev).forEach((a) => { if (a.deductFrom && !keep.has(a.memberId)) members = restoreOne(members, a.memberId, a.deductFrom); });
    }
    saveDb(
      { ...db, members, schedule: prev ? db.schedule.map((s) => (s.id === item.id ? item : s)) : [...db.schedule, item] },
      {
        entityType: "lesson", entityId: item.id, operation: prev ? "update" : "create",
        payload: { ...item, participantCount: attendeesOf(item).length },
      },
    );
    setToast({ ok: true, msg: item.personal
      ? (prev ? "일정을 수정했습니다." : "일정을 등록했습니다.")
      : prev ? "수업을 수정했습니다." : "수업을 등록했습니다." });
  };
  const deleteSchedule = (id) => {
    const s0 = db.schedule.find((x) => x.id === id);
    let members = db.members;
    if (s0) attendeesOf(s0).forEach((a) => { if (a.deductFrom) members = restoreOne(members, a.memberId, a.deductFrom); });
    saveDb(
      { ...db, members, schedule: db.schedule.filter((x) => x.id !== id) },
      s0 && {
        entityType: "lesson", entityId: id, operation: "update",
        payload: { ...s0, status: "cancel", participantCount: attendeesOf(s0).length },
      },
    );
    setToast({ ok: true, msg: "수업을 삭제했습니다." });
  };
  const setStatus = (id, status, memberId) => {
    const s0 = db.schedule.find((x) => x.id === id);
    if (!s0) return;
    const list = attendeesOf(s0);
    if (!list.length) return;
    const mid = memberId || list[0].memberId;
    const cur = list.find((a) => a.memberId === mid);
    if (!cur) return;
    let members = db.members, msg = "";
    if (cur.deductFrom) { members = restoreOne(members, mid, cur.deductFrom); msg = `${cur.deductFrom} 1회 복구`; }
    let deductFrom = null;
    if (status === "done") {
      const r = deductOne(members, mid);
      members = r.members; deductFrom = r.from;
      if (deductFrom) {
        const rest = left(members.find((x) => x.id === mid));
        msg = `${db.members.find((x) => x.id === mid)?.name || ""} 출석 · ${deductFrom} 1회 차감 (잔여 ${rest}회)`;
        if (rest <= 10) msg += " · 재등록 알림 대상";
      } else { setToast({ ok: false, msg: "잔여 0회 — 수강권을 먼저 등록해 주세요. 출석만 기록됩니다." }); msg = "출석 기록(차감 없음)"; }
    }
    const attendees = list.map((a) => (a.memberId === mid ? { ...a, status, deductFrom, noshowFee: null } : a));
    const schedule = db.schedule.map((x) => (x.id === id ? { ...x, attendees, status: undefined, deductFrom: undefined, noshowFee: undefined } : x));
    const attendanceStatus = { booked: "booked", done: "attended", noshow: "noshow", cancel: "cancelled" }[status] || "booked";
    saveDb({ ...db, members, schedule }, {
      entityType: "lesson", entityId: id, operation: "save_attendance",
      attendance: [{ clientId: mid, status: attendanceStatus }],
    });
    setToast({ ok: true, msg: msg || `${stOf(status).label} 처리했습니다.` });
  };
  /* 듀엣처럼 여러 명인 수업을 한 번에 처리 — 따로 두 번 호출하면 뒤엣것이 앞엣것을 덮는다 */
  const setStatusAll = (id, status) => {
    const s0 = db.schedule.find((x) => x.id === id);
    if (!s0) return;
    const list = attendeesOf(s0);
    if (!list.length) return;
    let members = db.members;
    const zero = [];
    const attendees = list.map((a) => {
      if (a.deductFrom) members = restoreOne(members, a.memberId, a.deductFrom);
      let deductFrom = null;
      if (status === "done") {
        const r = deductOne(members, a.memberId);
        members = r.members; deductFrom = r.from;
        if (!deductFrom) zero.push(db.members.find((x) => x.id === a.memberId)?.name || "회원");
      }
      return { ...a, status, deductFrom, noshowFee: null };
    });
    const attendanceStatus = { booked: "booked", done: "attended", noshow: "noshow", cancel: "cancelled" }[status] || "booked";
    saveDb(
      { ...db, members, schedule: db.schedule.map((x) => (x.id === id ? { ...x, attendees, status: undefined, deductFrom: undefined, noshowFee: undefined } : x)) },
      {
        entityType: "lesson", entityId: id, operation: "save_attendance",
        attendance: attendees.map((a) => ({ clientId: a.memberId, status: attendanceStatus })),
      },
    );
    setToast(zero.length
      ? { ok: false, msg: `${zero.join(", ")} 잔여 0 — 차감 없이 기록했습니다.` }
      : { ok: true, msg: `${list.length}명 ${stOf(status).label} 처리했습니다.` });
  };
  const setNoshowFee = (id, charge, memberId) => {
    const s0 = db.schedule.find((x) => x.id === id);
    if (!s0) return;
    const list = attendeesOf(s0);
    if (!list.length) return;
    const mid = memberId || list[0].memberId;
    const cur = list.find((a) => a.memberId === mid);
    if (!cur) return;
    let members = db.members, deductFrom = cur.deductFrom || null, msg = "";
    if (charge && !deductFrom) {
      const r = deductOne(members, mid);
      members = r.members; deductFrom = r.from;
      msg = deductFrom ? `노쇼 · ${deductFrom} 1회 차감 (잔여 ${left(members.find((x) => x.id === mid))}회)` : "잔여 횟수가 없어 차감하지 않았습니다.";
    } else if (!charge && deductFrom) {
      members = restoreOne(members, mid, deductFrom);
      msg = `${deductFrom} 1회 복구 · 차감 없이 기록합니다.`;
      deductFrom = null;
    } else msg = charge ? "이미 차감된 노쇼입니다." : "차감 없이 기록합니다.";
    const attendees = list.map((a) => (a.memberId === mid ? { ...a, noshowFee: charge, deductFrom } : a));
    saveDb({ ...db, members, schedule: db.schedule.map((x) => (x.id === id ? { ...x, attendees } : x)) });
    setToast({ ok: true, msg });
  };
  const setGroupDone = (id, nextState) => {
    const cancelled = nextState === "cancelled";
    const done = nextState === true || nextState === "completed";
    saveDb(
      { ...db, schedule: db.schedule.map((s) => (s.id === id ? { ...s, groupDone: done, groupCancelled: cancelled } : s)) },
      { entityType: "lesson", entityId: id, operation: "change_status", status: cancelled ? "cancelled" : done ? "completed" : "scheduled" },
    );
    setToast({ ok: true, msg: cancelled ? "그룹 수업을 취소 처리했습니다." : done ? "그룹 수업을 완료 처리했습니다. 이달 누적에 반영됩니다." : "그룹 수업을 예정 상태로 되돌렸습니다." });
  };
  const addMember = (initial = {}) => {
    const m = { ...blankMember(db.settings.staff), ...initial };
    saveDb(
      { ...db, members: [m, ...db.members] },
      { entityType: "client", entityId: m.id, operation: "create", payload: m },
    );
    setSelectedId(m.id); setSection("info"); setDetailTab("record"); setMobileView("detail"); setTab("members");
    setToast({ ok: true, msg: "새 회원을 추가했습니다." });
  };
  const snoozedCount = useMemo(() => db.members.filter((m) => isSnoozed(m)).length, [db.members]);
  const snoozeAlert = (memberId, days) => {
    const until = shift(todayISO(), days);
    saveDb({ ...db, members: db.members.map((m) => (m.id === memberId ? { ...m, snoozeUntil: until } : m)) });
    setToast({ ok: true, msg: `${ymd(until)}까지 이 회원 알림을 숨깁니다.` });
  };
  const unsnoozeAll = () => {
    saveDb({ ...db, members: db.members.map((m) => (m.snoozeUntil ? { ...m, snoozeUntil: "" } : m)) });
    setToast({ ok: true, msg: "미뤄둔 알림을 모두 다시 켰습니다." });
  };

  const drafts = useMemo(
    () => db.members.filter((m) => isBlankDraft(m) && !photos[m.id] && !db.schedule.some((s) => hasMember(s, m.id))),
    [db.members, db.schedule, photos]
  );
  const cleanDrafts = () => {
    const ids = new Set(drafts.map((m) => m.id));
    if (!ids.size) return;
    const rest = db.members.filter((m) => !ids.has(m.id));
    saveDb({ ...db, members: rest });
    if (ids.has(selectedId)) setSelectedId(rest[0]?.id || null);
    setToast({ ok: true, msg: `작성 중이던 회원 ${ids.size}명을 정리했습니다.` });
  };

  const removeMember = (id) => {
    const rest = db.members.filter((m) => m.id !== id);
    const removed = db.members.find((m) => m.id === id);
    saveDb(
      {
        ...db, members: rest,
        schedule: db.schedule
          .map((s) => ({ ...s, attendees: attendeesOf(s).filter((a) => a.memberId !== id) }))
          .filter((s) => s.attendees.length || s.equip),
      },
      removed && { entityType: "client", entityId: id, operation: "archive", payload: removed },
    );
    if (photos[id]) {
      const nextPh = { ...photos };
      const ids = blobIdsOf(photos[id]);
      delete nextPh[id];
      savePhotos(nextPh);
      forgetBlobs(ids);
    }
    setSelectedId(rest[0]?.id || null);
    if (analysisMemberId === id) setAnalysisMemberId(null);
    setToast({ ok: true, msg: "회원을 삭제했습니다." });
  };
  const saveInbody = (id, rec) => {
    const t = db.members.find((m) => m.id === id);
    patch(id, { inbody: [...t.inbody, { id: uid(), ...rec }].sort((a, b) => (a.date > b.date ? 1 : -1)) });
    setToast({ ok: true, msg: "측정값을 저장했습니다." });
  };
  const deleteInbody = (id, recId) => {
    const t = db.members.find((m) => m.id === id);
    patch(id, { inbody: t.inbody.filter((r) => (r.id || r.date) !== recId) });
    setToast({ ok: true, msg: "측정 기록을 삭제했습니다." });
  };
  const saveNote = (id, note) => {
    const t = db.members.find((m) => m.id === id);
    patch(id, { notes: [{ ...note, sid: noteSid || undefined }, ...(t.notes || [])] });
    setNoteSid(null);
    if (noteBack) {
      setNoteBack(false);
      setTab("schedule");
      setToast({ ok: true, msg: `${t?.name || "회원"} 코멘트 저장 · 다음 회원으로 갑니다` });
      return;
    }
    setToast({ ok: true, msg: "코멘트를 저장했습니다." });
  };
  const deleteNote = (nid) => patch(member.id, { notes: member.notes.filter((n) => n.id !== nid) });
  const analysisMember = (memberId) => {
    const target = db.members.find((m) => m.id === memberId);
    if (!memberId || !target) {
      setToast({ ok: false, msg: "분석할 회원을 먼저 선택해 주세요." });
      return null;
    }
    return target;
  };
  const savePhoto = async (memberId, view, blob, slot, tf, gid, gtf) => {
    const target = analysisMember(memberId);
    if (!target || !blob) return;
    let rec = null;
    try { const bid = newBlobId(); await blobPut(bid, blob); rec = { blobId: bid, src: URL.createObjectURL(blob) }; }
    catch (e) {
      try { rec = { src: await blobToDataUrl(blob) }; }
      catch (e2) { setToast({ ok: false, msg: "사진을 저장하지 못했습니다." }); return; }
    }
    const cur = photos[target.id] || {};
    /* 상대 사진 조정이 같이 넘어오면 한 번에 반영한다 (따로 저장하면 뒤엣것이 앞엣것을 덮는다) */
    const list = (cur[view] || []).map((p) => (gid && gtf && p.id === gid ? { ...p, ...gtf } : p));
    const shot = { id: uid(), memberId: target.id, date: todayISO(), marks: [], ...rec, ...tf };
    const nextList = slot === "before" ? [shot, ...list] : [...list, shot];
    const sets = [...(cur.sets || [])];
    savePhotos({ ...photos, [target.id]: { ...cur, [view]: nextList, sets } });
    setToast({ ok: true, msg: "사진을 등록했습니다." });
    return shot;
  };
  const saveCaptureDraft = async (memberId, captures) => {
    const target = analysisMember(memberId);
    if (!target || !captures || typeof captures !== "object") return;
    const cur = photos[target.id] || {};
    const next = { ...cur };
    for (const view of ["front", "side", "back"]) {
      const blob = captures[view];
      if (!blob) continue;
      let rec = null;
      try { const bid = newBlobId(); await blobPut(bid, blob); rec = { blobId: bid, src: URL.createObjectURL(blob) }; }
      catch (e) {
        try { rec = { src: await blobToDataUrl(blob) }; }
        catch (e2) { setToast({ ok: false, msg: `${VIEWS.find((v) => v.key === view)?.label} 사진 초안을 저장하지 못했습니다.` }); continue; }
      }
      const shot = { id: uid(), memberId: target.id, date: todayISO(), marks: [], ...rec };
      next[view] = [...(next[view] || []), shot];
    }
    savePhotos({ ...photos, [target.id]: next });
  };
  const removePhoto = (memberId, view, pid) => {
    const target = analysisMember(memberId);
    if (!target) return;
    const cur = photos[target.id] || {};
    const gone = (cur[view] || []).find((p) => p.id === pid);
    savePhotos({ ...photos, [target.id]: { ...cur, [view]: (cur[view] || []).filter((p) => p.id !== pid) } });
    if (gone?.blobId) forgetBlobs([gone.blobId]);
  };
  const saveSet = (memberId, view, beforeId, afterId) => {
    const target = analysisMember(memberId);
    if (!target || !beforeId || !afterId || beforeId === afterId) return;
    const cur = photos[target.id] || {};
    const sets = [...(cur.sets || [])];
    if (sets.some((x) => x.view === view && x.beforeId === beforeId && x.afterId === afterId)) {
      setToast({ ok: true, msg: "이미 모음에 있는 조합입니다." });
      return;
    }
    sets.unshift({ id: uid(), memberId: target.id, view, beforeId, afterId, createdAt: todayISO(), fav: false });
    savePhotos({ ...photos, [target.id]: { ...cur, sets } });
    setToast({ ok: true, msg: "비포 & 애프터 모음에 저장했습니다." });
  };
  const toggleFav = (memberId, setId) => {
    const cur = photos[memberId] || {};
    savePhotos({ ...photos, [memberId]: { ...cur, sets: (cur.sets || []).map((x) => (x.id === setId ? { ...x, fav: !x.fav } : x)) } });
  };
  const deleteSet = (memberId, setId) => {
    const cur = photos[memberId] || {};
    savePhotos({ ...photos, [memberId]: { ...cur, sets: (cur.sets || []).filter((x) => x.id !== setId) } });
    setToast({ ok: true, msg: "세트를 삭제했습니다." });
  };
  const favList = useMemo(() => {
    const out = [];
    db.members.forEach((m) => {
      const ph = photos[m.id];
      (ph?.sets || []).filter((x) => x.fav).forEach((x) => {
        const list = ph[x.view] || [];
        const before = list.find((p) => p.id === x.beforeId), after = list.find((p) => p.id === x.afterId);
        if (before && after) out.push({ set: x, before, after, member: m });
      });
    });
    return out;
  }, [db.members, photos]);
  const savePose = async (memberId, rec) => {
    const target = analysisMember(memberId);
    if (!target || rec?.memberId && rec.memberId !== target.id) {
      if (rec?.memberId && rec.memberId !== target?.id) setToast({ ok: false, msg: "분석 대상 회원이 일치하지 않아 저장하지 않았습니다." });
      return;
    }
    const out = { ...rec, memberId: target.id };
    delete out.blob; delete out.cleanBlob;
    if (rec.blob) {
      try { const bid = newBlobId(); await blobPut(bid, rec.blob); out.blobId = bid; out.src = URL.createObjectURL(rec.blob); }
      catch (e) { try { out.src = await blobToDataUrl(rec.blob); } catch (e2) {} }
    }
    if (rec.cleanBlob) {
      try { const cid = newBlobId(); await blobPut(cid, rec.cleanBlob); out.cleanBlobId = cid; } catch (e) {}
    }
    const cur = photos[target.id] || {};
    const keep = [out, ...(cur.poses || [])];
    forgetBlobs(keep.slice(6).flatMap((p) => [p.blobId, p.cleanBlobId]).filter(Boolean));
    savePhotos({ ...photos, [target.id]: { ...cur, poses: keep.slice(0, 6) } });
    setToast({ ok: true, msg: "저장했습니다 · 아래 '저장된 분석' 목록에서 다시 볼 수 있어요." });
  };
  const deletePose = (memberId, pid) => {
    const target = analysisMember(memberId);
    if (!target) return;
    const cur = photos[target.id] || {};
    const gone = (cur.poses || []).find((p) => p.id === pid);
    savePhotos({ ...photos, [target.id]: { ...cur, poses: (cur.poses || []).filter((p) => p.id !== pid) } });
    forgetBlobs([gone?.blobId, gone?.cleanBlobId].filter(Boolean));
  };
  const adjustPhoto = (memberId, view, pid, tf, gid, gtf) => {
    const target = analysisMember(memberId);
    if (!target) return;
    const cur = photos[target.id] || {};
    savePhotos({ ...photos, [target.id]: { ...cur, [view]: (cur[view] || []).map((p) =>
      p.id === pid ? { ...p, ...tf } : (gid && gtf && p.id === gid ? { ...p, ...gtf } : p)) } });
    setToast({ ok: true, msg: gid && gtf ? "두 사진의 위치를 저장했습니다." : "사진 위치를 저장했습니다." });
  };
  const saveMarks = (memberId, view, pid, marks) => {
    const target = analysisMember(memberId);
    if (!target) return;
    const cur = photos[target.id] || {};
    savePhotos({ ...photos, [target.id]: { ...cur, [view]: (cur[view] || []).map((p) => (p.id === pid ? { ...p, marks } : p)) } });
    setToast({ ok: true, msg: "체형 분석을 저장했습니다." });
  };
  const wipePhotos = () => {
    Object.keys(photos || {}).forEach((mid) => forgetBlobs(blobIdsOf(photos[mid])));
    savePhotos({});
  };
  const resetSample = () => {
    const d = normalizeDb(sampleDb(account?.center, account?.name), account?.name);
    saveDb(d); wipePhotos(); setSelectedId(d.members[0].id); setDemoMode(true);
    setToast({ ok: true, msg: "회원 데이터를 되돌렸습니다." });
  };
  const clearAll = () => {
    saveDb({ ...db, members: [], schedule: [] }); wipePhotos(); setSelectedId(null); setAnalysisMemberId(null); setDemoMode(false);
    setToast({ ok: true, msg: "모든 회원을 초기화했습니다." });
  };
  const importHandoff = async (inc, how) => {
    if (!inc) return;
    const next = how === "replace"
      ? normalizeDb({ settings: db.settings, members: inc.members || [], schedule: inc.schedule || [] }, account?.name)
      : mergeHandoff(db, inc, account?.name);
    saveDb(next);
    const ph = inc.photos && typeof inc.photos === "object" ? inc.photos : null;
    if (ph && Object.keys(ph).length) {
      let got = ph;
      try { got = (await adoptPhotos(ph)).map; } catch (e) {}
      if (how === "replace") wipePhotos();
      savePhotos(how === "replace" ? got : { ...photos, ...got });
    } else if (how === "replace") wipePhotos();
    setSelectedId(next.members[0]?.id || null);
    setAnalysisMemberId(null);
    setDemoMode(false);
    setToast({ ok: true, msg: `회원 ${next.members.length}명 · 수업 ${next.schedule.length}건으로 반영했습니다.` });
  };

  const style = (
    <style>{`
      @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
      .app-root { min-height: 100vh; min-height: 100dvh; font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif; -webkit-font-smoothing: antialiased; color: ${INK}; color-scheme: ${THEME}; }
      .app-root .bg-white { background-color: ${CARD}; }
      .app-root .bg-slate-50 { background-color: ${CANVAS}; }
      .app-root .ring-slate-200 { --tw-ring-color: ${LINE}; }
      .app-root .border-white { border-color: ${CARD}; }
      .app-root .bg-photo { background-color: ${PHOTO}; }
      .app-root input, .app-root textarea, .app-root select { color: ${INK}; background-color: ${CANVAS}; }
      .app-root input::placeholder, .app-root textarea::placeholder { color: ${FAINT}; }
      .app-root ::-webkit-calendar-picker-indicator { filter: ${THEME === "dark" ? "invert(1) opacity(.55)" : "none"}; }
      .app-root ::-webkit-scrollbar { width: 8px; height: 8px; }
      .app-root ::-webkit-scrollbar-thumb { background: ${LINE}; border-radius: 8px; }
      .app-root .rounded-2xl { border-radius: 12px; }
      .app-root .rounded-3xl { border-radius: 16px; }
      .app-root p, .app-root h1, .app-root h2, .app-root h3, .app-root span, .app-root button, .app-root li { word-break: keep-all; overflow-wrap: break-word; }
      .app-root *:focus-visible { outline: 2px solid ${PRIMARY}; outline-offset: 2px; }
      .app-root input[type=range] { height: 28px; }
      /* 노치·홈바 여백.
         아이폰은 env() 로 정확한 값이 오지만 안드로이드(갤럭시 등)는 0을 주는 경우가 많아
         max() 로 최소 여백을 보장한다. 좌우도 가로모드·곡면 화면 대비로 함께 잡는다. */
      .safe-b { padding-bottom: max(env(safe-area-inset-bottom, 0px), 12px); }
      .safe-t { padding-top: max(env(safe-area-inset-top, 0px), 0px); }
      .safe-all {
        padding-top: max(env(safe-area-inset-top, 0px), 10px);
        padding-bottom: max(env(safe-area-inset-bottom, 0px), 14px);
        padding-left: max(env(safe-area-inset-left, 0px), 0px);
        padding-right: max(env(safe-area-inset-right, 0px), 0px);
      }
      .safe-sheet { padding-bottom: calc(1.25rem + max(env(safe-area-inset-bottom, 0px), 10px)); }
      .safe-tab { padding-bottom: max(env(safe-area-inset-bottom, 0px), 8px); }
      /* 49px 하단 탭바와 홈 인디케이터에 본문이 가려지지 않도록 여백 확보 */
      .safe-scroll { padding-bottom: calc(69px + max(env(safe-area-inset-bottom, 0px), 12px)); }
      .pt-scroll { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; scrollbar-width: thin; }
      .touch-none { touch-action: none; }
      .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      @keyframes pop { 0% { transform: scale(.86); opacity: 0 } 60% { transform: scale(1.04); opacity: 1 } 100% { transform: scale(1) } }
      @keyframes fade { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
      .splash-pop { animation: pop .7s cubic-bezier(.2,.85,.25,1) both }
      .splash-fade { animation: fade .55s ease .38s both }
      .splash-fade2 { animation: fade .55s ease .58s both }
      @keyframes ringOut { 0% { transform: scale(.82); opacity: 0 } 45% { opacity: .85 } 100% { transform: scale(1.06); opacity: .35 } }
      .ring1 { animation: ringOut 1.1s ease .25s both }
      .ring2 { animation: ringOut 1.3s ease .4s both }
      @keyframes bar { 0% { width: 0 } 70% { width: 82% } 100% { width: 100% } }
      .loadbar { animation: bar 1.5s cubic-bezier(.3,.9,.3,1) both }
      @keyframes weekIn { from { opacity: .35; transform: translateX(10px) } to { opacity: 1; transform: none } }
      @keyframes sheetIn { from { transform: translate(-50%, 18px); opacity: .72 } to { transform: translate(-50%, 0); opacity: 1 } }
      .sheet-in { animation: sheetIn .18s ease-out both; }
      @keyframes rowRise { 0% { transform: translateY(18px); opacity: .3 } 55% { transform: translateY(-5px); opacity: 1 } 78% { transform: translateY(2px) } 100% { transform: translateY(0) } }
      @keyframes rowSink { 0% { transform: translateY(-12px) scale(.98); opacity: .45 } 70% { transform: translateY(2px) scale(1) } 100% { transform: translateY(0); opacity: 1 } }
      .week-strip { animation: weekIn .22s ease both }
      @media (prefers-reduced-motion: reduce) { .app-root *, .splash-pop, .splash-fade { animation: none !important; transition: none !important } }
    `}</style>
  );

  if (phase === "splash") return <div className="app-root">{style}<Splash /></div>;
  if (phase === "auth")
    return (
      <div className="app-root">
        {style}
        <AuthScreen accounts={accounts} onLogin={handleLogin} onSignup={handleSignup} onToast={setToast} />
        {toast && (
          <div className="safe-b fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
            <div className="flex items-center gap-2 rounded-full px-4 py-3" style={{ backgroundColor: toast.ok ? TOAST : BAD, boxShadow: SHADOW }}>
              {toast.ok ? <Check size={14} color="#fff" /> : <AlertTriangle size={14} color="#fff" />}
              <span className="text-sm font-bold text-white">{toast.msg}</span>
            </div>
          </div>
        )}
      </div>
    );

  return (
    <div className="app-root flex justify-center" style={{ minHeight: "100vh", height: "100dvh", backgroundColor: PAGE, overflow: "hidden" }}>
      {style}
      <div className="safe-t flex h-full min-h-0 w-full flex-col" style={{ maxWidth: 420, backgroundColor: PAGE, boxShadow: "0 0 0 1px rgba(28,36,51,.04)" }}>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <Guard key={tab}>
            {tab === "schedule" && <ScheduleManager db={db} photos={photos} onToast={setToast} onSettings={(next) => saveDb({ ...db, settings: next })} onSave={saveSchedule} onDelete={deleteSchedule} onStatus={setStatus} onStatusAll={setStatusAll} onNoshowFee={setNoshowFee} onGroupDone={setGroupDone} onNoComment={noComment} onSaveNote={saveScheduleComment} memberPresetId={scheduleMemberId} onConsumeMemberPreset={() => setScheduleMemberId(null)} />}
            {tab === "members" && (mobileView === "detail" && member ? (
              <ReferenceMemberDetail key={member.id} member={member} schedule={db.schedule} photos={photos[member.id]} onBack={() => setMobileView("list")}
                onPatch={(change) => patch(member.id, change)} onSaveNote={(type, body) => saveScheduleComment(member.id, type, null, body)}
                onSchedule={() => { setScheduleMemberId(member.id); setTab("schedule"); }} onAssess={() => { setAnalysisRecordId(null); setAnalysisMemberId(member.id); setTab("analysis"); }} />
            ) : <ReferenceMemberList members={db.members} schedule={db.schedule} onAdd={addMember} onSelect={(id) => { setSelectedId(id); setMobileView("detail"); }} />)}
            {tab === "analysis" && <ReferenceAnalysisTab members={db.members} photos={photos} selectedId={analysisMemberId} selectedPoseId={analysisRecordId}
              onSelect={(id, poseId = null) => { setAnalysisMemberId(id); setAnalysisRecordId(poseId); }}
              hub={(id, initialSavedId) => {
                const m = db.members.find((x) => x.id === id);
                if (!m) return null;
                const saved = (photos[id]?.poses || []).filter((x) => x && x.metrics);
                return <div key={id} className="space-y-2">
                  <Guard label="새 체형분석"><PoseAnalyzer embedded initialSavedId={initialSavedId} member={m} photos={photos[id]} onSavePose={(rec) => savePose(id, { ...rec, memberId: id })} onDeletePose={(pid) => deletePose(id, pid)} onSaveCaptureDraft={(captures) => saveCaptureDraft(id, captures)} onToast={setToast} roleLabel={saved.length === 0 ? "비포 사진" : "애프터 사진"} onSaved={(mode) => setAnalysisDone({ id, mode: mode || (saved.length === 0 ? "before" : "after") })} /></Guard>
                  {saved.length >= 2 && <Guard label="결과 카드"><ResultCardMaker member={m} saved={saved} centerName={db.settings.center} onToast={setToast} /></Guard>}
                  {saved.length > 0 && <Guard label="비포·애프터"><PhotoCompare member={m} photos={photos[id]} onSavePhoto={(...args) => savePhoto(id, ...args)} onRemove={(...args) => removePhoto(id, ...args)} onSaveMarks={(...args) => saveMarks(id, ...args)} onAdjust={(...args) => adjustPhoto(id, ...args)} onToast={setToast} onSaveSet={(...args) => saveSet(id, ...args)} /></Guard>}
                </div>;
              }} />}
            {tab === "settings" && <ReferenceSettingsTab db={db} account={account} savedAt={savedAt} onChangeSettings={(s) => saveDb({ ...db, settings: s })} onChangePhoto={changePhoto} onToast={setToast} themePref={themePref} onChangeTheme={changeTheme} onLogout={handleLogout} />}
          </Guard>
        </div>
        <Tabs tab={tab} setTab={goTab} />
      </div>
      {toast && (
        <div className="fixed inset-x-0 z-[70] flex justify-center px-4" style={{ bottom: "calc(62px + max(env(safe-area-inset-bottom, 0px), 8px))" }}>
          <div className="flex max-w-[360px] items-center gap-2 px-4 py-2.5" style={{ borderRadius: 8, backgroundColor: toast.ok ? TOAST : BAD, boxShadow: SHADOW }}>
            {toast.ok ? <Check size={14} color="#fff" /> : <AlertTriangle size={14} color="#fff" />}
            <span className="text-sm font-bold text-white">{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
