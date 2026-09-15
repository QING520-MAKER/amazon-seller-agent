import { XProvider } from "@ant-design/x";
import xZhCN from "@ant-design/x/locale/zh_CN";
import { App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { PropsWithChildren } from "react";

export function WorkbenchTheme({ children }: PropsWithChildren) {
  return <XProvider locale={{ ...zhCN, ...xZhCN }} theme={{
    token: {
      colorPrimary: "#315efb",
      colorText: "#172033",
      colorTextSecondary: "#69758a",
      colorBorder: "#e0e5ed",
      colorBgContainer: "#ffffff",
      borderRadius: 8,
      fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: 14,
      controlHeight: 36,
    },
    components: {
      Table: { headerBg: "#f7f9fc" }, Button: { primaryShadow: "none" },
      Conversations: { creationBgColor: "transparent", creationBorderColor: "#315efb", creationHoverColor: "#edf3ff" },
    },
  }}><AntApp>{children}</AntApp></XProvider>;
}
