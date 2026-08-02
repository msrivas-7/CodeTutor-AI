import re

def analyze_text(text):
    # TODO: derive nums with re.findall.
    nums = []
    # TODO: derive first from re.search, or None if there is no error label.
    first = None
    # TODO: derive redacted with re.sub.
    redacted = ""
    return nums, first, redacted


text = "Error 404: not found. Then later, error 500 happened. Final code 200."
nums, first, redacted = analyze_text(text)
print(f"all numbers: {nums}")
print(f"first error code: {first}")
print(f"redacted: {redacted}")
