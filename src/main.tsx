import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CaptureApp } from "./capture/CaptureApp";

const CAPTURE_WINDOW = "capture";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{getCurrentWindow().label === CAPTURE_WINDOW ? <CaptureApp /> : <App />}</React.StrictMode>,
);
