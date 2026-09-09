/* The included episode implementation is bound to the published step 36 source. */
#include "eligible_source.h"
#include "study_inputs.h"

int main(int argc, char **argv)
{
    if (argc != 3) return 2;
    uint32_t arm = 0, pass = 0;
    for (; arm < R55E_ARMS && strcmp(argv[1], r55e_names[arm]); ++arm) {}
    if (arm == R55E_ARMS || !argv[2][0]) return 2;
    for (const char *c = argv[2]; *c; ++c) {
        if (*c < '0' || *c > '9' || pass > 100) return 2;
        pass = pass * 10 + (uint32_t)(*c - '0');
    }
    if (pass >= R40_PASSES) return 2;
    uint64_t start = r55d_now(), cpu = r55d_cpu(), model_start = start;
    r55_artifact artifact = {0}; r55sg_model model = {0};
    int failed = arm ? r55ft_load_model(&artifact, &model) : 0;
    uint64_t model_ns = r55d_now() - model_start;
    printf("{\"kind\":\"metadata\",\"mode\":\"%s\",\"arm\":\"%s\",\"pass\":%u,"
        "\"planner\":\"eligible\",\"roster_sha256\":\"%s\",\"model_load_ns\":%" PRIu64 ","
        "\"preparation_ns\":%" PRIu64 ",\"preparation_cpu_ns\":%" PRIu64 "}\n",
        R40_MODE, r55e_names[arm], pass, R40_ROSTER_SHA, model_ns, r55d_now()-start, r55d_cpu()-cpu);
    fflush(stdout);
    uint32_t completed = 0;
    for (uint32_t phase = 0; phase < 2 && !failed; ++phase)
        for (uint32_t position = 0; position < R40_EPISODES && !failed; ++position) {
            uint32_t index = r40_order[pass][position], groups = 0;
            const r55_family *family = &r40_families[index / 4];
            uint32_t view = index % 4;
            r55_search_result result = {0}; r55sg_timing timing = {0};
            r55e_counts counts = {0}; r55e_heap selected = {0};
            failed = r55e_episode(family, view / 2, view % 2, r55e_arms[arm], &artifact, &model,
                0, 64, R55_GLOBAL_CAP, 0, &result, &timing, &counts, &selected, &groups);
            failed |= !result.exact || !result.certificate_valid || !result.invalid_first_rejected;
            ++completed;
            r55e_row(family->ordinal * 4 + view, phase, "normal", 64, R55_GLOBAL_CAP,
                groups, failed, &result, &timing, &counts, &selected);
        }
    struct rusage usage = {0};
    if (getrusage(RUSAGE_SELF, &usage)) failed = 1;
    uint64_t peak = (uint64_t)usage.ru_maxrss;
#ifndef __APPLE__
    peak *= 1024;
#endif
    printf("{\"kind\":\"process\",\"failed\":%s,\"completed_episodes\":%u,\"peak_rss_bytes\":%" PRIu64
        ",\"process_wall_ns\":%" PRIu64 ",\"process_cpu_ns\":%" PRIu64 "}\n", failed ? "true" : "false",
        completed, peak, r55d_now()-start, r55d_cpu()-cpu);
    return failed || ferror(stdout);
}
