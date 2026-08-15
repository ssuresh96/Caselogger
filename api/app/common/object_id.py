from typing import Annotated, Any

from bson import ObjectId
from pydantic import GetCoreSchemaHandler
from pydantic_core import core_schema


class _ObjectIdPydanticAnnotation:
    """Lets bson.ObjectId be used as a Pydantic v2 field type — accepts a real
    ObjectId or a valid 24-char hex string, always (de)serializes to a string
    on the API boundary."""

    @classmethod
    def __get_pydantic_core_schema__(
        cls, _source_type: Any, _handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        def validate(value: Any) -> ObjectId:
            if isinstance(value, ObjectId):
                return value
            if isinstance(value, str) and ObjectId.is_valid(value):
                return ObjectId(value)
            raise ValueError(f"Invalid ObjectId: {value!r}")

        return core_schema.json_or_python_schema(
            json_schema=core_schema.no_info_plain_validator_function(validate),
            python_schema=core_schema.no_info_plain_validator_function(validate),
            # `when_used="json"` matters: without it this also fires during
            # plain `model_dump()` (python mode), which is what
            # `update_case()` uses to build the Mongo `$set` doc — that
            # silently wrote `assigned_to` etc. back as strings instead of
            # real ObjectIds, breaking the population lookup on every
            # subsequent read (found via the case-detail inline-edit
            # feature actually exercising a PATCH with `assignedTo` for the
            # first time). `create_case()` was unaffected since it reads
            # `payload.assigned_to` directly rather than via `model_dump()`.
            serialization=core_schema.plain_serializer_function_ser_schema(str, when_used="json"),
        )

    @classmethod
    def __get_pydantic_json_schema__(cls, _schema, handler):
        return {"type": "string"}


PyObjectId = Annotated[ObjectId, _ObjectIdPydanticAnnotation]
