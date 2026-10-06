# Project Architecture Rules

- Parent booking and linked Extra Service dues use `CombinedDueReceiveDialog` when extras exist, preserving each table's existing accounting writes while sharing one receipt batch token; this keeps one user action grouped across Accounts and Cash Handover.