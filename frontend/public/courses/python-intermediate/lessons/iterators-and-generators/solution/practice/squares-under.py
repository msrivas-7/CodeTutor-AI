def squares_under(limit):
    i = 1
    while i * i < limit:
        yield i * i
        i += 1
