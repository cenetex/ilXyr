/* Independent C replay of the fixed JS roster selection. Model scoring is a later step. */
#include "build/reasoner55_eligible_matched.h"
#include "exclusions.h"

static int r39_map_compare(const void *a, const void *b)
{
    return memcmp(a, b, sizeof(r55_affine));
}
static void r39_primitive_key(r55_affine key[8], const r55_affine maps[8])
{
    memcpy(key, maps, 8 * sizeof(*key));
    qsort(key, 8, sizeof(*key), r39_map_compare);
}
static int r39_candidate(r55_family *family, uint32_t ordinal, uint32_t nonce)
{
    if (r55_generate_family(family, R39_ROOT, 0, ordinal, nonce)) return 1;
    if (ordinal >= 64 && (r55ft_dense(&family->primitive_by_role[6], family->family_seed, 6) ||
        r55ft_dense(&family->primitive_by_role[7], family->family_seed, 7))) return 1;
    r55_rng rng; uint8_t binding[8] = {0,1,2,3,4,5,6,7};
    r55_rng_init(&rng, family->family_seed, UINT64_C(0x636f6d702d763031));
    for (uint32_t i = 7; i > 0; --i) {
        uint32_t j = r55_rng_index(&rng, i + 1), temporary = binding[i];
        binding[i] = binding[j]; binding[j] = (uint8_t)temporary;
    }
    for (uint32_t i = 0; i < 4; ++i) {
        family->target_roles[i] = binding[(ordinal / 32) % 2 ? i % 2 : i];
        family->target_surface[i] = family->role_to_surface[family->target_roles[i]];
    }
    family->target = r55_program_from_roles(family, family->target_roles);
    r55_apply(&family->target, family->example_input, family->example_output);
    return 0;
}
static int r39_syntax(uint8_t seen[4096])
{
    for (uint32_t i = 0; i < R39_PRIOR_COUNT; ++i) {
        const r39_prior *prior = &r39_priors[i]; r55_family family = {0};
        memcpy(family.primitive_by_role, prior->ops, sizeof(prior->ops));
        memcpy(family.target_roles, prior->roles, sizeof(prior->roles));
        family.target = prior->target;
        r55_affine target = r55_program_from_roles(&family, family.target_roles);
        if (!r55_affine_equal(&target, &family.target)) return 1;
        if (prior->scope == 0) {
            uint16_t solutions[4096]; uint32_t count = r55d_exact_solutions(&family, solutions);
            if (!count) return 1;
            for (uint32_t j = 0; j < count; ++j) seen[solutions[j]] = 1;
        }
        if (prior->scope < 2) seen[r55_ast_key(prior->roles)] = 1;
    }
    return 0;
}
static int r39_reason(const r55_family *family, const uint8_t seen[4096],
    const r55_affine *behavior, const r55_affine primitives[][8], uint32_t used)
{
    int mixing = 0;
    for (uint32_t i = 0; i < 4; ++i) mixing |= family->target_roles[i] >= 6;
    if (!mixing) return 0;
    if (seen[r55_ast_key(family->target_roles)]) return 1;
    for (uint32_t i = 0; i < used; ++i) if (r55_affine_equal(&behavior[i], &family->target)) return 2;
    r55_affine key[8]; r39_primitive_key(key, family->primitive_by_role);
    for (uint32_t i = 0; i < used; ++i) if (!memcmp(primitives[i], key, sizeof(key))) return 3;
    return -1;
}
static int r39_probe(void)
{
    r55_family family; uint8_t seen[4096] = {0}; r55_affine target[1] = {{{0},{0}}}, key[1][8] = {{{{0},{0}}}};
    if (r39_candidate(&family, 0, 0)) return 1;
    if (r39_reason(&family, seen, target, key, 0) != -1) return 1;
    target[0] = family.target; target[0].bias[0] = (target[0].bias[0] + 1) % 5;
    r39_primitive_key(key[0], family.primitive_by_role);
    if (r39_reason(&family, seen, target, key, 1) != 3) return 1;
    r55_affine temp = family.primitive_by_role[0];
    family.primitive_by_role[0] = family.primitive_by_role[1]; family.primitive_by_role[1] = temp;
    for (uint32_t i = 0; i < 4; ++i) if (family.target_roles[i] < 2) family.target_roles[i] = 1-family.target_roles[i];
    if (r39_reason(&family, seen, target, key, 1) != 3) return 1;
    target[0] = family.target;
    if (r39_reason(&family, seen, target, key, 1) != 2) return 1;
    seen[r55_ast_key(family.target_roles)] = 1;
    if (r39_reason(&family, seen, target, key, 1) != 1) return 1;
    memset(family.target_roles, 0, sizeof(family.target_roles));
    if (r39_reason(&family, seen, target, key, 1) != 0) return 1;
    puts("{\"native_guard_cases\":6,\"status\":\"passed\"}"); return ferror(stdout);
}
static int r39_replay(void)
{
    uint8_t seen[4096] = {0};
    r55_affine behavior[R39_PRIOR_COUNT + 128], primitives[R39_PRIOR_COUNT + 128][8];
    uint32_t used = R39_PRIOR_COUNT;
    if (r39_syntax(seen)) return 1;
    for (uint32_t i = 0; i < 4096; ++i) if (seen[i]) printf("{\"kind\":\"syntax\",\"ast\":%u}\n", i);
    for (uint32_t i = 0; i < R39_PRIOR_COUNT; ++i) {
        behavior[i] = r39_priors[i].target;
        r39_primitive_key(primitives[i], r39_priors[i].ops);
    }
    r55ft_corpus *corpus = calloc(1, sizeof(*corpus));
    if (!corpus) return 1;
    int failed = 0;
    for (uint32_t ordinal = 0; ordinal < 128 && !failed; ++ordinal) {
        int accepted = 0;
        for (uint32_t nonce = 0; nonce <= 65535 && !accepted; ++nonce) {
            r55_family *family = &corpus->families[ordinal];
            if (r39_candidate(family, ordinal, nonce)) { failed = 1; break; }
            int reason = r39_reason(family, seen, behavior, primitives, used);
            r55_affine key[8]; r39_primitive_key(key, family->primitive_by_role);
            printf("{\"kind\":\"decision\",\"ordinal\":%u,\"nonce\":%u,\"reason\":%d,\"family_seed\":\"%016" PRIx64 "\"}\n",
                ordinal, nonce, reason, family->family_seed);
            if (reason >= 0) { ++corpus->rejected[ordinal][reason]; continue; }
            corpus->nonces[ordinal] = nonce; corpus->minimum[ordinal] = r55ft_minimum(family);
            behavior[used] = family->target; memcpy(primitives[used++], key, sizeof(key));
            r55ft_emit_family(corpus, ordinal); accepted = 1;
        }
        if (!accepted) { fprintf(stderr, "roster generation stopped at ordinal %u\n", ordinal); failed = 1; }
    }
    free(corpus); return failed || ferror(stdout);
}
int main(int argc, char **argv)
{
    if (argc == 2 && !strcmp(argv[1], "--self-test")) return r39_probe();
    if (argc != 2 || strcmp(argv[1], "replay-roster")) return 2;
    return r39_replay();
}
