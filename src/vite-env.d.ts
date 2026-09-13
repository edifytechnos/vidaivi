/// <reference types="vite/client" />
declare module "katex/contrib/auto-render" {
  const renderMathInElement: (el: HTMLElement, opts?: object) => void;
  export default renderMathInElement;
}
