from app.common.camel import CamelModel


class MixRow(CamelModel):
    label: str
    cases: int
    share: float  # percentage, 0-100


class MonthlyReportOut(CamelModel):
    month: str  # "YYYY-MM"
    total_cases: int
    aos_cases: int
    aos_share: float
    pending: int
    close_rate: float
    impl_closed: int
    deactivations: int
    pending_pct: float
    category_mix: list[MixRow]
    product_mix: list[MixRow]


class TeamWorkloadRowOut(CamelModel):
    member: str
    assigned: int
    closed: int
    pending: int
    close_rate: float
