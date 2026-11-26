// Trusted controls query an opaque frame for a bounded quote. A single-use
// per-document nonce binds a private port; only a real parent click opens a
// draft. Frame messages never choose identity, markup, comment text or sends.
const resets = new WeakMap<HTMLIFrameElement, (fragment?: string) => void>();

export function resetHtmlComments(
  frame: HTMLIFrameElement,
  fragment?: string,
): void {
  resets.get(frame)?.(fragment);
}

export function htmlPreviewFragment(): string {
  return (
    "#recurse-preview=" +
    Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-")
  );
}

export function htmlPreviewComments(
  frame: HTMLIFrameElement,
  signal: AbortSignal,
  active: () => boolean = () => true,
): HTMLElement {
  const controls = document.createElement("div");
  controls.className = "html-preview-comments";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn sm";
  button.textContent = "Comment on selection…";
  button.disabled = true;
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  controls.append(button, status);
  let port: MessagePort | undefined;
  let spent = "";
  let loaded = "";
  let sequence = 0;
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expectedToken = frame.src.slice(frame.src.lastIndexOf("#") + 1);
  const token = () => expectedToken;
  const visible = () =>
    !signal.aborted &&
    active() &&
    frame.isConnected &&
    controls.isConnected &&
    frame.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const disconnect = () => {
    port?.close();
    port = undefined;
    pending = 0;
    clearTimeout(timer);
    button.disabled = true;
  };
  resets.set(frame, (fragment) => {
    disconnect();
    if (fragment) expectedToken = fragment.slice(1);
    status.textContent = "";
  });
  window.addEventListener(
    "message",
    (event) => {
      const data = event.data;
      if (
        signal.aborted ||
        !frame.isConnected ||
        event.source !== frame.contentWindow ||
        !data ||
        Object.keys(data).length !== 2 ||
        data.type !== "recurse-preview-selection:connect" ||
        event.ports.length !== 1 ||
        typeof data.token !== "string" ||
        !/^recurse-(app-state|preview)=[0-9-]{16,160}$/.test(data.token) ||
        data.token !== token() ||
        data.token === spent
      )
        return;
      disconnect();
      spent = data.token;
      const connectedToken = spent;
      const connection = event.ports[0]!;
      port = connection;
      status.textContent = "";
      button.disabled = loaded !== connectedToken;
      connection.onmessage = ({ data, ports }) => {
        if (
          port === connection &&
          token() === connectedToken &&
          ports.length === 0 &&
          data?.type === "closed" &&
          Object.keys(data).length === 1
        ) {
          disconnect();
          status.textContent = "Preview changed. Reopen it to comment.";
          return;
        }
        if (
          !pending ||
          port !== connection ||
          token() !== connectedToken ||
          !visible() ||
          ports.length ||
          !data ||
          Object.keys(data).length !== 3 ||
          data.type !== "selection" ||
          data.request !== pending ||
          typeof data.quote !== "string" ||
          data.quote.length > 600
        )
          return;
        pending = 0;
        clearTimeout(timer);
        button.disabled = false;
        const quote = data.quote.replace(/\s+/g, " ").trim();
        status.textContent = quote ? "" : "Select text in the preview first.";
        if (!quote) return;
        button.dispatchEvent(
          new CustomEvent("recurse:frame-quote", {
            bubbles: true,
            detail: {
              quote,
              anchor: button,
              valid: () =>
                visible() && port === connection && token() === connectedToken,
            },
          }),
        );
      };
    },
    { signal },
  );
  frame.addEventListener(
    "load",
    () => {
      const current = token();
      if (loaded === current) {
        disconnect();
        status.textContent = "Preview changed. Reopen it to comment.";
      }
      loaded = current;
      button.disabled = !port || spent !== current;
    },
    { signal },
  );
  button.addEventListener("click", (event) => {
    if (!event.isTrusted || !visible() || !port || pending) return;
    pending = ++sequence;
    status.textContent = "Reading selection…";
    button.disabled = true;
    port.postMessage({ type: "selection", request: pending });
    timer = setTimeout(() => {
      pending = 0;
      button.disabled = !port;
      status.textContent =
        "Couldn’t read the selection. Select text and try again.";
    }, 2000);
  });
  signal.addEventListener(
    "abort",
    () => {
      disconnect();
      resets.delete(frame);
    },
    { once: true },
  );
  return controls;
}
