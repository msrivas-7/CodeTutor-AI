def sum_column(lines, col_index):
    return sum(int(line.split(",")[col_index]) for line in lines)
