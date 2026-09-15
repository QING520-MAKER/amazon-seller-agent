import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css";
import "./styles.css";
import App from "./App.js";
import { WorkbenchTheme } from "./theme.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><WorkbenchTheme><App /></WorkbenchTheme></React.StrictMode>,
);
