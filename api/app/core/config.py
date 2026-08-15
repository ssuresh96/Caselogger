from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "case_logger"

    jwt_secret: str = "CHANGE_ME_IN_ENV"
    jwt_lifetime_seconds: int = 60 * 60 * 12  # 12h — see plan §2/§7 re: no refresh tokens yet

    cors_origins: list[str] = ["http://localhost:4300"]


settings = Settings()
