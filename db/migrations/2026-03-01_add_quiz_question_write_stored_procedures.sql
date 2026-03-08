IF OBJECT_ID('dbo.usp_QuizQuestion_Create', 'P') IS NOT NULL
  DROP PROCEDURE dbo.usp_QuizQuestion_Create;
GO

CREATE PROCEDURE dbo.usp_QuizQuestion_Create
  @TeacherId INT = NULL,
  @QuizId INT,
  @QuestionText NVARCHAR(4000),
  @Explanation NVARCHAR(3000) = NULL,
  @DiagramType NVARCHAR(20) = NULL,
  @DiagramData NVARCHAR(MAX) = NULL,
  @QuestionType NVARCHAR(20),
  @ExpectedAnswerText NVARCHAR(500) = NULL,
  @AnswerMatchMode NVARCHAR(20) = NULL,
  @ExpectedAnswerNumber FLOAT = NULL,
  @NumericTolerance FLOAT = NULL,
  @Points INT,
  @OptionsJson NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @Inserted TABLE (QuestionId INT);

  BEGIN TRAN;

  DECLARE @DisplayOrder INT = (
    SELECT ISNULL(MAX(DisplayOrder), 0) + 1
    FROM dbo.QuizQuestion
    WHERE QuizId = @QuizId
  );

  DECLARE @LongCount INT = (
    SELECT COUNT(1)
    FROM dbo.QuizQuestion WITH (UPDLOCK, HOLDLOCK)
    WHERE QuizId = @QuizId
      AND UPPER(ISNULL(QuestionType, 'MCQ')) = 'LONG'
  );

  IF (@QuestionType = 'LONG' AND @LongCount >= 5)
    RAISERROR('LONG_LIMIT_REACHED', 16, 1);

  INSERT INTO dbo.QuizQuestion
    (TeacherId, QuizId, QuestionText, Explanation, DiagramType, DiagramData, DisplayOrder, QuestionType, ExpectedAnswerText, AnswerMatchMode, ExpectedAnswerNumber, NumericTolerance, Points)
  OUTPUT INSERTED.QuestionId INTO @Inserted(QuestionId)
  VALUES
    (@TeacherId, @QuizId, @QuestionText, @Explanation, @DiagramType, @DiagramData, @DisplayOrder, @QuestionType, @ExpectedAnswerText, @AnswerMatchMode, @ExpectedAnswerNumber, @NumericTolerance, @Points);

  DECLARE @QuestionId INT = (SELECT TOP 1 QuestionId FROM @Inserted);

  IF (@QuestionType IN ('MCQ', 'TRUE_FALSE') AND @QuestionId IS NOT NULL)
  BEGIN
    INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    SELECT
      @TeacherId,
      @QuestionId,
      JSON_VALUE(j.[value], '$.text'),
      CASE WHEN TRY_CAST(JSON_VALUE(j.[value], '$.isCorrect') AS bit) = 1 THEN 1 ELSE 0 END,
      ROW_NUMBER() OVER (ORDER BY TRY_CAST(j.[key] AS INT), j.[key])
    FROM OPENJSON(@OptionsJson) j;
  END

  COMMIT;

  SELECT @QuestionId AS QuestionId;
END
GO

IF OBJECT_ID('dbo.usp_QuizQuestion_Update', 'P') IS NOT NULL
  DROP PROCEDURE dbo.usp_QuizQuestion_Update;
GO

CREATE PROCEDURE dbo.usp_QuizQuestion_Update
  @QuizId INT,
  @QuestionId INT,
  @TeacherId INT = NULL,
  @QuestionText NVARCHAR(4000),
  @Explanation NVARCHAR(3000) = NULL,
  @DiagramType NVARCHAR(20) = NULL,
  @DiagramData NVARCHAR(MAX) = NULL,
  @QuestionType NVARCHAR(20),
  @ExpectedAnswerText NVARCHAR(500) = NULL,
  @AnswerMatchMode NVARCHAR(20) = NULL,
  @ExpectedAnswerNumber FLOAT = NULL,
  @NumericTolerance FLOAT = NULL,
  @Points INT,
  @OptionsJson NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRAN;

  DECLARE @LongCount INT = (
    SELECT COUNT(1)
    FROM dbo.QuizQuestion WITH (UPDLOCK, HOLDLOCK)
    WHERE QuizId = @QuizId
      AND QuestionId <> @QuestionId
      AND UPPER(ISNULL(QuestionType, 'MCQ')) = 'LONG'
  );

  IF (@QuestionType = 'LONG' AND @LongCount >= 5)
    RAISERROR('LONG_LIMIT_REACHED', 16, 1);

  UPDATE dbo.QuizQuestion
  SET QuestionText = @QuestionText,
      Explanation = @Explanation,
      DiagramType = @DiagramType,
      DiagramData = @DiagramData,
      QuestionType = @QuestionType,
      ExpectedAnswerText = @ExpectedAnswerText,
      AnswerMatchMode = @AnswerMatchMode,
      ExpectedAnswerNumber = @ExpectedAnswerNumber,
      NumericTolerance = @NumericTolerance,
      Points = @Points,
      LastModifiedDate = SYSUTCDATETIME()
  WHERE QuizId = @QuizId
    AND QuestionId = @QuestionId;

  DELETE FROM dbo.QuizChoice
  WHERE QuestionId = @QuestionId;

  IF (@QuestionType IN ('MCQ', 'TRUE_FALSE'))
  BEGIN
    INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    SELECT
      @TeacherId,
      @QuestionId,
      JSON_VALUE(j.[value], '$.text'),
      CASE WHEN TRY_CAST(JSON_VALUE(j.[value], '$.isCorrect') AS bit) = 1 THEN 1 ELSE 0 END,
      ROW_NUMBER() OVER (ORDER BY TRY_CAST(j.[key] AS INT), j.[key])
    FROM OPENJSON(@OptionsJson) j;
  END

  COMMIT;

  SELECT @QuestionId AS QuestionId;
END
GO
