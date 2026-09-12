"""Add an explicit training-report option while retaining the window trainer."""
import hashlib
from pathlib import Path
import tempfile

from build_zero4_window_source import build as window_build, replace


def build(source, output):
    with tempfile.TemporaryDirectory(prefix='zero4-study-source-') as directory:
        path = Path(directory) / 'windows.c'
        require_sha = window_build(source, path)
        if require_sha != '54bb8f66e120f594a7e9b0692977d964ef19054a431524ce1c5933dbf5610bd7':
            raise ValueError('window trainer identity differs')
        text = path.read_text()
    text = replace(text, '    int eval_only;', '    int eval_only;\n    int controller_no_validation;')
    text = replace(text, '        } else if (strcmp(argv[i], "--eval-only") == 0) {',
                   '        } else if (strcmp(argv[i], "--controller-no-validation") == 0) {\n'
                   '            options.controller_no_validation = 1;\n'
                   '        } else if (strcmp(argv[i], "--eval-only") == 0) {')
    text = replace(text, '\n    if (options.eval_only) {',
                   '\n    if (options.controller_no_validation &&\n'
                   '        (options.patience != 0 || options.best_path != NULL || options.eval_only)) {\n'
                   '        fail("controller training requires patience zero, a final checkpoint and separate evaluation");\n'
                   '    }\n    if (options.eval_only) {')
    anchor = '            if ((accepted && update % (uint64_t)options.report_every == 0) ||'
    replacement = '''            if (options.controller_no_validation &&
                ((accepted && update % (uint64_t)options.report_every == 0) ||
                 completed_steps == options.steps || stop_training)) {
                printf("controller update %llu attempts %ld train %.4f; validation deferred\\n",
                       (unsigned long long)update, completed_steps,
                       (float)(interval_loss / interval_sequences));
                fflush(stdout);
                interval_loss = 0.0;
                interval_sequences = 0;
                interval_tokens = 0;
                interval_start = wall_seconds();
            }
            if (!options.controller_no_validation &&
                ((accepted && update % (uint64_t)options.report_every == 0) ||'''
    text = replace(text, anchor, replacement)
    text = replace(text, '                completed_steps == options.steps || stop_training) {',
                   '                completed_steps == options.steps || stop_training)) {')
    text = replace(text, '    printf("  --eval-only',
                   '    printf("  --controller-no-validation  defer training validation to the sealed controller\\n");\n'
                   '    printf("  --eval-only')
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as stream:
        stream.write(text)
    return hashlib.sha256(output.read_bytes()).hexdigest()
