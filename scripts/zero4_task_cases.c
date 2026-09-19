/* Retain one result per case from the pinned native quantity evaluator. */
#define main historical_quantity_main
#include "quantity_request_eval.c"
#undef main

static void case_string(FILE *out, const char *text)
{
    fputc('"', out);
    for (const unsigned char *p = (const unsigned char *)text; *p; ++p) {
        if (*p == '"' || *p == '\\') fputc('\\', out);
        if (*p >= 32 && *p < 127) fputc(*p, out);
        else fprintf(out, "\\u%04x", *p);
    }
    fputc('"', out);
}

int main(int argc, char **argv)
{
    static RequestCase cases[MAX_CASES];
    int count = 0, shard_index = 0, shard_count = 1;
    size_t length;
    if (argc != 4 && argc != 8) return 2;
    if (argc == 8 && (strcmp(argv[4], "--shard-index") || strcmp(argv[6], "--shard-count") ||
        !parse_integer(argv[5], 0, MAX_JOBS - 1, &shard_index) ||
        !parse_integer(argv[7], 1, MAX_JOBS, &shard_count) || shard_index >= shard_count)) return 2;
    if (!read_tsv(argv[2], cases, &count) || count < 1) return 2;
    unsigned char *model = read_binary(argv[1], &length);
    if (!model || length > INT_MAX || lm_load(model, (int)length)) {
        free(model);
        return 3;
    }
    FILE *out = fopen(argv[3], "wx");
    if (!out) { free(model); return 4; }
    for (int i = 0; i < count; ++i) {
        if (i % shard_count != shard_index) continue;
        RequestResult r = {0};
        evaluate_case(&cases[i], &r, 0);
        fprintf(out, "{\"schema\":\"ilxyr.zero4_task_case.v1\",\"ordinal\":%d,\"id\":", i);
        case_string(out, cases[i].id);
        fprintf(out, ",\"cases\":%d,\"closed\":%d,\"syntax\":%d,\"operation\":%d,"
                "\"arguments\":%d,\"exact_request\":%d,\"oracle_arithmetic\":%d,"
                "\"committed\":%d,\"exact_artifact\":%d,\"rejected\":%d,"
                "\"rejected_state_mutations\":%d,\"operation_only\":%d,\"target_bits\":%.12f}\n",
                r.cases, r.closed, r.syntax, r.operation, r.arguments, r.exact_request,
                r.oracle_arithmetic, r.committed, r.exact_artifact, r.rejected,
                r.rejected_state_mutations, r.operation_only, r.bits);
        if (fflush(out)) { fclose(out); free(model); return 5; }
    }
    free(model);
    return fclose(out) ? 5 : 0;
}
