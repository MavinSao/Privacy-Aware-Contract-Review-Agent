"""CrewAI chain — three agents that hand a document down the privacy pipeline.

    Detector  ->  Risk Analyst  ->  Pseudonymizer

The agents orchestrate and narrate; the *decisions* are made by the deterministic
tools in privacy.py. That split is deliberate: an LLM must never be the thing
standing between a bank account number and the internet.

The crew always runs on a LOCAL model (Ollama). If no local model is reachable the
chain falls back to running the same tools directly, so the demo never breaks —
the results are identical, only the narration is missing.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import llm as model_router
import privacy

CREW_MODEL = os.getenv("CREW_MODEL", "gemma4:12b")
CREW_ENABLED = os.getenv("CREW_ENABLED", "true").lower() != "false"

# CrewAI records task outputs in SQLite even when memory is disabled. Keep that
# runtime state inside the project so Windows/sandboxed launches never fall back
# merely because the platform's default application-data directory is unwritable.
_CREW_STORAGE = Path(__file__).resolve().parent.parent / ".runtime" / "crewai"
_CREW_STORAGE.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("CREWAI_STORAGE_DIR", str(_CREW_STORAGE))
# Raw-document processing is local-only. Do not let CrewAI's optional tracing
# exporter make background network calls or delay requests when egress is blocked.
os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

_STAGE_AGENTS = {
    "detect": "Sensitive Information Detector",
    "classify": "Risk Assessment & Decision Engine",
    "pseudonymize": "Pseudonymization Engine",
}

_SEMANTIC_SYSTEM = """You are a local privacy entity detector. The document never leaves this machine.
Return JSON only, with this shape: {"entities":[{"value":"exact text", "type":"PERSON"}]}.
Copy each value exactly from the document. Never infer, normalize, translate, or invent values.
Find contextual values that pattern matching may miss, especially people, organizations,
addresses, internal codenames, and confidential identifiers.

Be exhaustive, not just first-pass:
- Read every labeled field, not only prose — "Name:", "Full name:", "Contact:", "Company:",
  "Address:", "Client:", "Attn:", table cells, signature blocks, and headers/footers
  all count.
- The SAME value often appears more than once, sometimes in a different notation each time
  (a phone number written "010-1234-5678" once and "01012345678" or "010.1234.5678" elsewhere;
  a company name with and without "Co., Ltd."; a person's name with and without a
  title). List every distinct notation you see as its own entity — do not assume the first
  occurrence covers the rest.
- Do not stop at the first instance of each category. If the document names three people, list
  all three; if it references the project by both a full name and a shorthand, list both.

Use an empty entities array when there are none."""


def _semantic_system() -> str:
    type_guidance = "".join(
        f"\n- {item['name']}: {item['description']}"
        for item in privacy.list_types()
    )
    return f"{_SEMANTIC_SYSTEM}\nAllowed types: {', '.join(privacy.TAXONOMY)}.\nType guidance:{type_guidance}"


def _json_object(text: str) -> dict[str, Any]:
    """Extract one JSON object from a model response, including fenced output."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        value = json.loads(cleaned[start:end + 1])
        return value if isinstance(value, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _semantic_detect(markdown: str) -> tuple[list[privacy.Entity], str]:
    """Ask fixed local Gemma for contextual entities, then validate every byte."""
    response = model_router.chat(
        "ollama", CREW_MODEL, None,
        [{"role": "system", "content": _semantic_system()},
         {"role": "user", "content": f"DOCUMENT\n---\n{markdown}"}],
        payload_is_masked=False,
    )
    entities: list[privacy.Entity] = []
    for item in _json_object(response).get("entities", []):
        if not isinstance(item, dict):
            continue
        value, etype = item.get("value"), item.get("type")
        if not isinstance(value, str) or not isinstance(etype, str):
            continue
        value, etype = value.strip(), etype.strip().upper()
        # The model proposes; Python authorizes. Only exact source substrings and
        # approved handling types can enter the mapping store.
        if value and value in markdown and etype in privacy.TAXONOMY:
            entities.append(privacy.Entity(type=etype, real=value, count=markdown.count(value)))
    return entities, response


def _merge_entities(rule_entities: list[privacy.Entity], semantic_entities: list[privacy.Entity]) -> list[privacy.Entity]:
    """Keep structured regex matches authoritative; add new semantic values."""
    merged = list(rule_entities)
    claimed_values = {e.real for e in merged}
    for entity in semantic_entities:
        if entity.real not in claimed_values:
            merged.append(entity)
            claimed_values.add(entity.real)
    return merged


def _local_llm():
    """Return a CrewAI LLM bound to Ollama, or None if it is not usable."""
    if not CREW_ENABLED:
        return None
    from llm import OLLAMA_HOST, ollama_models

    installed = ollama_models()
    if not installed:
        return None
    model = CREW_MODEL if CREW_MODEL in installed else installed[0]

    from crewai import LLM
    return LLM(model=f"ollama/{model}", base_url=OLLAMA_HOST)


def _summary(lines: list[str], limit: int = 12) -> str:
    """Keep tool output short — a 7B local model loses the thread on long lists,
    and the authoritative data lives in ctx either way."""
    if not lines:
        return "none found"
    head = "\n".join(lines[:limit])
    return head if len(lines) <= limit else f"{head}\n… and {len(lines) - limit} more"


def _wire_steps(tasks: list[Any], ctx: dict[str, Any], trace_of, on_step) -> None:
    """Attach a callback to each task that publishes its step as soon as it completes."""
    if not on_step:
        return

    def completed(index: int, output: Any) -> None:
        # Build the authoritative deterministic view at this point in the
        # chain, then publish only the stage that just completed.
        item = trace_of()[index]
        item.update({
            "engine": "crewai",
            "model": CREW_MODEL,
            "prompt": tasks[index].description,
            "agent_note": str(output),
        })
        if index == 0 and ctx.get("semantic_response"):
            item["prompt"] = ctx.get("semantic_prompt", item["prompt"])
            item["model_output"] = ctx["semantic_response"]
        on_step(item)

    for index, current_task in enumerate(tasks):
        current_task.callback = lambda output, index=index: completed(index, output)


def _build_scan_crew(llm, ctx: dict[str, Any], on_step=None):
    """Detector + Risk Analyst — find and risk-rate values. Changes nothing."""
    from crewai import Agent, Crew, Process, Task
    from crewai.tools import tool

    # Every tool takes `document_name` even though the context already knows it:
    # zero-argument tools break the native tool-calling path on small local models.

    @tool("detect_sensitive_values")
    def detect_tool(document_name: str) -> str:
        """Combine deterministic patterns with validated local semantic detection."""
        rule_entities = privacy.detect(ctx["markdown"])
        semantic_entities, semantic_response = _semantic_detect(ctx["markdown"])
        ctx["semantic_response"] = semantic_response
        ctx["semantic_count"] = len(semantic_entities)
        ctx["entities"] = _merge_entities(rule_entities, semantic_entities)
        if on_step:
            on_step({
                "stage": "detect", "agent": _STAGE_AGENTS["detect"],
                "text": "Gemma returned its detection output.", "detail": [],
                "engine": "crewai", "model": CREW_MODEL,
                "prompt": ctx["semantic_prompt"], "model_output": semantic_response,
            })
        counts: dict[str, int] = {}
        for e in ctx["entities"]:
            counts[e.type] = counts.get(e.type, 0) + 1
        return (f"Rules found {len(rule_entities)} value(s); local semantic detection added "
                f"{len(ctx['entities']) - len(rule_entities)} validated value(s).\n" +
                _summary([f"{t}: {n} value(s)" for t, n in counts.items()]))

    @tool("assess_risk")
    def classify_tool(document_name: str) -> str:
        """Assign a risk level and a handling action to every value found in the named document."""
        ctx["entities"] = privacy.classify(ctx["entities"])
        score = privacy.sensitivity_score(ctx["markdown"], ctx["entities"])
        ctx["sensitivity"] = score
        return (f"{score['percent']}% of the document is sensitive. " +
                _summary([f"{e.type} -> {privacy.status_for(e.action)}" for e in ctx["entities"]]))

    common = dict(llm=llm, verbose=False, allow_delegation=False, max_iter=3)
    detector = Agent(role=_STAGE_AGENTS["detect"],
                     goal="Find every personal or confidential value in the document.",
                     backstory="A privacy engineer who has reviewed thousands of Korean and English contracts.",
                     tools=[detect_tool], **common)
    analyst = Agent(role=_STAGE_AGENTS["classify"],
                    goal="Rate each finding by exposure risk and choose how to handle it.",
                    backstory="A compliance officer who decides what may leave the building.",
                    tools=[classify_tool], **common)

    def task(agent, description: str, expected: str) -> Any:
        return Task(description=description, expected_output=expected, agent=agent)

    tasks = [
        task(detector, f"Call detect_sensitive_values on '{ctx['name']}'. Summarize what "
                       "categories of sensitive information this document contains, in one or two sentences.",
             "A one or two sentence summary of the categories found."),
        task(analyst, "Call assess_risk. State the sensitivity percentage and summarize how many "
                      "findings will be pseudonymized, kept, or removed, in one or two sentences.",
             "A one or two sentence handling summary."),
    ]
    ctx["tasks"] = tasks

    trace_of = lambda: privacy.scan_pipeline(  # noqa: E731
        ctx["markdown"], detected_entities=ctx.get("entities"))["trace"]
    _wire_steps(tasks, ctx, trace_of, on_step)

    return Crew(agents=[detector, analyst], tasks=tasks,
                process=Process.sequential, verbose=False), tasks


def _build_mask_crew(llm, ctx: dict[str, Any], on_step=None):
    """Pseudonymizer — mask the already-classified values."""
    from crewai import Agent, Crew, Process, Task
    from crewai.tools import tool

    @tool("pseudonymize_document")
    def pseudonymize_tool(document_name: str) -> str:
        """Replace each value in the named document with a consistent, realistic stand-in."""
        ctx["entities"] = privacy.pseudonymize(ctx["entities"], ctx["seed"])
        ctx["masked"] = privacy.apply_mask(ctx["markdown"], ctx["entities"])
        return _summary([f"{e.type} replaced" for e in ctx["entities"]], limit=8)

    common = dict(llm=llm, verbose=False, allow_delegation=False, max_iter=3)
    masker = Agent(role=_STAGE_AGENTS["pseudonymize"],
                   goal="Replace sensitive values so the contract stays analyzable but not identifiable.",
                   backstory="A data engineer who preserves meaning while destroying identity.",
                   tools=[pseudonymize_tool], **common)
    def task(agent, description: str, expected: str) -> Any:
        return Task(description=description, expected_output=expected, agent=agent)

    tasks = [
        task(masker, "Call pseudonymize_document. Confirm in one sentence that sensitive entities were "
                     "replaced consistently so the contract can still be analyzed.",
             "A one sentence confirmation."),
    ]
    ctx["tasks"] = tasks

    trace_of = lambda: privacy.mask_pipeline(  # noqa: E731
        ctx["markdown"], ctx["entities"], ctx["seed"])["trace"]
    _wire_steps(tasks, ctx, trace_of, on_step)

    return Crew(agents=[masker], tasks=tasks,
                process=Process.sequential, verbose=False), tasks


def scan(markdown: str, name: str, on_step=None) -> dict[str, Any]:
    """Detect -> classify. Read-only — finds and risk-rates values, changes nothing.

    Returns {"entities", "sensitivity", "trace", "engine"}.
    """
    llm = None
    try:
        llm = _local_llm()
    except Exception:
        llm = None

    if llm is not None:
        try:
            semantic_prompt = f"{_semantic_system()}\n\nDOCUMENT\n---\n{markdown}"
            ctx: dict[str, Any] = {"markdown": markdown, "name": name,
                                   "semantic_prompt": semantic_prompt}
            crew, tasks = _build_scan_crew(llm, ctx, on_step=on_step)
            if on_step:
                on_step({
                    "stage": "detect", "agent": _STAGE_AGENTS["detect"],
                    "text": "Prompt sent. Gemma is detecting sensitive entities…", "detail": [],
                    "engine": "crewai", "model": CREW_MODEL,
                    "prompt": semantic_prompt, "loading": True,
                })
            crew.kickoff()
            notes = [str(t.output) if t.output else "" for t in tasks]
            result = _assemble_scan(ctx, notes, engine="crewai")
            if result:
                return result
        except Exception as exc:  # noqa: BLE001 — a broken crew must not break the demo
            print(f"[crew] scan falling back to the direct chain: {exc}")

    out = privacy.scan_pipeline(markdown, on_step=on_step)
    out["engine"] = "deterministic"
    return out


def mask(markdown: str, entities: list[privacy.Entity], seed: str, name: str,
        on_step=None) -> dict[str, Any]:
    """Pseudonymize the values scan() already found and classified.

    Returns {"entities", "masked", "trace", "engine"}.
    """
    llm = None
    try:
        llm = _local_llm()
    except Exception:
        llm = None

    if llm is not None:
        try:
            ctx: dict[str, Any] = {"markdown": markdown, "seed": seed, "name": name,
                                   "entities": entities}
            crew, tasks = _build_mask_crew(llm, ctx, on_step=on_step)
            crew.kickoff()
            notes = [str(t.output) if t.output else "" for t in tasks]
            result = _assemble_mask(ctx, notes, engine="crewai")
            if result:
                return result
        except Exception as exc:  # noqa: BLE001 — a broken crew must not break the demo
            print(f"[crew] mask falling back to the direct chain: {exc}")

    out = privacy.mask_pipeline(markdown, entities, seed, on_step=on_step)
    out["engine"] = "deterministic"
    return out


def _assemble_scan(ctx: dict[str, Any], notes: list[str], engine: str) -> dict[str, Any] | None:
    """Turn the shared context into the same result shape scan_pipeline() produces."""
    if ctx.get("entities") is None:
        return None  # the agents skipped a tool — caller falls back to the direct chain

    # Re-derive the facts deterministically so the trace text has exactly one source
    # of truth. It is pure regex over a few KB, so the second pass is free.
    facts = privacy.scan_pipeline(ctx["markdown"], detected_entities=ctx["entities"])
    for step, task, note in zip(facts["trace"], ctx["tasks"], notes):
        step["engine"] = engine
        step["model"] = CREW_MODEL
        step["prompt"] = task.description
        if note.strip():
            step["agent_note"] = note.strip()
    if facts["trace"] and ctx.get("semantic_response"):
        facts["trace"][0]["prompt"] = ctx.get("semantic_prompt", facts["trace"][0]["prompt"])
        facts["trace"][0]["model_output"] = ctx["semantic_response"]
    facts["engine"] = engine
    return facts


def _assemble_mask(ctx: dict[str, Any], notes: list[str], engine: str) -> dict[str, Any] | None:
    """Turn the shared context into the same result shape mask_pipeline() produces."""
    if not ctx.get("masked"):
        return None  # the agents skipped a tool — caller falls back to the direct chain

    facts = privacy.mask_pipeline(ctx["markdown"], ctx["entities"], ctx["seed"])
    for step, task, note in zip(facts["trace"], ctx["tasks"], notes):
        step["engine"] = engine
        step["model"] = CREW_MODEL
        step["prompt"] = task.description
        if note.strip():
            step["agent_note"] = note.strip()
    facts["engine"] = engine
    return facts
