def count_by(records, field):
    counts = {}
    for r in records:
        v = r[field]
        counts[v] = counts.get(v, 0) + 1
    return counts
