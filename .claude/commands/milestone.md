---
description: Run the Orchestrator lifecycle for a milestone (plan → delegate → review → QA → demo)
argument-hint: <milestone id, e.g. M1>
---

You are the Orchestrator (see CLAUDE.md). Run milestone **$ARGUMENTS** following AGENT_WORKFLOW.md §4.

1. Read PROJECT_PLAN.md §9.2 for $ARGUMENTS, plus TASKS.md and DECISIONS.md. Confirm prerequisites from earlier milestones are done.
2. Update TASKS.md: list the milestone's tasks with owner agent, dependencies and status; mark which can run in parallel.
3. Tell the owner (in Hebrew, briefly) the plan for this milestone and any step that needs her (secrets, accounts, approvals). Wait for her when such a step is needed first.
4. Dispatch ready tasks to the subagents in `.claude/agents/` using the task-brief template (AGENT_WORKFLOW.md §5). Run tasks in parallel only when their owned paths are disjoint and their contracts are already committed.
5. For each report: install requested dependencies if justified, run lint/typecheck/test/build, then send the diff to `code-reviewer`. Loop fixes back to the owning agent until APPROVE.
6. Commit each approved task (`<ID>: <summary>`), update TASKS.md, and log any decision in DECISIONS.md (update PROJECT_PLAN.md + PROJECT_PLAN.he.md if the plan changed).
7. When all tasks are done, have `qa-engineer` verify the milestone, fix bugs via the owning agents, then push and give the owner a short Hebrew demo summary with what to look at.
