import "./style.css";
import type { MiniAppTheme } from "@discourse-mini-app/sdk";
import { startApp } from "./app.ts";
import { createHost, tryGetSDK } from "./host.ts";
import messages from "./strings.json";

function applyTheme(theme: MiniAppTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme.mode;
  root.dataset.themeLocked = "1";
  root.dataset.reducedMotion = String(theme.reducedMotion);
  root.style.colorScheme = theme.mode;
  root.style.setProperty("--bg", theme.background);
  root.style.setProperty("--text", theme.text);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--line", theme.border);
}

const pending: { notice?: string; theme?: MiniAppTheme } = {};
let api: Awaited<ReturnType<typeof startApp>> | null = null;

const host = createHost(tryGetSDK(), messages, {
  onNotice(text) {
    if (api) api.notice(text);
    else pending.notice = text;
  },
  onTheme(theme) {
    applyTheme(theme);
    if (api) {
      api.setTheme(theme.mode, theme.reducedMotion);
      api.localize();
    } else pending.theme = theme;
  },
});

void startApp(host).then((started) => {
  api = started;
  if (pending.theme) {
    applyTheme(pending.theme);
    api.setTheme(pending.theme.mode, pending.theme.reducedMotion);
    api.localize();
  }
  if (pending.notice) api.notice(pending.notice);
});
