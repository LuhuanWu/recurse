// Owns bounded, tab-local new-agent drafts until explicit discard or creation.
// Navigation retains every owner payload; only this registry pins draft owners.
import type { Draft, DraftCreator } from "../types.js";
import { state, visibleAgent } from "../state.js";
import { transferStagedAttachmentOwner } from "../attachments.js";
import { conversationUiState } from "../conversation-ui-state/index.js";
import {
  discardComposerOwner,
  transferComposerOwner,
} from "../composer/index.js";

const drafts = new Map<string, Draft>();
let cancelSends: (draft: Draft) => void = () => {};
let sending: (draft: Draft) => boolean = () => false;

export function setDraftSendCancellation(
  cancel: (draft: Draft) => void,
  inFlight: (draft: Draft) => boolean,
): void {
  cancelSends = cancel;
  sending = inFlight;
}

export function newAgentDrafts(): Draft[] {
  return [...drafts.values()];
}

export function retainDraft(draft: Draft): boolean {
  if (!drafts.has(draft.uiStateId) && drafts.size >= 20) {
    alert(
      "You have 20 open drafts. Send or discard a draft before opening another.",
    );
    return false;
  }
  conversationUiState.retainDraftOwner(draft.uiStateId);
  drafts.set(draft.uiStateId, draft);
  return true;
}

export function canDiscardDraft(draft: Draft): boolean {
  return (!draft.creator || draft.creator.failed === true) && !sending(draft);
}

export function discardDraft(
  draft: Draft,
  select: (id: string) => void,
): boolean {
  if (
    !canDiscardDraft(draft) ||
    !confirm(
      "Discard this draft?\n\nIts unsent text, settings and attachments will be lost.",
    )
  )
    return false;
  cancelSends(draft);
  if (state.draft === draft)
    select(
      (draft.parent && visibleAgent(draft.parent)
        ? draft.parent
        : Object.keys(state.nodes)[0]) || "",
    );
  drafts.delete(draft.uiStateId);
  discardComposerOwner(draft.uiStateId);
  return true;
}

export function createdDraft(creator: DraftCreator): Draft | undefined {
  return newAgentDrafts().find((draft) => draft.creator === creator);
}

export function finishDraft(
  draft: Draft,
  conversation: string,
  foreground: boolean,
): void {
  if (!foreground) {
    transferStagedAttachmentOwner(draft.uiStateId, conversation);
    transferComposerOwner(draft.uiStateId, conversation);
  }
  drafts.delete(draft.uiStateId);
}
