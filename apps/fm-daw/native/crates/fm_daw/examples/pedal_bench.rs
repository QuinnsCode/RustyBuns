//! Times the circuit solver per sample on this machine, for `scripts/pedal-bench.ts` (#4938, #5109).
//!
//!   pedal_bench <sample-rate> <input.f64> <cap> <name>=<netlist.f64> ...
//!
//! Both files are little-endian f64: the input in volts, and a netlist from `encodeNetlist`.
//! One tab-separated line per pedal: name, unknowns, nonlinear ports, ns per sample (best of
//! three runs), ns per sample in the slowest 1 ms block, Newton iterations per sample (mean, max), misses,
//! then the same pedal with Newton capped at `cap` iterations per sample: ns per sample, slowest 1 ms block,
//! mean iterations, capped samples, and how far its output is from the uncapped one (RMS error in dB below
//! the signal's RMS, and the largest error in mV).
use fm_daw::circuit::Circuit;
use std::time::Instant;

fn read(path: &str) -> Vec<f64> {
    let b = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    b.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect()
}

struct Run { ns: f64, worst_block: f64, mean_it: f64, max_it: u64, misses: u64, shape: (usize, usize), out: Vec<f64> }

/// Best of three runs over the input, Newton capped at `cap` iterations per sample.
fn run(name: &str, desc: &[f64], sr: f64, input: &[f64], cap: u64) -> Run {
    let block = (sr / 1000.0) as usize;
    let mut r = Run { ns: f64::INFINITY, worst_block: 0.0, mean_it: 0.0, max_it: 0, misses: 0, shape: (0, 0), out: Vec::new() };
    for _ in 0..3 {
        let mut c = Circuit::new(desc, sr).unwrap_or_else(|| panic!("{name}: the netlist doesn't compile"));
        c.settle(0.0);
        c.max_iterations = cap;
        r.shape = c.shape();
        let (it0, miss0) = (c.iterations, c.misses);
        let mut out = vec![0.0; input.len()];
        let (mut most, mut slowest) = (0u64, 0.0f64);
        let t0 = Instant::now();
        for (chunk, o) in input.chunks(block).zip(out.chunks_mut(block)) {
            let b0 = Instant::now();
            for (&v, y) in chunk.iter().zip(o.iter_mut()) {
                let before = c.iterations;
                *y = c.step(v);
                most = most.max(c.iterations - before);
            }
            slowest = slowest.max(b0.elapsed().as_nanos() as f64 / chunk.len() as f64);
        }
        let ns = t0.elapsed().as_nanos() as f64 / input.len() as f64;
        r.out = std::hint::black_box(out);
        r.ns = r.ns.min(ns);
        r.worst_block = r.worst_block.max(slowest);
        r.mean_it = (c.iterations - it0) as f64 / input.len() as f64;
        r.max_it = most;
        r.misses = c.misses - miss0;
    }
    r
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sr: f64 = args[0].parse().expect("sample rate");
    let input = read(&args[1]);
    let cap: u64 = args[2].parse().expect("cap");
    for spec in &args[3..] {
        let (name, path) = spec.split_once('=').expect("name=netlist.f64");
        let desc = read(path);
        let full = run(name, &desc, sr, &input, 50);
        let capped = run(name, &desc, sr, &input, cap);
        // The output's DC (the bias) is the same in both, so the signal is measured about its mean.
        let mean = full.out.iter().sum::<f64>() / full.out.len() as f64;
        let rms = (full.out.iter().map(|y| (y - mean) * (y - mean)).sum::<f64>() / full.out.len() as f64).sqrt();
        let err: Vec<f64> = full.out.iter().zip(&capped.out).map(|(a, b)| b - a).collect();
        let err_rms = (err.iter().map(|e| e * e).sum::<f64>() / err.len() as f64).sqrt();
        let peak = err.iter().fold(0.0f64, |m, e| m.max(e.abs()));
        let db = if err_rms == 0.0 { f64::NEG_INFINITY } else { 20.0 * (err_rms / rms).log10() };
        println!(
            "{name}\t{}\t{}\t{:.1}\t{:.1}\t{:.2}\t{}\t{}\t{:.1}\t{:.1}\t{:.2}\t{}\t{db:.0}\t{:.2}",
            full.shape.0, full.shape.1, full.ns, full.worst_block, full.mean_it, full.max_it, full.misses,
            capped.ns, capped.worst_block, capped.mean_it, capped.misses, peak * 1e3,
        );
    }
}
