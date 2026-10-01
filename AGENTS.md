# Caliper

Caliper's goal is AI speed while keeping a collection of page states as nearly
hermetically sealed, fully composable, and browsable as possible.

Use product-owned working scenarios with real component composition. Keep the
component an agent edits separate from the scenario where its change is judged.
A take's review state does not limit the effects of shared implementation edits.

Before changing parts, states, takes, agent behavior, or verification, read
[decision 18](docs/decisions.md#18-product-owned-working-scenarios). It defines
scenario ownership, reproducibility, action behavior, and the limits of coverage.
Treat its implementation status as a boundary, not a list of completed features.

Read [the decision record](docs/decisions.md) before changing Caliper's architecture.
Change a settled decision only with new evidence, and record the reason there.
Use [README.md](README.md) for install, [docs/guide.md](docs/guide.md) for behavior,
options and runtime limits, and [CONTRIBUTING.md](CONTRIBUTING.md) for development
commands, tests and verification scripts.
