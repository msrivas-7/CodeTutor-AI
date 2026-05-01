def log_calls(func):
    # TODO: return a wrapper(*args, **kwargs) that prints before/after
    # and returns whatever func(*args, **kwargs) returns.
    pass


@log_calls
def add(a, b):
    return a + b


@log_calls
def greet(name):
    return f"hello, {name}"


add(2, 3)
greet("world")
