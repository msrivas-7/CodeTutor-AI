from wordstats import count_words, unique_words

text = "the quick brown fox jumps over the lazy dog"

if __name__ == "__main__":
    print(f"total words: {count_words(text)}")
    print(f"unique words: {unique_words(text)}")
