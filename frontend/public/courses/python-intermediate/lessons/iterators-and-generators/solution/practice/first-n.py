def first_n(iterable, n):
    out = []
    for item in iterable:
        if len(out) >= n:
            break
        out.append(item)
    return out
