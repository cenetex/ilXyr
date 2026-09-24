local owner = string.rep("A", 43)
local currentData = {}
local lastPayload = nil
local lastAction = nil
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
  local msg = { From = sender or owner, Id = string.format("%043d", nextId),
    Timestamp = 1780000000000, Data = "{}",
    reply = function(response) lastAction = response.Action end }
  handlers["ilxyr." .. action](msg)
  return lastPayload, lastAction
end

local ref = "artifact://sha256/" .. string.rep("c", 64)
local valid = { experiment_id = "test.experiment", bundle_tx = string.rep("B", 43),
  evidence_ref = ref, outcome = "no_go", title = "Test result", family = "zero" }

local function reject(action, data, expected)
  local result, state = call(action, data)
  assert(state == "Error" and string.find(result.error, expected, 1, true), action .. " accepted invalid input")
end

local function changed(key, value)
  local copy = {}
  for name, item in pairs(valid) do copy[name] = item end
  copy[key] = value
  return copy
end

reject("publish-evidence", changed("evidence_ref", "artifact://sha256/" .. string.rep("C", 64)), "required")
reject("publish-evidence", changed("evidence_ref", "artifact://sha256/short"), "required")
reject("publish-evidence", changed("outcome", "bad result"), "required")
reject("publish-evidence", changed("experiment_id", "../bad"), "required")
reject("publish-evidence", changed("title", string.rep("t", 501)), "required")
reject("publish-evidence", changed("family", string.rep("f", 101)), "required")
assert(select(2, call("publish-evidence", valid)) == "Publish-Evidence-Result")
reject("publish-evidence", valid, "already has evidence")

reject("index-snapshot", { generated_at = "2026-09-24T00:00:00.000Z" }, "current index transaction")
assert(select(2, call("set-index", { index_tx = string.rep("I", 43), sequence = 1 })) == "Set-Index-Tx-Result")
reject("index-snapshot", { generated_at = "not-a-date" }, "timestamp")
reject("index-snapshot", { generated_at = "2026-02-30T00:00:00Z" }, "timestamp")
reject("index-snapshot", { generated_at = "2026-09-24T00:00:00Z", ledger_head = "bad" }, "Ledger head")
local snapshot, action = call("index-snapshot", {
  generated_at = "2026-09-24T00:00:00.000Z", ledger_head = ref
})
assert(action == "Index-Snapshot-Result")
assert(snapshot.sequence == 2 and snapshot.previous_index_tx == string.rep("I", 43))
assert(#snapshot.experiments == 1 and snapshot.experiments[1].evidence_ref == ref)
local withoutHead, plainAction = call("index-snapshot", { generated_at = "2026-09-24T00:00:00Z" })
assert(plainAction == "Index-Snapshot-Result" and withoutHead.ledger_head == "")

local function encode(value)
  if type(value) == "string" then return string.format("%q", value) end
  if type(value) == "number" or type(value) == "boolean" then return tostring(value) end
  if type(value) == "table" then
    local parts = {}
    if #value > 0 then
      for _, item in ipairs(value) do table.insert(parts, encode(item)) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for key, item in pairs(value) do table.insert(parts, encode(key) .. ":" .. encode(item)) end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  error("unsupported snapshot value")
end
io.write(encode({ snapshot, withoutHead }))
