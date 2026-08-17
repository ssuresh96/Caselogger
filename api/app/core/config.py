from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "case_logger"

    jwt_secret: str = "CHANGE_ME_IN_ENV"
    jwt_lifetime_seconds: int = 60 * 60 * 12  # 12h — see plan §2/§7 re: no refresh tokens yet

    cors_origins: list[str] = ["http://localhost:4300"]

    # Email agent (plan: email-to-case) — all optional so the app still
    # boots with the feature simply disabled (see app/email_agent/service.py)
    # until these are set. Microsoft Graph credentials are NOT here — those
    # are admin-entered via /admin/email-agent/graph-settings and stored in
    # Mongo (app/email_agent/graph_settings.py), not a Render env var.
    anthropic_api_key: str = ""
    email_agent_internal_token: str = ""  # shared secret for POST /internal/email-agent/run
    # A pre-created user (via POST /users, e.g. "email-agent@caselogger.internal")
    # attributed as the actor for every automated create/comment — this is who
    # shows up in the Activity Timeline for cases the agent touches, distinct
    # from any real person's account.
    email_agent_service_user_email: str = ""


settings = Settings()
