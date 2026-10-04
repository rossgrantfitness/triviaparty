import { ServerConnection, resolveServerUrl, statusText } from "./connection";

const statusEl = document.querySelector<HTMLParagraphElement>("#status");
if (!statusEl) throw new Error("index.html is missing #status");

const url = resolveServerUrl(window.location, import.meta.env.VITE_SERVER_URL);

const connection = new ServerConnection(url, {
  onState(state, detail) {
    statusEl.dataset.state = state;
    statusEl.textContent = statusText(state, detail);
  },
});
connection.start();
