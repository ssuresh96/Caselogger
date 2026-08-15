from fastapi_users import FastAPIUsers
from fastapi_users_db_beanie import PydanticObjectId

from app.auth.backend import auth_backend
from app.auth.manager import get_user_manager
from app.auth.models import User

fastapi_users = FastAPIUsers[User, PydanticObjectId](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)
