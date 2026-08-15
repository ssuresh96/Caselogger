import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from app.auth.dependencies import current_active_user
from app.auth.models import User
from app.reports import service
from app.reports.schemas import MonthlyReportOut, TeamWorkloadRowOut

router = APIRouter(prefix="/reports", tags=["reports"])

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _validate_month(month: str) -> str:
    if not _MONTH_RE.match(month):
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "month must be in YYYY-MM format")
    return month


@router.get("/monthly", response_model=MonthlyReportOut)
async def monthly_report(
    month: str = Query(..., description="YYYY-MM"),
    _user: User = Depends(current_active_user),
) -> MonthlyReportOut:
    return await service.get_monthly_report(_validate_month(month))


@router.get("/team-workload", response_model=list[TeamWorkloadRowOut])
async def team_workload(
    month: str = Query(..., description="YYYY-MM"),
    _user: User = Depends(current_active_user),
) -> list[TeamWorkloadRowOut]:
    return await service.get_team_workload(_validate_month(month))
