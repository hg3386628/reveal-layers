import type {
  MiniAppSDK,
  MiniAppTheme,
  Permission,
} from "@discourse-mini-app/sdk";

export type HostSDK = Pick<MiniAppSDK, "ready"> & {
  permissions: Pick<MiniAppSDK["permissions"], "has">;
  theme?: Pick<MiniAppSDK["theme"], "get" | "onChange">;
  localStorage?: Partial<MiniAppSDK["localStorage"]>;
  lifecycle?: MiniAppSDK["lifecycle"];
  fullscreen?: MiniAppSDK["fullscreen"];
  assets?: MiniAppSDK["assets"];
};

export function tryGetSDK(): HostSDK | null {
  try {
    const mini = (globalThis as { miniApp?: MiniAppSDK }).miniApp;
    if (mini) return mini;
  } catch {
    /* not running in the Discourse mini-app loader */
  }
  return null;
}

export function createHost(
  sdk: HostSDK | null,
  messages: Record<string, Record<string, string>>,
  callbacks: {
    onNotice?: (text: string) => void;
    onTheme?: (theme: MiniAppTheme) => void;
  } = {}
) {
  let locale = "zh_CN";
  let connected = false;
  let unsubscribe: (() => void) | null | undefined;
  let writes: Promise<unknown> = Promise.resolve();

  const t = (key: string, values: object = {}) =>
    (messages[locale]?.[key] ?? messages.zh_CN?.[key] ?? key).replace(
      /\{(\w+)\}/g,
      (_: string, name: string) =>
        String((values as Record<string, unknown>)[name] ?? "")
    );

  const has = (permission: Permission) =>
    Boolean(connected && sdk?.permissions.has(permission));

  const report = (error: unknown) => {
    const code = (error as { code?: unknown } | null)?.code;
    console.warn("[揭层] Community API failed", error);
    callbacks.onNotice?.(
      t("apiError", {
        code:
          typeof code === "string"
            ? code
            : error instanceof Error
              ? error.name
              : "UNKNOWN_ERROR",
      })
    );
  };

  async function call<T, F = null>(
    permission: Permission,
    action: () => T | Promise<T>,
    fallback: F = null as F
  ): Promise<T | F> {
    if (!has(permission)) return fallback;
    try {
      return await action();
    } catch (error) {
      report(error);
      return fallback;
    }
  }

  const applyTheme = (theme: MiniAppTheme) => {
    locale = Object.hasOwn(messages, theme.locale) ? theme.locale : "zh_CN";
    callbacks.onTheme?.(theme);
  };

  return {
    t,
    has,
    get locale() {
      return locale;
    },
    async connect() {
      unsubscribe?.();
      unsubscribe = null;
      if (!sdk) return;
      try {
        await sdk.ready;
        connected = true;
        if (has("theme.read") && sdk.theme) {
          unsubscribe = sdk.theme.onChange(applyTheme);
          const theme = await call("theme.read", () => sdk.theme!.get());
          if (theme) applyTheme(theme);
        }
      } catch (error) {
        report(error);
      }
    },
    async readAsset(path: string): Promise<Uint8Array | null> {
      if (!sdk?.assets) return null;
      try {
        await sdk.ready;
        return await sdk.assets.readBytes(path);
      } catch (error) {
        report(error);
        return null;
      }
    },
    load(key: string) {
      return call("storage.read", () => sdk!.localStorage!.getItem!(key));
    },
    save(key: string, value: string) {
      if (!has("storage.write")) return writes;
      writes = writes.then(() =>
        call("storage.write", () => sdk!.localStorage!.setItem!(key, value))
      );
      return writes;
    },
    async requestFullscreen() {
      if (has("fullscreen") && sdk?.fullscreen) {
        return sdk.fullscreen.request();
      }
      return null;
    },
    async exitFullscreen() {
      if (has("fullscreen") && sdk?.fullscreen) {
        return sdk.fullscreen.exit();
      }
      return null;
    },
    async rendered() {
      if (!sdk?.lifecycle) return;
      try {
        await sdk.lifecycle.ready();
      } catch (error) {
        report(error);
      }
    },
    dispose() {
      connected = false;
      unsubscribe?.();
    },
  };
}

export type Host = ReturnType<typeof createHost>;
