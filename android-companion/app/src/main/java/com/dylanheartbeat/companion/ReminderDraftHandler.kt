package com.dylanheartbeat.companion

import java.util.UUID

data class ReminderDraft(
    val draftId: String,
    val title: String,
    val time: String,
)

interface ReminderDraftHandler {
    fun create(title: String, time: String): ReminderDraft
}

class InMemoryReminderDraftHandler(
    private val idFactory: () -> String = { UUID.randomUUID().toString() },
) : ReminderDraftHandler {
    private val drafts = mutableMapOf<String, ReminderDraft>()

    override fun create(title: String, time: String): ReminderDraft {
        val draftId = idFactory()
        require(draftId.isNotBlank() && draftId !in drafts)
        return ReminderDraft(draftId = draftId, title = title, time = time).also {
            drafts[draftId] = it
        }
    }

    fun get(draftId: String): ReminderDraft? = drafts[draftId]?.copy()
}
