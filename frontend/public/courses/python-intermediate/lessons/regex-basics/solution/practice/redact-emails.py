import re


def redact_emails(text):
    return re.sub(r"\w+@\w+\.\w+", "[email]", text)
