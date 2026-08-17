from bson import ObjectId
from beanie.operators import In

from app.auth.models import User
from app.auth.schemas import UserSummary


async def get_user_summaries(user_ids: set[ObjectId]) -> dict[ObjectId, UserSummary]:
    """Public surface other modules use to resolve user references into
    display-ready summaries — plan §11 (T11.4). Callers should call this
    instead of querying the `users` collection directly, so a future change
    to the `users` document shape only has to be reconciled here."""
    if not user_ids:
        return {}
    users = await User.find(In(User.id, list(user_ids))).to_list()
    return {u.id: UserSummary(id=u.id, name=u.name, email=u.email) for u in users}


async def list_all_user_summaries() -> list[UserSummary]:
    """Public surface for name-based user resolution (e.g. the Phase 13
    import's "Assigned To" column) — callers should not query the `users`
    collection directly, same rationale as `get_user_summaries()`."""
    users = await User.find_all().to_list()
    return [UserSummary(id=u.id, name=u.name, email=u.email) for u in users]


async def get_user_by_email(email: str) -> User | None:
    """Email-address lookup for a full `User` document — used by
    `app.email_agent` to resolve its configured service-account user
    (`settings.email_agent_service_user_email`), same "don't query `users`
    directly" rationale as the summary helpers above."""
    if not email:
        return None
    return await User.find_one(User.email == email)
