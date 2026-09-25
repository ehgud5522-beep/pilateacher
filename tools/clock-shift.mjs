/**
 * 시계를 앞으로 옮겨 테스트를 돌린다. `node --import ./tools/clock-shift.mjs`.
 *
 * ── 왜 필요한가 ──
 * 픽스처가 오늘에 기대면 **만든 날에만 통과한다.** 이 저장소에서 그 일이
 * 네 번 있었다.
 *
 *   1. 오늘 06:00 수업 픽스처 -- 아침에 돌리면 아직 시작 전이었다
 *   2. `toISOString()` 으로 만든 "내일" -- UTC 라 한국 아침에는 오늘이었다
 *   3. 차감 소급 창 7일 + 박힌 날짜 -- 여드레째 되는 날 열 개가 무너졌다
 *   4. 그 열 개가 main 에 남아 Codemagic 을 멈춰 세웠다
 *
 * 마지막이 특히 나쁘다. **CI 는 나중에 돌기 때문에 나중에 터진다** -- 고친
 * 사람은 이미 다른 일을 하고 있고, 무너진 화면은 그 사람의 것이 아니다.
 *
 * ── 어떻게 옮기나 ──
 * `Date` 를 상속하지 않고 Proxy 로 감싼다. 상속하면 `x instanceof Date` 가
 * 거짓이 되는 자리가 생긴다 -- 다른 데서 만들어진 진짜 Date 는 새 클래스의
 * 인스턴스가 아니기 때문이다. 이 저장소에는 `value instanceof Date` 로 갈래를
 * 파는 코드가 여럿 있어서(toDate 계열), 그러면 시계와 상관없는 실패가
 * 쏟아진다. Proxy 는 prototype 을 그대로 넘겨주므로 그 검사가 계속 참이다.
 *
 * 인자를 준 `new Date(x)` 는 건드리지 않는다. 옮기는 것은 **"지금"** 뿐이다.
 */

const days = Number(process.env.CLOCK_SHIFT_DAYS || 0);
const offsetMs = Number.isFinite(days) ? days * 24 * 60 * 60 * 1000 : 0;

if (offsetMs !== 0) {
  const RealDate = Date;
  const shiftedNow = () => RealDate.now() + offsetMs;

  globalThis.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      // 인자가 없을 때만 "지금" 이다. 나머지는 원래대로 만든다.
      if (args.length === 0) return Reflect.construct(target, [shiftedNow()], newTarget);
      return Reflect.construct(target, args, newTarget);
    },
    get(target, prop, receiver) {
      if (prop === "now") return shiftedNow;
      return Reflect.get(target, prop, receiver);
    },
  });

  /* performance.now 는 건드리지 않는다. 그것은 벽시계가 아니라 경과 시간이고,
     옮기면 테스트 러너의 시간 측정이 망가진다. */

  /* 혼자 부를 때는 어디로 옮겼는지 한 줄 알려 준다. test-clock 은 워커를
     백오십 개쯤 띄우므로 같은 줄이 백오십 번 찍힌다 -- 거기서는 껐고,
     대신 그쪽이 묶음마다 한 번만 찍는다. */
  if (!process.env.CLOCK_SHIFT_QUIET) {
    process.stdout.write(`[clock-shift] +${days}일 → ${new globalThis.Date().toISOString()}\n`);
  }
}
