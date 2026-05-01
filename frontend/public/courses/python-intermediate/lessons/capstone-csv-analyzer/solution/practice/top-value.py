def top_value(d):
    if not d:
        return None
    return max(d, key=lambda k: d[k])
