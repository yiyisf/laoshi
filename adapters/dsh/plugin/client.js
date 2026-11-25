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
    let pendingOpen = null;
    const openListeners = new Set();
    const matchedSessionCache = new Map();

    function postOpenRequirement(win, target) {
      if (!win || !target) return false;
      win.postMessage(
        {
          type: "laoshi:open-requirement",
          key: target.key || "",
          repo: target.repo || "",
          featureDir: target.featureDir || "",
        },
        window.location.origin,
      );
      return true;
    }

    function requestOpenRequirement(target) {
      pendingOpen = target;
      for (const listener of openListeners) listener(target);
    }

    function takePendingOpen() {
      const current = pendingOpen;
      pendingOpen = null;
      return current;
    }

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
        const initialOpenRef = react.useRef(null);
        if (initialOpenRef.current === null) initialOpenRef.current = takePendingOpen() || false;

        const postTheme = react.useCallback(() => {
          const win = iframeRef.current && iframeRef.current.contentWindow;
          if (!win) return;
          win.postMessage({ type: "laoshi:theme", theme: detectTheme() }, window.location.origin);
        }, []);

        const handleIframeLoad = react.useCallback(() => {
          postTheme();
          const queued = takePendingOpen();
          if (queued) postOpenRequirement(iframeRef.current && iframeRef.current.contentWindow, queued);
        }, [postTheme]);

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
          const onOpenRequest = (target) => {
            const win = iframeRef.current && iframeRef.current.contentWindow;
            if (!win) return;
            if (postOpenRequirement(win, target) && pendingOpen === target) pendingOpen = null;
          };
          openListeners.add(onOpenRequest);
          return () => openListeners.delete(onOpenRequest);
        }, []);

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

        const srcParams = ["theme=" + encodeURIComponent(initialThemeRef.current)];
        if (initialOpenRef.current && initialOpenRef.current.key) {
          srcParams.push("open=" + encodeURIComponent(initialOpenRef.current.key));
          if (initialOpenRef.current.repo) srcParams.push("repo=" + encodeURIComponent(initialOpenRef.current.repo));
          if (initialOpenRef.current.featureDir) srcParams.push("feature=" + encodeURIComponent(initialOpenRef.current.featureDir));
        }

        return react.createElement("iframe", {
          ref: iframeRef,
          src: "/laoshi/?" + srcParams.join("&"),
          title: "需求看板",
          onLoad: handleIframeLoad,
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

    function makeSessionRequirementButton(ctx) {
      return function SessionRequirementButton(props) {
        const sessionId = typeof props?.sessionId === "string" ? props.sessionId.trim() : "";
        const openState = typeof props?.useSession === "function" ? props.useSession((s) => s && s.openState) : "open";
        const visible = Boolean(sessionId) && openState === "open";
        const [match, setMatch] = react.useState(() => (sessionId && matchedSessionCache.get(sessionId)) || null);

        react.useEffect(() => {
          setMatch((sessionId && matchedSessionCache.get(sessionId)) || null);
        }, [sessionId]);

        react.useEffect(() => {
          if (!visible) return undefined;
          const cached = matchedSessionCache.get(sessionId);
          if (cached) {
            setMatch(cached);
            return undefined;
          }
          let cancelled = false;
          let activeController = null;
          const check = () => {
            if (cancelled || matchedSessionCache.has(sessionId) || typeof fetch !== "function") return;
            if (activeController) activeController.abort();
            const controller = typeof AbortController === "function" ? new AbortController() : null;
            activeController = controller;
            fetch("/laoshi/api/session-requirement?sessionId=" + encodeURIComponent(sessionId), {
              credentials: "same-origin",
              ...(controller ? { signal: controller.signal } : {}),
            })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (cancelled || !data || !data.matched) return;
                matchedSessionCache.set(sessionId, data);
                setMatch(data);
              })
              .catch(() => {
                // Keep quiet on offline / aborted checks.
              });
          };
          check();
          const onFocus = () => check();
          if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
          const timer = typeof setInterval === "function" ? setInterval(check, 8000) : null;
          return () => {
            cancelled = true;
            if (activeController) activeController.abort();
            if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
            if (timer !== null && typeof clearInterval === "function") clearInterval(timer);
          };
        }, [visible, sessionId]);

        if (!visible || !match || !match.matched) return null;

        const labelText = "需求：" + (match.title || match.featureDir || "详情");
        const tooltip = labelText + (match.stage ? "（" + match.stage + "）" : "") + " — 在需求看板中查看详情";

        return react.createElement(
          "button",
          {
            type: "button",
            "data-laoshi-requirement-entry": "",
            title: tooltip,
            "aria-label": labelText,
            onClick: () => {
              requestOpenRequirement({
                key: match.key || "",
                repo: match.repo || "",
                featureDir: match.featureDir || "",
              });
              ctx.layout.selectPanel(PANEL_ID);
            },
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              height: "28px",
              maxWidth: "240px",
              padding: "0 10px",
              borderRadius: "999px",
              border: "1px solid var(--ds-border-subtle, rgba(128, 128, 128, 0.28))",
              background: "transparent",
              color: "inherit",
              fontSize: "12px",
              lineHeight: 1,
              cursor: "pointer",
            },
          },
          react.createElement(BoardIcon, { size: 14 }),
          react.createElement(
            "span",
            {
              style: {
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            },
            labelText,
          ),
        );
      };
    }

    const inject = ["slots", "layout", "uiWorkspace"];

    function apply(ctx) {
      const BoardPanel = makeBoardPanel(ctx);
      const SessionRequirementButton = makeSessionRequirementButton(ctx);
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
      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "laoshi-requirement",
            order: -6,
            inject: (sessionId) => ({ sessionId }),
          },
          SessionRequirementButton,
        ),
      );
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
