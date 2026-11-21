/**
 * FC 회원권 발급 알림 문구 (2026-11-21 대표: "FC 가 수강권 발급 때도 알림이 가게 해줘").
 *
 * FC 가 발급하면 대표 · 총괄의 알림함에 한 줄. 대표가 실수(서비스를 더 줌 · 단가를 손으로 바꿈 · 잔금)를 바로 보도록
 * 눈여겨볼 것을 앞에 따로 적는다. 이 문구는 대표 본인의 알림함에만 간다 -- 대표는 회원 이름을 이미 보는 사람이다.
 * 순수 함수다.
 */

const text = (value) => String(value ?? "").trim();
const intOf = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
const won = (value) => `${intOf(value).toLocaleString("ko-KR")}원`;

export const PASS_ISSUED_INBOX_KIND = "pass_issued_by_fc";

const PAYMENT_LABEL = Object.freeze({ card: "카드", cash: "현금", transfer: "계좌이체", other: "기타결제", mixed: "복합결제" });

/**
 * 눈여겨볼 것. 화면 · 알림이 같은 판단을 쓴다.
 * @returns {string[]}
 */
export function issueWatchPoints(pass) {
  const points = [];
  if (intOf(pass?.serviceSessions) > 0) points.push(`서비스 ${intOf(pass.serviceSessions)}회`);
  if (text(pass?.unitPriceSource) === "manual") points.push("단가 직접 입력");
  if (intOf(pass?.balance) > 0) points.push(`잔금 ${won(pass.balance)}`);
  return points;
}

/**
 * @param {{ issuerName: string, instructorName: string, clientName: string, locationName?: string, productName?: string, pass: any }} input
 * @returns {{ title: string, body: string, watch: string[] }}
 */
export function passIssuedNotice({ issuerName, instructorName, clientName, locationName = "", productName = "", pass }) {
  const watch = issueWatchPoints(pass);
  const sessions = `${intOf(pass?.totalSessions)}회${intOf(pass?.serviceSessions) ? ` + 서비스 ${intOf(pass.serviceSessions)}회` : ""}`;
  const payment = PAYMENT_LABEL[text(pass?.paymentMethod)] || text(pass?.paymentMethod) || "결제수단 없음";
  const where = text(locationName) ? `${text(locationName)} · ` : "";
  return {
    title: watch.length ? `[FC 회원권 발급 · 확인] ${watch.join(" · ")}` : "[FC 회원권 발급]",
    body: `${text(issuerName)} 님이 ${where}${text(clientName) || "회원"} 님께 ${text(productName) || "회원권"} ${sessions} · ${won(pass?.contractPrice)} (${payment}) 을 발급했어요 · 담당 ${text(instructorName) || "강사"}`,
    watch,
  };
}
