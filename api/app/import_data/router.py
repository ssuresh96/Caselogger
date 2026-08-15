from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import Response

from app.auth.dependencies import current_superuser
from app.auth.models import User
from app.import_data import service
from app.import_data.schemas import ImportResultOut

router = APIRouter(prefix="/admin/import/cases", tags=["import"])

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/template")
async def download_template(_admin: User = Depends(current_superuser)) -> Response:
    content = await service.build_template_workbook()
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="case-import-template.xlsx"'},
    )


@router.post("", response_model=ImportResultOut)
async def import_cases(
    file: UploadFile, admin: User = Depends(current_superuser)
) -> ImportResultOut:
    content = await file.read()
    return await service.parse_and_import(content, current_user_id=admin.id)
