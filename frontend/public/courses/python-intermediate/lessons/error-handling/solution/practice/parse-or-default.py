def parse_or_default(strings, default=0):
    result = []
    for s in strings:
        try:
            result.append(int(s))
        except ValueError:
            result.append(default)
    return result
