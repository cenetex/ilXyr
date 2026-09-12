/* Included after the pinned trainer's corpus and channel-mask helpers. */
static FILE *window_loss_stream;

static uint32_t window_u32(const unsigned char *p)
{
    return (uint32_t)p[0] | (uint32_t)p[1] << 8 |
           (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}

static uint64_t window_hash(const Token *tokens, int context)
{
    uint64_t h = UINT64_C(1469598103934665603);
    for (int i = 0; i <= context; ++i) {
        h = (h ^ (tokens[i] & 255U)) * UINT64_C(1099511628211);
        h = (h ^ (tokens[i] >> 8)) * UINT64_C(1099511628211);
    }
    return h;
}

static int window_samples(const CorpusRange *range, int batches, int count)
{
    if (range->fixed_windows) return (int)range->record_count;
    int samples = batches / count;
    return samples < 1 ? 1 : samples;
}

static int window_evaluation_count(const CorpusRange *ranges, int count, int batches)
{
    int total = 0;
    for (int i = 0; i < count; ++i) total += window_samples(&ranges[i], batches, count);
    return total;
}

static int has_fixed_windows(const CorpusRange *ranges, int count)
{
    for (int i = 0; i < count; ++i) if (ranges[i].fixed_windows) return 1;
    return 0;
}

static void corpus_add_windows(Corpus *corpus, const char *path, CorpusRange *range,
                               int context, int channel, int foundation, int allow_endpoint)
{
    unsigned char header[24];
    FILE *file = fopen(path, "rb");
    if (!file) fail_path("open window pack", path);
    if (fread(header, 1, sizeof header, file) != sizeof header ||
        memcmp(header, "Z4WIND1\0", 8) || window_u32(header + 8) != (uint32_t)context) {
        fail("window pack magic, context or header differs");
    }
    uint32_t count = window_u32(header + 12);
    uint32_t kind = window_u32(header + 16);
    uint32_t role = window_u32(header + 20);
    if (!count || count > 8192 || kind != (uint32_t)(channel ? 2 : foundation ? 1 : 0) ||
        (role != 1 && role != 2)) fail("window pack count, kind or role differs");
    if (role == 2 && !allow_endpoint) fail("endpoint window pack requires evaluation or input audit");
    size_t stride = (size_t)context + 1;
    size_t expected = sizeof header + (size_t)count * stride * 2;
    if (fseek(file, 0, SEEK_END) || ftell(file) != (long)expected || fseek(file, sizeof header, SEEK_SET)) {
        fail("window pack byte count differs");
    }
    range->record_count = count;
    range->endpoint_windows = role == 2;
    if (corpus->length) {
        static const Token separator[] = {'\n', '\n'};
        corpus_append(corpus, separator, 2);
    }
    Token *tokens = zero_alloc(stride, sizeof(*tokens));
    unsigned char *bytes = zero_alloc(stride, 2);
    for (uint32_t i = 0; i < count; ++i) {
        if (fread(bytes, 2, stride, file) != stride) fail("window pack payload truncated");
        for (size_t j = 0; j < stride; ++j) tokens[j] = (Token)(bytes[j * 2] | (unsigned)bytes[j * 2 + 1] << 8);
        corpus_append(corpus, tokens, stride);
    }
    free(bytes);
    free(tokens);
    if (fclose(file)) fail("window pack close failed");
}

static void prepare_fixed_range(CorpusRange *range, const Corpus *corpus, int context)
{
    size_t stride = (size_t)context + 1;
    if (range->length != range->record_count * stride) fail("fixed window range length differs");
    range->training_length = range->length;
    range->validation_length = range->length;
    range->validation_start = range->start;
    range->training_record_count = range->record_count;
    range->validation_record_count = range->record_count;
    range->validation_record_index = 0;
    range->record_starts = zero_alloc(range->record_count, sizeof(*range->record_starts));
    unsigned char *mask = zero_alloc((size_t)context, 1);
    for (size_t i = 0; i < range->record_count; ++i) {
        size_t start = range->start + i * stride;
        range->record_starts[i] = start;
        if (range->channel && (corpus->data[start] != CHANNEL_START_TOKEN ||
            !channel_loss_mask(corpus->data + start, corpus->data + start + 1, mask, context, 1))) {
            fail("fixed channel window needs a record start and reply targets");
        }
    }
    free(mask);
}

static void write_window_audit(const char *path, const Corpus *corpus,
                               const CorpusRange *ranges, int count, int context)
{
    FILE *file = fopen(path, "wx");
    if (!file) fail_path("create window audit", path);
    unsigned char *mask = zero_alloc((size_t)context, 1);
    for (int r = 0; r < count; ++r) {
        const CorpusRange *range = &ranges[r];
        if (!range->fixed_windows) continue;
        for (size_t i = 0; i < range->record_count; ++i) {
            size_t start = range->record_starts[i];
            int targets = range->channel ? channel_loss_mask(corpus->data + start, corpus->data + start + 1, mask, context, 1) : context;
            if (fprintf(file, "{\"range\":%d,\"window\":%zu,\"start\":%zu,\"context\":%d,"
                        "\"role\":%d,\"targets\":%d,\"tokens_hash\":\"%016llx\"}\n",
                        r, i, start, context, range->endpoint_windows ? 2 : 1, targets,
                        (unsigned long long)window_hash(corpus->data + start, context)) < 0) fail("window audit write failed");
        }
    }
    free(mask);
    if (fclose(file)) fail("window audit close failed");
}

static void open_window_losses(const char *path)
{
    size_t length = strlen(path) + sizeof(".windows.jsonl");
    char *name = zero_alloc(length, 1);
    snprintf(name, length, "%s.windows.jsonl", path);
    window_loss_stream = fopen(name, "wx");
    free(name);
    if (!window_loss_stream) fail("window loss file already exists or cannot be created");
}

static void record_window_loss(int range, int window, const Token *tokens,
                               int context, int channel, float loss)
{
    if (!window_loss_stream) return;
    unsigned char *mask = zero_alloc((size_t)context, 1);
    int targets = channel ? channel_loss_mask(tokens, tokens + 1, mask, context, 1) : context;
    free(mask);
    if (!isfinite(loss) || fprintf(window_loss_stream,
        "{\"range\":%d,\"window\":%d,\"loss\":%.9g,\"targets\":%d,\"tokens_hash\":\"%016llx\"}\n",
        range, window, loss, targets, (unsigned long long)window_hash(tokens, context)) < 0 || fflush(window_loss_stream)) {
        fail("window loss write failed");
    }
}
