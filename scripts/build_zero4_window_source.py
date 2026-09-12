"""Derive the explicit-window trainer from the exact published retention source."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def replace(text, old, new, count=1):
    if text.count(old) != count:
        raise ValueError('native source anchor differs: ' + old[:90])
    return text.replace(old, new)


def build(source, output):
    binding = json.loads((ROOT / 'experiments/research-step-42/SOURCE-FILES.json').read_text())
    for name, meta in binding['files'].items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != meta['sha256']:
            raise ValueError('source binding differs: ' + name)
    with tempfile.TemporaryDirectory(prefix='zero4-native-base-') as temporary:
        base = Path(temporary) / 'retention.c'
        subprocess.run(['patch', '-s', '-o', str(base), str(source / 'literary_lm.c'),
                        str(source / 'scripts/zero4_retention.patch')], check=True, timeout=30)
        if hashlib.sha256(base.read_bytes()).hexdigest() != '79d7b277a958ace1b5a952bf4c6a0cd731c2344e17fc67db332d5be571082fba':
            raise ValueError('published retention derivative differs')
        text = base.read_text()
    text = replace(text, '    int channel;\n    int foundation;', '    int channel;\n    int fixed_windows;\n    int endpoint_windows;\n    int foundation;')
    text = replace(text, '    const char *evaluation_json_path;', '    const char *window_audit_path;\n    const char *evaluation_json_path;')
    text = replace(text, 'static float evaluate_balanced(', '#include "zero4_window_io.h"\n\nstatic float evaluate_balanced(')
    text = replace(text, '    int samples_per_range = batches / range_count;\n', '')
    text = replace(text, '    if (samples_per_range < 1) samples_per_range = 1;\n', '')
    text = replace(text, '        float range_total = 0.0f;\n', '        float range_total = 0.0f;\n        int samples_per_range = window_samples(range, batches, range_count);\n')
    text = replace(text, '        for (sample = 0; sample < samples_per_range; ++sample) {\n            size_t start;',
                   '        for (sample = 0; sample < samples_per_range; ++sample) {\n            float window_loss;\n            size_t start;')
    text = replace(text, '                range_total += model_forward_masked(\n', '                window_loss = model_forward_masked(\n')
    text = replace(text, '                range_total += model_forward(\n', '                window_loss = model_forward(\n')
    text = replace(text, '            }\n        }\n        if (range_losses != NULL)',
                   '            }\n            range_total += window_loss;\n            if (range->fixed_windows) record_window_loss(range_index, sample, corpus->data + start, model->cfg.context, range->channel, window_loss);\n        }\n        if (range_losses != NULL)')
    text = replace(text, '        } else if (strcmp(argv[i], "--channel-weight")',
                   '        } else if (strcmp(argv[i], "--fixed-windows") == 0) {\n            if (text_count == 0 || text_ranges[text_count - 1].fixed_windows) fail("fixed-windows needs one preceding source");\n            text_ranges[text_count - 1].fixed_windows = 1;\n        } else if (strcmp(argv[i], "--window-audit") == 0 && i + 1 < argc) {\n            options.window_audit_path = argv[++i];\n        } else if (strcmp(argv[i], "--channel-weight")')
    text = replace(text, '    if (options.steps > 0 || options.eval_only) {', '    if (options.steps > 0 || options.eval_only || options.window_audit_path != NULL) {')
    old = '''                corpus_add_file(&corpus, text_paths[i],
                                text_channel[i]
                                    ? 2
                                    : (tokenizer.loaded ? tokenizer.token_width
                                                        : 1));'''
    new = '''                if (text_ranges[i].fixed_windows) {
                    corpus_add_windows(&corpus, text_paths[i], &text_ranges[i], cfg.context,
                                       text_channel[i], text_foundation[i], options.eval_only || options.window_audit_path != NULL);
                } else {
''' + old + '\n                }'
    text = replace(text, old, new)
    text = replace(text, '''                if (range->channel) {
                    prepare_channel_range''', '''                if (range->fixed_windows) {
                    prepare_fixed_range(range, &corpus, cfg.context);
                } else if (range->channel) {
                    prepare_channel_range''')
    text = replace(text, '        printf("corpus=%zu tokens train=%zu validation=%zu tokens/update=%d "',
                   '        if (options.window_audit_path != NULL) {\n            write_window_audit(options.window_audit_path, &corpus, text_ranges, text_count, cfg.context);\n            goto window_cleanup;\n        }\n        printf("corpus=%zu tokens train=%zu validation=%zu tokens/update=%d "')
    text = replace(text, '                    } else {\n                        choices = range->training_length',
                   '                    } else if (range->fixed_windows) {\n                        start = range->record_starts[rng_next(&rng) % range->record_count];\n                    } else {\n                        choices = range->training_length')
    text = replace(text, '            float *range_losses = options.evaluation_json_path',
                   '            if (options.evaluation_json_path != NULL && has_fixed_windows(text_ranges, text_count)) open_window_losses(options.evaluation_json_path);\n            float *range_losses = options.evaluation_json_path')
    text = replace(text, 'text_count > 0 ? (validation_batches / text_count) * text_count : validation_batches,',
                   'text_count > 0 ? window_evaluation_count(text_ranges, text_count, validation_batches) : validation_batches,')
    text = replace(text, 'text_ranges[i].weight, validation_batches / text_count, range_losses[i]);',
                   'text_ranges[i].weight, window_samples(&text_ranges[i], validation_batches, text_count), range_losses[i]);')
    text = replace(text, r'\"zero.literary_eval.v2\"', r'\"%s\"')
    text = replace(text, '                    validation_loss, validation_batches, cfg.context,',
                   '                    has_fixed_windows(text_ranges, text_count) ? "zero.literary_eval.v3" : "zero.literary_eval.v2",\n                    validation_loss, has_fixed_windows(text_ranges, text_count) ? window_evaluation_count(text_ranges, text_count, validation_batches) : validation_batches, cfg.context,')
    text = replace(text, '    corpus_destroy(&corpus);', 'window_cleanup:\n    if (window_loss_stream != NULL && fclose(window_loss_stream)) fail("window loss close failed");\n    corpus_destroy(&corpus);')
    text = replace(text, '    printf("  --evaluation-json FILE',
                   '    printf("  --fixed-windows        use the preceding source as a fixed window pack\\n");\n    printf("  --window-audit FILE    write window identities without model evaluation\\n");\n    printf("  --evaluation-json FILE')
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as stream:
        stream.write(text)
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(build(args.source, args.out))
