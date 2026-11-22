# ORBIT Chrome Companion

The optional Chrome extension adds a small ORBIT button on YouTube. It reads no page text, captures no screen, and only runs on YouTube. Clicking it opens `/chat` in a compact Chrome popup, where the normal ORBIT sign-in and CORE chat apply. If ORBIT is not running at `http://localhost:3000`, start it first with `npm run app:start`.

## Install for local development

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `tools/chrome-companion/extension` folder.
3. Open YouTube. The ORBIT button appears in the lower left (the lower right is YouTube's miniplayer). Click it to open CORE chat.

This folder is an unpacked, local extension; Chrome's developer-mode warning is expected. To remove it, use **Remove** on the extension card in `chrome://extensions`.
