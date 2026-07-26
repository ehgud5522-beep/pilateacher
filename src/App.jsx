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
import { Users, Settings as SettingsIcon, Search, ChevronRight, ChevronLeft, Plus, Camera, MessageSquare, Check, X, Trash2, ArrowLeft, Target, ClipboardList, RotateCcw, Sparkles, Copy, ArrowUpRight, ArrowDownRight, Loader as Loader2, Pencil, UserPlus, Activity, Ticket, Calendar, Clock, Bell, Download, TriangleAlert as AlertTriangle, LogOut, Mail, Star, Sun, Moon, Smartphone, Move, Crosshair, ChevronDown, ImagePlus, SlidersHorizontal, CalendarDays, ArrowUpDown, QrCode, Minus, Upload, Link2, Users as Users2 } from "lucide-react";

/* ================= 토큰 · 테마 ================= */
const LIGHT = {
  page: "#F2F2F7", card: "#FFFFFF", soft: "#F5F5FA", line: "#EBEBF2",
  ink: "#17171F", ink2: "#4A4A5A", sub: "#8A8A9B", faint: "#C2C2D2",
  primary: "#6C4CF1", brand: "#6C4CF1", tint: "#F1EDFE", ring: "rgba(108,76,241,.28)",
  toast: "#17171F",
  good: "#12B76A", goodS: "#E7F8F0", bad: "#F04438", badS: "#FEECEA",
  warn: "#F79009", warnS: "#FFF4E3", mint: "#8B74FF",
  shadow: "0 1px 2px rgba(20,20,43,0.04), 0 10px 30px rgba(20,20,43,0.06)",
  grad: "linear-gradient(135deg, #7C5CFC 0%, #6C4CF1 45%, #5636D8 100%)",
  gradSoft: "linear-gradient(155deg, #F1EDFE 0%, #FFFFFF 62%)",
  splash: "linear-gradient(180deg,#FFFFFF 0%,#F7F5FF 44%,#EAE4FF 100%)",
  glow: "radial-gradient(circle, rgba(139,116,255,.27) 0%, rgba(139,116,255,.07) 45%, transparent 70%)",
  scrim: "rgba(20,20,43,0.45)", onBrand: "#FFFFFF", photo: "#000000",
};
const DARK = {
  page: "#16161C", card: "#1E1E26", soft: "#292933", line: "#363644",
  ink: "#DEDEE8", ink2: "#CACAD8", sub: "#8B8B9C", faint: "#5A5A70",
  primary: "#A594FF", brand: "#6E56E2", tint: "#272049", ring: "rgba(165,148,255,.35)",
  toast: "#2E2E3A",
  good: "#4ECFA0", goodS: "#10291F", bad: "#FF8B80", badS: "#301715",
  warn: "#EFC05C", warnS: "#2E2109", mint: "#A18CFF",
  shadow: "0 0 0 1px rgba(255,255,255,.02), 0 14px 38px rgba(0,0,0,.55)",
  grad: "linear-gradient(135deg, #8168FF 0%, #6A4CE0 45%, #4E31C8 100%)",
  gradSoft: "linear-gradient(155deg, #272049 0%, #1E1E26 62%)",
  splash: "linear-gradient(180deg,#08080C 0%,#151130 46%,#241C4E 100%)",
  glow: "radial-gradient(circle, rgba(161,140,255,.32) 0%, rgba(161,140,255,.09) 45%, transparent 70%)",
  scrim: "rgba(0,0,0,0.66)", onBrand: "#FFFFFF", photo: "#0F0F14",
};
let THEME = "light";
let INK, INK2, SUB, FAINT, PRIMARY, TINT, RING, CANVAS, PAGE, CARD, LINE;
let GOOD, GOOD_S, BAD, BAD_S, WARN, WARN_S, MINT, SHADOW, GRAD, GRAD_SOFT, SPLASH_BG, GLOW, SCRIM, ON_BRAND;
let BRAND, TOAST, PHOTO;
function applyTheme(mode) {
  if (PAGE && THEME === mode) return;
  const p = mode === "dark" ? DARK : LIGHT;
  THEME = mode;
  PAGE = p.page; CARD = p.card; CANVAS = p.soft; LINE = p.line;
  INK = p.ink; INK2 = p.ink2; SUB = p.sub; FAINT = p.faint;
  PRIMARY = p.primary; BRAND = p.brand; TINT = p.tint; RING = p.ring; TOAST = p.toast; PHOTO = p.photo || "#000";
  GOOD = p.good; GOOD_S = p.goodS; BAD = p.bad; BAD_S = p.badS;
  WARN = p.warn; WARN_S = p.warnS; MINT = p.mint;
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
      "--shadow": p.shadow, "--grad": p.grad, "--grad-soft": p.gradSoft,
      "--splash-bg": p.splash, "--glow": p.glow, "--scrim": p.scrim, "--on-brand": p.onBrand,
      "--theme": mode,
    };
    Object.entries(props).forEach(([k, v]) => root.style.setProperty(k, v));
  }
}
applyTheme("light");
const THEME_KEY = "pilateacher_theme_v1";
const sysDarkNow = () => {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); }
  catch (e) { return false; }
};

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

const VIEWS = [{ key: "front", label: "정면" }, { key: "side", label: "측면" }, { key: "back", label: "후면" }];
const CLASS_TYPES = ["개인레슨", "듀엣", "그룹"];
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
const monStart = (iso) => { const d = new Date(iso + "T00:00:00"); return shift(iso, -((d.getDay() + 6) % 7)); };
const dday = (iso) => Math.round((new Date(iso + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 864e5);
const ddaySafe = (iso) => { if (!iso) return null; const v = dday(iso); return Number.isFinite(v) ? v : null; };
const md = (iso) => (iso ? `${iso.slice(5, 7)}.${iso.slice(8, 10)}` : "");
const ymd = (iso) => (iso ? `${iso.slice(0, 4)}. ${iso.slice(5, 7)}. ${iso.slice(8, 10)}` : "");
const uid = () => Math.random().toString(36).slice(2, 9);
const weeksBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 6048e5));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const left = (m) => num(m?.regular) + num(m?.service);
const ptf = (p) => `translate(${p?.x || 0}%, ${p?.y || 0}%) scale(${p?.scale || 1})`;
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
const isEquipGroup = (s) => attendeesOf(s).length === 0;
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
async function fileToBlob(file, max = 900, q = 0.72) {
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

async function shareCanvas(canvas, filename, title, onToast) {
  let blob = null;
  try { blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92)); } catch (e) {}
  if (!blob) { onToast && onToast({ ok: false, msg: "이미지를 만들지 못했습니다." }); return false; }
  let file = null, canNative = false;
  try {
    file = new File([blob], filename, { type: "image/jpeg" });
    canNative = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch (e) { canNative = false; }
  if (canNative) {
    try { await navigator.share({ files: [file], title }); } catch (e) {}
    return true;
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onToast && onToast({ ok: true, msg: "이미지를 저장했습니다." });
    return true;
  } catch (e) { return false; }
}

async function shareBeforeAfter(before, after, memberName, onToast) {
  try {
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
      ctx.drawImage(img, x + (W - dw) / 2 + ((p?.x || 0) / 100) * W, (H - dh) / 2 + ((p?.y || 0) / 100) * H, dw, dh);
      ctx.restore();
    };
    cell(b, before, 0); cell(a, after, W + GAP);
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
    return await shareCanvas(c, `비포애프터_${memberName || "회원"}_${todayISO()}.jpg`, "비포 & 애프터", onToast);
  } catch (e) { onToast && onToast({ ok: false, msg: "이미지를 만들지 못했습니다." }); return false; }
}

function blankMember(staff) {
  return {
    id: uid(), name: "", age: "", instructor: staff || "", goal: "", passName: "", phone: "",
    regular: 0, service: 0, total: 0, startDate: todayISO(), contractEnd: "", focus: [],
    status: "active", endedAt: "", endedReason: "", endedMemo: "",
    holdFrom: "", holdUntil: "", holdReason: "", payments: [],
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
  settings: { center: center || "필라티쳐 스튜디오", staff: staff || "강사" },
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
    settings: { center: d.settings?.center ?? "", staff: d.settings?.staff ?? (staff || ""), templates: Array.isArray(d.settings?.templates) ? d.settings.templates : [] },
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
    })).filter((x) => x.attendees.length || x.equip) : [],
  };
}
const emptyDb = (center, staff) => ({ settings: { center: center || "", staff: staff || "" }, schedule: [], members: [] });
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
  <section className={`rounded-3xl bg-white ${className}`} style={{ boxShadow: SHADOW, border: `1px solid ${LINE}` }}>{children}</section>
);
const Sub = ({ children, className = "" }) => <p className={`text-xs ${className}`} style={{ color: SUB }}>{children}</p>;
const inputCls = "w-full rounded-2xl border-0 bg-slate-50 px-4 py-3 text-sm outline-none ring-1 ring-slate-200 focus:ring-2";
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
    className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3.5 text-sm font-extrabold text-white disabled:opacity-40"
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
              ? { backgroundColor: BRAND, color: "#fff", boxShadow: "0 2px 8px rgba(108,76,241,.30)" }
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

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ backgroundColor: SCRIM }} onClick={onClose}>
      <div className="w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl md:max-w-xl" style={{ maxHeight: "92vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-extrabold" style={{ color: INK }}>{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5" style={{ backgroundColor: CANVAS }}><X size={16} style={{ color: SUB }} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function GuideOverlay({ strong = false }) {
  const c = strong ? "rgba(108,76,241,0.95)" : "rgba(108,76,241,0.5)";
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-y-0 left-1/2 w-px" style={{ backgroundColor: c }} />
      {[22, 50, 78].map((t) => <div key={t} className="absolute inset-x-0" style={{ top: `${t}%`, height: 1, backgroundColor: "rgba(255,255,255,0.5)" }} />)}
    </div>
  );
}
const Logo = ({ size = 64, radius = 0.24 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="필라티쳐"
    style={{ borderRadius: size * radius, display: "block", boxShadow: "0 18px 40px rgba(76,52,190,0.30), 0 4px 10px rgba(76,52,190,0.20)" }}>
    <defs>
      <linearGradient id="ptg" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stopColor="#A08CFF" />
        <stop offset="52%" stopColor="#6C4CF1" />
        <stop offset="100%" stopColor="#5433CE" />
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
      <g stroke="#6C4CF1" strokeWidth="9">
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
    <circle cx="69" cy="29.5" r="7" fill="#6C4CF1" />
    <circle cx="69" cy="29.5" r="5.8" fill="#FFFFFF" />
    <g fill="#6C4CF1" stroke="#FFFFFF" strokeWidth="1.6">
      {[[62, 31], [83, 42], [69, 42], [69, 57], [63.5, 71.5], [74.5, 71.5]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" />
      ))}
    </g>
  </svg>
);
const GREETS = {
  dawn: ["이 새벽에 나온 정성, 회원들은 다 알고 있어요", "새벽 공기 가르며 오셨네요, 오늘도 곁에서 응원해요", "하루를 가장 먼저 여는 사람이 강사님이라 든든해요"],
  morning: ["오늘 아침 컨디션은 어떠세요? 좋은 하루 만들어봐요", "강사님의 미소면 오늘 수업 절반은 이미 성공이에요", "따뜻한 커피 한 잔 하셨나요? 천천히 시작해요"],
  noon: ["오전 수업 하느라 애쓰셨어요, 점심 꼭 챙겨 드세요", "잠깐 숨 고르고 가요, 오늘도 충분히 잘하고 있어요", "오전의 강사님, 정말 멋졌어요"],
  afternoon: ["나른한 시간에도 이렇게 준비하시다니, 역시 강사님이에요", "회원들이 강사님 에너지 받으러 오고 있어요", "잠깐 기지개 한 번 켜고 가요, 강사님 몸도 소중하니까요"],
  evening: ["하루 중 제일 바쁜 시간이죠, 오늘도 함께 응원할게요", "퇴근하고 달려오는 회원들, 사실 강사님 보러 오는 거예요", "저녁 수업까지 힘내는 모습, 진심으로 멋져요"],
  night: ["오늘 하루도 정말 수고 많으셨어요, 마음이 따뜻해지네요", "회원들 몸이 좋아진 건 전부 강사님 덕분이에요", "이제 강사님 자신을 챙길 시간이에요"],
  late: ["이 시간까지라니, 마음이 쓰여요. 얼른 쉬세요", "오늘은 충분히 하셨어요, 나머지는 내일의 강사님께 맡겨요", "고생 많았어요, 오늘 밤은 포근하게 마무리해요"],
};
const greetKey = (h) => (h < 6 ? "late" : h < 9 ? "dawn" : h < 11 ? "morning" : h < 14 ? "noon" : h < 17 ? "afternoon" : h < 20 ? "evening" : h < 23 ? "night" : "late");

const WEEKEND_GREETS = {
  satAM: [
    "점심까지만 달리면 이번 주 끝이에요. 같이 힘내요",
    "토요일 오전, 이번 주 마지막 수업입니다. 조금만 더요",
    "주말 아침부터 나오신 강사님, 오전만 부탁드려요",
    "오늘 점심이면 한 주가 마무리돼요. 컨디션 잘 챙기세요",
  ],
  satPM: [
    "이번 주 수업 모두 끝났어요. 남은 주말은 강사님 시간입니다",
    "토요일 오전까지 달려온 한 주, 정말 수고 많으셨어요",
    "한 주를 잘 닫았습니다. 오늘 오후는 푹 쉬어 주세요",
    "수업 마감! 오늘만큼은 강사님 몸도 쉬게 해 주세요",
  ],
  sun: [
    "내일 만날 회원님을 미리 알고 가면 수업이 훨씬 쉬워져요",
    "일요일은 다음 주를 준비하는 날. 내일 회원님부터 한 번 훑어볼까요",
    "내일 수업 회원님의 지난 기록만 봐도 첫 마디가 달라집니다",
    "다음 주 회원님들을 미리 그려 보는 시간, 이게 강사님의 강점이 돼요",
    "월요일이 가벼워지는 방법은 하나예요. 내일 수업을 미리 보는 것",
  ],
};
const greetLine = () => {
  const now = new Date(), day = now.getDay(), h = now.getHours(), i = now.getDate();
  if (day === 0) return WEEKEND_GREETS.sun[i % WEEKEND_GREETS.sun.length];
  if (day === 6 && h >= 6) { const a = h < 14 ? WEEKEND_GREETS.satAM : WEEKEND_GREETS.satPM; return a[i % a.length]; }
  const a = GREETS[greetKey(h)];
  return a[i % a.length];
};

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

  const handleSocial = (provider) => {
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
                  disabled={emailTab === "signup" ? !(f.name && f.email && f.pw.length >= 6 && f.center) : !(f.email && f.pw)}
                  onClick={() => {
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

          {accounts.length > 0 && (
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
          회원 정보와 사진은 이 기기에만 저장되며 외부 서버로 전송되지 않습니다.<br />
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
              <Field label="이메일"><input value={signup.email} onChange={(e) => setSignup({ ...signup, email: e.target.value })} placeholder="teacher@studio.com" className={inputCls} /></Field>
              <Field label="연락처" hint="선택"><input value={signup.phone} onChange={(e) => setSignup({ ...signup, phone: e.target.value })} placeholder="010-" className={inputCls} /></Field>
            </div>
            <PrimaryBtn disabled={!(signup.name && signup.center)} onClick={() => onSignup(signup, auto)}>가입하고 시작하기</PrimaryBtn>
          </div>
        </Sheet>
      )}
    </div>
  );
}
function Header({ settings, account, alertCount, onProfile }) {
  return (
    <div className="bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Logo size={36} radius={0.28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold" style={{ color: INK }}>{settings.center || "필라티쳐"}</p>
          <Sub className="truncate">{account?.name ? `${account.name} 강사` : "체형 변화 · 재등록 관리"}</Sub>
        </div>
        {alertCount > 0 && (
          <span className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-extrabold" style={{ backgroundColor: BAD_S, color: BAD }}>
            <Bell size={13} /> {alertCount}
          </span>
        )}
        <button onClick={onProfile} className="shrink-0" aria-label="내 프로필">
          <Avatar src={account?.photo} name={account?.name} size={34} radius={12} ring />
        </button>
      </div>
    </div>
  );
}
function Tabs({ tab, setTab }) {
  const items = [
    { key: "schedule", label: "일정", icon: Calendar }, { key: "members", label: "회원", icon: Users },
    { key: "records", label: "기록", icon: ClipboardList }, { key: "settings", label: "설정", icon: SettingsIcon },
  ];
  return (
    <div className="bg-white pb-2" style={{ borderBottom: `1px solid ${LINE}` }}>
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
          {items.map((it) => {
            const on = tab === it.key, Icon = it.icon;
            return (
              <button key={it.key} onClick={() => setTab(it.key)} className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2.5 text-sm font-bold"
                style={on ? { background: GRAD, color: "#fff", boxShadow: "0 3px 10px rgba(108,76,241,.35)" } : { color: SUB }}>
                <Icon size={15} /> {it.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function detectAlerts(members, schedule) {
  const out = [];
  members.forEach((m) => {
    if (isEnded(m)) return;
    const att = attendanceOf(schedule, m.id);
    if (isHold(m)) {
      const d = ddaySafe(m.holdUntil);
      if (d !== null && d <= 3)
        out.push({ member: m, kind: "return", rest: left(m), d, att, reasons: [d < 0 ? `수업 재개 예정 ${Math.abs(d)}일 경과` : `수업 재개 D-${d}`], urgency: 25 + Math.max(0, 3 - d) });
      return;
    }
    const rest = left(m);
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
function AlertCenter({ alerts, onOpenMember, onBrief }) {
  const [open, setOpen] = useState(true);
  if (!alerts.length) return null;
  return (
    <section className="mb-3 overflow-hidden rounded-3xl" style={{ background: `linear-gradient(150deg, ${BAD_S} 0%, ${CARD} 55%)`, border: `1px solid ${LINE}`, boxShadow: SHADOW }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-5 pb-3 pt-5 text-left">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: BAD_S }}><Bell size={16} style={{ color: BAD }} /></span>
        <div className="flex-1"><h3 className="font-extrabold" style={{ color: INK }}>재등록 골든타임</h3><Sub>지금 연락해야 할 회원 {alerts.length}명</Sub></div>
        <ChevronRight size={18} style={{ color: SUB, transform: open ? "rotate(90deg)" : "none" }} />
      </button>
      {open && (
        <div className="flex gap-3 overflow-x-auto px-5 pb-5">
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

function SchedItem({ s, members, del, setDel, setEditing, onStatus, onNoshowFee, onGroupDone, onDelete }) {
  const nameOf = (id) => members.find((m) => m.id === id)?.name || "삭제된 회원";
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

function ScheduleManager({ db, onSave, onDelete, onStatus, onNoshowFee, onGroupDone, onOpenMember, onWriteNote, onNoComment }) {
  const [mode, setMode] = useState("day");
  const [cursor, setCursor] = useState(todayISO());
  const [editing, setEditing] = useState(null);
  const [del, setDel] = useState(null);
  const [drag, setDrag] = useState(0);
  const [anim, setAnim] = useState(true);
  const x0 = useRef(null);

  const nameOf = (id) => db.members.find((m) => m.id === id)?.name || "삭제된 회원";
  const memberOf = (id) => db.members.find((m) => m.id === id);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => shift(monStart(cursor), i)), [cursor]);
  const byDate = (d) => db.schedule.filter((s) => s.date === d).sort((a, b) => a.start.localeCompare(b.start));
  const seatsOn = (d) => byDate(d).reduce((n, s) => n + attendeesOf(s).length, 0);
  const ym = monthKey(cursor);
  const stat = useMemo(() => monthStats(db.schedule, ym), [db.schedule, ym]);
  const monthDone = useMemo(() => {
    const cm = monthKey(todayISO());
    return db.schedule.filter((s) => s?.date && s.date.startsWith(cm) && (isEquipGroup(s) ? !!s.groupDone : attendeesOf(s).some((a) => a.deductFrom))).length;
  }, [db.schedule]);

  const step = (dir) => setCursor(mode === "month" ? addMonth(cursor, dir) : shift(cursor, (mode === "day" ? 1 : 7) * dir));
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
      if (isEquipGroup(s)) { out.push({ key: s.id, kind: "equip", sid: s.id, start: s.start, end: s.end, type: s.type, equip: s.equip, done: !!s.groupDone, s }); return; }
      attendeesOf(s).forEach((a) => out.push({ key: `${s.id}:${a.memberId}`, kind: "member", id: a.memberId, sid: s.id, start: s.start, end: s.end, type: s.type, status: a.status, fee: a.noshowFee, deductFrom: a.deductFrom, s }));
    });
    return out;
  }, [db.schedule]);

  const T1 = shift(T0, 1);
  const tomorrowRows = useMemo(() => {
    const out = [];
    db.schedule.filter((s) => s.date === T1).sort((a, b) => a.start.localeCompare(b.start)).forEach((s) => {
      if (isEquipGroup(s)) { out.push({ key: s.id, kind: "equip", start: s.start, equip: s.equip }); return; }
      attendeesOf(s).forEach((a) => out.push({ key: `${s.id}:${a.memberId}`, kind: "member", id: a.memberId, start: s.start, type: s.type }));
    });
    return out;
  }, [db.schedule, T1]);

  const isSettled = (r) => {
    if (r.kind === "equip") return r.done;
    if (r.status === "cancel") return true;
    if (r.status === "noshow") return r.fee != null;
    if (r.status === "done") return (memberOf(r.id)?.notes || []).some((x) => x?.date === T0);
    return false;
  };
  const canPark = (r) => isSettled(r) || !!parked[r.key];
  const sortedRows = useMemo(() => {
    const down = todayRows.filter((r) => parked[r.key]);
    const up = todayRows.filter((r) => !parked[r.key]);
    return [...up, ...down];
  }, [todayRows, parked]);
  const parkedCount = todayRows.filter((r) => parked[r.key]).length;
  const todayCls = db.schedule.filter((s) => s.date === T0).length;
  const doneRows = todayRows.filter((r) => r.kind === "member" && r.status === "done");
  const doneToday = doneRows.length;
  const unwrittenRows = doneRows.filter((r) => !(memberOf(r.id)?.notes || []).some((x) => x?.date === T0));
  const unwritten = unwrittenRows.length;
  const firstUnwritten = unwrittenRows[0]?.id;
  const doneCls = db.schedule.filter((s) => s.date === T0 && (isEquipGroup(s) ? !!s.groupDone : attendeesOf(s).every((a) => a.status !== "booked"))).length;
  return (
    <div className="space-y-3">
      <div className="rounded-3xl p-5" style={{ background: `linear-gradient(140deg, ${BRAND} 0%, #5B3FD4 100%)`, boxShadow: SHADOW }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-white opacity-75">{ymd(T0)} ({dow(T0)})</p>
            {db.settings?.staff && (
              <p className="mt-1 text-sm font-extrabold text-white" style={{ letterSpacing: "-0.02em", wordBreak: "keep-all" }}>
                <span className="whitespace-nowrap">{db.settings.staff} 강사님,</span>
              </p>
            )}
            <h2 className="mt-0.5 text-xl font-extrabold text-white" style={{ letterSpacing: "-0.03em", lineHeight: 1.32, wordBreak: "keep-all", overflowWrap: "break-word" }}>
              {greetLine()}
            </h2>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl p-3" style={{ backgroundColor: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.14)" }}>
            <p className="text-xs font-bold text-white opacity-85">오늘 수업</p>
            <p className="mt-0.5 text-xl font-extrabold tabular-nums text-white">{todayCls}수업</p>
          </div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: "rgba(52,211,153,0.30)", border: "1px solid rgba(255,255,255,0.22)" }}>
            <p className="flex items-center gap-1 text-xs font-bold text-white opacity-90"><Check size={11} /> 완료</p>
            <p className="mt-0.5 text-xl font-extrabold tabular-nums text-white">{doneCls}수업</p>
          </div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: "#FFFFFF", boxShadow: "0 4px 12px rgba(30,16,90,.22)" }}>
            <p className="text-xs font-bold" style={{ color: "#6E6E80" }}>남은 수업</p>
            <p className="mt-0.5 text-xl font-extrabold tabular-nums" style={{ color: "#4F2FCB" }}>{Math.max(0, todayCls - doneCls)}수업</p>
            <p className="mt-1 text-xs font-bold tabular-nums" style={{ color: "#77778A" }}>이달 누적 {monthDone}수업</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <Sparkles size={12} color="#fff" style={{ opacity: 0.8 }} />
          <p className="text-xs font-semibold text-white opacity-90">{dailyLine()}</p>
        </div>
      </div>

      {todayRows.length > 0 && unwritten > 0 && (
        <button onClick={() => onWriteNote && onWriteNote(firstUnwritten)} className="flex w-full items-center gap-2 rounded-2xl px-4 py-3" style={{ backgroundColor: WARN_S }}>
          <Pencil size={15} style={{ color: WARN }} />
          <span className="text-sm font-extrabold" style={{ color: INK }}>오늘 수업 {doneToday}건 중 {unwritten}건이 아직 기록 전입니다</span>
          <ChevronRight size={16} style={{ color: WARN, marginLeft: "auto" }} />
        </button>
      )}

      {todayRows.length === 0 && tomorrowRows.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: TINT }}><CalendarDays size={14} style={{ color: PRIMARY }} /></span>
            <div className="min-w-0 flex-1">
              <h3 className="font-extrabold" style={{ color: INK }}>내일 수업 미리 보기</h3>
              <Sub>{dow(T0) === "일" ? "내일 만날 회원님을 알고 가면 첫 수업부터 수월합니다" : "내일 만날 회원님을 미리 확인해 두세요"}</Sub>
            </div>
            <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>{tomorrowRows.length}건</span>
          </div>
          <div className="mt-3 space-y-1.5">
            {tomorrowRows.slice(0, 8).map((r) => {
              if (r.kind === "equip") return (
                <div key={r.key} className="flex items-center gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
                  <span className="w-12 shrink-0 text-xs font-extrabold tabular-nums" style={{ color: PRIMARY }}>{r.start}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold" style={{ color: INK }}>{r.equip || "기구 미선택"} 그룹</span>
                </div>
              );
              const m = memberOf(r.id);
              const note = (m?.notes || []).filter((x) => x && x.body).sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1))[0];
              return (
                <button key={r.key} onClick={() => onOpenMember && onOpenMember(r.id)} className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left" style={{ backgroundColor: CANVAS }}>
                  <span className="w-12 shrink-0 text-xs font-extrabold tabular-nums" style={{ color: PRIMARY }}>{r.start}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold" style={{ color: INK }}>{m ? (m.name || "이름 미입력") : "삭제된 회원"}</span>
                    <span className="block truncate text-xs" style={{ color: INK2 }}>{note ? `지난 수업 · ${note.body}` : "지난 기록이 없습니다"}</span>
                  </span>
                  {m && <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: left(m) <= 3 ? BAD : SUB }}>잔여 {left(m)}회</span>}
                  <ChevronRight size={14} className="shrink-0" style={{ color: FAINT }} />
                </button>
              );
            })}
          </div>
          <button onClick={() => { setCursor(T1); setMode("day"); }} className="mt-3 w-full rounded-2xl py-3 text-sm font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>
            내일 일정 열기
          </button>
        </Card>
      )}

      {todayRows.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-extrabold" style={{ color: INK }}>오늘 수업</h3>
              <Sub>여기서 출석 · 노쇼 · 취소를 처리하면 잔여 횟수에 바로 반영됩니다</Sub>
            </div>
            <span className="rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>{todayRows.length}건</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ backgroundColor: CANVAS }}>
            <ChevronLeft size={13} style={{ color: PRIMARY }} />
            <p className="text-xs font-bold" style={{ color: INK }}>끝난 수업은 <span style={{ color: PRIMARY }}>왼쪽으로 밀면</span> 맨 아래로</p>
            {parkedCount > 0 && (
              <button onClick={() => setParked({})} className="ml-auto rounded-full bg-white px-2.5 py-1 text-xs font-extrabold" style={{ color: PRIMARY }}>모두 올리기 {parkedCount}</button>
            )}
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {sortedRows.map((r) => {
              const down = !!parked[r.key];
              const wrap = (inner) => (
                <SwipeRow key={r.key} down={down} enabled={canPark(r)}
                  onPark={() => setParked((p) => ({ ...p, [r.key]: true }))}
                  onUnpark={() => setParked((p) => { const q = { ...p }; delete q[r.key]; return q; })}>{inner}</SwipeRow>
              );
              if (r.kind === "equip") return wrap(
                <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-extrabold tabular-nums" style={{ color: PRIMARY }}>{r.start}</span>
                    <span className="truncate text-xs" style={{ color: SUB }}>그룹</span>
                    <span className="ml-auto rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: r.done ? GOOD_S : TINT, color: r.done ? GOOD : PRIMARY }}>{r.done ? "완료" : "예정"}</span>
                  </div>
                  <p className="mt-1 truncate text-base font-extrabold" style={{ color: INK }}>{r.equip || "기구 미선택"} 그룹</p>
                  <p className="mt-1.5 text-xs" style={{ color: INK2, minHeight: 26 }}>{r.done ? "이달 누적에 반영되었습니다" : "수업을 마치면 완료로 표시해 주세요"}</p>
                  <div className="mt-2 flex gap-1.5">
                    {r.done
                      ? <button onClick={() => onGroupDone && onGroupDone(r.sid, false)} className="flex-1 rounded-lg py-1.5 text-xs font-extrabold" style={{ backgroundColor: GOOD_S, color: GOOD }}>완료 취소</button>
                      : <button onClick={() => onGroupDone && onGroupDone(r.sid, true)} className="flex-1 rounded-lg py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: GOOD }}>진행 완료</button>}
                    <button onClick={() => setEditing(r.s)} aria-label="수업 수정" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white" style={{ color: SUB }}><Pencil size={13} /></button>
                  </div>
                </div>
              );
              const m = memberOf(r.id);
              const rest = m ? left(m) : 0;
              const lastD = m ? lastDoneOf(db.schedule, m.id) : null;
              const idle = lastD ? Math.max(0, -dday(lastD)) : null;
              const st = stOf(r.status);
              const notes = (m?.notes || []).filter((x) => x && x.body).sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1));
              const lastNote = notes.find((x) => x.date !== T0) || null;
              const written = notes.some((x) => x.date === T0);
              return wrap(
                <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-extrabold tabular-nums" style={{ color: PRIMARY }}>{r.start}</span>
                    <span className="truncate text-xs" style={{ color: SUB }}>{r.type}</span>
                    {canPark(r) && <ChevronLeft size={13} className="ml-auto shrink-0" style={{ color: down ? GOOD : PRIMARY, opacity: 0.75 }} />}
                    <button onClick={() => setEditing(r.s)} aria-label="수업 수정" className={`${canPark(r) ? "" : "ml-auto "}flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white`} style={{ color: SUB }}><Pencil size={12} /></button>
                  </div>
                  <button onClick={() => onOpenMember && onOpenMember(r.id)} className="mt-1 block w-full truncate text-left text-base font-extrabold" style={{ color: INK }}>
                    {m ? (m.name || "이름 미입력") : "삭제된 회원"}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-xs font-bold tabular-nums" style={{ color: rest <= 3 ? BAD : SUB }}>잔여 {rest}회</span>
                    {r.deductFrom && <span className="rounded-full px-1.5 py-0.5 text-xs font-extrabold" style={{ backgroundColor: CARD, color: SUB }}>{r.deductFrom} −1회</span>}
                    {idle !== null && idle >= 3 && (
                      <span className="rounded-full px-1.5 py-0.5 text-xs font-extrabold" style={{ backgroundColor: `${idle >= 5 ? BAD : WARN}14`, color: idle >= 5 ? BAD : WARN }}>{restLabel(idle)}</span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-snug" style={{ color: INK2, minHeight: 26 }}>
                    {lastNote ? `지난 수업 · ${lastNote.body}` : "지난 기록이 없습니다"}
                  </p>
                  {r.status === "booked" ? (
                    <div className="mt-2 flex gap-1.5">
                      <button onClick={() => onStatus(r.sid, "done", r.id)} className="flex-1 rounded-lg py-2 text-xs font-extrabold text-white" style={{ backgroundColor: GOOD }}>출석</button>
                      <button onClick={() => onStatus(r.sid, "noshow", r.id)} className="flex-1 rounded-lg py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>노쇼</button>
                      <button onClick={() => onStatus(r.sid, "cancel", r.id)} className="flex-1 rounded-lg py-2 text-xs font-extrabold" style={{ backgroundColor: CARD, color: SUB }}>취소</button>
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ backgroundColor: st.bg }}>
                        <span className="text-xs font-extrabold" style={{ color: st.color }}>{st.label}</span>
                        {r.status === "noshow" && r.fee != null && (
                          <span className="text-xs font-bold" style={{ color: st.color, opacity: 0.85 }}>· {r.fee ? `${r.deductFrom || "정규"} 1회 차감` : "차감 안 함"}</span>
                        )}
                        {r.status === "cancel" && <span className="text-xs font-bold" style={{ color: st.color, opacity: 0.85 }}>· 차감 없음</span>}
                        {r.status === "done" && written && <span className="text-xs font-bold" style={{ color: st.color, opacity: 0.85 }}>· 기록 완료</span>}
                        <button onClick={() => onStatus(r.sid, "booked", r.id)} className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-bold" style={{ color: SUB }}>다시 고르기</button>
                      </div>
                      {r.status === "done" && !written && (
                        <div className="mt-1.5 flex gap-1.5">
                          <button onClick={() => onWriteNote && onWriteNote(r.id)} className="flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}><Pencil size={12} /> 기록하기</button>
                          <button onClick={() => onNoComment && onNoComment(r.id, r.type)} className="flex-1 rounded-lg py-2 text-xs font-bold" style={{ backgroundColor: CARD, color: SUB }}>노코멘트</button>
                        </div>
                      )}
                      {r.status === "noshow" && r.fee == null && (
                        <div className="mt-1.5 flex gap-1.5">
                          <button onClick={() => onNoshowFee(r.sid, true, r.id)} className="flex-1 rounded-lg py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>1회 차감</button>
                          <button onClick={() => onNoshowFee(r.sid, false, r.id)} className="flex-1 rounded-lg py-2 text-xs font-bold" style={{ backgroundColor: CARD, color: SUB }}>차감 안 함</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <button onClick={() => step(-1)} className="rounded-xl p-2" style={{ backgroundColor: CANVAS }}><ChevronLeft size={16} style={{ color: SUB }} /></button>
          <button onClick={() => setCursor(todayISO())} aria-label="오늘 날짜로 이동" className="min-w-0 flex-1 text-center">
            <p className="text-sm font-extrabold" style={{ color: INK }}>
              {mode === "day" ? `${ymd(cursor)} (${dow(cursor)})` : mode === "week" ? `${md(week[0])} ~ ${md(week[6])}` : monthLabel(cursor)}
            </p>
          </button>
          <button onClick={() => step(1)} className="rounded-xl p-2" style={{ backgroundColor: CANVAS }}><ChevronRight size={16} style={{ color: SUB }} /></button>
        </div>
        <div className="mt-3 flex gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
          {[{ k: "day", l: "일간" }, { k: "week", l: "주간" }, { k: "month", l: "월간" }].map((o) => (
            <button key={o.k} onClick={() => setMode(o.k)} className="flex-1 rounded-xl py-2 text-xs font-bold"
              style={mode === o.k ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{o.l}</button>
          ))}
        </div>
        <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} style={{ touchAction: "pan-y", overflow: "hidden" }} className="mt-3">
          {mode !== "month" ? (
            <div className="flex gap-1.5" style={slide}>
              {week.map((d) => {
                const n = byDate(d).length, on = d === cursor;
                return (
                  <button key={d} onClick={() => { setCursor(d); setMode("day"); }} className="min-w-0 flex-1 rounded-2xl px-1 py-2 text-center"
                    style={on ? { backgroundColor: BRAND } : { backgroundColor: CANVAS }}>
                    <p className="text-xs font-bold" style={{ color: on ? "#fff" : SUB }}>{dow(d)}</p>
                    <p className="text-sm font-extrabold tabular-nums" style={{ color: on ? "#fff" : d === todayISO() ? PRIMARY : INK }}>{d.slice(8, 10)}</p>
                    <p className="text-xs font-bold tabular-nums" style={{ color: on ? "#fff" : n ? PRIMARY : FAINT }}>{n || "-"}</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={slide}>
              <div className="grid grid-cols-7 gap-1">
                {["월", "화", "수", "목", "금", "토", "일"].map((w) => (
                  <p key={w} className="py-1 text-center text-xs font-bold" style={{ color: SUB }}>{w}</p>
                ))}
                {monthGrid(cursor).map((d) => {
                  const out = monthKey(d) !== ym;
                  const n = byDate(d).length;
                  const today = d === todayISO();
                  return (
                    <button key={d} onClick={() => { setCursor(d); setMode("day"); }}
                      className="rounded-xl py-1.5 text-center" style={{ backgroundColor: today ? PRIMARY : n ? TINT : "transparent", opacity: out ? 0.28 : 1 }}>
                      <p className="text-xs font-extrabold tabular-nums" style={{ color: today ? "#fff" : INK }}>{Number(d.slice(8, 10))}</p>
                      <p className="text-xs font-bold tabular-nums" style={{ color: today ? "#fff" : n ? PRIMARY : "transparent" }}>{n || "0"}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <p className="mt-1.5 text-center text-xs" style={{ color: FAINT }}>← 옆으로 밀어 {mode === "month" ? "달" : "주"} 이동 →</p>
        <button onClick={() => setEditing({ id: null, memberIds: db.members[0] ? [db.members[0].id] : [], date: cursor, start: "10:00", dur: 50, type: "개인레슨", instructor: db.settings.staff, room: "", memo: "" })}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}>
          <Plus size={16} /> 수업 등록
        </button>
        <WeekGrid days={byDate(week[6]).length ? week : week.slice(0, 6)} byDate={byDate} nameOf={nameOf} cursor={cursor}
          onOpen={(s) => setEditing(s)}
          onNew={(date, start) => setEditing({ id: null, memberIds: [], date, start, dur: 50, type: "개인레슨", instructor: db.settings.staff, room: "", memo: "" })} />
      </Card>

      {mode === "day" && !(cursor === T0 && byDate(cursor).length > 0) && (
        <Card className="space-y-2 p-4">
          {byDate(cursor).length === 0
            ? <div className="py-8 text-center"><Clock size={20} className="mx-auto" style={{ color: FAINT }} /><Sub className="mt-2">등록된 수업이 없습니다.</Sub></div>
            : byDate(cursor).map((s) => <SchedItem key={s.id} s={s} {...itemProps} />)}
        </Card>
      )}
      {mode === "week" && (
        <div className="space-y-3">
          {week.map((d) => {
            const items = byDate(d);
            return (
              <Card key={d} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-extrabold" style={{ color: d === todayISO() ? PRIMARY : INK }}>{md(d)} ({dow(d)}) {d === todayISO() && "· 오늘"}</p>
                  <Sub>{items.length}수업 · {seatsOn(d)}명</Sub>
                </div>
                <div className="mt-2 space-y-2">{items.length === 0 ? <Sub>수업 없음</Sub> : items.map((s) => <SchedItem key={s.id} s={s} {...itemProps} />)}</div>
              </Card>
            );
          })}
        </div>
      )}
      {mode === "month" && (
        <Card className="p-4">
          <h3 className="font-extrabold" style={{ color: INK }}>{monthLabel(cursor)} 일별 수업</h3>
          <div className="mt-3 space-y-1.5">
            {monthGrid(cursor).filter((d) => monthKey(d) === ym && byDate(d).length).map((d) => (
              <button key={d} onClick={() => { setCursor(d); setMode("day"); }} className="flex w-full items-center gap-2 rounded-2xl p-3 text-left" style={{ backgroundColor: CANVAS }}>
                <span className="w-16 text-xs font-extrabold tabular-nums" style={{ color: d === todayISO() ? PRIMARY : INK }}>{md(d)} ({dow(d)})</span>
                <span className="min-w-0 flex-1 truncate text-xs" style={{ color: SUB }}>
                  {byDate(d).map((s) => `${s.start} ${isEquipGroup(s) ? `그룹 ${s.equip || ""}` : attendeesOf(s).length > 1 ? `${s.type} ${attendeesOf(s).length}명` : nameOf(attendeesOf(s)[0]?.memberId)}`).join(" · ")}
                </span>
                <span className="rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>{byDate(d).length}</span>
              </button>
            ))}
            {stat.cls === 0 && <Sub className="py-6 text-center">이 달에는 등록된 수업이 없습니다.</Sub>}
          </div>
        </Card>
      )}
      {editing && <ScheduleForm draft={editing} members={db.members} onClose={() => setEditing(null)}
        onSubmit={(v) => { onSave(v); setEditing(null); }} onDelete={(id) => { onDelete(id); setEditing(null); }} />}
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
          <span className="text-xs font-extrabold" style={{ color: down ? GOOD : PRIMARY }}>{down ? "다시 위로" : "맨 아래로"}</span>
        </div>
      )}
      <div ref={box} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        style={{ touchAction: "pan-y", willChange: "transform" }}>
        {children}
      </div>
    </div>
  );
}

const GRID_H0 = 8, GRID_H1 = 23, GRID_ROW = 44;
const minOf = (hhmm) => Number(String(hhmm || "0:00").slice(0, 2)) * 60 + Number(String(hhmm || "0:00").slice(3, 5) || 0);
const hourLabel = (h) => `${String(h).padStart(2, "0")}시`;

function WeekGrid({ days, byDate, nameOf, cursor, onOpen, onNew }) {
  const rows = GRID_H1 - GRID_H0 + 1;
  const top0 = GRID_H0 * 60;
  const blocksOf = (d) => byDate(d).filter((s) => {
    const a = minOf(s.start), b = minOf(s.end) || a + 50;
    return b > top0 && a < (GRID_H1 + 1) * 60;
  }).map((s) => {
    const st = Math.max(minOf(s.start), top0);
    const en = Math.min(minOf(s.end) || st + 50, (GRID_H1 + 1) * 60);
    const eq = isEquipGroup(s);
    const list = attendeesOf(s);
    const label = eq ? (s.equip || "그룹") : list.length > 1 ? `${s.type} ${list.length}명` : nameOf(list[0]?.memberId);
    const done = eq ? !!s.groupDone : list.length > 0 && list.every((a) => a.status !== "booked");
    return { s, top: ((st - top0) / 60) * GRID_ROW, h: Math.max(20, ((en - st) / 60) * GRID_ROW - 2), label, done, eq };
  }).filter((b) => b.top >= -GRID_ROW && b.top < rows * GRID_ROW);

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <CalendarDays size={13} style={{ color: PRIMARY }} />
        <p className="text-xs font-extrabold" style={{ color: INK }}>주간 시간표</p>
        <Sub className="ml-auto">08:00 ~ 23:00 · 빈 칸을 누르면 등록</Sub>
      </div>
      <div className="overflow-x-auto rounded-2xl" style={{ border: `1px solid ${LINE}` }}>
        <div style={{ minWidth: 460 }}>
          <div className="sticky top-0 z-10 flex" style={{ backgroundColor: CARD, borderBottom: `1px solid ${LINE}` }}>
            <div className="shrink-0" style={{ width: 40 }} />
            {days.map((d) => {
              const today = d === todayISO(), on = d === cursor;
              return (
                <div key={d} className="min-w-0 flex-1 py-1.5 text-center" style={{ borderLeft: `1px solid ${LINE}`, backgroundColor: today ? TINT : "transparent" }}>
                  <p className="text-xs font-bold" style={{ color: today ? PRIMARY : SUB }}>{dow(d)}</p>
                  <p className="text-xs font-extrabold tabular-nums" style={{ color: today ? PRIMARY : on ? INK : SUB }}>{Number(d.slice(8, 10))}</p>
                </div>
              );
            })}
          </div>
          <div className="relative flex">
            <div className="shrink-0" style={{ width: 40 }}>
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex items-start justify-end pr-1 pt-0.5" style={{ height: GRID_ROW, borderTop: i ? `1px solid ${LINE}` : "none" }}>
                  <span className="text-xs font-bold tabular-nums" style={{ color: FAINT, fontSize: 10 }}>{hourLabel(GRID_H0 + i)}</span>
                </div>
              ))}
            </div>
            {days.map((d) => (
              <div key={d} className="relative min-w-0 flex-1" style={{ borderLeft: `1px solid ${LINE}`, backgroundColor: d === todayISO() ? `${PRIMARY}0A` : "transparent" }}>
                {Array.from({ length: rows }, (_, i) => (
                  <button key={i} onClick={() => onNew(d, `${String(GRID_H0 + i).padStart(2, "0")}:00`)}
                    aria-label={`${md(d)} ${GRID_H0 + i}시 수업 등록`}
                    className="block w-full" style={{ height: GRID_ROW, borderTop: i ? `1px solid ${LINE}` : "none" }} />
                ))}
                {blocksOf(d).map((b) => (
                  <button key={b.s.id} onClick={() => onOpen(b.s)}
                    className="absolute left-0.5 right-0.5 overflow-hidden rounded-lg px-1 py-0.5 text-left"
                    style={{ top: b.top, height: b.h, background: b.done ? GOOD_S : GRAD, border: b.done ? `1px solid ${GOOD}` : "none" }}>
                    <p className="truncate text-xs font-extrabold tabular-nums" style={{ color: b.done ? GOOD : "#fff", fontSize: 10 }}>{b.s.start}</p>
                    <p className="truncate text-xs font-bold" style={{ color: b.done ? GOOD : "#fff", fontSize: 10 }}>{b.label}</p>
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

function ScheduleForm({ draft, members, onClose, onSubmit, onDelete }) {
  const initType = CLASS_TYPES.includes(draft.type) ? draft.type : (attendeesOf(draft).length >= 2 ? "듀엣" : "개인레슨");
  const [del, setDel] = useState(false);
  const [f, setF] = useState({
    ...draft,
    type: initType,
    equip: draft.equip || "",
    memberIds: draft.memberIds || attendeesOf(draft).map((a) => a.memberId).filter(Boolean),
    dur: draft.dur || (draft.start && draft.end
      ? Number(draft.end.slice(0, 2)) * 60 + Number(draft.end.slice(3)) - Number(draft.start.slice(0, 2)) * 60 - Number(draft.start.slice(3)) : 50),
  });
  const isGroup = f.type === "그룹";
  const isDuet = f.type === "듀엣";
  const pick = (id) => setF((x) => ({ ...x, memberIds: id ? [id] : [] }));
  const pickAt = (slot, id) => setF((x) => {
    const a = x.memberIds[0] || "", b = x.memberIds[1] || "";
    let next = slot === 0 ? [id, b] : [a, id];
    if (id && next[0] === next[1]) next[slot === 0 ? 1 : 0] = "";
    return { ...x, memberIds: next.filter(Boolean) };
  });
  const slotVal = (slot) => (f.memberIds[slot] || "");
  const ready = f.date && f.start && (isGroup ? !!f.equip : f.memberIds.length > 0);

  return (
    <Sheet title={draft.id ? "수업 수정" : "수업 등록"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="레슨 유형">
          <div className="flex gap-1.5">
            {CLASS_TYPES.map((t) => (
              <button key={t} onClick={() => setF((x) => ({ ...x, type: t, memberIds: t === "개인레슨" ? x.memberIds.slice(0, 1) : x.memberIds }))}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                style={f.type === t ? { backgroundColor: BRAND, color: "#fff" } : { backgroundColor: CANVAS, color: SUB }}>{t}</button>
            ))}
          </div>
        </Field>
        {isGroup ? (
          <Field label="수업 기구" hint="그룹은 회원 대신 기구를 선택합니다">
            <div className="grid grid-cols-4 gap-1.5">
              {EQUIP_TYPES.map((t) => (
                <button key={t} onClick={() => setF({ ...f, equip: t })} className="rounded-xl py-2.5 text-sm font-bold"
                  style={f.equip === t ? { backgroundColor: BRAND, color: "#fff" } : { backgroundColor: CANVAS, color: SUB }}>{t}</button>
              ))}
            </div>
          </Field>
        ) : isDuet ? (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((slot) => (
              <Field key={slot} label={`회원 ${slot + 1}`} hint={slot === 1 ? "선택" : ""}>
                <SelectBox value={slotVal(slot)} onChange={(e) => pickAt(slot, e.target.value)}>
                  <option value="">{slot === 0 ? "회원 선택" : "선택 안 함"}</option>
                  {members.filter((m) => m.id === slotVal(slot) || m.id !== slotVal(slot === 0 ? 1 : 0))
                    .map((m) => <option key={m.id} value={m.id}>{m.name || "이름 미입력"}{isEnded(m) ? " (종료)" : ""} · 잔여 {left(m)}회</option>)}
                </SelectBox>
              </Field>
            ))}
          </div>
        ) : (
          <Field label="회원">
            <SelectBox value={f.memberIds[0] || ""} onChange={(e) => pick(e.target.value)}>
              <option value="">회원 선택</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name || "이름 미입력"}{isEnded(m) ? " (종료)" : ""} · 잔여 {left(m)}회</option>)}
            </SelectBox>
          </Field>
        )}
        <Field label="날짜"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} /></Field>
        <Field label="시작 시간" hint={`${f.start} 시작 · ${to12(f.start).ap === "AM" ? "오전" : "오후"} ${to12(f.start).h12}시`}>
          <TimePick value={f.start} onChange={(v) => setF({ ...f, start: v })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="소요 시간">
            <SelectBox value={f.dur} onChange={(e) => setF({ ...f, dur: Number(e.target.value) })}>
              {[30, 50, 60, 80].map((d) => <option key={d} value={d}>{d}분</option>)}
            </SelectBox>
          </Field>
          <Field label="담당 강사"><input value={f.instructor} onChange={(e) => setF({ ...f, instructor: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="룸" hint="선택"><input value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} className={inputCls} /></Field>
          <Field label="메모" hint="선택"><input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} className={inputCls} /></Field>
        </div>
        <PrimaryBtn disabled={!ready} onClick={() => {
          const prev = draft.id ? attendeesOf(draft) : [];
          onSubmit({
            id: draft.id || uid(), date: f.date, start: f.start, end: addMin(f.start, f.dur),
            type: f.type, instructor: f.instructor, room: f.room, memo: f.memo,
            equip: isGroup ? f.equip : null,
            groupDone: isGroup ? !!draft.groupDone : undefined,
            attendees: isGroup ? [] : f.memberIds.map((id) => prev.find((a) => a.memberId === id) || { memberId: id, status: "booked", deductFrom: null, noshowFee: null }),
          });
        }}>
          <Check size={16} /> {draft.id ? "수정 저장" : `수업 등록${isDuet && f.memberIds.length > 1 ? ` (${f.memberIds.length}명)` : ""}`}
        </PrimaryBtn>
        {draft.id && onDelete && (del ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl p-3" style={{ backgroundColor: BAD_S }}>
            <AlertTriangle size={14} style={{ color: BAD }} />
            <span className="text-xs font-bold" style={{ color: INK }}>이 수업을 삭제할까요? 차감된 횟수는 되돌아갑니다.</span>
            <button onClick={() => { onDelete(draft.id); onClose(); }} className="rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: BAD }}>삭제</button>
            <button onClick={() => setDel(false)} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold" style={{ color: SUB }}>취소</button>
          </div>
        ) : (
          <button onClick={() => setDel(true)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
            <Trash2 size={14} /> 수업 삭제
          </button>
        ))}
      </div>
    </Sheet>
  );
}
const PEN_COLORS = ["#F04438", "#12B76A", "#6C4CF1", "#FFFFFF", "#111111"];
function coverDraw(ctx, img, w, h, tf) {
  const base = Math.max(w / img.width, h / img.height);
  const s = base * (tf?.scale || 1);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2 + ((tf?.x || 0) / 100) * w, (h - dh) / 2 + ((tf?.y || 0) / 100) * h, dw, dh);
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
function PostureCanvas({ photo, label, onClose, onSave, onToast }) {
  const wrapRef = useRef(null), canvasRef = useRef(null), imgRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [marks, setMarks] = useState(photo.marks || []);
  const [draft, setDraft] = useState(null);
  const [tool, setTool] = useState("angle");
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(3);
  const [grid, setGrid] = useState(true);
  const [part, setPart] = useState("어깨");
  const [mirror, setMirror] = useState(false);
  const [shot, setShot] = useState(null);

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

  const drawMark = (ctx, m, w, h) => {
    const P = (p) => ({ x: p.x * w, y: p.y * h });
    ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = m.width;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
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
      ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(cx - tw / 2 - 6, cy - 14, tw + 12, 20);
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(m.label || "", cx, cy);
    }
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
      ctx.strokeStyle = "rgba(108,76,241,0.9)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke(); ctx.restore();
    }
    marks.forEach((m) => drawMark(ctx, m, w, h));
    if (draft) drawMark(ctx, draft, w, h);
  }, [marks, draft, grid, photo, size]);
  useEffect(() => { draw(); }, [draw]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const down = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pos(e);
    if (tool === "hline" || tool === "vline") { setDraft({ id: uid(), tool, color, width, pts: [p] }); return; }
    setDraft({ id: uid(), tool, color, width, pts: [p, p], label: "" });
  };
  const move = (e) => {
    if (!draft) return;
    const p = pos(e);
    setDraft((d) => {
      if (!d) return d;
      if (d.tool === "hline" || d.tool === "vline") return { ...d, pts: [p] };
      if (d.tool === "pen") return { ...d, pts: [...d.pts, p] };
      return { ...d, pts: [d.pts[0], p], label: d.tool === "angle" ? angleLabel(part, angleOf(d.pts[0], p), mirror) : "" };
    });
  };
  const up = () => {
    if (!draft) return;
    const d = draft; setDraft(null);
    if (d.tool === "hline" || d.tool === "vline") { setMarks((m) => [...m, d]); return; }
    if (d.tool !== "pen" && Math.hypot(d.pts[1].x - d.pts[0].x, d.pts[1].y - d.pts[0].y) < 0.02) return;
    const deg = angleOf(d.pts[0], d.pts[1]);
    setMarks((m) => [...m, d.tool === "angle" ? { ...d, angle: deg, label: angleLabel(part, deg, mirror) } : d]);
  };
  const download = async () => {
    const ok = await shareCanvas(canvasRef.current, `체형분석_${label}_${todayISO()}.jpg`, "체형 분석", onToast);
    if (!ok) { try { setShot(canvasRef.current.toDataURL("image/jpeg", 0.92)); } catch (e) {} }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-photo">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
        <p className="text-sm font-bold text-white">체형 분석 · {label}</p>
        <button onClick={() => { onSave(marks); onClose(); }} className="rounded-full px-4 py-2 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}>저장</button>
      </div>
      <div className="flex-1 px-3">
        <div ref={wrapRef} className="relative mx-auto h-full w-full overflow-hidden rounded-2xl" style={{ maxWidth: "min(100%, 720px)" }}>
          <canvas ref={canvasRef} className="absolute inset-0 touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        </div>
      </div>
      <div className="space-y-2 px-3 pb-5 pt-3">
        <div className="flex gap-1.5 overflow-x-auto">
          {[{ k: "angle", l: "각도" }, { k: "line", l: "직선" }, { k: "pen", l: "펜" }, { k: "hline", l: "수평선" }, { k: "vline", l: "수직선" }].map((t) => (
            <button key={t.k} onClick={() => setTool(t.k)} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold"
              style={tool === t.k ? { backgroundColor: BRAND, color: "#fff" } : { backgroundColor: "rgba(255,255,255,0.15)", color: "#fff" }}>{t.l}</button>
          ))}
          <button onClick={() => setGrid((g) => !g)} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold"
            style={{ backgroundColor: grid ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.15)", color: grid ? INK : "#fff" }}>격자</button>
        </div>
        {(tool === "hline" || tool === "vline") && (
          <p className="text-xs font-semibold text-white opacity-80">화면을 누른 채로 위치를 옮기고, 손을 떼면 선이 그려집니다.</p>
        )}
        {tool === "angle" && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {["어깨", "골반", "무릎", "귀-어깨"].map((p) => (
              <button key={p} onClick={() => setPart(p)} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold"
                style={part === p ? { backgroundColor: CARD, color: INK } : { backgroundColor: "rgba(255,255,255,0.15)", color: "#fff" }}>{p}</button>
            ))}
            <button onClick={() => setMirror((v) => !v)} className="ml-auto whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold"
              style={{ backgroundColor: mirror ? PRIMARY : "rgba(255,255,255,0.15)", color: "#fff" }}>좌우 기준: {mirror ? "회원" : "화면"}</button>
          </div>
        )}
        <div className="flex items-center gap-2">
          {PEN_COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className="h-7 w-7 rounded-full"
              style={{ backgroundColor: c, border: color === c ? `3px solid ${PRIMARY}` : "2px solid rgba(255,255,255,0.4)" }} />
          ))}
          <input type="range" min="1" max="10" value={width} onChange={(e) => setWidth(Number(e.target.value))} className="ml-2 flex-1" style={{ accentColor: PRIMARY }} />
          <span className="w-6 text-center text-xs font-bold text-white">{width}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMarks((m) => m.slice(0, -1))} className="flex flex-1 items-center justify-center gap-1 rounded-2xl py-2.5 text-xs font-bold text-white" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><RotateCcw size={13} /> 뒤로</button>
          <button onClick={() => setMarks([])} className="flex flex-1 items-center justify-center gap-1 rounded-2xl py-2.5 text-xs font-bold text-white" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><Trash2 size={13} /> 전체 지우기</button>
          <button onClick={download} className="flex flex-1 items-center justify-center gap-1 rounded-2xl py-2.5 text-xs font-bold text-white" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><Download size={13} /> 공유</button>
        </div>
        <p className="text-center text-xs text-white opacity-60">
          {tool === "angle" ? "양쪽 어깨(또는 골반) 지점을 드래그하면 각도가 표시됩니다" : "화면을 드래그해 그리세요"}
        </p>
      </div>
      {shot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ backgroundColor: "rgba(0,0,0,0.85)" }} onClick={() => setShot(null)}>
          <div className="text-center">
            <img src={shot} alt="분석 결과" className="mx-auto rounded-2xl" style={{ maxHeight: "70vh" }} />
            <p className="mt-3 text-xs text-white opacity-70">자동 저장이 막힌 기기에서는 이미지를 길게 눌러 저장하세요</p>
          </div>
        </div>
      )}
    </div>
  );
}
function MemberList({ members, selectedId, onSelect, onAdd, onOpenFav, favCount, schedule }) {
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState("active");
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
  const activeCount = members.filter((m) => isActive(m)).length;
  const holdCount = members.filter((m) => isHold(m)).length;
  const endedCount = members.filter((m) => isEnded(m)).length;
  const filtered = members
    .filter((m) => (seg === "ended" ? isEnded(m) : seg === "hold" ? isHold(m) : isActive(m)))
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
    });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-3.5" style={{ color: SUB }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회원명 · 목표 · 강사 검색" className="w-full rounded-2xl border-0 bg-white py-3 pl-11 pr-4 text-sm outline-none" style={{ boxShadow: SHADOW }} />
        </div>
        <button onClick={onAdd} className="flex items-center gap-1 rounded-2xl px-4 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}><UserPlus size={16} /> 추가</button>
      </div>
      {todayCount > 0 && (
        <button onClick={() => setTodayOnly((v) => !v)} className="flex w-full items-center gap-2 rounded-2xl px-4 py-3"
          style={todayOnly ? { backgroundColor: BRAND, color: "#fff" } : { backgroundColor: CARD, color: INK, boxShadow: SHADOW }}>
          <Calendar size={15} style={{ color: todayOnly ? "#fff" : PRIMARY }} />
          <span className="text-sm font-extrabold">오늘 수업 회원 {todayCount}명</span>
          <span className="ml-auto text-xs font-bold" style={{ color: todayOnly ? "rgba(255,255,255,0.8)" : SUB }}>
            {todayOnly ? "전체 보기" : "이 회원만 보기"}
          </span>
        </button>
      )}
      <div className="flex items-center gap-1.5">
        <div className="flex flex-1 gap-1 rounded-2xl bg-white p-1" style={{ boxShadow: SHADOW }}>
          {[{ k: "active", l: "진행중", n: activeCount, c: PRIMARY }, { k: "hold", l: "홀딩", n: holdCount, c: WARN }, { k: "ended", l: "종료", n: endedCount, c: INK }].map((o) => (
            <button key={o.k} onClick={() => setSeg(o.k)} className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold"
              style={seg === o.k ? { backgroundColor: o.c, color: "#fff" } : { color: SUB }}>
              {o.l} <span className="tabular-nums">{o.n}</span>
            </button>
          ))}
        </div>
        <button onClick={onOpenFav} className="flex items-center gap-1 rounded-2xl bg-white px-3 py-2.5 text-xs font-bold" style={{ color: favCount ? WARN : SUB, boxShadow: SHADOW }}>
          <Star size={14} fill={favCount ? WARN : "none"} /> 즐겨찾기 {favCount || 0}
        </button>
      </div>
      {filtered.length > 1 && (
        <button onClick={() => setSortBy((s) => (s === "default" ? "leftDesc" : s === "leftDesc" ? "leftAsc" : "default"))}
          className="flex w-full items-center gap-2 rounded-2xl px-4 py-2.5"
          style={sortBy === "default" ? { backgroundColor: CARD, boxShadow: SHADOW } : { backgroundColor: TINT }}>
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
                {seg === "ended" ? "종료 처리된 회원이 없습니다." : seg === "hold" ? "홀딩 중인 회원이 없습니다." : "진행중인 회원이 없습니다."}
              </p>
              <Sub className="mt-1">다른 상태에 회원이 있습니다. 눌러서 이동하세요.</Sub>
              <div className="mt-3 flex justify-center gap-1.5">
                {[{ k: "active", l: "진행중", n: activeCount }, { k: "hold", l: "홀딩", n: holdCount }, { k: "ended", l: "종료", n: endedCount }]
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
          <button key={m.id} onClick={() => onSelect(m.id)} className="w-full rounded-3xl bg-white p-4 text-left" style={{ boxShadow: on ? `0 0 0 2px ${PRIMARY}, ${SHADOW}` : SHADOW }}>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-extrabold" style={{ backgroundColor: TINT, color: PRIMARY }}>{(m.name || "?").slice(0, 1)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold" style={{ color: INK }}>{m.name || "이름 미입력"} {m.age ? <span className="text-xs font-medium" style={{ color: SUB }}>{m.age}세</span> : null}</p>
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
function ChangeSummary({ member, onGo }) {
  const rec = inbodyOf(member);
  const n = rec.length;
  if (n === 0)
    return (
      <button onClick={onGo} className="w-full rounded-3xl p-5 text-left" style={{ background: GRAD, boxShadow: SHADOW }}>
        <p className="text-sm font-extrabold text-white">첫 인바디 측정값을 입력해 주세요</p>
        <p className="mt-1 text-xs text-white opacity-70">기록 탭 → 인바디에서 등록하면 여기에 변화가 표시됩니다</p>
      </button>
    );
  const first = rec[0], last = rec[n - 1];
  return (
    <div className="rounded-3xl p-5" style={{ backgroundColor: BRAND, boxShadow: SHADOW }}>
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
            <div key={m.key} className="rounded-2xl p-3" style={{ backgroundColor: "rgba(255,255,255,0.12)" }}>
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
function AlignSheet({ src, ghost, init, title, onSave, onCancel }) {
  const [x, setX] = useState(num(init?.x) || 0), [y, setY] = useState(num(init?.y) || 0);
  const [scale, setScale] = useState(num(init?.scale) || 1), [op, setOp] = useState(45);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-photo">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onCancel} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
        <p className="text-sm font-bold text-white">{title || "중심선 맞추기"}</p>
        <button onClick={() => onSave({ x, y, scale })} className="rounded-full px-4 py-2 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}>저장</button>
      </div>
      <div className="flex-1 px-4">
        <div className="relative mx-auto h-full overflow-hidden rounded-2xl bg-photo" style={{ maxWidth: "min(100%, 720px)" }}>
          <img src={src} alt="촬영본" className="absolute inset-0 h-full w-full object-cover" style={{ transform: `translate(${x}%, ${y}%) scale(${scale})` }} />
          {ghost && <img src={ghost.src} alt="이전" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: op / 100, transform: ptf(ghost) }} />}
          <GuideOverlay strong />
        </div>
      </div>
      <div className="space-y-2 px-4 pb-6 pt-3">
        {[{ l: "좌 · 우", v: x, set: setX, min: -40, max: 40, step: 1 },
          { l: "위 · 아래", v: y, set: setY, min: -40, max: 40, step: 1 },
          { l: "확대", v: scale, set: setScale, min: 0.6, max: 2, step: 0.02 }].map((s) => (
          <div key={s.l} className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs font-bold text-white opacity-70">{s.l}</span>
            <input type="range" min={s.min} max={s.max} step={s.step} value={s.v} onChange={(e) => s.set(Number(e.target.value))} className="w-full" style={{ accentColor: PRIMARY }} />
          </div>
        ))}
        {ghost && (
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs font-bold text-white opacity-70">이전 사진</span>
            <input type="range" min="0" max="80" value={op} onChange={(e) => setOp(Number(e.target.value))} className="w-full" style={{ accentColor: PRIMARY }} />
          </div>
        )}
      </div>
    </div>
  );
}
function Shot({ p, label, guides }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-photo" style={{ aspectRatio: "3 / 4" }}>
      <img src={p.src} alt={label} className="absolute inset-0 h-full w-full object-cover" style={{ transform: ptf(p) }} />
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

function PhotoCompare({ member, photos, briefing, onSavePhoto, onRemove, onSaveMarks, onAdjust, onToast }) {
  const [view, setView] = useState("front");
  const [mode, setMode] = useState("overlay");
  const [t, setT] = useState(100);
  const [guides, setGuides] = useState(true);
  const [pending, setPending] = useState(null);
  const [posture, setPosture] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const camRef = useRef(null), albumRef = useRef(null), slotRef = useRef("after");
  const list = (photos?.[view] || []).filter((p) => p && p.src);
  const before = list[0] || null;
  const after = list.length > 1 ? list[list.length - 1] : null;
  const pick = async (file) => {
    if (!file) return;
    try {
      const blob = await fileToBlob(file);
      setPending({ blob, src: URL.createObjectURL(blob), slot: slotRef.current });
    } catch (e) { onToast && onToast({ ok: false, msg: "사진을 읽지 못했습니다." }); }
  };
  const closePending = () => setPending((p) => { if (p?.src) { try { URL.revokeObjectURL(p.src); } catch (e) {} } return null; });
  const open = (slot, ref) => { slotRef.current = slot; ref.current?.click(); };
  const onCam = (slot) => open(slot, camRef);
  const onAlbum = (slot) => open(slot, albumRef);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-extrabold" style={{ color: INK }}>AI 비포애프터 분석</h3><Sub>중심선 정렬 · 관절 각도 측정 · 회원 동의 후 촬영, 이 기기에만 저장</Sub></div>
        <div className="flex gap-1 rounded-full p-1" style={{ backgroundColor: CANVAS }}>
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)} className="rounded-full px-3 py-1.5 text-xs font-bold"
              style={view === v.key ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{v.label}</button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
        {[{ k: "overlay", l: "겹쳐 비교" }, { k: "side", l: "나란히 보기" }].map((o) => (
          <button key={o.k} onClick={() => setMode(o.k)} className="flex-1 rounded-xl py-2 text-xs font-bold"
            style={mode === o.k ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{o.l}</button>
        ))}
      </div>
      {mode === "overlay" && (
        <div className="mt-4">
          {before && after ? (
            <>
              <div className="relative overflow-hidden rounded-2xl bg-photo" style={{ aspectRatio: "3 / 4" }}>
                <img src={before.src} alt="비포" className="absolute inset-0 h-full w-full object-cover" style={{ transform: ptf(before) }} />
                <img src={after.src} alt="애프터" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: t / 100, transform: ptf(after) }} />
                {guides && <GuideOverlay />}
                <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-extrabold text-white" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
                  {t < 50 ? `BEFORE ${ymd(before.date)}` : `AFTER ${ymd(after.date)}`}
                </span>
              </div>
              <input type="range" min="0" max="100" value={t} onChange={(e) => setT(Number(e.target.value))} className="mt-3 w-full" style={{ accentColor: PRIMARY }} />
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold" style={{ color: t < 50 ? PRIMARY : SUB }}>비포 {ymd(before.date)}</span>
                <span className="text-xs font-extrabold tabular-nums" style={{ color: PRIMARY }}>{t}%</span>
                <span className="text-xs font-bold" style={{ color: t >= 50 ? PRIMARY : SUB }}>애프터 {ymd(after.date)}</span>
              </div>
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
            {before && after && <button onClick={() => shareBeforeAfter(before, after, member?.name, onToast)} className="ml-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}><Upload size={12} /> 회원에게 보내기</button>}
          </div>
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
      {pending && <AlignSheet src={pending.src} ghost={pending.slot === "after" ? before : after} onCancel={closePending} onSave={(tf) => { onSavePhoto(view, pending.blob, pending.slot, tf); closePending(); }} />}
      {adjust && (
        <AlignSheet src={adjust.p.src} init={adjust.p} title={`${adjust.label} 사진 조정`}
          ghost={adjust.p.id === before?.id ? after : before}
          onCancel={() => setAdjust(null)}
          onSave={(tf) => { onAdjust && onAdjust(view, adjust.p.id, tf); setAdjust(null); }} />
      )}
      {posture && <PostureCanvas photo={posture.p} label={posture.label} onToast={onToast} onClose={() => setPosture(null)} onSave={(marks) => onSaveMarks(view, posture.p.id, marks)} />}
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
            <button key={o.k} onClick={() => setTab(o.k)} className="flex-1 rounded-xl py-2.5 text-xs font-bold"
              style={tab === o.k ? { backgroundColor: CARD, color: o.k === "coach" ? INK : PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{o.l}</button>
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
      <img src={p.src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ transform: ptf(p) }} />
    </div>
  );
}
function SetViewer({ item, onClose, onToggleFav }) {
  const [t, setT] = useState(100);
  const [side, setSide] = useState(false);
  const { before, after, set, memberName } = item || {};
  if (!before || !after || !set) return null;
  const weeks = weeksBetween(before.date, after.date);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-photo">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}><X size={18} color="#fff" /></button>
        <p className="text-sm font-bold text-white">{memberName} · {VIEWS.find((v) => v.key === set.view)?.label} · {weeks}주</p>
        <button onClick={() => onToggleFav(set.id)} className="rounded-full p-2" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}>
          <Star size={18} color={set.fav ? WARN : "#fff"} fill={set.fav ? WARN : "none"} />
        </button>
      </div>
      <div className="flex-1 px-4">
        {side ? (
          <div className="mx-auto flex h-full gap-2" style={{ maxWidth: 520 }}>
            <SetThumb p={before} /><SetThumb p={after} />
          </div>
        ) : (
          <div className="relative mx-auto h-full overflow-hidden rounded-2xl bg-photo" style={{ maxWidth: "min(100%, 720px)" }}>
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
        {!side && <input type="range" min="0" max="100" value={t} onChange={(e) => setT(Number(e.target.value))} className="w-full" style={{ accentColor: PRIMARY }} />}
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
  const head = `[${view === "front" ? "정면" : "측면"} 체형 분석] `;
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
function PoseAnalyzer({ member, photos, onSavePose, onDeletePose, onToast }) {
  const [engine, setEngine] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState(null);
  const [pts, setPts] = useState(null);
  const [view, setView] = useState("front");
  const [mirror, setMirror] = useState(false);
  const [floorFix, setFloorFix] = useState(false);
  const [showSkel, setShowSkel] = useState(true);
  const [showNum, setShowNum] = useState(true);
  const [manual, setManual] = useState(null);
  const [faceDir, setFaceDir] = useState(1);
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(null);
  const canvasRef = useRef(null), imgRef = useRef(null), dragRef = useRef(null);
  const camRef = useRef(null), albumRef = useRef(null);
  const saved = (photos?.poses || []).filter((p) => p && p.metrics);

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
    if (mirror && view === "front") {
      ["ear", "sh", "hip", "knee", "ank", "el", "wr", "foot"].forEach((b) => {
        const L = b + "L", R = b + "R";
        if (P[L] || P[R]) { const t = P[L]; P[L] = P[R]; P[R] = t; }
      });
    }
    if (view === "side" && !P.nose) P.nose = { x: (P.ear?.x ?? 0.5) + faceDir * 0.05, y: P.ear?.y ?? 0.2, score: 1 };
    return analyzePose(P, { view, W: img.w, H: img.h, floorFix });
  }, [pts, img, view, mirror, floorFix, faceDir]);

  const draw = useCallback(() => {
    const c = canvasRef.current, im = imgRef.current;
    if (!c || !im || !img) return;
    c.width = img.w; c.height = img.h;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0, c.width, c.height);
    if (!pts) return;
    const S = (p) => ({ x: p.x * c.width, y: p.y * c.height });
    const bones = view === "front" ? BONES_FRONT : BONES_SIDE;
    const k = Math.max(1, c.width / 520);
    if (showSkel) {
      ctx.save(); ctx.setLineDash([8 * k, 8 * k]); ctx.lineWidth = 1.6 * k; ctx.strokeStyle = "rgba(255,255,255,.75)";
      const hline = (p) => { const q = S(p); ctx.beginPath(); ctx.moveTo(0, q.y); ctx.lineTo(c.width, q.y); ctx.stroke(); };
      const vline = (p) => { const q = S(p); ctx.beginPath(); ctx.moveTo(q.x, 0); ctx.lineTo(q.x, c.height); ctx.stroke(); };
      if (view === "front") {
        if (pts.shL && pts.shR) hline(midOf(pts.shL, pts.shR));
        if (pts.hipL && pts.hipR) hline(midOf(pts.hipL, pts.hipR));
        if (pts.ankL && pts.ankR) vline(midOf(pts.ankL, pts.ankR));
      } else if (pts.ank) vline(pts.ank);
      ctx.restore();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      bones.forEach(([a, b]) => {
        if (!pts[a] || !pts[b]) return;
        const p = S(pts[a]), q = S(pts[b]);
        const g = ctx.createLinearGradient(p.x, p.y, q.x, q.y);
        g.addColorStop(0, "#B8A6FF"); g.addColorStop(1, "#6C4CF1");
        ctx.save();
        ctx.strokeStyle = "rgba(108,76,241,.35)"; ctx.lineWidth = 9 * k;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.strokeStyle = g; ctx.lineWidth = 3.2 * k;
        ctx.shadowColor = "rgba(108,76,241,.55)"; ctx.shadowBlur = 10 * k;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.restore();
      });
      Object.keys(pts).forEach((key) => {
        const p = S(pts[key]);
        const on = hot === key;
        const r = (on ? 11 : 7) * k;
        ctx.save();
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6);
        halo.addColorStop(0, on ? "rgba(158,136,255,.45)" : "rgba(158,136,255,.26)");
        halo.addColorStop(1, "rgba(158,136,255,0)");
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2); ctx.fill();
        if (on) { ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.4 * k; ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2); ctx.stroke(); }
        ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 6 * k;
        ctx.fillStyle = "rgba(255,255,255,.98)"; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = "#6C4CF1"; ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.46, 0, Math.PI * 2); ctx.fill();
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
        ctx.strokeStyle = "#9E88FF"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,.92)"; ctx.lineWidth = 3; ctx.stroke();
        const name = jointName(hot, view);
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
  }, [img, pts, view, showSkel, showNum, res, hot]);
  useEffect(() => { draw(); }, [draw]);

  const pickFile = async (file) => {
    if (!file) return;
    setBusy(true); setPts(null);
    try {
      const src = await fileToThumb(file, 1000);
      const im = new window.Image();
      im.onload = async () => {
        imgRef.current = im;
        setImg({ src, w: im.naturalWidth, h: im.naturalHeight });
        const auto = await detect(im);
        setBusy(false);
        if (!auto) startManual();
      };
      im.onerror = () => { setBusy(false); onToast?.({ ok: false, msg: "사진을 읽지 못했습니다." }); };
      im.src = src;
    } catch (e) { setBusy(false); onToast?.({ ok: false, msg: "사진을 읽지 못했습니다." }); }
  };
  const detect = async (im) => {
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
      const shW = Math.abs(next.shL.x - next.shR.x);
      const torso = Math.abs((next.shL.y + next.shR.y) / 2 - (next.hipL.y + next.hipR.y) / 2) || 1;
      const isSide = shW / torso < 0.35;
      if (isSide) {
        const s = (a, b) => ((next[a]?.score ?? 0) >= (next[b]?.score ?? 0) ? next[a] : next[b]);
        next.ear = s("earL", "earR"); next.sh = s("shL", "shR"); next.hip = s("hipL", "hipR");
        next.knee = s("kneeL", "kneeR"); next.ank = s("ankL", "ankR");
        setView("side");
        setFaceDir(next.nose && next.sh ? (next.nose.x >= next.sh.x ? 1 : -1) : 1);
      } else setView("front");
      setPts(next); setManual(null); setEngine("ready");
      onToast?.({ ok: true, msg: `관절 ${Object.keys(next).length}개를 인식했습니다.` });
      return true;
    } catch (e) { setEngine("manual"); return false; }
  };
  const startManual = (v) => {
    const vv = v || view;
    setView(vv); setPts({});
    setManual({ seq: vv === "front" ? MANUAL_FRONT : MANUAL_SIDE, i: 0 });
  };
  const toNorm = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch (e) {} };
  const onDown = (e) => {
    if (!img) return;
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
    if (!dragRef.current) return;
    e.preventDefault?.();
    const n = toNorm(e);
    setPts((p) => ({ ...p, [dragRef.current]: { ...p[dragRef.current], x: n.x, y: n.y } }));
  };
  const onUp = () => { if (dragRef.current) buzz(4); dragRef.current = null; setHot(null); };
  const undoPoint = () => {
    if (!manual || manual.i === 0) return;
    const key = manual.seq[manual.i - 1];
    setPts((p) => { const q = { ...(p || {}) }; delete q[key]; return q; });
    setManual((m) => ({ ...m, i: m.i - 1 }));
  };
  const download = () => shareCanvas(canvasRef.current, `${member?.name || "회원"}_체형분석_${todayISO()}.jpg`, "체형 분석", onToast);
  const save = async () => {
    if (!res || !res.items.length) return;
    let blob = null;
    try {
      const c = document.createElement("canvas");
      const s = Math.min(1, 520 / Math.max(canvasRef.current.width, canvasRef.current.height));
      c.width = Math.round(canvasRef.current.width * s); c.height = Math.round(canvasRef.current.height * s);
      c.getContext("2d").drawImage(canvasRef.current, 0, 0, c.width, c.height);
      blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.72));
    } catch (e) {}
    onSavePose?.({
      id: uid(), date: todayISO(), view, blob,
      metrics: res.items.map((i) => ({ key: i.key, label: i.label, value: i.value, unit: i.unit, level: i.level, dir: i.dir })),
      comment: poseComment(member, view, res),
    });
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
    <Card className="p-5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: GRAD }}>
          <Activity size={16} color="#fff" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold" style={{ color: INK }}>AI 체형 분석</span>
          <Sub>사진 한 장으로 어깨·골반·무릎 각도를 숫자로</Sub>
        </span>
        {saved.length > 0 && <span className="rounded-full px-2 py-1 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>{saved.length}건</span>}
        <ChevronRight size={16} style={{ color: SUB, transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5" style={{ background: GRAD_SOFT }}>
            {engine === "loading" && <><Loader2 size={13} className="animate-spin" style={{ color: PRIMARY }} /><Sub>AI 관절 인식 모델을 불러오는 중…</Sub></>}
            {engine === "ready" && <><Sparkles size={13} style={{ color: PRIMARY }} /><span className="text-xs font-bold" style={{ color: PRIMARY }}>AI 자동 인식 사용 가능</span></>}
            {engine === "manual" && <><AlertTriangle size={13} style={{ color: WARN }} /><span className="text-xs font-bold" style={{ color: WARN }}>이 환경에서는 모델을 내려받지 못해 수동 지정 모드로 계산합니다</span></>}
            {engine === "idle" && <Sub>사진을 올리면 관절을 찾아 각도를 계산합니다.</Sub>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => albumRef.current?.click()} disabled={busy}
              className="flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-extrabold text-white" style={{ background: GRAD, opacity: busy ? 0.6 : 1 }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 사진 업로드
            </button>
            <button onClick={() => camRef.current?.click()} disabled={busy}
              className="flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: CANVAS, color: INK }}>
              <Camera size={14} /> 촬영
            </button>
            {img && <button onClick={() => startManual()} className="rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: CANVAS, color: PRIMARY }}>관절 직접 찍기</button>}
            {img && engine === "ready" && !manual && (
              <button onClick={() => { setBusy(true); detect(imgRef.current).finally(() => setBusy(false)); }} className="rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
                <RotateCcw size={13} /> 다시 인식
              </button>
            )}
          </div>
          <input ref={albumRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickFile(f); }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickFile(f); }} />
          {!img && (
            <div className="rounded-2xl p-4" style={{ backgroundColor: CANVAS }}>
              <p className="text-sm font-bold" style={{ color: INK }}>촬영 가이드</p>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed" style={{ color: SUB }}>
                <li>· 발끝부터 머리끝까지 전신이 들어가게, 카메라는 골반 높이에서 수평으로</li>
                <li>· 몸에 붙는 옷 · 맨발 · 벽에서 30cm 떨어져 정면(또는 측면)으로 자연스럽게 서기</li>
                <li>· 정면과 측면을 같은 자리·같은 거리에서 찍어두면 다음 달 비교가 정확해집니다</li>
              </ul>
            </div>
          )}
          {img && (
            <>
              <div className="relative overflow-hidden rounded-2xl bg-photo">
                <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                  className="block w-full touch-none" style={{ height: "auto" }} />
                {manual && manual.i < manual.seq.length && (
                  <>
                    <div className="absolute inset-x-0 top-0 flex justify-center gap-1 p-3">
                      {manual.seq.map((s, idx) => (
                        <span key={s} className="h-1 flex-1 rounded-full transition-all"
                          style={{ backgroundColor: idx < manual.i ? "#9E88FF" : idx === manual.i ? "#fff" : "rgba(255,255,255,.28)", maxWidth: 26 }} />
                      ))}
                    </div>
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
                      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl px-3 py-2.5"
                        style={{ backgroundColor: "rgba(17,17,31,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,.14)" }}>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: GRAD }}>
                          <Crosshair size={14} color="#fff" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-extrabold text-white">{manualHint(manual.seq[manual.i], view)}</span>
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
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex gap-1 rounded-full p-1" style={{ backgroundColor: CANVAS }}>
                  {[{ k: "front", l: "정면" }, { k: "side", l: "측면" }].map((v) => (
                    <button key={v.k} onClick={() => setView(v.k)} className="rounded-full px-3 py-1.5 text-xs font-bold"
                      style={view === v.k ? { backgroundColor: CARD, color: PRIMARY, boxShadow: "0 1px 3px rgba(20,20,43,.12)" } : { color: SUB }}>{v.l}</button>
                  ))}
                </div>
                {view === "front" && (
                  <>
                    <button onClick={() => setMirror((m) => !m)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: mirror ? TINT : CANVAS, color: mirror ? PRIMARY : SUB }}>좌우 바꿈</button>
                    <button onClick={() => setFloorFix((f) => !f)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: floorFix ? TINT : CANVAS, color: floorFix ? PRIMARY : SUB }}>바닥선 보정 {floorFix ? "켜짐" : "꺼짐"}</button>
                  </>
                )}
                {view === "side" && (
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
                  <button onClick={copy} className="flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold" style={{ color: PRIMARY }}>
                    <Copy size={14} /> 코멘트 복사
                  </button>
                </div>
              </div>
            </>
          )}
          {saved.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-extrabold" style={{ color: SUB }}>저장된 분석 {saved.length}건</p>
              <div className="space-y-2">
                {saved.slice(0, 6).map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-2xl p-2" style={{ backgroundColor: CANVAS }}>
                    <img src={s.src} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold" style={{ color: INK }}>{ymd(s.date)} · {s.view === "front" ? "정면" : "측면"}</p>
                      <p className="mt-0.5 truncate text-xs tabular-nums" style={{ color: SUB }}>
                        {s.metrics.slice(0, 3).map((m) => `${m.label.replace(/\(.*\)/, "").trim()} ${m.value}${m.unit}`).join(" · ")}
                      </p>
                    </div>
                    <button onClick={() => onDeletePose?.(s.id)} style={{ color: FAINT }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
function Dashboard({ member, photos, schedule, onBack, briefing, onSavePhoto, onRemovePhoto, onSaveMarks, onAdjustPhoto, onDeleteNote, onToast, goRecord, onToggleFav, onDeleteSet, onBrief, onSavePose, onDeletePose }) {
  const total = left(member), low = total <= 3;
  const att = attendanceOf(schedule, member.id);
  const d = ddaySafe(member.contractEnd);
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 py-1 text-sm font-bold md:hidden" style={{ color: SUB }}><ArrowLeft size={16} /> 목록</button>
      <Guard label="회원 요약">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold text-white" style={{ background: GRAD, boxShadow: "0 4px 12px rgba(108,76,241,.30)" }}>{(member.name || "?").slice(0, 1)}</div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold" style={{ color: INK }}>{member.name || "이름 미입력"} 회원님</h2>
            <Sub>{member.age ? `${member.age}세 · ` : ""}담당 {member.instructor || "-"}{att.rate !== null ? ` · 출석률 ${att.rate}%` : ""}</Sub>
          </div>
          <div className="rounded-2xl px-3 py-2 text-center" style={{ backgroundColor: low ? BAD_S : CANVAS }}>
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
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
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
      <Guard label="변화 요약"><ChangeSummary member={member} onGo={() => goRecord("inbody")} /></Guard>
      <Guard label="인바디 그래프"><InbodyChart member={member} /></Guard>
      <Guard label="AI 체형 분석"><PoseAnalyzer member={member} photos={photos} onSavePose={onSavePose} onDeletePose={onDeletePose} onToast={onToast} /></Guard>
      <Guard label="AI 비포애프터 분석"><PhotoCompare member={member} photos={photos} briefing={briefing} onSavePhoto={onSavePhoto} onRemove={onRemovePhoto} onSaveMarks={onSaveMarks} onAdjust={onAdjustPhoto} onToast={onToast} /></Guard>
      <Guard label="사진 모음"><BeforeAfterSets memberName={member.name} photos={photos} onToggleFav={onToggleFav} onDelete={onDeleteSet} /></Guard>
      <Guard label="운동 수행 능력"><PerformancePanel member={member} briefing={briefing} onGo={() => goRecord("perf")} /></Guard>
      <Guard label="코멘트 기록"><Timeline member={member} briefing={briefing} onDelete={onDeleteNote} /></Guard>
      <Guard label="종합 평가"><OverallReview member={member} briefing={briefing} onToast={onToast} schedule={schedule} /></Guard>
    </div>
  );
}
function RecordTab({ db, selectedId, setSelectedId, section, setSection, onSaveInbody, onDeleteInbody, onSaveNote, onPatch, onDelete, onToast, onSettings }) {
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
      <Card className="p-4">
        <Field label="기록할 회원">
          <select value={member.id} onChange={(e) => setSelectedId(e.target.value)} className={inputCls}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name || "이름 미입력"}{isEnded(m) ? " (종료)" : ""} · 잔여 {left(m)}회</option>)}
          </select>
        </Field>
        <button onClick={() => setOpenInfo((v) => !v)} aria-expanded={openInfo}
          className="mt-2 flex w-full items-center gap-2 rounded-2xl px-3 py-2.5" style={{ backgroundColor: CANVAS }}>
          <span className="min-w-0 flex-1 truncate text-left text-xs font-bold" style={{ color: INK }}>
            {member.name || "이름 미입력"} · 잔여 {left(member)}회{member.goal ? ` · ${member.goal}` : ""}
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
                { l: "나이", v: member.age ? `${member.age}세` : "-" },
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
        <div className="mt-3 flex gap-1 overflow-x-auto rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
          {SECTIONS.map((s) => {
            const Icon = s.icon, on = section === s.k;
            return (
              <button key={s.k} onClick={() => setSection(s.k)} className="flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold"
                style={on ? { background: GRAD, color: "#fff", boxShadow: "0 3px 8px rgba(108,76,241,.30)" } : { color: SUB }}>
                <Icon size={13} /> {s.l}
              </button>
            );
          })}
        </div>
      </Card>
      {section === "inbody" && <InbodyForm member={member} last={last} onSave={onSaveInbody} onDelete={onDeleteInbody} onPatch={onPatch} onToast={onToast} />}
      {section === "note" && <NoteForm member={member} schedule={db.schedule} onSave={onSaveNote} settings={db.settings} onSettings={onSettings} />}
      {section === "perf" && <PerfForm member={member} onPatch={onPatch} />}
      {section === "info" && <InfoForm member={member} onPatch={onPatch} onDelete={onDelete} onToast={onToast} />}
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
function parseInbodyQR(raw) {
  const text = String(raw || "").trim();
  const out = { values: {}, date: null, url: null, raw: text };
  if (!text) return out;
  out.url = /^https?:\/\//i.test(text) ? text.split(/\s/)[0] : null;
  const pairs = [];
  try {
    const j = JSON.parse(text);
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      Object.keys(o).forEach((k) => { const v = o[k]; if (v && typeof v === "object") walk(v); else pairs.push([k, v]); });
    };
    walk(j);
  } catch (e) {}
  const src = text.indexOf("?") >= 0 ? text.slice(text.indexOf("?") + 1) : text;
  String(src).split(/[&;\n\r,|\t]+/).forEach((seg) => {
    const m = seg.match(/^\s*([0-9A-Za-z_%가-힣 .-]+?)\s*[=:]\s*(-?\d+(?:\.\d+)?)\s*[a-zA-Z%가-힣]*\s*$/);
    if (m) { let k = m[1]; try { k = decodeURIComponent(k); } catch (e) {} pairs.push([k, m[2]]); }
  });
  QR_FIELDS.forEach((f) => f.keys.forEach((k) => {
    const m = text.match(new RegExp("(?:^|[^0-9A-Za-z가-힣])" + k + "\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?)", "i"));
    if (m) pairs.push([k, m[1]]);
  }));
  pairs.forEach((kv) => {
    const key = qrNorm(kv[0]), n = Number(kv[1]);
    if (!key || !Number.isFinite(n)) return;
    const f = QR_FIELDS.find((x) => x.keys.some((y) => qrNorm(y) === key));
    if (!f || out.values[f.k] !== undefined) return;
    if (n < f.min || n > f.max) return;
    out.values[f.k] = n;
  });
  const g = text.match(/(20\d{2})[-.\/](\d{1,2})[-.\/](\d{1,2})/) || text.match(/(20\d{2})(\d{2})(\d{2})/);
  if (g) {
    const mo = String(g[2]).padStart(2, "0"), da = String(g[3]).padStart(2, "0");
    if (+mo >= 1 && +mo <= 12 && +da >= 1 && +da <= 31) out.date = g[1] + "-" + mo + "-" + da;
  }
  return out;
}
function QrSheet({ onClose, onRead }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const [link, setLink] = useState(null);
  const [cam, setCam] = useState(false);
  const videoRef = useRef(null), fileRef = useRef(null), streamRef = useRef(null), loopRef = useRef(null);
  const canScan = typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
  const stop = useCallback(() => {
    try { if (loopRef.current) clearTimeout(loopRef.current); } catch (e) {}
    loopRef.current = null;
    try { ((streamRef.current && streamRef.current.getTracks()) || []).forEach((t) => t.stop()); } catch (e) {}
    streamRef.current = null;
    setCam(false);
  }, []);
  useEffect(() => stop, [stop]);
  const handle = (text) => {
    const r = parseInbodyQR(text);
    if (!Object.keys(r.values).length) {
      setLink(r.url);
      setMsg(r.url
        ? "이 QR에는 측정값이 없고 인바디 결과 페이지 링크만 들어 있습니다. 링크를 열어 값을 확인한 뒤 아래 칸에 입력해 주세요."
        : "측정값을 찾지 못했습니다. 읽힌 내용: " + (r.raw || "").slice(0, 60));
      return;
    }
    stop();
    onRead(r);
  };
  const startCam = async () => {
    setMsg(""); setLink(null); setBusy(true);
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      streamRef.current = st; setCam(true);
      if (videoRef.current) { videoRef.current.srcObject = st; try { await videoRef.current.play(); } catch (e) {} }
      const det = new window.BarcodeDetector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await det.detect(videoRef.current);
          if (codes && codes.length && codes[0].rawValue) { handle(codes[0].rawValue); return; }
        } catch (e) {}
        loopRef.current = setTimeout(tick, 350);
      };
      tick();
    } catch (e) {
      setMsg("카메라를 열지 못했습니다. 아래에서 사진으로 읽거나 내용을 붙여넣어 주세요.");
    }
    setBusy(false);
  };
  const scanFile = async (file) => {
    if (!file) return;
    setBusy(true); setMsg(""); setLink(null);
    try {
      if (!canScan) throw new Error("unsupported");
      const det = new window.BarcodeDetector({ formats: ["qr_code"] });
      const bmp = await createImageBitmap(file);
      const codes = await det.detect(bmp);
      if (!codes || !codes.length) setMsg("사진에서 QR을 찾지 못했습니다. 기록지 전체 말고 QR만 화면에 꽉 차게 다시 찍어 주세요.");
      else handle(codes[0].rawValue);
    } catch (e) {
      setMsg("이 브라우저는 사진에서 QR 읽기를 지원하지 않습니다. 휴대폰 기본 카메라로 QR을 찍어 나온 내용을 아래에 붙여넣어 주세요.");
    }
    setBusy(false);
  };
  return (
    <Sheet title="인바디 QR 불러오기" onClose={() => { stop(); onClose(); }}>
      <div className="space-y-3">
        <div className="rounded-2xl p-3" style={{ backgroundColor: TINT }}>
          <p className="text-xs font-bold" style={{ color: PRIMARY }}>QR만 화면에 꽉 차게 잡아 주세요</p>
          <Sub className="mt-1">기록지 전체를 멀리서 찍은 사진은 QR이 작게 나와 잘 읽히지 않습니다.</Sub>
        </div>
        {cam && (
          <div className="relative overflow-hidden rounded-2xl bg-photo" style={{ aspectRatio: "4 / 3" }}>
            <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-2xl" style={{ width: "58%", aspectRatio: "1 / 1", border: "3px solid rgba(255,255,255,.9)" }} />
            </div>
            <button onClick={stop} className="absolute right-2 top-2 rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: "rgba(0,0,0,.55)" }}>중단</button>
          </div>
        )}
        <div className="flex gap-1.5">
          {canScan && !cam && (
            <button onClick={startCam} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-extrabold text-white" style={{ backgroundColor: BRAND }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />} 카메라로 스캔
            </button>
          )}
          <button onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold" style={{ backgroundColor: CANVAS, color: INK }}>
            <ImagePlus size={15} /> 사진에서 읽기
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; scanFile(f); }} />
        <Field label="QR 내용 붙여넣기" hint="휴대폰 카메라로 찍은 결과를 그대로">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3}
            placeholder="예) WT=70.2&SMM=22.4&PBF=41.4  또는  체중 70.2kg 골격근량 22.4kg"
            className={inputCls} style={{ resize: "none" }} />
        </Field>
        <button onClick={() => handle(paste)} disabled={!paste.trim()}
          className="w-full rounded-2xl py-3 text-sm font-extrabold text-white disabled:opacity-50" style={{ backgroundColor: PRIMARY }}>
          내용에서 값 읽기
        </button>
        {msg && (
          <div className="rounded-2xl p-3" style={{ backgroundColor: WARN_S }}>
            <p className="text-xs font-bold" style={{ color: INK }}>{msg}</p>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ backgroundColor: CARD, color: PRIMARY }}>
                <Link2 size={12} /> 인바디 결과 페이지 열기
              </a>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
function InbodyForm({ member, last, onSave, onDelete, onPatch, onToast }) {
  const [f, setF] = useState({ date: todayISO(), weight: "", smm: "", fat: "", fatMass: "", bmi: "", bmr: "", visceral: "", score: "", memo: "" });
  const [more, setMore] = useState(false);
  const [qr, setQr] = useState(false);
  const [qrHit, setQrHit] = useState(null);
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
          <button onClick={() => setQr(true)} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-xs font-extrabold text-white" style={{ backgroundColor: BRAND }}>
            <QrCode size={13} /> QR 불러오기
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {qrHit && (
            <div className="flex items-start gap-1.5 rounded-2xl px-3 py-2.5" style={{ backgroundColor: GOOD_S }}>
              <Check size={13} style={{ color: GOOD, marginTop: 2 }} />
              <span className="min-w-0 flex-1 text-xs font-bold" style={{ color: INK }}>
                QR에서 {qrHit.list.join(" · ")}을(를) 불러왔습니다{qrHit.date ? ` · 측정일 ${ymd(qrHit.date)}` : ""}. 값을 확인한 뒤 저장해 주세요.
              </span>
              <button onClick={() => setQrHit(null)} className="shrink-0" style={{ color: SUB }}><X size={13} /></button>
            </div>
          )}
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
      {qr && (
        <QrSheet onClose={() => setQr(false)} onRead={(r) => {
          const ks = Object.keys(r.values);
          const fill = {};
          ks.forEach((k) => { fill[k] = String(r.values[k]); });
          setF((x) => ({ ...x, ...fill, date: r.date || x.date }));
          if (ks.some((k) => ["fatMass", "bmi", "bmr", "visceral", "score"].indexOf(k) >= 0)) setMore(true);
          setQrHit({ list: ks.map((k) => QR_LABEL[k] || k), date: r.date });
          setQr(false);
          onToast({ ok: true, msg: `QR에서 ${ks.length}개 항목을 불러왔습니다.` });
        }} />
      )}
    </>
  );
}
function NoteForm({ member, schedule, onSave, settings, onSettings }) {
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

function PerfForm({ member, onPatch }) {
  const [newName, setNewName] = useState("");
  const rows = Array.isArray(member.perf) ? member.perf : [];
  const set = (i, key, val) => onPatch(member.id, { perf: rows.map((p, idx) => (idx === i ? { ...p, [key]: clampScore(val) } : p)) });
  return (
    <Card className="p-5">
      <h3 className="font-extrabold" style={{ color: INK }}>운동 수행 능력 평가</h3>
      <Sub>0~100점. 첫 평가 점수를 넣어두면 개선 폭이 표시됩니다</Sub>
      <div className="mt-4 space-y-4">
        {rows.map((p, i) => {
          const gain = p.now - p.prev;
          return (
            <div key={i} className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}>
              <div className="flex items-center gap-2">
                <input value={p.name} onChange={(e) => onPatch(member.id, { perf: rows.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)) })} className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" style={{ color: INK }} />
                <span className="shrink-0 whitespace-nowrap text-sm font-extrabold tabular-nums" style={{ color: INK }}>{p.now}<span className="ml-1 text-xs" style={{ color: gain > 0 ? GOOD : gain < 0 ? BAD : SUB }}>{gain > 0 ? "+" : ""}{gain}</span></span>
                <button onClick={() => onPatch(member.id, { perf: rows.filter((_, idx) => idx !== i) })} aria-label={`${p.name} 항목 삭제`}
                  className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ color: SUB, backgroundColor: CARD }}><Trash2 size={14} /></button>
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
              </div>
            </div>
          );
        })}
        <div className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="평가 항목 추가" className={inputCls} />
          <button onClick={() => { if (!newName.trim()) return; onPatch(member.id, { perf: [...rows, { name: newName.trim(), now: 50, prev: 50 }] }); setNewName(""); }}
            className="shrink-0 rounded-2xl px-4 text-white" style={{ backgroundColor: BRAND }}><Plus size={16} /></button>
        </div>
      </div>
    </Card>
  );
}
const INFO_FIELDS = ["name", "age", "instructor", "phone", "goal", "focus", "passName", "regular", "service", "total", "startDate", "contractEnd", "status", "endedAt", "endedReason", "endedMemo", "holdFrom", "holdUntil", "holdReason"];

function PaymentSheet({ member, onClose, onSubmit }) {
  const [f, setF] = useState({ date: todayISO(), name: member.passName || "", sessions: "", service: "0", amount: "", method: "카드", end: member.contractEnd || "", memo: "" });
  const n = Number(f.sessions) || 0, amt = Number(f.amount) || 0;
  const unit = n > 0 && amt > 0 ? Math.round(amt / n) : 0;
  return (
    <Sheet title="수강권 등록" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="등록일"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} /></Field>
          <Field label="결제 수단">
            <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} className={inputCls}>
              {["카드", "현금", "계좌이체", "기타"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <Field label="수강권 이름"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예) 개인레슨 30회" className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="정규 횟수"><input inputMode="numeric" value={f.sessions} onChange={(e) => setF({ ...f, sessions: e.target.value })} placeholder="30" className={inputCls} /></Field>
          <Field label="서비스 횟수"><input inputMode="numeric" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} placeholder="0" className={inputCls} /></Field>
        </div>
        <Field label="총 결제 금액 원"><input inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9]/g, "") })} placeholder="2100000" className={inputCls} /></Field>
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
        <Field label="유효기간" hint="누르면 만료일이 자동 계산됩니다">
          <div className="flex gap-1.5">
            {[1, 3, 6, 12].map((n) => (
              <button key={n} onClick={() => setF({ ...f, end: addMonths(f.date, n) })} className="flex-1 rounded-xl py-2 text-xs font-bold"
                style={f.end === addMonths(f.date, n) ? { backgroundColor: BRAND, color: "#fff" } : { backgroundColor: CANVAS, color: SUB }}>{n}개월</button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="만료일"><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className={inputCls} /></Field>
          <Field label="메모" hint="선택"><input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="예) 재등록 할인" className={inputCls} /></Field>
        </div>
        <PrimaryBtn disabled={!(n > 0 && amt > 0)} onClick={() => onSubmit({
          id: uid(), date: f.date, name: f.name || "수강권", sessions: n, service: Number(f.service) || 0,
          amount: amt, unit, method: f.method, end: f.end, memo: f.memo,
        })}>
          <Ticket size={16} /> 등록하고 잔여 횟수에 더하기
        </PrimaryBtn>
      </div>
    </Sheet>
  );
}
function InfoForm({ member, onPatch, onDelete, onToast }) {
  const [d, setD] = useState(member);
  const [tag, setTag] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pay, setPay] = useState(false);
  const [hist, setHist] = useState(false);
  const [delPay, setDelPay] = useState(null);
  useEffect(() => { setD(member); }, [member.id]);
  const S = (p) => setD((x) => ({ ...x, ...p }));
  const dirty = INFO_FIELDS.some((k) => JSON.stringify(d[k] ?? "") !== JSON.stringify(member[k] ?? ""));
  const save = () => { const p = {}; INFO_FIELDS.forEach((k) => { p[k] = d[k]; }); onPatch(member.id, p); onToast({ ok: true, msg: "회원 정보를 저장했습니다." }); };
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
          <div className="grid grid-cols-2 gap-2">
            <Field label="이름"><input value={d.name} onChange={(e) => S({ name: e.target.value })} className={inputCls} /></Field>
            <Field label="나이"><input inputMode="numeric" value={d.age} onChange={(e) => S({ age: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="담당 강사"><input value={d.instructor} onChange={(e) => S({ instructor: e.target.value })} className={inputCls} /></Field>
            <Field label="연락처" hint="선택"><input value={d.phone || ""} onChange={(e) => S({ phone: e.target.value })} placeholder="010-" className={inputCls} /></Field>
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
      <div className="safe-b sticky bottom-3 z-10">
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
      const text = packHandoff(db, photos, true, account && account.name);
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
    let text = packHandoff(db, photos, withPhotos, account && account.name);
    if (withPhotos && text.length > 4.5 * 1048576) {
      text = packHandoff(db, photos, false, account && account.name);
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
function SettingsTab({ db, photos, account, onChangeSettings, onChangePhoto, savedAt, onReset, onClear, onLogout, onToast, themePref, onChangeTheme, onImport }) {
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
    <div className="space-y-3">
      <Card className="p-5">
        <h3 className="font-extrabold" style={{ color: INK }}>내 계정</h3>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => albumRef.current?.click()} className="relative shrink-0" aria-label="프로필 사진 변경">
            <Avatar src={account?.photo} name={account?.name} size={56} radius={20} />
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white" style={{ background: GRAD }}>
              {busy ? <Loader2 size={11} color="#fff" className="animate-spin" /> : <Camera size={11} color="#fff" />}
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold" style={{ color: INK }}>{account?.name}</p>
            <Sub className="truncate">{account?.email || "이메일 미등록"}</Sub>
          </div>
          <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>{PROVIDER_LABEL[account?.provider]}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button onClick={() => albumRef.current?.click()} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: TINT, color: PRIMARY }}>
            사진 {account?.photo ? "변경" : "등록"}
          </button>
          <button onClick={() => camRef.current?.click()} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
            <Camera size={12} /> 촬영
          </button>
          {account?.photo && (
            <button onClick={() => onChangePhoto(null)} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
              <Trash2 size={12} /> 사진 삭제
            </button>
          )}
          <span className="w-full"><Sub>회원 앱·상담 화면에 함께 보이는 사진입니다. 얼굴이 잘 보이는 정사각 사진을 권합니다.</Sub></span>
        </div>
        <input ref={albumRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickPhoto(f); }} />
        <input ref={camRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickPhoto(f); }} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}><Sub>센터</Sub><p className="text-sm font-extrabold" style={{ color: INK }}>{account?.center || "-"}</p></div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}><Sub>연락처</Sub><p className="text-sm font-extrabold" style={{ color: INK }}>{account?.phone || "-"}</p></div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}><Sub>가입일</Sub><p className="text-sm font-extrabold tabular-nums" style={{ color: INK }}>{ymd(account?.joinedAt)}</p></div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: CANVAS }}><Sub>관리 회원</Sub><p className="text-sm font-extrabold tabular-nums" style={{ color: INK }}>{db.members.length}명</p></div>
        </div>
        <button onClick={onLogout} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
          <LogOut size={14} /> 로그아웃
        </button>
      </Card>
      <Card className="p-5">
        <h3 className="font-extrabold" style={{ color: INK }}>화면 테마</h3>
        <Sub className="mt-1">폰 설정을 따르거나 직접 고를 수 있어요. 어두운 곳에서 회원에게 보여줄 땐 다크가 눈이 편합니다.</Sub>
        <div className="mt-3 flex gap-1 rounded-2xl p-1" style={{ backgroundColor: CANVAS }}>
          {[{ k: "system", l: "폰 설정", i: Smartphone }, { k: "light", l: "라이트", i: Sun }, { k: "dark", l: "다크", i: Moon }].map((o) => {
            const on = themePref === o.k, Icon = o.i;
            return (
              <button key={o.k} onClick={() => onChangeTheme(o.k)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold"
                style={on ? { background: GRAD, color: "#fff", boxShadow: "0 3px 10px rgba(108,76,241,.3)" } : { color: SUB }}>
                <Icon size={14} /> {o.l}
              </button>
            );
          })}
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="font-extrabold" style={{ color: INK }}>센터 정보</h3>
        <div className="mt-4 space-y-3">
          <Field label="센터명"><input value={db.settings.center} onChange={(e) => onChangeSettings({ ...db.settings, center: e.target.value })} className={inputCls} /></Field>
          <Field label="기본 담당자" hint="수업 등록 시 자동 입력"><input value={db.settings.staff} onChange={(e) => onChangeSettings({ ...db.settings, staff: e.target.value })} className={inputCls} /></Field>
        </div>
      </Card>
      <HandoffCard db={db} photos={photos} account={account} onImport={onImport} onToast={onToast} />
      <Card className="p-5">
        <h3 className="font-extrabold" style={{ color: INK }}>데이터</h3>
        <Sub className="mt-2">계정별로 따로 저장됩니다.{savedAt instanceof Date && ` 마지막 저장 ${savedAt.getHours()}:${String(savedAt.getMinutes()).padStart(2, "0")}`}</Sub>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setConfirm("clear")} className="rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>모든 회원 초기화</button>
          <button onClick={() => setConfirm("reset")} className="flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: CANVAS, color: SUB }}>
            <RotateCcw size={14} /> 회원 데이터로 돌리기
          </button>
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
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: CANVAS }}><Smartphone size={14} style={{ color: SUB }} /></span>
          <h3 className="font-extrabold" style={{ color: INK }}>개인정보 안내</h3>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed" style={{ color: INK2 }}>
          회원 정보 · 사진 · 기록은 <b style={{ color: INK }}>이 기기 안에만</b> 저장됩니다. 외부 서버로 전송하거나 보관하지 않습니다.
        </p>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: INK2 }}>
          그래서 기기를 잃어버리거나 앱을 지우면 <b style={{ color: INK }}>되살릴 수 없습니다.</b> 위 '회원 인계 · DB 넘기기'에서 정기적으로 백업해 두세요.
        </p>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: INK2 }}>
          회원 사진은 회원 동의를 받은 뒤 촬영해 주세요. 회원이 삭제를 요청하면 이 앱에서 그 회원을 삭제하는 것으로 사진까지 함께 지워집니다.
        </p>
      </Card>
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

  useEffect(() => {
    let alive = true;
    (async () => {
      let accs = [];
      try { const r = await window.storage.get(ACC_KEY); if (r?.value) accs = JSON.parse(r.value); } catch (e) {}
      accs = Array.isArray(accs) ? accs.filter((a) => a && typeof a === "object").map((a) => ({ ...a, id: a.id || uid() })) : [];
      let ses = null;
      try { const r = await window.storage.get(SES_KEY); if (r?.value) ses = JSON.parse(r.value); } catch (e) {}
      try { const r = await window.storage.get(THEME_KEY); if (r?.value && alive) setThemePref(r.value); } catch (e) {}
      if (!alive) return;
      setAccounts(accs);
      const auto = ses?.auto && accs.find((a) => a.id === ses.accountId);
      setTimeout(async () => {
        if (!alive) return;
        if (auto) { await loadAccount(auto); setPhase("app"); }
        else setPhase("auth");
      }, 1400);
    })();
    return () => { alive = false; };
  }, []);

  const loadAccount = async (acc) => {
    revokeAllUrls();
    setAccount(acc);
    let data = null, ph = {};
    try { const r = await window.storage.get(dbKey(acc.id)); if (r?.value) data = JSON.parse(r.value); } catch (e) {}
    try { const r = await window.storage.get(phKey(acc.id)); if (r?.value) ph = JSON.parse(r.value); } catch (e) {}
    if (!data) data = sampleDb(acc.center, acc.name);
    data = normalizeDb(data, acc.name);
    if (!data.settings.center) data.settings.center = acc.center || "";
    setDb(data);
    let hyd = ph && typeof ph === "object" ? ph : {};
    try {
      const a = await adoptPhotos(hyd);
      hyd = a.map;
      if (a.changed) { try { await window.storage.set(phKey(acc.id), JSON.stringify(stripSrc(hyd))); } catch (e) {} }
    } catch (e) {}
    setPhotos(hyd);
    setSelectedId(data.members[0]?.id || null);
    setTab("schedule");
  };

  const persistAccounts = async (list) => {
    setAccounts(list);
    try { await window.storage.set(ACC_KEY, JSON.stringify(list)); } catch (e) {}
  };
  const persistSession = async (accId, auto) => {
    try { await window.storage.set(SES_KEY, JSON.stringify({ accountId: accId, auto })); } catch (e) {}
  };
  const handleLogin = async (acc, auto) => {
    await persistSession(acc.id, auto);
    await loadAccount(acc);
    setPhase("app");
    setToast({ ok: true, msg: `${acc.name} 강사님, 환영합니다.` });
  };
  const handleSignup = async (info, auto) => {
    const acc = { id: uid(), joinedAt: todayISO(), ...info };
    await persistAccounts([...accounts, acc]);
    await persistSession(acc.id, auto);
    await loadAccount(acc);
    setPhase("app");
    setToast({ ok: true, msg: "가입이 완료됐습니다. 설정 탭에서 내 정보를 볼 수 있어요." });
  };
  const changePhoto = async (src) => {
    if (!account) return;
    const next = { ...account, photo: src || undefined };
    setAccount(next);
    await persistAccounts(accounts.map((a) => (a.id === next.id ? next : a)));
    setToast({ ok: true, msg: src ? "프로필 사진을 저장했습니다." : "프로필 사진을 삭제했습니다." });
  };
  const handleLogout = async () => {
    try { await window.storage.set(SES_KEY, JSON.stringify({ accountId: null, auto: false })); } catch (e) {}
    revokeAllUrls();
    setAccount(null); setPhase("auth"); setDb(emptyDb("", "")); setPhotos({});
  };

  const saveDb = useCallback(async (next) => {
    const prev = db;
    setDb(next);
    if (!account) return;
    try { await window.storage.set(dbKey(account.id), JSON.stringify(next)); setSavedAt(new Date()); }
    catch (e) { setDb(prev); setToast({ ok: false, msg: "저장하지 못했습니다. 방금 입력한 내용을 다시 확인해 주세요." }); }
  }, [account, db]);
  const savePhotos = useCallback(async (next) => {
    const prev = photos;
    setPhotos(next);
    if (!account) return;
    try { await window.storage.set(phKey(account.id), JSON.stringify(stripSrc(next))); setSavedAt(new Date()); }
    catch (e) { setPhotos(prev); setToast({ ok: false, msg: "저장 공간이 가득 찼습니다. 오래된 사진을 지운 뒤 다시 찍어 주세요." }); }
  }, [account, photos]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const patch = (id, p) => saveDb({ ...db, members: db.members.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const member = db.members.find((m) => m.id === selectedId) || db.members[0];
  const alerts = useMemo(() => detectAlerts(db.members, db.schedule), [db.members, db.schedule]);
  const goTab = (k) => { if (k === "members") setMobileView("list"); setTab(k); };
  const goRecord = (sec) => { setSection(sec); setTab("records"); };
  const noComment = (id, type) => {
    saveDb({ ...db, members: db.members.map((m) => (m.id === id ? { ...m, notes: [...(m.notes || []), { id: uid(), date: todayISO(), type: type || "개인레슨", instructor: m.instructor, body: "특이사항 없음", tags: [], deductFrom: null }] } : m)) });
    setToast({ ok: true, msg: "특이사항 없음으로 기록했습니다." });
  };

  const saveSchedule = (item) => {
    const prev = db.schedule.find((s) => s.id === item.id);
    let members = db.members;
    if (prev) {
      const keep = new Set(attendeesOf(item).map((a) => a.memberId));
      attendeesOf(prev).forEach((a) => { if (a.deductFrom && !keep.has(a.memberId)) members = restoreOne(members, a.memberId, a.deductFrom); });
    }
    saveDb({ ...db, members, schedule: prev ? db.schedule.map((s) => (s.id === item.id ? item : s)) : [...db.schedule, item] });
    setToast({ ok: true, msg: prev ? "수업을 수정했습니다." : "수업을 등록했습니다." });
  };
  const deleteSchedule = (id) => {
    const s0 = db.schedule.find((x) => x.id === id);
    let members = db.members;
    if (s0) attendeesOf(s0).forEach((a) => { if (a.deductFrom) members = restoreOne(members, a.memberId, a.deductFrom); });
    saveDb({ ...db, members, schedule: db.schedule.filter((x) => x.id !== id) });
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
    saveDb({ ...db, members, schedule });
    setToast({ ok: true, msg: msg || `${stOf(status).label} 처리했습니다.` });
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
  const setGroupDone = (id, done) => {
    saveDb({ ...db, schedule: db.schedule.map((s) => (s.id === id ? { ...s, groupDone: done } : s)) });
    setToast({ ok: true, msg: done ? "그룹 수업을 완료 처리했습니다. 이달 누적에 반영됩니다." : "그룹 수업 완료를 취소했습니다." });
  };
  const addMember = () => {
    const m = blankMember(db.settings.staff);
    saveDb({ ...db, members: [m, ...db.members] });
    setSelectedId(m.id); setSection("info"); setTab("records");
    setToast({ ok: true, msg: "새 회원을 추가했습니다." });
  };
  const removeMember = (id) => {
    const rest = db.members.filter((m) => m.id !== id);
    saveDb({
      ...db, members: rest,
      schedule: db.schedule
        .map((s) => ({ ...s, attendees: attendeesOf(s).filter((a) => a.memberId !== id) }))
        .filter((s) => s.attendees.length || s.equip),
    });
    if (photos[id]) {
      const nextPh = { ...photos };
      const ids = blobIdsOf(photos[id]);
      delete nextPh[id];
      savePhotos(nextPh);
      forgetBlobs(ids);
    }
    setSelectedId(rest[0]?.id || null);
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
    patch(id, { notes: [note, ...(t.notes || [])] });
    setToast({ ok: true, msg: "코멘트를 저장했습니다." });
  };
  const deleteNote = (nid) => patch(member.id, { notes: member.notes.filter((n) => n.id !== nid) });
  const savePhoto = async (view, blob, slot, tf) => {
    if (!member || !blob) return;
    let rec = null;
    try { const bid = newBlobId(); await blobPut(bid, blob); rec = { blobId: bid, src: URL.createObjectURL(blob) }; }
    catch (e) {
      try { rec = { src: await blobToDataUrl(blob) }; }
      catch (e2) { setToast({ ok: false, msg: "사진을 저장하지 못했습니다." }); return; }
    }
    const cur = photos[member.id] || {}, list = cur[view] || [];
    const shot = { id: uid(), date: todayISO(), marks: [], ...rec, ...tf };
    const nextList = slot === "before" ? [shot, ...list] : [...list, shot];
    const sets = [...(cur.sets || [])];
    let made = false;
    if (nextList.length >= 2) {
      const b = nextList[0], a = nextList[nextList.length - 1];
      if (!sets.some((x) => x.view === view && x.beforeId === b.id && x.afterId === a.id)) {
        sets.unshift({ id: uid(), view, beforeId: b.id, afterId: a.id, createdAt: todayISO(), fav: false });
        made = true;
      }
    }
    savePhotos({ ...photos, [member.id]: { ...cur, [view]: nextList, sets } });
    setToast({ ok: true, msg: made ? "사진 등록 · 비포&애프터 세트를 저장했습니다." : "사진을 등록했습니다." });
  };
  const removePhoto = (view, pid) => {
    const cur = photos[member.id] || {};
    const gone = (cur[view] || []).find((p) => p.id === pid);
    savePhotos({ ...photos, [member.id]: { ...cur, [view]: (cur[view] || []).filter((p) => p.id !== pid) } });
    if (gone?.blobId) forgetBlobs([gone.blobId]);
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
  const savePose = async (rec) => {
    if (!member) return;
    const out = { ...rec };
    delete out.blob;
    if (rec.blob) {
      try { const bid = newBlobId(); await blobPut(bid, rec.blob); out.blobId = bid; out.src = URL.createObjectURL(rec.blob); }
      catch (e) { try { out.src = await blobToDataUrl(rec.blob); } catch (e2) {} }
    }
    const cur = photos[member.id] || {};
    const keep = [out, ...(cur.poses || [])];
    forgetBlobs(keep.slice(6).map((p) => p.blobId).filter(Boolean));
    savePhotos({ ...photos, [member.id]: { ...cur, poses: keep.slice(0, 6) } });
    setToast({ ok: true, msg: "체형 분석 결과를 저장했습니다." });
  };
  const deletePose = (pid) => {
    if (!member) return;
    const cur = photos[member.id] || {};
    const gone = (cur.poses || []).find((p) => p.id === pid);
    savePhotos({ ...photos, [member.id]: { ...cur, poses: (cur.poses || []).filter((p) => p.id !== pid) } });
    if (gone?.blobId) forgetBlobs([gone.blobId]);
  };
  const adjustPhoto = (view, pid, tf) => {
    const cur = photos[member.id] || {};
    savePhotos({ ...photos, [member.id]: { ...cur, [view]: (cur[view] || []).map((p) => (p.id === pid ? { ...p, ...tf } : p)) } });
    setToast({ ok: true, msg: "사진 위치를 저장했습니다." });
  };
  const saveMarks = (view, pid, marks) => {
    const cur = photos[member.id] || {};
    savePhotos({ ...photos, [member.id]: { ...cur, [view]: (cur[view] || []).map((p) => (p.id === pid ? { ...p, marks } : p)) } });
    setToast({ ok: true, msg: "체형 분석을 저장했습니다." });
  };
  const wipePhotos = () => {
    Object.keys(photos || {}).forEach((mid) => forgetBlobs(blobIdsOf(photos[mid])));
    savePhotos({});
  };
  const resetSample = () => {
    const d = normalizeDb(sampleDb(account?.center, account?.name), account?.name);
    saveDb(d); wipePhotos(); setSelectedId(d.members[0].id);
    setToast({ ok: true, msg: "회원 데이터를 되돌렸습니다." });
  };
  const clearAll = () => {
    saveDb({ ...db, members: [], schedule: [] }); wipePhotos(); setSelectedId(null);
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
    setToast({ ok: true, msg: `회원 ${next.members.length}명 · 수업 ${next.schedule.length}건으로 반영했습니다.` });
  };

  const style = (
    <style>{`
      @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
      .app-root { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif; -webkit-font-smoothing: antialiased; color: ${INK}; color-scheme: ${THEME}; }
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
      .app-root p, .app-root h1, .app-root h2, .app-root h3, .app-root span, .app-root button, .app-root li { word-break: keep-all; overflow-wrap: break-word; }
      .app-root *:focus-visible { outline: 2px solid ${PRIMARY}; outline-offset: 2px; }
      .app-root input[type=range] { height: 28px; }
      .safe-b { padding-bottom: env(safe-area-inset-bottom, 0px); }
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
    <div className="app-root min-h-screen pb-16" style={{ backgroundColor: PAGE }}>
      {style}
      <div className="sticky top-0 z-30">
        <Header settings={db.settings || {}} account={account} alertCount={alerts.length} onProfile={() => setTab("settings")} />
        <Tabs tab={tab} setTab={goTab} />
      </div>
      <main className="mx-auto max-w-6xl px-4 py-3">
        <Guard key={tab}>
        {tab === "members" && (
          <>
            <div className="gap-5 md:grid md:grid-cols-12">
              <div className={`md:col-span-5 lg:col-span-4 ${mobileView === "detail" ? "hidden md:block" : ""}`}>
                <Guard label="회원 목록">
                  <MemberList members={db.members} schedule={db.schedule} selectedId={selectedId} onAdd={addMember} onOpenFav={() => setFavOpen(true)} favCount={favList.length}
                    onSelect={(id) => { setSelectedId(id); setMobileView("detail"); }} />
                </Guard>
              </div>
              <div className={`md:col-span-7 lg:col-span-8 ${mobileView === "list" ? "hidden md:block" : ""}`}>
                {member ? (
                  <Guard label="회원 상세" key={member.id}>
                  <Dashboard member={member} photos={photos[member.id]} schedule={db.schedule} briefing={briefing}
                    onBack={() => setMobileView("list")} onSavePhoto={savePhoto} onRemovePhoto={removePhoto}
                    onSaveMarks={saveMarks} onAdjustPhoto={adjustPhoto} onDeleteNote={deleteNote} onToast={setToast} goRecord={goRecord}
                    onSavePose={savePose} onDeletePose={deletePose}
                    onToggleFav={(sid) => toggleFav(member.id, sid)} onDeleteSet={(sid) => deleteSet(member.id, sid)}
                    onBrief={(m) => setBrief({ member: m, rest: left(m), d: ddaySafe(m.contractEnd), att: attendanceOf(db.schedule, m.id), reasons: [] })} />
                  </Guard>
                ) : (
                  <Card className="p-8 text-center"><p className="text-sm font-bold">회원을 추가하면 여기에 상세 대시보드가 표시됩니다.</p></Card>
                )}
              </div>
            </div>
            {!briefing && <div className="mt-3"><Guard label="골든타임 알림"><AlertCenter alerts={alerts} onBrief={setBrief} onOpenMember={(id) => { setSelectedId(id); setMobileView("detail"); }} /></Guard></div>}
          </>
        )}
        {tab === "schedule" && (
          <ScheduleManager db={db} onSave={saveSchedule} onDelete={deleteSchedule} onStatus={setStatus} onNoshowFee={setNoshowFee} onGroupDone={setGroupDone}
            onOpenMember={(id) => { setSelectedId(id); setMobileView("detail"); setTab("members"); }}
            onNoComment={noComment}
            onWriteNote={(id) => { setSelectedId(id); setSection("note"); setTab("records"); }} />
        )}
        {tab === "records" && (
          <RecordTab db={db} selectedId={selectedId} setSelectedId={setSelectedId} section={section} setSection={setSection}
            onSaveInbody={saveInbody} onDeleteInbody={deleteInbody} onSaveNote={saveNote} onPatch={patch} onDelete={removeMember} onToast={setToast}
            onSettings={(next) => saveDb({ ...db, settings: next })} />
        )}
        {tab === "settings" && (
          <SettingsTab db={db} photos={photos} account={account} savedAt={savedAt} onChangeSettings={(s) => saveDb({ ...db, settings: s })}
            onChangePhoto={changePhoto} onToast={setToast} themePref={themePref} onChangeTheme={changeTheme}
            onReset={resetSample} onClear={clearAll} onLogout={handleLogout} onImport={importHandoff} />
        )}
        </Guard>
      </main>
      {favOpen && <Guard label="즐겨찾기"><FavSetsModal items={favList} onClose={() => setFavOpen(false)} onToggleFav={toggleFav}
        onOpenMember={(id) => { setSelectedId(id); setMobileView("detail"); setTab("members"); }} /></Guard>}
      {brief && <Guard label="재등록 브리핑"><SalesBriefModal alert={brief} onClose={() => setBrief(null)} onToast={setToast} /></Guard>}
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
}
