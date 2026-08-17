import json

import anthropic

from app.core.config import settings
from app.reference_data.service import list_reference_items

_MODEL = "claude-sonnet-5"

# RFC 3834 marks an automated response with `Auto-Submitted: auto-replied`
# (anything other than the default "no"); these subject phrasings catch the
# common auto-reply senders that don't bother setting the header at all.
_AUTO_REPLY_SUBJECT_MARKERS = ("automatic reply:", "out of office", "auto-reply:", "auto reply:")


class ClassificationResult:
    def __init__(
        self,
        *,
        should_create_case: bool,
        reason: str,
        customer: str = "",
        product: str = "",
        category: str = "",
        description: str = "",
        reporter_name: str = "",
        market: str = "",
    ) -> None:
        self.should_create_case = should_create_case
        self.reason = reason
        self.customer = customer
        self.product = product
        self.category = category
        self.description = description
        self.reporter_name = reporter_name
        self.market = market


def is_likely_auto_reply(subject: str, headers: list[dict]) -> bool:
    """Pre-LLM filter — an obvious auto-reply never reaches the Anthropic
    call at all, so an out-of-office storm doesn't cost one API call per
    message."""
    for header in headers or []:
        if header.get("name", "").lower() == "auto-submitted" and header.get("value", "").lower() != "no":
            return True
    subject_lower = (subject or "").lower()
    return any(marker in subject_lower for marker in _AUTO_REPLY_SUBJECT_MARKERS)


async def classify_email(*, subject: str, body_text: str, sender_email: str) -> ClassificationResult:
    """Asks Claude whether this email is an actionable support request and,
    if so, extracts the fields `create_case_from_email()` needs. Prompted
    with the *current* reference data — same reference-data-driven
    principle as category.allowed_reference_types/status.closes_case — so a
    category or product an admin adds today is usable immediately, no
    redeploy required. `should_create_case=False` is the safety net standing
    in for the human review queue this feature deliberately doesn't have."""
    categories = [i.value for i in await list_reference_items("category", True)]
    products = [i.value for i in await list_reference_items("product", True)]
    markets = [i.value for i in await list_reference_items("market", True)]

    prompt = f"""You triage inbound support emails for a case-tracking system.

Given the email below, decide whether it describes an actionable support
request that should become a case. Skip newsletters, calendar invites,
marketing, spam, and anything that isn't really a request for help.

Valid categories: {categories}
Valid products: {products}
Valid markets: {markets}

Email from: {sender_email}
Subject: {subject}
Body:
{body_text[:4000]}

Respond with ONLY a JSON object, no other text:
{{
  "should_create_case": true or false,
  "reason": "short reason, especially if false",
  "customer": "best guess at the customer/company name",
  "product": "one of the valid products, or best guess",
  "category": "one of the valid categories, or best guess",
  "description": "1-3 sentence clean summary of the issue",
  "reporter_name": "sender's display name if inferable, else empty",
  "market": "one of the valid markets if inferable, else empty"
}}"""

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    data = json.loads(response.content[0].text)
    return ClassificationResult(
        should_create_case=bool(data.get("should_create_case")),
        reason=data.get("reason", ""),
        customer=data.get("customer", ""),
        product=data.get("product", ""),
        category=data.get("category", ""),
        description=data.get("description", ""),
        reporter_name=data.get("reporter_name", ""),
        market=data.get("market", ""),
    )
