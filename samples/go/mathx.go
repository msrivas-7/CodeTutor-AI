package main

func Sum(xs []int) int {
	total := 0
	for _, v := range xs {
		total += v
	}
	return total
}

func Max(xs []int) int {
	best := xs[0]
	for _, v := range xs[1:] {
		if v > best {
			best = v
		}
	}
	return best
}

func Factorial(n int) int64 {
	var r int64 = 1
	for i := 2; i <= n; i++ {
		r *= int64(i)
	}
	return r
}
