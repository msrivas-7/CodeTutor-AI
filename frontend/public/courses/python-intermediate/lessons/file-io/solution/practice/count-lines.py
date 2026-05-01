def count_lines(path, content):
    with open(path, "w") as f:
        f.write(content)
    with open(path, "r") as f:
        lines = f.read().splitlines()
    return sum(1 for line in lines if line.strip())
