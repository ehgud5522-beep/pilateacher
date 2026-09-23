/**
 * 연결 결과 하나하나에 화면을 준다.
 *
 * 서버(`functions/src/member-link.js`)가 여섯 가지를 구분해 돌려주는데, 화면이
 * 그중 몇을 "오류입니다" 로 뭉개면 그 구분은 없는 것과 같다. 여섯이 서로 다른
 * **할 일**을 뜻한다:
 *
 *   linked·ended·multi_location  들어간다
 *   ambiguous                    센터가 골라 줘야 한다
 *   not_found                    센터에 등록부터 해야 한다
 *   taken                        이미 다른 계정의 번호다
 *
 * 재시도 버튼을 아무 데나 두지 않는다. 다시 눌러도 같은 답이 나오는 곳에
 * 버튼을 두면 회원은 그것을 누르느라 센터에 전화하지 않는다.
 */

/** Keep in sync with LINK_STATUS in functions/src/member-link.js. */
export const LINK_RESULT = Object.freeze({
  LINKED: "linked",
  ENDED: "ended",
  MULTI_LOCATION: "multi_location",
  AMBIGUOUS: "ambiguous",
  NOT_FOUND: "not_found",
  TAKEN: "taken",
  REJECTED: "rejected",
});

/** 들어갈 수 있는 상태. 나머지는 안내 화면에서 멈춘다. */
export const OPENS_HOME = Object.freeze([
  LINK_RESULT.LINKED, LINK_RESULT.ENDED, LINK_RESULT.MULTI_LOCATION,
]);

/**
 * 이 결과로 무엇을 보여줄 것인가.
 *
 * @param {string} status
 * @returns {{ opensHome: boolean, title: string, body: string, retry: boolean }}
 */
export function linkResultScreen(status) {
  const key = String(status ?? "").trim();
  if (OPENS_HOME.includes(key)) {
    return {
      opensHome: true,
      title: key === LINK_RESULT.ENDED ? "이용이 종료된 회원권이에요" : "",
      /* 종료된 회원에게도 지난 기록은 보여준다. 함께한 시간이 사라지는 것이
         아니고, 그 기록이 다시 오는 이유가 되기도 한다. */
      body: key === LINK_RESULT.ENDED ? "지난 수업 기록은 그대로 보실 수 있어요." : "",
      retry: false,
    };
  }
  if (key === LINK_RESULT.AMBIGUOUS) {
    return {
      opensHome: false,
      title: "확인이 필요해요",
      /* 같은 번호로 등록된 분이 둘 이상이다. 서버가 짐작해서 이으면 남의
         회원권을 보게 되고, 그 사실은 아무도 모른다. */
      body: "같은 번호로 등록된 분이 두 분 이상이라, 센터에서 확인 후 연결해 드릴게요.",
      retry: false,
    };
  }
  if (key === LINK_RESULT.TAKEN) {
    return {
      opensHome: false,
      title: "이미 다른 계정에 연결된 번호예요",
      body: "가족과 번호를 함께 쓰시는 경우일 수 있어요. 센터에 문의해 주세요.",
      retry: false,
    };
  }
  if (key === LINK_RESULT.NOT_FOUND) {
    return {
      opensHome: false,
      title: "등록된 번호를 찾지 못했어요",
      body: "센터에 등록된 연락처와 다를 수 있어요. 센터에 문의해 주세요.",
      retry: false,
    };
  }
  /* 분류하지 못한 것도 숨기지 않는다. 코드 없는 "오류가 발생했습니다" 는
     회원도 센터도 아무것도 할 수 없게 만든다. */
  return {
    opensHome: false,
    title: "연결하지 못했어요",
    body: `잠시 뒤 다시 시도해 주세요. (코드 ${key || "unknown"})`,
    retry: true,
  };
}
