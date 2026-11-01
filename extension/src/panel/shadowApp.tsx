// Mounting React+antd inside a Shadow DOM. container: shadow directs antd cssinjs
// styles into the shadow root (isolation from YouTube's CSS). The React tree lives in a div
// inside the shadow — createRoot accepts an Element, not the ShadowRoot itself.
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
  // The shadow boundary: reset inheritable font/color/line-height from YouTube so
  // unstyled elements do not get the host page's font. box-sizing — border-box
  // by default inside the shadow. We do NOT use all:initial — it would reset the hosts'
  // display/position (fixed overlays) and break the layout.
  const reset = document.createElement("style");
  reset.textContent = `:host{font-family:"Onest",system-ui,sans-serif;color:${TEXT};line-height:normal;font-size:14px;}*,*::before,*::after{box-sizing:border-box;}`;
  shadow.appendChild(reset);
  const inner = document.createElement("div");
  shadow.appendChild(inner);
  const root = createRoot(inner);
  root.render(<ShadowApp shadow={shadow}>{node}</ShadowApp>);
  return { shadow, root };
}
