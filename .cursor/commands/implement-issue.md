# Implement Issue

Work on the GitHub issue specified by the user. Infer the repository from the current project.

1. Read the issue description, acceptance criteria, and relevant comments using `gh issue view`.
2. Read applicable AGENTS.md instructions and inspect the existing architecture, relevant code, tooling, and tests.
3. Identify the required changes.
4. Propose a concise implementation plan. Wait for explicit approval before modifying code.
5. Follow existing conventions. Avoid unnecessary abstractions and unrelated changes.
6. After approval, create a new branch from the latest `main` and implement only on that branch:
   - Fetch latest `origin/main` (e.g. `git fetch origin main`).
   - Create and check out a new feature branch from `origin/main` (do not continue on `main` or an unrelated dirty branch).
   - Apply all code, test, and doc changes on this new branch.
7. Implement the agreed plan and add relevant automated tests.
8. Run relevant tests and project checks. Report the changes, test results, and any limitations.
9. Do not commit, push, or create a pull request without explicit approval.
