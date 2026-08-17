from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi import status as http_status
from fastapi.responses import Response

from app.auth.dependencies import current_superuser
from app.auth.models import User
from app.import_data import service
from app.import_data.schemas import ImportResultOut

router = APIRouter(prefix="/admin/import/cases", tags=["import"])

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
# Security audit L-2 — the upload was previously read into memory with no
# cap at all; admin-gated already, this is defense-in-depth against memory
# exhaustion from an oversized file. 20MB comfortably covers any real
# case-import spreadsheet.
MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024


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
    if file.size is not None and file.size > MAX_IMPORT_FILE_BYTES:
        raise HTTPException(
            http_status.HTTP_413_CONTENT_TOO_LARGE,
            f"File too large — max {MAX_IMPORT_FILE_BYTES // (1024 * 1024)}MB.",
        )
    content = await file.read(MAX_IMPORT_FILE_BYTES + 1)
    if len(content) > MAX_IMPORT_FILE_BYTES:
        raise HTTPException(
            http_status.HTTP_413_CONTENT_TOO_LARGE,
            f"File too large — max {MAX_IMPORT_FILE_BYTES // (1024 * 1024)}MB.",
        )
    return await service.parse_and_import(content, current_user_id=admin.id)
