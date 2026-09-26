"""Fit-only grouped role probe and diagnostic controls for Reasoner 4 audit."""
import argparse
import hashlib
import json
import random
import time
from pathlib import Path

import numpy as np

from reasoner4_representation_audit import DIMENSION, ROLES, capture, digest, encoded, verify_firewall

GRID = (0.0001, 0.001, 0.01, 0.1, 1.0)
SEEDS = (3, 9, 39)


def load(folder):
    values = [json.loads((folder / name).read_bytes()) for name in ('fit.json', 'held.json', 'scrambled.json')]
    verify_firewall(*values)
    states = json.loads((folder / 'states.json').read_bytes())
    if states['dimension'] != DIMENSION or states['source_revision'] != values[0]['source_revision']:
        raise ValueError('captured state binding differs')
    for name, value in zip(('fit', 'held', 'scrambled'), values):
        if states['splits'][name] != [capture(row) for row in value['rows']]:
            raise ValueError('captured state differs: ' + name)
    return values


def features(rows):
    return np.asarray([capture(row) for row in rows], dtype=np.float64)


def header_features(rows):
    result = np.zeros((len(rows), DIMENSION))
    for i, row in enumerate(rows):
        raw = row['symbol'].encode('ascii')
        for j, char in enumerate(raw):
            result[i, j] = (char - 97) / 25
        result[i, 8] = len(raw) / 8
    return result


def labels(rows):
    return np.asarray([ROLES.index(row['label']) for row in rows], dtype=np.int64)


def standardize(train, test):
    mean = train.mean(axis=0)
    scale = train.std(axis=0)
    scale[scale < 1e-12] = 1
    return (train - mean) / scale, (test - mean) / scale, mean, scale


def fit_logistic(x, y, penalty, seed, steps=250):
    if x.shape[1] * len(ROLES) + len(ROLES) > 100000:
        raise ValueError('probe parameter ceiling exceeded')
    rng = np.random.default_rng(seed)
    weights = rng.normal(0, 0.001, size=(x.shape[1] + 1, len(ROLES)))
    design = np.column_stack((x, np.ones(len(x))))
    target = np.eye(len(ROLES))[y]
    for step in range(steps):
        logits = design @ weights
        logits -= logits.max(axis=1, keepdims=True)
        exp = np.exp(logits)
        probabilities = exp / exp.sum(axis=1, keepdims=True)
        gradient = design.T @ (probabilities - target) / len(y)
        gradient[:-1] += penalty * weights[:-1]
        weights -= 0.15 / (1 + step / 80) * gradient
    return weights


def predict(x, weights):
    return np.argmax(np.column_stack((x, np.ones(len(x)))) @ weights, axis=1)


def fold_masks(rows, seed):
    groups = sorted({row['family'] for row in rows})
    if len(groups) < 5:
        raise ValueError('five grouped folds require five fit families')
    random.Random(seed).shuffle(groups)
    for fold in range(5):
        valid = np.asarray([groups.index(row['family']) % 5 == fold for row in rows])
        yield ~valid, valid


def select_penalty(x, y, rows, seed):
    scores = []
    for penalty in GRID:
        correct = total = 0
        for fold, (train_mask, valid_mask) in enumerate(fold_masks(rows, seed)):
            train, valid, _, _ = standardize(x[train_mask], x[valid_mask])
            model = fit_logistic(train, y[train_mask], penalty, seed + fold)
            correct += int(np.count_nonzero(predict(valid, model) == y[valid_mask]))
            total += int(valid_mask.sum())
        scores.append(correct / total)
    selected = max(range(len(GRID)), key=lambda i: (scores[i], GRID[i]))
    return GRID[selected], scores


def fit_selected(fit_x, fit_y, fit_rows, eval_x, seed):
    penalty, scores = select_penalty(fit_x, fit_y, fit_rows, seed)
    train, valid, mean, scale = standardize(fit_x, eval_x)
    model = fit_logistic(train, fit_y, penalty, seed)
    return predict(valid, model), {'penalty': penalty, 'fit_cv_accuracy': scores,
                                   'parameters': int(model.size),
                                   'weights': model.tolist(),
                                   'fit_mean': mean.tolist(), 'fit_scale': scale.tolist(),
                                   'fit_mean_sha256': digest(encoded(mean.tolist())),
                                   'fit_scale_sha256': digest(encoded(scale.tolist())),
                                   'weights_sha256': digest(encoded(model.tolist()))}


def projection(x, dimension, seed):
    rng = np.random.default_rng(seed)
    matrix = rng.normal(0, 1 / np.sqrt(dimension), size=(x.shape[1], dimension))
    return x @ matrix


def ppm(value):
    return round(float(value) * 1000000)


def swap_consistency(rows, predicted):
    pairs = {}
    for row, value in zip(rows, predicted):
        pairs.setdefault((row['family'], row['label']), []).append(int(value))
    if not all(len(v) == 2 for v in pairs.values()):
        raise ValueError('held surface pair missing')
    return sum(all(value == ROLES.index(key[1]) for value in values)
               for key, values in pairs.items()) / len(pairs)


def role_swap_rows(rows):
    """Replace one symbol's demonstrations with the next role in its family."""
    result = json.loads(json.dumps(rows))
    for offset in range(0, len(result), 6):
        group = result[offset:offset + 6]
        original = rows[offset:offset + 6]
        by_role = {row['label']: row for row in original}
        if len(by_role) != len(ROLES):
            raise ValueError('role swap needs all six roles')
        for row in group:
            target = ROLES[(ROLES.index(row['label']) + 1) % len(ROLES)]
            donor = by_role[target]
            row['demonstrations'] = [line.replace(donor['symbol'], row['symbol'], 1)
                                     for line in donor['demonstrations']]
            row['label'] = target
    return result


def run(folder, smoke=False):
    started = time.process_time()
    fit, held, scrambled = load(folder)
    fit_x, held_x, scrambled_x = (features(value['rows']) for value in (fit, held, scrambled))
    swapped_rows = role_swap_rows(held['rows'])
    swapped_x = features(swapped_rows)
    fit_y, held_y = labels(fit['rows']), labels(held['rows'])
    runs = SEEDS[:1] if smoke else SEEDS
    predictions, control_predictions, headers, swapped_predictions, selections = [], [], [], [], []
    projection_records, null_records = [], []
    for seed in runs:
        predicted, selection = fit_selected(fit_x, fit_y, fit['rows'], held_x, seed)
        scrambled_predicted, _ = fit_selected(fit_x, fit_y, fit['rows'], scrambled_x, seed)
        swapped_predicted, _ = fit_selected(fit_x, fit_y, fit['rows'], swapped_x, seed)
        header_predicted, header_selection = fit_selected(
            header_features(fit['rows']), fit_y, fit['rows'], header_features(held['rows']), seed)
        predictions.append(predicted)
        control_predictions.append(scrambled_predicted)
        swapped_predictions.append(swapped_predicted)
        headers.append(header_predicted)
        selections.append({'seed': seed, 'role': selection, 'header': header_selection})
        for dimension in (32, 64):
            projected_fit, projected_held = projection(fit_x, dimension, seed), projection(held_x, dimension, seed)
            projected, detail = fit_selected(projected_fit, fit_y, fit['rows'], projected_held, seed)
            projection_records.append({'seed': seed, 'dimension': dimension,
                                       'accuracy_ppm': ppm(np.mean(projected == held_y)),
                                       'predictions': projected.tolist(), 'selection': detail})
        for repeat in range(1 if smoke else 20):
            shuffled = np.random.default_rng(seed * 1000 + repeat).permutation(fit_y)
            null_predicted, null_selection = fit_selected(fit_x, shuffled, fit['rows'], held_x, seed)
            null_records.append({'seed': seed, 'repeat': repeat,
                                 'accuracy_ppm': ppm(np.mean(null_predicted == held_y)),
                                 'swap_ppm': ppm(swap_consistency(held['rows'], null_predicted)),
                                 'predictions': null_predicted.tolist(),
                                 'selection': null_selection})
    mean_prediction = np.asarray(predictions)
    accuracy = [np.mean(value == held_y) for value in predictions]
    by_role = {role: ppm(min(np.mean(value[held_y == index] == index) for value in predictions))
               for index, role in enumerate(ROLES)}
    agreement = 1 if len(predictions) == 1 else np.mean(np.all(mean_prediction == mean_prediction[0], axis=0))
    null_accuracies = [r['accuracy_ppm'] for r in null_records]
    null_swaps = [r['swap_ppm'] for r in null_records]
    measurements = {
        'held_out_typed_role_accuracy': ppm(min(accuracy)),
        'worst_role_accuracy': min(by_role.values()),
        'surface_swap_consistency': ppm(min(
            min(swap_consistency(held['rows'], value),
                np.mean(swapped_predictions[i] == labels(swapped_rows)))
            for i, value in enumerate(predictions))),
        'cross_seed_prediction_agreement': ppm(agreement),
        'scrambled_example_accuracy': ppm(max(np.mean(value == held_y) for value in control_predictions)),
        'label_shuffle_accuracy': int(np.quantile(null_accuracies, 0.95, method='higher')),
        'margin_over_header_only': ppm(min(accuracy) - max(np.mean(value == held_y) for value in headers)),
    }
    raw = [{'seed': seed, 'family': row['family'], 'template': row['surface_template'],
            'symbol': row['symbol'], 'true_role': row['label'],
            'predicted_role': ROLES[int(predictions[j][i])],
            'scrambled_role': ROLES[int(control_predictions[j][i])],
            'header_role': ROLES[int(headers[j][i])],
            'role_swap_target': swapped_rows[i]['label'],
            'role_swap_prediction': ROLES[int(swapped_predictions[j][i])]}
           for j, seed in enumerate(runs) for i, row in enumerate(held['rows'])]
    result = {'schema': 'ilxyr.reasoner4_role_probe_result.v1',
              'scope': 'Six fixed Reasoner 3.9 point roles across distinct demonstration and surface families',
              'smoke': smoke, 'measurements': measurements, 'role_accuracy_ppm': by_role,
              'selection': selections, 'projection_controls': projection_records,
              'shuffle_null': {'runs': len(null_records), 'records': null_records,
                               'accuracy_p95_ppm': measurements['label_shuffle_accuracy'],
                               'swap_p95_ppm': int(np.quantile(null_swaps, 0.95, method='higher'))},
              'capture_hashes': {'fit': digest(encoded(fit_x.tolist())),
                                 'held': digest(encoded(held_x.tolist())),
                                 'scrambled': digest(encoded(scrambled_x.tolist())),
                                 'role_swap': digest(encoded(swapped_x.tolist()))},
              'predictions': raw, 'failed_cases': [r for r in raw if r['true_role'] != r['predicted_role']],
              'cpu_seconds': round(time.process_time() - started, 3),
              'verifier_evaluations': 0,
              'capture_rows': len(fit['rows']) + len(held['rows']) + len(scrambled['rows'])}
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', type=Path)
    parser.add_argument('--smoke', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = run(args.folder, args.smoke)
    if args.output:
        args.output.write_bytes(encoded(result))
    print(json.dumps({key: result[key] for key in ('smoke', 'measurements', 'role_accuracy_ppm',
                                                    'cpu_seconds', 'capture_rows')}, indent=2))


if __name__ == '__main__':
    main()
