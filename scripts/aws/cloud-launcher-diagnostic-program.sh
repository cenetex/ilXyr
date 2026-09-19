#!/bin/sh

set -eu

test "${1:-}" = "--frozen"
printf '%s\n' '{"metrics":{"score":0.82}}'
