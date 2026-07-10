"use strict";

const { validateSchema, assertValid } = require("./validator.js");
const { BriefSchema, fromLegacyBrief } = require("./brief.schema.js");
const { SourceCandidateSchema, SourceCandidateListSchema } = require("./source-candidate.schema.js");
const { CoreItemSchema, CoreItemListSchema } = require("./core-item.schema.js");
const { SealedCoreSchema } = require("./sealed-core.schema.js");
const { CurriculumPlanSchema } = require("./curriculum-plan.schema.js");
const { DeliverableSchema } = require("./deliverable.schema.js");

module.exports = {
  validateSchema: validateSchema,
  assertValid: assertValid,
  BriefSchema: BriefSchema,
  fromLegacyBrief: fromLegacyBrief,
  SourceCandidateSchema: SourceCandidateSchema,
  SourceCandidateListSchema: SourceCandidateListSchema,
  CoreItemSchema: CoreItemSchema,
  CoreItemListSchema: CoreItemListSchema,
  SealedCoreSchema: SealedCoreSchema,
  CurriculumPlanSchema: CurriculumPlanSchema,
  DeliverableSchema: DeliverableSchema
};
