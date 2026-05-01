def where(records, predicate):
    return [r for r in records if predicate(r)]
