import re

from vidscribe.models import ExtractionOptions


def validate_session_record(markdown: str, options: ExtractionOptions) -> None:
    """Enforce the stable, user-visible Session Record contract at the provider boundary."""
    header = re.search(r"^📝 \*\*.+\*\* · \d{2}-\d{2}-\d{4}", markdown, re.MULTILINE)
    if header is None or (header.start() and not markdown.startswith("## Input Context\n")):
        raise ValueError("Session Record must begin with the canonical header")
    required = ["Recall Brief", "Snapshots", "Transcript"]
    selected = [
        *( ["Highlights"] if options.highlights else [] ),
        "Action Summary" if options.action_summary else "Topics",
        *( ["Chapters"] if options.chapters else [] ),
    ]
    omitted = [
        *( ["Highlights"] if not options.highlights else [] ),
        "Topics" if options.action_summary else "Action Summary",
        *( ["Chapters"] if not options.chapters else [] ),
    ]
    headings = [
        heading.strip().strip("*").strip()
        for heading in re.findall(r"^#{2,6}\s+(.+)$", markdown, re.MULTILINE)
    ]
    for heading in [*required, *selected]:
        if heading not in headings:
            raise ValueError(f"Session Record is missing {heading}")
    if any(heading in headings for heading in omitted):
        raise ValueError("Session Record includes an unselected extraction")
    expected = ["Recall Brief", *selected, "Snapshots", "Transcript"]
    positions = [headings.index(heading) for heading in expected]
    if positions != sorted(positions) or headings[-1] != "Transcript":
        raise ValueError("Session Record sections are out of order")
    if options.chapters:
        chapter_match = re.search(
            r"^#{2,6}\s+Chapters\s*$([\s\S]*?)(?=^#{2,6}\s+Snapshots\s*$)",
            markdown,
            re.MULTILINE,
        )
        if chapter_match is None:
            raise ValueError("Session Record is missing Chapters")
        chapter_content = chapter_match.group(1)
        timestamps = re.findall(r"(?m)^\d{1,2}:\d{2}(?::\d{2})? .+", chapter_content)
        if timestamps and len(timestamps) < 3:
            raise ValueError("Chapters require at least three timestamped entries")
