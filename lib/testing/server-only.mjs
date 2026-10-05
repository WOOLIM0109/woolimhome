import { registerHooks } from "node:module";

// Node 단위 테스트에서만 Next의 서버 경계 표식을 해석합니다.
// 서비스 코드·외부 호출은 대체하지 않습니다. 실제 빌드에서는 Next가 경계를 검사합니다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
