IF OBJECT_ID('dbo.usp_QuizContent_Replace', 'P') IS NOT NULL
  DROP PROCEDURE dbo.usp_QuizContent_Replace;
GO

CREATE PROCEDURE dbo.usp_QuizContent_Replace
  @TeacherId INT = NULL,
  @QuizId INT,
  @QuestionsJson NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRAN;

  DELETE FROM dbo.QuizChoice
  WHERE QuestionId IN (
    SELECT QuestionId
    FROM dbo.QuizQuestion
    WHERE QuizId = @QuizId
  );

  DELETE FROM dbo.QuizQuestion
  WHERE QuizId = @QuizId;

  DECLARE @Questions TABLE (
    RowNum INT IDENTITY(1,1) PRIMARY KEY,
    QuestionJson NVARCHAR(MAX)
  );

  INSERT INTO @Questions (QuestionJson)
  SELECT [value]
  FROM OPENJSON(@QuestionsJson)
  ORDER BY TRY_CAST([key] AS INT), [key];

  DECLARE @i INT = 1;
  DECLARE @count INT = (SELECT COUNT(1) FROM @Questions);
  DECLARE @QuestionJson NVARCHAR(MAX);
  DECLARE @QuestionId INT;
  DECLARE @QuestionType NVARCHAR(20);

  WHILE @i <= @count
  BEGIN
    SELECT @QuestionJson = QuestionJson
    FROM @Questions
    WHERE RowNum = @i;

    SET @QuestionType = UPPER(ISNULL(JSON_VALUE(@QuestionJson, '$.questionType'), 'MCQ'));

    DECLARE @Inserted TABLE (QuestionId INT);

    INSERT INTO dbo.QuizQuestion (
      TeacherId,
      QuizId,
      QuestionText,
      Explanation,
      DiagramType,
      DiagramData,
      IsHiddenForStudent,
      DisplayOrder,
      QuestionType,
      ExpectedAnswerText,
      AnswerMatchMode,
      ExpectedAnswerNumber,
      NumericTolerance,
      Points
    )
    OUTPUT INSERTED.QuestionId INTO @Inserted(QuestionId)
    VALUES (
      @TeacherId,
      @QuizId,
      JSON_VALUE(@QuestionJson, '$.questionText'),
      NULLIF(JSON_VALUE(@QuestionJson, '$.explanation'), ''),
      ISNULL(NULLIF(JSON_VALUE(@QuestionJson, '$.diagramType'), ''), 'none'),
      NULLIF(JSON_VALUE(@QuestionJson, '$.diagramData'), ''),
      CASE WHEN TRY_CAST(JSON_VALUE(@QuestionJson, '$.isHiddenForStudent') AS bit) = 1 THEN 1 ELSE 0 END,
      @i,
      @QuestionType,
      NULLIF(JSON_VALUE(@QuestionJson, '$.expectedAnswerText'), ''),
      NULLIF(JSON_VALUE(@QuestionJson, '$.answerMatchMode'), ''),
      TRY_CAST(JSON_VALUE(@QuestionJson, '$.expectedAnswerNumber') AS float),
      TRY_CAST(JSON_VALUE(@QuestionJson, '$.numericTolerance') AS float),
      ISNULL(TRY_CAST(JSON_VALUE(@QuestionJson, '$.points') AS int), 1)
    );

    SELECT TOP 1 @QuestionId = QuestionId FROM @Inserted;

    IF (@QuestionType IN ('MCQ', 'TRUE_FALSE'))
    BEGIN
      INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
      SELECT
        @TeacherId,
        @QuestionId,
        JSON_VALUE(opt.[value], '$.text'),
        CASE WHEN TRY_CAST(JSON_VALUE(opt.[value], '$.isCorrect') AS bit) = 1 THEN 1 ELSE 0 END,
        ROW_NUMBER() OVER (ORDER BY TRY_CAST(opt.[key] AS INT), opt.[key])
      FROM OPENJSON(@QuestionJson, '$.options') opt;
    END

    SET @i = @i + 1;
  END

  COMMIT;
END
GO
