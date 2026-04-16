package main

import "fmt"

func main() {
	nums := []int{3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5}
	fmt.Printf("values : %v\n", nums)
	fmt.Printf("sum    : %d\n", Sum(nums))
	fmt.Printf("max    : %d\n", Max(nums))
	fmt.Printf("5!     : %d\n", Factorial(5))
	fmt.Printf("10!    : %d\n", Factorial(10))
}
