function priceSum(prices) {
  return Object.values(prices).reduce((a, b) => a + b, 0);
}
