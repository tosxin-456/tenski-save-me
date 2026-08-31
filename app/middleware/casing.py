"""
Bridges the Python (snake_case) backend with the TypeScript (camelCase) frontend.

- Responses: every JSON body under /api has its keys converted snake_case -> camelCase.
- Requests: Pydantic request models inherit CamelModel, which accepts camelCase
  aliases (and still accepts snake_case, via populate_by_name).
"""
from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class CamelModel(BaseModel):
    """Base for request/response models: accept camelCase or snake_case input."""
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


def _snake_to_camel(s: str) -> str:
    if "_" not in s:
        return s
    head, *rest = s.split("_")
    return head + "".join(p[:1].upper() + p[1:] for p in rest)


def _camel_to_snake(s: str) -> str:
    out = []
    for ch in s:
        if ch.isupper():
            out.append("_" + ch.lower())
        else:
            out.append(ch)
    return "".join(out)


def normalize_keys_to_snake(d: dict) -> dict:
    """Accept a request dict with either camelCase or snake_case keys."""
    return {_camel_to_snake(k): v for k, v in d.items()}


def convert_keys_to_camel(obj):
    if isinstance(obj, dict):
        return {(_snake_to_camel(k) if isinstance(k, str) else k): convert_keys_to_camel(v)
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [convert_keys_to_camel(i) for i in obj]
    return obj


class CamelCaseResponseMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)

        # Only transform JSON responses on the API surface
        if not request.url.path.startswith("/api"):
            return response
        content_type = response.headers.get("content-type", "")
        if not content_type.startswith("application/json"):
            return response

        body = b""
        async for chunk in response.body_iterator:
            body += chunk

        try:
            data = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return Response(
                content=body, status_code=response.status_code,
                headers=dict(response.headers), media_type=content_type,
            )

        converted = convert_keys_to_camel(data)
        new_body = json.dumps(converted).encode("utf-8")

        headers = dict(response.headers)
        headers.pop("content-length", None)  # length changed
        return Response(
            content=new_body, status_code=response.status_code,
            headers=headers, media_type="application/json",
        )
