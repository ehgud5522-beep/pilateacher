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
  History, Home, Journey, LinkNotice, LoadFailed, Loading, NotMigrated, Passes, Preparing,
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

    { name: "여정", element: <Journey view={view({ journey: JOURNEY })} /> },
    { name: "여정 · 없음", element: <Journey view={view({ journey: null })} /> },
    /* 가장 오래 다닌 회원. 예전에는 여기서 구슬 넷이 전부 채워지고 "다음" 줄이
       사라졌다 -- 오래 올수록 화면이 비고 100회가 결승선으로 읽혔다. */
    {
      name: "여정 · 100회 넘음",
      element: <Journey view={view({ journey: { ...JOURNEY, usedTotal: 126 } })} />,
    },
    /* 다음 이정표까지 4번인데 회원권에는 2번이 남았다. 파는 말은 하지 않고
       두 사실을 나란히 놓는다 -- 셈은 회원이 한다. */
    {
      name: "여정 · 회원권 모자람",
      element: <Journey view={view({ journey: JOURNEY, remainingTotal: 2 })} />,
    },
    {
      name: "여정 · 잔여 0",
      element: <Journey view={view({ journey: JOURNEY, remainingTotal: 0 })} />,
    },
    /* 이름이 없는 투영. "회원님" 같은 것을 채우지 않는다 -- 이름이 없다는 것은
       무언가 잘못됐다는 뜻이고, 지어낸 말로 덮으면 아무도 모른다. */
    {
      name: "여정 · 이름 없음",
      element: <Journey view={view({ journey: JOURNEY, name: "" })} />,
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
          <Journey view={view({ journey: JOURNEY })} />
        </div>
      ),
    },
  ];
}
