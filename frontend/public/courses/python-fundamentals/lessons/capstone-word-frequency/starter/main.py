# Capstone: Word Frequency Counter
# Reads a paragraph from stdin, counts word frequency, prints top 3.

import sys


# TODO: Write tokenize(text) that:
#   - lowercases text
#   - strips these punctuation chars: . , ! ? ; :
#   - returns a list of words (split on whitespace)
def tokenize(text):
    pass


# TODO: Write count_words(words) that returns {word: count}
def count_words(words):
    pass


# TODO: Write top_n(counts, n) that returns the n (word, count) pairs
# with the highest counts. Break ties alphabetically.
def top_n(counts, n):
    pass


text = sys.stdin.read()

# TODO: Tokenize, count, and print:
#   Total words: N
#   Unique words: M
#   Top 3:
#   word: count     (three lines, one per top word)
