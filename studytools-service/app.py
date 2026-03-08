import os
import re
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

try:
    import spacy
except Exception:  # pragma: no cover
    spacy = None

APP = FastAPI(title="studytools-service")

TOKEN = (os.getenv("STUDYTOOLS_SERVICE_TOKEN") or "").strip()
TOKEN_PREV = (os.getenv("STUDYTOOLS_SERVICE_TOKEN_PREVIOUS") or "").strip()

NLP = None
if spacy is not None:
    try:
        NLP = spacy.load("en_core_web_sm")
    except Exception:
        NLP = spacy.blank("en")


class ValidateReq(BaseModel):
    subject: str = Field(min_length=1, max_length=120)
    topic: str = Field(min_length=1, max_length=180)
    text: str = Field(min_length=1, max_length=200000)


class GenerateOptions(BaseModel):
    notesLength: Optional[str] = "Medium"
    flashcardCount: Optional[int] = 15
    difficulty: Optional[str] = "Mixed"
    includeDefinitions: Optional[bool] = False
    includeExamples: Optional[bool] = False


class GenerateReq(BaseModel):
    subject: str = Field(min_length=1, max_length=120)
    topic: str = Field(min_length=1, max_length=180)
    text: str = Field(min_length=1, max_length=200000)
    outputs: List[str] = Field(min_items=1, max_items=4)
    options: Optional[GenerateOptions] = GenerateOptions()


def _safe_error(code: str, message: str, status: int = 422):
    raise HTTPException(status_code=status, detail={"error": {"code": code, "message": message}})


def _auth(authorization: Optional[str]):
    if not TOKEN:
        _safe_error("PROCESSING_FAILED", "Service token is not configured.", 500)
    if not authorization or not authorization.startswith("Bearer "):
        _safe_error("INVALID_INPUT", "Unauthorized.", 401)
    value = authorization.split(" ", 1)[1].strip()
    if value not in {TOKEN, TOKEN_PREV}:
        _safe_error("INVALID_INPUT", "Unauthorized.", 401)


def _norm_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _outline_score(text: str) -> int:
    low = text.lower()
    bad = [
        "course outline",
        "curriculum",
        "syllabus",
        "grading scheme",
        "attendance policy",
        "office hours",
        "weekly schedule",
        "mark distribution",
        "evaluation breakdown",
    ]
    return sum(low.count(k) for k in bad)


def _is_education_related(text: str) -> bool:
    low = text.lower()
    markers = ["chapter", "definition", "concept", "example", "theorem", "formula", "explain", "because"]
    return sum(low.count(m) for m in markers) >= 3


def _topic_matches(topic: str, text: str) -> bool:
    words = [w for w in re.findall(r"[a-zA-Z0-9]+", topic.lower()) if len(w) > 2]
    if not words:
        return True
    low = text.lower()
    hits = sum(1 for w in words if w in low)
    return hits >= max(1, min(2, len(words)))


def _detect_mixed_subject(text: str, subject: str, topic: str) -> bool:
    low = text.lower()
    clusters = {
        "english": ["english", "writing", "essay", "grammar", "thesis"],
        "math": ["algebra", "geometry", "equation", "formula", "theorem"],
        "science": ["biology", "chemistry", "physics", "cell", "molecule"],
        "software": ["database", "software", "requirement", "uml", "testing"],
    }
    hits = []
    for name, keywords in clusters.items():
        score = sum(1 for keyword in keywords if keyword in low)
        if score > 0:
            hits.append((name, score))
    hits.sort(key=lambda item: item[1], reverse=True)
    query = f"{subject} {topic}".lower()
    if len(hits) >= 2 and hits[1][1] >= max(2, hits[0][1] - 1) and hits[0][0] not in query:
        return True
    return False


def _extract_keywords(text: str, limit: int = 30) -> List[str]:
    if NLP is None:
        words = [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", text)]
        uniq = []
        for w in words:
            if w not in uniq:
                uniq.append(w)
            if len(uniq) >= limit:
                break
        return [u[:40] for u in uniq]
    doc = NLP(text[:200000])
    cand = []
    for ent in doc.ents:
        t = ent.text.strip()
        if 2 <= len(t) <= 40:
            cand.append(t)
    noun_chunks = getattr(doc, "noun_chunks", None)
    if noun_chunks is not None:
        try:
            for ch in noun_chunks:
                t = ch.text.strip()
                if 2 <= len(t) <= 40:
                    cand.append(t)
        except Exception:
            pass
    seen = set()
    out = []
    for c in cand:
        k = c.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(c[:40])
        if len(out) >= limit:
            break
    return out


def _summary(text: str) -> str:
    sents = re.split(r"(?<=[.!?])\s+", text.strip())
    picked = " ".join(sents[:6]) if sents else text[:1200]
    return picked[:1200]


def _notes(title: str, text: str, mode: str, include_definitions: bool, include_examples: bool) -> str:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    target = 18
    if str(mode).lower() == "short":
        target = 10
    elif str(mode).lower() == "long":
        target = 28
    overview = " ".join(sentences[: min(3, len(sentences))])[:700]
    key_points = sentences[:target]
    key_lines = "\n".join(f"- {line[:220]}" for line in key_points[:8])
    keywords = _extract_keywords(text, 8)
    definition_lines = "\n".join(f"- {item}" for item in keywords[:4]) or "- Review the key terms in this section."
    example_lines = "\n".join(f"- {line[:220]}" for line in sentences[3:7]) or "- Add examples from class notes or worked exercises."
    parts = [
        f"# {title[:120]}",
        "## Overview",
        overview or text[:500],
        "## Key Concepts",
        key_lines or "- Review the most important ideas from this topic.",
    ]
    if include_definitions:
        parts.extend(["## Definitions", definition_lines])
    if include_examples:
        parts.extend(["## Examples", example_lines])
    parts.extend(["## Quick Review", "- Focus on the topic heading and the strongest repeated concepts in these notes."])
    return "\n\n".join(parts)[:12000]


def _flashcards(topic: str, text: str, count: int) -> List[dict]:
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if len(s.strip()) > 20]
    out = []
    for i, s in enumerate(sents[: max(5, min(50, count))]):
        front = f"{topic}: key point {i + 1}"
        back = s[:400]
        out.append({"front": front[:180], "back": back, "tags": [topic[:20]], "difficulty": "Medium"})
    while len(out) < max(5, min(50, count)):
        n = len(out) + 1
        out.append({"front": f"{topic}: concept {n}"[:180], "back": "Review this concept in your notes."[:400], "tags": [topic[:20]], "difficulty": "Medium"})
    return out[:50]


@APP.get("/health")
def health():
    return {"ok": True}


@APP.post("/v1/validate")
def validate(req: ValidateReq, authorization: Optional[str] = Header(default=None)):
    try:
        _auth(authorization)
        text = _norm_text(req.text)
        outline = _outline_score(text) >= 3
        edu = _is_education_related(text)
        topic_ok = _topic_matches(req.topic, text)
        mixed = _detect_mixed_subject(text, req.subject, req.topic)
        reason = "Validation completed."
        if outline:
            reason = "Detected curriculum/outline style document."
        elif mixed:
            reason = "Document appears to contain multiple unrelated subjects."
        elif not edu:
            reason = "Text does not appear to be education-focused."
        elif not topic_ok:
            reason = "Topic does not strongly match document text."
        return {
            "isEducationRelated": bool(edu),
            "topicMatchesDoc": bool(topic_ok),
            "isCourseOutline": bool(outline),
            "isMixedSubject": bool(mixed),
            "reason": reason[:180],
        }
    except HTTPException:
        raise
    except Exception:
        _safe_error("PROCESSING_FAILED", "Unable to validate input.", 500)


@APP.post("/v1/generate")
def generate(req: GenerateReq, authorization: Optional[str] = Header(default=None)):
    try:
        _auth(authorization)
        text = _norm_text(req.text)
        outputs = [o.lower().strip() for o in req.outputs]
        options = req.options or GenerateOptions()

        result = {"title": f"{req.subject} - {req.topic}"[:200]}
        if "summary" in outputs:
            result["summary"] = _summary(text)
        if "keywords" in outputs:
            result["keywords"] = _extract_keywords(text, 30)
        if "notes" in outputs:
            result["notesMarkdown"] = _notes(
                f"{req.subject} - {req.topic}",
                text,
                options.notesLength or "Medium",
                bool(options.includeDefinitions),
                bool(options.includeExamples),
            )
        if "flashcards" in outputs:
            count = max(5, min(50, int(options.flashcardCount or 15)))
            result["flashcards"] = _flashcards(req.topic, text, count)
        return result
    except HTTPException:
        raise
    except Exception:
        _safe_error("PROCESSING_FAILED", "Unable to generate study output.", 500)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(APP, host="0.0.0.0", port=int(os.getenv("PORT", "5100")))
