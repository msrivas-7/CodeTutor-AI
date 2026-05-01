# Modules & Imports

So far every lesson has fit in one `main.py`. That's fine for short scripts — but as your programs grow, one giant file becomes hard to read, hard to test, and hard to share. Python's answer is the *module*: any `.py` file is a module, and you can pull names out of it with `import`.

This lesson is your first multi-file lesson. The starter has two files: `main.py` (the script you run) and `wordstats.py` (a helper module). You'll fill in both.

## What you'll learn

- Split a program into a main file and a helper module
- Choose between `import x` and `from x import y`
- Understand what `if __name__ == "__main__":` is for and why every Python tutorial mentions it

## Instructions

You'll build a tiny word-stats tool, split across two files.

**`wordstats.py`** — a helper module. Define two functions here:
1. `count_words(text)` — return the number of whitespace-separated words in `text`. (Hint: `text.split()` with no arguments handles all whitespace.)
2. `unique_words(text)` — return the count of *distinct* words in `text`.

**`main.py`** — the script. Import both functions from `wordstats`, then for the sample text `"the quick brown fox jumps over the lazy dog"` print:

```
total words: 9
unique words: 8
```

Wrap your script logic in `if __name__ == "__main__":` so the prints only run when `main.py` is executed directly — not when something else imports it.

## Key concepts

### Files as modules

Any `.py` file you write *is* a module. If you have a file `wordstats.py` with `def count_words(text): ...`, then from another file you can write:

```python
import wordstats
wordstats.count_words("hello world")
```

Python looks for `wordstats.py` in the same folder as the file you're running, plus a few standard locations. If it can't find it, you get `ModuleNotFoundError`.

### import x vs from x import y

There are two common shapes:

```python
import math
math.pi          # accessed via the module name

from math import pi
pi               # name pulled directly into your namespace
```

`import math` keeps the namespace clean — you always know `math.pi` came from `math`. `from math import pi` is shorter at the call site but can hide where a name came from, especially in a long file. A reasonable default: use `import x` for unfamiliar modules; use `from x import y` for one or two names you'll use a lot, when there's no ambiguity.

There's also `import x as y` for renaming on import — common in data science (`import numpy as np`) but rarer elsewhere. Don't reach for it just to type less.

### `if __name__ == "__main__":`

Every Python file has a built-in variable called `__name__`. Its value depends on *how* the file is being run:

- If you run the file directly (`python main.py`), `__name__` is `"__main__"`.
- If another file *imports* this one, `__name__` is the module's name (e.g., `"wordstats"`).

That distinction is what lets a single file act as both a script and an importable library:

```python
def greet(name):
    return f"hello, {name}"

if __name__ == "__main__":
    # runs when you execute this file
    print(greet("world"))
```

When something else does `import this_file`, the `def greet` runs (so the function is defined), but the `print` doesn't. Without the guard, your library would print "hello, world" every time someone imported it — which is almost never what you want.

For your helper module `wordstats.py`, you don't need the guard — there's no script-level code in it, just function definitions. The guard belongs in `main.py`.

### When NOT to split

A module isn't free. Each new file is one more thing for a reader to keep in mind, one more place to look when something breaks. If your script is short and read by one person — say, under fifty lines or so — keeping it in one file is usually clearer. Split when there's a real reason: the file is genuinely getting long, or you want to share helpers with another script, or you want to test a function in isolation. "It feels neater" is usually not yet enough.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. Two files, two jobs. `wordstats.py` only contains function definitions. `main.py` brings them in and uses them — and runs nothing at module-load time.
2. In `wordstats.py`: `text.split()` with no argument splits on any whitespace and drops empty strings. For unique words, wrap the result with `set` (or use a set comprehension). In `main.py`: `from wordstats import count_words, unique_words` and call them inside an `if __name__ == "__main__":` block.
3. The same shape in a different domain — a math helper module:
```python
# mathutils.py
def square(n):
    return n * n

# main.py
from mathutils import square
if __name__ == "__main__":
    print(square(7))  # 49
```
