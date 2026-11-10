# T033 — registry client observations

2026-11-10. Four new client tests observed RED before implementation.
**12 PASS** across client, real live/offline daemon outcome access and storage
regressions; [output](project-client-green.txt). Typecheck/build/lint pass.

Mutations keep one UUID and original intent; accepted work is observed with
50/100/200/250 ms bounded polling. Rejection before acceptance is not polled.
Explicit operation query returns its current state immediately. Client deadlines
cap reads at two seconds and mutations at thirty, yielding UNKNOWN_OUTCOME with
the original requestId without cancellation, automatic restart or replacement ID.

The existing backend checks actual registry version/method capabilities before
sending a mutation; outcome queries fall back to readonly archive inspection when
IPC is absent. Authorization failure does not trigger a bypass. Schema 2 remains
REGISTRY_NOT_INITIALIZED. Terminal views are closed/validated and contain no internal
canonical intent/hash/anchors. Bad/mismatched responses are rejected. Only outcome
queries are exposed at this checkpoint; story commands are not advertised yet.
