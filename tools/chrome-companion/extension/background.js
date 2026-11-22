chrome.windows.onRemoved.addListener(async (id) => {
  const { chatWindowId } = await chrome.storage.session.get("chatWindowId");
  if (id === chatWindowId) await chrome.storage.session.remove("chatWindowId");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open-orbit-chat") return;
  chrome.storage.session.get("chatWindowId", ({ chatWindowId }) => {
    if (chatWindowId !== undefined) {
      chrome.windows.update(chatWindowId, { focused: true }, () => {
        if (!chrome.runtime.lastError) return sendResponse({ ok: true });
        void chrome.storage.session.remove("chatWindowId").then(() => openChat(message.screen)).then(() => sendResponse({ ok: true }));
      });
      return;
    }
    openChat(message.screen).then(() => sendResponse({ ok: true }));
  });
  return true;
});

function openChat(screenSize = {}) {
  return new Promise((resolve) => {
    const width = Math.min(460, Math.max(320, Number(screenSize.width) - 24 || 460));
    const height = Math.min(720, Math.max(420, Number(screenSize.height) - 48 || 720));
    chrome.windows.create({
      url: "http://localhost:3000/chat",
      type: "popup",
      left: Math.max(0, Number(screenSize.width) - width - 24 || 0),
      top: 24,
      width,
      height,
      focused: true
    }, (win) => {
      if (chrome.runtime.lastError || win?.id === undefined) return resolve(false);
      void chrome.storage.session.set({ chatWindowId: win.id }).then(() => resolve(true));
    });
  });
}
