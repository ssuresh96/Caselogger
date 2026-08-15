from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.auth.models import User
from app.core.config import settings

client: AsyncIOMotorClient = AsyncIOMotorClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)
database: AsyncIOMotorDatabase = client[settings.mongodb_db_name]


async def init_db() -> None:
    # Beanie only manages `users` (required by fastapi-users' Beanie adapter).
    # Every other collection (cases, reference_items, counters) is accessed
    # directly through Motor — see plan §1's "Data access" row.
    await init_beanie(database=database, document_models=[User])
