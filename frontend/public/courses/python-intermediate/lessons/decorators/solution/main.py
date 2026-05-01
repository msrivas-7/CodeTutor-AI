def log_calls(func):
    def wrapper(*args, **kwargs):
        print(f"calling {func.__name__}")
        result = func(*args, **kwargs)
        print(f"returned {result}")
        return result
    return wrapper


@log_calls
def add(a, b):
    return a + b


@log_calls
def greet(name):
    return f"hello, {name}"


add(2, 3)
greet("world")
