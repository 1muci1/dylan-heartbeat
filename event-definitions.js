"use strict";

const EVENT_DEFINITIONS = Object.freeze({
  "chat.turn_completed": Object.freeze({
    category: "chat",
    allowedSources: Object.freeze(["chat-session-persistence", "gateway"])
  }),
  "memory.created": Object.freeze({
    category: "memory",
    allowedSources: Object.freeze(["structured-memory-store", "memory-api", "memory-seed", "memory-candidate", "memory-admin", "memory-import-runtime"])
  }),
  "memory.updated": Object.freeze({
    category: "memory",
    allowedSources: Object.freeze(["structured-memory-store", "memory-api", "memory-admin"])
  }),
  "memory.deleted": Object.freeze({
    category: "memory",
    allowedSources: Object.freeze(["structured-memory-store", "memory-api", "memory-admin"])
  }),
  "memory.restored": Object.freeze({
    category: "memory",
    allowedSources: Object.freeze(["structured-memory-store", "memory-api", "memory-admin"])
  }),
  "memory_candidate.created": Object.freeze({
    category: "memory",
    allowedSources: Object.freeze(["memory-candidate"])
  }),
  "memory_candidate.approved": Object.freeze({
    category: "memory",
    allowedSources: Object.freeze(["memory-candidate"])
  }),
  "memory_candidate.rejected": Object.freeze({
    category: "memory",
    allowedSources: Object.freeze(["memory-candidate"])
  }),
  "ai_job.queued": Object.freeze({
    category: "ai_job",
    allowedSources: Object.freeze(["ai-memory-store", "ai-task-runner"])
  }),
  "ai_job.proactive_queued": Object.freeze({
    category: "ai_job",
    allowedSources: Object.freeze(["ai-memory-store"])
  }),
  "ai_job.completed": Object.freeze({
    category: "ai_job",
    allowedSources: Object.freeze(["ai-task-runner"])
  }),
  "ai_job.failed": Object.freeze({
    category: "ai_job",
    allowedSources: Object.freeze(["ai-task-runner"])
  }),
  "ai_job.cancelled": Object.freeze({
    category: "ai_job",
    allowedSources: Object.freeze(["ai-memory-store", "ai-task-runner"])
  }),
  "delivery.created": Object.freeze({
    category: "delivery",
    allowedSources: Object.freeze(["proactive-delivery-worker"])
  }),
  "delivery.sent": Object.freeze({
    category: "delivery",
    allowedSources: Object.freeze(["proactive-delivery-worker"])
  }),
  "delivery.failed": Object.freeze({
    category: "delivery",
    allowedSources: Object.freeze(["proactive-delivery-worker"])
  }),
  "delivery.retry_scheduled": Object.freeze({
    category: "delivery",
    allowedSources: Object.freeze(["proactive-delivery-worker"])
  }),
  "preference.changed": Object.freeze({
    category: "preference",
    allowedSources: Object.freeze(["proactive-settings-api"])
  }),
  "proactive.feedback_received": Object.freeze({
    category: "proactive",
    allowedSources: Object.freeze(["proactive-feedback-store"])
  }),
  "mood_selected": Object.freeze({
    category: "game",
    allowedSources: Object.freeze(["game-event-service"])
  }),
  "mini_game_completed": Object.freeze({
    category: "game",
    allowedSources: Object.freeze(["game-event-service"])
  }),
  "game_result": Object.freeze({
    category: "game",
    allowedSources: Object.freeze(["game-event-service"])
  }),
  "room_interaction": Object.freeze({
    category: "game",
    allowedSources: Object.freeze(["game-event-service"])
  }),
  "tool.requested": Object.freeze({
    category: "tool",
    allowedSources: Object.freeze(["tool-audit-store"])
  }),
  "tool.approved": Object.freeze({
    category: "tool",
    allowedSources: Object.freeze(["tool-audit-store"])
  }),
  "tool.completed": Object.freeze({
    category: "tool",
    allowedSources: Object.freeze(["tool-audit-store"])
  }),
  "tool.failed": Object.freeze({
    category: "tool",
    allowedSources: Object.freeze(["tool-audit-store"])
  }),
  "theme_asset.uploaded": Object.freeze({
    category: "theme_asset",
    allowedSources: Object.freeze(["theme-asset-store"])
  }),
  "theme_asset.localized": Object.freeze({
    category: "theme_asset",
    allowedSources: Object.freeze(["theme-asset-store"])
  }),
  "theme_asset.renamed": Object.freeze({
    category: "theme_asset",
    allowedSources: Object.freeze(["theme-asset-store"])
  }),
  "theme_asset.deleted": Object.freeze({
    category: "theme_asset",
    allowedSources: Object.freeze(["theme-asset-store"])
  }),
  "theme_asset.favorite_changed": Object.freeze({
    category: "theme_asset",
    allowedSources: Object.freeze(["theme-asset-store"])
  }),
  "theme_asset.tags_changed": Object.freeze({
    category: "theme_asset",
    allowedSources: Object.freeze(["theme-asset-store"])
  }),
  "theme_asset.note_changed": Object.freeze({
    category: "theme_asset",
    allowedSources: Object.freeze(["theme-asset-store"])
  }),
  "theme_asset.restored": Object.freeze({
    category: "theme_asset",
    allowedSources: Object.freeze(["theme-asset-store"])
  }),
  "theme_preset.created": Object.freeze({
    category: "theme_preset",
    allowedSources: Object.freeze(["theme-preset-store"])
  }),
  "theme_preset.updated": Object.freeze({
    category: "theme_preset",
    allowedSources: Object.freeze(["theme-preset-store"])
  }),
  "theme_preset.deleted": Object.freeze({
    category: "theme_preset",
    allowedSources: Object.freeze(["theme-preset-store"])
  }),
  "theme_preset.applied": Object.freeze({
    category: "theme_preset",
    allowedSources: Object.freeze(["theme-preset-store"])
  })
});

module.exports = { EVENT_DEFINITIONS };
