# File I/O

Until now your programs have lived entirely in memory — every list, dict, and variable disappears the moment the script exits. Files change that. They let your program *remember*: between runs, between users, between weeks.

Working with files is mostly about being careful with one thing: making sure the file always gets closed, even when something goes wrong halfway through. Python has a syntax built specifically for that — the `with` statement.

## What you'll learn

- Read and write text files with `with open(...) as f:`
- Pick the right mode: `"r"` to read, `"w"` to write, `"a"` to append
- Understand why `with` is preferred over a manual `open` / `close` pair

## Instructions

You're given a list of three notes. Build a tiny "save and reload" program:

1. Write all three notes to a file called `notes.txt`, one per line, using `with open("notes.txt", "w") as f:`.
2. Re-open the file in read mode, read its contents, and split into lines.
3. Print a summary header, then each line numbered.

Your output must match exactly:

```
wrote 3 notes:
1. pick up groceries
2. call mom
3. finish lesson
```

The starter has the notes list ready and the print calls scaffolded.

## Key concepts

### with open(...) as f

This is the canonical pattern for working with files in Python:

```python
with open("data.txt", "r") as f:
    contents = f.read()
# file is closed here, automatically
```

The `with` block defines a *context*. When the block exits — whether normally or because an exception fired inside — Python calls `f.close()` for you. That guarantee is what makes `with` better than the older `f = open(...); ...; f.close()` form: in the manual form, an exception between `open` and `close` leaks a file handle. With `with`, you can't forget.

(`open` returns a *context manager*. `with` works with anything that's a context manager — locks, database connections, network sockets. Files are the most common one you'll meet first.)

### File modes

The second argument to `open` is the mode. The three you'll use most:

| mode | what it does                                     |
| ---- | ------------------------------------------------ |
| `"r"` | read (default). Errors if the file doesn't exist. |
| `"w"` | write. **Truncates the file first** — existing contents are gone. |
| `"a"` | append. Creates the file if missing; writes go to the end. |

The truncation behavior of `"w"` is the easiest one to get bitten by. If you open a file with `"w"` and then your program crashes before you write anything, the file is now empty. When in doubt — and you actually want to keep what's there — reach for `"a"`.

### Reading: a few useful shapes

```python
with open("data.txt", "r") as f:
    everything = f.read()           # the whole file as one string

with open("data.txt", "r") as f:
    lines = f.read().splitlines()   # list of lines, no trailing \n

with open("data.txt", "r") as f:
    for line in f:                  # one line at a time, memory-efficient
        process(line.rstrip())
```

`f.read()` is fine for small files. For large files, iterating `for line in f` reads one line at a time — the whole file never sits in memory.

`splitlines()` is the right way to slice a string into lines: it doesn't leave a trailing empty string when the file ends with `"\n"`, the way `text.split("\n")` does. That difference matters more than it sounds — the empty string is the kind of bug you only notice once a downstream `int(line)` blows up.

### Writing

```python
with open("data.txt", "w") as f:
    f.write("hello\n")          # write a single string
    f.writelines(["a\n", "b\n"]) # write a list of strings
```

`f.write` does not add a newline for you — you have to include `"\n"` if you want one. `print(..., file=f)` is also valid and *does* add a newline; either is fine.

### When NOT to use files

Files are slow compared to memory, and they introduce a whole new failure surface (missing files, permissions, full disks). If your data fits comfortably in memory and you don't need it after the script exits, don't write it to a file. The right time for a file is when you need persistence — between runs, between processes, between machines.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. The starter has the notes list ready and the prints scaffolded — your job is the middle: get the notes onto disk, then read them back as a list of strings.
2. Two `with` blocks. First in `"w"` mode to write each note plus a `"\n"`. Second in `"r"` mode — `f.read().splitlines()` is a clean way to get back a list of lines without the trailing newlines.
3. The same shape, broken into the smallest possible round-trip:
```python
with open("temp.txt", "w") as f:
    f.write("hello\n")
with open("temp.txt", "r") as f:
    print(f.read())  # "hello\n"
```
