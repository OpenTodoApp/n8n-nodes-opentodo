# Changelog

All notable changes to this package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-26

First release.

### Added

- **OpenTodo API credential**: the server's address and an API token sent as a Bearer token, checked with `GET /api/v1/me`. The description explains which token access to pick.
- **OpenTodo node**, also usable as a tool by n8n's AI Agent:
  - Task: Create (title, description, project, section, labels, priority 1 to 4, due date, time and time zone, deadline, estimate, repeat rule, parent task, assignee, idempotency key, and an option to read quick-add syntax such as `milk tomorrow #Home p1 @errands`), Get, Get Many (filters for project or Inbox, label, parent task, open/completed, due range, completion range, text search; Return All or a limit), Update, Complete, Reopen, Delete (to the Trash).
  - Project: Create, Get, Get Many (archived projects optional), Update, Archive.
  - Label: Create, Get Many.
  - Comment: Add (optionally as a reply), Get Many.
  - Projects, labels and sections are picked from lists loaded from the server.
- **OpenTodo Trigger node**: creates a webhook in OpenTodo for the chosen task, project and import events (optionally one project) when the workflow is activated and deletes it when it is deactivated. Every delivery's `X-OpenTodo-Signature` is checked against the secret OpenTodo returned, with a five-minute replay window; redelivered events start the workflow once; test pings are acknowledged without starting it unless asked to.
- Unit tests, and end-to-end tests against a real OpenTodo server and a real n8n with the package installed, in CI.
- Publishing from GitHub Actions with npm provenance on a version tag.

[Unreleased]: https://github.com/OpenTodoApp/n8n-nodes-opentodo/compare/0.1.0...HEAD
[0.1.0]: https://github.com/OpenTodoApp/n8n-nodes-opentodo/releases/tag/0.1.0
