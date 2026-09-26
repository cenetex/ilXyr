/* Compile beside the pinned Reasoner 3.9 sources. This calls its point evaluator. */
#include "reasoner310.c"

int main(void)
{
    unsigned role;
    long long candidate, goal;
    while (scanf("%u %lld %lld", &role, &candidate, &goal) == 3) {
        const uint8_t codes[][3] = {
            {0, 0, 0},
            {R310_OP_CANDIDATE, 0, 0},
            {R310_OP_GOAL, 0, 0},
            {R310_OP_CANDIDATE, R310_OP_GOAL, R310_OP_SUBTRACT},
            {R310_OP_CANDIDATE, R310_OP_ABSOLUTE, 0},
            {R310_OP_CANDIDATE, R310_OP_GOAL, R310_OP_MULTIPLY},
            {R310_OP_CANDIDATE, R310_OP_NONZERO, 0}
        };
        const uint8_t lengths[] = {0, 1, 1, 3, 2, 3, 2};
        int64_t value;
        if (role < 1 || role > 6 ||
            !evaluate_point_code(codes[role], lengths[role],
                                 (int64_t)candidate, (int64_t)goal, &value))
            return 2;
        printf("%" PRId64 "\n", value);
    }
    return ferror(stdin) ? 3 : 0;
}
