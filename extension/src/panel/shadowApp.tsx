// Монтирование React+antd внутрь Shadow DOM. container: shadow направляет стили
// antd cssinjs в shadow root (изоляция от CSS YouTube). React-дерево живёт в div
// внутри shadow — createRoot принимает Element, не сам ShadowRoot.
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { StyleProvider } from "@ant-design/cssinjs";
import { ConfigProvider } from "antd";
import { darkTheme, TEXT } from "../theme/conspectTheme";

export function ShadowApp({
  shadow,
  children,
}: {
  shadow: ShadowRoot;
  children: ReactNode;
}) {
  return (
    <StyleProvider container={shadow}>
      <ConfigProvider theme={darkTheme()}>{children}</ConfigProvider>
    </StyleProvider>
  );
}

export function mountShadow(host: HTMLElement, node: ReactNode): {
  shadow: ShadowRoot;
  root: ReturnType<typeof createRoot>;
} {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  // Граница shadow: сбрасываем наследуемые font/color/line-height от YouTube, чтобы
  // неограниченные элементы не получали шрифт хост-страницы. box-sizing — border-box
  // по умолчанию внутри тени. all:initial НЕ используем — он бы сбросил display/position
  // хостов (overlay fixed) и сломал раскладку.
  const reset = document.createElement("style");
  reset.textContent = `:host{font-family:"Onest",system-ui,sans-serif;color:${TEXT};line-height:normal;font-size:14px;}*,*::before,*::after{box-sizing:border-box;}`;
  shadow.appendChild(reset);
  const inner = document.createElement("div");
  shadow.appendChild(inner);
  const root = createRoot(inner);
  root.render(<ShadowApp shadow={shadow}>{node}</ShadowApp>);
  return { shadow, root };
}
