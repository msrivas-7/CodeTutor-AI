def shout(func):
    def wrapper():
        return func().upper()
    return wrapper


@shout
def whisper():
    return "hello"
