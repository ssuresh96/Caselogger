from pydantic import BaseModel, ConfigDict


def to_camel(field_name: str) -> str:
    first, *rest = field_name.split("_")
    return first + "".join(word.capitalize() for word in rest)


class CamelModel(BaseModel):
    """Base for API-facing schemas — Python stays snake_case, the wire
    format is camelCase to match the Angular models."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
