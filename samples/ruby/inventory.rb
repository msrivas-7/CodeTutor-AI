class Inventory
  def initialize
    @items = Hash.new { |h, k| h[k] = { qty: 0, unit: 0.0 } }
  end

  def add(name, qty, unit)
    @items[name][:qty] += qty
    @items[name][:unit] = unit
  end

  def each
    @items.each { |name, v| yield name, v[:qty], v[:unit] }
  end

  def total
    @items.values.sum { |v| v[:qty] * v[:unit] }
  end
end
