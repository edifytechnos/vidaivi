// Feedback for every Seyali app — see widget.ts for the dialog, capture.ts for
// the log, replay.ts for the recording and client.ts for /api/feedback.
// Vidai carries a copy of this folder (src/feedback/ there); this one is the
// source — change it here and copy it over (scripts/sync-feedback.sh in Vidai).
export { installFeedback, setFeedback, openFeedback, closeFeedback, openFeedbackEntry, ideasBoardUrl, FEEDBACK_ENTRIES, type FeedbackOptions, type AppId, type View, type EntryKey } from "./widget";
export { fb, adoptKeys, heldTickets, votedSet, deviceId, STATUS_LABEL, gunzip, siteUrl, type Ticket, type BoardItem, type Comment, type Status, type Kind } from "./client";
export { mountPlayer, type PlayerHandle, type Highlight } from "./player";
export { fileEvents, fileUrl, type Triage, type TicketFile } from "./client";
