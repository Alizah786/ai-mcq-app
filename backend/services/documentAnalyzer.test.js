const { analyzeDocumentForCategories, DOC_TYPES } = require("./documentAnalyzer");

function padSample(text, filler) {
  const seed = filler || "Additional educational context explains the topic, provides examples, and adds enough readable instructional text for analysis.";
  let out = String(text || "");
  while (out.length < 360 || out.split(/\s+/).filter(Boolean).length < 70) {
    out += ` ${seed}`;
  }
  return out;
}

describe("analyzeDocumentForCategories", () => {
  test("COURSE_OUTLINE sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "COURSE OUTLINE\nCourse Code: CIA4U\nInstructor: Mr. Khan\nOffice Hours Monday\nAssessment Breakdown with grading\nWeekly Schedule: Week 1 overview\nPolicies: Academic Integrity and attendance. Learning outcomes are listed with the grading schedule and course code repeated.\nThis outline explains course logistics and grading expectations in detail for the term.",
        "The outline describes grading, weekly schedule items, academic integrity policies, assessment breakdown, and course logistics for students."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.COURSE_OUTLINE);
    expect(result.suggestedCategory).toBe("STUDY_NOTES");
    expect(result.visibleCategories).toEqual(expect.arrayContaining(["STUDY_NOTES", "KEYWORDS"]));
  });

  test("course outline filename overrides misleading text toward outline classification", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "Assessment task summary\nQuestions are listed with marks and short prompts. Students review course expectations, grading summary, and weekly topics for the semester.",
        "The document includes course logistics, unit overview, grading policy, and scheduling notes for the term."
      ),
      { originalFileName: "CHW3M-Course-Outline_2024 (1).pdf" }
    );
    expect(result.docType).toBe(DOC_TYPES.COURSE_OUTLINE);
    expect(result.suggestedCategory).toBe("STUDY_NOTES");
    expect(result.hiddenCategories).toContain("ASSIGNMENT");
  });

  test("LECTURE_NOTES_REFERENCE sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "TOPIC: Inflation\nInflation is a sustained increase in prices across an economy. It refers to the reduced purchasing power of money over time.\nKey points:\nCauses include demand-pull factors, supply shocks, and policy choices.\nExample:\nIf bread prices rise across many stores, inflation may be increasing.\nSummary:\nInflation affects savings, wages, and interest rates.\nDefinitions:\nInflation means the general price level rises over time.\nReferences:\nLesson summary and classroom discussion notes.",
        "Lecture notes continue with definitions, concept explanations, examples, and summary paragraphs about inflation and macroeconomics."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.LECTURE_NOTES_REFERENCE);
    expect(result.visibleCategories).toEqual(expect.arrayContaining(["STUDY_NOTES", "FLASH_CARDS", "KEYWORDS"]));
    expect(result.hiddenCategories).toContain("ASSIGNMENT");
  });

  test("ASSIGNMENT_SHEET sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "ASSIGNMENT 2\nDue Date: March 10\nSubmission: Upload to LMS\nDeliverables: report, code, and screenshots\nRubric (Marks): clarity, correctness, references\nInstructions: write your analysis, explain the design, compare two approaches, include references, format your report, and submit before the deadline.\nQuestion 1) Analyze the dataset.\nQuestion 2) Compare the outputs.",
        "This assignment sheet explains the deadline, submission process, rubric, marks, deliverables, and written instructions for the students."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.ASSIGNMENT_SHEET);
    expect(result.suggestedCategory).toBe("ASSIGNMENT");
    expect(result.hiddenCategories).toEqual(expect.arrayContaining(["FLASH_CARDS", "KEYWORDS"]));
  });

  test("math assignment sheet still suggests ASSIGNMENT", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "MTH130 Winter 2026\nAssignment 1\nDeadline: 22 January 2026\nTotal: 20 marks\nInstructions: present complete solutions and answers in exact form. Submission is in person.\n1. Solve for the equation of the line through (1,2) and (3,-4).\n2. Write the equation of the line through (-2,5) and (4,-3).\n3. Determine the value of a.\n4. Solve the system of linear equations using substitution.",
        "This assignment sheet includes numbered questions, deadline details, total marks, instructions, and submission rules for the students."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.ASSIGNMENT_SHEET);
    expect(result.suggestedCategory).toBe("ASSIGNMENT");
  });

  test("QUESTION_PAPER sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "Q1) What is a DBMS?\nA) A database engine\nB) A browser\nC) A printer\nD) A monitor\nQ2) Which key is unique?\nA) Foreign key\nB) Primary key\nC) Composite key\nD) Nullable key\nQ3) What does SQL stand for?\nA) Structured Query Language\nB) Sample Query Logic\nC) System Quick Link\nD) Simple Queue Layer",
        "This question paper contains multiple choice questions with numbered prompts and answer options for exam practice."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.QUESTION_PAPER);
    expect(result.suggestedCategory).toBe("FLASH_CARDS");
  });

  test("ANSWER_KEY sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "ANSWER KEY\n1) B\n2) B\n3) A\nSolutions:\nQ1: The primary key uniquely identifies the row.\nQ2: The correct answer is B because it matches the schema definition.\nQ3: SQL stands for Structured Query Language.\nAnswers: B, B, A.",
        "The answer key lists the correct options, brief solutions, and explanation lines for each numbered item."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.ANSWER_KEY);
    expect(["STUDY_NOTES", "FLASH_CARDS"]).toContain(result.suggestedCategory);
  });

  test("MATH sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "MATH PRACTICE\n1) Solve for x: 3x+7=22\n2) Simplify 4(x+2)-3x\n3) Evaluate the function when x=5\n4) Prove that the triangle is isosceles\nShow all steps and justify each equation used in the solution.\nAdditional equation practice: y = mx + b and x^2 + y^2 = r^2.",
        "Math practice continues with equations, evaluation steps, proof language, and worked solution prompts for students."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.MATH);
    expect(["FLASH_CARDS", "STUDY_NOTES"]).toContain(result.suggestedCategory);
    expect(result.visibleCategories).toEqual(expect.arrayContaining(["FLASH_CARDS", "STUDY_NOTES"]));
  });

  test("FORMULA_SHEET sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "FORMULA SHEET\nsin^2(x)+cos^2(x)=1\nx = (-b ± √(b^2-4ac)) / 2a\n\\frac{d}{dx}(x^2)=2x\n\\int x dx = x^2/2 + C\nArea = πr^2\nCircumference = 2πr\n∑ x_i / n = mean\nF = ma\nV = IR",
        "Formula reference lines continue with compact equations, symbols, and notation for quick revision."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.FORMULA_SHEET);
    expect(result.suggestedCategory).toBe("FLASH_CARDS");
    expect(result.visibleCategories).toEqual(expect.arrayContaining(["FLASH_CARDS", "KEYWORDS"]));
  });

  test("PROGRAMMING sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "Programming Notes\nTOPIC: JavaScript Modules\n```js\nexport function sum(a,b){ return a + b; }\nimport { sum } from './math';\nconst result = sum(2,3);\n```\nThe function is defined as a reusable module export. Key points:\nconst and let create block-scoped bindings.\nExample:\nexport const value = 42;\nTroubleshooting:\nSyntaxError occurs when braces are missing.",
        "Programming notes continue with code examples, import and export statements, function explanations, and syntax troubleshooting guidance."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.PROGRAMMING);
    expect(result.visibleCategories).toEqual(expect.arrayContaining(["STUDY_NOTES", "FLASH_CARDS", "KEYWORDS"]));
  });

  test("TABLES_DATA_SHEET sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "DATA DICTIONARY\nTable: Students\n| ColumnName | DataType | Nullable |\n| StudentId | INT | NO |\n| FullName | NVARCHAR(120) | NO |\n| Email | NVARCHAR(200) | YES |\nColumnName,DataType,Nullable\nStudentId,INT,NO\nEmail,NVARCHAR(200),YES\nCourseCode,NVARCHAR(80),NO\nStudentId   INT   NO\nFullName   NVARCHAR(120)   NO\nEmail   NVARCHAR(200)   YES\nRows describe each field in the dataset and the data dictionary for the table structure.",
        "The data sheet continues with column definitions, data types, nullable flags, rows, table headers, and structured data dictionary metadata for the dataset."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.TABLES_DATA_SHEET);
    expect(result.suggestedCategory).toBe("KEYWORDS");
    expect(result.hiddenCategories).toContain("ASSIGNMENT");
  });

  test("OTHER_UNKNOWN sample", () => {
    const result = analyzeDocumentForCategories(
      padSample(
        "Random note about groceries and weekend plans. Need to buy apples, bread, milk, and call a friend about the trip. Saturday lunch, Sunday errands, and maybe watch a movie later. Nothing here is educational or structured as study content, just casual planning text with shopping reminders and household tasks.",
        "This casual planning note continues with weekend errands, household chores, dinner ideas, and travel reminders rather than study material."
      )
    );
    expect(result.docType).toBe(DOC_TYPES.OTHER_UNKNOWN);
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.hiddenCategories).toEqual([]);
    expect(result.visibleCategories).toEqual(expect.arrayContaining(["STUDY_NOTES", "FLASH_CARDS", "KEYWORDS", "ASSIGNMENT"]));
  });
});
