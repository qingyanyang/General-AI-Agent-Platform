"""Seed curated skills for demos and tests (#23)."""

from __future__ import annotations

from app.agents.skills.registry import ApprovedResource, Skill

SEED_SKILLS: tuple[Skill, ...] = (
    Skill(
        name="summarize_brief",
        description="Summarize a brief into a short executive outline.",
        instructions=(
            "Produce a concise executive summary.\n"
            "1. State the goal in one sentence.\n"
            "2. List at most five key points.\n"
            "3. End with one recommended next step.\n"
            "Do not invent facts that are not in the user message."
        ),
        resources=(ApprovedResource(id="brief_template", label="Executive brief outline"),),
    ),
    Skill(
        name="meeting_notes",
        description="Turn a meeting transcript into structured notes.",
        instructions=(
            "Convert the transcript into structured meeting notes.\n"
            "Include: attendees (if stated), decisions, action items with owners, "
            "and open questions.\n"
            "Use short bullets. Do not invent attendees or owners."
        ),
        resources=(ApprovedResource(id="notes_template", label="Meeting notes structure"),),
    ),
)
