import re

def analyze_text(text):
    nums = re.findall(r"\d+", text)
    match = re.search(r"[Ee]rror (\d+)", text)
    first = match.group(1) if match else None
    redacted = re.sub(r"\d+", "###", text)
    return nums, first, redacted


text = "Error 404: not found. Then later, error 500 happened. Final code 200."
nums, first, redacted = analyze_text(text)
print(f"all numbers: {nums}")
print(f"first error code: {first}")
print(f"redacted: {redacted}")
