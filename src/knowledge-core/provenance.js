"use strict";

function assertCoreItemIds(sealedCore, ids) {
  const known = Object.create(null);
  sealedCore.items.forEach(function (item) { known[item.id] = true; });
  const missing = (ids || []).filter(function (id) { return !known[id]; });
  if (missing.length) {
    const error = new Error("Renderer referenced facts outside the sealed Knowledge Core: " + missing.join(", "));
    error.code = "PROVENANCE_MISS";
    throw error;
  }
}

function provenanceMap(refPrefix, ids) {
  return (ids || []).map(function (id, index) {
    return { artifact_ref: refPrefix + "-" + (index + 1), core_item_id: id };
  });
}

module.exports = { assertCoreItemIds: assertCoreItemIds, provenanceMap: provenanceMap };
