//! The tuner's CLI: one JSON command on stdin (lib.rs), the answer on stdout. Pairings go out over every core.
use std::io::{Read, Write};

fn main() {
    let mut input = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("mythic-sim: {e}");
        std::process::exit(1);
    }
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
    match mythic_sim::run(&input, threads) {
        Ok(out) => {
            let _ = std::io::stdout().write_all(out.as_bytes());
        }
        Err(e) => {
            eprintln!("mythic-sim: {e}");
            std::process::exit(1);
        }
    }
}
