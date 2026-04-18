# Capstone: Word Frequency Counter

Text analysis is everywhere — search engines, spam filters, log analyzers. They all start with the same question: **how often does each word appear?** You'll build a simple version now.

## What you'll build

A program that:

1. Reads a paragraph of text from stdin
2. Tokenizes it — lowercase, strip punctuation, split on whitespace
3. Counts how many times each word appears
4. Prints the total word count, unique word count, and the 3 most-frequent words

## Input (paste into the stdin tab)

```
the quick brown fox jumps over the lazy dog. The dog was not amused. The fox ran away, and the fox never came back.
```

## Expected output

```
Total words: 24
Unique words: 17
Top 3:
the: 5
fox: 3
dog: 2
```

## Requirements

- Write a function `tokenize(text)` that lowercases, strips `. , ! ? ; :`, and splits on whitespace. Return a list of words.
- Write a function `count_words(words)` that returns a `{word: count}` dict.
- Write a function `top_n(counts, n)` that returns the n highest-count `(word, count)` pairs, with ties broken **alphabetically**.
- Print the three sections above, matching the format exactly.

## Hints

- Read everything from stdin with `sys.stdin.read()`.
- Strip punctuation by chaining `.replace(ch, "")` for each punctuation character, or use `str.translate()`.
- `counts.get(word, 0) + 1` is the idiomatic increment-or-start-at-1 pattern.
- Sort with `sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))` — negative count sorts descending, and the word is the alphabetical tiebreaker.
- This is a capstone — take it one function at a time. Print intermediate values if you're unsure.
