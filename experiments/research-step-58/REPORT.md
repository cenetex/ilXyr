# Research step 58: FERAL full comparison completed

The repaired 7B model completed all 1,147 revised FinQA inputs on September 25, 2026. It returned **166 correct revised answers**. The frozen calculator control returned **24** and the operand-only control returned **3**. Each arm used the same ordered inputs and target rules. The model also produced **231 invalid responses**, answered 911 inputs, and explicitly abstained on 5. Its revised accuracy was 14.47%; the calculator reached 2.09% and the operand control 0.26%. These values describe this FinQA comparison. They do not establish performance on the proposed XBRL study.

The model passed the synthetic startup check on the GPU, including one generated answer. That check had zero score weight. All three scored arms then completed. The model was correct on 162 of 1,133 legacy exact targets, 3 of 11 revised numeric targets, and 1 of 3 revised abstention targets. The invalid responses and sparse abstention show that answer reliability remains an important next test. [SCORES.json](SCORES.json) keeps the counts and raw process times.

## Run and verification

The first zone returned a capacity error. An exact client-token query found zero instances. The second zone passed fresh provider and price checks, passed a free dry run, and launched one instance with the repaired package. [LAUNCH.json](LAUNCH.json) and [PREFLIGHT.json](PREFLIGHT.json) bind the package, plan, version, request, and $3 before-tax ceiling.

The host recorded a complete result after 988.18 seconds. Its shutdown completed, and provider reads found zero tagged volumes and zero attached interfaces. All 42 stored objects, totaling 3,892,621 bytes, passed exact-version size and SHA-256 checks. The controller's 35 indexed files also matched their hashes. The frozen source package replayed every raw response and reproduced every saved score. [COLLECTION.json](COLLECTION.json), [COLLECTION-MANIFEST.json](COLLECTION-MANIFEST.json), [VERIFICATION.json](VERIFICATION.json), and [CLEANUP.json](CLEANUP.json) preserve these checks. Large raw responses remain in the verified versioned result storage.

The host-time estimate is **$1.3654390 before tax** from its 988.18-second terminal value. A conservative estimate through the provider termination observation is **$1.7639184 before tax**. Both include the full $0.75 infrastructure reserve. The actual invoice amount remains pending. Process wall times are saved as raw costs; this run does not claim a measured speedup.

## Next decision

The 7B arm improved the count of correct answers on this fixed roster, while many outputs failed the response contract. The next FERAL study should separate evidence selection, valid answer rendering, arithmetic, and abstention on fresh source-linked inputs. The [FERAL v3 proposal](../../docs/FERAL-7B-V3-XBRL-REGULATORY-PROPOSAL.md) keeps that work as a separate decision. The earlier [capacity window](../research-step-30/REPORT.md) and [cache failure](../research-step-28/REPORT.md) remain part of the execution history.
