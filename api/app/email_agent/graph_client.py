from datetime import datetime

import httpx

_TOKEN_URL_TEMPLATE = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_GRAPH_SCOPE = "https://graph.microsoft.com/.default"


class GraphClientError(RuntimeError):
    """Any non-2xx response from the token endpoint or Graph itself.
    `app.email_agent.service.run_poll()` catches this, records it as a
    ProcessedEmail "error" outcome, and stops the run — a bad token/mailbox
    should not be retried message-by-message."""


async def _get_access_token(client: httpx.AsyncClient, *, tenant_id: str, client_id: str, client_secret: str) -> str:
    """App-only (client credentials) auth — this runs unattended on a
    schedule, so there's no user session to delegate from."""
    resp = await client.post(
        _TOKEN_URL_TEMPLATE.format(tenant=tenant_id),
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": _GRAPH_SCOPE,
            "grant_type": "client_credentials",
        },
    )
    if resp.status_code != 200:
        raise GraphClientError(f"Graph token request failed: {resp.status_code} {resp.text}")
    return resp.json()["access_token"]


async def list_new_messages(
    since: datetime, *, tenant_id: str, client_id: str, client_secret: str, mailbox: str
) -> list[dict]:
    """Messages received after `since` in the configured shared mailbox,
    oldest first. A plain `$filter` rather than a delta query — v1's
    simpler choice per the plan: at a 5-10 minute poll interval the
    missed-message risk of filter-based catch-up is negligible, and it
    avoids delta-token/state management entirely.

    Credentials are passed in rather than read from global settings — they
    come from the admin-entered `email_agent_graph_settings` document (see
    `app.email_agent.graph_settings`), not a Render env var."""
    since_iso = since.strftime("%Y-%m-%dT%H:%M:%SZ")
    async with httpx.AsyncClient(timeout=30) as client:
        token = await _get_access_token(
            client, tenant_id=tenant_id, client_id=client_id, client_secret=client_secret
        )
        resp = await client.get(
            f"{_GRAPH_BASE}/users/{mailbox}/messages",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "$filter": f"receivedDateTime gt {since_iso}",
                "$orderby": "receivedDateTime asc",
                "$select": "id,conversationId,subject,from,receivedDateTime,body,internetMessageHeaders",
                "$top": 50,
            },
        )
    if resp.status_code != 200:
        raise GraphClientError(f"Graph list-messages failed: {resp.status_code} {resp.text}")
    return resp.json().get("value", [])
