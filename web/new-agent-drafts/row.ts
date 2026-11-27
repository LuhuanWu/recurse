// Draft rows expose distinct resume/discard actions without creating agents.
import { html, nothing, type TemplateResult } from "lit";
import type { Draft } from "../types.js";
import { conversationUiState } from "../conversation-ui-state/index.js";
import { canDiscardDraft } from "./drafts.js";

export function draftRow(
  draft: Draft,
  actions: {
    selected: boolean;
    parentTitle?: string;
    open: () => void;
    discard: () => void;
  },
): TemplateResult {
  const title = (
    conversationUiState.composer(draft.uiStateId).text.trim() ||
    draft.pending?.[0]?.content ||
    "New agent"
  ).slice(0, 80);
  return html`<div
    class=${`agent draft-row${actions.selected ? " cursor selected" : ""}`}
    data-theme="sidebar-row"
    role="treeitem"
    aria-label=${`Draft: ${title}`}
    aria-level="1"
    aria-selected=${String(actions.selected)}
  >
    <button
      class="btn quiet draft-open"
      aria-label=${`Resume draft: ${title}`}
      aria-current=${actions.selected ? "page" : nothing}
      @click=${actions.open}
    >
      <span class="agent-state draft" aria-hidden="true"
        ><span class="state-mark"></span
      ></span>
      <span class="draft-label"
        ><span class="title">Draft: ${title}</span>
        ${draft.parent
          ? html`<span class="draft-parent"
              >Under ${actions.parentTitle || draft.parent}</span
            >`
          : nothing}
      </span>
    </button>
    <button
      class="btn quiet sm"
      aria-label=${`Discard draft: ${title}`}
      title=${canDiscardDraft(draft)
        ? "Discard draft"
        : "Wait for sending to finish before discarding"}
      ?disabled=${!canDiscardDraft(draft)}
      @click=${actions.discard}
    >
      Discard
    </button>
  </div>`;
}
