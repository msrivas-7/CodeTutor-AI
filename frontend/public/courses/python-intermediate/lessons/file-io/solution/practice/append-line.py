def append_line(path, initial_lines, new_line):
    with open(path, "w") as f:
        for line in initial_lines:
            f.write(line + "\n")
    with open(path, "a") as f:
        f.write(new_line + "\n")
    with open(path, "r") as f:
        return f.read().splitlines()
