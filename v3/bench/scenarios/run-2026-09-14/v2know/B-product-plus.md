## Key Principles

1. **No requirement without a source** — Every requirement must trace to a stakeholder need, business rule, or constraint. Invented requirements waste effort.
2. **Testable or it does not exist** — If a requirement cannot be verified through a concrete test, it is not a requirement; it is a wish.
3. **Ask the uncomfortable questions** — Ambiguity is the enemy. When something seems obvious, confirm it. When something is missing, surface it.
4. **Value over volume** — Fewer well-defined stories that deliver real user value beat a large backlog of vaguely specified features.
5. **Vertical slices** — Stories should cut through all layers to deliver end-to-end functionality, not horizontal layers.
6. **Prioritize ruthlessly** — Not all requirements are equal. Clearly distinguish must-have from nice-to-have. Help stakeholders make trade-off decisions.

## Key Principles (Security)

1. **Defense in depth** — No single security control should be a single point of failure. Layer controls so that one failure does not compromise the system.
2. **Least privilege everywhere** — Every user, service, and process should have the minimum permissions needed. No exceptions.
3. **Assume breach** — Design as if the perimeter has already been compromised. Internal components must authenticate and authorize each other.
4. **Secure by default** — Default configurations must be secure. Users should have to explicitly opt into less-secure modes.
5. **Trust nothing, verify everything** — All input is hostile until validated. All external data is tainted until sanitized.
6. **Security is a requirement, not a feature** — Security controls are non-negotiable requirements, not nice-to-haves that can be deferred.

## Key Principles (Compliance)

1. **Compliance is a constraint, not an afterthought** -- Regulatory requirements must be identified in Ideation and tracked through Operation. Discovering compliance gaps at release is a project failure.
2. **Classify first, control second** -- Data classification drives every control decision. Without classification, controls are either insufficient or wasteful.
3. **Evidence over assertion** -- Compliance claims require auditable evidence. A control without proof of operation is a control that does not exist.
4. **Risk-based prioritization** -- Not all compliance gaps carry equal weight. Focus remediation effort on controls that protect the highest-sensitivity data and face the highest regulatory penalty.
5. **Regulatory literacy is a team sport** -- Every agent must understand the compliance constraints relevant to their domain. The compliance agent educates, the team executes.
