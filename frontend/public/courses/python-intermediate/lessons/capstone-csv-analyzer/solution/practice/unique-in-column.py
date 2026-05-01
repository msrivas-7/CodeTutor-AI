def unique_in_column(lines, col_index):
    return sorted({line.split(",")[col_index] for line in lines})
