/* 글자 크기 단계.

   여섯 개뿐이고 예외가 없다. 이 앱은 크기가 열다섯 가지였고, 그중 3분의 2가
   12px 이하였다. 크기가 많으면 위계가 서는 것이 아니라 흐려진다 -- 11px 과
   12px 은 나란히 놓아도 어느 쪽이 중요한지 말해 주지 않는다.

   그래서 크기로 나누던 위계를 굵기와 색으로 옮긴다. 크기는 여섯 단계 중
   하나를 고르는 일이 되고, "이건 조금 작게" 는 더 이상 선택지가 아니다.

   바닥은 13px 이다. 안드로이드 폰에서 그 아래는 읽는 것이 아니라 알아보는
   것에 가깝다. 자리에 안 들어가면 크기를 줄이지 말고 자르거나(…) 담는 양을
   줄인다 -- 글자 수에 따라 폰트를 줄이는 것은 읽을 사람이 아니라 상자를
   위한 결정이다.

   값은 index.css 의 CSS 변수 한 곳에 있다. 여기서는 그 변수를 가리키기만
   하므로, 인라인 스타일과 Tailwind 클래스가 같은 값을 본다. */

export const TYPE_STEPS = Object.freeze({
  caption: 13,
  body: 15,
  title: 17,
  heading: 20,
  display: 24,
  hero: 32,
});

export const TYPE_STEP_NAMES = Object.freeze(Object.keys(TYPE_STEPS));
export const TYPE_MIN_PX = TYPE_STEPS.caption;

/* 인라인 style 에서 쓰는 값. style={{ fontSize: TYPE.caption }} */
export const TYPE = Object.freeze(Object.fromEntries(
  TYPE_STEP_NAMES.map((name) => [name, `var(--t-${name})`]),
));

/* 어떤 px 이 어느 단계인가. 옮길 때 쓰고, 새 값을 고를 때도 쓴다.

   꼭 가운데면 큰 쪽으로 올린다. 14px 은 13 과 15 사이 정확히 가운데인데,
   내리면 지금보다 작아진다 -- 작아서 고치는 중에 더 작아지는 것은 앞뒤가
   맞지 않는다.

   40px 을 넘는 것은 글자가 아니라 그림이다 -- 카운트다운 숫자 같은 것은
   이 단계에 넣지 않는다. */
export function nearestTypeStep(px) {
  /* Number(null) 은 0 이라 그냥 넘기면 빈 값이 caption 이 된다. 크기를 정하는
     함수가 값 없음을 가장 작은 단계로 읽으면 안 된다. */
  const size = typeof px === "number" ? px
    : typeof px === "string" && px.trim() !== "" ? Number(px)
    : NaN;
  if (!Number.isFinite(size) || size > 40) return null;
  return TYPE_STEP_NAMES.reduce((best, name) => (
    Math.abs(TYPE_STEPS[name] - size) <= Math.abs(TYPE_STEPS[best] - size) ? name : best
  ), TYPE_STEP_NAMES[0]);
}
