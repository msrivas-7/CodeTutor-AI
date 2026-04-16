mod shapes;

use shapes::{Circle, Rectangle, Shape};

fn main() {
    let shapes: Vec<Box<dyn Shape>> = vec![
        Box::new(Circle { radius: 2.5 }),
        Box::new(Rectangle { width: 4.0, height: 3.0 }),
        Box::new(Circle { radius: 1.0 }),
    ];

    for s in &shapes {
        println!("{:<10} area = {:.2}", s.name(), s.area());
    }

    let total: f64 = shapes.iter().map(|s| s.area()).sum();
    println!("total area = {:.2}", total);
}
