# Price audit MVP

Status: ready-for-agent

## Problem Statement
ERP prices and policies are spread across documents and configuration. An engineer
needs a reproducible explanation of whether an order violates an applicable floor.

## Solution
A read-only CLI audits synthetic orders, retrieves explanatory policy passages,
and offers a Pi investigation harness with bounded calls and evidence citations.

## User Stories
1. As an investigator, I can reproduce a default-price conflict.
2. As an investigator, I can detect a violation introduced by discounts.
3. As an investigator, I avoid confusing box prices with base-unit prices.
4. As an investigator, I receive inconclusive results for overlapping rules.
5. As an investigator, I see the ledger, product and date scope of evidence.
6. As an investigator, I can retrieve the policy passage explaining a finding.
7. As an investigator, I can distinguish synthetic policies from observed ERP fields.
8. As an investigator, I receive no false compliant result for malformed data.
9. As an investigator, I can use Pi to query policies and calculate findings.
10. As an investigator, I can stop a run and enforce an execution budget.
11. As a reviewer, I can repeat tests and see what has not been live-validated.

## Implementation Decisions
Node 24+, strict TypeScript, local fixtures and CLI JSON. Integer cents and exact
rational math, dates inclusive. Order discount proportional to discounted line
amounts; compare without intermediate rounding. Tax basis and base-unit factors
must be explicit. Unsupported gifts return inconclusive. A violated line makes
overall status violation, while retaining other inconclusive lines. Otherwise any
inconclusive line makes overall status inconclusive. No applicable rule is not proof
of compliance. Each finding cites order and rule locators. Policy retrieval filters
ledger and validity before ranking and returns versioned excerpts. Pi can only use
registered read-only tools; runtime bounds turns/tools/time. Model commentary cannot
override the deterministic report. Provider credentials are environment-only.

## Testing Decisions
Test audit(request), searchPolicies(query, scope), and runInvestigation at public
boundaries. Literal expected results from worked cases, no mirrored algorithms.
Mock only the model transport. Offline transport tests do not prove live RAG quality.

## Out of Scope
UI, production integration, procurement, credit, approvals, automatic corrections,
real customer data, production deployment, complete semantic retrieval evaluation.

## Further Notes
Source HTML demonstrated price controls and order fields. All policy semantics are
project assumptions authorized by the user, not reverse-engineered server facts.
