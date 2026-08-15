from app.common.camel import CamelModel


class ImportRowError(CamelModel):
    """One rejected row from an uploaded import file — plan §13/T13.6."""

    row: int
    reason: str


class ImportResultOut(CamelModel):
    total_rows: int
    imported: int
    rejected: list[ImportRowError]
