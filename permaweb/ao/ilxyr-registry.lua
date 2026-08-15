local json = require("json")

RegistryOwner = RegistryOwner or Owner or (ao.env and ao.env.Process and ao.env.Process.Owner)
assert(type(RegistryOwner) == "string" and #RegistryOwner == 43, "AO process owner is unavailable")
RegistrySchema = "ilxyr.registry-state.v1"
RegistryVersion = 1
Sequence = Sequence or 0
LatestIndexTx = LatestIndexTx or nil
Publishers = Publishers or { [RegistryOwner] = true }
Proposals = Proposals or {}
Evidence = Evidence or {}

local function now(msg)
  return tonumber(msg.Timestamp) or 0
end

local function decode(msg)
  local ok, value = pcall(json.decode, msg.Data or "{}")
  if not ok or type(value) ~= "table" then
    return nil, "Data must be a JSON object"
  end
  return value, nil
end

local function reply(msg, action, payload)
  local response = {
    Target = msg.From,
    Action = action,
    ["Data-Protocol"] = "ilxyr",
    Schema = "ilxyr.registry-response.v1",
    Data = json.encode(payload)
  }
  if msg.reply then
    msg.reply(response)
  else
    ao.send(response)
  end
end

local function fail(msg, message)
  reply(msg, "Error", { error = message })
end

local function isString(value, minimum)
  return type(value) == "string" and #value >= (minimum or 1)
end

local function isHandle(value)
  return isString(value) and string.match(value, "^[%a][%w+.-]*://%S+$") ~= nil
end

local function isTxId(value)
  return type(value) == "string" and #value == 43 and string.match(value, "^[%w_-]+$") ~= nil
end

local function isSeeds(value)
  if type(value) ~= "table" or #value == 0 then return false end
  local seen = {}
  for _, seed in ipairs(value) do
    if type(seed) ~= "number" or seed < 0 or seed ~= math.floor(seed) or seen[seed] then
      return false
    end
    seen[seed] = true
  end
  return true
end

local function sortedValues(map)
  local keys = {}
  for key, _ in pairs(map or {}) do table.insert(keys, key) end
  table.sort(keys)
  local values = {}
  for _, key in ipairs(keys) do table.insert(values, map[key]) end
  return values
end

local function reviewStats(proposal)
  local independent = 0
  local blocking = 0
  for _, review in pairs(proposal.reviews or {}) do
    if review.reviewer ~= proposal.owner then independent = independent + 1 end
    if review.severity == "blocking" and not review.resolved then blocking = blocking + 1 end
  end
  return independent, blocking
end

local function readiness(proposal)
  local independent, blocking = reviewStats(proposal)
  local checks = {
    { label = "Testable hypothesis", pass = isString(proposal.hypothesis, 24) },
    { label = "Baseline selected", pass = isHandle(proposal.baseline) },
    { label = "Dataset selected", pass = isHandle(proposal.dataset) },
    { label = "Outcome rule set", pass = isString(proposal.metric) and type(proposal.threshold) == "number" },
    { label = "Random seeds set", pass = isSeeds(proposal.seeds) },
    { label = "Compute limit set", pass = type(proposal.compute_credits) == "number" and proposal.compute_credits > 0 },
    { label = "Evidence type selected", pass = isString(proposal.evidence_level) },
    { label = "Independent review added", pass = independent > 0 },
    { label = "Required changes completed", pass = blocking == 0 }
  }
  local passed = 0
  for _, check in ipairs(checks) do if check.pass then passed = passed + 1 end end
  local score = math.floor((passed * 100 / #checks) + 0.5)
  return { checks = checks, score = score, promotable = passed == #checks and proposal.status ~= "blocked" }
end

local function proposalView(proposal)
  local result = {}
  for key, value in pairs(proposal) do
    if key ~= "reviews" and key ~= "forecasts" and key ~= "funding" then result[key] = value end
  end
  result.reviews = sortedValues(proposal.reviews)
  result.forecasts = sortedValues(proposal.forecasts)
  result.funding = sortedValues(proposal.funding)
  result.readiness = readiness(proposal)
  return result
end

local function stateView()
  local proposals = {}
  local ids = {}
  for id, _ in pairs(Proposals) do table.insert(ids, id) end
  table.sort(ids)
  for _, id in ipairs(ids) do table.insert(proposals, proposalView(Proposals[id])) end

  return {
    schema = RegistrySchema,
    process_id = ao.id,
    owner = RegistryOwner,
    sequence = Sequence,
    latest_index_tx = LatestIndexTx,
    proposals = proposals,
    evidence = sortedValues(Evidence)
  }
end

Handlers.add("ilxyr.info", Handlers.utils.hasMatchingTag("Action", "Info"), function(msg)
  reply(msg, "Info-Result", {
    schema = RegistrySchema,
    version = RegistryVersion,
    owner = RegistryOwner,
    process_id = ao.id,
    sequence = Sequence,
    latest_index_tx = LatestIndexTx
  })
end)

Handlers.add("ilxyr.list", Handlers.utils.hasMatchingTag("Action", "List"), function(msg)
  reply(msg, "List-Result", stateView())
end)

Handlers.add("ilxyr.get", Handlers.utils.hasMatchingTag("Action", "Get"), function(msg)
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  local proposal = Proposals[data.proposal_id]
  if not proposal then return fail(msg, "Proposal not found") end
  reply(msg, "Get-Result", proposalView(proposal))
end)

Handlers.add("ilxyr.propose", Handlers.utils.hasMatchingTag("Action", "Propose"), function(msg)
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  if not isString(data.title) or not isString(data.summary) or not isString(data.hypothesis, 24) then
    return fail(msg, "Title, summary, and a testable hypothesis are required")
  end
  if data.family ~= "zero" and data.family ~= "solomon" then return fail(msg, "Unknown model family") end
  if not isHandle(data.baseline) or not isHandle(data.dataset) then return fail(msg, "Baseline and dataset must be portable handles") end
  if not isString(data.metric) or type(data.threshold) ~= "number" then return fail(msg, "A numeric outcome threshold is required") end
  if not isSeeds(data.seeds) then return fail(msg, "At least one unique non-negative seed is required") end
  if type(data.compute_credits) ~= "number" or data.compute_credits <= 0 or data.compute_credits ~= math.floor(data.compute_credits) then
    return fail(msg, "Compute credits must be a positive integer")
  end
  if not isString(data.evidence_level) or not isString(data.export_policy) or not isString(data.novelty) then
    return fail(msg, "Evidence, export, and novelty declarations are required")
  end

  local id = "PROP-" .. string.upper(string.sub(msg.Id, 1, 12))
  if Proposals[id] then return fail(msg, "Proposal already exists") end
  Proposals[id] = {
    id = id,
    owner = msg.From,
    title = data.title,
    summary = data.summary,
    hypothesis = data.hypothesis,
    family = data.family,
    baseline = data.baseline,
    dataset = data.dataset,
    metric = data.metric,
    threshold = data.threshold,
    seeds = data.seeds,
    compute_credits = data.compute_credits,
    evidence_level = data.evidence_level,
    export_policy = data.export_policy,
    novelty = data.novelty,
    status = "review",
    created_at = now(msg),
    reviews = {},
    forecasts = {},
    funding = {}
  }
  reply(msg, "Propose-Result", { proposal = proposalView(Proposals[id]) })
end)

Handlers.add("ilxyr.review", Handlers.utils.hasMatchingTag("Action", "Review"), function(msg)
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  local proposal = Proposals[data.proposal_id]
  if not proposal then return fail(msg, "Proposal not found") end
  if proposal.status ~= "review" then return fail(msg, "This proposal is locked. You cannot add a review") end
  if msg.From == proposal.owner then return fail(msg, "A proposer cannot review their own contract") end
  local severities = { advisory = true, blocking = true, endorsement = true }
  if not severities[data.severity] or not isString(data.category) or not isString(data.comment) then
    return fail(msg, "Category, severity, and feedback are required")
  end
  local id = "REV-" .. string.upper(string.sub(msg.Id, 1, 12))
  proposal.reviews[id] = {
    id = id,
    reviewer = msg.From,
    category = data.category,
    severity = data.severity,
    comment = data.comment,
    addressed = false,
    resolved = false,
    created_at = now(msg)
  }
  reply(msg, "Review-Result", { proposal = proposalView(proposal), review_id = id })
end)

Handlers.add("ilxyr.address-review", Handlers.utils.hasMatchingTag("Action", "Address-Review"), function(msg)
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  local proposal = Proposals[data.proposal_id]
  local review = proposal and proposal.reviews[data.review_id]
  if not review then return fail(msg, "Review not found") end
  if msg.From ~= proposal.owner then return fail(msg, "Only the proposer can mark feedback addressed") end
  if proposal.status ~= "review" then return fail(msg, "This proposal is locked") end
  review.addressed = true
  review.response = data.response or "Addressed in the current draft"
  reply(msg, "Address-Review-Result", { proposal = proposalView(proposal) })
end)

Handlers.add("ilxyr.resolve-review", Handlers.utils.hasMatchingTag("Action", "Resolve-Review"), function(msg)
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  local proposal = Proposals[data.proposal_id]
  local review = proposal and proposal.reviews[data.review_id]
  if not review then return fail(msg, "Review not found") end
  if msg.From ~= review.reviewer then return fail(msg, "Only the original reviewer can resolve this feedback") end
  if review.severity == "blocking" and not review.addressed then return fail(msg, "Blocking feedback must be addressed before resolution") end
  if proposal.status ~= "review" then return fail(msg, "This proposal is locked") end
  review.resolved = true
  review.resolved_at = now(msg)
  reply(msg, "Resolve-Review-Result", { proposal = proposalView(proposal) })
end)

Handlers.add("ilxyr.promote", Handlers.utils.hasMatchingTag("Action", "Promote"), function(msg)
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  local proposal = Proposals[data.proposal_id]
  if not proposal then return fail(msg, "Proposal not found") end
  if msg.From ~= proposal.owner then return fail(msg, "Only the proposer can promote and lock this proposal") end
  if proposal.status ~= "review" then return fail(msg, "Proposal is not open for promotion") end
  local status = readiness(proposal)
  if not status.promotable then return fail(msg, "Every required check must pass before promotion") end
  proposal.status = "candidate"
  proposal.frozen_at = now(msg)
  proposal.frozen_by_message = msg.Id
  reply(msg, "Promote-Result", { proposal = proposalView(proposal) })
end)

Handlers.add("ilxyr.forecast", Handlers.utils.hasMatchingTag("Action", "Forecast"), function(msg)
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  local proposal = Proposals[data.proposal_id]
  if not proposal or proposal.status ~= "candidate" then return fail(msg, "You can forecast only after the proposal becomes a candidate") end
  if msg.From == proposal.owner then return fail(msg, "The proposer cannot forecast their own experiment") end
  if type(data.probability) ~= "number" or data.probability < 0 or data.probability > 1 then return fail(msg, "Probability must be between zero and one") end
  if type(data.stake) ~= "number" or data.stake <= 0 or data.stake ~= math.floor(data.stake) or not isString(data.rationale) then
    return fail(msg, "A positive integer stake and rationale are required")
  end
  if proposal.forecasts[msg.From] then return fail(msg, "One forecast is allowed per identity") end
  proposal.forecasts[msg.From] = { forecaster = msg.From, probability = data.probability, stake = data.stake, rationale = data.rationale, created_at = now(msg) }
  reply(msg, "Forecast-Result", { proposal = proposalView(proposal) })
end)

Handlers.add("ilxyr.fund", Handlers.utils.hasMatchingTag("Action", "Fund"), function(msg)
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  local proposal = Proposals[data.proposal_id]
  if not proposal or proposal.status ~= "candidate" then return fail(msg, "You can fund only after the proposal becomes a candidate") end
  if type(data.compute_credits) ~= "number" or data.compute_credits <= 0 or data.compute_credits ~= math.floor(data.compute_credits) or not isString(data.rationale) then
    return fail(msg, "A positive integer credit commitment and rationale are required")
  end
  proposal.funding[msg.From] = { funder = msg.From, compute_credits = data.compute_credits, rationale = data.rationale, created_at = now(msg) }
  reply(msg, "Fund-Result", { proposal = proposalView(proposal) })
end)

Handlers.add("ilxyr.publish-evidence", Handlers.utils.hasMatchingTag("Action", "Publish-Evidence"), function(msg)
  if not Publishers[msg.From] then return fail(msg, "Only an approved publisher can add evidence") end
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  if not isString(data.experiment_id) or not isTxId(data.bundle_tx) or not isString(data.evidence_ref) or not isString(data.outcome) then
    return fail(msg, "Experiment identity, bundle transaction, evidence reference, and outcome are required")
  end
  if Evidence[data.experiment_id] then return fail(msg, "This experiment already has evidence. It cannot be replaced") end
  Evidence[data.experiment_id] = {
    txId = data.bundle_tx,
    owner = msg.From,
    trusted = true,
    experimentId = data.experiment_id,
    evidenceRef = data.evidence_ref,
    title = data.title or data.experiment_id,
    outcome = data.outcome,
    family = data.family,
    files = {},
    source = "ao",
    published_at = now(msg)
  }
  reply(msg, "Publish-Evidence-Result", { evidence = Evidence[data.experiment_id] })
end)

Handlers.add("ilxyr.set-publisher", Handlers.utils.hasMatchingTag("Action", "Set-Publisher"), function(msg)
  if msg.From ~= RegistryOwner then return fail(msg, "Only the registry owner can make this change") end
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  if not isString(data.address) or type(data.enabled) ~= "boolean" then return fail(msg, "Address and enabled flag are required") end
  Publishers[data.address] = data.enabled or nil
  reply(msg, "Set-Publisher-Result", { address = data.address, enabled = data.enabled })
end)

Handlers.add("ilxyr.set-index", Handlers.utils.hasMatchingTag("Action", "Set-Index-Tx"), function(msg)
  if msg.From ~= RegistryOwner then return fail(msg, "Only the registry owner can make this change") end
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  if not isTxId(data.index_tx) then return fail(msg, "A valid Arweave index transaction is required") end
  if type(data.sequence) ~= "number" or data.sequence ~= Sequence + 1 then return fail(msg, "Index sequence must advance by exactly one") end
  LatestIndexTx = data.index_tx
  Sequence = data.sequence
  reply(msg, "Set-Index-Tx-Result", { index_tx = LatestIndexTx, sequence = Sequence })
end)

Handlers.add("ilxyr.index-snapshot", Handlers.utils.hasMatchingTag("Action", "Index-Snapshot"), function(msg)
  local data, err = decode(msg)
  if err then return fail(msg, err) end
  if not isString(data.generated_at) then return fail(msg, "A generated_at timestamp is required") end
  local entries = {}
  local keys = {}
  for experimentId, _ in pairs(Evidence) do table.insert(keys, experimentId) end
  table.sort(keys)
  for _, experimentId in ipairs(keys) do
    local item = Evidence[experimentId]
    table.insert(entries, {
      experiment_id = item.experimentId,
      bundle_tx = item.txId,
      evidence_ref = item.evidenceRef,
      outcome = item.outcome,
      title = item.title,
      owner = item.owner,
      family = item.family
    })
  end
  reply(msg, "Index-Snapshot-Result", {
    schema = "ilxyr.index.v1",
    sequence = Sequence + 1,
    previous_index_tx = LatestIndexTx,
    ledger_head = data.ledger_head or "",
    published_by = "arweave://" .. RegistryOwner,
    generated_at = data.generated_at,
    experiments = entries
  })
end)
