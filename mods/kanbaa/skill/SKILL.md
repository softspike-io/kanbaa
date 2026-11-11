---
name: kanbaa-task
description: Create and move tasks on the Kanbaa to-do board in Herdr (Markdown files in the repo's to-do folder, with ids such as HER-12). Use when asked to add, create, file or log a task, to-do, ticket or follow-up for a repo; when work you are doing turns up something that should be tracked instead of done now; and whenever you start or finish work on a task from that folder, to move its card.
---

# Kanbaa task

Kanbaa, the to-do board in Herdr, shows every Markdown file in a repo's to-do folder as a card in one of five statuses: Backlog, Ready, In progress, Review, Done. The files are the board: a card moves when its file's `**Status:**` line changes. Use the script for both creating and moving, so ids, file names and status words are always ones the board reads.

Run it from inside the repo the task belongs to, or pass `--repo <folder>`.

## Creating a task

```sh
node "{{SCRIPT}}" new --title "Fix the login bug" --description "Users are logged out after a refresh."
```

It prints the id and the path, for example `HER-12 to-do/HER-12-fix-the-login-bug.md`. Report both to the person. Never write a task file yourself: the script gives the task its id (the repo's first three letters and the next number) and the file name the board expects.

- `--title` (required): one line, written as the thing to do.
- `--description`: what, why and what done looks like, in Markdown. Use `--description -` and pipe the text in when it has several lines or quotes.
- `--status`: `backlog` (the default), `ready`, `progress`, `review` or `done`.
- `--agent`: the agent to assign, by its Herdr key (`claude`, `codex`, …). Leave it out for unassigned.
- `--manual`: marks the task "Manual pickup only", so the board never offers to start an agent on it.

Rules:

- Leave the status at `backlog` unless the person asked for another one. `ready` invites the board to start an agent on the task.
- Do not assign an agent unless the person named one.
- One task per piece of work. Put what you already know into the description (files, error text, the decision that is still open) so whoever picks it up does not have to rediscover it.

## Working on a task

```sh
node "{{SCRIPT}}" move HER-12 progress
node "{{SCRIPT}}" move HER-12 review
```

The first argument is the id, or the file's path for a task without one. The second is `backlog`, `ready`, `progress`, `review` or `done`.

- When you start work on a task, move it to `progress`, unless it is there already (the board does this itself when it starts you).
- When the work is finished, add a `## Result` section at the end of the task file (replace an older one): two or three lines on what you did, then one bullet per file you created or changed, its path relative to the repo root in backticks. The board shows those files to the person for review.
- Then say what you did, and move the task to `review` as your very last action and stop: the card reaching Review tells the person you are done, so nothing should follow it. Never move a task to `done` yourself: accepting the work is the person's call.
- A task that comes back to you has a `## Feedback` section in its file: the newest line there is why it was sent back. Address it, then replace the Result section and move the task to `review` again.
- If you stop without finishing, leave it in `progress` and write in the file what is left and why you stopped.
- Do not start on a task whose file says "Manual pickup only" unless the person tells you to.
- Never rename a task file or change its id. The title and the text under the header lines are yours to edit when the task itself changes.
- Do not commit task files unless the person asked you to.
