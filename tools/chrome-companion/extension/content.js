(() => {
  if (document.getElementById("orbit-companion-host")) return;

  const host = document.createElement("div");
  host.id = "orbit-companion-host";
  host.style.cssText = "all:initial;position:fixed;right:24px;bottom:24px;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    button{all:initial;box-sizing:border-box;display:grid;place-items:center;width:52px;height:52px;border:1px solid #7dd3fc;
      border-radius:50%;background:#071321;color:#a5f3fc;box-shadow:0 6px 24px #0009,0 0 18px #22d3ee33;cursor:pointer;
      font:700 17px/1 system-ui,sans-serif;transition:transform .16s ease,box-shadow .16s ease}
    button:hover{transform:translateY(-2px);box-shadow:0 8px 28px #000b,0 0 24px #22d3ee66}
    button:focus-visible{outline:3px solid #fff;outline-offset:3px}
    @media(prefers-reduced-motion:reduce){button{transition:none}}
  `;
  const button = document.createElement("button");
  button.type = "button";
  button.title = "Open ORBIT chat";
  button.setAttribute("aria-label", "Open ORBIT chat");
  button.textContent = "O";
  button.addEventListener("click", () => chrome.runtime.sendMessage({
    type: "open-orbit-chat",
    screen: { width: window.screen.availWidth, height: window.screen.availHeight }
  }));
  shadow.append(style, button);
  document.documentElement.append(host);
})();
