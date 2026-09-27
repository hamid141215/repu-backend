import os
import json
import hmac
import urllib.request
import urllib.error

HUMAIN_URL = "https://api.node.humain.com/v1/chat/completions"
MODEL = "humain-m3-preview"

class HumainStructuredOutputError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "content-type": "application/json"
        },
        "body": json.dumps(
            body,
            ensure_ascii=False
        )
    }

def unwrap_full_content_code_fence(
    content
):
    opening = None

    for candidate in (
        "```json\r\n",
        "```json\n",
        "```\r\n",
        "```\n",
    ):
        if content.startswith(candidate):
            opening = candidate
            break

    if opening is None:
        return None

    fenced = content[len(opening):]

    if fenced.endswith("\r\n```"):
        inner = fenced[:-5]
    elif fenced.endswith("\n```"):
        inner = fenced[:-4]
    else:
        return None

    if "```" in inner:
        return None

    return inner


def extract_structured_output(
    content
):
    if not isinstance(content, str):
        raise HumainStructuredOutputError(
            "HUMAIN_STRUCTURED_OUTPUT_PARSE_FAILED"
        )

    trimmed = content.strip()

    try:
        parsed = json.loads(trimmed)
    except (TypeError, ValueError):
        fenced = unwrap_full_content_code_fence(
            trimmed
        )

        if fenced is None:
            raise HumainStructuredOutputError(
                "HUMAIN_STRUCTURED_OUTPUT_PARSE_FAILED"
            )

        try:
            parsed = json.loads(fenced)
        except (TypeError, ValueError):
            raise HumainStructuredOutputError(
                "HUMAIN_STRUCTURED_OUTPUT_PARSE_FAILED"
            )

    if not isinstance(parsed, dict):
        raise HumainStructuredOutputError(
            "HUMAIN_STRUCTURED_OUTPUT_INVALID_TYPE"
        )

    if not parsed:
        raise HumainStructuredOutputError(
            "HUMAIN_EMPTY_STRUCTURED_OUTPUT"
        )

    return parsed

def call_humain(humain_key, messages):
    request_body = json.dumps(
        {
            "model": MODEL,
            "messages": messages,
            "temperature": 0,
            "stream": False
        },
        ensure_ascii=False
    ).encode("utf-8")

    req = urllib.request.Request(
        HUMAIN_URL,
        data=request_body,
        method="POST",
        headers={
            "Authorization":
                f"Bearer {humain_key}",

            "x-api-key":
                humain_key,

            "accept":
                "application/json",

            "content-type":
                "application/json",

            "User-Agent":
                "repu-humain-gateway/1.0"
        }
    )

    try:
        with urllib.request.urlopen(
            req,
            timeout=16
        ) as upstream:
            raw = upstream.read()

            upstream_payload = json.loads(
                raw.decode(
                    "utf-8",
                    errors="strict"
                )
            )

    except urllib.error.HTTPError as exc:
        print(json.dumps({
            "event":
                "humain_upstream_error",

            "status":
                exc.code
        }))

        raise

    choices = (
        upstream_payload.get("choices")
        if isinstance(upstream_payload, dict)
        else None
    )

    first_choice = (
        choices[0]
        if isinstance(choices, list)
        and choices
        and isinstance(choices[0], dict)
        else {}
    )

    message = first_choice.get("message")

    content = (
        message.get("content")
        if isinstance(message, dict)
        else None
    )

    return extract_structured_output(
        content
    )


def lambda_handler(event, context):
    expected_gateway_key = os.environ.get(
        "REPU_AI_GATEWAY_KEY",
        ""
    )

    humain_key = os.environ.get(
        "HUMAIN_NODE_API_KEY",
        ""
    )

    headers = event.get(
        "headers"
    ) or {}

    supplied_gateway_key = (
        headers.get(
            "x-repu-ai-key"
        )
        or headers.get(
            "X-Repu-AI-Key"
        )
        or ""
    )

    if (
        not expected_gateway_key
        or not supplied_gateway_key
        or not hmac.compare_digest(
            supplied_gateway_key,
            expected_gateway_key
        )
    ):
        return response(
            401,
            {
                "error":
                    "UNAUTHORIZED"
            }
        )

    if not humain_key:
        return response(
            500,
            {
                "error":
                    "HUMAIN_KEY_MISSING"
            }
        )

    try:
        raw_body = (
            event.get("body")
            or "{}"
        )

        if event.get(
            "isBase64Encoded"
        ):
            import base64

            raw_body = (
                base64.b64decode(
                    raw_body
                ).decode("utf-8")
            )

        payload = json.loads(
            raw_body
        )

    except Exception:
        return response(
            400,
            {
                "error":
                    "INVALID_JSON"
            }
        )

    messages = payload.get(
        "messages"
    )

    if (
        not isinstance(
            messages,
            list
        )
        or not messages
    ):
        return response(
            400,
            {
                "error":
                    "MESSAGES_REQUIRED"
            }
        )

    try:
        data = call_humain(
            humain_key,
            messages
        )
    except HumainStructuredOutputError as exc:
        return response(
            502,
            {
                "error": exc.code
            }
        )
    except urllib.error.HTTPError as exc:
        return response(
            502,
            {
                "error":
                    "HUMAIN_HTTP_ERROR",

                "upstream_status":
                    exc.code
            }
        )
    except Exception:
        return response(
            502,
            {
                "error":
                    "HUMAIN_REQUEST_FAILED"
            }
        )

    return response(
        200,
        {
            "provider":
                "humain",

            "model":
                MODEL,

            "data":
                data
        }
    )
