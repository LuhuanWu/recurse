# New-agent drafts

The [registry](drafts.ts) owns draft identity and retention so leaving a view
cannot dispose unsent work. [Rows](row.ts) stay outside scripted sidebar sections;
the root [sidebar](../sidebar.ts) owns navigation and the
[composer](../composer.ts) owns send jobs, cancellation and promotion.

Drafts are tab-memory-only, not reload-persistent. Their bounded registry pins
composer owners until creation or confirmed discard; capacity refuses new work
rather than silently evicting text or attachments. Leaving an empty draft with no
text, files or creating job drops it, including settings-only changes, so it does
not block updates/login or consume capacity. Sending drafts cannot be discarded
until the request settles. Creation retries after network/5xx errors remain
protected between attempts because the server may already have created an agent.
Permanently failed sends can be discarded without retrying or deleting a backend
agent that might already exist.

Sidebar rows are the explicit resume path. Browser history identifies a draft's
parent, not one of several drafts under that parent. Background creation transfers
unsent follow-up work without moving the open conversation or its scroll position.
