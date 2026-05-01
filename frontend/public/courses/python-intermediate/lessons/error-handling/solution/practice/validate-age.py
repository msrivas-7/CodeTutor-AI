def validate_age(age):
    if age < 0:
        raise ValueError("age must be non-negative")
    return age
