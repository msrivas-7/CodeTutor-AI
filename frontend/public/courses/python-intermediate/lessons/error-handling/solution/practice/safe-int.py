def safe_int(s):
    try:
        return int(s)
    except ValueError:
        return None
