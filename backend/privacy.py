"""Privacy core — the heart of the agent.

detect -> classify -> decide -> pseudonymize -> remap

Everything in this module is deterministic and runs locally. It makes no network
calls, so raw values can never leave the machine from here. The CrewAI agents in
crew.py wrap these functions as tools; the FastAPI layer in main.py never touches
raw text except through this module.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import Any, Callable, Iterable

# ---------------------------------------------------------------------------
# 1. Entity taxonomy — type -> (risk, action, human label)
# ---------------------------------------------------------------------------
# Actions come straight from the Decision Engine in the architecture diagram:
#   PSEUDONYMIZE  swap for a realistic, consistent fake (semantics preserved)
#   MASK          redact entirely — too dangerous to fake
#   ALLOW         keep as-is, the analysis needs it (percentages, durations)

DEFAULT_TAXONOMY: dict[str, tuple[str, str, str]] = {
    "RRN":        ("HIGH",   "MASK",         "resident registration number"),
    "CARD":       ("HIGH",   "MASK",         "payment card number"),
    "ACCOUNT":    ("HIGH",   "PSEUDONYMIZE", "bank account number"),
    "IBAN":       ("HIGH",   "PSEUDONYMIZE", "IBAN"),
    "BIZNO":      ("HIGH",   "PSEUDONYMIZE", "business registration number"),
    "PROJECT":    ("HIGH",   "PSEUDONYMIZE", "internal project codename"),
    "API_KEY":    ("HIGH",   "MASK",         "API keys and cloud access keys"),
    "ACCESS_TOKEN": ("HIGH", "MASK",         "access tokens, bearer tokens, and session tokens"),
    "DATABASE_PASSWORD": ("HIGH", "MASK",    "database passwords and connection credentials"),
    "INTERNAL_SERVER": ("HIGH", "PSEUDONYMIZE", "private IP addresses and internal server hostnames"),
    "CLOUD_ACCOUNT_ID": ("HIGH", "PSEUDONYMIZE", "cloud account, tenant, subscription, and project identifiers"),
    "MONEY":      ("LOW",    "ALLOW",        "monetary amounts and contract values"),
    "DATE":       ("LOW",    "ALLOW",        "calendar dates and contractual deadlines"),
    "PHONE":      ("MEDIUM", "PSEUDONYMIZE", "phone number"),
    "EMAIL":      ("MEDIUM", "PSEUDONYMIZE", "employee and contact email addresses"),
    "PERSON":     ("MEDIUM", "PSEUDONYMIZE", "named individual"),
    "ORG":        ("MEDIUM", "PSEUDONYMIZE", "organization"),
    "BANK":       ("MEDIUM", "PSEUDONYMIZE", "bank name"),
    "ADDRESS":    ("MEDIUM", "PSEUDONYMIZE", "postal address"),
}
TAXONOMY = DEFAULT_TAXONOMY.copy()
BUILTIN_TYPES = frozenset(TAXONOMY)
CUSTOM_TYPES: dict[str, dict[str, str]] = {}
_ACTIONS = {"PSEUDONYMIZED": "PSEUDONYMIZE", "KEEP": "ALLOW", "REMOVED": "MASK"}


def _type_item(name: str) -> dict[str, Any]:
    risk, action, description = TAXONOMY[name]
    source = "DEFAULT" if name in BUILTIN_TYPES else "CUSTOM"
    original = DEFAULT_TAXONOMY.get(name)
    return {
        "name": name, "description": description, "status": status_for(action), "source": source,
        "modified": bool(original and TAXONOMY[name] != original),
        "originalStatus": status_for(original[1]) if original else None,
    }


def list_types() -> list[dict[str, Any]]:
    return [_type_item(name) for name in TAXONOMY]


def add_custom_type(name: str, description: str, status: str) -> dict[str, str]:
    name = name.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,31}", name):
        raise ValueError("Tag must be 2-32 characters using A-Z, 0-9, or underscore.")
    if name in BUILTIN_TYPES:
        raise ValueError("Built-in tags cannot be replaced.")
    if name in CUSTOM_TYPES:
        raise ValueError("Tag already exists. Select it in the table to update it.")
    if status not in _ACTIONS:
        raise ValueError("Status must be PSEUDONYMIZED, KEEP, or REMOVED.")
    item = {"name": name, "description": description.strip() or name.lower().replace("_", " "), "status": status}
    CUSTOM_TYPES[name] = item
    TAXONOMY[name] = ("HIGH", _ACTIONS[status], item["description"])
    return _type_item(name)


def update_type(name: str, description: str, status: str) -> dict[str, Any]:
    name = name.strip().upper()
    if name not in TAXONOMY:
        raise ValueError("Unknown NER tag.")
    if status not in _ACTIONS:
        raise ValueError("Status must be PSEUDONYMIZED, KEEP, or REMOVED.")
    description = description.strip() or name.lower().replace("_", " ")
    TAXONOMY[name] = (TAXONOMY[name][0], _ACTIONS[status], description)
    if name in CUSTOM_TYPES:
        CUSTOM_TYPES[name] = {"name": name, "description": description, "status": status}
    return _type_item(name)


def reset_builtin_type(name: str) -> dict[str, Any]:
    name = name.strip().upper()
    if name not in BUILTIN_TYPES:
        raise ValueError("Only default NER tags can be reset.")
    TAXONOMY[name] = DEFAULT_TAXONOMY[name]
    return _type_item(name)


def remove_custom_type(name: str) -> bool:
    name = name.upper()
    removed = CUSTOM_TYPES.pop(name, None) is not None
    if removed:
        TAXONOMY.pop(name, None)
    return removed


def risk_for(etype: str) -> str:
    return TAXONOMY.get(etype, ("LOW", "ALLOW", etype))[0]


def action_for(etype: str) -> str:
    return TAXONOMY.get(etype, ("LOW", "ALLOW", etype))[1]


def status_for(action: str) -> str:
    return {"PSEUDONYMIZE": "PSEUDONYMIZED", "ALLOW": "KEEP", "MASK": "REMOVED"}[action]


def label_for(etype: str) -> str:
    return TAXONOMY.get(etype, ("LOW", "ALLOW", etype))[2]


# ---------------------------------------------------------------------------
# 2. Detection — rule-based, Korean + English contract patterns
# ---------------------------------------------------------------------------
# Order matters: the first pattern to claim a span wins, so the specific ones
# (BIZNO 000-00-00000) come before the general ones (ACCOUNT 000-000-000000).

_SURNAMES = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노정하곽성차주우구민류나진지엄채원천방공현함변염양변여추도소석선설마길연위표명기반왕금옥육인맹제모장남탁국여진"

_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("RRN",        re.compile(r"\b\d{6}-[1-4]\d{6}\b")),
    ("API_KEY",    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("API_KEY",    re.compile(r"(?:api[_ -]?key|secret[_ -]?key)\s*[:=]\s*['\"]?([A-Za-z0-9_./+=-]{16,})", re.IGNORECASE)),
    ("ACCESS_TOKEN", re.compile(r"(?:access[_ -]?token|bearer)\s*[:=]?\s*['\"]?([A-Za-z0-9_./+=-]{16,})", re.IGNORECASE)),
    ("DATABASE_PASSWORD", re.compile(r"(?:db|database)[_ -]?(?:password|passwd|pwd)\s*[:=]\s*['\"]?([^\s'\"]{8,})", re.IGNORECASE)),
    ("INTERNAL_SERVER", re.compile(r"\b((?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})|(?:[A-Za-z0-9-]+\.)+(?:internal|local))\b", re.IGNORECASE)),
    ("CLOUD_ACCOUNT_ID", re.compile(r"(?:cloud[_ -]?account(?:[_ -]?id)?|aws[_ -]?account(?:[_ -]?id)?|tenant[_ -]?id|subscription[_ -]?id|project[_ -]?id)\s*[:=]\s*['\"]?([A-Za-z0-9-]{6,})", re.IGNORECASE)),
    ("MONEY",      re.compile(r"(?<!\w)(?:[$€£₩]\s?\d[\d,]*(?:\.\d+)?|(?:USD|EUR|GBP|KRW)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|KRW|원))(?!\w)", re.IGNORECASE)),
    ("DATE",       re.compile(r"\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b")),
    ("DATE",       re.compile(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+(?:19|20)\d{2}\b", re.IGNORECASE)),
    # IBAN before CARD: an IBAN's digit groups otherwise look like a card number.
    ("IBAN",       re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\b")),
    ("CARD",       re.compile(r"(?<![\w-])(?:\d{4}[-\s]){3}\d{4}(?![\w-])")),
    ("BIZNO",      re.compile(r"\b\d{3}-\d{2}-\d{5}\b")),
    ("PHONE",      re.compile(r"\b0(?:1[016789]|2|[3-6]\d)-\d{3,4}-\d{4}\b")),
    ("ACCOUNT",    re.compile(r"\b\d{2,4}-\d{2,6}-\d{4,8}\b")),
    ("EMAIL",      re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+[\w]")),
    ("PROJECT",    re.compile(r"(?:Project|프로젝트)\s+[A-Z][A-Za-z0-9]{2,}")),
    ("BANK",       re.compile(r"[가-힣]{2,8}은행")),
    ("BANK",       re.compile(r"\b(?:[A-Z][A-Za-z]+\s){1,3}Bank\b")),
    ("ORG",        re.compile(r"[가-힣A-Za-z][가-힣A-Za-z0-9]{1,14}\s?주식회사|주식회사\s?[가-힣A-Za-z0-9]{2,15}|㈜\s?[가-힣A-Za-z0-9]{2,15}")),
    ("ORG",        re.compile(r"\b(?:[A-Z][A-Za-z0-9]+\s){1,3}(?:Co\.,?\s?Ltd\.?|Ltd\.?|Inc\.?|Corp\.?|LLC|AB|GmbH)")),
    ("ADDRESS",    re.compile(
        r"(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시"
        r"|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)"
        r"[^\n,()]{2,40}?\d+")),
    # Person names only fire in an explicit person context, so ordinary Korean
    # words never get swapped out by accident.
    # The colon is required — without it "담당자 정보" reads "정보" as a surname+name.
    ("PERSON",     re.compile(rf"(?:담당자|예금주|대표이사|성명|이름|성함)\s*[::]\s*([{_SURNAMES}][가-힣]{{1,3}})")),
    ("PERSON",     re.compile(rf"\b([{_SURNAMES}][가-힣]{{1,3}})\s*\(\s*서명\s*\)")),
    ("PERSON",     re.compile(rf"\b([{_SURNAMES}][가-힣]{{1,3}})\s*/\s*[가-힣]+팀")),
    ("PERSON",     re.compile(r"(?:Representative|Contact|Attn|Signed by|Buyer contact|Supplier contact)"
                              r"\s*:?\s*([A-Z][a-z]+\s[A-Z][a-z]+)")),
    ("PERSON",     re.compile(r"\b([A-Z][a-z]+\s[A-Z][a-z]+)(?=,?\s(?:CPA|Esq|PhD|MD|Manager|Director|"
                              r"Team Lead|CEO|CFO|Partner)\b)")),
]

# Never treat these as organizations/names even if a pattern matches.
_STOPWORDS = {"주식회사", "귀사", "당사", "본 계약", "제3자"}


@dataclass
class Entity:
    """One detected value and everything the pipeline decided about it."""
    type: str
    real: str
    fake: str = ""
    risk: str = ""
    action: str = ""
    reason: str = ""
    count: int = 1

    def public(self) -> dict[str, Any]:
        value = asdict(self)
        value.pop("risk")
        value["status"] = status_for(self.action)
        return value


def detect(text: str) -> list[Entity]:
    """Find sensitive values. Returns unique entities, longest-match-first safe."""
    claimed: list[tuple[int, int]] = []
    found: list[tuple[int, str, str]] = []

    def overlaps(a: int, b: int) -> bool:
        return any(a < end and b > start for start, end in claimed)

    for etype, pattern in _PATTERNS:
        for m in pattern.finditer(text):
            # Use group 1 when the pattern anchors on surrounding context.
            value = (m.group(1) if m.groups() else m.group(0)).strip()
            start = m.start(1) if m.groups() else m.start(0)
            end = start + len(value)
            if not value or value in _STOPWORDS or overlaps(start, end):
                continue
            claimed.append((start, end))
            found.append((start, etype, value))

    # Collapse duplicates, keeping first-seen order and counting occurrences.
    uniq: dict[tuple[str, str], Entity] = {}
    for _, etype, value in sorted(found):
        key = (etype, value)
        if key in uniq:
            uniq[key].count += 1
        else:
            uniq[key] = Entity(type=etype, real=value)

    # Count every literal occurrence, not just the ones a pattern matched.
    for ent in uniq.values():
        ent.count = max(ent.count, text.count(ent.real))
    return list(uniq.values())


def classify(entities: Iterable[Entity]) -> list[Entity]:
    """Risk-assess each entity and pick a handling action (Decision Engine)."""
    out = []
    for e in entities:
        e.risk = risk_for(e.type)
        e.action = action_for(e.type)
        if e.action == "MASK":
            e.reason = f"{label_for(e.type)} — no safe fake exists, redacting entirely"
        elif e.risk == "HIGH":
            e.reason = f"{label_for(e.type)} — high exposure, replacing with a consistent fake"
        else:
            e.reason = f"{label_for(e.type)} — replacing with a realistic placeholder"
        out.append(e)
    return out


# ---------------------------------------------------------------------------
# 3. Pseudonymization — deterministic, semantic-preserving
# ---------------------------------------------------------------------------
_FAKE_ORG_KO = ["대성전자", "누리테크", "한빛솔루션", "세종메탈", "청우산업", "다온전자", "예람테크", "우리컴포넌츠"]
_FAKE_ORG_EN = ["Halcyon Trading", "Northgate Systems", "Ridgeline Industries", "Solvane Data", "Kestrel Components"]
_FAKE_SURNAME = ["강", "윤", "임", "노", "표", "차", "구", "천"]
_FAKE_GIVEN = ["서준", "하윤", "도경", "예린", "지후", "채원", "민재", "수아"]
_FAKE_BANK = ["새한은행", "동방은행", "청림은행", "대양은행"]
_FAKE_BANK_EN = ["Ridgeline National Bank", "Northgate Savings Bank", "Fairhaven Commercial Bank", "Kestrel Union Bank"]
_FAKE_ADDR = ["서울특별시 중구 세종대로 110", "경기도 수원시 영통구 광교로 145", "부산광역시 해운대구 센텀로 60"]
_FAKE_CODENAME = ["Redwood", "Skylark", "Ironbark", "Meridian", "Nightjar"]
_FAKE_DOMAINS = ["example-demo.co.kr", "relaymail.io", "northgate.net"]


def _h(value: str, salt: str = "") -> int:
    return int(hashlib.sha256((salt + value).encode("utf-8")).hexdigest()[:12], 16)


def _pick(pool: list[str], value: str, salt: str = "") -> str:
    return pool[_h(value, salt) % len(pool)]


def _pick_unique(pool: list[str], value: str, salt: str, used: set[str]) -> str:
    """Like _pick, but never hands the same alias to two different originals —
    two companies mapping to one fake name would silently merge them."""
    start = _h(value, salt) % len(pool)
    for offset in range(len(pool)):
        candidate = pool[(start + offset) % len(pool)]
        if candidate not in used:
            used.add(candidate)
            return candidate
    candidate = f"{pool[start]} {len(used) + 1}"
    used.add(candidate)
    return candidate


def _digits_like(value: str, seed: int) -> str:
    """Same shape, different digits — keeps format validation happy."""
    out, x = [], seed or 7
    for ch in value:
        if ch.isdigit():
            x = (x * 1103515245 + 12345) & 0xFFFFFFFF
            out.append(str(x % 10))
        else:
            out.append(ch)
    return "".join(out)


def _identifier_like(value: str, seed: int) -> str:
    """Change letters and digits while preserving separators and character case."""
    out, x = [], seed or 7
    for ch in value:
        if ch.isalnum():
            x = (x * 1103515245 + 12345) & 0xFFFFFFFF
            alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if ch.isupper() else "abcdefghijklmnopqrstuvwxyz"
            out.append(str(x % 10) if ch.isdigit() else alphabet[x % len(alphabet)])
        else:
            out.append(ch)
    return "".join(out)


def _internal_server_like(value: str, seed: int) -> str:
    if re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", value):
        parts = value.split(".")
        keep = 2 if parts[:2] == ["192", "168"] or parts[0] == "172" else 1
        return ".".join(parts[:keep] + [str(1 + (seed >> i * 8) % 254)
                                       for i in range(len(parts) - keep)])
    name, dot, suffix = value.rpartition(".")
    return f"{_identifier_like(name, seed)}{dot}{suffix}"


def _money_like(value: str, seed: int) -> str:
    """Change an amount while preserving its currency text and numeric shape."""
    if not re.search(r"\d", value):
        amount = 100_000 + seed % 9_900_000
        if re.search(r"원|KRW", value, re.IGNORECASE):
            return f"{amount:,}원"
        if re.search(r"€|EUR|euros?", value, re.IGNORECASE):
            return f"€{amount:,}"
        if re.search(r"£|GBP|pounds?", value, re.IGNORECASE):
            return f"£{amount:,}"
        return f"${amount:,}" if re.search(r"\$|USD|dollars?", value, re.IGNORECASE) else f"{amount:,}"

    chars = list(_digits_like(value, seed))
    first = next(i for i, char in enumerate(chars) if char.isdigit())
    chars[first] = str(1 + seed % 9)
    fake = "".join(chars)
    if fake == value:
        last = max(i for i, char in enumerate(chars) if char.isdigit())
        chars[last] = str((int(chars[last]) + 1) % 10)
        fake = "".join(chars)
    return fake


def _date_like(value: str, seed: int) -> str:
    """Shift a date while preserving its numeric or English display format."""
    shifted_days = 7 + seed % 358
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%B %d, %Y", "%B %d %Y",
                "%b %d, %Y", "%b %d %Y"):
        try:
            changed = datetime.strptime(value, fmt) + timedelta(days=shifted_days)
        except ValueError:
            continue
        rendered = changed.strftime(fmt)
        if re.search(r"\b\d,?\s+\d{4}$", value):
            rendered = re.sub(r"\b0(\d)(,?\s+\d{4})$", r"\1\2", rendered)
        return rendered
    return f"[DATE-{1 + seed % 9999:04d}]"


def pseudonymize(entities: list[Entity], seed: str) -> list[Entity]:
    """Assign every entity its fake counterpart. Deterministic for a given seed."""
    used: dict[str, set[str]] = {k: set() for k in ("ORG", "PERSON", "BANK", "ADDRESS", "PROJECT")}

    for e in entities:
        t, v = e.type, e.real
        if e.action == "MASK":
            e.fake = f"[REDACTED-{t}]"
        elif e.action == "ALLOW":
            e.fake = v
        elif t == "MONEY":
            e.fake = _money_like(v, _h(v, seed))
        elif t == "DATE":
            e.fake = _date_like(v, _h(v, seed))
        elif t == "PHONE":
            # Keep the carrier/area prefix — it is a format marker, not an identity.
            head, _, tail = v.partition("-")
            e.fake = f"{head}-{_digits_like(tail, _h(v, seed))}"
        elif t in ("ACCOUNT", "BIZNO", "CARD", "IBAN", "RRN"):
            e.fake = _digits_like(v, _h(v, seed))
        elif t == "INTERNAL_SERVER":
            e.fake = _internal_server_like(v, _h(v, seed))
        elif t == "CLOUD_ACCOUNT_ID":
            e.fake = _identifier_like(v, _h(v, seed))
        elif t == "BANK":
            pool = _FAKE_BANK if re.search(r"[가-힣]", v) else _FAKE_BANK_EN
            e.fake = _pick_unique(pool, v, seed, used["BANK"])
        elif t == "ADDRESS":
            e.fake = _pick_unique(_FAKE_ADDR, v, seed, used["ADDRESS"])
        elif t == "PROJECT":
            # "Project Falcon" -> keep the generic label, swap only the codename:
            # "Project Skylark". But a bare single-token code ("ME-2026-SUP-0813",
            # no spaces) has no separate label to keep — v.split()[0] would be the
            # ENTIRE original value, so the "fake" would still contain the real
            # codename as a literal prefix. Replace those wholesale instead.
            words = v.split()
            if len(words) > 1:
                e.fake = f"{words[0]} {_pick_unique(_FAKE_CODENAME, v, seed, used['PROJECT'])}"
            else:
                e.fake = _pick_unique(_FAKE_CODENAME, v, seed, used["PROJECT"])
        elif t == "PERSON":
            if re.search(r"[가-힣]", v):
                given = _pick(_FAKE_GIVEN, v, seed + "g")
                e.fake = _pick_unique([s + given for s in _FAKE_SURNAME], v, seed, used["PERSON"])
            else:
                first = _pick(["Marcus", "Elena", "Priya", "Jonas", "Nora"], v, seed)
                e.fake = _pick_unique([f"{first} {s}" for s in ["Webb", "Nathan", "Berg", "Cole", "Reyes"]],
                                      v, seed + "g", used["PERSON"])
        elif t == "ORG":
            suffix = "주식회사" if "주식회사" in v else ("㈜" if "㈜" in v else "")
            if suffix:
                alias = _pick_unique(_FAKE_ORG_KO, v, seed, used["ORG"])
                e.fake = f"{alias} {suffix}" if v.strip().endswith(suffix) else f"{suffix} {alias}"
            else:
                alias = _pick_unique(_FAKE_ORG_EN, v, seed, used["ORG"])
                tail = re.search(r"(Co\.,?\s?Ltd\.?|Ltd\.?|Inc\.?|Corp\.?|LLC|AB|GmbH)\s*$", v)
                e.fake = f"{alias} {tail[0]}" if tail else alias
        elif t == "EMAIL":
            local = v.partition("@")[0]
            e.fake = f"{_pick(['contact', 'billing', 'office', 'sales'], local, seed)}" \
                     f"{1000 + _h(v, seed) % 9000}@{_pick(_FAKE_DOMAINS, v, seed)}"
        else:
            e.fake = f"[{t}]"
    return entities


# ---------------------------------------------------------------------------
# 4. Apply / remap
# ---------------------------------------------------------------------------

def apply_mask(text: str, entities: list[Entity]) -> str:
    """Replace real -> fake. Longest first so substrings can't corrupt a longer match."""
    masked = text
    for e in sorted(entities, key=lambda x: len(x.real), reverse=True):
        masked = masked.replace(e.real, e.fake)
    return masked


def remap(text: str, entities: list[Entity]) -> tuple[str, int]:
    """Swap fake -> real on a response that came back from an external model."""
    result, replaced = text, 0
    for e in sorted(entities, key=lambda x: len(x.fake), reverse=True):
        if not e.fake or e.action == "MASK":
            continue
        hits = result.count(e.fake)
        if hits:
            result = result.replace(e.fake, e.real)
            replaced += hits
    return result, replaced


# ---------------------------------------------------------------------------
# 5. Session store — ephemeral mapping + audit log
# ---------------------------------------------------------------------------

@dataclass
class Document:
    uid: str
    name: str
    markdown: str = ""            # raw markdown, never leaves this process
    masked_markdown: str = ""     # the only text allowed to go outside
    entities: list[Entity] = field(default_factory=list)
    trace: list[dict[str, Any]] = field(default_factory=list)
    sensitivity: dict[str, Any] = field(default_factory=dict)
    verification: list[dict[str, Any]] = field(default_factory=list)
    status: str = "queued"
    source: str = ""
    audit: list[dict[str, Any]] = field(default_factory=list)

    def log(self, event: str, **detail: Any) -> None:
        self.audit.append({
            "at": datetime.now().isoformat(timespec="seconds"),
            "event": event,
            **detail,
        })

    def public(self, include_raw: bool = False) -> dict[str, Any]:
        """What the browser is allowed to see."""
        data = {
            "uid": self.uid,
            "name": self.name,
            "status": self.status,
            "source": self.source,
            "entities": [e.public() for e in self.entities],
            "trace": self.trace,
            "sensitivity": self.sensitivity,
            "verification": self.verification,
            "masked_markdown": self.masked_markdown,
            "audit": self.audit,
        }
        if include_raw:
            data["markdown"] = self.markdown
        return data


class Store:
    """In-memory, process-scoped. Nothing is persisted to disk by design."""

    def __init__(self) -> None:
        self._docs: dict[str, Document] = {}

    def put(self, doc: Document) -> Document:
        self._docs[doc.uid] = doc
        return doc

    def get(self, uid: str) -> Document | None:
        return self._docs.get(uid)

    def many(self, uids: Iterable[str]) -> list[Document]:
        return [d for uid in uids if (d := self._docs.get(uid))]

    def all(self) -> list[Document]:
        return list(self._docs.values())

    def drop(self, uid: str) -> None:
        self._docs.pop(uid, None)


STORE = Store()


# ---------------------------------------------------------------------------
# 6. The whole pipeline in one call (used by crew.py tools and as fallback)
# ---------------------------------------------------------------------------

def sensitivity_score(markdown: str, entities: Iterable[Entity]) -> dict[str, Any]:
    """How sensitive IS this document — before anything is touched.

    `percent` is the share of the document's characters that some detected value
    covers (each entity's length x how many times it occurs), capped at 100. It's
    a simple, literal reading of "how much of this is sensitive" — not a judgment
    call about severity. Public counts describe what will happen to each value.
    """
    entities = list(entities)
    total = len(markdown) or 1
    covered = sum(len(e.real) * e.count for e in entities)
    return {
        "percent": round(min(100.0, covered / total * 100), 1),
        "pseudonymized": sum(1 for e in entities if e.action == "PSEUDONYMIZE"),
        "keep": sum(1 for e in entities if e.action == "ALLOW"),
        "removed": sum(1 for e in entities if e.action == "MASK"),
        "total_values": len(entities),
    }


def scan_pipeline(markdown: str, on_step: Callable[[dict], None] | None = None,
                  detected_entities: Iterable[Entity] | None = None) -> dict[str, Any]:
    """Detect -> classify. Read-only: finds and risk-rates values, changes nothing.

    This is the "how sensitive is this document" pass — safe to run automatically
    on upload, since it never touches the text and produces no masked output.
    """
    steps: list[dict[str, Any]] = []

    def step(stage: str, agent: str, text: str, detail: Any = None) -> None:
        item = {
            "stage": stage,
            "agent": agent,
            "text": text,
            "detail": detail or [],
            "engine": "deterministic",
            "model": None,
        }
        steps.append(item)
        if on_step:
            on_step(item)

    # CrewAI may supply locally detected semantic entities in addition to regex
    # matches. Rebuild clean Entity objects so classification does not mutate
    # the crew's shared context while assembling the public trace.
    entities = ([Entity(type=e.type, real=e.real, count=e.count) for e in detected_entities]
                if detected_entities is not None else detect(markdown))
    step("detect", "Sensitive Information Detector",
         f"Scanned {len(markdown):,} characters — found {len(entities)} sensitive values "
         f"across {len({e.type for e in entities})} categories.",
         [{"type": e.type, "value": e.real, "count": e.count} for e in entities])

    entities = classify(entities)
    score = sensitivity_score(markdown, entities)
    step("classify", "Risk Assessment & Decision Engine",
         f"{score['percent']}% of this document is sensitive — "
         f"{score['pseudonymized']} to pseudonymize, {score['keep']} to keep, "
         f"and {score['removed']} to remove. Nothing has been "
         f"changed yet.",
         [{"type": e.type, "value": e.real, "status": status_for(e.action), "reason": e.reason}
          for e in entities])

    return {"entities": entities, "sensitivity": score, "trace": steps}


def mask_pipeline(markdown: str, entities: list[Entity], seed: str,
                  on_step: Callable[[dict], None] | None = None) -> dict[str, Any]:
    """Pseudonymize values already classified by scan_pipeline().

    This is the step that actually changes anything — run only once the user has
    seen the sensitivity score and chosen to proceed.
    """
    steps: list[dict[str, Any]] = []

    def step(stage: str, agent: str, text: str, detail: Any = None) -> None:
        item = {
            "stage": stage,
            "agent": agent,
            "text": text,
            "detail": detail or [],
            "engine": "deterministic",
            "model": None,
        }
        steps.append(item)
        if on_step:
            on_step(item)

    entities = pseudonymize(entities, seed)
    masked = apply_mask(markdown, entities)
    step("pseudonymize", "Pseudonymization Engine",
         "Replaced every sensitive value with its selected handling result.",
         [{"type": e.type, "real": e.real, "fake": e.fake} for e in entities])

    verification = [{
        "type": e.type,
        "value": e.real,
        "status": status_for(e.action),
        "risky": e.action != "ALLOW",
        "reason": ("Original value remained after replacement" if e.action != "ALLOW"
                   else "Original value was intentionally kept by policy"),
    } for e in entities if e.real and e.real in masked]
    risky = sum(1 for item in verification if item["risky"])
    kept = len(verification) - risky
    summary = ("Verification complete — no detected original values remain."
               if not verification else
               f"Verification found {len(verification)} original values still present: "
               f"{risky} risky and {kept} intentionally kept. Processing continues.")
    step("verify", "Post-Mask Verification Checker", summary, verification)

    return {"entities": entities, "masked": masked, "verification": verification, "trace": steps}


def run_pipeline(markdown: str, seed: str, on_step: Callable[[dict], None] | None = None,
                 detected_entities: Iterable[Entity] | None = None) -> dict[str, Any]:
    """The whole chain in one call: scan_pipeline() + mask_pipeline() back to back.

    Kept for callers that want the old all-at-once behavior (e.g. bundled samples
    where there's no separate "review the score first" step).
    """
    scanned = scan_pipeline(markdown, on_step=on_step, detected_entities=detected_entities)
    masked = mask_pipeline(markdown, scanned["entities"], seed, on_step=on_step)
    return {
        "entities": masked["entities"],
        "masked": masked["masked"],
        "verification": masked["verification"],
        "sensitivity": scanned["sensitivity"],
        "trace": scanned["trace"] + masked["trace"],
    }
