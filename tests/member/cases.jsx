/**
 * 회원 화면 스모크의 케이스들. **테스트만 읽는다.**
 *
 * `member/src` 밖에 두는 이유가 있다. 회원 앱은 번들이 작은 것이 요점이고,
 * 화면 넷을 그리자고 시험용 데이터를 함께 내려보낼 이유가 없다. 강사 앱은
 * App.jsx 안에 케이스를 두지만 그쪽은 이미 2.1MB 다.
 *
 * JSX 는 여기 있고 단언은 screens.test.js 에 있다 -- node --test 는 JSX 를
 * 모르므로 vite 가 이 파일을 읽어 준다.
 */

import {
  History, Home, LinkNotice, LoadFailed, Loading, More, NotMigrated, Passes, Preparing,
} from "../../member/src/screens.jsx";
import { linkResultScreen } from "../../member/src/link-result.js";

export const NOW = new Date(2026, 8, 24, 12, 0);

export const view = (overrides = {}) => ({
  organizationId: "center-a", clientId: "client-a", userId: "uid-member",
  name: "김하나", locationName: "반송점", clientStatus: "active",
  remainingTotal: 8, nextExpiresAt: new Date(2027, 0, 31),
  passes: [{
    passId: "pass-1", displayName: "1:1 퍼스널 20회", purchaseRound: 2, totalSessions: 20, serviceSessions: 2,
    remainingCount: 8, expiresAt: new Date(2027, 0, 31), status: "active",
    isDuet: false, partnerName: "",
  }],
  history: [{ occurredAt: new Date(2026, 8, 18), type: "deduct", instructorName: "정예진" }],
  journey: null,
  ...overrides,
});

const JOURNEY = {
  segments: [
    { kind: "prior", passId: "", round: 0, total: 12, used: 12 },
    { kind: "pass", passId: "pass-1", round: 2, total: 22, used: 14 },
  ],
  prior: 12, usedTotal: 26, grandTotal: 34, currentRound: 2, hasPrior: true,
};

/* ── 달력이 읽는 것 ──────────────────────────────────────────────────

   더보기 탭은 투영의 수업 이력 하나만 센다. 서버도 규칙도 건드리지 않았으므로,
   여기 있는 배열이 곧 그 탭이 아는 전부다. */

const lesson = (year, month, day) => ({
  occurredAt: new Date(year, month, day), type: "deduct", instructorName: "정예진",
});

/** 2026-09: 2·4·8·10·15·17·22·24 — 넉 주 연속, 이번 달 8번. */
const STEADY = [
  ...[2, 4, 8, 10, 15, 17, 22, 24].map((day) => lesson(2026, 8, day)),
  ...[3, 5, 11, 13, 19, 21, 27].map((day) => lesson(2026, 7, day)),
];

/**
 * 마지막이 9월 6일이다. NOW(9/24) 기준 18일 지났다.
 *
 * 여섯 달이 8·7·6·5·5·3 으로 내려간다 -- 이 모양이 이 탭을 만든 이유다.
 * 사람은 "지난달보다 줄었다" 를 문장보다 모양으로 먼저 안다.
 */
const FADING = [
  ...[1, 3, 6].map((day) => lesson(2026, 8, day)),
  ...[4, 11, 18, 25, 28].map((day) => lesson(2026, 7, day)),
  ...[2, 9, 16, 23, 30].map((day) => lesson(2026, 6, day)),
  ...[1, 8, 15, 22, 26, 29].map((day) => lesson(2026, 5, day)),
  ...[2, 6, 11, 15, 20, 24, 28].map((day) => lesson(2026, 4, day)),
  ...[1, 4, 8, 11, 15, 18, 22, 25].map((day) => lesson(2026, 3, day)),
];

/** 상한(100건)에 닿은 이력. 가장 오래된 달보다 앞은 모르는 구간이다. */
const CAPPED = Array.from({ length: 100 }, (_unused, index) => (
  lesson(2026, 8 - Math.floor(index / 9), (index % 9) * 3 + 1)
));

const noop = () => {};

export function memberScreenCases() {
  return [
    { name: "홈", element: <Home view={view()} now={NOW} /> },
    {
      name: "홈 · 만료 임박",
      element: <Home view={view({ nextExpiresAt: new Date(2026, 9, 1) })} now={NOW} />,
    },
    { name: "홈 · 잔여 0", element: <Home view={view({ remainingTotal: 0 })} now={NOW} /> },
    {
      name: "홈 · 종료 회원",
      element: <Home view={view({ clientStatus: "ended", remainingTotal: 0 })} now={NOW} />,
    },

    { name: "회원권", element: <Passes view={view()} /> },
    {
      name: "회원권 · 듀엣",
      element: <Passes view={view({
        passes: [{
          passId: "duet-1", purchaseRound: 1, totalSessions: 30, serviceSessions: 0,
          remainingCount: 29, expiresAt: new Date(2027, 0, 31), status: "active",
          isDuet: true, partnerName: "김민정",
        }],
      })} />,
    },
    { name: "회원권 · 없음", element: <Passes view={view({ passes: [] })} /> },

    { name: "수업 이력", element: <History view={view()} /> },
    {
      name: "수업 이력 · 되돌린 차감",
      element: <History view={view({
        history: [{ occurredAt: new Date(2026, 8, 19), type: "correction", instructorName: "정예진" }],
      })} />,
    },
    {
      /* 강사가 회원에게 보내려고 따로 적은 한 줄. 수업기록 원문이 아니다. */
      name: "수업 이력 · 강사의 말",
      element: <History view={view({
        history: [
          {
            occurredAt: new Date(2026, 8, 19), type: "deduct", instructorName: "정예진",
            memberNote: "오늘 어깨 내리는 게 한결 편해 보이셨어요. 다음까지 벽 스트레칭만 짧게 해 보세요.",
          },
          { occurredAt: new Date(2026, 8, 18), type: "deduct", instructorName: "정예진", memberNote: "" },
        ],
      })} />,
    },
    { name: "수업 이력 · 없음", element: <History view={view({ history: [] })} /> },

    /* 꾸준한 회원. 9월 2·4·8·10·15·17·22·24 -- 넉 주 연속이다. */
    { name: "더보기", element: <More view={view({ history: STEADY, journey: JOURNEY })} now={NOW} /> },
    /* 뜸해진 회원. 마지막이 9월 6일이라 18일 지났고, 막대가 내려간다.
       이 화면이 이 탭을 만든 이유다. */
    { name: "더보기 · 뜸해짐", element: <More view={view({ history: FADING })} now={NOW} /> },
    /* 아직 수업이 없다. 빈 달력을 그리되 지어낸 숫자를 넣지 않는다. */
    { name: "더보기 · 첫 회원", element: <More view={view({ history: [], journey: null })} now={NOW} /> },
    /* 이력이 상한(100건)에 닿았다. 가장 오래된 달보다 앞은 **모르는 구간**이고,
       빈 달력을 말없이 그리면 회원은 그때 안 나온 것으로 읽는다. */
    {
      name: "더보기 · 기록 끝",
      /* 가장 오래된 달로 넘겨 둔 화면이다. 그 끝에서만 말하면 되는 문구라
         거기까지 가 있어야 볼 수 있다. */
      element: <More view={view({ history: CAPPED })} now={NOW} monthsBack={11} />,
    },


    { name: "불러오는 중", element: <Loading /> },
    { name: "조회 실패", element: <LoadFailed code="permission-denied" onRetry={noop} /> },
    { name: "준비 중", element: <Preparing onRetry={noop} /> },
    { name: "이관 안 된 지점", element: <NotMigrated /> },

    {
      name: "연결 안내 · 확인 필요",
      element: <LinkNotice screen={linkResultScreen("ambiguous")} onRetry={noop} />,
    },
    {
      name: "연결 안내 · 번호 없음",
      element: <LinkNotice screen={linkResultScreen("not_found")} onRetry={noop} />,
    },
    {
      name: "연결 안내 · 이미 연결됨",
      element: <LinkNotice screen={linkResultScreen("taken")} onRetry={noop} />,
    },
    {
      name: "연결 안내 · 모르는 코드",
      element: <LinkNotice screen={linkResultScreen("weird")} onRetry={noop} />,
    },

    /* 금액이 새는지 한자리에서 본다. 네 화면을 모두 그린다. */
    {
      name: "전부",
      element: (
        <div>
          <Home view={view({ journey: JOURNEY })} now={NOW} />
          <Passes view={view({ journey: JOURNEY })} />
          <History view={view({ journey: JOURNEY })} />
          <More view={view({ history: STEADY, journey: JOURNEY })} now={NOW} />
        </div>
      ),
    },
  ];
}
