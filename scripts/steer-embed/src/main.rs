//! steer-embed <model dir>: texts in on stdin, each ended by a NUL byte; out on stdout, one vector per text in the
//! same order, 384 little-endian f32s each, mean-pooled over the tokens and scaled to length 1 (so a dot product is
//! the cosine). The model dir holds `model.onnx` (all-MiniLM-L6-v2, int8) and its `tokenizer.json`. It loads, embeds
//! and exits: nothing stays running. CPU only.
use std::io::{Read, Write};

use ort::session::Session;
use ort::value::Tensor;
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

const DIM: usize = 384;
const BATCH: usize = 16;
const MAX_TOKENS: usize = 256;

fn main() {
    if let Err(e) = run() {
        eprintln!("steer-embed: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let dir = std::env::args().nth(1).ok_or("usage: steer-embed <model dir> < texts, each ended by NUL > vectors")?;
    let mut tok = Tokenizer::from_file(format!("{dir}/tokenizer.json"))?;
    tok.with_truncation(Some(TruncationParams { max_length: MAX_TOKENS, ..Default::default() }))?;
    tok.with_padding(Some(PaddingParams::default()));
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get().min(4));
    let mut session = Session::builder()?.with_intra_threads(threads)?.commit_from_file(format!("{dir}/model.onnx"))?;

    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let texts: Vec<&str> = input.split_terminator('\0').collect();
    // Like lengths batch together, so little of each batch is padding.
    let mut order: Vec<usize> = (0..texts.len()).collect();
    order.sort_by_key(|&i| texts[i].len());
    let mut out = vec![0f32; texts.len() * DIM];

    for chunk in order.chunks(BATCH) {
        let enc = tok.encode_batch(chunk.iter().map(|&i| texts[i]).collect::<Vec<_>>(), true)?;
        let (b, s) = (enc.len(), enc[0].get_ids().len());
        let (mut ids, mut mask, mut types) = (Vec::with_capacity(b * s), Vec::with_capacity(b * s), Vec::with_capacity(b * s));
        for e in &enc {
            ids.extend(e.get_ids().iter().map(|&x| x as i64));
            mask.extend(e.get_attention_mask().iter().map(|&x| x as i64));
            types.extend(e.get_type_ids().iter().map(|&x| x as i64));
        }
        let outputs = session.run(ort::inputs![
            "input_ids" => Tensor::from_array(([b, s], ids))?,
            "attention_mask" => Tensor::from_array(([b, s], mask.clone()))?,
            "token_type_ids" => Tensor::from_array(([b, s], types))?,
        ])?;
        let (_, hidden) = outputs["last_hidden_state"].try_extract_tensor::<f32>()?;
        for (j, &i) in chunk.iter().enumerate() {
            let v = &mut out[i * DIM..(i + 1) * DIM];
            for t in (0..s).filter(|&t| mask[j * s + t] != 0) {
                let row = &hidden[(j * s + t) * DIM..(j * s + t + 1) * DIM];
                v.iter_mut().zip(row).for_each(|(a, x)| *a += x);
            }
            let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
            v.iter_mut().for_each(|a| *a /= norm);
        }
    }

    let mut bytes = Vec::with_capacity(out.len() * 4);
    out.iter().for_each(|x| bytes.extend_from_slice(&x.to_le_bytes()));
    std::io::stdout().lock().write_all(&bytes)?;
    Ok(())
}
