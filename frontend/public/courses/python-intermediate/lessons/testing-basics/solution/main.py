from mathops import add, is_even


def test_add_basic():
    assert add(2, 3) == 5


def test_add_negatives():
    assert add(-1, 1) == 0


def test_is_even_true():
    assert is_even(4) is True


def test_is_even_false():
    assert is_even(5) is False


tests = [test_add_basic, test_add_negatives, test_is_even_true, test_is_even_false]

passed = 0
failed = 0
for t in tests:
    try:
        t()
        passed += 1
        print(f"PASS {t.__name__}")
    except AssertionError as e:
        failed += 1
        print(f"FAIL {t.__name__}: {e}")

print(f"{passed}/{passed + failed} passed")
