# Capstone: Task Tracker CLI

Every command-line tool follows the same shape: parse a command, change some state, print the result. You'll build a small task tracker that does exactly that — reading commands from stdin and printing the current list on demand.

## What you'll build

A program that reads commands (one per line) from stdin and handles three of them:

- `add <text>` — append a task with the next id, marked not-done
- `done <id>` — mark the task with that id as done
- `list` — print every task, plus a "Done: x/y" summary line

## Input (paste into the stdin tab)

```
add Buy groceries
add Finish report
add Call dentist
done 2
list
```

## Expected output

```
1. [ ] Buy groceries
2. [x] Finish report
3. [ ] Call dentist
Done: 1/3
```

- `[ ]` means not done, `[x]` means done.
- The final `Done: 1/3` shows completed / total.

## Requirements

- Store tasks as a **list of dicts**, each with `id`, `text`, and `done`.
- Write one function per command: `add_task(tasks, text)`, `done_task(tasks, task_id)`, `list_tasks(tasks)`.
- `add_task` assigns the next id (1, 2, 3, …) and appends to the list.
- Parse each line with `line.split(maxsplit=1)` so the task text can contain spaces.
- Dispatch via `if/elif`: `if cmd == "add": ... elif cmd == "done": ...`.

## Hints

- Read all input at once: `sys.stdin.read().strip().splitlines()`.
- `line.split(maxsplit=1)` gives `["add", "Buy groceries"]` — the command, then the rest.
- Inside `done_task`, loop to find the task whose `id` matches the given id, then set `done = True`.
- In `list_tasks`, use `mark = "x" if t["done"] else " "` to pick the check mark.
- Count completed with `sum(1 for t in tasks if t["done"])`.
- Build it one command at a time — get `add` + `list` working first, then add `done`.
