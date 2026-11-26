// Explorer Markdown shares document rendering, but leaves unresolved file links
// inert. Source comments stay on their original DOM while preview media aborts on leave.
import { renderDocumentMarkdown } from "../document-markdown.js";

export const isMarkdownFile = (path: string): boolean =>
  /\.(md|markdown)$/i.test(path);
const previews = new WeakMap<
  HTMLElement,
  {
    body: HTMLElement;
    text: string;
    path: string;
    controller: AbortController;
  }
>();

export function stopMarkdown(element: HTMLElement): void {
  previews.get(element)?.controller.abort();
  previews.delete(element);
}

export function syncMarkdown(
  element: HTMLElement,
  cid: string,
  path: string,
  text: string,
): void {
  const body = element.querySelector<HTMLElement>(".explorer-markdown");
  const previous = previews.get(element);
  if (
    previous?.body === body &&
    previous.text === text &&
    previous.path === path
  )
    return;
  stopMarkdown(element);
  if (!body) return;
  const controller = new AbortController();
  previews.set(element, { body, text, path, controller });
  body.replaceChildren();
  renderDocumentMarkdown(body, text, {
    title: path.split("/").at(-1)!,
    agentId: cid,
    documentPath: path,
    signal: controller.signal,
    resolveRelative: () => null,
    openRelative: () => false,
  });
  let blocked = false;
  for (const link of body.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = link.getAttribute("href")!;
    if (!/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) {
      link.removeAttribute("href");
      link.classList.add("artifact-blocked-link");
      link.setAttribute("aria-disabled", "true");
      link.title = "Open this file from Explorer.";
      blocked = true;
    }
  }
  if (blocked) {
    const note = document.createElement("p");
    note.className = "html-file-note";
    note.textContent =
      "File links are unavailable in preview. Open them from Explorer.";
    body.prepend(note);
  }
}
