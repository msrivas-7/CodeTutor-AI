import re


def first_phone(text):
    m = re.search(r"\d{3}-\d{4}", text)
    if m:
        return m.group()
    return None
