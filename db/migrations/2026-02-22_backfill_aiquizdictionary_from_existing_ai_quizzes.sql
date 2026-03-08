/*
  Migration: Backfill dbo.AIQuizDictionary from existing AI quizzes
  Date: 2026-02-22

  Purpose:
    - Insert dictionary records for existing AI quizzes that are not linked yet
    - Link dbo.Quiz.AIQuizDictionaryId to inserted records

  Notes:
    - Safe to run multiple times
    - Only processes quizzes where:
        q.SourceType LIKE 'AI%'
        q.AIQuizDictionaryId IS NULL
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.AIQuizDictionary', 'U') IS NULL
  BEGIN
    RAISERROR('AIQuizDictionary table not found. Run migration 2026-02-22_add_ai_quiz_dictionary.sql first.', 16, 1);
  END;

  IF COL_LENGTH('dbo.Quiz', 'AIQuizDictionaryId') IS NULL
  BEGIN
    RAISERROR('Quiz.AIQuizDictionaryId column not found. Run migration 2026-02-22_add_ai_quiz_dictionary.sql first.', 16, 1);
  END;

  IF OBJECT_ID('tempdb..#QuizToBackfill') IS NOT NULL DROP TABLE #QuizToBackfill;
  IF OBJECT_ID('tempdb..#InsertedMap') IS NOT NULL DROP TABLE #InsertedMap;

  CREATE TABLE #QuizToBackfill (
    QuizId INT NOT NULL PRIMARY KEY,
    TeacherId INT NULL,
    PrincipalId INT NULL,
    StudentId INT NULL,
    ClassId INT NULL,
    Topic NVARCHAR(200) NULL,
    Difficulty NVARCHAR(20) NULL,
    QuestionCount INT NOT NULL,
    SourceProvider NVARCHAR(50) NULL,
    ModelName NVARCHAR(120) NULL,
    PromptHash NVARCHAR(128) NULL,
    DictionaryPayloadJson NVARCHAR(MAX) NOT NULL
  );

  CREATE TABLE #InsertedMap (
    QuizId INT NOT NULL PRIMARY KEY,
    AIQuizDictionaryId INT NOT NULL
  );

  ;WITH TargetQuiz AS (
    SELECT
      q.QuizId,
      q.TeacherId,
      c.StudentId,
      s.PrincipalId,
      q.ClassId,
      q.Topic,
      q.Difficulty,
      q.SourceType,
      q.CreateDate
    FROM dbo.Quiz q
    LEFT JOIN dbo.Class c ON c.ClassId = q.ClassId
    LEFT JOIN dbo.Student s ON s.StudentId = c.StudentId
    WHERE q.SourceType LIKE 'AI%'
      AND q.AIQuizDictionaryId IS NULL
  )
  INSERT INTO #QuizToBackfill (
    QuizId, TeacherId, PrincipalId, StudentId, ClassId, Topic, Difficulty, QuestionCount,
    SourceProvider, ModelName, PromptHash, DictionaryPayloadJson
  )
  SELECT
    tq.QuizId,
    tq.TeacherId,
    tq.PrincipalId,
    tq.StudentId,
    tq.ClassId,
    tq.Topic,
    tq.Difficulty,
    ISNULL(qmeta.QuestionCount, 0) AS QuestionCount,
    CASE
      WHEN tq.SourceType = 'AI_Topic' THEN 'legacy-ai'
      WHEN tq.SourceType = 'AI_Document' THEN 'legacy-ai'
      WHEN tq.SourceType = 'AI_History' THEN 'history'
      ELSE 'legacy-ai'
    END AS SourceProvider,
    'unknown' AS ModelName,
    NULL AS PromptHash,
    (
      SELECT
        (
          SELECT
            tq.Topic AS topic,
            tq.Difficulty AS difficulty,
            ISNULL(qmeta.QuestionCount, 0) AS questionCount,
            CASE
              WHEN tq.SourceType = 'AI_History' THEN 'history'
              ELSE 'legacy-ai'
            END AS sourceProvider,
            'unknown' AS modelName,
            tq.CreateDate AS createdAtUtc
          FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        ) AS [meta],
        (
          SELECT
            qq.QuestionText AS questionText,
            qq.Explanation AS explanation,
            ISNULL(qq.DiagramType, 'none') AS diagramType,
            qq.DiagramData AS diagramData,
            (
              SELECT
                qc.ChoiceText AS [text]
              FROM dbo.QuizChoice qc
              WHERE qc.QuestionId = qq.QuestionId
              ORDER BY qc.DisplayOrder, qc.ChoiceId
              FOR JSON PATH
            ) AS [options],
            ISNULL(ci.CorrectIndex, 0) AS correctIndex
          FROM dbo.QuizQuestion qq
          OUTER APPLY (
            SELECT MIN(x.rn - 1) AS CorrectIndex
            FROM (
              SELECT
                qc2.IsCorrect,
                ROW_NUMBER() OVER (ORDER BY qc2.DisplayOrder, qc2.ChoiceId) AS rn
              FROM dbo.QuizChoice qc2
              WHERE qc2.QuestionId = qq.QuestionId
            ) x
            WHERE x.IsCorrect = 1
          ) ci
          WHERE qq.QuizId = tq.QuizId
          ORDER BY qq.DisplayOrder, qq.QuestionId
          FOR JSON PATH
        ) AS [questions]
      FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS DictionaryPayloadJson
  FROM TargetQuiz tq
  OUTER APPLY (
    SELECT COUNT(1) AS QuestionCount
    FROM dbo.QuizQuestion qqc
    WHERE qqc.QuizId = tq.QuizId
  ) qmeta;

  ;WITH SourceRows AS (
    SELECT
      b.*,
      ROW_NUMBER() OVER (ORDER BY b.QuizId) AS RN
    FROM #QuizToBackfill b
  )
  MERGE dbo.AIQuizDictionary AS tgt
  USING SourceRows AS src
    ON 1 = 0
  WHEN NOT MATCHED THEN
    INSERT (
      TeacherId, PrincipalId, StudentId, ClassId, Topic, Difficulty, QuestionCount,
      SourceProvider, ModelName, PromptHash, DictionaryPayloadJson, IsActive
    )
    VALUES (
      src.TeacherId, src.PrincipalId, src.StudentId, src.ClassId, src.Topic, src.Difficulty, src.QuestionCount,
      src.SourceProvider, src.ModelName, src.PromptHash, src.DictionaryPayloadJson, 1
    )
  OUTPUT src.QuizId, inserted.AIQuizDictionaryId INTO #InsertedMap(QuizId, AIQuizDictionaryId);

  UPDATE q
  SET q.AIQuizDictionaryId = m.AIQuizDictionaryId
  FROM dbo.Quiz q
  JOIN #InsertedMap m ON m.QuizId = q.QuizId
  WHERE q.AIQuizDictionaryId IS NULL;

  COMMIT;

  SELECT
    (SELECT COUNT(1) FROM #QuizToBackfill) AS CandidateAIQuizzes,
    (SELECT COUNT(1) FROM #InsertedMap) AS InsertedDictionaryRows,
    (SELECT COUNT(1) FROM dbo.Quiz WHERE SourceType LIKE 'AI%' AND AIQuizDictionaryId IS NOT NULL) AS TotalLinkedAIQuizzes;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

