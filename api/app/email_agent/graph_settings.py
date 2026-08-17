from datetime import UTC, datetime

from bson import ObjectId

from app.core.database import database
from app.email_agent.schemas import GraphSettingsOut, GraphSettingsUpdate

graph_settings_collection = database["email_agent_graph_settings"]

_DOC_ID = "settings"


async def get_graph_settings_doc() -> dict | None:
    """Raw document, secret included — internal use only
    (`app.email_agent.service`/`graph_client`). Never expose this directly
    over the API; use `get_graph_settings_out()` for that."""
    return await graph_settings_collection.find_one({"_id": _DOC_ID})


async def get_graph_settings_out() -> GraphSettingsOut:
    doc = await get_graph_settings_doc() or {}
    return GraphSettingsOut(
        tenantId=doc.get("tenant_id", ""),
        clientId=doc.get("client_id", ""),
        hasClientSecret=bool(doc.get("client_secret")),
        mailbox=doc.get("mailbox", ""),
        updatedAt=doc.get("updated_at"),
    )


async def update_graph_settings(payload: GraphSettingsUpdate, current_user_id: ObjectId) -> GraphSettingsOut:
    """Admin-entered Microsoft Graph credentials — plan: email-to-case
    (frontend-managed, not a Render env var). `client_secret` is
    write-only: an omitted or blank value leaves whatever's already stored
    untouched, so re-saving the tenant/client ID doesn't force re-entering
    the secret every time, and `GraphSettingsOut` never echoes it back."""
    updates = payload.model_dump(exclude_unset=True, by_alias=False)
    if not updates.get("client_secret"):
        updates.pop("client_secret", None)
    updates["updated_at"] = datetime.now(UTC)
    updates["updated_by"] = current_user_id
    await graph_settings_collection.update_one({"_id": _DOC_ID}, {"$set": updates}, upsert=True)
    return await get_graph_settings_out()
