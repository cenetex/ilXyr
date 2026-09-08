//! One frozen confidence method per process; gold bytes stay in the controller.
#![deny(unsafe_code)]

use std::{env, fs, io::{self, BufWriter, Write}};
use nsrl_core::attention::base2_softmax_i32_q15;
use nsrl_train::{MiniTransformerAttentionKind, MiniTransformerMlpEvalConfig,
    MiniTransformerMlpModel, MiniTransformerPositionPolicy, evaluate_mini_transformer_mlp_windows};

const ARMS: [&str; 5] = ["native", "point_mass", "smoothed_point_mass", "suffix_empirical", "suffix_unit_prior"];

fn counts(memory: &[u8], context: &[u8]) -> ([u64; 256], usize) {
    for order in [16, 8, 4, 3, 2, 1] {
        if context.len() < order { continue; }
        let suffix = &context[context.len() - order..];
        let mut result = [0; 256];
        for window in memory.windows(order + 1) {
            if &window[..order] == suffix { result[usize::from(window[order])] += 1; }
        }
        if result.iter().any(|&n| n > 0) { return (result, order); }
    }
    let mut result = [0; 256];
    for &byte in memory { result[usize::from(byte)] += 1; }
    (result, 0)
}

fn answer(counts: &[u64; 256]) -> usize {
    let mut chosen = 0;
    for i in 1..256 { if counts[i] > counts[chosen] { chosen = i; } }
    chosen
}

fn control(arm: &str, counts: &[u64; 256]) -> [u64; 256] {
    let chosen = answer(counts);
    let mut mass = [0; 256];
    match arm {
        "point_mass" => mass[chosen] = 32_767,
        "smoothed_point_mass" => {
            let mut extra: u64 = 3_276 % 255;
            for (i, value) in mass.iter_mut().enumerate() {
                if i == chosen { *value = 29_491; }
                else { *value = 3_276 / 255 + u64::from(extra > 0); extra = extra.saturating_sub(1); }
            }
        }
        "suffix_empirical" => mass = *counts,
        "suffix_unit_prior" => mass = counts.map(|n| 256 * n + 1),
        _ => unreachable!("arm checked before input loading"),
    }
    mass
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 3 || !ARMS.contains(&args[0].as_str()) {
        return Err("usage: solomon-confidence-arm ARM ARTIFACT CONTEXTS_BIN".into());
    }
    let arm = args[0].as_str();
    let artifact = fs::read(&args[1])?;
    let contexts = fs::read(&args[2])?;
    if contexts.is_empty() || contexts.len() % 64 != 0 || contexts.len() > 64 * 32 {
        return Err("contexts require one through 32 complete 64-byte rows".into());
    }
    let model = if arm == "native" {
        let model = MiniTransformerMlpModel::from_bytes(&artifact)?;
        if model.model_hash() != 0x6ffd37de48a3121b || model.context_seq_len != 64 {
            return Err("frozen model identity differs".into());
        }
        Some(model)
    } else {
        if artifact.is_empty() || artifact.len() > 65_536 { return Err("suffix memory size differs".into()); }
        None
    };
    let mut output = BufWriter::new(io::stdout().lock());
    writeln!(output, "index\tpredicted\tmasses")?;
    for (i, context) in contexts.chunks_exact(64).enumerate() {
        let (predicted, mass) = if let Some(model) = &model {
            // The legacy evaluation API expects one trailing target. A fixed zero
            // allows its forward path to run while gold stays outside this process.
            let mut tokens = context.to_vec();
            tokens.push(0);
            let mut records = evaluate_mini_transformer_mlp_windows(&tokens, model, MiniTransformerMlpEvalConfig {
                seq_len: 64, stride: 1, max_windows: Some(1),
                attention_kind: MiniTransformerAttentionKind::Linear,
                position_policy: MiniTransformerPositionPolicy::Nope,
            })?;
            if records.len() != 1 { return Err("native window coverage differs".into()); }
            let record = records.remove(0);
            if record.start != 0 || record.end != 64 { return Err("native window identity differs".into()); }
            let predicted = record.predicted_token.ok_or("native answer absent")?;
            let logits = record.logits_q8.ok_or("native logits absent")?;
            let mut vector = [0; 256];
            base2_softmax_i32_q15(&logits, &mut vector).ok_or("native probability conversion failed")?;
            if vector.iter().any(|&n| n < 0) { return Err("negative native mass".into()); }
            (usize::from(predicted), vector.map(|n| n as u64))
        } else {
            let (vector, _) = counts(&artifact, context);
            (answer(&vector), control(arm, &vector))
        };
        if mass.iter().sum::<u64>() == 0 { return Err("zero probability mass".into()); }
        write!(output, "{i}\t{predicted}\t")?;
        for (j, value) in mass.iter().enumerate() {
            if j > 0 { write!(output, ",")?; }
            write!(output, "{value}")?;
        }
        writeln!(output)?;
    }
    output.flush()?;
    eprintln!("{{\"arm\":\"{arm}\",\"windows\":{},\"native_forward_calls\":{},\"context_bytes\":{},\"artifact_bytes\":{}}}",
        contexts.len() / 64, if arm == "native" { contexts.len() / 64 } else { 0 }, contexts.len(), artifact.len());
    Ok(())
}

fn main() {
    if let Err(error) = run() { eprintln!("solomon-confidence-arm: {error}"); std::process::exit(1); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn suffix_orders_overlaps_ties_and_unigram() {
        assert_eq!(counts(b"abababa", b"ab").0[b'a' as usize], 3);
        assert_eq!(counts(b"xAxB", b"x").1, 1);
        assert_eq!(answer(&counts(b"xBxA", b"x").0), b'A' as usize);
        assert_eq!(counts(b"baaa", &[255]).1, 0);
        assert_eq!(answer(&counts(b"baaa", &[255]).0), b'a' as usize);
    }
    #[test]
    fn fixed_controls_and_fractional_prior() {
        let mut c = [0; 256]; c[7] = 3; c[9] = 1;
        assert_eq!(control("point_mass", &c)[7], 32_767);
        let smooth = control("smoothed_point_mass", &c);
        assert_eq!(smooth.iter().sum::<u64>(), 32_767);
        assert_eq!(smooth[7], 29_491);
        assert_eq!(smooth[0], 13);
        assert_eq!(smooth[255], 12);
        let prior = control("suffix_unit_prior", &c);
        assert_eq!((prior[7], prior[9], prior[8]), (769, 257, 1));
        assert_eq!(prior.iter().sum::<u64>(), 1_280);
    }
}
