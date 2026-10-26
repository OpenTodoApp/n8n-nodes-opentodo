# n8n-nodes-opentodo

[n8n](https://n8n.io) community nodes for [OpenTodo](https://github.com/OpenTodoApp/OpenTodo), the open-source, self-hosted task manager.

- **OpenTodo**: create, read, update, complete and delete tasks; manage projects, labels and comments. It can also be used as a tool by n8n's AI Agent.
- **OpenTodo Trigger**: start a workflow when tasks or projects change, through a signed OpenTodo webhook that the node creates and removes for you.

The nodes talk only to your own OpenTodo server, through its [HTTP API](https://github.com/OpenTodoApp/OpenTodo/blob/main/docs/api.md), with one API token. They need no change on the server. Tested with n8n 2.44 and OpenTodo 0.13.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [Examples](#example-workflows) · [AI agents](#ai-agents) · [Limits](#limits) · [Development](#development)

## Installation

On a self-hosted n8n, as the instance owner:

1. Open **Settings → Community nodes** and choose **Install**.
2. Enter `n8n-nodes-opentodo`, confirm the risk notice and choose **Install**.

The **OpenTodo** and **OpenTodo Trigger** nodes then appear in the node panel. For queue mode or a Docker image you build yourself, install the package with `npm install n8n-nodes-opentodo` in `~/.n8n/nodes` instead, as the [n8n documentation](https://docs.n8n.io/integrations/community-nodes/installation/) describes.

## Credentials

1. In OpenTodo, open **Settings → Integrations → API tokens**, choose **New token**, name it "n8n" and pick the access you need. Copy the token: it is shown once.
2. In n8n, create an **OpenTodo API** credential with:
   - **Server URL**: the address you open OpenTodo at, such as `https://todo.example.com` or `http://192.168.1.20:8080` (without `/api/v1`). It must be reachable from the n8n server.
   - **API Token**: the `ot_…` token.

n8n checks the pair with `GET /api/v1/me` when you save.

| Token access | What works |
| --- | --- |
| **Full access** | Everything, including the OpenTodo Trigger. Use this one for workflows that change things. |
| **Read only** | Get and Get Many of every resource. Writes are refused with `insufficient_scope`, and the trigger cannot create its webhook. Good for reports and digests. |
| **AI assistant** | Creating and editing tasks, projects, labels and comments, only while the server owner and you allow assistant changes; changes are recorded as an assistant's. No trigger. |
| **Admin** | Not needed. |

## Operations

| Resource | Operations |
| --- | --- |
| Task | Create, Get, Get Many, Update, Complete, Reopen, Delete |
| Project | Create, Get, Get Many, Update, Archive |
| Label | Create, Get Many |
| Comment | Add, Get Many |

Field names and values follow the [OpenTodo API](https://github.com/OpenTodoApp/OpenTodo/blob/main/docs/api.md#task-fields). The output of every operation is the entity as the API returns it (Create and Update answer with the fields they wrote; Get returns the whole entity).

**Task → Create** takes a title and optionally the description (Markdown), project, section, labels, priority (1 is the highest, 4 the default), due date, due time (`HH:MM`) and due time zone, deadline, estimate in minutes, repeat rule (`every weekday`), parent task, assignee and an idempotency key.

- **Due dates are floating**: `2026-11-02` means that day wherever you are. A time in the date picker's value (other than midnight) becomes the due time. A due time zone fixes the time to that zone instead.
- **Parse Quick-Add Syntax** reads the title like the app's quick add, in your account's language: `milk tomorrow 18:00 #Home p1 @errands` becomes the task "milk", due tomorrow at 18:00, in Home, priority 1, with the label errands. Labels that do not exist yet are created, and reminders in the text (`remind me 30 min before`) are added. Fields set on the node win over the text; labels are combined.
- **Idempotency Key**: a retry with the same key and content returns the task created the first time instead of a second one.

**Task → Get Many** returns open tasks by default. Filters: project (or **Inbox** for tasks without one), label, parent task, status (open, completed, all), a due range, a completion range (read in the workflow's time zone) and a text search over title and description. **Return All** or a **Limit**. OpenTodo's API returns every task of the account in one response, so the node filters and limits after receiving them.

**Task → Complete** sets the completion time to now. For a repeating task OpenTodo records the occurrence and moves the task to its next date, as in the app. **Delete** moves the task to the Trash, where it can be restored.

**Project → Archive** archives the project; **Update** with *Archived* off restores it.

## Trigger

The **OpenTodo Trigger** starts the workflow on the events you pick:

| Event | When |
| --- | --- |
| Task Created, Updated, Completed, Reopened, Deleted | a task changes, from any app, the API, CalDAV or a rule |
| Project Created, Updated, Archived, Deleted | a project changes |
| Import Completed, Import Undone | one summary per import job |

Optionally limit it to one project. The output is OpenTodo's [webhook payload](https://github.com/OpenTodoApp/OpenTodo/blob/main/docs/webhooks.md#payload-version-1): `event`, `data.task` or `data.project` with every field, `changes` with each changed field's `from` and `to`, and `source` (`device`, `server`, `caldav`, `rule`, `import`), which lets a workflow skip changes it made itself (`server`). OpenTodo has no comment events.

How it works:

- When you activate the workflow (or listen for a test event), the node creates a webhook in your OpenTodo account pointing at n8n's webhook URL and keeps the secret OpenTodo returns in the workflow's static data. When you deactivate it, the node deletes the webhook. If OpenTodo disabled the webhook after repeated failures, or the events or project changed, activation replaces it.
- Every delivery's `X-OpenTodo-Signature` is checked: an HMAC-SHA256 of the timestamp and the raw body with the secret. A wrong signature, or a timestamp more than five minutes off (an option), is answered `401` and starts nothing.
- OpenTodo delivers at least once and retries failures for about a day. The node remembers the last 200 delivery ids, so a redelivery starts the workflow once.
- **Send test** in OpenTodo's webhook menu sends a `ping`, which is acknowledged without starting the workflow unless **Emit Test Pings** is on.

Requirements:

- A **Full access** token.
- The OpenTodo server must reach n8n's webhook URL. Set n8n's `WEBHOOK_URL` (`N8N_WEBHOOK_URL` on recent versions) to an address OpenTodo can open.
- OpenTodo refuses webhooks to private network addresses (`192.168.x.x`, `10.x`, Docker networks, `localhost`, Tailscale) until the **owner** turns on **Settings → Integrations → Webhooks → Allow private network targets**. Without it, activation fails with `private_target`. See [Private network protection](https://github.com/OpenTodoApp/OpenTodo/blob/main/docs/webhooks.md#private-network-protection).
- An account has at most 20 webhooks.

## Example workflows

**New GitHub issue → task.** GitHub Trigger (event *issues*) → IF `{{$json.body.action}}` is `opened` → OpenTodo *Task → Create* with title `{{$json.body.issue.title}}`, description `{{$json.body.issue.html_url}}`, project *Work* and label *github*. Use the issue URL as the **Idempotency Key** so a re-run does not create a duplicate.

**Task completed → Slack.** OpenTodo Trigger (*Task Completed*, project *Team*) → Slack *Send message* with `✅ {{$json.data.task.title}}`.

**Daily digest.** Schedule Trigger (every day at 07:30) → OpenTodo *Task → Get Many* with *Due To* `{{$today.toFormat('yyyy-MM-dd')}}` and Return All → Aggregate → Send Email or a chat message listing `title` and `due.date`. A Read only token is enough.

**Email to a task with quick-add.** IMAP Email Trigger → OpenTodo *Task → Create* with title `{{$json.subject}}` and **Parse Quick-Add Syntax** on, so a subject like `Renew passport next friday p1 #Admin` lands in the right place.

## AI agents

The OpenTodo node can be attached to n8n's **AI Agent** as a tool. Let the model fill fields with `$fromAI()` (n8n offers this on each field when the node is a tool), and add one tool per operation you want to allow, for example *Task → Get Many* and *Task → Create*. Give the agent a Read only credential when it should only answer questions, and keep deletes out of the tool list unless you want them. Labels can be passed as a comma separated list of ids. With Parse Quick-Add Syntax on, a model can write `Call Anna tomorrow 9am #Work p2` and let OpenTodo read it.

## Limits

- **End-to-end encrypted accounts**: titles, descriptions and names arrive as ciphertext (`enc:v1:…`), and quick-add cannot match project or label names. Use the nodes with an account without encryption.
- Get Many fetches every task of the account and filters in n8n; on very large accounts prefer narrow filters and a limit, or a completion range, which the server applies.
- There is no server-side full-text search; *Search* filters the received tasks.
- Quick-add time spent (the `30m` in `30m/2h`) is not recorded; the estimate is.
- Deleting a parent task or archiving a parent project does not cascade: the API changes exactly the item you name, as in OpenTodo's API.
- In a shared project where you are a viewer, changes are refused with OpenTodo's message.

## Compatibility

- n8n 2.x (tested in CI with 2.44.7). The trigger needs a self-hosted n8n reachable by your OpenTodo server.
- OpenTodo 0.13 or later (tested in CI with 0.13.0).

## Development

```bash
npm ci
npm run lint        # n8n's community node rules (strict)
npm run typecheck
npm test            # unit tests: request building, filters, pagination, signatures, trigger lifecycle
npm run build
npm run test:e2e    # needs Docker: real OpenTodo, and a real n8n with the packed package installed
npm run dev         # n8n with the nodes loaded, rebuilt on change
```

The end-to-end suites start `ghcr.io/pixari/opentodo:0.13.0` (override with `E2E_OT_IMAGE`) and `docker.n8n.io/n8nio/n8n:2.44.7` (`E2E_N8N_IMAGE`); `E2E_KEEP=1` keeps the containers. `tests_e2e/nodes.e2e.test.mts` runs every operation of the node and the trigger's webhook lifecycle and signed deliveries against the server; `tests_e2e/n8n.e2e.test.mts` installs the package into n8n, runs a workflow with `n8n execute`, and checks that an activated trigger receives a signed delivery from OpenTodo and runs its workflow.

### Releasing

1. Update `version` in `package.json` and the CHANGELOG, and merge to `main`.
2. Push a tag with the same version: `git tag 0.1.0 && git push origin 0.1.0` (or run `npm run release`, which bumps, tags and pushes interactively).
3. The **Publish** workflow lints, tests, builds and runs `npm publish --provenance` with the `NPM_TOKEN` repository secret.

## Licence

MIT. The icon is OpenTodo's brand mark, used with permission of its author.

Problems and ideas go to the [issue tracker](https://github.com/OpenTodoApp/n8n-nodes-opentodo/issues). OpenTodo's own documentation for this integration is [docs/n8n.md](https://github.com/OpenTodoApp/OpenTodo/blob/main/docs/n8n.md).
