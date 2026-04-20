function sumOfSquares(nums) {
  return nums.map((n) => n * n).reduce((a, b) => a + b, 0);
}
