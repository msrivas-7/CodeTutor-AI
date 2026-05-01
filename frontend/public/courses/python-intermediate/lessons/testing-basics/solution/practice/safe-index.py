def safe_index(lst, i):
    assert 0 <= i < len(lst), "index out of range"
    return lst[i]
