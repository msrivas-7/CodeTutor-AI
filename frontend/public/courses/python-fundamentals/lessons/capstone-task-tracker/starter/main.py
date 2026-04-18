# Capstone: Task Tracker CLI
# Reads commands from stdin, maintains a task list, prints on "list".

import sys


# TODO: Append a new task with the next id (1, 2, 3, ...), done=False.
def add_task(tasks, text):
    pass


# TODO: Find the task with the given id and set done=True.
def done_task(tasks, task_id):
    pass


# TODO: Print each task as:  {id}. [x|' '] {text}
# Then print:                Done: {completed}/{total}
def list_tasks(tasks):
    pass


tasks = []

for line in sys.stdin.read().strip().splitlines():
    parts = line.split(maxsplit=1)
    if not parts:
        continue
    cmd = parts[0]
    arg = parts[1] if len(parts) > 1 else ""

    # TODO: Dispatch based on cmd.
    #   "add"  -> add_task(tasks, arg)
    #   "done" -> done_task(tasks, int(arg))
    #   "list" -> list_tasks(tasks)
