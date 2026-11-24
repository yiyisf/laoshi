// Browser UI plugin for DeepSeek Harness (dsh): registers the "需求看板" entry in the left
// sidebar (`sidebar.panellist`) and mounts `/laoshi/` in the `main` panel, syncing themes and
// routing step execution record links back to dsh sessions / subagent records.
window.__ModuleLoader__.load({
  id: "laoshi-dsh-plugin",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const PANEL_ID = "laoshi";

    function detectTheme() {
      if (typeof document === "undefined") return "dark";
      if (document.body && document.body.hasAttribute("data-ds-dark-theme")) return "dark";
      const scheme = document.documentElement && document.documentElement.style ? document.documentElement.style.colorScheme : "";
      if (scheme === "light" || scheme === "dark") return scheme;
      const source = document.documentElement ? document.documentElement.getAttribute("data-ds-theme-source") : "";
      if (source === "light" || source === "dark") return source;
      if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      }
      return "dark";
    }

    function BoardIcon(props) {
      const size = (props && props.size) || 18;
      return react.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        react.createElement("rect", { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
        react.createElement("path", { d: "M8 8v7" }),
        react.createElement("path", { d: "M12 8v5" }),
        react.createElement("path", { d: "M16 8v8" }),
      );
    }

    function makeBoardPanel(ctx) {
      return function LaoshiBoardPanel() {
        const iframeRef = react.useRef(null);
        const initialThemeRef = react.useRef(null);
        if (initialThemeRef.current === null) initialThemeRef.current = detectTheme();

        const postTheme = react.useCallback(() => {
          const win = iframeRef.current && iframeRef.current.contentWindow;
          if (!win) return;
          win.postMessage({ type: "laoshi:theme", theme: detectTheme() }, window.location.origin);
        }, []);

        react.useEffect(() => {
          postTheme();
          if (typeof MutationObserver !== "function" || typeof document === "undefined") return undefined;
          const observer = new MutationObserver(() => postTheme());
          if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
          if (document.documentElement) {
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-ds-theme-source"] });
          }
          return () => observer.disconnect();
        }, [postTheme]);

        react.useEffect(() => {
          const onMessage = (event) => {
            if (event.origin !== window.location.origin) return;
            const win = iframeRef.current && iframeRef.current.contentWindow;
            if (win && event.source !== win) return;
            const msg = event.data;
            if (!msg || typeof msg !== "object" || msg.type !== "laoshi:open-session") return;
            const sessionId = typeof msg.sessionId === "string" ? msg.sessionId.trim() : "";
            if (!sessionId) return;
            const parentSessionId = typeof msg.parentSessionId === "string" ? msg.parentSessionId.trim() : "";
            try {
              if (parentSessionId && parentSessionId !== sessionId) {
                ctx.uiWorkspace.openSession({ parentSessionId, childSessionId: sessionId, mode: "continuable" });
              } else {
                ctx.uiWorkspace.openSession(sessionId);
              }
            } catch {
              // Ignore unavailable or purged session targets.
            }
          };
          window.addEventListener("message", onMessage);
          return () => window.removeEventListener("message", onMessage);
        }, []);

        return react.createElement("iframe", {
          ref: iframeRef,
          src: "/laoshi/?theme=" + encodeURIComponent(initialThemeRef.current),
          title: "需求看板",
          onLoad: postTheme,
          style: {
            width: "100%",
            height: "100%",
            border: "none",
            display: "block",
            flex: "1 1 auto",
            minHeight: 0,
            backgroundColor: "transparent",
          },
        });
      };
    }

    const inject = ["slots", "uiWorkspace"];

    function apply(ctx) {
      const BoardPanel = makeBoardPanel(ctx);
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 15,
            label: () => "需求看板",
          },
          BoardIcon,
        ),
      );
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
          },
          BoardPanel,
        ),
      );
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
