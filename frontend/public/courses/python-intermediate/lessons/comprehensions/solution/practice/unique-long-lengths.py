def unique_lengths(words):
    return {len(w) for w in words if len(w) > 3}
