# ZERO.4 parallel comparison source kit

This source kit reproduces the small engineering checks for the fixed step44
plan. The upstream source commit is 9b4806f77a8cf4c3c0809bfc7136ae8eb320fa7d.
The ilXyr implementation commit is 8355feec434cc9be4a25bad7eaced0aaf8fa2f12.

From this directory:

```sh
python3 scripts/test_zero4_endpoint.py
python3 scripts/test_zero4_study.py
python3 scripts/check_zero4_study.py --source source --out opened
```

Use a fresh output folder. The full comparison follows the cloud execution
plan and its approved package and budget. The opened checks use a tiny
synthetic model. The source licenses are retained beside their files.
