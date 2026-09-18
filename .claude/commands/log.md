---
description: A phone call, an email, a meeting - onto the contact log, attached to the client or the document.
---

1. `npm run ato -- log <client or ATO-ref> "what was said" --channel=phone|email|meeting|letter [--on=]`.
2. Given an ATO ref, the note attaches to both the document and its client, which is what the trail on `doc <ref>` reads back.
3. If the call created work, add it in the same breath: `task add "..." --client= --due=`.
