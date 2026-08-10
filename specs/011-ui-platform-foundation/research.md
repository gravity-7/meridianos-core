# Research: UI Platform Foundation

## Decisions

### Stable route namespace

- **Decision**: Reserve `/app` for the platform shell and explicit route registry.
- **Rationale**: It isolates stable, bookmarkable application destinations from legacy paths and enables direct-load testing.
- **Alternatives considered**: Replacing legacy paths immediately (not reversible); hash routing (does not satisfy stable server routes).

### Reversible release

- **Decision**: Use a policy-controlled eligibility flag, defaulting to legacy.
- **Rationale**: Allows controlled adoption and rollback without data or contract changes.
- **Alternatives considered**: Global cutover (unacceptable blast radius); browser-only preference (not operator-controlled).

### Visual and interaction consistency

- **Decision**: Semantic design tokens and shared accessible primitives own themes and action states.
- **Rationale**: Prevents divergent implementations across later migrations.
- **Alternatives considered**: Page-local styling/state patterns (inconsistent and costly to audit).

### Public API protection

- **Decision**: Introduce internal typed adapters rather than changing existing APIs.
- **Rationale**: Preserves clients while giving views stable contracts.
- **Alternatives considered**: Adding a parallel API version (out of scope); consuming raw response objects in views (fragile).
