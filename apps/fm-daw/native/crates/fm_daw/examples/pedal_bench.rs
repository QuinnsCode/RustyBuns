//! Times the circuit solver per sample on this machine, for `scripts/pedal-bench.ts` (#4938).
//!
//!   pedal_bench <sample-rate> <input.f64> <name>=<netlist.f64> ...
//!
//! Both files are little-endian f64: the input in volts, and a netlist from `encodeNetlist`.
//! One tab-separated line per pedal: name, unknowns, nonlinear ports, ns per sample (best of
//! three runs), ns per sample in the slowest 1 ms block, Newton iterations per sample (mean, max), misses.
use fm_daw::circuit::Circuit;
use std::time::Instant;

fn read(path: &str) -> Vec<f64> {
    let b = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    b.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sr: f64 = args[0].parse().expect("sample rate");
    let input = read(&args[1]);
    let block = (sr / 1000.0) as usize;
    for spec in &args[2..] {
        let (name, path) = spec.split_once('=').expect("name=netlist.f64");
        let desc = read(path);
        let mut best = f64::INFINITY;
        let mut worst_block = 0.0f64;
        let (mut mean_it, mut max_it, mut misses, mut shape) = (0.0, 0u64, 0u64, (0, 0));
        for _ in 0..3 {
            let mut c = Circuit::new(&desc, sr).unwrap_or_else(|| panic!("{name}: the netlist doesn't compile"));
            c.settle(0.0);
            shape = c.shape();
            let (it0, miss0) = (c.iterations, c.misses);
            let mut most = 0u64;
            let mut slowest = 0.0f64;
            let mut sink = 0.0;
            let t0 = Instant::now();
            for chunk in input.chunks(block) {
                let b0 = Instant::now();
                for &v in chunk {
                    let before = c.iterations;
                    sink += c.step(v);
                    most = most.max(c.iterations - before);
                }
                slowest = slowest.max(b0.elapsed().as_nanos() as f64 / chunk.len() as f64);
            }
            let ns = t0.elapsed().as_nanos() as f64 / input.len() as f64;
            std::hint::black_box(sink);
            if ns < best { best = ns; }
            worst_block = worst_block.max(slowest);
            mean_it = (c.iterations - it0) as f64 / input.len() as f64;
            max_it = most;
            misses = c.misses - miss0;
        }
        println!("{name}\t{}\t{}\t{best:.1}\t{worst_block:.1}\t{mean_it:.2}\t{max_it}\t{misses}", shape.0, shape.1);
    }
}
