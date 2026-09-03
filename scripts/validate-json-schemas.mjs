import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDirectory = join(root, "schemas");

const fixtures = {
  "aws-execution-status.schema.json": [
    "examples/schema/aws-execution-status.json",
  ],
  "aws-launcher-config.schema.json": [
    "examples/schema/aws-launcher-config.json",
  ],
  "aws-price-evidence.schema.json": [
    "examples/schema/aws-price-evidence.json",
  ],
  "braid-corpus-import.schema.json": [
    "examples/corpus/feral-7b-braid-import.json",
  ],
  "azure-ml-corpus-handoff.schema.json": [
    "examples/corpus/azure-ml-handoff.json",
  ],
  "calibration-record.schema.json": ["examples/schema/calibration-record.json"],
  "cenetex-reference-build-contract.schema.json": [
    "executor/cenetex-public-v1/build-contract.json",
  ],
  "condition.schema.json": ["examples/schema/condition.json"],
  "certificate.schema.json": ["examples/schema/certificate.json"],
  "claim-status.schema.json": ["examples/schema/claim-status.json"],
  "claim.schema.json": ["examples/schema/claim.json"],
  "claim-support.schema.json": [],
  "contribution.schema.json": [
    "examples/toy/hypothesis.json",
    "examples/toy/foundation.json",
    "examples/toy/engineering-review.json",
    "examples/toy/experiment-design.json",
    "examples/experiments/solomon-q22/hypothesis.json",
    "examples/experiments/solomon-q22/foundation.json",
    "examples/experiments/solomon-q22/engineering-review.json",
    "examples/experiments/solomon-q22/experiment-design.json",
    "examples/experiments/solomon-q22-compositional/hypothesis.json",
    "examples/experiments/solomon-q22-compositional/foundation.json",
    "examples/experiments/solomon-q22-compositional/engineering-review.json",
    "examples/experiments/solomon-q22-compositional/experiment-design.json",
  ],
  "corpus-materialization.schema.json": [
    "examples/corpus/s3-materialization.json",
    "examples/corpus/azure-materialization.json",
    "examples/corpus/feral-7b-s3-materialization.json",
    "examples/corpus/feral-7b-future-eval-s3-materialization.json",
    "examples/corpus/feral-7b-unseen-eval-s3-materialization.json",
  ],
  "corpus-rights-review.schema.json": [
    "examples/corpus/feral-7b-rights-review.json",
  ],
  "corpus-release.schema.json": ["examples/corpus/braid-corpus-five.json"],
  "epoch-budget.schema.json": ["examples/schema/epoch-budget.json"],
  "evidence-bundle.schema.json": ["examples/schema/evidence-bundle.json"],
  "evidence-graph-edge.schema.json": [
    "examples/schema/evidence-graph-edge.json",
  ],
  "evidence.schema.json": ["examples/schema/evidence.json"],
  "executor-attestation.schema.json": [
    "examples/schema/executor-attestation.json",
  ],
  "executor-artifact-materialization.schema.json": [
    "examples/schema/executor-artifact-materialization.json",
  ],
  "executor-conformance-report.schema.json": [
    "examples/schema/executor-conformance-report.json",
  ],
  "executor-conformance-suite.schema.json": [
    "examples/schema/executor-conformance-suite.json",
    "executor/cenetex-public-v1/conformance-suite.draft.json",
  ],
  "executor-environment.schema.json": [
    "examples/schema/executor-environment.json",
  ],
  "executor-job-package.schema.json": [
    "examples/schema/executor-job-package.json",
  ],
  "executor-preflight-receipt.schema.json": [
    "examples/schema/executor-preflight-receipt.json",
  ],
  "execution-report.schema.json": [
    "examples/schema/execution-report.json",
  ],
  "execution-verification-summary.schema.json": [
    "examples/schema/execution-verification-summary.json",
  ],
  "experiment.schema.json": [
    "examples/toy/experiment.json",
    "examples/experiments/solomon-q22/experiment.json",
    "examples/experiments/solomon-q22-compositional/experiment.json",
  ],
  "external-registration-receipt.schema.json": [
    "examples/schema/external-registration-receipt.json",
  ],
  "family-manifest.schema.json": [
    "examples/experiments/zero-q26r/family.json",
  ],
  "feral-calibration-plan.schema.json": [
    "examples/feral-7b/feral-7b-calibration-plan.json",
  ],
  "forecast.schema.json": [
    "examples/toy/forecast-model.json",
    "examples/toy/forecast-human.json",
    "examples/experiments/solomon-q22/forecast-mechanistic.json",
    "examples/experiments/solomon-q22/forecast-empirical.json",
    "examples/experiments/solomon-q22-compositional/forecast-mechanistic.json",
    "examples/experiments/solomon-q22-compositional/forecast-empirical.json",
  ],
  "frozen-proposal-candidate.schema.json": [
    "examples/schema/frozen-proposal-candidate.json",
  ],
  "funding.schema.json": [
    "examples/toy/funding-a.json",
    "examples/toy/funding-b.json",
    "examples/experiments/solomon-q22/funding-a.json",
    "examples/experiments/solomon-q22/funding-b.json",
    "examples/experiments/solomon-q22-compositional/funding-a.json",
    "examples/experiments/solomon-q22-compositional/funding-b.json",
  ],
  "huggingface-model.schema.json": [
    "examples/schema/huggingface-model.json",
  ],
  "mechanism-tournament.schema.json": [
    "examples/schema/mechanism-tournament.json",
  ],
  "mechanism-tournament-settlement.schema.json": [
    "examples/schema/mechanism-tournament-settlement.json",
  ],
  "lab-registry.schema.json": ["docs/lab-registry.json"],
  "nsrl-gate-evidence.schema.json": [
    "examples/nsrl/p10m-v10-context-gate.json",
    "examples/nsrl/p10m-v10-generation-gate.json",
    "examples/nsrl/p10m-v10-integrity-gate.json",
    "examples/nsrl/p10m-v10-learning-gate.json",
    "examples/nsrl/p10m-v10-numeric-health-gate.json",
    "examples/nsrl/p10m-v10-provenance-gate.json",
    "examples/nsrl/p10m-v10-serving-gate.json",
  ],
  "nsrl-registration.schema.json": [
    "examples/nsrl/p10m-v10-registration.json",
  ],
  "oci-job-completion.schema.json": ["examples/cloud/oci-completion.json"],
  "oci-job-dispatch.schema.json": ["examples/cloud/oci-dispatch.json"],
  "paper-contract.schema.json": ["examples/schema/paper-contract.json"],
  "proposal-compilation.schema.json": [
    "examples/schema/proposal-compilation.json",
  ],
  "proposal-contribution-package.schema.json": [
    "examples/schema/proposal-contribution-package.json",
  ],
  "proposal-review.schema.json": ["examples/schema/proposal-review.json"],
  "experiment-proposal.schema.json": [
    "examples/proposals/zero-orbit-quotient.proposal.json",
    "examples/proposals/solomon-e8-codebook.proposal.json",
    "examples/proposals/zero-exception-routing.proposal.json",
  ],
  "program-overview.schema.json": [],
  "replication-contract.schema.json": ["examples/schema/replication-contract.json"],
  "replication-settlement.schema.json": [
    "examples/schema/replication-settlement.json",
  ],
  "research-pathways.schema.json": ["docs/research-pathways.json"],
  "registration-package.schema.json": [
    "examples/schema/registration-package.json",
  ],
  "research-registry.schema.json": ["registry/research-registry.json"],
  "representation-audit.schema.json": [
    "examples/diagnostics/exp-008-representation-audit.json",
    "examples/diagnostics/nsrl-p10m-representation-audit.json",
    "examples/diagnostics/reasoner-4-representation-audit.json",
  ],
  "retro-registration.schema.json": [
    "examples/schema/retro-registration.json",
    "examples/families/nsrl-target-margin-v1.retro.json",
    "examples/families/nsrl-target-margin-trust-region-v1.retro.json",
    "examples/families/nsrl-direct-head-nll-guard-v1.retro.json",
    "examples/families/nsrl-direct-head-nll-safe-set-v1.retro.json",
    "examples/families/nsrl-direct-head-cross-document-stability-v1.retro.json",
    "examples/families/solomon-successor-v2.retro.json",
    "examples/families/zero-q22r-multiseed.retro.json",
    "examples/families/zero-q22r-seed2.retro.json",
    "examples/families/zero-q23-seed2.retro.json",
  ],
  "sandbox-run.schema.json": ["examples/schema/sandbox-run.json"],
  "sandbox-spec.schema.json": ["examples/schema/sandbox-spec.json"],
  "sagemaker-corpus-handoff.schema.json": [
    "examples/corpus/sagemaker-handoff.json",
  ],
  "shared-task.schema.json": ["examples/schema/shared-task.json"],
  "shared-task-v2.schema.json": [
    "examples/shared-tasks/zero-solomon-q22-operation-v1.json",
    "examples/shared-tasks/zero-solomon-q22-compositional-routing-v1.json",
  ],
  "trusted-attestation-key.schema.json": [
    "examples/schema/trusted-attestation-key.json",
  ],
  "transformers-execution-profile.schema.json": [
    "examples/feral-7b/transformers-base-profile.json",
    "examples/feral-7b/transformers-calibration-profile.json",
  ],
  "upstream-benchmark.schema.json": [
    "examples/schema/upstream-benchmark.json",
  ],
  "verified-executor-conformance.schema.json": [
    "examples/schema/verified-executor-conformance.json",
  ],
  "weight-multiplicity-program.schema.json": [
    "examples/weight-multiplicity/rev3-contract.json",
  ],
  "weight-multiplicity-frontier-plan.schema.json": [
    "examples/weight-multiplicity/phase0-frontier-plan.json",
    "examples/weight-multiplicity/phase0-frontier-plan-v2.json",
  ],
  "weight-multiplicity-phase05-plan.schema.json": [
    "examples/weight-multiplicity/phase05-frontier-plan.json",
  ],
  "weight-multiplicity-phase05-plan-v2.schema.json": [
    "examples/weight-multiplicity/phase05-frontier-plan-v2.json",
    "examples/weight-multiplicity/phase05-frontier-plan-v3.json",
  ],
  "weight-multiplicity-phase05-plan-v3.schema.json": [
    "examples/weight-multiplicity/phase05-frontier-plan-v4.json",
  ],
  "weight-multiplicity-phase05-plan-v4.schema.json": [
    "examples/weight-multiplicity/phase05-frontier-plan-v5.json",
  ],
  "weight-multiplicity-phase05-plan-v5.schema.json": [
    "examples/weight-multiplicity/phase05-frontier-plan-v6.json",
  ],
  "weight-multiplicity-phase05-plan-v6.schema.json": [
    "examples/weight-multiplicity/phase05-frontier-plan-v7.json",
  ],
  "weight-multiplicity-phase05-cold-replay-plan.schema.json": [
    "examples/weight-multiplicity/phase05-cold-replay-plan-v1.json",
  ],
  "weight-multiplicity-phase05-manifest.schema.json": [
    "examples/weight-multiplicity/phase05-representation-manifest.json",
    "examples/weight-multiplicity/phase05-representation-manifest-v2.json",
    "examples/weight-multiplicity/phase05-representation-manifest-v3.json",
    "examples/weight-multiplicity/phase05-representation-manifest-v4.json",
    "examples/weight-multiplicity/phase05-representation-manifest-v5.json",
    "examples/weight-multiplicity/phase05-representation-manifest-v6.json",
    "examples/weight-multiplicity/phase05-representation-manifest-v7.json",
  ],
  "weight-multiplicity-phase05-lie-cross-check.schema.json": [
    "examples/weight-multiplicity/phase05-lie-cross-check-manifest-v3.json",
  ],
  "weight-multiplicity-phase05-lie-cross-check-v4.schema.json": [
    "examples/weight-multiplicity/phase05-lie-cross-check-manifest-v4.json",
  ],
};

const readJson = async (relativePath) =>
  JSON.parse(await readFile(join(root, relativePath), "utf8"));

const schemaNames = (await readdir(schemaDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = new Map();
const schemas = new Map();

for (const schemaName of schemaNames) {
  if (!fixtures[schemaName]) {
    throw new Error(`schema ${schemaName} has no positive fixture`);
  }
  const schema = await readJson(`schemas/${schemaName}`);
  schemas.set(schemaName, schema);
  ajv.addSchema(schema);
}

for (const [schemaName, schema] of schemas) {
  const validate = ajv.getSchema(schema.$id);
  if (!validate) {
    throw new Error(`schema ${schemaName} did not compile`);
  }
  validators.set(schemaName, validate);
}

let positiveCount = 0;
for (const [schemaName, fixturePaths] of Object.entries(fixtures)) {
  const validate = validators.get(schemaName);
  if (!validate) {
    throw new Error(`fixture mapping refers to missing schema ${schemaName}`);
  }
  for (const fixturePath of fixturePaths) {
    const value = await readJson(fixturePath);
    if (!validate(value)) {
      throw new Error(
        `${fixturePath} failed ${schemaName}: ${JSON.stringify(validate.errors)}`,
      );
    }
    positiveCount += 1;
  }
}

let rejectionCount = 0;
const expectInvalid = (schemaName, label, value) => {
  const validate = validators.get(schemaName);
  if (validate(value)) {
    throw new Error(`${label} unexpectedly passed ${schemaName}`);
  }
  rejectionCount += 1;
};

const modelContribution = await readJson("examples/toy/foundation.json");
delete modelContribution.actor.model_ref;
expectInvalid(
  "contribution.schema.json",
  "model contribution without model_ref",
  modelContribution,
);

const mismatchedActor = await readJson("examples/toy/engineering-review.json");
mismatchedActor.actor.id = "service://toy/not-a-human";
expectInvalid(
  "contribution.schema.json",
  "human actor with service identity",
  mismatchedActor,
);

const proposalWithEquality = await readJson(
  "examples/proposals/zero-orbit-quotient.proposal.json",
);
proposalWithEquality.success_operator = "eq";
expectInvalid(
  "experiment-proposal.schema.json",
  "proposal with floating-point equality",
  proposalWithEquality,
);

const firstProposalWithPredecessor = await readJson(
  "examples/proposals/zero-orbit-quotient.proposal.json",
);
firstProposalWithPredecessor.predecessor_ref =
  "artifact://sha256/0000000000000000000000000000000000000000000000000000000000000000";
expectInvalid(
  "experiment-proposal.schema.json",
  "first proposal revision with a predecessor",
  firstProposalWithPredecessor,
);

const certificate = await readJson("examples/schema/certificate.json");
delete certificate.domain;
expectInvalid("certificate.schema.json", "certificate without domain", certificate);

const replication = await readJson("examples/schema/replication-contract.json");
delete replication.agreement_threshold;
expectInvalid(
  "replication-contract.schema.json",
  "combined replication without agreement threshold",
  replication,
);

const claimStatus = await readJson("examples/schema/claim-status.json");
claimStatus.spine_eligible = true;
expectInvalid(
  "claim-status.schema.json",
  "spine-eligible claim without risk and independent replication",
  claimStatus,
);

const unboundClaimStatus = await readJson("examples/schema/claim-status.json");
unboundClaimStatus.shared_task_bound = false;
expectInvalid(
  "claim-status.schema.json",
  "unbound status that retains a shared-task reference",
  unboundClaimStatus,
);

const evidence = await readJson("examples/schema/evidence.json");
delete evidence.authority;
expectInvalid("evidence.schema.json", "evidence without authority", evidence);

const evidenceBundle = await readJson("examples/schema/evidence-bundle.json");
evidenceBundle.cold_replayable = true;
expectInvalid(
  "evidence-bundle.schema.json",
  "cold-replayable bundle without retro evidence and source attestation",
  evidenceBundle,
);

const registrationReceipt = await readJson(
  "examples/schema/external-registration-receipt.json",
);
delete registrationReceipt.doi;
expectInvalid(
  "external-registration-receipt.schema.json",
  "public registration receipt without DOI",
  registrationReceipt,
);

const executorAttestation = await readJson(
  "examples/schema/executor-attestation.json",
);

const launcherWithMutablePackageKey = await readJson(
  "examples/schema/aws-launcher-config.json",
);
launcherWithMutablePackageKey.package_key = "packages/toy.remote.v1/latest.json";
expectInvalid(
  "aws-launcher-config.schema.json",
  "AWS launcher config with a mutable package key",
  launcherWithMutablePackageKey,
);

const statusWithLooseAuthorization = await readJson(
  "examples/schema/aws-execution-status.json",
);
statusWithLooseAuthorization.authorization_ref = "remote-authorization:latest";
expectInvalid(
  "aws-execution-status.schema.json",
  "AWS status without an artifact authorization reference",
  statusWithLooseAuthorization,
);

const priceWithShortBilling = await readJson("examples/schema/aws-price-evidence.json");
priceWithShortBilling.minimum_billed_seconds = 1;
expectInvalid(
  "aws-price-evidence.schema.json",
  "AWS price evidence with a short billing period",
  priceWithShortBilling,
);

const unsafeEnvironment = await readJson(
  "examples/schema/executor-environment.json",
);
unsafeEnvironment.isolation.signing_key_in_guest = true;
expectInvalid(
  "executor-environment.schema.json",
  "executor environment with a guest signing key",
  unsafeEnvironment,
);

const mutableJobImage = await readJson(
  "examples/schema/executor-job-package.json",
);
mutableJobImage.provider.image_sha256 = "latest";
expectInvalid(
  "executor-job-package.schema.json",
  "executor job package without an image digest",
  mutableJobImage,
);

const networkedDeniedJob = await readJson(
  "examples/schema/executor-job-package.json",
);
networkedDeniedJob.allowed_hosts = ["example.com"];
expectInvalid(
  "executor-job-package.schema.json",
  "network-denied job with an allowed host",
  networkedDeniedJob,
);

const unsignedExecutionReport = await readJson(
  "examples/schema/execution-report.json",
);
unsignedExecutionReport.attestation.signatures = [];
expectInvalid(
  "execution-report.schema.json",
  "execution report without a signature",
  unsignedExecutionReport,
);

const inconsistentConformance = await readJson(
  "examples/schema/executor-conformance-report.json",
);

const unsignedConformance = await readJson(
  "examples/schema/executor-conformance-report.json",
);
unsignedConformance.attestation.signatures = [];
expectInvalid(
  "executor-conformance-report.schema.json",
  "conformance report without a signature",
  unsignedConformance,
);

const traversingMaterialization = await readJson(
  "examples/schema/executor-artifact-materialization.json",
);
traversingMaterialization.resources[0].relative_path = "../outside";
expectInvalid(
  "executor-artifact-materialization.schema.json",
  "artifact materialization with path traversal",
  traversingMaterialization,
);

const launchAuthorizingPreflight = await readJson(
  "examples/schema/executor-preflight-receipt.json",
);
launchAuthorizingPreflight.launch_authorized = true;
expectInvalid(
  "executor-preflight-receipt.schema.json",
  "preflight receipt that authorizes launch",
  launchAuthorizingPreflight,
);

const mutableReferenceBuild = await readJson(
  "executor/cenetex-public-v1/build-contract.json",
);
mutableReferenceBuild.builder.mutable_dependency_resolution_allowed = true;
expectInvalid(
  "cenetex-reference-build-contract.schema.json",
  "reference build that allows mutable dependency resolution",
  mutableReferenceBuild,
);

const unknownConformanceClass = await readJson(
  "examples/schema/executor-conformance-suite.json",
);
unknownConformanceClass.tests[0].execution_class = "cloud_claim";
expectInvalid(
  "executor-conformance-suite.schema.json",
  "conformance suite with an unknown execution class",
  unknownConformanceClass,
);
inconsistentConformance.tests[0].status = "fail";
expectInvalid(
  "executor-conformance-report.schema.json",
  "passing conformance report with a failed test",
  inconsistentConformance,
);

const weakVerificationSummary = await readJson(
  "examples/schema/execution-verification-summary.json",
);
weakVerificationSummary.predicate.verifiedLevels = ["SLSA_BUILD_LEVEL_1"];
expectInvalid(
  "execution-verification-summary.schema.json",
  "verification summary without the ilXyr remote execution level",
  weakVerificationSummary,
);
executorAttestation.verified_key_ids = [];
expectInvalid(
  "executor-attestation.schema.json",
  "executor attestation without a verified key",
  executorAttestation,
);

const budget = await readJson("examples/schema/epoch-budget.json");
delete budget.per_executable_caps["/bin/echo"].network;
expectInvalid("epoch-budget.schema.json", "executable cap without network policy", budget);

const budgetWithoutArguments = await readJson("examples/schema/epoch-budget.json");
delete budgetWithoutArguments.per_executable_caps["/bin/echo"].allowed_argument_sets;
expectInvalid(
  "epoch-budget.schema.json",
  "executable cap without an argument allowlist",
  budgetWithoutArguments,
);

const sandboxSpec = await readJson("examples/schema/sandbox-spec.json");
sandboxSpec.authority.scope.seeds = [];
expectInvalid("sandbox-spec.schema.json", "sandbox authority without seeds", sandboxSpec);

const retro = await readJson("examples/schema/retro-registration.json");
retro.authority.level = "review";
expectInvalid(
  "retro-registration.schema.json",
  "retro-registration with review authority",
  retro,
);

const sharedTask = await readJson("examples/schema/shared-task.json");
sharedTask.family_bindings[1].family = "zero";
expectInvalid(
  "shared-task.schema.json",
  "shared task without both family bindings",
  sharedTask,
);

const executableSharedTask = await readJson(
  "examples/shared-tasks/zero-solomon-q22-operation-v1.json",
);
delete executableSharedTask.family_bindings[1].implementation;
expectInvalid(
  "shared-task-v2.schema.json",
  "executable shared task without a Solomon implementation snapshot",
  executableSharedTask,
);

const huggingFaceModel = await readJson(
  "examples/schema/huggingface-model.json",
);
huggingFaceModel.revision = "main";
expectInvalid(
  "huggingface-model.schema.json",
  "Hugging Face model with mutable revision",
  huggingFaceModel,
);

const labRegistry = await readJson("docs/lab-registry.json");
labRegistry.experiments.at(-1).state = "authorized";
labRegistry.experiments.at(-1).outcome = "pass";
expectInvalid(
  "lab-registry.schema.json",
  "authorized lab experiment with an outcome",
  labRegistry,
);

const pathwaysWithoutCoordinate = await readJson("docs/research-pathways.json");
delete pathwaysWithoutCoordinate.nodes[0].coordinate;
expectInvalid(
  "research-pathways.schema.json",
  "research pathway without an integer coordinate",
  pathwaysWithoutCoordinate,
);

const pathwaysWithDecimalCoordinate = await readJson("docs/research-pathways.json");
pathwaysWithDecimalCoordinate.nodes[0].coordinate.parts[0] = 2.2;
expectInvalid(
  "research-pathways.schema.json",
  "research pathway with a decimal coordinate",
  pathwaysWithDecimalCoordinate,
);

const pathwaysWithoutFactorVector = await readJson("docs/research-pathways.json");
delete pathwaysWithoutFactorVector.nodes[0].factor_state;
expectInvalid(
  "research-pathways.schema.json",
  "research pathway without a factor vector",
  pathwaysWithoutFactorVector,
);

const pathwaysWithZeroRevision = await readJson("docs/research-pathways.json");
pathwaysWithZeroRevision.nodes[0].record_revision = 0;
expectInvalid(
  "research-pathways.schema.json",
  "research pathway with a zero record revision",
  pathwaysWithZeroRevision,
);

const upstreamBenchmark = await readJson("examples/schema/upstream-benchmark.json");
delete upstreamBenchmark.outcome.resolved_outcome;
expectInvalid(
  "upstream-benchmark.schema.json",
  "upstream benchmark without an explicit outcome",
  upstreamBenchmark,
);

const transformersProfile = await readJson(
  "examples/feral-7b/transformers-calibration-profile.json",
);
transformersProfile.state = "frozen";
expectInvalid(
  "transformers-execution-profile.schema.json",
  "frozen Transformers profile with unresolved execution factors",
  transformersProfile,
);

const transformersProfileWithoutInitialEvaluation = await readJson(
  "examples/feral-7b/transformers-calibration-profile.json",
);
transformersProfileWithoutInitialEvaluation.trainer.eval_on_start = false;
expectInvalid(
  "transformers-execution-profile.schema.json",
  "Transformers profile without an initial evaluation",
  transformersProfileWithoutInitialEvaluation,
);

const representationAudit = await readJson(
  "examples/diagnostics/exp-008-representation-audit.json",
);
representationAudit.invariants.source_model_updates = true;
expectInvalid(
  "representation-audit.schema.json",
  "representation audit that updates the source model",
  representationAudit,
);

const prematurelyFrozenRepresentationAudit = await readJson(
  "examples/diagnostics/nsrl-p10m-representation-audit.json",
);
prematurelyFrozenRepresentationAudit.state = "frozen";
expectInvalid(
  "representation-audit.schema.json",
  "frozen representation audit with unresolved inputs",
  prematurelyFrozenRepresentationAudit,
);

const feralProfileRegistry = (await readJson("registry/research-registry.json"))
  .projects.find((project) => project.project_id === "project://ilxyr/feral-7b");
for (const profilePath of fixtures["transformers-execution-profile.schema.json"]) {
  const profileDigest = createHash("sha256")
    .update(await readFile(join(root, profilePath)))
    .digest("hex");
  const entries = feralProfileRegistry.artifacts.filter(
    (artifact) => artifact.uri?.endsWith(`/${profilePath}`),
  );
  if (
    entries.length !== 1 || entries[0].digest !== profileDigest ||
    entries[0].artifact_id !== `artifact://sha256/${profileDigest}`
  ) {
    throw new Error(`FERAL registry must bind ${profilePath} to ${profileDigest}`);
  }
}

const nsrlRegistration = await readJson(
  "examples/nsrl/p10m-v10-registration.json",
);
nsrlRegistration.checkpoint.source.commit = "main";
expectInvalid(
  "nsrl-registration.schema.json",
  "NSRL checkpoint with mutable source revision",
  nsrlRegistration,
);

const nsrlRegistrationWithoutContinuation = await readJson(
  "examples/nsrl/p10m-v10-registration.json",
);
delete nsrlRegistrationWithoutContinuation.continuation;
delete nsrlRegistrationWithoutContinuation.checkpoint.continuation_ref;
const validateNsrlRegistration = validators.get(
  "nsrl-registration.schema.json",
);
if (!validateNsrlRegistration(nsrlRegistrationWithoutContinuation)) {
  throw new Error(
    `NSRL registration without continuation failed nsrl-registration.schema.json: ${JSON.stringify(validateNsrlRegistration.errors)}`,
  );
}
positiveCount += 1;

const unpairedNsrlRegistration = await readJson(
  "examples/nsrl/p10m-v10-registration.json",
);
delete unpairedNsrlRegistration.continuation;
expectInvalid(
  "nsrl-registration.schema.json",
  "NSRL checkpoint continuation reference without continuation",
  unpairedNsrlRegistration,
);

const nsrlGate = await readJson(
  "examples/nsrl/p10m-v10-generation-gate.json",
);
nsrlGate.outcome = "unopened";
expectInvalid(
  "nsrl-gate-evidence.schema.json",
  "NSRL gate evidence with an unsettled outcome",
  nsrlGate,
);

const tournament = await readJson("examples/schema/mechanism-tournament.json");
delete tournament.decision_table[0].next_action;
expectInvalid(
  "mechanism-tournament.schema.json",
  "mechanism tournament decision without a next action",
  tournament,
);

const tournamentSettlement = await readJson(
  "examples/schema/mechanism-tournament-settlement.json",
);
tournamentSettlement.rival_scores[0].brier_score = 1.1;
expectInvalid(
  "mechanism-tournament-settlement.schema.json",
  "mechanism tournament settlement with invalid Brier score",
  tournamentSettlement,
);

const weightMultiplicityContract = await readJson(
  "examples/weight-multiplicity/rev3-contract.json",
);

const canonicalContractBytes = await readFile(
  join(root, weightMultiplicityContract.source_document.canonical_repository_path),
);
const canonicalContractDigest = createHash("sha256")
  .update(canonicalContractBytes)
  .digest("hex");
if (canonicalContractDigest !== weightMultiplicityContract.source_document.canonical_sha256) {
  throw new Error(
    `canonical weight-multiplicity contract digest is ${canonicalContractDigest}, expected ${weightMultiplicityContract.source_document.canonical_sha256}`,
  );
}

const wrongAcr2Order = structuredClone(weightMultiplicityContract);
wrongAcr2Order.gates.acr2.pass_per_mille.median_non_dominant = 950;
expectInvalid(
  "weight-multiplicity-program.schema.json",
  "weight-multiplicity contract with the old unreachable ACR-2 threshold",
  wrongAcr2Order,
);

const dominantOnlyTraining = structuredClone(weightMultiplicityContract);
dominantOnlyTraining.datasets.training_target_mix_per_mille = {
  dominant: 1000,
  non_dominant: 0,
};
expectInvalid(
  "weight-multiplicity-program.schema.json",
  "weight-multiplicity contract without non-dominant training inputs",
  dominantOnlyTraining,
);

const unboundedTail = structuredClone(weightMultiplicityContract);
unboundedTail.task.maximum_exact_label = 1024;
expectInvalid(
  "weight-multiplicity-program.schema.json",
  "weight-multiplicity contract with an unbounded decision tail",
  unboundedTail,
);

const rootAwareShortcut = structuredClone(weightMultiplicityContract);
rootAwareShortcut.models.shortcut.allowed_inputs.push("root_set");
expectInvalid(
  "weight-multiplicity-program.schema.json",
  "shortcut baseline that can read root data",
  rootAwareShortcut,
);

const prematureIntegrityStop = structuredClone(weightMultiplicityContract);
prematureIntegrityStop.gates.acr1.fixable_failure_policy = "stop";
expectInvalid(
  "weight-multiplicity-program.schema.json",
  "ACR-1 policy that stops before diagnosing a repairable integrity defect",
  prematureIntegrityStop,
);

const acceptedRecordFields = Object.entries(
  weightMultiplicityContract.datasets.accepted_records,
).filter(([name]) => name !== "total");
const acceptedRecordSum = acceptedRecordFields.reduce(
  (sum, [, count]) => sum + count,
  0,
);
if (acceptedRecordSum !== weightMultiplicityContract.datasets.accepted_records.total) {
  throw new Error(
    `weight-multiplicity accepted-record total is ${weightMultiplicityContract.datasets.accepted_records.total}, expected ${acceptedRecordSum}`,
  );
}

const acr1 = weightMultiplicityContract.gates.acr1;
if (acr1.root_queries + acr1.doubled_root_queries + acr1.zero_weight_queries !== acr1.total) {
  throw new Error("weight-multiplicity ACR-1 component counts do not match its total");
}

const stratumShare = weightMultiplicityContract.task.strata.reduce(
  (sum, stratum) => sum + stratum.share_per_mille,
  0,
);
if (stratumShare !== 1000) {
  throw new Error(`weight-multiplicity strata sum to ${stratumShare} per mille, expected 1000`);
}

const classical = weightMultiplicityContract.gates.classical_cross_rank;
const acr2Pass = weightMultiplicityContract.gates.acr2.pass_per_mille;
if (acr2Pass.median_non_dominant >= classical.pass_median_per_mille) {
  throw new Error("ACR-2 absolute median threshold must stay below classical cross-rank Pass");
}
if (
  classical.pass_median_per_mille - acr2Pass.maximum_dominant_drop <
  acr2Pass.median_non_dominant
) {
  throw new Error("ACR-2 degradation rule makes the classical Pass floor unreachable");
}

const frontierV2WithoutPredecessor = await readJson(
  "examples/weight-multiplicity/phase0-frontier-plan-v2.json",
);
delete frontierV2WithoutPredecessor.supersedes;
expectInvalid(
  "weight-multiplicity-frontier-plan.schema.json",
  "frontier generator v2 without sealed predecessor evidence",
  frontierV2WithoutPredecessor,
);

const frontierV1WithPredecessor = await readJson(
  "examples/weight-multiplicity/phase0-frontier-plan.json",
);
frontierV1WithPredecessor.supersedes = {
  plan_sha256: "0".repeat(64),
  result_sha256: "0".repeat(64),
  reason: "invalid retroactive predecessor",
};
expectInvalid(
  "weight-multiplicity-frontier-plan.schema.json",
  "frontier generator v1 with a retroactive predecessor",
  frontierV1WithPredecessor,
);

console.log(
  `Validated ${schemaNames.length} Draft 2020-12 schemas, ${positiveCount} positive fixtures, and ${rejectionCount} rejection fixtures.`,
);
