import re


def find_emails(text):
    return re.findall(r"\w+@\w+\.\w+", text)
