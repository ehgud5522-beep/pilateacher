/**
 * 회원 화면 스모크의 케이스들. **테스트만 읽는다.**
 *
 * `member/src` 밖에 두는 이유가 있다. 회원 앱은 번들이 작은 것이 요점이고,
 * 화면 셋을 그리자고 시험용 데이터를 함께 내려보낼 이유가 없다. 강사 앱은
 * App.jsx 안에 케이스를 두지만 그쪽은 이미 2.1MB 다.
 *
 * JSX 는 여기 있고 단언은 screens.test.js 에 있다 -- node --test 는 JSX 를
 * 모르므로 vite 가 이 파일을 읽어 준다.
 */

import {
  DeleteAccount, DeleteAccountGuide, Diagnostics, Home, LinkNotice, LoadFailed, Loading, MyPage,
  NotMigrated, Preparing, Records, SlowConnection,
} from "../../member/src/screens.jsx";
import { linkResultScreen } from "../../member/src/link-result.js";

/** 2026-09-24 (목) 정오. */
export const NOW = new Date(2026, 8, 24, 12, 0);

export const view = (overrides = {}) => ({
  organizationId: "center-a", clientId: "client-a", userId: "uid-member",
  name: "김하나", locationName: "반송점", clientStatus: "active",
  remainingTotal: 8, nextExpiresAt: new Date(2027, 0, 31),
  passes: [{
    passId: "pass-1", lessonType: "1:1", totalSessions: 20, serviceSessions: 2,
    remainingCount: 8, expiresAt: new Date(2027, 0, 31), status: "active",
    isDuet: false, partnerName: "",
  }],
  history: [{
    occurredAt: new Date(2026, 8, 18, 19, 0), type: "deduct", lessonType: "1:1", instructorName: "정예진",
  }],
  journey: null,
  ...overrides,
});

const lesson = (year, month, day, hour = 19, extra = {}) => ({
  occurredAt: new Date(year, month, day, hour, 0), type: "deduct", lessonType: "1:1",
  instructorName: "정예진", ...extra,
});

/** 9월 2·4·8·10·15·17·22·24(오늘). 오늘 10시 수업과 22일의 한마디가 있다. */
const STEADY = [
  lesson(2026, 8, 24, 10, { memberNote: "오늘도 자세가 좋아졌어요! 다음 수업에서 복부 호흡을 집중해 볼게요." }),
  lesson(2026, 8, 22, 19, { memberNote: "허리 골반 교정운동을 진행했고, 다음엔 코어 운동강도를 더 높여볼게요:)" }),
  ...[17, 15, 10, 8, 4, 2].map((day) => lesson(2026, 8, day)),
  ...[27, 21, 19, 13, 11, 5, 3].map((day) => lesson(2026, 7, day)),
];

/** 상한(100건)에 닿은 이력. 가장 오래된 달보다 앞은 모르는 구간이다. */
const CAPPED = Array.from({ length: 100 }, (_unused, index) => (
  lesson(2026, 8 - Math.floor(index / 9), (index % 9) * 3 + 1)
));

const JOURNEY = { usedTotal: 26 };

const noop = () => {};

export function memberScreenCases() {
  return [
    { name: "홈", element: <Home view={view({ history: STEADY })} now={NOW} onOpenRecords={noop} /> },
    {
      name: "홈 · 만료 임박",
      /* 날짜는 회원권 자체에 둔다. 홈은 이름과 날짜를 같은 회원권에서 읽는다
         (home-summary.js) -- 문서 꼭대기의 nextExpiresAt 만 바꾸면 회원권과
         어긋난 픽스처가 된다. */
      element: <Home view={view({
        nextExpiresAt: new Date(2026, 9, 1),
        passes: [{ ...view().passes[0], expiresAt: new Date(2026, 9, 1) }],
      })} now={NOW} />,
    },
    { name: "홈 · 잔여 0", element: <Home view={view({
      remainingTotal: 0, passes: [{ ...view().passes[0], remainingCount: 0 }],
    })} now={NOW} /> },
    {
      name: "홈 · 종료 회원",
      element: <Home view={view({
        clientStatus: "ended", remainingTotal: 0, passes: [{ ...view().passes[0], remainingCount: 0 }],
      })} now={NOW} />,
    },
    /* 오늘 받은 수업이 없다. 예정 수업은 아직 데이터에 없으므로 "예정된 수업이
       없어요" 라고 하지 않는다. */
    { name: "홈 · 오늘 수업 없음", element: <Home view={view()} now={NOW} onOpenRecords={noop} /> },
    { name: "홈 · 첫 회원", element: <Home view={view({ history: [] })} now={NOW} /> },
    /* 갓 받은 회원권 -- 서비스가 먼저 쓰이므로 아직 하나도 안 쓴 회원권만
       서비스가 남아 있다 (remainingSplit). */
    { name: "홈 · 새 회원권", element: <Home view={view({
      passes: [{ ...view().passes[0], remainingCount: 22 }],
    })} now={NOW} /> },
    { name: "홈 · 기록 끝", element: <Home view={view({ history: CAPPED })} now={NOW} monthsBack={11} /> },

    { name: "수업기록", element: <Records view={view({ history: STEADY, journey: JOURNEY })} /> },
    {
      name: "수업기록 · 되돌린 차감",
      element: <Records view={view({
        history: [{ occurredAt: new Date(2026, 8, 19), type: "correction", instructorName: "정예진" }],
      })} />,
    },
    { name: "수업기록 · 없음", element: <Records view={view({ history: [] })} /> },

    { name: "마이페이지", element: <MyPage view={view()} now={NOW} onSignOut={noop} /> },
    {
      name: "마이페이지 · 듀엣",
      element: <MyPage view={view({
        passes: [{
          passId: "duet-1", lessonType: "2:1", totalSessions: 30, serviceSessions: 0,
          remainingCount: 29, expiresAt: new Date(2027, 0, 31), status: "active",
          isDuet: true, partnerName: "김민정",
        }],
      })} now={NOW} onSignOut={noop} />,
    },
    { name: "마이페이지 · 회원권 없음", element: <MyPage view={view({ passes: [] })} now={NOW} onSignOut={noop} /> },
    {
      name: "마이페이지 · 계정 삭제 있음",
      element: <MyPage view={view()} now={NOW} onSignOut={noop} onDeleteAccount={async () => {}} />,
    },

    { name: "계정 삭제 · 첫 화면", element: <DeleteAccount onDelete={async () => {}} /> },
    { name: "계정 삭제 안내 (스토어 URL)", element: <DeleteAccountGuide appName="보니따필라테스" /> },
    { name: "연결이 늦다", element: <SlowConnection seconds={10} onRetry={() => {}} /> },
    { name: "진단 · 비어 있음", element: <Diagnostics entries={[]} onClose={() => {}} /> },
    {
      name: "진단 · 기록 있음",
      element: <Diagnostics onClose={() => {}} entries={[{
        at: "2026-09-28T00:30:00.000Z", feature: "auth_init", stage: "auth_state_timeout",
        errorDomain: "firebase_auth", errorCode: "auth_state_never_fired",
        message: "10000ms 안에 로그인 상태가 오지 않았습니다.",
        platform: "ios", appVersion: "1.0.0", appCommit: "5be3511",
      }]} />,
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

    /* 금액이 새는지 한자리에서 본다. 세 화면을 모두 그린다. */
    {
      name: "전부",
      element: (
        <div>
          <Home view={view({ history: STEADY, journey: JOURNEY })} now={NOW} />
          <Records view={view({ history: STEADY, journey: JOURNEY })} />
          <MyPage view={view({ journey: JOURNEY })} now={NOW} onSignOut={noop} onDeleteAccount={async () => {}} />
        </div>
      ),
    },
  ];
}
