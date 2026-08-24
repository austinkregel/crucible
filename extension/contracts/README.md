# Phase 0 contracts — parallel sub-agent supervisor + human-in-the-loop

These files are the **frozen interfaces** that let the workstreams build in parallel. They
contain **types only, no implementation**. Nothing imports them yet, so adding them cannot
break the build; they exist to be compiled against.

The feature they describe is a single system: **many sub-agents running concurrently, each
able to block on a question routed to one shared human.** The contracts are split by
*ownership seam* so each lane can own a file and develop against mocks of the others.

## Lane ownership

| File | Lane | Owner | Depends on (compile-time) |
|------|------|-------|---------------------------|
| [`ids.ts`](ids.ts) | shared spine | authored in Phase 0, frozen | — |
| [`toolContext.ts`](toolContext.ts) | **#1** per-agent tool context (keystone) | backend-core | `ids`, `broker`, `../tools/types` |
| [`supervisor.ts`](supervisor.ts) | **#2** concurrent supervisor | backend-core | `ids`, `toolContext`, `budget`, `../agent/runner` |
| [`broker.ts`](broker.ts) | **#3** human-question broker | broker | `ids` |
| [`protocol.ts`](protocol.ts) | **#3 + #4** ext↔webview wire | shared (broker + UI) | `ids`, `toolContext`, `broker` |
| [`budget.ts`](budget.ts) | **#5** per-agent budgets | budget | `ids` |

`#1 → #2` is the serial spine (same backend files). `#3`, `#4`, `#5` fan out against these
interfaces + the mocks below.

## Runtime-concurrency invariants (why these shapes)

The contracts encode the guarantees the *running tool* must uphold, not just our build order:

1. **`ToolContext` is per-agent and immutable for the life of a tool call.** Policy travels
   *in* the context, never on a shared mutable `ToolRunner` field. This dissolves the
   shared-policy race (old #2) by construction: two concurrent agents cannot clobber each
   other's policy because neither writes shared state.
2. **`UserPromptBroker` is a queue keyed by `QuestionId`, grouped by `AgentId`.** N concurrent
   askers, one human, fair serialization, per-agent cancellation. Attribution is mandatory in
   the payload — the user always sees *which* agent is asking.
3. **`SubAgentSupervisor` owns a bounded concurrency pool** and one `AbortController` per agent.
   Cancelling an agent rejects its outstanding questions via the broker.
4. **`BudgetTracker` is per-agent** and its wall-clock **excludes time blocked on a human**
   (see the cross-lane coupling below), so a slow human never exhausts an agent's budget.

## The one cross-lane coupling — do not miss this

`#3` (broker) and `#5` (budget) meet at exactly one point: **while an agent is blocked on a
question, its wall-clock budget must pause.** The contract puts the seam in the `HumanChannel`
implementation, not in the tool: it calls `BudgetTracker.markBlocked()` before enqueuing a
question and `markUnblocked()` after it resolves. Both interfaces expose those hooks
([`budget.ts`](budget.ts) `markBlocked`/`markUnblocked`); the wiring lands at integration.
Everywhere else, `#3` and `#5` are independent.

## Mock seams (so lanes don't wait on each other)

- **#4 (UI)** builds against a fake message emitter that posts `protocol.ts` messages — no
  backend needed. It only consumes the wire types.
- **#3 (broker)** builds against a fake awaiting caller and asserts `enqueue()` resolves when
  `resolve()` is called with a matching `QuestionId`.
- **#5 (budget)** is pure logic over `budget.ts` — no VS Code, no agents. Fully unit-testable.
- **#1/#2 (backend-core)** builds the real `ToolContext`/supervisor; until #3's broker exists,
  `ctx.human` is a stub that auto-approves (or auto-denies) so the loop is exercisable.

## Frozen vs. open

The **shapes** here are frozen once this lands — lanes rely on them. Fields may be *added*
(additive, non-breaking) by agreement; renames/removals require a cross-lane sync because they
break every mock. Treat the `ids` branded types and the `protocol.ts` message `type` strings as
especially load-bearing.
