import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPost, apiUpload } from "../api/http";
import { useUIText } from "../context/UITextContext";

const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;
const GENERATION_TRANSITION_STORAGE_KEY = "study-tools-create-generation-transition";
const GENERATION_TRANSITION_TTL_MS = 2 * 60 * 1000;
const OUTPUT_BUTTONS = [
  { id: "Notes", categories: ["STUDY_NOTES"] },
  { id: "FlashCards", categories: ["FLASH_CARDS"] },
  { id: "Keywords", categories: ["KEYWORDS"] },
  { id: "Assignments", categories: ["ASSIGNMENT"] },
  { id: "Both", categories: ["STUDY_NOTES", "FLASH_CARDS"] },
];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

function toOutputs(outputType) {
  if (outputType === "FlashCards") return ["flashcards"];
  if (outputType === "Keywords") return ["keywords"];
  if (outputType === "Assignments") return ["assignments"];
  if (outputType === "Both") return ["notes", "flashcards", "keywords", "summary"];
  return ["notes", "keywords", "summary"];
}

function mapSuggestedCategoryToOutputType(category) {
  if (category === "FLASH_CARDS") return "FlashCards";
  if (category === "KEYWORDS") return "Keywords";
  if (category === "ASSIGNMENT") return "Assignments";
  return "Notes";
}

function isOutlineAllowedOutputType(outputType) {
  return outputType === "Notes" || outputType === "Keywords";
}

function outputTypeSupportsTopicOnly(outputType) {
  return outputType !== "Assignments";
}

function pickSuggestedOutputType(suggestion) {
  const nextType = mapSuggestedCategoryToOutputType(suggestion?.suggestedCategory);
  if (String(suggestion?.docType || "") === "COURSE_OUTLINE" && !isOutlineAllowedOutputType(nextType)) {
    return "Notes";
  }
  return nextType;
}

function mapOutputTypeToUserCategory(outputType) {
  if (outputType === "FlashCards") return "FLASH_CARDS";
  if (outputType === "Keywords") return "KEYWORDS";
  if (outputType === "Assignments") return "ASSIGNMENT";
  if (outputType === "Both") return "STUDY_NOTES_AND_FLASH_CARDS";
  return "STUDY_NOTES";
}

function classifyClientSource(text, fileName) {
  const low = `${String(fileName || "")} ${String(text || "")}`.toLowerCase();
  const assignmentSignals = ["assignment", "worksheet", "problem set", "solve", "calculate", "determine", "prove", "question 1", "find "];
  const studySignals = ["chapter", "definition", "concept", "summary", "example", "overview", "lesson"];
  const assignmentScore = assignmentSignals.reduce((sum, s) => sum + (low.includes(s) ? 2 : 0), 0);
  const studyScore = studySignals.reduce((sum, s) => sum + (low.includes(s) ? 2 : 0), 0);
  if (assignmentScore >= Math.max(4, studyScore + 2)) return "assignment";
  return "study";
}

function isGenericValue(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ["study guide", "study", "guide", "notes", "chapter", "subject", "all subjects", "test prep"].includes(normalized);
}

function readGenerationTransitionLock() {
  try {
    if (typeof window === "undefined") return false;
    const raw = window.sessionStorage.getItem(GENERATION_TRANSITION_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const startedAtMs = Number(parsed?.startedAtMs || 0);
    if (!startedAtMs || Date.now() - startedAtMs > GENERATION_TRANSITION_TTL_MS) {
      window.sessionStorage.removeItem(GENERATION_TRANSITION_STORAGE_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function writeGenerationTransitionLock(active) {
  try {
    if (typeof window === "undefined") return;
    if (active) {
      window.sessionStorage.setItem(
        GENERATION_TRANSITION_STORAGE_KEY,
        JSON.stringify({ startedAtMs: Date.now() })
      );
      return;
    }
    window.sessionStorage.removeItem(GENERATION_TRANSITION_STORAGE_KEY);
  } catch {}
}

export default function StudyToolsCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loadCategoryKeys, t, msg } = useUIText();
  const classId = Number(searchParams.get("classId") || 0) || null;
  const uploadTokenRef = useRef(0);
  const analyzedDocumentRef = useRef(0);
  const autoGenerateKeyRef = useRef("");
  const autoGenerateFailedKeyRef = useRef("");

  const [outputType, setOutputType] = useState("Notes");
  const [notesLength, setNotesLength] = useState("Medium");
  const [flashcardCount, setFlashcardCount] = useState(15);
  const [difficulty, setDifficulty] = useState("Mixed");
  const [assignmentCount, setAssignmentCount] = useState(8);
  const [includeDefinitions, setIncludeDefinitions] = useState(false);
  const [includeExamples, setIncludeExamples] = useState(false);
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [inputMode, setInputMode] = useState("Document");
  const [documentSource, setDocumentSource] = useState("Select");
  const [documents, setDocuments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadClassId, setUploadClassId] = useState(classId ? String(classId) : "");
  const [pastedText, setPastedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [extractionDocumentId, setExtractionDocumentId] = useState(null);
  const [extractionStatus, setExtractionStatus] = useState("");
  const [extractionPercent, setExtractionPercent] = useState(0);
  const [extractionWarning, setExtractionWarning] = useState("");
  const [modeInfo, setModeInfo] = useState("");
  const [uploadedDocumentId, setUploadedDocumentId] = useState(null);
  const [categorySuggestions, setCategorySuggestions] = useState(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [overrideWarning, setOverrideWarning] = useState("");
  const [frontendTrace, setFrontendTrace] = useState(null);
  const [refreshingExtraction, setRefreshingExtraction] = useState(false);
  const [navigatingAfterQueue, setNavigatingAfterQueue] = useState(false);
  const [queueStartLocked, setQueueStartLocked] = useState(() => readGenerationTransitionLock());
  const generationTransitionActive = queueStartLocked || navigatingAfterQueue;

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "studyTools.create.title",
      "studyTools.create.holding.title",
      "studyTools.create.toggle.showAll",
      "studyTools.create.toggle.hideUnrelated",
      "studyTools.create.notesLength.short",
      "studyTools.create.notesLength.medium",
      "studyTools.create.notesLength.long",
      "studyTools.create.difficulty.easy",
      "studyTools.create.difficulty.mixed",
      "studyTools.create.difficulty.hard",
      "studyTools.create.includeDefinitions",
      "studyTools.create.includeExamples",
      "studyTools.create.detected",
      "studyTools.create.suggested",
      "studyTools.create.subject",
      "studyTools.create.topic",
      "studyTools.create.input.uploadDocument",
      "studyTools.create.input.pasteText",
      "studyTools.create.paste.label",
      "studyTools.create.document.selectExisting",
      "studyTools.create.document.uploadNew",
      "studyTools.create.class.select",
      "studyTools.create.extraction.progress",
      "studyTools.create.extraction.starting",
      "studyTools.create.extraction.documentId",
      "studyTools.create.extraction.refresh",
      "studyTools.create.extraction.refreshing",
      "studyTools.create.document.select",
      "studyTools.create.selected",
      "studyTools.create.textLength",
      "studyTools.create.debug.title",
      "studyTools.create.footer.background",
      "studyTools.create.footer.extracting",
      "studyTools.create.footer.generating",
      "studyTools.create.cancel",
      "studyTools.create.generate.notes",
      "studyTools.create.generate.flashcards",
      "studyTools.create.generate.assessment",
      "studyTools.create.generate.both",
      "studyTools.create.output.notes",
      "studyTools.create.output.flashcards",
      "studyTools.create.output.keywords",
      "studyTools.create.output.assessment",
      "studyTools.create.output.both",
      "studyTools.create.output.notRecommended",
      "studyTools.create.output.maybe",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "studyTools.create.outline.hint",
      "studyTools.create.outline.limitedWarning",
      "studyTools.create.outline.blocked",
      "studyTools.create.genericInput",
      "studyTools.create.assignment.hint",
      "studyTools.create.assignment.added",
      "studyTools.create.assignment.addedWithSelection",
      "studyTools.create.study.switchedToNotes",
      "studyTools.create.overrideWarning",
      "studyTools.create.extractedAnalyzed",
      "studyTools.create.extracted",
      "studyTools.create.processingEnded",
      "studyTools.create.processingFailed",
      "studyTools.create.upload.starting",
      "studyTools.create.upload.returnedNoId",
      "studyTools.create.upload.background",
      "studyTools.create.upload.failed",
      "studyTools.create.validation.required",
      "studyTools.create.validation.fileRequired",
      "studyTools.create.validation.imageTooLarge",
      "studyTools.create.validation.waitForExtraction",
      "studyTools.create.validation.stillExtracting",
      "studyTools.create.validation.selectDocumentFirst",
      "studyTools.create.queue.failed",
      "studyTools.create.queue.queued",
      "studyTools.create.queue.autoStarting",
      "studyTools.create.refresh.running",
      "studyTools.create.refresh.failed",
      "studyTools.create.image.helper",
      "studyTools.create.image.uploadDetected",
      "studyTools.create.upload.autoStart",
      "studyTools.create.upload.selectClass",
      "studyTools.create.holding.body",
    ]).catch(() => {});
    loadCategoryKeys("UI_PLACEHOLDER", [
      "studyTools.create.paste.placeholder",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  const outlineHint = msg(
    "studyTools.create.outline.hint",
    "Course outlines/curriculum/syllabus are not accepted. Upload actual study content like chapters, lecture notes, or study guides."
  );
  const outlineLimitedWarning = msg(
    "studyTools.create.outline.limitedWarning",
    "Course outlines usually produce broad revision material, not deep study notes."
  );
  const outlineBlockedMessage = msg(
    "studyTools.create.outline.blocked",
    "Course outlines can only be used for Notes or Keywords. Assessment and Flash Cards are not available for this type of document."
  );
  const genericInputMessage = msg(
    "studyTools.create.genericInput",
    "Please enter a specific subject and topic, for example: English Composition / Thesis Statements."
  );
  const assignmentHint = msg(
    "studyTools.create.assignment.hint",
    "Assessment generates practice questions with worked examples and explanations. Assessment includes assignments, quizzes, exams, and tests."
  );
  const categoryLabels = useMemo(() => ({
    STUDY_NOTES: t("studyTools.create.output.notes", "Notes"),
    FLASH_CARDS: t("studyTools.create.output.flashcards", "Flash Cards"),
    KEYWORDS: t("studyTools.create.output.keywords", "Keywords"),
    ASSIGNMENT: t("studyTools.create.output.assessment", "Assessment"),
  }), [t]);
  const outputButtons = useMemo(() => ([
    { id: "Notes", label: t("studyTools.create.output.notes", "Notes"), categories: ["STUDY_NOTES"] },
    { id: "FlashCards", label: t("studyTools.create.output.flashcards", "Flash Cards"), categories: ["FLASH_CARDS"] },
    { id: "Keywords", label: t("studyTools.create.output.keywords", "Keywords"), categories: ["KEYWORDS"] },
    { id: "Assignments", label: t("studyTools.create.output.assessment", "Assessment"), categories: ["ASSIGNMENT"] },
    { id: "Both", label: t("studyTools.create.output.both", "Notes & Flash Cards"), categories: ["STUDY_NOTES", "FLASH_CARDS"] },
  ]), [t]);

  useEffect(() => {
    if (!generationTransitionActive) return undefined;
    return () => {};
  }, [generationTransitionActive]);

  useEffect(() => {
    writeGenerationTransitionLock(generationTransitionActive);
  }, [generationTransitionActive]);

  function isMatchingUploadedDocument(doc, file, code) {
    if (!doc || !file) return false;
    const docName = String(doc.originalFileName || "").trim().toLowerCase();
    const fileName = String(file.name || "").trim().toLowerCase();
    const docCode = String(doc.courseCode || "").trim().toLowerCase();
    const wantedCode = String(code || "").trim().toLowerCase();
    return !!docName && !!fileName && docName === fileName && docCode === wantedCode;
  }

  async function refreshDocuments() {
    const query = classId ? `?classId=${classId}` : "";
    const res = await apiGet(`/api/study-materials/documents${query}`);
    const nextDocs = Array.isArray(res.documents) ? res.documents : [];
    setDocuments(nextDocs);
    return nextDocs;
  }

  useEffect(() => {
    if (generationTransitionActive) return undefined;
    let alive = true;
    async function loadClasses() {
      try {
        const res = await apiGet("/api/classes");
        if (!alive) return;
        setClasses(Array.isArray(res.classes) ? res.classes : []);
      } catch {
        if (!alive) return;
        setClasses([]);
      }
    }
    async function loadDocs() {
      try {
        const nextDocs = await refreshDocuments();
        if (!alive) return;
        setDocuments(nextDocs);
      } catch {
        if (!alive) return;
        setDocuments([]);
      }
    }
    loadClasses();
    loadDocs();
    return () => {
      alive = false;
    };
  }, [classId, generationTransitionActive]);

  const genericInput = useMemo(() => isGenericValue(subject) || isGenericValue(topic), [subject, topic]);
  const isImageUpload = String(uploadFile?.type || "").startsWith("image/");
  const selectedDoc = documents.find((d) => Number(d.documentId) === Number(selectedDocumentId));
  const effectiveUploadClassId = classId || (Number(uploadClassId || 0) || null);
  const selectedUploadClass = useMemo(
    () => classes.find((item) => Number(item.classId) === Number(effectiveUploadClassId)) || null,
    [classes, effectiveUploadClassId]
  );
  const uploadCourseCode = String(selectedUploadClass?.className || "").trim();
  const extractedUploadDoc = useMemo(
    () =>
      documents.find((item) => Number(item.documentId) === Number(uploadedDocumentId))
      || documents.find(
        (item) =>
          uploadFile
          && String(item.originalFileName || "").trim().toLowerCase() === String(uploadFile.name || "").trim().toLowerCase()
          && String(item.courseCode || "").trim().toLowerCase() === String(uploadCourseCode || "").trim().toLowerCase()
          && Number(item.extractedTextLength || 0) > 0
      ),
    [documents, uploadedDocumentId, uploadFile, uploadCourseCode]
  );
  const effectiveExtractionStatus = extractedUploadDoc ? "Extracted" : extractionStatus;
  const isOutlineDocument = String(categorySuggestions?.docType || "") === "COURSE_OUTLINE";
  const outlineOutputBlocked = isOutlineDocument && !isOutlineAllowedOutputType(outputType);

  useEffect(() => {
    if (generationTransitionActive) return;
    if (isOutlineDocument) return;
    if (inputMode === "PasteText" && pastedText.trim().length >= 200) {
      const kind = classifyClientSource(pastedText.slice(0, 8000), "");
      if (kind === "assignment" && outputType !== "Assignments") {
        setModeInfo(
          outputType === "FlashCards" || outputType === "Both"
            ? msg("studyTools.create.assignment.addedWithSelection", "This source looks like an assessment such as an assignment, quiz, exam, or test. Your selected output will be generated, and Assessment will also be added.")
            : msg("studyTools.create.assignment.added", "This source looks like an assessment such as an assignment, quiz, exam, or test. Assessment will also be added.")
        );
      } else if (kind === "study" && outputType === "Assignments") {
        setOutputType("Notes");
        setModeInfo(msg("studyTools.create.study.switchedToNotes", "This source looks like study content. Output was switched from Assessment to Notes."));
      } else {
        setModeInfo("");
      }
    }
  }, [inputMode, pastedText, outputType, generationTransitionActive, isOutlineDocument, msg]);

  useEffect(() => {
    if (generationTransitionActive) return;
    if (!categorySuggestions) {
      setOverrideWarning("");
      return;
    }
    const selectedCategories = OUTPUT_BUTTONS.find((button) => button.id === outputType)?.categories || ["STUDY_NOTES"];
    const hiddenSet = new Set(categorySuggestions.hiddenCategories || []);
    const isHiddenSelection = selectedCategories.some((category) => hiddenSet.has(category));
    setOverrideWarning(isHiddenSelection ? msg("studyTools.create.overrideWarning", "Not recommended for this document; results may be poor.") : "");
  }, [categorySuggestions, outputType, generationTransitionActive, msg]);

  const canSubmit = useMemo(() => {
    if (!subject.trim() || !topic.trim() || genericInput) return false;
    if (outlineOutputBlocked) return false;
    if (inputMode === "PasteText") return pastedText.trim().length >= 200;
    if (documentSource === "Upload") {
      if (!uploadFile) return false;
      if (String(uploadFile?.type || "").startsWith("image/")) return true;
      return !!uploadedDocumentId && effectiveExtractionStatus === "Extracted";
    }
    return !!selectedDocumentId || outputTypeSupportsTopicOnly(outputType);
  }, [subject, topic, genericInput, outlineOutputBlocked, inputMode, pastedText, documentSource, uploadFile, selectedDocumentId, uploadedDocumentId, effectiveExtractionStatus, outputType]);

  async function loadCategorySuggestions(documentId) {
    if (!documentId) return null;
    const res = await apiGet(`/api/documents/${documentId}/category-suggestions`);
    setCategorySuggestions(res);
    setShowAllCategories(false);
    if (!selectionTouched && res?.suggestedCategory) {
      setOutputType(pickSuggestedOutputType(res));
    }
    return res;
  }

  async function finalizeExtractedDocument(documentId) {
    if (generationTransitionActive) return;
    setExtractionStatus("Extracted");
    setExtractionPercent(100);
    setExtractionWarning("");
    if (analyzedDocumentRef.current !== Number(documentId)) {
      analyzedDocumentRef.current = Number(documentId);
      const suggestion = await loadCategorySuggestions(documentId);
      setSuccess(
        suggestion?.suggestedCategory
          ? msg("studyTools.create.extractedAnalyzed", "Document extracted and analyzed.")
          : msg("studyTools.create.extracted", "Document extracted.")
      );
      return;
    }
    setSuccess(msg("studyTools.create.extracted", "Document extracted."));
  }

  async function syncUploadedDocumentStatus(documentId, { refreshList = false } = {}) {
    if (!documentId) return false;
    if (generationTransitionActive) return null;
    const requestStartedAt = Date.now();
    const res = await apiGet(`/api/document/${documentId}/status?_=${requestStartedAt}`);
    const doc = res?.document || {};
    const status = String(doc.status || "");
    console.info("[study-tools.upload]", {
      stage: "status_polled",
      documentId,
      status,
      requestMs: Date.now() - requestStartedAt,
      timeFromAcceptedMs:
        frontendTrace && Number(frontendTrace.documentId) === Number(documentId) && frontendTrace.uploadAcceptedAtMs
          ? Date.now() - frontendTrace.uploadAcceptedAtMs
          : null,
    });
    setExtractionStatus(status);
    setExtractionPercent(statusToProgress(status));
    if (status === "Extracted") {
      await finalizeExtractedDocument(documentId);
      return true;
    }
    if (["Rejected", "Blocked", "DeletedByUser", "Failed"].includes(status)) {
      setExtractionWarning(doc.failureReasonSafe || (doc.errorCode ? `${msg("studyTools.create.processingEnded", "Processing ended with")} ${doc.errorCode}.` : msg("studyTools.create.processingFailed", "Document processing failed.")));
      return false;
    }

    if (refreshList) {
      const nextDocs = await refreshDocuments();
      const matchedDoc = nextDocs.find((item) => Number(item.documentId) === Number(documentId));
      if (matchedDoc && Number(matchedDoc.extractedTextLength || 0) > 0) {
        await finalizeExtractedDocument(documentId);
        return true;
      }
    }
    return null;
  }

  function getButtonState(button) {
    if (!categorySuggestions) return { hidden: false, badge: "" };
    const hiddenSet = new Set(categorySuggestions.hiddenCategories || []);
    const hidden = button.categories.some((category) => hiddenSet.has(category));
    const maybe =
      Number(categorySuggestions.confidence || 0) >= 0.7 &&
      !hidden &&
      button.categories.some((category) => {
        const score = Number(categorySuggestions.categoryScores?.[category] || 0);
        return score >= 36 && score <= 54;
      });
    return {
      hidden,
      badge: hidden ? "Not recommended" : maybe ? "Maybe" : "",
    };
  }

  function handleOutputTypeSelect(nextType) {
    setSelectionTouched(true);
    setOutputType(nextType);
  }

  useEffect(() => {
    if (generationTransitionActive) return undefined;
    let alive = true;
    async function run() {
      if (inputMode !== "Document" || documentSource !== "Select" || !selectedDocumentId) {
        if (alive) setCategorySuggestions(null);
        return;
      }
      try {
        const res = await apiGet(`/api/documents/${selectedDocumentId}/category-suggestions`);
        if (!alive) return;
        setCategorySuggestions(res);
        setShowAllCategories(false);
        if (!selectionTouched && res?.suggestedCategory) {
          setOutputType(pickSuggestedOutputType(res));
        }
      } catch (error) {
        if (!alive) return;
        setCategorySuggestions(null);
        setModeInfo(error.message || "");
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [inputMode, documentSource, selectedDocumentId, selectionTouched, generationTransitionActive]);

  useEffect(() => {
    if (generationTransitionActive) return undefined;
    if (inputMode !== "Document" || documentSource !== "Upload") return undefined;
    if (!uploadFile || isImageUpload || uploadedDocumentId || uploadBusy) return undefined;
    if (!uploadCourseCode) return undefined;

    const token = ++uploadTokenRef.current;
    let cancelled = false;

    async function run() {
      setErr("");
      setSuccess(msg("studyTools.create.upload.starting", "Uploading file and starting extraction..."));
      setUploadBusy(true);
      try {
        const fd = new FormData();
        fd.append("file", uploadFile);
        if (effectiveUploadClassId) fd.append("classId", String(effectiveUploadClassId));
        fd.append("courseCode", uploadCourseCode);

        const uploaded = await apiUpload("/api/document/upload-course-outline", fd);
        if (cancelled || uploadTokenRef.current !== token) return;

        const acceptedAtMs = Date.now();
        const documentUploadId = Number(uploaded.documentId || 0);
        if (!documentUploadId) throw new Error(msg("studyTools.create.upload.returnedNoId", "Upload failed to return document id."));
        setFrontendTrace({
          documentId: documentUploadId,
          uploadAcceptedAtMs: acceptedAtMs,
          extractedSeenAtMs: null,
        });
        console.info("[study-tools.upload]", {
          stage: "upload_accepted",
          documentId: documentUploadId,
          status: String(uploaded.status || "Uploaded"),
        });

        setUploadedDocumentId(documentUploadId);
        setExtractionDocumentId(documentUploadId);
        setExtractionStatus(String(uploaded.status || "Uploaded"));
        setExtractionPercent(statusToProgress(uploaded.status || "Uploaded"));
        setExtractionWarning("");
        setSuccess(msg("studyTools.create.upload.background", "File uploaded. Extraction is running in background."));
        setDocuments((prev) => {
          const exists = prev.some((doc) => Number(doc.documentId) === documentUploadId);
          if (exists) return prev;
          return [
            {
              documentId: documentUploadId,
              originalFileName: uploadFile.name || "Uploaded document",
              courseCode: uploadCourseCode,
              classId: effectiveUploadClassId,
              uploadedAtUtc: null,
              extractedTextLength: 0,
              warningCodes: [],
            },
            ...prev,
          ];
        });
      } catch (e) {
        if (cancelled || uploadTokenRef.current !== token) return;
        setSuccess("");
        setErr(e.message || msg("studyTools.create.upload.failed", "Failed to upload document."));
      } finally {
        if (!cancelled && uploadTokenRef.current === token) {
          setUploadBusy(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [inputMode, documentSource, uploadFile, isImageUpload, uploadedDocumentId, uploadBusy, uploadCourseCode, effectiveUploadClassId, generationTransitionActive]);

  useEffect(() => {
    if (generationTransitionActive) return undefined;
    if (inputMode !== "Document" || documentSource !== "Upload") return undefined;
    if (!uploadBusy || isImageUpload || uploadedDocumentId || !uploadFile || !uploadCourseCode) return undefined;

    let cancelled = false;

    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const nextDocs = await refreshDocuments();
        if (cancelled) return;
        const matchedDoc = nextDocs.find(
          (doc) => isMatchingUploadedDocument(doc, uploadFile, uploadCourseCode) && Number(doc.extractedTextLength || 0) > 0
        );
        if (!matchedDoc) return;

        const recoveredDocumentId = Number(matchedDoc.documentId || 0);
        if (!recoveredDocumentId) return;

        setUploadedDocumentId(recoveredDocumentId);
        setExtractionDocumentId(recoveredDocumentId);
        setUploadBusy(false);
        setFrontendTrace({
          documentId: recoveredDocumentId,
          uploadAcceptedAtMs: Date.now(),
          extractedSeenAtMs: Date.now(),
        });
        console.info("[study-tools.upload]", {
          stage: "upload_recovered_from_documents_list",
          documentId: recoveredDocumentId,
          originalFileName: matchedDoc.originalFileName || "",
        });
        await finalizeExtractedDocument(recoveredDocumentId);
      } catch {}
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [inputMode, documentSource, uploadBusy, isImageUpload, uploadedDocumentId, uploadFile, uploadCourseCode, classId, generationTransitionActive]);

  useEffect(() => {
    if (generationTransitionActive) return undefined;
    if (!extractionDocumentId) return undefined;
    if (!uploadedDocumentId || Number(uploadedDocumentId) !== Number(extractionDocumentId)) return undefined;
    if (["Extracted", "Rejected", "Blocked", "DeletedByUser", "Failed"].includes(String(extractionStatus || ""))) return undefined;

    const token = uploadTokenRef.current;
    let cancelled = false;

    async function poll() {
      while (!cancelled && uploadTokenRef.current === token) {
        const done = await waitForExtracted(extractionDocumentId, token);
        if (cancelled || uploadTokenRef.current !== token) return;
        if (done == null) continue;
        if (!done) return;
        setFrontendTrace((prev) => {
          const next =
            prev && Number(prev.documentId) === Number(extractionDocumentId)
              ? { ...prev, extractedSeenAtMs: Date.now() }
              : prev;
          if (next?.uploadAcceptedAtMs && next?.extractedSeenAtMs) {
            console.info("[study-tools.upload]", {
              stage: "frontend_detected_extracted",
              documentId: next.documentId,
              timeFromAcceptedMs: next.extractedSeenAtMs - next.uploadAcceptedAtMs,
            });
          }
          return next;
        });

        if (analyzedDocumentRef.current !== Number(extractionDocumentId)) {
          await finalizeExtractedDocument(extractionDocumentId);
          if (cancelled || uploadTokenRef.current !== token) return;
        }
        return;
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [extractionDocumentId, uploadedDocumentId, extractionStatus, generationTransitionActive]);

  async function queueStudyGeneration({ autoTriggered = false } = {}) {
    setErr("");
    setSuccess(autoTriggered ? msg("studyTools.create.queue.autoStarting", "Document extracted. Starting generation...") : "");
    if (!canSubmit) {
      throw new Error(genericInput ? genericInputMessage : msg("studyTools.create.validation.required", "Subject and Topic are required before generating."));
    }
    setQueueStartLocked(true);
    setBusy(true);
    let queuedSuccessfully = false;
    try {
      let documentUploadId = selectedDocumentId ? Number(selectedDocumentId) : null;
      const body = {
        subject: subject.trim(),
        topic: topic.trim(),
        outputs: toOutputs(outputType),
        userChosenCategory: mapOutputTypeToUserCategory(outputType),
        userOverrodeSuggestion: !!overrideWarning,
        options: {
          notesLength,
          flashcardCount: Number(flashcardCount || 15),
          assignmentCount: Number(assignmentCount || 8),
          difficulty,
          includeDefinitions,
          includeExamples,
        },
      };

      if (inputMode === "PasteText") {
        body.pastedText = String(pastedText || "").slice(0, 200000);
      } else {
        if (documentSource === "Upload") {
          if (!uploadFile) throw new Error(msg("studyTools.create.validation.fileRequired", "Select a file to upload."));
          if (String(uploadFile.type || "").startsWith("image/")) {
            if (uploadFile.size > IMAGE_SIZE_LIMIT) {
              throw new Error(msg("studyTools.create.validation.imageTooLarge", "Image is too large. Max 5 MB."));
            }
            body.imageDataUrl = await readFileAsDataUrl(uploadFile);
            body.imageMimeType = uploadFile.type || "";
          } else {
            documentUploadId = Number(uploadedDocumentId || 0);
            if (!documentUploadId) throw new Error(msg("studyTools.create.validation.waitForExtraction", "Please wait for upload and extraction to finish."));
            if (effectiveExtractionStatus !== "Extracted") throw new Error(msg("studyTools.create.validation.stillExtracting", "Document is still extracting. Generate will be available when extraction finishes."));
          }
        }
        if (!body.imageDataUrl) {
          if (documentUploadId) {
            body.documentUploadId = documentUploadId;
          } else if (!outputTypeSupportsTopicOnly(outputType)) {
            throw new Error(msg("studyTools.create.validation.selectDocumentFirst", "Select or upload a document first."));
          }
        }
      }

      const created = await apiPost("/api/study-materials", body);
      const setId = Number(created.studyMaterialSetId || 0);
      if (!setId) throw new Error(msg("studyTools.create.queue.failed", "Failed to queue study material."));
      queuedSuccessfully = true;
      setNavigatingAfterQueue(true);
      setSuccess(created.warning || msg("studyTools.create.queue.queued", "Study generation queued."));
      navigate(`/study-tools/${setId}`, { state: created.warning ? { warning: created.warning } : undefined });
    } finally {
      if (!queuedSuccessfully) {
        setBusy(false);
        setNavigatingAfterQueue(false);
        setQueueStartLocked(false);
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await queueStudyGeneration();
    } catch (e2) {
      writeGenerationTransitionLock(false);
      setNavigatingAfterQueue(false);
      setQueueStartLocked(false);
      setSuccess("");
      setErr(e2.message || msg("studyTools.create.queue.failed", "Failed to queue study material."));
    }
  }

  function statusToProgress(status) {
    const s = String(status || "").trim();
    if (s === "Uploaded") return 15;
    if (s === "ScanPassed") return 35;
    if (s === "Extracting") return 70;
    if (s === "Extracted") return 100;
    if (s === "Rejected" || s === "Blocked" || s === "DeletedByUser" || s === "Failed") return 100;
    return 5;
  }

  async function waitForExtracted(documentId, token = uploadTokenRef.current) {
    if (uploadTokenRef.current !== token) return false;
    const done = await syncUploadedDocumentStatus(documentId, { refreshList: true });
    if (done != null) return done;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return null;
  }

  useEffect(() => {
    if (generationTransitionActive) return;
    if (!uploadedDocumentId || extractionStatus === "Extracted") return;
    const matchedDoc = documents.find((item) => Number(item.documentId) === Number(uploadedDocumentId));
    if (!matchedDoc || Number(matchedDoc.extractedTextLength || 0) <= 0) return;
    finalizeExtractedDocument(Number(uploadedDocumentId)).catch(() => {});
  }, [documents, uploadedDocumentId, extractionStatus, generationTransitionActive]);

  useEffect(() => {
    if (generationTransitionActive) return;
    if (!uploadedDocumentId || effectiveExtractionStatus !== "Extracted") return;
    if (extractionStatus === "Extracted") return;
    setExtractionStatus("Extracted");
    setExtractionPercent(100);
    setExtractionWarning("");
  }, [uploadedDocumentId, effectiveExtractionStatus, extractionStatus, generationTransitionActive]);

  useEffect(() => {
    if (generationTransitionActive) return undefined;
    if (!uploadedDocumentId || effectiveExtractionStatus === "Extracted") return undefined;
    if (["Rejected", "Blocked", "DeletedByUser", "Failed"].includes(String(extractionStatus || ""))) return undefined;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        await syncUploadedDocumentStatus(uploadedDocumentId, { refreshList: true });
      } catch {}
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [uploadedDocumentId, extractionStatus, effectiveExtractionStatus, classId, generationTransitionActive]);

  useEffect(() => {
    if (inputMode !== "Document" || documentSource !== "Upload" || isImageUpload) return;
    if (!uploadedDocumentId || effectiveExtractionStatus !== "Extracted") return;
    if (outlineOutputBlocked) return;
    if (!subject.trim() || !topic.trim() || genericInput) return;
    if (busy || uploadBusy || generationTransitionActive) return;

    const autoGenerateKey = JSON.stringify({
      documentId: Number(uploadedDocumentId),
      subject: subject.trim(),
      topic: topic.trim(),
      outputType,
      notesLength,
      flashcardCount: Number(flashcardCount || 15),
      assignmentCount: Number(assignmentCount || 8),
      difficulty,
      includeDefinitions: !!includeDefinitions,
      includeExamples: !!includeExamples,
    });
    if (autoGenerateKeyRef.current === autoGenerateKey) return;
    if (autoGenerateFailedKeyRef.current === autoGenerateKey) return;
    autoGenerateKeyRef.current = autoGenerateKey;
    autoGenerateFailedKeyRef.current = "";

    queueStudyGeneration({ autoTriggered: true }).catch((e) => {
      writeGenerationTransitionLock(false);
      autoGenerateKeyRef.current = "";
      autoGenerateFailedKeyRef.current = autoGenerateKey;
      setNavigatingAfterQueue(false);
      setQueueStartLocked(false);
      setSuccess("");
      setErr(e.message || msg("studyTools.create.queue.failed", "Failed to queue study material."));
    });
  }, [
    inputMode,
    documentSource,
    isImageUpload,
    uploadedDocumentId,
    effectiveExtractionStatus,
    subject,
    topic,
    genericInput,
    busy,
    uploadBusy,
    outputType,
    notesLength,
    flashcardCount,
    assignmentCount,
    difficulty,
    includeDefinitions,
    includeExamples,
    outlineOutputBlocked,
    generationTransitionActive,
  ]);

  async function handleRefreshExtractionStatus() {
    if (!extractionDocumentId) return;
    setRefreshingExtraction(true);
    setErr("");
    try {
      const result = await syncUploadedDocumentStatus(extractionDocumentId, { refreshList: true });
      if (result == null) {
        setSuccess(msg("studyTools.create.refresh.running", "Extraction is still running. Status was refreshed."));
      }
    } catch (e) {
      setErr(e.message || msg("studyTools.create.refresh.failed", "Failed to refresh extraction status."));
    } finally {
      setRefreshingExtraction(false);
    }
  }

  const showNotesOptions = outputType === "Notes" || outputType === "Both";
  const showCardOptions = outputType === "FlashCards" || outputType === "Both";
  const showAssignmentOptions = outputType === "Assignments";

  if (generationTransitionActive) {
    return (
      <div style={{ maxWidth: 980 }}>
        <h2 style={{ marginTop: 0 }}>{t("studyTools.create.title", "Notes / Flash Cards / Assessment")}</h2>
        <div style={{ border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 12, padding: 18, color: "#1e3a8a" }}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{t("studyTools.create.holding.title", "Generating study materials...")}</div>
          <div style={{ fontSize: 14 }}>{msg("studyTools.create.holding.body", "Your document was extracted and generation has started. You can leave this page.")}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" onClick={() => navigate("/dashboard")} style={{ padding: 0, border: "none", background: "transparent", color: "#1d4ed8", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {"< Back to Dashboard"}
        </button>
        {classId ? (
          <button type="button" onClick={() => navigate(`/dashboard?classInfo=${classId}`)} style={{ padding: 0, border: "none", background: "transparent", color: "#1d4ed8", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {"< Back to Class Details"}
          </button>
        ) : null}
      </div>
      <h2 style={{ marginTop: 0 }}>{t("studyTools.create.title", "Notes / Flash Cards / Assessment")}</h2>
      <p style={{ marginTop: 0, color: "#6b7280" }}>
        {outlineHint}
      </p>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {outputButtons.filter((button) => showAllCategories || !getButtonState(button).hidden || outputType === button.id).map((button) => {
              const state = getButtonState(button);
              return (
                <button
                  key={button.id}
                  type="button"
                  onClick={() => handleOutputTypeSelect(button.id)}
                  disabled={isOutlineDocument && !isOutlineAllowedOutputType(button.id)}
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: 999,
                    background: outputType === button.id ? "#e0f2fe" : "#fff",
                    color: outputType === button.id ? "#0c4a6e" : "#111827",
                    fontWeight: 700,
                    padding: "8px 12px",
                    cursor: isOutlineDocument && !isOutlineAllowedOutputType(button.id) ? "not-allowed" : "pointer",
                    opacity: state.hidden || (isOutlineDocument && !isOutlineAllowedOutputType(button.id)) ? 0.45 : 1,
                  }}
                >
                  {button.label}
                  {state.badge ? (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: state.hidden ? "#b91c1c" : "#92400e" }}>
                      {state.badge === "Not recommended"
                        ? t("studyTools.create.output.notRecommended", "Not recommended")
                        : t("studyTools.create.output.maybe", "Maybe")}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {!!categorySuggestions?.hiddenCategories?.length && (
              <button
                type="button"
                onClick={() => setShowAllCategories((value) => !value)}
                style={{ border: "none", background: "transparent", color: "#0f766e", fontWeight: 700, cursor: "pointer" }}
              >
                {showAllCategories
                  ? t("studyTools.create.toggle.hideUnrelated", "Hide unrelated categories")
                  : t("studyTools.create.toggle.showAll", "Show all categories")}
              </button>
            )}
            {showNotesOptions && (
              <select value={notesLength} onChange={(e) => setNotesLength(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #d1d5db" }}>
                <option>{t("studyTools.create.notesLength.short", "Short")}</option>
                <option>{t("studyTools.create.notesLength.medium", "Medium")}</option>
                <option>{t("studyTools.create.notesLength.long", "Long")}</option>
              </select>
            )}
            {showCardOptions && (
              <input type="number" min={5} max={50} value={flashcardCount} onChange={(e) => setFlashcardCount(Math.max(5, Math.min(50, Number(e.target.value || 15))))} style={{ width: 90, padding: 8, borderRadius: 8, border: "1px solid #d1d5db" }} />
            )}
            {showAssignmentOptions && (
              <input type="number" min={3} max={20} value={assignmentCount} onChange={(e) => setAssignmentCount(Math.max(3, Math.min(20, Number(e.target.value || 8))))} style={{ width: 90, padding: 8, borderRadius: 8, border: "1px solid #d1d5db" }} />
            )}
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #d1d5db" }}>
              <option>{t("studyTools.create.difficulty.easy", "Easy")}</option>
              <option>{t("studyTools.create.difficulty.mixed", "Mixed")}</option>
              <option>{t("studyTools.create.difficulty.hard", "Hard")}</option>
            </select>
            <label style={{ fontSize: 13, color: "#334155" }}><input type="checkbox" checked={includeDefinitions} onChange={(e) => setIncludeDefinitions(e.target.checked)} /> {t("studyTools.create.includeDefinitions", "Include Definitions")}</label>
            <label style={{ fontSize: 13, color: "#334155" }}><input type="checkbox" checked={includeExamples} onChange={(e) => setIncludeExamples(e.target.checked)} /> {t("studyTools.create.includeExamples", "Include Examples")}</label>
          </div>
          {showAssignmentOptions ? <div style={{ marginTop: 8, color: "#64748b", fontSize: 12 }}>{assignmentHint}</div> : null}
          {categorySuggestions ? (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", color: "#334155", fontSize: 12 }}>
                <span style={{ background: "#ecfeff", color: "#155e75", border: "1px solid #a5f3fc", borderRadius: 999, padding: "4px 8px", fontWeight: 700 }}>
                  {t("studyTools.create.detected", "Detected")}: {String(categorySuggestions.docType || "").replace(/_/g, " ")} ({Math.round(Number(categorySuggestions.confidence || 0) * 100)}%)
                </span>
                <span>{t("studyTools.create.suggested", "Suggested")}: {categoryLabels[categorySuggestions.suggestedCategory] || categorySuggestions.suggestedCategory}</span>
              </div>
              {!!categorySuggestions.reasons?.length && (
                <div style={{ color: "#64748b", fontSize: 12 }}>
                  {categorySuggestions.reasons.join(" | ")}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            <div>
              <label style={{ fontWeight: 700, fontSize: 13, color: "#475569" }}>{t("studyTools.create.subject", "Subject")}</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: 10, borderRadius: 8, border: "1px solid #d1d5db" }} />
            </div>
            <div>
              <label style={{ fontWeight: 700, fontSize: 13, color: "#475569" }}>{t("studyTools.create.topic", "Topic")}</label>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: 10, borderRadius: 8, border: "1px solid #d1d5db" }} />
            </div>
          </div>
          {!subject.trim() || !topic.trim() ? (
            <div style={{ marginTop: 8, color: "#b45309", fontSize: 12 }}>{msg("studyTools.create.validation.required", "Subject and Topic are required before generating.")}</div>
          ) : genericInput ? (
            <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 12 }}>{genericInputMessage}</div>
          ) : null}
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" onClick={() => {
              setInputMode("Document");
              setCategorySuggestions(null);
              setShowAllCategories(false);
            }} style={{ border: "1px solid #d1d5db", borderRadius: 999, background: inputMode === "Document" ? "#e0f2fe" : "#fff", padding: "8px 12px", cursor: "pointer", fontWeight: 700 }}>{t("studyTools.create.input.uploadDocument", "Upload Document")}</button>
            <button type="button" onClick={() => {
              setInputMode("PasteText");
              setCategorySuggestions(null);
              setShowAllCategories(false);
            }} style={{ border: "1px solid #d1d5db", borderRadius: 999, background: inputMode === "PasteText" ? "#e0f2fe" : "#fff", padding: "8px 12px", cursor: "pointer", fontWeight: 700 }}>{t("studyTools.create.input.pasteText", "Paste Text")}</button>
          </div>

          {inputMode === "PasteText" ? (
            <div>
              <label style={{ fontWeight: 700, fontSize: 13, color: "#475569" }}>{t("studyTools.create.paste.label", "Paste your study content")}</label>
              <textarea value={pastedText} onChange={(e) => setPastedText(e.target.value.slice(0, 200000))} rows={10} placeholder={t("studyTools.create.paste.placeholder", "Paste textbook content, lecture notes, or study material here. Course outlines, curriculum, and syllabus text are not allowed.")} style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 8, border: "1px solid #d1d5db", resize: "vertical" }} />
              <div style={{ marginTop: 6, color: pastedText.length < 200 ? "#b91c1c" : "#64748b", fontSize: 12 }}>{pastedText.length} / 200000 characters</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <label><input type="radio" checked={documentSource === "Select"} onChange={() => {
                  setDocumentSource("Select");
                  setUploadedDocumentId(null);
                  setCategorySuggestions(null);
                  setShowAllCategories(false);
                }} /> {t("studyTools.create.document.selectExisting", "Select existing uploaded document")}</label>
                <label><input type="radio" checked={documentSource === "Upload"} onChange={() => {
                  setDocumentSource("Upload");
                  setSelectedDocumentId("");
                  setCategorySuggestions(null);
                  setShowAllCategories(false);
                }} /> {t("studyTools.create.document.uploadNew", "Upload a document")}</label>
              </div>
              {documentSource === "Upload" ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
                    onChange={(e) => {
                      uploadTokenRef.current += 1;
                      analyzedDocumentRef.current = 0;
                      setUploadFile(e.target.files?.[0] || null);
                      setUploadedDocumentId(null);
                      setExtractionDocumentId(null);
                      setExtractionStatus("");
                      setExtractionPercent(0);
                      setExtractionWarning("");
                      setCategorySuggestions(null);
                      setShowAllCategories(false);
                      setSelectionTouched(false);
                      setUploadBusy(false);
                      setErr("");
                      setSuccess("");
                    }}
                  />
                  {!isImageUpload ? (
                    <select
                      value={effectiveUploadClassId || ""}
                      onChange={(e) => {
                        if (classId) return;
                        setUploadClassId(e.target.value);
                        if (uploadedDocumentId) {
                          uploadTokenRef.current += 1;
                          analyzedDocumentRef.current = 0;
                          setUploadedDocumentId(null);
                          setExtractionDocumentId(null);
                          setExtractionStatus("");
                          setExtractionPercent(0);
                          setExtractionWarning("");
                          setCategorySuggestions(null);
                          setShowAllCategories(false);
                          setSelectionTouched(false);
                          setUploadBusy(false);
                          setSuccess("");
                        }
                      }}
                      disabled={!!classId}
                      style={{ width: 320, padding: 8, borderRadius: 8, border: "1px solid #d1d5db", background: classId ? "#f8fafc" : "#fff" }}
                    >
                      {!classId ? <option value="">{t("studyTools.create.class.select", "Select class")}</option> : null}
                      {classes.map((item) => (
                        <option key={item.classId} value={item.classId}>{item.className}</option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ fontSize: 12, color: "#475569" }}>
                      {msg("studyTools.create.image.uploadDetected", "Image upload detected. AI image study generation supports PNG, JPG, and WEBP up to 5 MB.")}
                    </div>
                  )}
                  {!!extractionDocumentId && (
                    <div style={{ border: "1px solid #dbeafe", background: "#f8fbff", borderRadius: 8, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: "#1e3a8a", fontWeight: 700 }}>
                        <span>{t("studyTools.create.extraction.progress", "Extraction progress")}: {effectiveExtractionStatus || t("studyTools.create.extraction.starting", "Starting")}</span>
                        <span>{Math.max(0, Math.min(100, Number(effectiveExtractionStatus === "Extracted" ? 100 : extractionPercent || 0)))}%</span>
                      </div>
                      <div style={{ width: "100%", height: 8, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(0, Math.min(100, Number(effectiveExtractionStatus === "Extracted" ? 100 : extractionPercent || 0)))}%`, height: "100%", background: extractionStatus === "Rejected" || extractionStatus === "Blocked" || extractionStatus === "Failed" ? "#dc2626" : "#16a34a", transition: "width 300ms ease" }} />
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>{t("studyTools.create.extraction.documentId", "Document ID")}: {extractionDocumentId}</div>
                      {effectiveExtractionStatus !== "Extracted" && !["Rejected", "Blocked", "DeletedByUser", "Failed"].includes(String(extractionStatus || "")) ? (
                        <button
                          type="button"
                          onClick={handleRefreshExtractionStatus}
                          disabled={refreshingExtraction}
                          style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, border: "1px solid #bfdbfe", background: "#fff", color: "#1d4ed8", cursor: refreshingExtraction ? "wait" : "pointer", fontWeight: 700 }}
                        >
                          {refreshingExtraction
                            ? t("studyTools.create.extraction.refreshing", "Refreshing...")
                            : t("studyTools.create.extraction.refresh", "Refresh Status")}
                        </button>
                      ) : null}
                      {!!extractionWarning && <div style={{ marginTop: 4, fontSize: 12, color: "#b91c1c" }}>{extractionWarning}</div>}
                    </div>
                  )}
                </div>
              ) : (
                <select value={selectedDocumentId} onChange={(e) => {
                  setSelectedDocumentId(e.target.value);
                  setSelectionTouched(false);
                  setModeInfo("");
                }} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db" }}>
                  <option value="">{t("studyTools.create.document.select", "Select a document")}</option>
                  {documents.map((d) => (
                    <option key={d.documentId} value={d.documentId}>{d.originalFileName} {d.courseCode ? `(${d.courseCode})` : ""}</option>
                  ))}
                </select>
              )}
              <div style={{ color: "#64748b", fontSize: 12 }}>
                {isImageUpload
                  ? msg("studyTools.create.image.helper", "Upload a clear image of study material such as a textbook page, lecture slide, worksheet, or notes photo. Course outline screenshots are not supported.")
                  : isOutlineDocument
                    ? outlineOutputBlocked
                      ? outlineBlockedMessage
                      : outlineLimitedWarning
                  : uploadFile
                    ? uploadCourseCode
                      ? msg("studyTools.create.upload.autoStart", "Upload starts immediately. After extraction finishes, generation starts automatically.")
                      : msg("studyTools.create.upload.selectClass", "Select a class to start upload and extraction.")
                    : outputTypeSupportsTopicOnly(outputType)
                      ? "You can upload a document for source-based generation, or generate from subject and topic only."
                      : outlineHint}
              </div>
              {selectedDoc && (
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, fontSize: 13, color: "#334155" }}>
                  {t("studyTools.create.selected", "Selected")}: <b>{selectedDoc.originalFileName}</b> | {t("studyTools.create.textLength", "Text length")}: {Number(selectedDoc.extractedTextLength || 0)}
                </div>
              )}
            </div>
          )}
        </div>

        {modeInfo ? <div style={{ color: "#92400e", fontSize: 14 }}>{modeInfo}</div> : null}
        {overrideWarning ? <div style={{ color: "#b45309", fontSize: 14 }}>{overrideWarning}</div> : null}
        {isOutlineDocument ? (
          <div style={{ color: outlineOutputBlocked ? "#b91c1c" : "#92400e", fontSize: 14 }}>
            {outlineOutputBlocked
              ? outlineBlockedMessage
              : outlineLimitedWarning}
          </div>
        ) : null}
        {!!extractionDocumentId && (
          <div style={{ border: "1px dashed #cbd5e1", borderRadius: 10, padding: 10, background: "#f8fafc", color: "#334155", fontSize: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("studyTools.create.debug.title", "Extraction Debug")}</div>
            <div>documentId: {extractionDocumentId}</div>
            <div>uploadedDocumentId: {uploadedDocumentId || "-"}</div>
            <div>extractionStatus: {extractionStatus || "-"}</div>
            <div>effectiveExtractionStatus: {effectiveExtractionStatus || "-"}</div>
            <div>extractedUploadDocId: {extractedUploadDoc?.documentId || "-"}</div>
            <div>extractedUploadDocTextLength: {Number(extractedUploadDoc?.extractedTextLength || 0)}</div>
            <div>documentsLoaded: {Array.isArray(documents) ? documents.length : 0}</div>
            <div>canSubmit: {canSubmit ? "true" : "false"}</div>
          </div>
        )}
        {err ? <div style={{ color: "#b91c1c", fontSize: 14 }}>{err}</div> : null}
        {success ? <div style={{ color: "#047857", fontSize: 14 }}>{success}</div> : null}

        <div style={{ position: "sticky", bottom: 0, zIndex: 2, background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#64748b", fontSize: 12 }}>{t("studyTools.create.footer.background", "Generation runs in background. You can leave this page.")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {queueStartLocked ? (
              <div style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#94a3b8", color: "#fff", fontWeight: 700 }}>
                {t("studyTools.create.footer.generating", "Generating...")}
              </div>
            ) : (
              <>
                <button type="button" onClick={() => navigate("/dashboard")} disabled={busy || navigatingAfterQueue} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: busy || navigatingAfterQueue ? "not-allowed" : "pointer", opacity: busy || navigatingAfterQueue ? 0.7 : 1 }}>{t("studyTools.create.cancel", "Cancel")}</button>
                <button type="submit" disabled={!canSubmit || busy || navigatingAfterQueue} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: !canSubmit || busy || navigatingAfterQueue ? "#94a3b8" : "#16a34a", color: "#fff", cursor: !canSubmit || busy || navigatingAfterQueue ? "not-allowed" : "pointer", fontWeight: 700 }}>
                  {busy || uploadBusy || navigatingAfterQueue
                    ? uploadBusy && !busy
                      ? t("studyTools.create.footer.extracting", "Extracting...")
                      : t("studyTools.create.footer.generating", "Generating...")
                    : outputType === "Notes"
                      ? t("studyTools.create.generate.notes", "Generate Notes")
                      : outputType === "FlashCards"
                        ? t("studyTools.create.generate.flashcards", "Generate Flash Cards")
                        : outputType === "Assignments"
                          ? t("studyTools.create.generate.assessment", "Generate Assessment")
                          : t("studyTools.create.generate.both", "Generate Notes + Flash Cards")}
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}


