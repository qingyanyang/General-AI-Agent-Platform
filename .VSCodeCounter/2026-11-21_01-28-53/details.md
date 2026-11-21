# Details

Date : 2026-11-21 01:28:53

Directory /Users/yangqingyan/Desktop/Enterprise-AI-Agent-Platform

Total : 300 files,  55955 codes, 1296 comments, 6293 blanks, all 63544 lines

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)

## Files
| filename | language | code | comment | blank | total |
| :--- | :--- | ---: | ---: | ---: | ---: |
| [.agents/skills/source-command-create-pr/SKILL.md](/.agents/skills/source-command-create-pr/SKILL.md) | Skill | 26 | 0 | 10 | 36 |
| [.agents/skills/source-command-fix-pr/SKILL.md](/.agents/skills/source-command-fix-pr/SKILL.md) | Skill | 67 | 0 | 33 | 100 |
| [.agents/skills/source-command-implement-issue/SKILL.md](/.agents/skills/source-command-implement-issue/SKILL.md) | Skill | 27 | 0 | 9 | 36 |
| [.agents/skills/source-command-review-pr/SKILL.md](/.agents/skills/source-command-review-pr/SKILL.md) | Skill | 93 | 0 | 44 | 137 |
| [.codex/config.toml](/.codex/config.toml) | TOML | 2 | 0 | 1 | 3 |
| [.cursor/commands/create-pr.md](/.cursor/commands/create-pr.md) | Markdown | 19 | 0 | 6 | 25 |
| [.cursor/commands/fix-pr.md](/.cursor/commands/fix-pr.md) | Markdown | 60 | 0 | 29 | 89 |
| [.cursor/commands/implement-issue.md](/.cursor/commands/implement-issue.md) | Markdown | 20 | 0 | 5 | 25 |
| [.cursor/commands/review-pr.md](/.cursor/commands/review-pr.md) | Markdown | 86 | 0 | 40 | 126 |
| [.cursor/mcp.json](/.cursor/mcp.json) | JSON with Comments | 8 | 0 | 0 | 8 |
| [.github/workflows/backend-cd.yml](/.github/workflows/backend-cd.yml) | YAML | 155 | 1 | 36 | 192 |
| [.github/workflows/frontend-cd.yml](/.github/workflows/frontend-cd.yml) | YAML | 75 | 2 | 12 | 89 |
| [.github/workflows/infra-cd.yml](/.github/workflows/infra-cd.yml) | YAML | 118 | 0 | 25 | 143 |
| [.github/workflows/infra-ci.yml](/.github/workflows/infra-ci.yml) | YAML | 99 | 0 | 14 | 113 |
| [README.md](/README.md) | Markdown | 147 | 0 | 50 | 197 |
| [backend/.dockerignore](/backend/.dockerignore) | Ignore | 6 | 0 | 0 | 6 |
| [backend/Dockerfile](/backend/Dockerfile) | Docker | 7 | 0 | 6 | 13 |
| [backend/README.md](/backend/README.md) | Markdown | 344 | 0 | 143 | 487 |
| [backend/alembic.ini](/backend/alembic.ini) | Ini | 32 | 0 | 11 | 43 |
| [backend/alembic/env.py](/backend/alembic/env.py) | Python | 62 | 5 | 23 | 90 |
| [backend/alembic/versions/20260309\_0001\_create\_chat\_sessions.py](/backend/alembic/versions/20260309_0001_create_chat_sessions.py) | Python | 60 | 9 | 11 | 80 |
| [backend/alembic/versions/20261110\_0002\_widen\_chat\_sessions\_user\_id.py](/backend/alembic/versions/20261110_0002_widen_chat_sessions_user_id.py) | Python | 28 | 8 | 11 | 47 |
| [backend/alembic/versions/20261110\_0003\_create\_agent\_access\_grants.py](/backend/alembic/versions/20261110_0003_create_agent_access_grants.py) | Python | 53 | 8 | 11 | 72 |
| [backend/alembic/versions/20261111\_0004\_create\_agents.py](/backend/alembic/versions/20261111_0004_create_agents.py) | Python | 54 | 9 | 11 | 74 |
| [backend/alembic/versions/20261111\_0005\_agent\_configuration.py](/backend/alembic/versions/20261111_0005_agent_configuration.py) | Python | 91 | 10 | 13 | 114 |
| [backend/alembic/versions/20261111\_0006\_agent\_executions.py](/backend/alembic/versions/20261111_0006_agent_executions.py) | Python | 64 | 8 | 11 | 83 |
| [backend/alembic/versions/20261112\_0007\_agent\_skill\_names.py](/backend/alembic/versions/20261112_0007_agent_skill_names.py) | Python | 18 | 9 | 11 | 38 |
| [backend/alembic/versions/20261112\_0008\_human\_approval.py](/backend/alembic/versions/20261112_0008_human_approval.py) | Python | 54 | 8 | 11 | 73 |
| [backend/alembic/versions/20261118\_0009\_directory\_users.py](/backend/alembic/versions/20261118_0009_directory_users.py) | Python | 21 | 10 | 11 | 42 |
| [backend/alembic/versions/20261119\_0010\_groups.py](/backend/alembic/versions/20261119_0010_groups.py) | Python | 83 | 10 | 11 | 104 |
| [backend/alembic/versions/20261119\_0011\_agent\_access\_config.py](/backend/alembic/versions/20261119_0011_agent_access_config.py) | Python | 127 | 13 | 11 | 151 |
| [backend/alembic/versions/20261120\_0012\_agent\_instruction\_skills.py](/backend/alembic/versions/20261120_0012_agent_instruction_skills.py) | Python | 47 | 12 | 11 | 70 |
| [backend/alembic/versions/20261120\_0013\_directory\_profiles.py](/backend/alembic/versions/20261120_0013_directory_profiles.py) | Python | 60 | 6 | 11 | 77 |
| [backend/app/\_\_init\_\_.py](/backend/app/__init__.py) | Python | 0 | 1 | 1 | 2 |
| [backend/app/agents/\_\_init\_\_.py](/backend/app/agents/__init__.py) | Python | 2 | 1 | 3 | 6 |
| [backend/app/agents/checkpointer.py](/backend/app/agents/checkpointer.py) | Python | 86 | 15 | 26 | 127 |
| [backend/app/agents/errors.py](/backend/app/agents/errors.py) | Python | 6 | 4 | 8 | 18 |
| [backend/app/agents/graph.py](/backend/app/agents/graph.py) | Python | 299 | 32 | 47 | 378 |
| [backend/app/agents/instructions.py](/backend/app/agents/instructions.py) | Python | 7 | 2 | 6 | 15 |
| [backend/app/agents/messages.py](/backend/app/agents/messages.py) | Python | 39 | 11 | 11 | 61 |
| [backend/app/agents/runtime.py](/backend/app/agents/runtime.py) | Python | 652 | 55 | 68 | 775 |
| [backend/app/agents/skills/\_\_init\_\_.py](/backend/app/agents/skills/__init__.py) | Python | 28 | 1 | 3 | 32 |
| [backend/app/agents/skills/builtins.py](/backend/app/agents/skills/builtins.py) | Python | 27 | 1 | 4 | 32 |
| [backend/app/agents/skills/factory.py](/backend/app/agents/skills/factory.py) | Python | 8 | 2 | 5 | 15 |
| [backend/app/agents/skills/prompt.py](/backend/app/agents/skills/prompt.py) | Python | 42 | 7 | 10 | 59 |
| [backend/app/agents/skills/registry.py](/backend/app/agents/skills/registry.py) | Python | 78 | 8 | 29 | 115 |
| [backend/app/agents/state.py](/backend/app/agents/state.py) | Python | 4 | 2 | 6 | 12 |
| [backend/app/agents/tool\_policy.py](/backend/app/agents/tool_policy.py) | Python | 56 | 15 | 25 | 96 |
| [backend/app/agents/tools/\_\_init\_\_.py](/backend/app/agents/tools/__init__.py) | Python | 39 | 2 | 6 | 47 |
| [backend/app/agents/tools/builtins.py](/backend/app/agents/tools/builtins.py) | Python | 10 | 4 | 8 | 22 |
| [backend/app/agents/tools/errors.py](/backend/app/agents/tools/errors.py) | Python | 15 | 7 | 16 | 38 |
| [backend/app/agents/tools/load\_skill.py](/backend/app/agents/tools/load_skill.py) | Python | 38 | 6 | 8 | 52 |
| [backend/app/agents/tools/mcp.py](/backend/app/agents/tools/mcp.py) | Python | 379 | 32 | 70 | 481 |
| [backend/app/agents/tools/registry.py](/backend/app/agents/tools/registry.py) | Python | 92 | 10 | 20 | 122 |
| [backend/app/agents/tracing.py](/backend/app/agents/tracing.py) | Python | 80 | 7 | 17 | 104 |
| [backend/app/api/\_\_init\_\_.py](/backend/app/api/__init__.py) | Python | 0 | 0 | 1 | 1 |
| [backend/app/api/deps.py](/backend/app/api/deps.py) | Python | 132 | 13 | 21 | 166 |
| [backend/app/api/execution.py](/backend/app/api/execution.py) | Python | 43 | 10 | 8 | 61 |
| [backend/app/api/execution\_records.py](/backend/app/api/execution_records.py) | Python | 228 | 14 | 27 | 269 |
| [backend/app/api/router.py](/backend/app/api/router.py) | Python | 22 | 0 | 3 | 25 |
| [backend/app/api/routes/\_\_init\_\_.py](/backend/app/api/routes/__init__.py) | Python | 0 | 0 | 1 | 1 |
| [backend/app/api/routes/agent\_access.py](/backend/app/api/routes/agent_access.py) | Python | 83 | 1 | 14 | 98 |
| [backend/app/api/routes/agents.py](/backend/app/api/routes/agents.py) | Python | 665 | 11 | 63 | 739 |
| [backend/app/api/routes/catalog.py](/backend/app/api/routes/catalog.py) | Python | 36 | 3 | 10 | 49 |
| [backend/app/api/routes/executions.py](/backend/app/api/routes/executions.py) | Python | 55 | 3 | 10 | 68 |
| [backend/app/api/routes/groups.py](/backend/app/api/routes/groups.py) | Python | 221 | 1 | 22 | 244 |
| [backend/app/api/routes/health.py](/backend/app/api/routes/health.py) | Python | 11 | 0 | 5 | 16 |
| [backend/app/api/routes/sessions.py](/backend/app/api/routes/sessions.py) | Python | 752 | 25 | 62 | 839 |
| [backend/app/api/routes/skills.py](/backend/app/api/routes/skills.py) | Python | 46 | 3 | 10 | 59 |
| [backend/app/api/routes/users.py](/backend/app/api/routes/users.py) | Python | 112 | 1 | 16 | 129 |
| [backend/app/core/\_\_init\_\_.py](/backend/app/core/__init__.py) | Python | 0 | 0 | 1 | 1 |
| [backend/app/core/auth.py](/backend/app/core/auth.py) | Python | 260 | 46 | 47 | 353 |
| [backend/app/core/config.py](/backend/app/core/config.py) | Python | 175 | 24 | 34 | 233 |
| [backend/app/core/database.py](/backend/app/core/database.py) | Python | 33 | 5 | 13 | 51 |
| [backend/app/core/errors.py](/backend/app/core/errors.py) | Python | 38 | 0 | 7 | 45 |
| [backend/app/core/logging.py](/backend/app/core/logging.py) | Python | 20 | 2 | 7 | 29 |
| [backend/app/core/mcp\_allowlist.py](/backend/app/core/mcp_allowlist.py) | Python | 85 | 9 | 20 | 114 |
| [backend/app/core/permissions.py](/backend/app/core/permissions.py) | Python | 33 | 9 | 6 | 48 |
| [backend/app/main.py](/backend/app/main.py) | Python | 46 | 0 | 11 | 57 |
| [backend/app/models/\_\_init\_\_.py](/backend/app/models/__init__.py) | Python | 19 | 1 | 3 | 23 |
| [backend/app/models/agent.py](/backend/app/models/agent.py) | Python | 91 | 3 | 14 | 108 |
| [backend/app/models/agent\_access\_grant.py](/backend/app/models/agent_access_grant.py) | Python | 38 | 1 | 8 | 47 |
| [backend/app/models/agent\_execution.py](/backend/app/models/agent_execution.py) | Python | 38 | 3 | 11 | 52 |
| [backend/app/models/agent\_group\_assignment.py](/backend/app/models/agent_group_assignment.py) | Python | 41 | 5 | 8 | 54 |
| [backend/app/models/agent\_instruction\_skill.py](/backend/app/models/agent_instruction_skill.py) | Python | 34 | 1 | 8 | 43 |
| [backend/app/models/base.py](/backend/app/models/base.py) | Python | 7 | 3 | 9 | 19 |
| [backend/app/models/chat\_session.py](/backend/app/models/chat_session.py) | Python | 39 | 1 | 8 | 48 |
| [backend/app/models/directory\_user.py](/backend/app/models/directory_user.py) | Python | 16 | 5 | 8 | 29 |
| [backend/app/models/group.py](/backend/app/models/group.py) | Python | 84 | 1 | 13 | 98 |
| [backend/app/models/session\_run\_gate.py](/backend/app/models/session_run_gate.py) | Python | 19 | 5 | 9 | 33 |
| [backend/app/schemas/\_\_init\_\_.py](/backend/app/schemas/__init__.py) | Python | 0 | 1 | 1 | 2 |
| [backend/app/schemas/agent.py](/backend/app/schemas/agent.py) | Python | 72 | 6 | 24 | 102 |
| [backend/app/schemas/agent\_access.py](/backend/app/schemas/agent_access.py) | Python | 23 | 1 | 11 | 35 |
| [backend/app/schemas/agent\_access\_config.py](/backend/app/schemas/agent_access_config.py) | Python | 26 | 6 | 13 | 45 |
| [backend/app/schemas/agent\_config.py](/backend/app/schemas/agent_config.py) | Python | 75 | 3 | 19 | 97 |
| [backend/app/schemas/agent\_execution.py](/backend/app/schemas/agent_execution.py) | Python | 27 | 1 | 12 | 40 |
| [backend/app/schemas/agent\_instruction\_skills.py](/backend/app/schemas/agent_instruction_skills.py) | Python | 73 | 6 | 22 | 101 |
| [backend/app/schemas/approval.py](/backend/app/schemas/approval.py) | Python | 15 | 2 | 12 | 29 |
| [backend/app/schemas/catalog.py](/backend/app/schemas/catalog.py) | Python | 18 | 1 | 15 | 34 |
| [backend/app/schemas/chat\_message.py](/backend/app/schemas/chat_message.py) | Python | 66 | 16 | 36 | 118 |
| [backend/app/schemas/chat\_session.py](/backend/app/schemas/chat_session.py) | Python | 41 | 1 | 14 | 56 |
| [backend/app/schemas/groups.py](/backend/app/schemas/groups.py) | Python | 56 | 1 | 25 | 82 |
| [backend/app/schemas/skill.py](/backend/app/schemas/skill.py) | Python | 19 | 3 | 17 | 39 |
| [backend/app/schemas/users.py](/backend/app/schemas/users.py) | Python | 34 | 1 | 18 | 53 |
| [backend/app/services/\_\_init\_\_.py](/backend/app/services/__init__.py) | Python | 0 | 1 | 1 | 2 |
| [backend/app/services/agent\_access.py](/backend/app/services/agent_access.py) | Python | 368 | 34 | 67 | 469 |
| [backend/app/services/agent\_access\_config.py](/backend/app/services/agent_access_config.py) | Python | 188 | 31 | 47 | 266 |
| [backend/app/services/agent\_executions.py](/backend/app/services/agent_executions.py) | Python | 204 | 16 | 31 | 251 |
| [backend/app/services/agent\_instruction\_skills.py](/backend/app/services/agent_instruction_skills.py) | Python | 162 | 15 | 29 | 206 |
| [backend/app/services/agents.py](/backend/app/services/agents.py) | Python | 386 | 25 | 72 | 483 |
| [backend/app/services/auth0\_management.py](/backend/app/services/auth0_management.py) | Python | 198 | 9 | 30 | 237 |
| [backend/app/services/chat\_messages.py](/backend/app/services/chat_messages.py) | Python | 76 | 4 | 13 | 93 |
| [backend/app/services/chat\_sessions.py](/backend/app/services/chat_sessions.py) | Python | 132 | 8 | 27 | 167 |
| [backend/app/services/directory\_users.py](/backend/app/services/directory_users.py) | Python | 100 | 14 | 17 | 131 |
| [backend/app/services/groups.py](/backend/app/services/groups.py) | Python | 331 | 19 | 65 | 415 |
| [backend/app/services/session\_gates.py](/backend/app/services/session_gates.py) | Python | 222 | 13 | 29 | 264 |
| [backend/app/services/user\_admin.py](/backend/app/services/user_admin.py) | Python | 180 | 5 | 28 | 213 |
| [backend/auth0/post-login-verify-email.js](/backend/auth0/post-login-verify-email.js) | JavaScript | 15 | 11 | 1 | 27 |
| [backend/evals/\_\_init\_\_.py](/backend/evals/__init__.py) | Python | 0 | 6 | 1 | 7 |
| [backend/evals/\_\_main\_\_.py](/backend/evals/__main__.py) | Python | 30 | 1 | 8 | 39 |
| [backend/evals/baseline.json](/backend/evals/baseline.json) | JSON | 30 | 0 | 1 | 31 |
| [backend/evals/dataset.py](/backend/evals/dataset.py) | Python | 161 | 2 | 23 | 186 |
| [backend/evals/datasets/agent\_core.json](/backend/evals/datasets/agent_core.json) | JSON | 125 | 0 | 1 | 126 |
| [backend/evals/grading.py](/backend/evals/grading.py) | Python | 136 | 7 | 27 | 170 |
| [backend/evals/runner.py](/backend/evals/runner.py) | Python | 307 | 18 | 42 | 367 |
| [backend/evals/scripted.py](/backend/evals/scripted.py) | Python | 37 | 2 | 12 | 51 |
| [backend/evals/target.py](/backend/evals/target.py) | Python | 125 | 2 | 17 | 144 |
| [backend/pyproject.toml](/backend/pyproject.toml) | TOML | 22 | 0 | 4 | 26 |
| [backend/requirements.txt](/backend/requirements.txt) | pip requirements | 16 | 1 | 1 | 18 |
| [backend/scripts/dev.sh](/backend/scripts/dev.sh) | Shell Script | 8 | 2 | 5 | 15 |
| [backend/tests/\_\_init\_\_.py](/backend/tests/__init__.py) | Python | 0 | 0 | 1 | 1 |
| [backend/tests/auth\_helpers.py](/backend/tests/auth_helpers.py) | Python | 98 | 3 | 19 | 120 |
| [backend/tests/chat\_helpers.py](/backend/tests/chat_helpers.py) | Python | 205 | 6 | 23 | 234 |
| [backend/tests/conftest.py](/backend/tests/conftest.py) | Python | 100 | 7 | 23 | 130 |
| [backend/tests/fakes.py](/backend/tests/fakes.py) | Python | 84 | 3 | 16 | 103 |
| [backend/tests/test\_agent\_access.py](/backend/tests/test_agent_access.py) | Python | 426 | 3 | 62 | 491 |
| [backend/tests/test\_agent\_access\_config.py](/backend/tests/test_agent_access_config.py) | Python | 483 | 2 | 68 | 553 |
| [backend/tests/test\_agent\_configuration.py](/backend/tests/test_agent_configuration.py) | Python | 438 | 1 | 65 | 504 |
| [backend/tests/test\_agent\_crud.py](/backend/tests/test_agent_crud.py) | Python | 509 | 12 | 71 | 592 |
| [backend/tests/test\_agent\_executions.py](/backend/tests/test_agent_executions.py) | Python | 693 | 8 | 100 | 801 |
| [backend/tests/test\_agent\_instruction\_skills.py](/backend/tests/test_agent_instruction_skills.py) | Python | 638 | 3 | 73 | 714 |
| [backend/tests/test\_agents.py](/backend/tests/test_agents.py) | Python | 233 | 1 | 61 | 295 |
| [backend/tests/test\_audience\_authorization.py](/backend/tests/test_audience_authorization.py) | Python | 487 | 1 | 63 | 551 |
| [backend/tests/test\_auth.py](/backend/tests/test_auth.py) | Python | 733 | 3 | 135 | 871 |
| [backend/tests/test\_catalog.py](/backend/tests/test_catalog.py) | Python | 41 | 1 | 17 | 59 |
| [backend/tests/test\_checkpointer.py](/backend/tests/test_checkpointer.py) | Python | 311 | 5 | 71 | 387 |
| [backend/tests/test\_checkpointer\_integration.py](/backend/tests/test_checkpointer_integration.py) | Python | 105 | 10 | 24 | 139 |
| [backend/tests/test\_config.py](/backend/tests/test_config.py) | Python | 118 | 0 | 38 | 156 |
| [backend/tests/test\_directory\_users.py](/backend/tests/test_directory_users.py) | Python | 155 | 1 | 33 | 189 |
| [backend/tests/test\_evaluation.py](/backend/tests/test_evaluation.py) | Python | 265 | 1 | 50 | 316 |
| [backend/tests/test\_groups.py](/backend/tests/test_groups.py) | Python | 457 | 2 | 74 | 533 |
| [backend/tests/test\_health.py](/backend/tests/test_health.py) | Python | 23 | 0 | 11 | 34 |
| [backend/tests/test\_human\_approval.py](/backend/tests/test_human_approval.py) | Python | 701 | 2 | 62 | 765 |
| [backend/tests/test\_mcp\_integration.py](/backend/tests/test_mcp_integration.py) | Python | 206 | 6 | 47 | 259 |
| [backend/tests/test\_mcp\_tools.py](/backend/tests/test_mcp_tools.py) | Python | 366 | 1 | 65 | 432 |
| [backend/tests/test\_message\_stream.py](/backend/tests/test_message_stream.py) | Python | 517 | 5 | 81 | 603 |
| [backend/tests/test\_messages.py](/backend/tests/test_messages.py) | Python | 330 | 1 | 67 | 398 |
| [backend/tests/test\_migrations.py](/backend/tests/test_migrations.py) | Python | 72 | 1 | 23 | 96 |
| [backend/tests/test\_rbac.py](/backend/tests/test_rbac.py) | Python | 297 | 1 | 51 | 349 |
| [backend/tests/test\_session\_gate\_postgres.py](/backend/tests/test_session_gate_postgres.py) | Python | 152 | 5 | 18 | 175 |
| [backend/tests/test\_sessions.py](/backend/tests/test_sessions.py) | Python | 218 | 1 | 48 | 267 |
| [backend/tests/test\_skills.py](/backend/tests/test_skills.py) | Python | 472 | 2 | 66 | 540 |
| [backend/tests/test\_tool\_authorization.py](/backend/tests/test_tool_authorization.py) | Python | 455 | 7 | 73 | 535 |
| [backend/tests/test\_tool\_registry.py](/backend/tests/test_tool_registry.py) | Python | 164 | 2 | 36 | 202 |
| [backend/tests/test\_tracing.py](/backend/tests/test_tracing.py) | Python | 190 | 4 | 39 | 233 |
| [backend/tests/test\_user\_admin.py](/backend/tests/test_user_admin.py) | Python | 150 | 1 | 23 | 174 |
| [frontend/.oxlintrc.json](/frontend/.oxlintrc.json) | JSON | 8 | 0 | 1 | 9 |
| [frontend/PRODUCTION-UI-DEVIATIONS.md](/frontend/PRODUCTION-UI-DEVIATIONS.md) | Markdown | 40 | 0 | 19 | 59 |
| [frontend/README.md](/frontend/README.md) | Markdown | 37 | 0 | 17 | 54 |
| [frontend/docs/issue6-screenshots/README.md](/frontend/docs/issue6-screenshots/README.md) | Markdown | 17 | 0 | 9 | 26 |
| [frontend/eslint.config.js](/frontend/eslint.config.js) | JavaScript | 27 | 0 | 2 | 29 |
| [frontend/index.html](/frontend/index.html) | HTML | 13 | 0 | 1 | 14 |
| [frontend/package-lock.json](/frontend/package-lock.json) | JSON | 6,043 | 0 | 1 | 6,044 |
| [frontend/package.json](/frontend/package.json) | JSON | 49 | 0 | 1 | 50 |
| [frontend/prototypes/agent-management/PRODUCTION-FOLLOW-UP.md](/frontend/prototypes/agent-management/PRODUCTION-FOLLOW-UP.md) | Markdown | 26 | 0 | 12 | 38 |
| [frontend/prototypes/agent-management/index.html](/frontend/prototypes/agent-management/index.html) | HTML | 12 | 0 | 1 | 13 |
| [frontend/prototypes/agent-management/src/chat-store.ts](/frontend/prototypes/agent-management/src/chat-store.ts) | TypeScript | 703 | 15 | 39 | 757 |
| [frontend/prototypes/agent-management/src/chat/composer.tsx](/frontend/prototypes/agent-management/src/chat/composer.tsx) | TypeScript JSX | 493 | 1 | 27 | 521 |
| [frontend/prototypes/agent-management/src/chat/markdown.tsx](/frontend/prototypes/agent-management/src/chat/markdown.tsx) | TypeScript JSX | 143 | 6 | 7 | 156 |
| [frontend/prototypes/agent-management/src/chat/media-ui.tsx](/frontend/prototypes/agent-management/src/chat/media-ui.tsx) | TypeScript JSX | 202 | 1 | 10 | 213 |
| [frontend/prototypes/agent-management/src/chat/media.ts](/frontend/prototypes/agent-management/src/chat/media.ts) | TypeScript | 623 | 6 | 55 | 684 |
| [frontend/prototypes/agent-management/src/chat/sidebar.tsx](/frontend/prototypes/agent-management/src/chat/sidebar.tsx) | TypeScript JSX | 312 | 1 | 13 | 326 |
| [frontend/prototypes/agent-management/src/chat/transcript.tsx](/frontend/prototypes/agent-management/src/chat/transcript.tsx) | TypeScript JSX | 300 | 1 | 20 | 321 |
| [frontend/prototypes/agent-management/src/controls-panel.tsx](/frontend/prototypes/agent-management/src/controls-panel.tsx) | TypeScript JSX | 221 | 1 | 15 | 237 |
| [frontend/prototypes/agent-management/src/dialogs.tsx](/frontend/prototypes/agent-management/src/dialogs.tsx) | TypeScript JSX | 259 | 1 | 13 | 273 |
| [frontend/prototypes/agent-management/src/format.ts](/frontend/prototypes/agent-management/src/format.ts) | TypeScript | 18 | 0 | 2 | 20 |
| [frontend/prototypes/agent-management/src/hooks.ts](/frontend/prototypes/agent-management/src/hooks.ts) | TypeScript | 142 | 11 | 19 | 172 |
| [frontend/prototypes/agent-management/src/main.tsx](/frontend/prototypes/agent-management/src/main.tsx) | TypeScript JSX | 63 | 4 | 6 | 73 |
| [frontend/prototypes/agent-management/src/mock/chat-client.ts](/frontend/prototypes/agent-management/src/mock/chat-client.ts) | TypeScript | 536 | 9 | 42 | 587 |
| [frontend/prototypes/agent-management/src/mock/chat-data.ts](/frontend/prototypes/agent-management/src/mock/chat-data.ts) | TypeScript | 186 | 5 | 12 | 203 |
| [frontend/prototypes/agent-management/src/mock/client.ts](/frontend/prototypes/agent-management/src/mock/client.ts) | TypeScript | 648 | 13 | 53 | 714 |
| [frontend/prototypes/agent-management/src/mock/configuration-draft.ts](/frontend/prototypes/agent-management/src/mock/configuration-draft.ts) | TypeScript | 214 | 2 | 27 | 243 |
| [frontend/prototypes/agent-management/src/mock/data.ts](/frontend/prototypes/agent-management/src/mock/data.ts) | TypeScript | 133 | 10 | 15 | 158 |
| [frontend/prototypes/agent-management/src/mock/effective-access.ts](/frontend/prototypes/agent-management/src/mock/effective-access.ts) | TypeScript | 117 | 2 | 12 | 131 |
| [frontend/prototypes/agent-management/src/mock/options.ts](/frontend/prototypes/agent-management/src/mock/options.ts) | TypeScript | 91 | 4 | 19 | 114 |
| [frontend/prototypes/agent-management/src/mock/platform-permissions.ts](/frontend/prototypes/agent-management/src/mock/platform-permissions.ts) | TypeScript | 5 | 9 | 1 | 15 |
| [frontend/prototypes/agent-management/src/mock/product-state.ts](/frontend/prototypes/agent-management/src/mock/product-state.ts) | TypeScript | 348 | 5 | 38 | 391 |
| [frontend/prototypes/agent-management/src/mock/roles.ts](/frontend/prototypes/agent-management/src/mock/roles.ts) | TypeScript | 129 | 12 | 9 | 150 |
| [frontend/prototypes/agent-management/src/mock/users-api.ts](/frontend/prototypes/agent-management/src/mock/users-api.ts) | TypeScript | 795 | 11 | 48 | 854 |
| [frontend/prototypes/agent-management/src/mock/users-data.ts](/frontend/prototypes/agent-management/src/mock/users-data.ts) | TypeScript | 291 | 15 | 21 | 327 |
| [frontend/prototypes/agent-management/src/mock/users-state.ts](/frontend/prototypes/agent-management/src/mock/users-state.ts) | TypeScript | 119 | 1 | 24 | 144 |
| [frontend/prototypes/agent-management/src/pages/access.tsx](/frontend/prototypes/agent-management/src/pages/access.tsx) | TypeScript JSX | 329 | 2 | 19 | 350 |
| [frontend/prototypes/agent-management/src/pages/chat.tsx](/frontend/prototypes/agent-management/src/pages/chat.tsx) | TypeScript JSX | 429 | 2 | 31 | 462 |
| [frontend/prototypes/agent-management/src/pages/configuration-tab.tsx](/frontend/prototypes/agent-management/src/pages/configuration-tab.tsx) | TypeScript JSX | 318 | 1 | 17 | 336 |
| [frontend/prototypes/agent-management/src/pages/details-section.tsx](/frontend/prototypes/agent-management/src/pages/details-section.tsx) | TypeScript JSX | 185 | 1 | 11 | 197 |
| [frontend/prototypes/agent-management/src/pages/directory-layout.tsx](/frontend/prototypes/agent-management/src/pages/directory-layout.tsx) | TypeScript JSX | 95 | 2 | 9 | 106 |
| [frontend/prototypes/agent-management/src/pages/groups.tsx](/frontend/prototypes/agent-management/src/pages/groups.tsx) | TypeScript JSX | 909 | 2 | 43 | 954 |
| [frontend/prototypes/agent-management/src/pages/settings.tsx](/frontend/prototypes/agent-management/src/pages/settings.tsx) | TypeScript JSX | 254 | 1 | 18 | 273 |
| [frontend/prototypes/agent-management/src/pages/simple-pages.tsx](/frontend/prototypes/agent-management/src/pages/simple-pages.tsx) | TypeScript JSX | 24 | 1 | 3 | 28 |
| [frontend/prototypes/agent-management/src/pages/skills-section.tsx](/frontend/prototypes/agent-management/src/pages/skills-section.tsx) | TypeScript JSX | 166 | 1 | 13 | 180 |
| [frontend/prototypes/agent-management/src/pages/technical-extras.tsx](/frontend/prototypes/agent-management/src/pages/technical-extras.tsx) | TypeScript JSX | 493 | 1 | 27 | 521 |
| [frontend/prototypes/agent-management/src/pages/users.tsx](/frontend/prototypes/agent-management/src/pages/users.tsx) | TypeScript JSX | 998 | 2 | 60 | 1,060 |
| [frontend/prototypes/agent-management/src/providers.tsx](/frontend/prototypes/agent-management/src/providers.tsx) | TypeScript JSX | 163 | 1 | 16 | 180 |
| [frontend/prototypes/agent-management/src/publish-agent-draft.ts](/frontend/prototypes/agent-management/src/publish-agent-draft.ts) | TypeScript | 90 | 0 | 8 | 98 |
| [frontend/prototypes/agent-management/src/routes.ts](/frontend/prototypes/agent-management/src/routes.ts) | TypeScript | 27 | 1 | 9 | 37 |
| [frontend/prototypes/agent-management/src/shell.tsx](/frontend/prototypes/agent-management/src/shell.tsx) | TypeScript JSX | 373 | 7 | 23 | 403 |
| [frontend/prototypes/agent-management/src/styles.css](/frontend/prototypes/agent-management/src/styles.css) | PostCSS | 48 | 1 | 8 | 57 |
| [frontend/prototypes/agent-management/src/ui.tsx](/frontend/prototypes/agent-management/src/ui.tsx) | TypeScript JSX | 885 | 2 | 44 | 931 |
| [frontend/prototypes/agent-management/src/user-label.ts](/frontend/prototypes/agent-management/src/user-label.ts) | TypeScript | 10 | 1 | 3 | 14 |
| [frontend/prototypes/agent-management/tsconfig.json](/frontend/prototypes/agent-management/tsconfig.json) | JSON with Comments | 12 | 0 | 1 | 13 |
| [frontend/prototypes/agent-management/vite.config.ts](/frontend/prototypes/agent-management/vite.config.ts) | TypeScript | 17 | 3 | 2 | 22 |
| [frontend/public/favicon.svg](/frontend/public/favicon.svg) | XML | 1 | 0 | 0 | 1 |
| [frontend/public/staticwebapp.config.json](/frontend/public/staticwebapp.config.json) | JSON | 9 | 0 | 1 | 10 |
| [frontend/src/App.tsx](/frontend/src/App.tsx) | TypeScript JSX | 293 | 0 | 23 | 316 |
| [frontend/src/components/chat/chat-provider.tsx](/frontend/src/components/chat/chat-provider.tsx) | TypeScript JSX | 35 | 0 | 7 | 42 |
| [frontend/src/components/chat/markdown-message.tsx](/frontend/src/components/chat/markdown-message.tsx) | TypeScript JSX | 4 | 0 | 2 | 6 |
| [frontend/src/components/chat/use-chat-workspace.ts](/frontend/src/components/chat/use-chat-workspace.ts) | TypeScript | 684 | 5 | 31 | 720 |
| [frontend/src/components/chat/workspace.test.tsx](/frontend/src/components/chat/workspace.test.tsx) | TypeScript JSX | 693 | 0 | 39 | 732 |
| [frontend/src/components/chat/workspace.tsx](/frontend/src/components/chat/workspace.tsx) | TypeScript JSX | 1,184 | 5 | 54 | 1,243 |
| [frontend/src/components/manage/access-panel.tsx](/frontend/src/components/manage/access-panel.tsx) | TypeScript JSX | 475 | 1 | 24 | 500 |
| [frontend/src/components/manage/agent-settings-page.tsx](/frontend/src/components/manage/agent-settings-page.tsx) | TypeScript JSX | 677 | 2 | 29 | 708 |
| [frontend/src/components/manage/agents-list-page.tsx](/frontend/src/components/manage/agents-list-page.tsx) | TypeScript JSX | 287 | 0 | 10 | 297 |
| [frontend/src/components/manage/configuration-form.test.tsx](/frontend/src/components/manage/configuration-form.test.tsx) | TypeScript JSX | 14 | 0 | 6 | 20 |
| [frontend/src/components/manage/configuration-form.tsx](/frontend/src/components/manage/configuration-form.tsx) | TypeScript JSX | 329 | 1 | 17 | 347 |
| [frontend/src/components/manage/group-detail-page.tsx](/frontend/src/components/manage/group-detail-page.tsx) | TypeScript JSX | 461 | 0 | 22 | 483 |
| [frontend/src/components/manage/groups-page.tsx](/frontend/src/components/manage/groups-page.tsx) | TypeScript JSX | 242 | 0 | 14 | 256 |
| [frontend/src/components/manage/instruction-skills-panel.test.tsx](/frontend/src/components/manage/instruction-skills-panel.test.tsx) | TypeScript JSX | 92 | 0 | 8 | 100 |
| [frontend/src/components/manage/instruction-skills-panel.tsx](/frontend/src/components/manage/instruction-skills-panel.tsx) | TypeScript JSX | 359 | 2 | 29 | 390 |
| [frontend/src/components/manage/management-page.tsx](/frontend/src/components/manage/management-page.tsx) | TypeScript JSX | 627 | 2 | 21 | 650 |
| [frontend/src/components/manage/management.test.tsx](/frontend/src/components/manage/management.test.tsx) | TypeScript JSX | 791 | 0 | 39 | 830 |
| [frontend/src/components/manage/use-management.ts](/frontend/src/components/manage/use-management.ts) | TypeScript | 916 | 2 | 43 | 961 |
| [frontend/src/components/manage/user-detail-page.tsx](/frontend/src/components/manage/user-detail-page.tsx) | TypeScript JSX | 183 | 0 | 8 | 191 |
| [frontend/src/components/manage/users-page.tsx](/frontend/src/components/manage/users-page.tsx) | TypeScript JSX | 322 | 0 | 14 | 336 |
| [frontend/src/components/shell/app-shell.tsx](/frontend/src/components/shell/app-shell.tsx) | TypeScript JSX | 615 | 0 | 29 | 644 |
| [frontend/src/components/shell/use-app-shell.ts](/frontend/src/components/shell/use-app-shell.ts) | TypeScript | 5 | 0 | 3 | 8 |
| [frontend/src/components/ui/button.tsx](/frontend/src/components/ui/button.tsx) | TypeScript JSX | 65 | 2 | 9 | 76 |
| [frontend/src/components/ui/primitives.tsx](/frontend/src/components/ui/primitives.tsx) | TypeScript JSX | 577 | 2 | 27 | 606 |
| [frontend/src/hooks/use-instruction-eligibility.test.tsx](/frontend/src/hooks/use-instruction-eligibility.test.tsx) | TypeScript JSX | 100 | 0 | 8 | 108 |
| [frontend/src/hooks/use-instruction-eligibility.ts](/frontend/src/hooks/use-instruction-eligibility.ts) | TypeScript | 98 | 4 | 12 | 114 |
| [frontend/src/index.css](/frontend/src/index.css) | PostCSS | 48 | 1 | 8 | 57 |
| [frontend/src/lib/agent-drafts.test.ts](/frontend/src/lib/agent-drafts.test.ts) | TypeScript | 51 | 0 | 6 | 57 |
| [frontend/src/lib/agent-drafts.ts](/frontend/src/lib/agent-drafts.ts) | TypeScript | 136 | 2 | 19 | 157 |
| [frontend/src/lib/api.test.ts](/frontend/src/lib/api.test.ts) | TypeScript | 115 | 0 | 13 | 128 |
| [frontend/src/lib/api.ts](/frontend/src/lib/api.ts) | TypeScript | 291 | 1 | 20 | 312 |
| [frontend/src/lib/auth-config.ts](/frontend/src/lib/auth-config.ts) | TypeScript | 22 | 0 | 4 | 26 |
| [frontend/src/lib/chat-preference.ts](/frontend/src/lib/chat-preference.ts) | TypeScript | 30 | 3 | 7 | 40 |
| [frontend/src/lib/errors.ts](/frontend/src/lib/errors.ts) | TypeScript | 36 | 0 | 5 | 41 |
| [frontend/src/lib/execution-status.ts](/frontend/src/lib/execution-status.ts) | TypeScript | 38 | 0 | 6 | 44 |
| [frontend/src/lib/instruction-eligibility-cache.ts](/frontend/src/lib/instruction-eligibility-cache.ts) | TypeScript | 18 | 0 | 6 | 24 |
| [frontend/src/lib/instruction-eligibility.ts](/frontend/src/lib/instruction-eligibility.ts) | TypeScript | 6 | 10 | 1 | 17 |
| [frontend/src/lib/instruction-skills.test.ts](/frontend/src/lib/instruction-skills.test.ts) | TypeScript | 38 | 0 | 6 | 44 |
| [frontend/src/lib/instruction-skills.ts](/frontend/src/lib/instruction-skills.ts) | TypeScript | 71 | 2 | 12 | 85 |
| [frontend/src/lib/management.test.ts](/frontend/src/lib/management.test.ts) | TypeScript | 95 | 0 | 9 | 104 |
| [frontend/src/lib/management.ts](/frontend/src/lib/management.ts) | TypeScript | 838 | 0 | 67 | 905 |
| [frontend/src/lib/permissions.test.ts](/frontend/src/lib/permissions.test.ts) | TypeScript | 52 | 0 | 7 | 59 |
| [frontend/src/lib/permissions.ts](/frontend/src/lib/permissions.ts) | TypeScript | 65 | 6 | 6 | 77 |
| [frontend/src/lib/project-link.test.ts](/frontend/src/lib/project-link.test.ts) | TypeScript | 16 | 0 | 3 | 19 |
| [frontend/src/lib/project-link.ts](/frontend/src/lib/project-link.ts) | TypeScript | 19 | 1 | 1 | 21 |
| [frontend/src/lib/read-cache.ts](/frontend/src/lib/read-cache.ts) | TypeScript | 142 | 0 | 26 | 168 |
| [frontend/src/lib/routes.ts](/frontend/src/lib/routes.ts) | TypeScript | 25 | 1 | 9 | 35 |
| [frontend/src/lib/session-drafts.test.ts](/frontend/src/lib/session-drafts.test.ts) | TypeScript | 28 | 0 | 3 | 31 |
| [frontend/src/lib/session-drafts.ts](/frontend/src/lib/session-drafts.ts) | TypeScript | 45 | 6 | 7 | 58 |
| [frontend/src/lib/sessions.test.ts](/frontend/src/lib/sessions.test.ts) | TypeScript | 52 | 0 | 4 | 56 |
| [frontend/src/lib/sessions.ts](/frontend/src/lib/sessions.ts) | TypeScript | 24 | 4 | 4 | 32 |
| [frontend/src/lib/sse.test.ts](/frontend/src/lib/sse.test.ts) | TypeScript | 83 | 0 | 13 | 96 |
| [frontend/src/lib/sse.ts](/frontend/src/lib/sse.ts) | TypeScript | 236 | 0 | 17 | 253 |
| [frontend/src/lib/transcript-cache.ts](/frontend/src/lib/transcript-cache.ts) | TypeScript | 44 | 0 | 9 | 53 |
| [frontend/src/lib/types.ts](/frontend/src/lib/types.ts) | TypeScript | 87 | 0 | 11 | 98 |
| [frontend/src/lib/utils.ts](/frontend/src/lib/utils.ts) | TypeScript | 5 | 0 | 2 | 7 |
| [frontend/src/main.tsx](/frontend/src/main.tsx) | TypeScript JSX | 32 | 0 | 4 | 36 |
| [frontend/src/test/setup.ts](/frontend/src/test/setup.ts) | TypeScript | 9 | 1 | 2 | 12 |
| [frontend/src/vite-env.d.ts](/frontend/src/vite-env.d.ts) | TypeScript | 10 | 3 | 3 | 16 |
| [frontend/tsconfig.app.json](/frontend/tsconfig.app.json) | JSON | 27 | 2 | 3 | 32 |
| [frontend/tsconfig.json](/frontend/tsconfig.json) | JSON with Comments | 7 | 0 | 1 | 8 |
| [frontend/tsconfig.node.json](/frontend/tsconfig.node.json) | JSON | 22 | 2 | 3 | 27 |
| [frontend/vite.config.ts](/frontend/vite.config.ts) | TypeScript | 20 | 1 | 2 | 23 |
| [infra/README.md](/infra/README.md) | Markdown | 200 | 0 | 67 | 267 |
| [infra/bootstrap/main.bicep](/infra/bootstrap/main.bicep) | Bicep | 19 | 0 | 6 | 25 |
| [infra/main.bicep](/infra/main.bicep) | Bicep | 180 | 3 | 43 | 226 |
| [infra/modules/app-insights.bicep](/infra/modules/app-insights.bicep) | Bicep | 22 | 0 | 6 | 28 |
| [infra/modules/container-app-env.bicep](/infra/modules/container-app-env.bicep) | Bicep | 28 | 2 | 7 | 37 |
| [infra/modules/container-app.bicep](/infra/modules/container-app.bicep) | Bicep | 267 | 4 | 46 | 317 |
| [infra/modules/identity-rbac.bicep](/infra/modules/identity-rbac.bicep) | Bicep | 20 | 0 | 6 | 26 |
| [infra/modules/log-analytics.bicep](/infra/modules/log-analytics.bicep) | Bicep | 24 | 2 | 7 | 33 |
| [infra/modules/managed-identity.bicep](/infra/modules/managed-identity.bicep) | Bicep | 15 | 0 | 5 | 20 |
| [infra/modules/static-web-app.bicep](/infra/modules/static-web-app.bicep) | Bicep | 28 | 0 | 6 | 34 |
| [infra/modules/storage.bicep](/infra/modules/storage.bicep) | Bicep | 81 | 0 | 10 | 91 |
| [infra/parameters/demo.bicepparam](/infra/parameters/demo.bicepparam) | Bicep | 32 | 18 | 9 | 59 |
| [infra/scripts/validate-deploy-secrets.sh](/infra/scripts/validate-deploy-secrets.sh) | Shell Script | 38 | 13 | 17 | 68 |
| [scripts/infra/deploy.sh](/scripts/infra/deploy.sh) | Shell Script | 74 | 33 | 32 | 139 |

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)