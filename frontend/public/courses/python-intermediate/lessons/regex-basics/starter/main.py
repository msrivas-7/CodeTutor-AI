import re

text = "Error 404: not found. Then later, error 500 happened. Final code 200."

# TODO: use re.findall to grab every run of digits in `text`.
nums = []

# TODO: use re.search with a pattern that matches "Error" or "error" followed
# by digits, capturing the digits in a group. Pull them out with .group(1).
first = ""

# TODO: use re.sub to replace every run of digits with "###".
redacted = ""

print(f"all numbers: {nums}")
print(f"first error code: {first}")
print(f"redacted: {redacted}")
