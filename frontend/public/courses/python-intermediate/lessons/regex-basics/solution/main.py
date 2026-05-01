import re

text = "Error 404: not found. Then later, error 500 happened. Final code 200."

nums = re.findall(r"\d+", text)

m = re.search(r"[Ee]rror (\d+)", text)
first = m.group(1)

redacted = re.sub(r"\d+", "###", text)

print(f"all numbers: {nums}")
print(f"first error code: {first}")
print(f"redacted: {redacted}")
