# Billing support modes

Billing responses explicitly identify `local` or `cloud` and one of `normal`, `read_only`, `degraded`, or `unavailable`. Unavailable data is represented as unavailable rather than as zero, and mutation affordances are omitted outside normal mode.
