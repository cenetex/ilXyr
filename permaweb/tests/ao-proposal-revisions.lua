local owner = string.rep("A", 43)
local reviewer = string.rep("B", 43)
local secondReviewer = string.rep("C", 43)
local currentData = {}
local lastPayload, lastAction
local handlers = {}

package.preload["json"] = function()
  return {
    decode = function() return currentData end,
    encode = function(value) lastPayload = value; return "{}" end
  }
end
ao = { id = string.rep("P", 43), env = { Process = { Owner = owner } }, send = function() end }
Handlers = {
  utils = { hasMatchingTag = function() return function() return true end end },
  add = function(name, _, handler) handlers[name] = handler end
}
dofile(arg[1])

local nextId = 0
local function call(action, data, sender)
  nextId = nextId + 1
  currentData, lastPayload, lastAction = data, nil, nil
  local msg = { From = sender or owner, Id = string.format("%012d%031d", nextId, nextId),
    Timestamp = 1780000000000 + nextId, Data = "{}",
    reply = function(response) lastAction = response.Action end }
  handlers["ilxyr." .. action](msg)
  return lastPayload, lastAction, msg.Id
end

local function reject(action, data, sender, expected)
  local result, state = call(action, data, sender)
  assert(state == "Error" and string.find(result.error, expected, 1, true), action .. " accepted invalid transition")
end

local contract = {
  title = "Boundary experiment", summary = "Check a bounded model run",
  hypothesis = "The candidate exceeds the frozen baseline on the selected task.",
  family = "zero", baseline = "model://baseline", dataset = "dataset://frozen",
  metric = "accuracy", threshold = 0.5, seeds = { 1, 2 }, compute_credits = 10,
  evidence_level = "exact_check", export_policy = "artifacts", novelty = "A new candidate"
}
local function changed(field, value)
  local result = {}
  for key, item in pairs(contract) do result[key] = item end
  result[field] = value
  return result
end

local created, createdAction, firstRef = call("propose", contract)
assert(createdAction == "Propose-Result")
local list, listAction = call("list", {})
assert(listAction == "List-Result" and list.schema == "ilxyr.registry-state.v2" and list.version == 2)
local proposal = created.proposal
assert(proposal.revision == 1 and proposal.revision_message_id == firstRef)
assert(proposal.predecessor_ref == nil and #proposal.revisions == 1)
local id = proposal.id
reject("promote", { proposal_id = id }, owner, "required check")
reject("review", { proposal_id = id, revision = 1, proposal_ref = "stale", severity = "blocking", category = "methodology", comment = "Fix it" }, reviewer, "current proposal")
reject("review", { proposal_id = id, revision = 1, proposal_ref = firstRef, severity = "blocking", category = "methodology", comment = "Fix it" }, owner, "proposer cannot")
local reviewed, reviewAction = call("review", { proposal_id = id, revision = 1, proposal_ref = firstRef,
  severity = "blocking", category = "methodology", comment = "Fix the baseline" }, reviewer)
assert(reviewAction == "Review-Result" and reviewed.proposal.readiness.promotable == false)
local firstReview = reviewed.review_id
reject("resolve-review", { proposal_id = id, review_id = firstReview }, reviewer, "successor revision")
local successor = { proposal_id = id, review_id = firstReview, revision = 2,
  predecessor_ref = firstRef, response = "I changed the baseline", contract = changed("baseline", "model://new-baseline") }
reject("address-review", { proposal_id = id, review_id = firstReview, revision = 2,
  predecessor_ref = "stale", response = successor.response, contract = successor.contract }, owner, "exact predecessor")
reject("address-review", { proposal_id = id, review_id = firstReview, revision = 3,
  predecessor_ref = firstRef, response = successor.response, contract = successor.contract }, owner, "one revision")
reject("address-review", { proposal_id = id, review_id = firstReview, revision = 2,
  predecessor_ref = firstRef, response = successor.response, contract = contract }, owner, "change the contract")
local revised, revisionAction, secondRef = call("address-review", successor)
assert(revisionAction == "Address-Review-Result" and revised.proposal.revision == 2)
assert(revised.proposal.predecessor_ref == firstRef and revised.proposal.revision_message_id == secondRef)
assert(revised.proposal.reviews[1].proposal_ref == firstRef and revised.proposal.reviews[1].revision == 1)
assert(revised.proposal.readiness.promotable == false)
reject("promote", { proposal_id = id }, owner, "required check")
reject("review", { proposal_id = id, revision = 1, proposal_ref = firstRef,
  severity = "endorsement", category = "methodology", comment = "Old version" }, reviewer, "current proposal")
reject("address-review", successor, owner, "current proposal revision")
reject("resolve-review", { proposal_id = id, review_id = firstReview }, secondReviewer, "original reviewer")
assert(select(2, call("resolve-review", { proposal_id = id, review_id = firstReview }, reviewer)) == "Resolve-Review-Result")

local secondReview = select(1, call("review", { proposal_id = id, revision = 2, proposal_ref = secondRef,
  severity = "blocking", category = "methodology", comment = "Check the dataset" }, secondReviewer))
assert(secondReview.proposal.readiness.promotable == false)
local thirdContract = changed("baseline", "model://new-baseline")
thirdContract.dataset = "dataset://new-dataset"
local third, thirdAction, thirdRef = call("address-review", { proposal_id = id,
  review_id = secondReview.review_id, revision = 3, predecessor_ref = secondRef,
  response = "I changed the dataset", contract = thirdContract })
assert(thirdAction == "Address-Review-Result" and third.proposal.revision == 3)
assert(third.proposal.predecessor_ref == secondRef and third.proposal.readiness.promotable == false)
local finalReview, finalAction = call("review", { proposal_id = id, revision = 3,
  proposal_ref = thirdRef, severity = "endorsement", category = "methodology", comment = "Ready" }, reviewer)
assert(finalAction == "Review-Result" and finalReview.proposal.readiness.promotable)
local promoted, promoteAction = call("promote", { proposal_id = id })
assert(promoteAction == "Promote-Result" and promoted.proposal.status == "candidate")
assert(#promoted.proposal.reviews == 3 and #promoted.proposal.revisions == 3)
assert(promoted.proposal.frozen_proposal_ref == thirdRef and #promoted.proposal.frozen_review_refs == 1)
reject("address-review", { proposal_id = id, review_id = finalReview.review_id, revision = 4,
  predecessor_ref = thirdRef, response = "Another revision", contract = thirdContract }, owner, "locked")
io.write("ok")
