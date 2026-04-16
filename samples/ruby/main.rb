require_relative "inventory"

inv = Inventory.new
inv.add("apple", 3, 0.50)
inv.add("bread", 2, 2.25)
inv.add("cheese", 1, 4.80)
inv.add("apple", 2, 0.50)

inv.each do |item, qty, unit|
  printf("  %-8s x%-2d @ %.2f\n", item, qty, unit)
end

printf("total: %.2f\n", inv.total)
