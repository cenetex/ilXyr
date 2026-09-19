/* Check prepared answers through the pinned native parser and exact oracle. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quantity_oracle.h"

int main(int argc, char **argv)
{
    if (argc != 2) return 2;
    FILE *file = fopen(argv[1], "r");
    if (!file) return 2;
    char line[1600];
    const char *header = "id\tdomain\tprevious_summary\tinput\tmodel_request\trequest\tartifact\tsummary\n";
    if (!fgets(line, sizeof line, file) || strcmp(line, header)) return 2;
    unsigned count = 0;
    while (fgets(line, sizeof line, file)) {
        char *fields[8], *cursor = line;
        for (int i = 0; i < 8; ++i) {
            fields[i] = cursor;
            char *end = strchr(cursor, i == 7 ? '\n' : '\t');
            if (!end) return 3;
            *end = 0;
            cursor = end + 1;
        }
        if (*cursor || strcmp(fields[1], "quantity")) return 3;
        char request[160], artifact[320], summary[320];
        if (!quantity_request_from_input(fields[3], request, sizeof request) ||
            strcmp(request, fields[5]) ||
            !quantity_oracle_execute(request, artifact, sizeof artifact, summary, sizeof summary) ||
            strcmp(artifact, fields[6]) || strcmp(summary, fields[7])) {
            fprintf(stderr, "native gold mismatch: %s\n", fields[0]);
            return 4;
        }
        char *space = strchr(request, ' ');
        if (!space) return 4;
        *space = 0;
        if (strcmp(request, fields[4])) return 4;
        ++count;
    }
    if (ferror(file) || fclose(file) || count == 0) return 5;
    printf("{\"native_gold_rows\":%u}\n", count);
    return 0;
}
