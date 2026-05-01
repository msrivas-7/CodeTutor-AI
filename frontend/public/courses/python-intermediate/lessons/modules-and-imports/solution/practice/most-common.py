from collections import Counter


def most_common(items):
    return Counter(items).most_common(1)[0][0]
