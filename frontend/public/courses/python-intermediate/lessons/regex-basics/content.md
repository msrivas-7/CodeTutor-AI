# Regex Basics

You've used `str.split()`, `str.startswith()`, and `in` to inspect strings. Those handle the easy cases — when the thing you're looking for is a fixed substring or sits at a known offset. But sometimes what you're looking for is a *shape*, not a fixed string. Three digits, a dash, four digits. An `@` with words on either side. A line that looks like a date.

A *regular expression* — regex — is a tiny language for describing those shapes. Python's `re` module gives you three functions that do almost everything practical you'll ever need: find one match, find all matches, or replace every match.

## What you'll learn

- Use `re.search`, `re.findall`, and `re.sub`
- Read and write the small set of metacharacters that cover most real cases
- Recognize when a regex is the *wrong* tool

## Instructions

The starter has a string of text mixing prose with HTTP status codes. Build three things and print each on its own line:

1. **Every number** in the text. Use `re.findall(r"\d+", text)`. Print as `all numbers: <list>`.
2. **The first error code.** Find the first match of the pattern `[Ee]rror (\d+)` using `re.search`. Pull out the captured digits with `.group(1)`. Print as `first error code: <code>`.
3. **The redacted text.** Replace every run of digits with the literal string `###` using `re.sub`. Print as `redacted: <text>`.

Your output must match exactly:

```
all numbers: ['404', '500', '200']
first error code: 404
redacted: Error ###: not found. Then later, error ### happened. Final code ###.
```

## Key concepts

### `re.search`, `re.findall`, `re.sub`

```python
import re

re.search(pattern, text)     # first match (or None)
re.findall(pattern, text)    # list of all matches
re.sub(pattern, replacement, text)  # text with every match replaced
```

`search` returns a *match object* if it found something, or `None`. To get the actual matched string, call `.group()` on the match. `findall` skips that step and just gives you the matches as a list of strings. `sub` is the rewrite function — it returns a new string with every match replaced.

```python
re.search(r"\d+", "no digits here")     # None
re.search(r"\d+", "version 12").group()  # "12"
re.findall(r"\d+", "a1 b22 c3")          # ["1", "22", "3"]
re.sub(r"\d+", "N", "a1 b22 c3")         # "aN bN cN"
```

### Metacharacters that earn their keep

A regex pattern is mostly literal characters with a few special ones:

| pattern | meaning |
| --- | --- |
| `\d` | a digit (0-9) |
| `\w` | a word character (letters, digits, underscore) |
| `\s` | whitespace (space, tab, newline) |
| `+` | one or more of the previous thing |
| `*` | zero or more of the previous thing |
| `?` | optional (zero or one) |
| `[abc]` | one of `a`, `b`, or `c` |
| `[^abc]` | any character *except* `a`, `b`, or `c` |
| `.` | any character (use `\.` for a literal dot) |
| `()` | a capture group |

So `\d{3}-\d{4}` matches exactly three digits, a hyphen, exactly four digits — a phone number shape. `[Ee]rror` matches "Error" or "error". `\w+@\w+\.\w+` is a (very loose) email pattern.

### Raw strings

Always wrap your pattern in `r"..."`:

```python
re.findall(r"\d+", text)   # raw string — backslashes are literal
re.findall("\\d+", text)   # works, but ugly
```

A raw string tells Python "don't interpret backslashes specially." Without `r`, you'd have to escape every backslash. With `r`, `\d` in your code is exactly `\d` in the regex.

### Capture groups

Parentheses in a pattern create a *capture group* — a sub-match you can pull out separately:

```python
m = re.search(r"(\w+)@(\w+)", "alice@example")
m.group(0)   # "alice@example" — the whole match
m.group(1)   # "alice"        — first group
m.group(2)   # "example"      — second group
```

For `findall` with one group, you get a list of just-the-group strings. With multiple groups, you get a list of tuples. Capture groups are how you extract structured data out of free text — phone numbers from a message, dates from a log line, names from a header.

### When NOT to use a regex

A regex is right when you're matching a *shape* in flat text. It's wrong when:

- The data has nested structure (HTML, XML, JSON, code) — use a real parser.
- You're looking for an exact substring — use `in` or `str.find`.
- The "pattern" depends on context that varies per line — write a small state machine instead.

The classic line is: "Some people, when confronted with a problem, think 'I know, I'll use regular expressions.' Now they have two problems." The cost is real — regexes are write-once, read-painfully. Save them for cases where the alternative is worse.

## Hints

(These are surfaced by the tutor on request — they don't auto-reveal.)

1. Three calls to `re.<something>` in sequence. Each takes the same `text`. The first uses `findall`, the second `search` plus `.group(1)` to pull a captured number, the third `sub` to rewrite digits.
2. Shape:
```python
import re

text = "..."   # given by the starter
nums = re.findall(r"\d+", text)
m = re.search(r"[Ee]rror (\d+)", text)
first = m.group(1)
redacted = re.sub(r"\d+", "###", text)
```
The `(\d+)` in the search pattern is what `m.group(1)` pulls out — without the parens you'd get the whole match including "Error ".
3. The same trio in a different domain — a chat log:
```python
all_users = re.findall(r"@\w+", chat)
first_mention = re.search(r"@(\w+)", chat).group(1)
anon = re.sub(r"@\w+", "@user", chat)
```
